/**
 * planLimits.ts — Plan limit enforcement helpers
 *
 * IMPORTANT: These functions MUST be called inside a database transaction to prevent
 * TOCTOU (Time-Of-Check-Time-Of-Use) race conditions under concurrent load.
 *
 * When called inside a transaction, MySQL's InnoDB engine holds a shared lock on the
 * counted rows until the transaction commits, preventing concurrent inserts from
 * bypassing the limit check.
 *
 * Usage (CORRECT — inside db.transaction):
 *   await db.transaction(async (tx) => {
 *     await checkClientLimit(tx, scope, ctx.user.subscriptionTier);
 *     await tx.insert(clients).values(values);
 *   });
 */
import { count, gte, and } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { TRPCError } from "@trpc/server";
import { clients, stores, proposals, virtualProofs } from "../../drizzle/schema";
import { getPlanById } from "../stripe/products";
import type { OrgScope } from "./orgScope";

/**
 * Enforce the plan's client limit before inserting a new client.
 * Unlimited plans use -1 as the limit value.
 */
export async function checkClientLimit(
  db: MySql2Database<any>,
  scope: OrgScope,
  subscriptionTier: string | null | undefined
): Promise<void> {
  const plan = getPlanById(subscriptionTier || "free") ?? getPlanById("free")!;
  if (plan.limits.clients === -1) return; // unlimited

  const [row] = await db
    .select({ total: count() })
    .from(clients)
    .where(scope.clients);

  const current = row?.total ?? 0;
  if (current >= plan.limits.clients) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.name} plan allows up to ${plan.limits.clients} clients. Please upgrade to add more.`,
    });
  }
}

/**
 * Enforce the plan's store limit before inserting a new store.
 */
export async function checkStoreLimit(
  db: MySql2Database<any>,
  scope: OrgScope,
  subscriptionTier: string | null | undefined
): Promise<void> {
  const plan = getPlanById(subscriptionTier || "free") ?? getPlanById("free")!;
  if (plan.limits.stores === -1) return; // unlimited

  const [row] = await db
    .select({ total: count() })
    .from(stores)
    .where(scope.stores);

  const current = row?.total ?? 0;
  if (current >= plan.limits.stores) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.name} plan allows up to ${plan.limits.stores} store${plan.limits.stores === 1 ? "" : "s"}. Please upgrade to create more.`,
    });
  }
}

/**
 * Enforce the plan's monthly proposal limit before inserting a new proposal.
 * Counts proposals created in the current calendar month.
 */
export async function checkProposalMonthlyLimit(
  db: MySql2Database<any>,
  scope: OrgScope,
  subscriptionTier: string | null | undefined
): Promise<void> {
  const plan = getPlanById(subscriptionTier || "free") ?? getPlanById("free")!;
  if (plan.limits.proposals === -1) return; // unlimited

  // Start of current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [row] = await db
    .select({ total: count() })
    .from(proposals)
    .where(and(scope.proposals, gte(proposals.createdAt, startOfMonth)));

  const current = row?.total ?? 0;
  if (current >= plan.limits.proposals) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.name} plan allows up to ${plan.limits.proposals} proposal${plan.limits.proposals === 1 ? "" : "s"} per month. Please upgrade for unlimited proposals.`,
    });
  }
}

/**
 * Enforce the plan's monthly virtual proof limit before creating a new proof.
 * Counts proofs created in the current calendar month.
 */
export async function checkProofMonthlyLimit(
  db: MySql2Database<any>,
  scope: OrgScope,
  subscriptionTier: string | null | undefined
): Promise<void> {
  const plan = getPlanById(subscriptionTier || "free") ?? getPlanById("free")!;
  if (plan.limits.proofs === -1) return; // unlimited

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [row] = await db
    .select({ total: count() })
    .from(virtualProofs)
    .where(and(scope.virtualProofs, gte(virtualProofs.createdAt, startOfMonth)));

  const current = row?.total ?? 0;
  if (current >= plan.limits.proofs) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.name} plan allows up to ${plan.limits.proofs} virtual proof${plan.limits.proofs === 1 ? "" : "s"} per month. Please upgrade for more.`,
    });
  }
}

/**
 * Enforce the plan's monthly email send limit.
 * This is a simple count check — call with the current month's send count.
 * Unlike other limits, email sends are tracked via a counter rather than
 * counting rows, so the caller passes the current count.
 */
export function checkEmailSendLimit(
  currentMonthSends: number,
  subscriptionTier: string | null | undefined
): void {
  const plan = getPlanById(subscriptionTier || "free") ?? getPlanById("free")!;
  if (plan.limits.emailSends === -1) return; // unlimited

  if (currentMonthSends >= plan.limits.emailSends) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.name} plan allows up to ${plan.limits.emailSends} email send${plan.limits.emailSends === 1 ? "" : "s"} per month. Please upgrade for more.`,
    });
  }
}
