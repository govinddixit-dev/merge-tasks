/**
 * Session management — short-lived JWT access tokens + refresh token rotation.
 *
 * Access token:  15 min, stored in httpOnly cookie `app_session_id`
 * Refresh token: 7 days, stored in httpOnly cookie `app_refresh_token`
 *
 * On every authenticated request:
 *   1. Verify the access token.
 *   2. Check the token blocklist (JTI + per-user revocation).
 *   3. If expired, check the refresh token.
 *   4. If the refresh token is valid and not revoked, issue a new access + refresh token pair (rotation).
 *   5. If both are invalid or revoked, reject the request.
 *
 * lastSignedIn is throttled to once per hour to avoid a DB write on every request.
 */
import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ACCESS_TOKEN_MS,
  REFRESH_TOKEN_MS,
} from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { randomUUID } from "crypto";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { getLogger } from "../utils/logger";
import { getSessionCookieOptions } from "./cookies";
import { isTokenRevokedFailClosed, blockToken } from "../utils/tokenBlocklist";

const log = getLogger("Auth");

/** How often we update lastSignedIn in the DB (once per hour) */
const LAST_SIGNED_IN_THROTTLE_MS = 1000 * 60 * 60;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  /** Token type: "access" or "refresh" */
  typ: "access" | "refresh";
  /** JWT ID — unique per token, used for single-token revocation */
  jti?: string;
  /** Issued-at timestamp (seconds) — set by jose automatically */
  iat?: number;
  /** Expiration timestamp (seconds) */
  exp?: number;
};

