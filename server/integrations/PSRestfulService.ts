/**
 * PSRestfulService — Centralized PSRESTful API client.
 *
 * THE GOLDEN RULE: All PSRESTful API calls must route through this service.
 * Never scatter fetch calls to api.psrestful.com across the codebase.
 *
 * Phase 1 (Standard plan): injects PSRESTFUL_MASTER_KEY for all requests.
 * Phase 2 (Enterprise plan): dynamically fetches the sub-account API key
 *   for the relevant client when USE_SUB_ACCOUNTS=true AND
 *   organizations.subAccountsEnabled=true for that distributor.
 *
 * The rest of the codebase remains completely unaware of which phase is active.
 * Upgrading is a single flag flip: USE_SUB_ACCOUNTS=true in .env
 */

import { getLogger } from "../utils/logger";
import { getDb } from "../db";
import { psRestfulSubAccounts, organizations } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { decryptCredential } from "../utils/encryption";

const log = getLogger("psrestful");

const BASE_URL = "https://api.psrestful.com";

// Module-level FOB cache. Keyed by supplier code (not productId): the FOB
// list is supplier-static, and an empty result is *also* cached so a supplier
// with no exposed fob-points endpoint can't trigger a per-product retry loop.
// On 2026-05-04 the missing negative-cache caused 112K calls in 4 days and
// got our keys disabled — see fix in this commit.
interface FobCacheEntry {
  value: PSRestfulFobPoint[];
  expiresAt: number;
}
const fobPointsCache = new Map<string, FobCacheEntry>();
const FOB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Module-level rate guard — defense in depth so a future hot-loop bug can't
// burn through API quota again. Counts real HTTP calls only (cached responses
// bypass this). Endpoint is reduced to a stable bucket (resource id stripped)
// so a per-product loop counts as one bucket. When tripped we throw — the
// per-product try/catch in supplierSyncEngine absorbs it and skips that item.
const PSR_RATE_WINDOW_MS = 60 * 1000;
const PSR_RATE_MAX_CALLS = 10;
const endpointCallTimestamps = new Map<string, number[]>();

function endpointBucket(path: string): string {
  return path.replace(/\?.*$/, "").replace(/\/[^/]+$/, "/:id");
}

class PSRestfulRateGuardError extends Error {
  constructor(bucket: string, count: number) {
    super(`PSRESTful rate guard: ${bucket} hit ${count} calls in last 60s — skipping`);
    this.name = "PSRestfulRateGuardError";
  }
}

