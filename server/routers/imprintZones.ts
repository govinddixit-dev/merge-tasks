/**
 * imprintZones.ts — Master-product Imprint Zone Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints for configuring decoration zones on master products. Zones are
 * the per-product rectangles where client logos can be placed; each zone
 * carries an allowlist of valid decoration methods.
 *
 * Endpoints:
 *   - listPresets       (public)    — catalog of seeded zones (Full Front,
 *                                     Left Chest, Cap Front, etc.)
 *   - listForProduct    (protected) — zones for one master product, each
 *                                     with its linked decoration methods
 *   - upsert            (protected) — batch save zones for one product;
 *                                     zones not in the payload are deleted
 *   - delete            (protected) — hard delete a single zone
 *
 * Decimal x/y/w/h values are stored as DECIMAL(5,2) — we coerce to Number
 * on the way out so clients receive ergonomic numeric coordinates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getOrgScope } from "../utils/orgScope";
import {
  imprintZonePresets,
  productImprintZones,
  productImprintZoneDecorations,
  decorationMethods,
  products,
} from "../../drizzle/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a DECIMAL string ("14.00") to a number, or 0 if null. */
const toNum = (v: string | null | undefined): number => (v == null ? 0 : Number(v));

/** Coerce a number to a string with 2-decimal precision for DECIMAL columns. */
const toDec = (n: number): string => n.toFixed(2);

const zonePercent = z.number().min(0).max(100);

const upsertZoneSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  x: zonePercent,
  y: zonePercent,
  w: zonePercent,
  h: zonePercent,
  sortOrder: z.number().int().nonnegative().default(0),
  decorationMethodIds: z.array(z.number().int().positive()).default([]),
  isDefault: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const imprintZonesRouter = router({

  /**
   * List all active imprint zone presets, grouped by category.
   * Public — used to seed the "Add from Preset" picker in the editor.
   */
  listPresets: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const rows = await db
      .select()
      .from(imprintZonePresets)
      .where(eq(imprintZonePresets.isActive, true))
      .orderBy(asc(imprintZonePresets.sortOrder));

    const grouped: Record<string, Array<{
      id: number;
      label: string;
      slug: string;
      category: string | null;
      x: number; y: number; w: number; h: number;
      sortOrder: number;
    }>> = {};

    for (const r of rows) {
      const key = r.category ?? "other";
      (grouped[key] ||= []).push({
        id: r.id,
        label: r.label,
        slug: r.slug,
        category: r.category,
        x: toNum(r.x),
        y: toNum(r.y),
        w: toNum(r.w),
        h: toNum(r.h),
        sortOrder: r.sortOrder,
      });
    }

    return grouped;
  }),

  /**
   * Public variant of listForProduct — used by the webstore PDP to drive
   * the buyer-facing zone/decoration selector. No auth: webstores are
   * public-read for catalog data, and zone definitions are not sensitive.
   * Returns zones with embedded decoration rows (method name + slug +
   * isDefault) so the client can render chips without a second query.
   */
  listForProductPublic: publicProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const zones = await db
        .select()
        .from(productImprintZones)
        .where(and(
          eq(productImprintZones.productId, input.productId),
          eq(productImprintZones.isActive, true),
        ))
        .orderBy(productImprintZones.sortOrder);

      return await Promise.all(zones.map(async (zone) => {
        const decorations = await db
          .select({
            decorationMethodId: productImprintZoneDecorations.decorationMethodId,
            isDefault: productImprintZoneDecorations.isDefault,
            name: decorationMethods.name,
            slug: decorationMethods.slug,
          })
          .from(productImprintZoneDecorations)
          .leftJoin(decorationMethods, eq(decorationMethods.id, productImprintZoneDecorations.decorationMethodId))
          .where(eq(productImprintZoneDecorations.imprintZoneId, zone.id));
        return { ...zone, decorations };
      }));
    }),

  /**
   * List all zones for a master product, each with its linked decoration
   * method IDs. Org-scoped via the parent product.
   */
  listForProduct: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Org-scope check — verify the caller can see this product at all.
      const [owner] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), scope.products))
        .limit(1);
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const zoneRows = await db
        .select()
        .from(productImprintZones)
        .where(and(
          eq(productImprintZones.productId, input.productId),
          eq(productImprintZones.isActive, true),
        ))
        .orderBy(asc(productImprintZones.sortOrder), asc(productImprintZones.id));

      if (zoneRows.length === 0) return [];

      const zoneIds = zoneRows.map(z => z.id);
      const decoRows = await db
        .select()
        .from(productImprintZoneDecorations)
        .where(inArray(productImprintZoneDecorations.imprintZoneId, zoneIds));

      const decoByZone = new Map<number, number[]>();
      for (const d of decoRows) {
        const list = decoByZone.get(d.imprintZoneId) ?? [];
        list.push(d.decorationMethodId);
        decoByZone.set(d.imprintZoneId, list);
      }

      return zoneRows.map(z => ({
        id: z.id,
        productId: z.productId,
        label: z.label,
        slug: z.slug,
        x: toNum(z.x),
        y: toNum(z.y),
        w: toNum(z.w),
        h: toNum(z.h),
        sortOrder: z.sortOrder,
        isDefault: z.isDefault,
        decorationMethodIds: decoByZone.get(z.id) ?? [],
      }));
    }),

  /**
   * Batch upsert zones for a product. Zones in the payload are created or
   * updated; existing zones whose ids are not in the payload are deleted
   * (cascade deletes their productImprintZoneDecorations rows).
   *
   * For each zone, decorationMethodIds replaces the set of valid decoration
   * methods (delete-all + reinsert).
   */
  upsert: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      zones: z.array(upsertZoneSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Verify product ownership before any writes.
      const [owner] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), scope.products))
        .limit(1);
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      // If the payload marks multiple zones as default, only the first wins —
      // the one-default-per-product invariant is enforced below.
      const defaultIdx = input.zones.findIndex(z => z.isDefault === true);

      await db.transaction(async (tx) => {
        // ── Delete zones not in payload ──────────────────────────────────
        const keepZoneIds = input.zones
          .map(z => z.id)
          .filter((v): v is number => v != null);
        if (keepZoneIds.length > 0) {
          await tx.delete(productImprintZones).where(and(
            eq(productImprintZones.productId, input.productId),
            notInArray(productImprintZones.id, keepZoneIds),
          ));
        } else {
          await tx.delete(productImprintZones).where(
            eq(productImprintZones.productId, input.productId),
          );
        }

        // ── Clear all defaults for this product first ────────────────────
        // Enforces one-default-per-product: any existing default is cleared,
        // then we set exactly one (or none) below. Safe even when no zone
        // claims isDefault — the product will simply have no default.
        await tx.update(productImprintZones)
          .set({ isDefault: false })
          .where(eq(productImprintZones.productId, input.productId));

        // ── Upsert zones ─────────────────────────────────────────────────
        for (let i = 0; i < input.zones.length; i++) {
          const z = input.zones[i];
          const shouldBeDefault = i === defaultIdx;
          let zoneId: number;

          if (z.id != null) {
            await tx.update(productImprintZones).set({
              label: z.label,
              slug: z.slug,
              x: toDec(z.x),
              y: toDec(z.y),
              w: toDec(z.w),
              h: toDec(z.h),
              sortOrder: z.sortOrder,
              isDefault: shouldBeDefault,
            }).where(and(
              eq(productImprintZones.id, z.id),
              eq(productImprintZones.productId, input.productId),
            ));
            zoneId = z.id;
          } else {
            const [created] = await tx.insert(productImprintZones).values({
              productId: input.productId,
              label: z.label,
              slug: z.slug,
              x: toDec(z.x),
              y: toDec(z.y),
              w: toDec(z.w),
              h: toDec(z.h),
              sortOrder: z.sortOrder,
              isDefault: shouldBeDefault,
            }).$returningId();
            zoneId = created.id;
          }

          // ── Replace decoration method links ────────────────────────────
          await tx.delete(productImprintZoneDecorations).where(
            eq(productImprintZoneDecorations.imprintZoneId, zoneId),
          );
          if (z.decorationMethodIds.length > 0) {
            await tx.insert(productImprintZoneDecorations).values(
              z.decorationMethodIds.map(methodId => ({
                imprintZoneId: zoneId,
                decorationMethodId: methodId,
              })),
            );
          }
        }
      });

      return { success: true };
    }),

  /**
   * Hard delete a zone. Cascades to productImprintZoneDecorations via FK.
   */
  delete: protectedProcedure
    .input(z.object({ zoneId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      // Load zone → verify the owning product is in the caller's org.
      const [zone] = await db
        .select({ productId: productImprintZones.productId })
        .from(productImprintZones)
        .where(eq(productImprintZones.id, input.zoneId))
        .limit(1);
      if (!zone) throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });

      const [owner] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, zone.productId), scope.products))
        .limit(1);
      if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed" });

      await db.delete(productImprintZones).where(eq(productImprintZones.id, input.zoneId));
      return { success: true };
    }),
});
