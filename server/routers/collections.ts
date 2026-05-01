import { z } from "zod";
import { eq, and, desc, sql, count as drizzleCount } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { productCollections, collectionProducts, products } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const collectionsRouter = router({
  /** List all collections for the current org, with product counts */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const scope = getOrgScope(ctx);

    const rows = await db
      .select({
        id: productCollections.id,
        name: productCollections.name,
        description: productCollections.description,
        color: productCollections.color,
        createdAt: productCollections.createdAt,
        updatedAt: productCollections.updatedAt,
        productCount: sql<number>`(SELECT COUNT(*) FROM collectionProducts WHERE collectionProducts.collectionId = ${productCollections.id})`,
      })
      .from(productCollections)
      .where(scope.productCollections)
      .orderBy(desc(productCollections.updatedAt));

    // For each collection, fetch up to 4 product names for preview chips
    const result = await Promise.all(
      rows.map(async (row) => {
        const preview = await db
          .select({ name: products.name })
          .from(collectionProducts)
          .innerJoin(products, eq(collectionProducts.productId, products.id))
          .where(eq(collectionProducts.collectionId, row.id))
          .limit(4);
        return {
          ...row,
          previewItems: preview.map((p) => p.name),
        };
      })
    );

    return result;
  }),

  /** Create a new collection */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const [inserted] = await db.insert(productCollections).values({
        ...scope.stamp,
        name: input.name,
        description: input.description || null,
        color: input.color || "#654BF9",
      });

      return { id: inserted.insertId, name: input.name };
    }),

  /** Rename / update a collection */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(productCollections)
        .where(and(eq(productCollections.id, input.id), scope.productCollections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });

      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.color !== undefined) updates.color = input.color;

      if (Object.keys(updates).length > 0) {
        await db
          .update(productCollections)
          .set(updates)
          .where(and(eq(productCollections.id, input.id), scope.productCollections));
      }

      return { success: true };
    }),

  /** Delete a collection (products are NOT deleted, just unlinked) */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(productCollections)
        .where(and(eq(productCollections.id, input.id), scope.productCollections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });

      await db.delete(productCollections).where(and(eq(productCollections.id, input.id), scope.productCollections));
      return { success: true };
    }),

  /** Add products to a collection */
  addProducts: protectedProcedure
    .input(
      z.object({
        collectionId: z.number(),
        productIds: z.array(z.number()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify collection belongs to this org
      const existing = await db
        .select()
        .from(productCollections)
        .where(and(eq(productCollections.id, input.collectionId), scope.productCollections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });

      // Insert, ignoring duplicates
      for (const productId of input.productIds) {
        try {
          await db.insert(collectionProducts).values({
            collectionId: input.collectionId,
            productId,
          });
        } catch {
          // Duplicate — ignore
        }
      }

      return { success: true, added: input.productIds.length };
    }),

  /** Remove a product from a collection */
  removeProduct: protectedProcedure
    .input(
      z.object({
        collectionId: z.number(),
        productId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .delete(collectionProducts)
        .where(
          and(
            eq(collectionProducts.collectionId, input.collectionId),
            eq(collectionProducts.productId, input.productId)
          )
        );

      return { success: true };
    }),
});
