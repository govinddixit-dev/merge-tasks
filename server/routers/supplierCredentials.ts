/**
 * supplierCredentials.ts — Generic per-org supplier credential management.
 *
 * Each row stores one supplier login pair (account id + password) for one
 * organization. Both fields are encrypted at rest using the shared
 * AES-256-GCM helper (server/utils/encryption.ts). The router never returns
 * raw credentials — even the org's own admins only see a connected/empty
 * status and a last-updated timestamp. Use the seed script or the
 * UI's save flow to write credentials; there is no read endpoint by design.
 *
 * Procedures:
 *   - saveCredentials(supplierCode, accountId, password) → upsert
 *   - getConnectionStatus(supplierCode)                  → boolean + ts
 *   - deleteCredentials(supplierCode)                    → remove row
 *
 * NOTE: This file does not touch any sync code. Wiring sync to read these
 * credentials happens in a later session.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { orgProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { supplierCredentials, type InsertSupplierCredential } from "../../drizzle/schema";
import { encryptCredential } from "../utils/encryption";
import { getLogger } from "../utils/logger";

const log = getLogger("supplierCredentials");

/**
 * Allowed supplier codes. Lowercased ASCII identifiers; keep in sync with
 * the supplier cards in the settings UI. Adding a new supplier here makes
 * it eligible for credential storage but does NOT wire up sync — that's
 * a separate code change in a later session.
 */
const SUPPLIER_CODE = z.enum(["sanmar", "sscanada", "asi", "alphabroder"]);

export const supplierCredentialsRouter = router({
  /**
   * Upsert credentials for the caller's org. Both fields are encrypted
   * before persistence; the plaintext is held only in this stack frame.
   */
  saveCredentials: orgProcedure
    .input(
      z.object({
        supplierCode: SUPPLIER_CODE,
        accountId: z.string().min(1).max(255),
        password: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const accountIdEnc = encryptCredential(input.accountId);
      const passwordEnc = encryptCredential(input.password);
      if (!accountIdEnc || !passwordEnc) {
        // encryptCredential returns null only for empty input; Zod already
        // enforced min(1), so this is genuinely unexpected.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to encrypt credentials.",
        });
      }

      const existing = await db
        .select({ id: supplierCredentials.id })
        .from(supplierCredentials)
        .where(
          and(
            eq(supplierCredentials.organizationId, ctx.organizationId),
            eq(supplierCredentials.supplierCode, input.supplierCode),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(supplierCredentials)
          .set({ accountId: accountIdEnc, password: passwordEnc })
          .where(eq(supplierCredentials.id, existing[0].id));
      } else {
        const values: InsertSupplierCredential = {
          organizationId: ctx.organizationId,
          supplierCode: input.supplierCode,
          accountId: accountIdEnc,
          password: passwordEnc,
        };
        await db.insert(supplierCredentials).values(values);
      }

      log.info(
        `Saved credentials for supplier=${input.supplierCode} org=${ctx.organizationId}`,
      );
      return { success: true } as const;
    }),

  /**
   * Returns connection status only. Never exposes the encrypted blob and
   * never returns the plaintext — the UI must treat saved credentials like
   * a password manager and only re-prompt when the user wants to update.
   */
  getConnectionStatus: orgProcedure
    .input(z.object({ supplierCode: SUPPLIER_CODE }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }
      const rows = await db
        .select({ updatedAt: supplierCredentials.updatedAt })
        .from(supplierCredentials)
        .where(
          and(
            eq(supplierCredentials.organizationId, ctx.organizationId),
            eq(supplierCredentials.supplierCode, input.supplierCode),
          ),
        )
        .limit(1);
      if (rows.length === 0) {
        return { connected: false, lastUpdatedAt: null as Date | null } as const;
      }
      return { connected: true, lastUpdatedAt: rows[0].updatedAt } as const;
    }),

  /**
   * Remove credentials for the caller's org + supplierCode. Idempotent —
   * deleting a non-existent row succeeds silently so retries don't 404.
   */
  deleteCredentials: orgProcedure
    .input(z.object({ supplierCode: SUPPLIER_CODE }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }
      await db
        .delete(supplierCredentials)
        .where(
          and(
            eq(supplierCredentials.organizationId, ctx.organizationId),
            eq(supplierCredentials.supplierCode, input.supplierCode),
          ),
        );
      log.info(
        `Deleted credentials for supplier=${input.supplierCode} org=${ctx.organizationId}`,
      );
      return { success: true } as const;
    }),
});
