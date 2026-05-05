/**
 * renderManager.ts — Phase 7 distributor-facing render approval gate.
 *
 * Procedures:
 *   listByStore           — Render Manager grid feed (with status filter)
 *   approve               — flip a single binding from Pending Review → Approved
 *   bulkApprove           — approve every Pending Review binding for a store
 *   reRender              — reset state + enqueue, optionally with prompt tweak
 *   bulkReRenderFailed    — re-enqueue every failed binding for a store
 *   uploadOverride        — distributor uploads a manual photo, auto-approves
 *   removeOverride        — clears the override; reverts to the AI render
 *
 * Org-scoping pattern: every procedure resolves the storeProduct → store and
 * verifies (stores.organizationId === ctx.organizationId) for org members,
 * or (stores.userId === ctx.user.id) for solo (no-org) distributors. Same
 * cascade as storeDepartmentBudgets.ts. NEVER trust an inbound storeId or
 * storeProductId without re-deriving ownership from the DB.
 *
 * Hot-path note: this router runs in the main mergetasks server. Render
 * job persistence happens out-of-band in the worker (separate pm2 process).
 * Mutations enqueue or update rows; they do not block on render completion.
 */

import { z } from "zod";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { products, stores, storeProducts } from "../../drizzle/schema";
import { enqueueRenderForStoreProduct } from "../services/webstore-render-orchestrator";
import { storagePut } from "../storage";
import { getLogger } from "../utils/logger";

const log = getLogger("renderManager");

/** Status filter for the listByStore query. "all" means no status filter. */
const StatusFilter = z.enum([
  "all",
  "pending_review",
  "approved",
  "rendering",
  "failed",
  "no_render",
]);

/**
 * Resolve & ownership-verify a store. Throws NOT_FOUND on missing or
 * cross-tenant access — the same response either way so we don't leak
 * existence to a non-owner.
 */
async function assertStoreOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeId: number,
  ctx: { user: { id: number }; organizationId: number | null },
): Promise<void> {
  const { organizationId, user } = ctx;
  const conds: SQL[] = [eq(stores.id, storeId)];
  if (organizationId != null) {
    conds.push(eq(stores.organizationId, organizationId));
  } else {
    conds.push(eq(stores.userId, user.id));
  }
  const [row] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(...conds))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
}

/**
 * Resolve a storeProduct, ownership-check via its store, and return both
 * the binding and store id. Single round-trip via inner join.
 */
async function resolveOwnedStoreProduct(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  storeProductId: number,
  ctx: { user: { id: number }; organizationId: number | null },
): Promise<{ storeId: number; productId: number }> {
  const { organizationId, user } = ctx;
  const conds: SQL[] = [eq(storeProducts.id, storeProductId)];
  if (organizationId != null) {
    conds.push(eq(stores.organizationId, organizationId));
  } else {
    conds.push(eq(stores.userId, user.id));
  }
  const [row] = await db
    .select({
      storeId: storeProducts.storeId,
      productId: storeProducts.productId,
    })
    .from(storeProducts)
    .innerJoin(stores, eq(stores.id, storeProducts.storeId))
    .where(and(...conds))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store product not found" });
  }
  return row;
}

