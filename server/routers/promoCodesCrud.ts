/**
 * promoCodesCrud.ts — Distributor-facing CRUD for promo codes.
 *
 * Procedures: list, create, update, delete (soft), getUsageStats.
 */
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { promoCodes, promoCodeUsages, stores, storeUsers } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const promoCodesCrudRouter = router({
  list: protectedProcedure
    .input(z.object({
      storeId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify the store belongs to this user
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const rows = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.storeId, input.storeId))
        .orderBy(desc(promoCodes.createdAt));

      return rows.map(r => ({
        id: r.id,
        code: r.code,
        description: r.description,
        discountType: r.discountType,
        discountValue: r.discountValue,
        minOrderAmount: r.minOrderAmount,
        maxDiscountAmount: r.maxDiscountAmount,
        maxUses: r.maxUses,
        usedCount: r.usedCount,
        maxUsesPerUser: r.maxUsesPerUser,
        startsAt: r.startsAt?.toISOString() ?? null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        isActive: r.isActive,
        createdAt: r.createdAt?.toISOString() ?? null,
      }));
    }),

  create: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      code: z.string().min(1).max(64),
      description: z.string().max(255).optional(),
      discountType: z.enum(["percentage", "fixed_amount"]),
      discountValue: z.string(),
      minOrderAmount: z.string().optional(),
      maxDiscountAmount: z.string().optional(),
      maxUses: z.number().int().min(1).optional(),
      maxUsesPerUser: z.number().int().min(1).optional().default(1),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify store ownership
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Check for duplicate code
      const normalizedCode = input.code.toUpperCase().trim();
      const [existing] = await db.select().from(promoCodes)
        .where(and(
          eq(promoCodes.storeId, input.storeId),
          eq(promoCodes.code, normalizedCode),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A promo code with this name already exists." });
      }

      const result = await db.insert(promoCodes).values({
        storeId: input.storeId,
        organizationId: store.organizationId ?? null,
        code: normalizedCode,
        description: input.description ?? null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minOrderAmount: input.minOrderAmount ?? null,
        maxDiscountAmount: input.maxDiscountAmount ?? null,
        maxUses: input.maxUses ?? null,
        maxUsesPerUser: input.maxUsesPerUser ?? 1,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        isActive: true,
      });

      return { id: result[0].insertId, code: normalizedCode };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      storeId: z.number(),
      description: z.string().max(255).optional(),
      discountValue: z.string().optional(),
      minOrderAmount: z.string().optional().nullable(),
      maxDiscountAmount: z.string().optional().nullable(),
      maxUses: z.number().int().min(1).optional().nullable(),
      maxUsesPerUser: z.number().int().min(1).optional().nullable(),
      startsAt: z.string().optional().nullable(),
      expiresAt: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify store ownership
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const [existing] = await db.select().from(promoCodes)
        .where(and(
          eq(promoCodes.id, input.id),
          eq(promoCodes.storeId, input.storeId),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Promo code not found." });
      }

      const setObj: Record<string, unknown> = {};
      if (input.description !== undefined) setObj.description = input.description;
      if (input.discountValue !== undefined) setObj.discountValue = input.discountValue;
      if (input.minOrderAmount !== undefined) setObj.minOrderAmount = input.minOrderAmount;
      if (input.maxDiscountAmount !== undefined) setObj.maxDiscountAmount = input.maxDiscountAmount;
      if (input.maxUses !== undefined) setObj.maxUses = input.maxUses;
      if (input.maxUsesPerUser !== undefined) setObj.maxUsesPerUser = input.maxUsesPerUser;
      if (input.startsAt !== undefined) setObj.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.expiresAt !== undefined) setObj.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (input.isActive !== undefined) setObj.isActive = input.isActive;

      if (Object.keys(setObj).length > 0) {
        await db.update(promoCodes).set(setObj).where(eq(promoCodes.id, input.id));
      }

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      storeId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify store ownership
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Soft delete: set isActive = false
      await db.update(promoCodes)
        .set({ isActive: false })
        .where(and(
          eq(promoCodes.id, input.id),
          eq(promoCodes.storeId, input.storeId),
        ));

      return { success: true };
    }),

  getUsageStats: protectedProcedure
    .input(z.object({
      promoCodeId: z.number(),
      storeId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify store ownership
      const [store] = await db.select().from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      const usages = await db
        .select({
          id: promoCodeUsages.id,
          storeUserId: promoCodeUsages.storeUserId,
          orderId: promoCodeUsages.orderId,
          discountApplied: promoCodeUsages.discountApplied,
          createdAt: promoCodeUsages.createdAt,
          userName: storeUsers.name,
          userEmail: storeUsers.email,
        })
        .from(promoCodeUsages)
        .leftJoin(storeUsers, eq(storeUsers.id, promoCodeUsages.storeUserId))
        .where(eq(promoCodeUsages.promoCodeId, input.promoCodeId))
        .orderBy(desc(promoCodeUsages.createdAt));

      const [totalDiscount] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${promoCodeUsages.discountApplied}), '0.00')`,
        })
        .from(promoCodeUsages)
        .where(eq(promoCodeUsages.promoCodeId, input.promoCodeId));

      return {
        usages: usages.map(u => ({
          id: u.id,
          userName: u.userName ?? u.userEmail ?? "Unknown",
          orderId: u.orderId,
          discountApplied: u.discountApplied,
          createdAt: u.createdAt?.toISOString() ?? null,
        })),
        totalDiscount: totalDiscount?.total ?? "0.00",
        totalUsages: usages.length,
      };
    }),
});
