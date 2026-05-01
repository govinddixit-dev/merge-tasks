/**
 * Email unsubscribe — token signing, verification, suppression checks.
 *
 * Tokens are HMAC-signed with the session secret so the public
 * /api/unsubscribe endpoint can trust the (email, storeId, type) payload
 * without a database round-trip. The token itself is opaque to the
 * recipient; only the server can validate it.
 *
 * Suppression check (isUnsubscribed) is consulted ONLY for commercial
 * emails. Transactional emails (2FA, approvals, order confirmations,
 * onboarding) bypass this and always send.
 */

import crypto from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { emailUnsubscribes } from "../../drizzle/schema";
import type { getDb } from "../db";
import { ENV } from "../_core/env";
import { getLogger } from "../utils/logger";

const log = getLogger("email:unsubscribe");

export type UnsubscribeType = "all" | "proposals" | "marketing";

export interface UnsubscribeContext {
  email: string;
  storeId?: number | null;
  type: UnsubscribeType;
}

type DbHandle = Awaited<ReturnType<typeof getDb>>;

function signingKey(): string {
  // ENV.cookieSecret is guaranteed non-empty in any internet-facing env.
  // In local unit tests it may be empty — HMAC still works with an empty
  // key, which is acceptable since no real users are involved.
  return ENV.cookieSecret;
}

function encodePayload(ctx: UnsubscribeContext): string {
  const payload = {
    e: ctx.email.trim().toLowerCase(),
    s: ctx.storeId ?? null,
    t: ctx.type,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signPayload(encoded: string): string {
  return crypto
    .createHmac("sha256", signingKey())
    .update(encoded)
    .digest("base64url");
}

/**
 * Generate a signed unsubscribe token that encodes the recipient + scope.
 * Idempotent for the same input — so the same (email, storeId, type)
 * always yields the same token under a given secret.
 */
export function generateUnsubscribeToken(ctx: UnsubscribeContext): string {
  const encoded = encodePayload(ctx);
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify a token and return the decoded context. Returns null on any
 * tampering, malformed input, or signature mismatch.
 */
export function verifyUnsubscribeToken(token: string): UnsubscribeContext | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(encoded);
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { e?: unknown; s?: unknown; t?: unknown };
    if (typeof parsed.e !== "string") return null;
    const t = parsed.t;
    if (t !== "all" && t !== "proposals" && t !== "marketing") return null;
    const s = parsed.s;
    const storeId = s === null ? null : typeof s === "number" ? s : null;
    return { email: parsed.e, storeId, type: t };
  } catch {
    return null;
  }
}

/**
 * Build the public unsubscribe URL for a given context.
 */
export function buildUnsubscribeUrl(ctx: UnsubscribeContext): string {
  const base = process.env.APP_BASE_URL || "https://app.mergetasks.com";
  const token = generateUnsubscribeToken(ctx);
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Check whether the recipient has unsubscribed from a given scope.
 *
 * Matches are OR'd: a row of type "all" suppresses every commercial email
 * for the address; a row matching the specific type suppresses that type.
 * storeId is matched exactly — a store-scoped unsubscribe does not
 * suppress platform-level sends and vice-versa.
 */
export async function isUnsubscribed(
  db: DbHandle,
  ctx: UnsubscribeContext,
): Promise<boolean> {
  if (!db) return false;
  const email = ctx.email.trim().toLowerCase();
  const rows = await db
    .select({ id: emailUnsubscribes.id, type: emailUnsubscribes.unsubscribeType })
    .from(emailUnsubscribes)
    .where(
      and(
        eq(emailUnsubscribes.email, email),
        inArray(emailUnsubscribes.unsubscribeType, ["all", ctx.type]),
        ctx.storeId != null
          ? eq(emailUnsubscribes.storeId, ctx.storeId)
          : isNull(emailUnsubscribes.storeId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Record an unsubscribe. Idempotent — re-submitting the same token is a
 * no-op thanks to the unique (email, type, storeId) index.
 */
export async function recordUnsubscribe(
  db: DbHandle,
  ctx: UnsubscribeContext,
): Promise<void> {
  if (!db) throw new Error("Database unavailable");
  const email = ctx.email.trim().toLowerCase();
  try {
    await db.insert(emailUnsubscribes).values({
      email,
      storeId: ctx.storeId ?? null,
      unsubscribeType: ctx.type,
    });
    log.info(`Unsubscribe recorded: ${email} type=${ctx.type} storeId=${ctx.storeId ?? "null"}`);
  } catch (err: unknown) {
    // Unique-constraint collision means already unsubscribed — treat as success.
    const code = (err as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") {
      log.info(`Unsubscribe already on file: ${email} type=${ctx.type} storeId=${ctx.storeId ?? "null"}`);
      return;
    }
    throw err;
  }
}