export const renderManagerRouter = router({
  /**
   * Distributor grid feed. Returns every storeProducts row for a store,
   * joined to product metadata, with raw render fields exposed so the UI
   * can render status badges. Unlike the customer-facing storesCrud query,
   * this is NOT gated by renderApproved — distributors must see the
   * pending queue to do their job.
   */
  listByStore: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        status: StatusFilter.default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertStoreOwnership(db, input.storeId, ctx);

      const rows = await db
        .select({
          storeProductId: storeProducts.id,
          productId: products.id,
          productName: products.name,
          productSku: products.sku,
          productImageUrl: products.imageUrl,
          renderUrl: storeProducts.webstoreRenderedImageUrl,
          renderStatus: storeProducts.webstoreRenderStatus,
          renderedAt: storeProducts.webstoreRenderedAt,
          renderApproved: storeProducts.renderApproved,
          renderApprovedAt: storeProducts.renderApprovedAt,
          renderApprovedBy: storeProducts.renderApprovedBy,
          renderOverrideUrl: storeProducts.renderOverrideUrl,
          renderPromptAdjustment: storeProducts.renderPromptAdjustment,
          // Phase 7+ visual placement editor coords. Decimal columns come
          // back as strings from drizzle/mysql2 — coerce on the client.
          renderPlacementX:        storeProducts.renderPlacementX,
          renderPlacementY:        storeProducts.renderPlacementY,
          renderPlacementWidth:    storeProducts.renderPlacementWidth,
          renderPlacementHeight:   storeProducts.renderPlacementHeight,
          renderPlacementRotation: storeProducts.renderPlacementRotation,
          // Store logo for the placement editor canvas overlay.
          storeLogoUrl: stores.logoUrl,
        })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .innerJoin(stores, eq(stores.id, storeProducts.storeId))
        .where(eq(storeProducts.storeId, input.storeId));

      // Status filter applied in JS — the derived "pending_review" /
      // "no_render" buckets aren't first-class enum values, so a SQL
      // WHERE would have to replicate the same boolean math. List sizes
      // are bounded by per-store catalog (low hundreds at most), so the
      // in-memory filter is fine and keeps the query simple.
      type Row = (typeof rows)[number];
      const matches = (r: Row): boolean => {
        switch (input.status) {
          case "all":
            return true;
          case "approved":
            return r.renderApproved === true;
          case "pending_review":
            return r.renderStatus === "complete" && r.renderApproved === false;
          case "rendering":
            return r.renderStatus === "rendering";
          case "failed":
            return r.renderStatus === "failed";
          case "no_render":
            return (
              (r.renderStatus === "pending" || r.renderStatus === null) &&
              r.renderUrl === null &&
              r.renderOverrideUrl === null
            );
        }
      };
      const filtered = rows.filter(matches);

      // Default sort: Pending Review first (these need attention), then
      // Failed, then Approved, then everything else. Stable order within
      // a bucket by storeProductId so the UI doesn't reshuffle on refetch.
      const bucket = (r: Row): number => {
        if (r.renderStatus === "complete" && r.renderApproved === false) return 0;
        if (r.renderStatus === "failed") return 1;
        if (r.renderApproved === true) return 2;
        if (r.renderStatus === "rendering") return 3;
        return 4;
      };
      filtered.sort((a, b) => bucket(a) - bucket(b) || a.storeProductId - b.storeProductId);

      return filtered;
    }),

  /**
   * Approve a single binding's render. Idempotent — re-approving an
   * already-approved row simply refreshes the timestamp and approver.
   */
  approve: protectedProcedure
    .input(z.object({ storeProductId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await resolveOwnedStoreProduct(db, input.storeProductId, ctx);

      await db
        .update(storeProducts)
        .set({
          renderApproved: true,
          renderApprovedAt: new Date(),
          renderApprovedBy: ctx.user.id,
        })
        .where(eq(storeProducts.id, input.storeProductId));

      return { success: true } as const;
    }),

  /**
   * Approve every Pending Review binding for a store in one shot. Only
   * touches rows where webstoreRenderStatus='complete' AND
   * renderApproved=false — won't accidentally re-approve an already-
   * approved row or a non-rendered/failed one.
   */
  bulkApprove: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertStoreOwnership(db, input.storeId, ctx);

      const result = await db
        .update(storeProducts)
        .set({
          renderApproved: true,
          renderApprovedAt: new Date(),
          renderApprovedBy: ctx.user.id,
        })
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          eq(storeProducts.webstoreRenderStatus, "complete"),
          eq(storeProducts.renderApproved, false),
        ));
      const approved =
        (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;

      log.info(`bulkApprove storeId=${input.storeId} approved=${approved}`);
      return { approved } as const;
    }),

  /**
   * Re-render a single binding. Persists the optional prompt adjustment
   * (so subsequent re-renders inherit the distributor's preference for
   * this binding) and resets render+approval state, then enqueues with
   * { force: true } to bypass BullMQ's jobId dedup.
   */
  reRender: protectedProcedure
    .input(
      z.object({
        storeProductId: z.number(),
        promptAdjustment: z.string().max(500).optional(),
        /**
         * Placement editor "Save as Photorealistic Render" path. When
         * true, the worker auto-approves on success (renderApproved=true,
         * approvedBy=ctx.user.id) so the distributor doesn't have to
         * round-trip through the approve button.
         */
        autoApprove: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { storeId, productId } = await resolveOwnedStoreProduct(db, input.storeProductId, ctx);

      // Persist the adjustment if explicitly provided; an empty string
      // clears it (distributor wants to drop a prior preference). The
      // `undefined` case leaves the column untouched.
      const adjustmentUpdate: Partial<typeof storeProducts.$inferInsert> = {};
      if (input.promptAdjustment !== undefined) {
        adjustmentUpdate.renderPromptAdjustment =
          input.promptAdjustment.trim().length > 0 ? input.promptAdjustment.trim() : null;
      }

      await db
        .update(storeProducts)
        .set({
          ...adjustmentUpdate,
          webstoreRenderStatus: "pending",
          renderApproved: false,
          renderApprovedAt: null,
          renderApprovedBy: null,
        })
        .where(eq(storeProducts.id, input.storeProductId));

      const result = await enqueueRenderForStoreProduct(db, storeId, productId, {
        force: true,
        autoApprove: input.autoApprove ? { approvedBy: ctx.user.id } : undefined,
      });
      log.info(
        `reRender storeProductId=${input.storeProductId} (storeId=${storeId}, productId=${productId}) autoApprove=${!!input.autoApprove} → ${result.kind}${result.kind === "skipped" ? `:${result.reason}` : ""}`,
      );
      return result;
    }),

  /**
   * Re-enqueue every failed binding for a store. Resets state on each
   * row so the worker doesn't see stale 'failed' rows post-enqueue. Force
   * mode on the enqueue bypasses dedup.
   */
  bulkReRenderFailed: protectedProcedure
    .input(z.object({ storeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertStoreOwnership(db, input.storeId, ctx);

      const failedRows = await db
        .select({ id: storeProducts.id, productId: storeProducts.productId })
        .from(storeProducts)
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          eq(storeProducts.webstoreRenderStatus, "failed"),
        ));
      if (failedRows.length === 0) return { enqueued: 0 } as const;

      await db
        .update(storeProducts)
        .set({
          webstoreRenderStatus: "pending",
          renderApproved: false,
          renderApprovedAt: null,
          renderApprovedBy: null,
        })
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          inArray(storeProducts.id, failedRows.map(r => r.id)),
        ));

      let enqueued = 0;
      for (const row of failedRows) {
        const result = await enqueueRenderForStoreProduct(db, input.storeId, row.productId, {
          force: true,
        });
        if (result.kind === "queued") enqueued += 1;
      }
      log.info(
        `bulkReRenderFailed storeId=${input.storeId} attempted=${failedRows.length} enqueued=${enqueued}`,
      );
      return { enqueued } as const;
    }),

  /**
   * Distributor uploads a manual override image. Auto-approves on upload
   * because the act of uploading is itself the approval — there's no
   * AI output to second-guess. Stored under
   * `render-overrides/{storeId}/{storeProductId}-{timestamp}.{ext}` so
   * a re-upload doesn't overwrite the prior asset (audit trail).
   *
   * 5MB hard cap matches the brief; jpg/png/webp matches the file picker
   * accept list. Base64 over the wire is fine at this size — branding
   * uploadLogo uses the same shape and is the established pattern.
   */
  uploadOverride: protectedProcedure
    .input(
      z.object({
        storeProductId: z.number(),
        imageBase64: z.string(),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        fileName: z.string().max(255).default("override.png"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { storeId } = await resolveOwnedStoreProduct(db, input.storeProductId, ctx);

      const buffer = Buffer.from(input.imageBase64, "base64");
      // 5MB cap per the spec. Buffer length is the decoded byte count,
      // so this is the actual stored size, not the over-the-wire size.
      if (buffer.byteLength > 5 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Override image must be 5MB or smaller" });
      }
      const ext =
        input.mimeType === "image/jpeg" ? "jpg" : input.mimeType === "image/webp" ? "webp" : "png";
      const key = `render-overrides/${storeId}/${input.storeProductId}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      await db
        .update(storeProducts)
        .set({
          renderOverrideUrl: url,
          renderApproved: true,
          renderApprovedAt: new Date(),
          renderApprovedBy: ctx.user.id,
        })
        .where(eq(storeProducts.id, input.storeProductId));

      log.info(
        `uploadOverride storeProductId=${input.storeProductId} userId=${ctx.user.id} key=${key} bytes=${buffer.byteLength}`,
      );
      return { url } as const;
    }),

  /**
   * Clear the override. Approval state then depends on whether an AI
   * render exists:
   *   - AI render exists → keep approved (the prior approval was for the
   *     AI image at the time it was rendered; removing the override means
   *     "fall back to that AI image" and the customer experience is the
   *     same as when it was approved). Caller can re-render explicitly if
   *     they don't trust the prior AI output.
   *   - No AI render → flip approved=false. Nothing to show but the CSS
   *     fallback, and there's no "approval" of a non-existent image.
   */
  removeOverride: protectedProcedure
    .input(z.object({ storeProductId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await resolveOwnedStoreProduct(db, input.storeProductId, ctx);

      const [row] = await db
        .select({ webstoreRenderedImageUrl: storeProducts.webstoreRenderedImageUrl })
        .from(storeProducts)
        .where(eq(storeProducts.id, input.storeProductId))
        .limit(1);
      const hasAiRender = !!row?.webstoreRenderedImageUrl;

      const update: Partial<typeof storeProducts.$inferInsert> = {
        renderOverrideUrl: null,
      };
      if (!hasAiRender) {
        update.renderApproved = false;
        update.renderApprovedAt = null;
        update.renderApprovedBy = null;
      }

      await db.update(storeProducts).set(update).where(eq(storeProducts.id, input.storeProductId));
      return { success: true, fallbackHasAiRender: hasAiRender } as const;
    }),

  /**
   * Phase 8 — variant-grouped render listing.
   *
   * Same data as listByStore, but bucketed by the joined product's
   * styleGroup. Each group exposes its variants (with full per-variant
   * render state) so the UI can show one card per product family with
   * a color toggle. Approve/re-render/override mutations still operate
   * per-variant via the existing per-storeProductId procedures — the
   * grouping is presentation-only.
   *
   * The flat listByStore stays untouched for any caller that needs
   * row-level reads (admin tools, tests).
   */
  listByStoreGrouped: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        status: StatusFilter.default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertStoreOwnership(db, input.storeId, ctx);

      const rows = await db
        .select({
          storeProductId: storeProducts.id,
          productId: products.id,
          productName: products.name,
          productSku: products.sku,
          productImageUrl: products.imageUrl,
          styleGroup: products.styleGroup,
          isVariantPrimary: products.isVariantPrimary,
          colorName: products.colorName,
          colorHex: products.colorHex,
          swatchUrl: products.swatchUrl,
          renderUrl: storeProducts.webstoreRenderedImageUrl,
          renderStatus: storeProducts.webstoreRenderStatus,
          renderedAt: storeProducts.webstoreRenderedAt,
          renderApproved: storeProducts.renderApproved,
          renderApprovedAt: storeProducts.renderApprovedAt,
          renderApprovedBy: storeProducts.renderApprovedBy,
          renderOverrideUrl: storeProducts.renderOverrideUrl,
          renderPromptAdjustment: storeProducts.renderPromptAdjustment,
          renderPlacementX:        storeProducts.renderPlacementX,
          renderPlacementY:        storeProducts.renderPlacementY,
          renderPlacementWidth:    storeProducts.renderPlacementWidth,
          renderPlacementHeight:   storeProducts.renderPlacementHeight,
          renderPlacementRotation: storeProducts.renderPlacementRotation,
          storeLogoUrl: stores.logoUrl,
        })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .innerJoin(stores, eq(stores.id, storeProducts.storeId))
        .where(eq(storeProducts.storeId, input.storeId));

      type Row = (typeof rows)[number];
      const matches = (r: Row): boolean => {
        switch (input.status) {
          case "all": return true;
          case "approved": return r.renderApproved === true;
          case "pending_review":
            return r.renderStatus === "complete" && r.renderApproved === false;
          case "rendering": return r.renderStatus === "rendering";
          case "failed":    return r.renderStatus === "failed";
          case "no_render":
            return (
              (r.renderStatus === "pending" || r.renderStatus === null) &&
              r.renderUrl === null &&
              r.renderOverrideUrl === null
            );
        }
      };

      // Group BEFORE filtering so a card with one matching variant still
      // shows every color in its toggle (the operator may want to flip
      // to a non-pending color to compare images).
      const buckets = new Map<string, Row[]>();
      for (const r of rows) {
        const key = r.styleGroup ?? `__solo_${r.productId}`;
        const list = buckets.get(key) ?? [];
        list.push(r);
        buckets.set(key, list);
      }

      const groups = Array.from(buckets.entries())
        .map(([styleGroup, variants]) => {
          const matchingVariants = variants.filter(matches);
          // Card-face variant: prefer the styleGroup's primary, then any
          // variant matching the active filter, then first variant.
          const primary =
            variants.find(v => v.isVariantPrimary) ??
            matchingVariants[0] ??
            variants[0];
          return {
            styleGroup,
            primary,
            // Always return ALL variants for the toggle. matchedCount
            // surfaces "n of m colors match this filter" if the UI wants
            // it.
            variants: variants.sort((a, b) => (a.colorName ?? "").localeCompare(b.colorName ?? "")),
            matchedCount: matchingVariants.length,
            variantCount: variants.length,
          };
        })
        .filter(g => g.matchedCount > 0);

      // Bucket sort identical to flat listByStore: pending → failed →
      // approved → rendering → other.
      const bucket = (g: typeof groups[number]): number => {
        const p = g.primary;
        if (p.renderStatus === "complete" && p.renderApproved === false) return 0;
        if (p.renderStatus === "failed") return 1;
        if (p.renderApproved === true) return 2;
        if (p.renderStatus === "rendering") return 3;
        return 4;
      };
      groups.sort((a, b) => bucket(a) - bucket(b) || a.primary.productId - b.primary.productId);

      return groups;
    }),

  /**
   * Phase 8 — explicit "render all colors" action. For a styleGroup
   * that's already attached to a store (one binding per variant), enqueue
   * a render for every variant whose status is unset, failed, or which
   * has no renderUrl yet. Idempotent — `force: false` so an in-flight or
   * complete-and-unmodified row stays put.
   */
  renderAllColors: protectedProcedure
    .input(z.object({ storeId: z.number(), styleGroup: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertStoreOwnership(db, input.storeId, ctx);

      const rows = await db
        .select({
          storeProductId: storeProducts.id,
          productId: storeProducts.productId,
          renderStatus: storeProducts.webstoreRenderStatus,
          renderUrl: storeProducts.webstoreRenderedImageUrl,
        })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .where(and(
          eq(storeProducts.storeId, input.storeId),
          eq(products.styleGroup, input.styleGroup),
        ));

      let enqueued = 0;
      for (const r of rows) {
        // Skip variants that already have an output and aren't failed.
        if (r.renderStatus === "complete" && r.renderUrl) continue;
        if (r.renderStatus === "rendering") continue;
        const result = await enqueueRenderForStoreProduct(db, input.storeId, r.productId, { force: true });
        if (result.kind === "queued") {
          await db
            .update(storeProducts)
            .set({ webstoreRenderStatus: "pending" })
            .where(eq(storeProducts.id, r.storeProductId));
          enqueued += 1;
        }
      }
      log.info(`renderAllColors storeId=${input.storeId} group=${input.styleGroup} enqueued=${enqueued} of ${rows.length}`);
      return { enqueued, considered: rows.length } as const;
    }),

  /**
   * Persist the distributor's manual placement coordinates from the
   * Visual Placement Editor. All five values are percentages of the
   * product image (0-100), except rotation which is degrees (-360..360).
   *
   * The orchestrator reads these on next enqueue and prepends a
   * coordinate-derived prompt fragment to renderPromptAdjustment, so
   * the manual placement and the manual text adjustment compose.
   */
  savePlacement: protectedProcedure
    .input(
      z.object({
        storeProductId: z.number(),
        x:        z.number().min(0).max(100),
        y:        z.number().min(0).max(100),
        width:    z.number().min(0).max(100),
        height:   z.number().min(0).max(100),
        rotation: z.number().min(-360).max(360).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await resolveOwnedStoreProduct(db, input.storeProductId, ctx);

      // drizzle's decimal column maps to a string in writes — toFixed(2)
      // matches the column scale and avoids floating-point drift.
      await db
        .update(storeProducts)
        .set({
          renderPlacementX:        input.x.toFixed(2),
          renderPlacementY:        input.y.toFixed(2),
          renderPlacementWidth:    input.width.toFixed(2),
          renderPlacementHeight:   input.height.toFixed(2),
          renderPlacementRotation: input.rotation.toFixed(2),
        })
        .where(eq(storeProducts.id, input.storeProductId));

      log.info(
        `savePlacement storeProductId=${input.storeProductId} x=${input.x.toFixed(2)} y=${input.y.toFixed(2)} w=${input.width.toFixed(2)} h=${input.height.toFixed(2)} r=${input.rotation.toFixed(2)}`,
      );
      return { success: true } as const;
    }),
});
