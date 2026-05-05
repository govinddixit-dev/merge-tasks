/**
 * Store Portal Auth — shared session verification for all POC-authenticated sub-routers.
 *
 * Extracted from storePortal.ts so every sub-router can import `resolveStoreSession`
 * without duplicating JWT/cookie logic.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { stores, storeUsers, clients } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "../_core/env";

// ── Constants ──────────────────────────────────────────────────────────

export const STORE_COOKIE_PREFIX = "mt_store_";

// ── Shared Zod input — every portal procedure requires storeSlug ──────

export const storeSlugInput = z.object({ storeSlug: z.string().min(1) });

// ── JWT helpers ────────────────────────────────────────────────────────

function getStoreSecret() {
  return new TextEncoder().encode(ENV.cookieSecret + "_store");
}

async function verifyStoreSessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getStoreSecret());
    return payload as { storeId: number; storeUserId: number; email: string; role: string };
  } catch {
    return null;
  }
}

// ── Session resolver ───────────────────────────────────────────────────

/**
 * Middleware-like helper: extract and verify the store session from the request.
 * Returns the DB handle, store, storeUser, and client context.
 *
 * Every storePortal sub-router calls this as its first line.
 */
// Express request type varies across tRPC/Express integration layers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveStoreSession(ctx: { req: any }, storeSlug: string) {
  const cookieName = STORE_COOKIE_PREFIX + storeSlug;
  const cookieHeader = ctx.req.headers?.cookie || "";
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[cookieName];

  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in to your store portal" });
  }

  const payload = await verifyStoreSessionToken(token);
  if (!payload) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired. Please log in again." });
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  // Load store
  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.slug, storeSlug), eq(stores.id, payload.storeId)))
    .limit(1);

  if (!store) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }

  // Load store user — verify storeUser belongs to THIS store (CR9 fix)
  const [storeUser] = await db
    .select()
    .from(storeUsers)
    .where(and(eq(storeUsers.id, payload.storeUserId), eq(storeUsers.storeId, store.id)))
    .limit(1);

  if (!storeUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
  }

  // Load client
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, store.clientId))
    .limit(1);

  return { db, store, storeUser, client: client || null };
}

/**
 * Non-throwing variant of resolveStoreSession — returns null when no session
 * is present or the token is invalid. Used by public procedures that want to
 * optionally personalize the response without forcing authentication.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tryResolveStoreSession(ctx: { req: any }, storeSlug: string): Promise<
  { storeUserId: number; locationId: number | null } | null
> {
  try {
    const cookieName = STORE_COOKIE_PREFIX + storeSlug;
    const cookieHeader = ctx.req?.headers?.cookie || "";
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[cookieName];
    if (!token) return null;

    const payload = await verifyStoreSessionToken(token);
    if (!payload) return null;

    const db = await getDb();
    if (!db) return null;

    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.slug, storeSlug), eq(stores.id, payload.storeId)))
      .limit(1);
    if (!store) return null;

    const [storeUser] = await db
      .select({ id: storeUsers.id, locationId: storeUsers.locationId })
      .from(storeUsers)
      .where(and(eq(storeUsers.id, payload.storeUserId), eq(storeUsers.storeId, store.id)))
      .limit(1);
    if (!storeUser) return null;

    return { storeUserId: storeUser.id, locationId: storeUser.locationId ?? null };
  } catch {
    return null;
  }
}