class SessionService {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) return new Map<string, string>();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured. Set JWT_SECRET in your .env file.");
    }
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a signed JWT token with a unique JTI for revocation support.
   */
  async createToken(
    openId: string,
    tokenType: "access" | "refresh",
    options: { name?: string } = {}
  ): Promise<string> {
    const expiresInMs = tokenType === "access" ? ACCESS_TOKEN_MS : REFRESH_TOKEN_MS;
    const issuedAt = Date.now();
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId,
      appId: ENV.appId,
      name: options.name || "",
      typ: tokenType,
      jti: randomUUID(), // Unique token ID for revocation
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  /**
   * Legacy wrapper — creates an access token. Used by login flows.
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.createToken(openId, "access", options);
  }

  /**
   * Issue both access + refresh tokens and set them as httpOnly cookies.
   */
  async issueTokenPair(
    req: Request,
    res: Response,
    openId: string,
    name?: string
  ): Promise<void> {
    const accessToken = await this.createToken(openId, "access", { name });
    const refreshToken = await this.createToken(openId, "refresh", { name });
    const cookieOpts = getSessionCookieOptions(req);

    res.cookie(COOKIE_NAME, accessToken, {
      ...cookieOpts,
      maxAge: ACCESS_TOKEN_MS,
    });
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...cookieOpts,
      maxAge: REFRESH_TOKEN_MS,
    });
  }

  /**
   * Verify a JWT token and return its payload.
   * Returns null if the token is missing, expired, or invalid.
   * Optionally pass `allowExpired: true` to skip expiration check (used internally).
   */
  async verifySession(
    cookieValue: string | undefined | null,
    options?: { allowExpired?: boolean }
  ): Promise<SessionPayload | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const verifyOpts: Parameters<typeof jwtVerify>[2] = {
        algorithms: ["HS256"],
      };
      const { payload } = await jwtVerify(cookieValue, secretKey, verifyOpts);
      const { openId, appId, name, typ, jti, iat, exp } = payload as Record<string, unknown>;

      if (typeof openId !== "string" || !openId || typeof appId !== "string" || !appId) {
        log.warn("Session payload missing required fields (openId or appId)");
        return null;
      }

      return {
        openId,
        appId,
        name: typeof name === "string" ? name : "",
        typ: typ === "refresh" ? "refresh" : "access",
        jti: typeof jti === "string" ? jti : undefined,
        iat: typeof iat === "number" ? iat : undefined,
        exp: typeof exp === "number" ? exp : undefined,
      };
    } catch (error) {
      // If the token is expired and we allow expired, re-decode without verification
      if (options?.allowExpired && error instanceof joseErrors.JWTExpired) {
        try {
          const claims = (error as joseErrors.JWTExpired & { payload?: Record<string, unknown> }).payload;
          if (claims && typeof claims.openId === "string") {
            return {
              openId: claims.openId,
              appId: typeof claims.appId === "string" ? claims.appId : "",
              name: typeof claims.name === "string" ? claims.name : "",
              typ: claims.typ === "refresh" ? "refresh" : "access",
              jti: typeof claims.jti === "string" ? claims.jti : undefined,
              iat: typeof claims.iat === "number" ? claims.iat : undefined,
              exp: typeof claims.exp === "number" ? claims.exp : undefined,
            };
          }
        } catch {
          // fall through
        }
      }
      log.warn(`Session verification failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Check if a verified session has been revoked via the token blocklist.
   *
   * Session validation is Tier A: a Redis outage cannot be allowed to
   * silently disable revocation across the fleet, so we delegate to
   * isTokenRevokedFailClosed which treats backend errors as a denial and
   * emits a structured log for alerting.
   */
  private async isRevoked(session: SessionPayload): Promise<boolean> {
    const iatMs = session.iat ? session.iat * 1000 : 0;
    return isTokenRevokedFailClosed(session.jti, session.openId, iatMs);
  }

  /**
   * Authenticate an incoming HTTP request.
   *
   * 1. Try the access token.
   * 2. Check the token blocklist.
   * 3. If expired, try the refresh token and rotate both.
   * 4. If both fail or are revoked, throw ForbiddenError.
   *
   * lastSignedIn is throttled to once per hour.
   */
  async authenticateRequest(req: Request, res?: Response): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);

    // 1. Try access token
    const accessCookie = cookies.get(COOKIE_NAME);
    let session = await this.verifySession(accessCookie);

    if (session && session.typ === "access") {
      // 2. Check blocklist
      if (await this.isRevoked(session)) {
        throw ForbiddenError("Session has been revoked. Please sign in again.");
      }
      return this.resolveUser(session, req);
    }

    // 3. Access token missing or expired — try refresh token
    const refreshCookie = cookies.get(REFRESH_COOKIE_NAME);
    const refreshSession = await this.verifySession(refreshCookie);

    if (refreshSession && refreshSession.typ === "refresh") {
      // Check blocklist on refresh token too
      if (await this.isRevoked(refreshSession)) {
        throw ForbiddenError("Session has been revoked. Please sign in again.");
      }

      // Refresh token is valid — rotate tokens
      const user = await db.getUserByOpenId(refreshSession.openId);
      if (!user) {
        throw ForbiddenError("User not found. Please sign in again.");
      }

      // Issue new token pair (rotation)
      if (res) {
        await this.issueTokenPair(req, res, user.openId, user.name || undefined);
        log.info(`Rotated token pair for user ${user.openId}`);
      }

      return this.resolveUserFromRecord(user, req);
    }

    // 4. Both tokens invalid
    throw ForbiddenError("Invalid or missing session. Please sign in again.");
  }

  /**
   * Resolve a user from a verified session payload.
   * Throttles lastSignedIn writes to once per hour.
   */
  private async resolveUser(session: SessionPayload, req: Request): Promise<User> {
    const user = await db.getUserByOpenId(session.openId);
    if (!user) {
      throw ForbiddenError("User not found. Please sign in again.");
    }
    return this.resolveUserFromRecord(user, req);
  }

  /**
   * Throttle lastSignedIn update to once per hour.
   */
  private async resolveUserFromRecord(user: User, req: Request): Promise<User> {
    const now = Date.now();
    const lastSigned = user.lastSignedIn ? new Date(user.lastSignedIn).getTime() : 0;

    if (now - lastSigned > LAST_SIGNED_IN_THROTTLE_MS) {
      // Fire-and-forget — don't block the request
      db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      }).catch((err) => log.warn("Failed to update lastSignedIn:", err));
    }

    return user;
  }
}

export const sdk = new SessionService();
