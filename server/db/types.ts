/**
 * server/db/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drizzle ORM does not automatically infer the shape of complex JOIN queries.
 * This file co-locates all hand-written return-type interfaces so that server
 * routers can cast query results to a known type instead of `as any`.
 *
 * Usage pattern:
 *   const rows = await db.select({ ... }).from(stores).leftJoin(...)
 *     as unknown as StoreWithClient[];
 *
 * Approach: `as unknown as T` is preferred over `as any` because it is
 * explicit, self-documenting, and still fails if T is structurally impossible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Shared primitives ────────────────────────────────────────────────────────

/** MySQL INSERT result — Drizzle returns this but doesn't export the type. */
export interface MysqlInsertResult {
  insertId: number;
  affectedRows: number;
}

/** MySQL UPDATE/DELETE result */
export interface MysqlMutationResult {
  affectedRows: number;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

export interface StoreWithClient {
  id: number;
  name: string;
  slug: string;
  status: string;
  storeType: string | null;
  template: string | null;
  primaryColor: string | null;
  welcomeMessage: string | null;
  senderName: string | null;
  senderEmail: string | null;
  requireAuth: boolean | null;
  clientId: number | null;
  organizationId: number;
  createdAt: Date | null;
  client: {
    id: number;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
  } | null;
}

export interface StoreWithProducts {
  id: number;
  name: string;
  slug: string;
  status: string;
  organizationId: number;
  products: Array<{
    id: number;
    name: string;
    sku: string | null;
    basePrice: string | null;
    imageUrl: string | null;
    category: string | null;
  }>;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface OrderWithItems {
  id: number;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: Date | null;
  storeUserId: number | null;
  storeId: number | null;
  items: Array<{
    id: number;
    productId: number;
    quantity: number;
    unitCents: number;
    productName: string;
    productSku: string | null;
  }>;
}

export interface OrderWithClientAndItems {
  id: number;
  status: string;
  totalCents: number;
  createdAt: Date | null;
  client: { id: number; companyName: string } | null;
  items: Array<{
    id: number;
    quantity: number;
    unitCents: number;
    product: { id: number; name: string; sku: string | null } | null;
  }>;
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export interface ProposalWithRelations {
  id: number;
  title: string;
  status: string;
  proposalType: string | null;
  deliveryMethod: string | null;
  approvalRouting: string | null;
  estimatedValue: string | null;
  validDays: number | null;
  notes: string | null;
  multiDepartment: boolean | null;
  stripeCheckout: boolean | null;
  createdAt: Date | null;
  client: {
    id: number;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
  } | null;
  products: Array<{
    id: number;
    productId: number;
    quantity: number;
    unitPrice: string | null;
    decorationType: string | null;
    product: {
      id: number;
      name: string;
      sku: string | null;
      basePrice: string | null;
      imageUrl: string | null;
      decorationMethods: string | null;
    } | null;
    proof: {
      id: number;
      status: string;
      proofImageUrl: string | null;
    } | null;
  }>;
}

// ─── AI Insights ─────────────────────────────────────────────────────────────

export interface OrderRevenueRow {
  orderId: number;
  totalCents: number;
  createdAt: Date | null;
  clientId: number | null;
  clientName: string;
  productId: number;
  productName: string;
  quantity: number;
  unitCents: number;
}

export interface TopProductRow {
  productId: number;
  productName: string;
  totalUnits: number;
  totalRevenueCents: number;
}

// ─── Department Budgets ───────────────────────────────────────────────────────

export interface DepartmentWithSpend {
  id: number;
  name: string;
  storeId: number;
  budgetCents: number | null;
  spentCents: number;
  maxPerOrderCents: number | null;
  fiscalPeriodStart: Date | null;
  fiscalPeriodEnd: Date | null;
  createdAt: Date | null;
}

// ─── Store Portal ─────────────────────────────────────────────────────────────

export interface StoreUserWithDepartment {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  department: string | null;
  spendingLimitCents: number | null;
  spentCents: number;
  storeId: number;
  departmentId: number | null;
  createdAt: Date | null;
}
