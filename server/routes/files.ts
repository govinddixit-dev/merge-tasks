/**
 * Authenticated File Serving — P0 Security Fix
 *
 * Replaces the public `express.static("/uploads")` middleware.
 * Every file request is authenticated and ownership-verified before serving.
 *
 * Ownership tables checked (in order):
 *   clientLogos    — organizationId must match
 *   clientAssets   — organizationId must match
 *   virtualProofs  — organizationId must match (logoUrl or proofImageUrl)
 *   distributorProfiles — userId must match (brandLogoUrl / brandLogoOriginalUrl)
 *   stores         — organizationId must match (logoUrl / bannerUrl)
 *
 * Public store branding (served to anonymous webstore visitors) is handled by
 * the separate GET /api/public-files/:key route below.
 */

import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";
import { eq, or } from "drizzle-orm";
import {
  clientLogos,
  clientAssets,
  virtualProofs,
  distributorProfiles,
  stores,
  organizations,
} from "../../drizzle/schema";
import { getLogger } from "../utils/logger";

const log = getLogger("files");
const router = Router();

function getUploadsDir(): string {
  return path.resolve(process.cwd(), "uploads");
}

/** Mirror of storagePut: convert a storage key to its flat filename on disk. */
function keyToFilename(key: string): string {
  return key.replace(/\//g, "_").replace(/^_+/, "");
}

/**
 * Check whether a given fileUrl is owned by the requesting user's org/userId.
 * Returns true if ownership is confirmed in any table.
 */
async function isFileOwned(
  fileUrl: string,
  orgId: number | null | undefined,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  if (orgId) {
    // clientLogos
    const logo = await db
      .select({ id: clientLogos.id })
      .from(clientLogos)
      .where(eq(clientLogos.logoUrl, fileUrl))
      .limit(1);
    if (logo.length > 0) {
      const owned = await db
        .select({ id: clientLogos.id })
        .from(clientLogos)
        .where(eq(clientLogos.organizationId, orgId))
        .limit(1);
      // Confirm the logo URL belongs to THIS org
      const exact = await db
        .select({ id: clientLogos.id })
        .from(clientLogos)
        .where(eq(clientLogos.logoUrl, fileUrl))
        .limit(1);
      // Re-check with both conditions
      const [match] = await db
        .select({ orgId: clientLogos.organizationId })
        .from(clientLogos)
        .where(eq(clientLogos.logoUrl, fileUrl))
        .limit(1);
      if (match && match.orgId === orgId) return true;
    }

    // clientAssets
    const [asset] = await db
      .select({ orgId: clientAssets.organizationId })
      .from(clientAssets)
      .where(eq(clientAssets.fileUrl, fileUrl))
      .limit(1);
    if (asset && asset.orgId === orgId) return true;

    // virtualProofs
    const [proof] = await db
      .select({ orgId: virtualProofs.organizationId })
      .from(virtualProofs)
      .where(or(eq(virtualProofs.logoUrl, fileUrl), eq(virtualProofs.proofImageUrl, fileUrl)))
      .limit(1);
    if (proof && proof.orgId === orgId) return true;

    // stores
    const [store] = await db
      .select({ orgId: stores.organizationId })
      .from(stores)
      .where(or(eq(stores.logoUrl, fileUrl), eq(stores.bannerUrl!, fileUrl)))
      .limit(1);
    if (store && store.orgId === orgId) return true;
  }

  // distributorProfiles — owned by userId (not orgId)
  const [profile] = await db
    .select({ uid: distributorProfiles.userId })
    .from(distributorProfiles)
    .where(
      or(
        eq(distributorProfiles.brandLogoUrl, fileUrl),
        eq(distributorProfiles.brandLogoOriginalUrl, fileUrl)
      )
    )
    .limit(1);
  if (profile && profile.uid === userId) return true;

  return false;
}

// ── Authenticated file serving ──────────────────────────────────────────────

router.get("/:key(*)", async (req: Request, res: Response) => {
  try {
    const user = await sdk.authenticateRequest(req, res);
    const userId = user.id;
    // Derive organizationId from DB — same logic as tRPC context
    let orgId: number | null = null;
    try {
      const fileDb = await getDb();
      if (fileDb) {
        const [ownOrg] = await fileDb
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.ownerId, userId))
          .limit(1);
        if (ownOrg) orgId = ownOrg.id;
      }
    } catch { /* non-fatal — orgId stays null, falls back to userId scope */ }

    const key = req.params.key;
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Invalid file key" });
    }

    const filename = keyToFilename(key);
    const filePath = path.join(getUploadsDir(), filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const fileUrl = `/uploads/${filename}`;
    const owned = await isFileOwned(fileUrl, orgId, userId);

    if (!owned) {
      log.warn(`Unauthorized file access: user=${userId} org=${orgId} file=${filename}`);
      return res.status(403).json({ error: "Access denied" });
    }

    res.sendFile(filePath);
  } catch (err: unknown) {
    const isAuthError =
      (err instanceof Error && err.message?.includes("session")) ||
      (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "FORBIDDEN");
    if (isAuthError) {
      return res.status(401).json({ error: "Authentication required" });
    }
    log.error("File serving error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Public store branding (anonymous webstore visitors) ─────────────────────

router.get("/public/:key(*)", async (req: Request, res: Response) => {
  try {
    const key = req.params.key;
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Invalid file key" });
    }

    const filename = keyToFilename(key);
    const filePath = path.join(getUploadsDir(), filename);
    const fileUrl = `/uploads/${filename}`;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database unavailable" });
    // Only serve files that are store branding (public by design)
    const [match] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(or(eq(stores.logoUrl, fileUrl), eq(stores.bannerUrl!, fileUrl)))
      .limit(1);
    if (!match) {
      return res.status(403).json({ error: "File is not publicly accessible" });
    }

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(filePath);
  } catch (err) {
    log.error("Public file serving error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
