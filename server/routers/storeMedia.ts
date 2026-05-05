/**
 * storeMedia router — two-way file library shared between distributor
 * and POC, scoped per store.
 *
 *   list/upload  — accessible to both distributor and POC
 *   delete       — distributor: any file; POC: only their own uploads
 *
 * POC access is gated by a valid store session cookie (resolveStoreSession);
 * distributor access by a valid org-scoped tRPC ctx.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { stores, storeMediaFiles, storeUsers } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { resolveStoreSession } from "./storePortalAuth";
import { nanoid } from "nanoid";
import { getLogger } from "../utils/logger";

const log = getLogger("storeMedia");

async function verifyDistributorOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
  userId: number,
  organizationId: number | null,
) {
  const conds = organizationId != null
    ? and(eq(stores.id, storeId), eq(stores.organizationId, organizationId))
    : and(eq(stores.id, storeId), eq(stores.userId, userId));
  const [row] = await db.select({ id: stores.id }).from(stores).where(conds).limit(1);
  if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "Store not found or not authorized" });
}

const MAX_BYTES = 25 * 1024 * 1024; // 25MB hard cap to keep base64 payloads sane.

function buildStorageKey(storeId: number, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
  return `store-media/${storeId}/${nanoid(10)}-${safeName}`;
}

async function listForStore(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, storeId: number) {
  const files = await db
    .select()
    .from(storeMediaFiles)
    .where(eq(storeMediaFiles.storeId, storeId))
    .orderBy(desc(storeMediaFiles.createdAt));
  // Resolve POC uploader names so the UI can show "by Jane Doe" alongside files.
  const pocIds = Array.from(new Set(files.filter((f) => f.uploadedBy === "poc").map((f) => f.uploadedByUserId)));
  let nameById = new Map<number, string>();
  if (pocIds.length > 0) {
    const rows = await db.select({ id: storeUsers.id, name: storeUsers.name, email: storeUsers.email })
      .from(storeUsers);
    nameById = new Map(rows.filter((r) => pocIds.includes(r.id)).map((r) => [r.id, r.name || r.email]));
  }
  return files.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    fileUrl: f.fileUrl,
    fileType: f.fileType,
    fileSizeBytes: f.fileSizeBytes,
    description: f.description,
    uploadedBy: f.uploadedBy,
    uploadedByName: f.uploadedBy === "distributor" ? "Distributor" : (nameById.get(f.uploadedByUserId) ?? "Team Member"),
    uploadedByUserId: f.uploadedByUserId,
    createdAt: f.createdAt?.toISOString() ?? null,
  }));
}

const uploadInput = z.object({
  fileName: z.string().min(1).max(512),
  fileType: z.string().min(1).max(128),
  base64Data: z.string().min(1),
  description: z.string().max(2000).optional(),
});

export const storeMediaRouter = router({
  // ── Distributor surface (org-scoped tRPC user) ────────────────────────────
  list: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyDistributorOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);
      return listForStore(db, input.storeId);
    }),

  upload: protectedProcedure
    .input(z.object({ storeId: z.number() }).merge(uploadInput))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await verifyDistributorOwnership(db, input.storeId, ctx.user.id, ctx.organizationId);

      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.byteLength > MAX_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File exceeds the 25MB upload limit" });
      }
      const key = buildStorageKey(input.storeId, input.fileName);
      const { url } = await storagePut(key, buffer, input.fileType);

      await db.insert(storeMediaFiles).values({
        storeId: input.storeId,
        uploadedBy: "distributor",
        uploadedByUserId: ctx.user.id,
        fileName: input.fileName,
        fileUrl: url,
        fileType: input.fileType,
        fileSizeBytes: buffer.byteLength,
        description: input.description || null,
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select().from(storeMediaFiles).where(eq(storeMediaFiles.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      await verifyDistributorOwnership(db, row.storeId, ctx.user.id, ctx.organizationId);
      // Distributor can delete any file in their store.
      await db.delete(storeMediaFiles).where(eq(storeMediaFiles.id, input.id));
      return { success: true };
    }),

  // ── POC surface (gated by store session cookie) ───────────────────────────
  listPortal: publicProcedure
    .input(z.object({ storeSlug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { db, store } = await resolveStoreSession(ctx, input.storeSlug);
      return listForStore(db, store.id);
    }),

  uploadPortal: publicProcedure
    .input(z.object({ storeSlug: z.string().min(1) }).merge(uploadInput))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.byteLength > MAX_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File exceeds the 25MB upload limit" });
      }
      const key = buildStorageKey(store.id, input.fileName);
      const { url } = await storagePut(key, buffer, input.fileType);

      await db.insert(storeMediaFiles).values({
        storeId: store.id,
        uploadedBy: "poc",
        uploadedByUserId: storeUser.id,
        fileName: input.fileName,
        fileUrl: url,
        fileType: input.fileType,
        fileSizeBytes: buffer.byteLength,
        description: input.description || null,
      });
      log.info(`POC upload: store=${store.id} user=${storeUser.id} file=${input.fileName}`);
      return { success: true };
    }),

  deletePortal: publicProcedure
    .input(z.object({ storeSlug: z.string().min(1), id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { db, store, storeUser } = await resolveStoreSession(ctx, input.storeSlug);
      const [row] = await db.select().from(storeMediaFiles).where(eq(storeMediaFiles.id, input.id)).limit(1);
      if (!row || row.storeId !== store.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }
      // POC can only delete their own uploads.
      if (row.uploadedBy !== "poc" || row.uploadedByUserId !== storeUser.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete files you uploaded." });
      }
      await db.delete(storeMediaFiles).where(eq(storeMediaFiles.id, input.id));
      return { success: true };
    }),
});
