/**
 * clientContacts.ts — Multi-contact CRUD for a client company.
 *
 * Procedures: list, create, update, delete, setPrimary
 *
 * Scope: contacts are tied to a client; every procedure first verifies the
 * parent client belongs to the caller's org scope before touching contacts.
 * This mirrors the pattern used for clientLogos / clientAssets.
 *
 * Backward compatibility: when the primary contact changes (promotion, update
 * of the currently-primary row, or deletion that triggers auto-promotion) the
 * corresponding `clients.contactName/contactTitle/contactEmail/contactPhone`
 * columns are mirrored so existing consumers that still read from `clients`
 * keep working.
 */

import { z } from "zod";
import { and, eq, asc, desc, ne } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { clients, clientContacts } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

async function assertClientInScope(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  ctx: Parameters<typeof getOrgScope>[0],
  clientId: number,
) {
  const scope = getOrgScope(ctx);
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), scope.clients))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

function composeName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter((p) => p && p.trim().length > 0).join(" ").trim();
}

export const clientContactsRouter = router({
  list: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertClientInScope(db, ctx, input.clientId);

      const rows = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, input.clientId))
        .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt));

      return rows;
    }),

  create: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      title: z.string().optional(),
      isPrimary: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertClientInScope(db, ctx, input.clientId);

      const existingCount = await db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, input.clientId));

      // First contact auto-promotes to primary so the list is never primaryless.
      const shouldBePrimary = input.isPrimary === true || existingCount.length === 0;

      let insertId!: number;
      await db.transaction(async (tx) => {
        if (shouldBePrimary) {
          await tx
            .update(clientContacts)
            .set({ isPrimary: false })
            .where(eq(clientContacts.clientId, input.clientId));
        }
        const result = await tx.insert(clientContacts).values({
          clientId: input.clientId,
          firstName: input.firstName?.trim() || null,
          lastName: input.lastName?.trim() || null,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          title: input.title?.trim() || null,
          isPrimary: shouldBePrimary,
        });
        insertId = result[0].insertId;

        if (shouldBePrimary) {
          await tx
            .update(clients)
            .set({
              contactName: composeName(input.firstName?.trim() || null, input.lastName?.trim() || null) || (input.email?.trim() || "—"),
              contactTitle: input.title?.trim() || null,
              contactEmail: input.email?.trim() || "",
              contactPhone: input.phone?.trim() || null,
            })
            .where(eq(clients.id, input.clientId));
        }
      });

      const created = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, insertId))
        .limit(1);
      return created[0];
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      firstName: z.string().nullable().optional(),
      lastName: z.string().nullable().optional(),
      email: z.string().email().nullable().optional().or(z.literal("")),
      phone: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      }
      await assertClientInScope(db, ctx, existing[0].clientId);

      const patch: Record<string, string | null> = {};
      if (input.firstName !== undefined) patch.firstName = input.firstName?.trim() || null;
      if (input.lastName !== undefined) patch.lastName = input.lastName?.trim() || null;
      if (input.email !== undefined) patch.email = input.email?.trim() || null;
      if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
      if (input.title !== undefined) patch.title = input.title?.trim() || null;

      if (Object.keys(patch).length > 0) {
        await db.update(clientContacts).set(patch).where(eq(clientContacts.id, input.id));
      }

      // Keep the legacy clients.* columns in sync when editing the primary contact.
      if (existing[0].isPrimary) {
        const merged = { ...existing[0], ...patch };
        await db.update(clients).set({
          contactName: composeName(merged.firstName, merged.lastName) || (merged.email || "—"),
          contactTitle: merged.title,
          contactEmail: merged.email || "",
          contactPhone: merged.phone,
        }).where(eq(clients.id, existing[0].clientId));
      }

      const updated = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      }
      await assertClientInScope(db, ctx, existing[0].clientId);

      const siblings = await db
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, existing[0].clientId), ne(clientContacts.id, input.id)))
        .orderBy(asc(clientContacts.createdAt));

      if (siblings.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete the only contact on this client.",
        });
      }

      await db.transaction(async (tx) => {
        await tx.delete(clientContacts).where(eq(clientContacts.id, input.id));

        if (existing[0].isPrimary) {
          const promote = siblings[0];
          await tx
            .update(clientContacts)
            .set({ isPrimary: true })
            .where(eq(clientContacts.id, promote.id));
          await tx.update(clients).set({
            contactName: composeName(promote.firstName, promote.lastName) || (promote.email || "—"),
            contactTitle: promote.title,
            contactEmail: promote.email || "",
            contactPhone: promote.phone,
          }).where(eq(clients.id, existing[0].clientId));
        }
      });

      return { success: true };
    }),

  setPrimary: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      }
      await assertClientInScope(db, ctx, existing[0].clientId);

      await db.transaction(async (tx) => {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false })
          .where(eq(clientContacts.clientId, existing[0].clientId));
        await tx
          .update(clientContacts)
          .set({ isPrimary: true })
          .where(eq(clientContacts.id, input.id));
        await tx.update(clients).set({
          contactName: composeName(existing[0].firstName, existing[0].lastName) || (existing[0].email || "—"),
          contactTitle: existing[0].title,
          contactEmail: existing[0].email || "",
          contactPhone: existing[0].phone,
        }).where(eq(clients.id, existing[0].clientId));
      });

      return { success: true };
    }),
});