function checkRateGuard(path: string): void {
  const bucket = endpointBucket(path);
  const now = Date.now();
  const recent = (endpointCallTimestamps.get(bucket) ?? []).filter(t => now - t < PSR_RATE_WINDOW_MS);
  if (recent.length >= PSR_RATE_MAX_CALLS) {
    log.warn(`PSRESTful rate guard tripped on ${bucket}: ${recent.length} calls in last 60s — skipping`);
    throw new PSRestfulRateGuardError(bucket, recent.length);
  }
  recent.push(now);
  endpointCallTimestamps.set(bucket, recent);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types — PSRESTful API responses
// ─────────────────────────────────────────────────────────────────────────────

export interface PSRestfulProduct {
  productId: string;
  productName: string;
  description: string;
  supplierCode: string;
  categoryName?: string;
  imageUrl?: string;
}

export interface PSRestfulPriceTier {
  minQty: number;
  maxQty: number | null;
  price: number; // in supplier's native currency
  currency: string;
}

export interface PSRestfulVariant {
  variantKey: string; // e.g. "color:Red" or "size:XL|color:Red"
  label: string;
}

export interface PSRestfulLocation {
  locationId: string;
  locationName: string; // e.g. "Left Chest", "Full Front"
  maxDecorationColors?: number;
  decorationMethods?: string[];
}

export interface PSRestfulFobPoint {
  fobId: string;
  fobPostalCode?: string | null;
  fobCity?: string | null;
  fobState?: string | null;
  fobCountry?: string | null;
}

export interface PSRestfulProductDetail {
  productId: string;
  productName: string;
  description: string;
  supplierCode: string;
  imageUrl?: string;
  priceTiers: PSRestfulPriceTier[];
  variants: PSRestfulVariant[];
  locations: PSRestfulLocation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PSRestfulService
// ─────────────────────────────────────────────────────────────────────────────

export class PSRestfulService {
  private readonly useSubAccounts: boolean;
  private readonly masterApiKey: string;

  constructor() {
    this.useSubAccounts = process.env.USE_SUB_ACCOUNTS === "true";
    this.masterApiKey = process.env.PSRESTFUL_MASTER_KEY ?? "";

    if (!this.masterApiKey) {
      log.warn("PSRESTFUL_MASTER_KEY is not set — PSRESTful API calls will fail");
    }
  }

  /**
   * Resolve the API key to use for a given context.
   * Phase 1: always returns master key.
   * Phase 2: returns sub-account key if provisioned, falls back to master key.
   */
  private async getApiKey(context?: { clientId?: number; organizationId?: number }): Promise<string> {
    if (!this.useSubAccounts || !context?.clientId) {
      return this.masterApiKey;
    }

    try {
      const db = await getDb();
      if (!db) return this.masterApiKey;

      // Check if this distributor has sub-accounts enabled
      if (context.organizationId) {
        const [org] = await db
          .select({ subAccountsEnabled: organizations.subAccountsEnabled })
          .from(organizations)
          .where(eq(organizations.id, context.organizationId))
          .limit(1);

        if (!org?.subAccountsEnabled) return this.masterApiKey;
      }

      // Fetch sub-account API key for this client
      const [subAccount] = await db
        .select({ apiKey: psRestfulSubAccounts.apiKey, isActive: psRestfulSubAccounts.isActive })
        .from(psRestfulSubAccounts)
        .where(eq(psRestfulSubAccounts.clientId, context.clientId))
        .limit(1);

      if (!subAccount?.isActive || !subAccount.apiKey) {
        return this.masterApiKey;
      }

      const decrypted = decryptCredential(subAccount.apiKey);
      return decrypted || this.masterApiKey;
    } catch (err) {
      log.error("Failed to resolve sub-account API key, falling back to master:", err);
      return this.masterApiKey;
    }
  }

  /**
   * Make an authenticated GET request to the PSRESTful API.
   */
  private async get<T>(
    path: string,
    context?: { clientId?: number; organizationId?: number }
  ): Promise<T> {
    checkRateGuard(path);

    const apiKey = await this.getApiKey(context);
    const url = `${BASE_URL}${path}`;

    log.info(`PSRESTful GET ${path}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
      },
    });

    if (response.status === 429) {
      throw new Error("PSRESTful rate limit exceeded — retry after backoff");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`PSRESTful API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Catalog sync methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all sellable products for a supplier.
   *
   * The PSRESTful sellable-products response envelope is `ProductSellableArray`
   * (a PromoStandards convention), not `products`. The `environment` query
   * param toggles between supplier sandbox (STAGING) and live (PROD) data and
   * defaults to PROD.
   */
  async getProducts(
    supplierCode: string,
    context?: { clientId?: number; organizationId?: number; environment?: "PROD" | "STAGING" }
  ): Promise<PSRestfulProduct[]> {
    const environment = context?.environment ?? "PROD";
    const data = await this.get<{ ProductSellableArray?: PSRestfulProduct[] }>(
      `/v1.0.0/suppliers/${encodeURIComponent(supplierCode)}/sellable-products?environment=${environment}`,
      context
    );
    return data.ProductSellableArray ?? [];
  }

  /**
   * Get full product detail including pricing tiers, variants, and decoration locations.
   */
  async getProductDetail(
    supplierCode: string,
    productId: string,
    context?: { clientId?: number; organizationId?: number }
  ): Promise<PSRestfulProductDetail | null> {
    try {
      return await this.get<PSRestfulProductDetail>(
        `/v1.0.0/suppliers/${encodeURIComponent(supplierCode)}/products/${encodeURIComponent(productId)}`,
        context
      );
    } catch (err) {
      log.warn(`Failed to fetch product detail for ${supplierCode}/${productId}:`, err);
      return null;
    }
  }

  /**
   * Get available FOB (shipping origin) points for a product. Required as a
   * prerequisite for getProductPricing — PSRESTful's pricing endpoint demands
   * an explicit fob_id and provides no default. PromoStandards convention is
   * that the first FOB in the array is the supplier's primary warehouse.
   */
  async getFobPoints(
    supplierCode: string,
    productId: string,
    context?: { clientId?: number; organizationId?: number }
  ): Promise<PSRestfulFobPoint[]> {
    const data = await this.get<{ FobPointArray?: { FobPoint?: PSRestfulFobPoint[] } }>(
      `/v1.0.0/suppliers/${encodeURIComponent(supplierCode)}/fob-points/${encodeURIComponent(productId)}`,
      context
    );
    return data.FobPointArray?.FobPoint ?? [];
  }

  /**
   * Cached variant of getFobPoints. Returns the FOB list for a supplier with
   * a 24h module-level cache. Empty results are cached too — so a supplier
   * with no exposed FOB endpoint won't trigger a per-product retry loop.
   *
   * `productId` is still passed to the underlying endpoint (PSRESTful's URL
   * requires it), but the cache key is supplier-only because the FOB list
   * is supplier-static in practice.
   */
  async getFobPointsCached(
    supplierCode: string,
    productId: string,
    context?: { clientId?: number; organizationId?: number }
  ): Promise<PSRestfulFobPoint[]> {
    const now = Date.now();
    const cached = fobPointsCache.get(supplierCode);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    // Cache populates on EVERY outcome — success, empty, or error. The
    // first follow-up commit caused a retry storm because errors thrown
    // by the rate guard (or any HTTP failure) bypassed cache.set() and
    // every subsequent product re-entered and re-threw. Now: one call
    // attempt per supplier per TTL window, period.
    let value: PSRestfulFobPoint[] = [];
    try {
      value = await this.getFobPoints(supplierCode, productId, context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`getFobPoints failed for ${supplierCode}, negative-caching to prevent retry storm: ${msg}`);
    }
    fobPointsCache.set(supplierCode, { value, expiresAt: now + FOB_CACHE_TTL_MS });
    return value;
  }

  /**
   * Get pricing and configuration for a product.
   *
   * Requires explicit currency, fob_id, and price_type — PSRESTful enforced
   * these as required query params around 2026-04-30. We request USD and let
   * the supplierSyncEngine converter normalize to home currency, since not
   * every supplier supports every currency natively.
   */
  async getProductPricing(
    supplierCode: string,
    productId: string,
    opts: { currency: string; fobId: string; priceType?: "Net" | "List" | "Customer" },
    context?: { clientId?: number; organizationId?: number }
  ): Promise<PSRestfulPriceTier[]> {
    const params = new URLSearchParams({
      currency: opts.currency,
      fob_id: opts.fobId,
      price_type: opts.priceType ?? "Net",
    });
    const data = await this.get<{ priceTiers?: PSRestfulPriceTier[] }>(
      `/v1.0.0/suppliers/${encodeURIComponent(supplierCode)}/pricing-and-configuration/${encodeURIComponent(productId)}?${params.toString()}`,
      context
    );
    return data.priceTiers ?? [];
  }

  /**
   * Get available decoration locations for a product.
   */
  async getProductLocations(
    supplierCode: string,
    productId: string,
    context?: { clientId?: number; organizationId?: number }
  ): Promise<PSRestfulLocation[]> {
    const data = await this.get<{ locations?: PSRestfulLocation[] }>(
      `/v1.0.0/suppliers/${encodeURIComponent(supplierCode)}/available-locations/${encodeURIComponent(productId)}`,
      context
    );
    return data.locations ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-Accounts management (Phase 2 — Enterprise only)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a sub-account for a client in PSRESTful.
   * Only called when upgrading to Enterprise and USE_SUB_ACCOUNTS=true.
   */
  async createSubAccount(params: {
    name: string;
    externalCustomerId: string;
    contactEmail?: string;
    notes?: string;
  }): Promise<{ id: number; externalCustomerId: string }> {
    const apiKey = this.masterApiKey;
    const url = `${BASE_URL}/extra/v2/subaccounts/`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.name,
        external_customer_id: params.externalCustomerId,
        organization_contact_email: params.contactEmail,
        account_notes: params.notes,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to create PSRESTful sub-account: ${response.status} ${body}`);
    }

    const data = await response.json() as { id: number; external_customer_id: string };
    return { id: data.id, externalCustomerId: data.external_customer_id };
  }

  /**
   * Generate an API key for a sub-account.
   */
  async createSubAccountApiKey(subAccountId: number): Promise<string> {
    const url = `${BASE_URL}/extra/v2/subaccounts/${subAccountId}/api-keys/`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": this.masterApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ public: false }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to create sub-account API key: ${response.status} ${body}`);
    }

    const data = await response.json() as { key: string };
    return data.key;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton — import this instance everywhere
// ─────────────────────────────────────────────────────────────────────────────

export const psRestfulService = new PSRestfulService();
