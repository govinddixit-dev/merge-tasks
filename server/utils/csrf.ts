/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * How it works:
 * 1. On every response, we set a non-httpOnly cookie `csrf_token` with a random value.
 * 2. The client reads this cookie and sends it back as the `x-csrf-token` header on mutating requests.
 * 3. The middleware compares the cookie value to the header value.
 *    An attacker's cross-origin form/fetch cannot read our cookie, so they can't forge the header.
 *
 * This is the standard OWASP-recommended pattern for APIs that use `sameSite: "none"` cookies.
 * Safe methods (GET, HEAD, OPTIONS) are exempt.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getLogger } from "./logger";

const log = getLogger("csrf");

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_LENGTH = 32; // 256-bit random token

/**
 * Generate a new CSRF token and set it as a cookie on the response.
 * The cookie is NOT httpOnly so the client JS can read it.
 */
function setCsrfCookie(req: Request, res: Response): string {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString("hex");
  const isSecure =
    req.protocol === "https" ||
    (req.headers["x-forwarded-proto"] as string)?.includes("https");

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // client must read this
    secure: isSecure,
    sameSite: isSecure ? "none" : "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
  });

  return token;
}

/**
 * Express middleware that enforces CSRF protection on mutating requests.
 * Safe methods (GET, HEAD, OPTIONS) always pass through and get a fresh token.
 * Mutating methods (POST, PUT, PATCH, DELETE) must include a matching x-csrf-token header.
 *
 * IMPORTANT: The CSRF cookie is only refreshed AFTER validation succeeds on mutating
 * requests, preventing a race condition where the old cookie is overwritten before
 * the header comparison runs.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Safe methods are exempt — set/refresh the token and pass through
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (safeMethod) {
    setCsrfCookie(req, res);
    return next();
  }

  // Skip CSRF for Stripe webhooks (they use their own signature verification)
  if (req.path.startsWith("/api/stripe/webhook")) {
    return next();
  }

  // Skip CSRF for public token-gated routes (they use unguessable tokens as authorization)
  if (req.path.startsWith("/api/proposals/public/") || req.path.startsWith("/api/approve/") || req.path.startsWith("/api/store-approval/")) {
    return next();
  }

  // Skip CSRF for OAuth callbacks (they use state parameters for protection)
  if (req.path.startsWith("/api/auth/google/callback") || req.path.startsWith("/api/auth/microsoft/callback") || req.path.startsWith("/api/oauth/callback")) {
    return next();
  }

  // Skip CSRF for SAML SSO callbacks — IdPs POST the SAML assertion directly;
  // they cannot include our CSRF cookie/header. SAML responses are validated
  // via XML signature verification in the callback handler instead. (PO-3)
  if (req.path.startsWith("/api/sso/saml/callback")) {
    return next();
  }

  // For mutating requests, validate the double-submit token FIRST
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken) {
    log.warn(`CSRF token missing — cookie: ${!!cookieToken}, header: ${!!headerToken}, path: ${req.path}`);
    res.status(403).json({ error: "CSRF token missing. Please refresh the page and try again." });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const cookieBuf = Buffer.from(cookieToken, "utf8");
    const headerBuf = Buffer.from(headerToken, "utf8");
    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      log.warn(`CSRF token mismatch on ${req.path}`);
      res.status(403).json({ error: "CSRF token mismatch. Please refresh the page and try again." });
      return;
    }
  } catch {
    log.warn(`CSRF validation error on ${req.path}`);
    res.status(403).json({ error: "CSRF validation failed." });
    return;
  }

  // Validation passed — NOW refresh the token for the next request
  setCsrfCookie(req, res);

  next();
}
