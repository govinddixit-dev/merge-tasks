/**
 * StoreManagementTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared types and interfaces used across all StoreManagement tab components.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Tab = 'overview' | 'products' | 'orders' | 'preview' | 'users' | 'print' | 'print-requests' | 'media' | 'settings';
export type PreviewDevice = 'mobile' | 'tablet' | 'desktop';

export interface StoreData {
  id: string;
  name: string;
  domain: string;
  employees: number;
  tier: string;
  status: string;
  gmv: string;
  sso: string;
  storeType: string;
  durationType: 'permanent' | 'popup';
  popupStart?: string;
  popupEnd?: string;
  linkedTo?: string;
  monthlyOrders: number;
  totalProducts: number;
  avgOrderValue: string;
  conversionRate: string;
  pocName: string;
  pocEmail: string;
  createdDate: string;
  // Store Access Control — controls login gate in LiveStore.tsx
  // true = Private (default), false = Open Browsing
  requireAuth?: boolean;
}

export interface EffectiveStore extends StoreData {
  // All fields from StoreData are present; this alias makes intent clear
}

/** Order shape used in the store management Overview / Orders tabs. */
export interface StoreOrder {
  id: string;
  date: string;
  customer: string;
  items: number;
  total: string;
  status: string;
  method: string;
  /** Real DB id, if available */
  dbId?: number;
}

/** Minimal shape for the DB-backed store record passed into tab components. */
export interface DbStore {
  clientId?: number;
  slug?: string;
  storeProducts?: Array<{
    productId: number;
    customPrice?: string | null;
    featured?: boolean;
    sortOrder?: number | null;
    divisionIds?: number[] | null;
  }>;
  [key: string]: unknown;
}

/** Webstore photoreal render lifecycle, mirroring storeProducts.webstoreRenderStatus. */
export type WebstoreRenderStatus = "pending" | "rendering" | "complete" | "failed";

/**
 * Effective render status surfaced by stores.getById. Extends the raw DB
 * status with derived states the operator needs to see ("awaiting_analysis"
 * = row is pending but the product has no placement analysis yet, so the
 * worker would skip it). Server-derived; do not write to DB.
 */
export type EffectiveRenderStatus = WebstoreRenderStatus | "awaiting_analysis";

/** Product row used in the Products tab tables. */
export interface StoreProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  price: string;
  stock: number;
  status: string;
  webstoreRenderStatus?: WebstoreRenderStatus | null;
  effectiveRenderStatus?: EffectiveRenderStatus | null;
  webstoreRenderedAt?: Date | string | null;
  [key: string]: unknown;
}

/** Product available to add from the catalog. */
export interface AvailableProduct {
  id: number;
  name: string;
  sku?: string | null;
  category?: string;
  basePrice?: string | null;
  [key: string]: unknown;
}

/** Store user record. */
export interface StoreUser {
  id: number;
  name?: string | null;
  email: string;
  role?: string;
  department?: string | null;
  spendingLimit?: string | null;
  status?: string;
  [key: string]: unknown;
}
