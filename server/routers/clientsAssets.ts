/**
 * clientsAssets.ts — Client Asset Management Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedures: listAssets, uploadAsset, deleteAsset
 *
 * CRUD procedures (list, getById, stats, create, update, delete) live in clientsCrud.ts.
 * Both routers are merged in clients.ts which is the public API entry point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  clients,
  clientAssets,
  type InsertClientAsset,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { storagePut } from "../storage";
import { getOrgScope } from "../utils/orgScope";

export const clientsAssetsRouter = router({
  /**
   * List all assets for a client, optionally filtered by category.
   */
  listAssets: protectedProcedure
    .input(
      z.object({
        clientId: z.number(),
        category: z
          .enum(["logo", "brand_guide", "artwork", "document", "photo", "other"])
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(clientAssets)
        .where(and(eq(clientAssets.clientId, input.clientId), scope.clientAssets))
        .orderBy(desc(clientAssets.createdAt));

      if (input.category) {
        return rows.filter((r) => r.category === input.category);
      }
      return rows;
    }),

  /**
   * Upload a new asset for a client (base64-encoded file data).
   * Writes to the configured storage backend (local disk or S3).
   */
  uploadAsset: protectedProcedure
    .input(
      z.object({
        clientId: z.number(),
        fileName: z.string(),
        fileData: z.string(), // base64
        fileType: z.string().optional(),
        fileSize: z.number().optional(),
        category: z
          .enum(["logo", "brand_guide", "artwork", "document", "photo", "other"])
          .optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify client ownership before storing the file
      const clientRows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), scope.clients))
        .limit(1);
      if (clientRows.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop()?.toLowerCase() || "bin";
      const key = `client-assets/${ctx.user.id}/${input.clientId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      const { url } = await storagePut(key, buffer, input.fileType || "application/octet-stream");

      const values: InsertClientAsset = {
        ...scope.stamp,
        clientId: input.clientId,
        fileUrl: url,
        fileName: input.fileName,
        fileType: input.fileType || null,
        fileSize: input.fileSize ?? buffer.length,
        category: input.category || "other",
        description: input.description || null,
      };

      const result = await db.insert(clientAssets).values(values);
      const insertId = result[0].insertId;
      const created = await db
        .select()
        .from(clientAssets)
        .where(eq(clientAssets.id, insertId))
        .limit(1);
      return created[0];
    }),

  /**
   * Delete an asset by ID. Ownership is verified before deletion.
   * Note: the file is NOT removed from storage (S3/disk) — add a storage cleanup
   * job if you need hard deletes from the storage backend.
   */
  deleteAsset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(clientAssets)
        .where(and(eq(clientAssets.id, input.id), scope.clientAssets))
        .limit(1);
      if (existing.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });

      await db.delete(clientAssets).where(eq(clientAssets.id, input.id));
      return { success: true };
    }),
});
