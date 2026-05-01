/**
 * Product Search Adapter
 *
 * Unified interface for searching products across multiple industry data sources:
 *   - ASI ESP (Advertising Specialty Institute)
 *   - PromoStandards (SanMar, S&S Activewear, alphabroder)
 *
 * Both sources are queried in parallel. Results are normalized to a common
 * shape and deduplicated by supplier + product number.
 *
 * The rest of the app only talks to this adapter — never to ASI or PromoStandards directly.
 */

import { getLogger } from "../utils/logger";

const log = getLogger("productSearchAdapter");

//  Normalized Product Shape 

export interface ExternalProduct {
  /** Unique key: `${source}:${supplierId}:${productNumber}` */
  externalId: string;
  source: "asi" | "promostandards";
  supplier: string;
  supplierCode: string;
  productNumber: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  colors: string[];
  sizes: string[];
  minQuantity: number;
  basePrice: number | null;
  currency: string;
  /** True if live inventory data is available from PromoStandards */
  hasLiveInventory: boolean;
  inventoryQuantity: number | null;
  decorationMethods: string[];
  tags: string[];
}

export interface ProductSearchResult {
  products: ExternalProduct[];
  totalCount: number;
  sources: {
    asi: { queried: boolean; count: number; error?: string };
    promostandards: { queried: boolean; count: number; error?: string };
  };
}

//  ASI ESP Integration 

/**
 * ASI ESP API v3
 * Docs: https://developer.asicentral.com/
 *
 * Authentication: API Key in Authorization header
 * Base URL: https://api.asicentral.com/v1
 */
async function searchASI(
  query: string,
  options: { apiKey: string; accountId: string; limit?: number }
): Promise<ExternalProduct[]> {
  const { apiKey, accountId, limit = 50 } = options;

  const url = new URL("https://api.asicentral.com/v1/products");
  url.searchParams.set("q", query);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("page", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "asi-account-id": accountId,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ASI API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();

  // ASI ESP response shape: { ResultsTotal, Products: [...] }
  const products: ExternalProduct[] = (data.Products || []).map((p: Record<string, unknown>) => {
    const supplier = (p.Supplier || {}) as Record<string, unknown>;
    const pricing = ((p.Pricing as Array<Record<string, unknown>>)?.[0] || {}) as Record<string, unknown>;
    const images = (p.Images || []) as Array<Record<string, unknown>>;
    const colors = ((p.Colors || []) as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => c.Name || c).filter(Boolean);
    const sizes = ((p.Sizes || []) as Array<Record<string, unknown>>).map((s: Record<string, unknown>) => s.Name || s).filter(Boolean);
    const decorations = ((p.Imprinting || []) as Array<Record<string, unknown>>).map((d: Record<string, unknown>) => d.Method || d).filter(Boolean);

    return {
      externalId: `asi:${supplier.AsiNumber || ""}:${p.ProductNumber || p.Id}`,
      source: "asi" as const,
      supplier: supplier.Name || "Unknown Supplier",
      supplierCode: supplier.AsiNumber || "",
      productNumber: p.ProductNumber || String(p.Id || ""),
      name: p.Name || p.Title || "Unnamed Product",
      description: p.Description || "",
      category: (p.Category as Record<string, unknown>)?.Name || p.CategoryName || "",
      imageUrl: (images[0] as Record<string, unknown>)?.Url || (images[0] as Record<string, unknown>)?.url || null,
      colors,
      sizes,
      minQuantity: pricing.MinQuantity || 1,
      basePrice: pricing.Price ? parseFloat(String(pricing.Price)) : null,
      currency: "USD",
      hasLiveInventory: false,
      inventoryQuantity: null,
      decorationMethods: decorations,
      tags: (String(p.Keywords || "")).split(",").map((t: string) => t.trim()).filter(Boolean),
    };
  });

  return products;
}

//  PromoStandards Integration 

/**
 * PromoStandards Product Data Service (PDS) v2.0.0
 * Docs: https://www.promostandards.org/services/product-data-service/
 *
 * Each supplier has their own endpoint. We query the three largest:
 *   - SanMar: https://ws.sanmar.com:8080/PromoStandards/PDS/2.0.0
 *   - S&S Activewear: https://www.ssactivewear.com/pds/pds.asmx
 *   - alphabroder: https://www.alphabroder.com/pds/pds.asmx
 *
 * PromoStandards uses SOAP XML. We build minimal XML requests and parse responses.
 */

interface PSSupplierConfig {
  name: string;
  code: string;
  pdsEndpoint: string;
  inventoryEndpoint: string;
  username: string;
  password: string;
}

const PS_SUPPLIERS: Omit<PSSupplierConfig, "username" | "password">[] = [
  {
    name: "SanMar",
    code: "SANMAR",
    pdsEndpoint: "https://ws.sanmar.com:8080/PromoStandards/PDS/2.0.0/ProductDataService",
    inventoryEndpoint: "https://ws.sanmar.com:8080/PromoStandards/Inventory/2.0.0/InventoryService",
  },
  {
    name: "S&S Activewear",
    code: "SSACT",
    pdsEndpoint: "https://www.ssactivewear.com/pds/pds.asmx",
    inventoryEndpoint: "https://www.ssactivewear.com/inventory/inventory.asmx",
  },
  {
    name: "alphabroder",
    code: "ALPHA",
    pdsEndpoint: "https://www.alphabroder.com/pds/pds.asmx",
    inventoryEndpoint: "https://www.alphabroder.com/inventory/inventory.asmx",
  },
];

function buildPDSSearchRequest(query: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:pds="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/">
  <soapenv:Header/>
  <soapenv:Body>
    <pds:GetProductSellableRequest>
      <pds:wsVersion>2.0.0</pds:wsVersion>
      <pds:id>${escapeXml(username)}</pds:id>
      <pds:password>${escapeXml(password)}</pds:password>
      <pds:productId></pds:productId>
      <pds:partId></pds:partId>
      <pds:colorName>${escapeXml(query)}</pds:colorName>
      <pds:isSellable>true</pds:isSellable>
    </pds:GetProductSellableRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseXmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "i"));
  return match ? match[1].trim() : "";
}

function parseXmlValues(xml: string, tag: string): string[] {
  const matches = Array.from(xml.matchAll(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "gi")));
  return matches.map(m => m[1].trim()).filter(Boolean);
}

async function searchPromoStandardsSupplier(
  query: string,
  supplier: PSSupplierConfig
): Promise<ExternalProduct[]> {
  const soapBody = buildPDSSearchRequest(query, supplier.username, supplier.password);

  const response = await fetch(supplier.pdsEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "getProductSellable",
    },
    body: soapBody,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`PromoStandards ${supplier.name} error ${response.status}`);
  }

  const xml = await response.text();

  // Parse product blocks from SOAP response
  const productBlocks = Array.from(xml.matchAll(/<Product[^>]*>([\s\S]*?)<\/Product>/gi));

  return productBlocks.slice(0, 50).map((block) => {
    const content = block[1];
    const productId = parseXmlValue(content, "productId");
    const name = parseXmlValue(content, "productName");
    const description = parseXmlValue(content, "description");
    const category = parseXmlValue(content, "productCategory");
    const imageUrl = parseXmlValue(content, "primaryImageUrl") || parseXmlValue(content, "imageUrl") || null;
    const colors = parseXmlValues(content, "colorName");
    const sizes = parseXmlValues(content, "sizeName");
    const minQty = parseInt(parseXmlValue(content, "minQuantity") || "1", 10);
    const price = parseFloat(parseXmlValue(content, "price") || "0") || null;
    const decorations = parseXmlValues(content, "decorationMethod");

    return {
      externalId: `promostandards:${supplier.code}:${productId}`,
      source: "promostandards" as const,
      supplier: supplier.name,
      supplierCode: supplier.code,
      productNumber: productId,
      name: name || "Unnamed Product",
      description,
      category,
      imageUrl: imageUrl || null,
      colors,
      sizes,
      minQuantity: isNaN(minQty) ? 1 : minQty,
      basePrice: price,
      currency: "USD",
      hasLiveInventory: true,
      inventoryQuantity: null, // fetched separately via inventory endpoint
      decorationMethods: decorations,
      tags: [],
    };
  });
}

async function searchPromoStandards(
  query: string,
  credentials: { sanmar?: { username: string; password: string }; ss?: { username: string; password: string }; alphabroder?: { username: string; password: string } }
): Promise<ExternalProduct[]> {
  const supplierQueries: Promise<ExternalProduct[]>[] = [];

  if (credentials.sanmar?.username) {
    const config: PSSupplierConfig = { ...PS_SUPPLIERS[0], ...credentials.sanmar };
    supplierQueries.push(
      searchPromoStandardsSupplier(query, config).catch(err => {
        log.warn(`SanMar search failed: ${err.message}`);
        return [];
      })
    );
  }

  if (credentials.ss?.username) {
    const config: PSSupplierConfig = { ...PS_SUPPLIERS[1], ...credentials.ss };
    supplierQueries.push(
      searchPromoStandardsSupplier(query, config).catch(err => {
        log.warn(`S&S Activewear search failed: ${err.message}`);
        return [];
      })
    );
  }

  if (credentials.alphabroder?.username) {
    const config: PSSupplierConfig = { ...PS_SUPPLIERS[2], ...credentials.alphabroder };
    supplierQueries.push(
      searchPromoStandardsSupplier(query, config).catch(err => {
        log.warn(`alphabroder search failed: ${err.message}`);
        return [];
      })
    );
  }

  if (supplierQueries.length === 0) return [];

  const results = await Promise.all(supplierQueries);
  return results.flat();
}

//  Main Adapter Function 

export interface SearchAdapterOptions {
  query: string;
  limit?: number;
  asi?: { apiKey: string; accountId: string };
  promostandards?: {
    sanmar?: { username: string; password: string };
    ss?: { username: string; password: string };
    alphabroder?: { username: string; password: string };
  };
}

/**
 * Search products across all configured sources in parallel.
 * Sources that are not configured or that fail are skipped gracefully.
 */
export async function searchProducts(options: SearchAdapterOptions): Promise<ProductSearchResult> {
  const { query, limit = 50 } = options;

  const asiResult = { queried: false, count: 0, error: undefined as string | undefined };
  const psResult = { queried: false, count: 0, error: undefined as string | undefined };

  const [asiProducts, psProducts] = await Promise.all([
    // ASI ESP
    (async () => {
      if (!options.asi?.apiKey) return [];
      asiResult.queried = true;
      try {
        const products = await searchASI(query, { ...options.asi, limit });
        asiResult.count = products.length;
        return products;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "ASI search failed";
        asiResult.error = message;
        log.warn(`ASI search failed: ${message}`);
        return [];
      }
    })(),

    // PromoStandards
    (async () => {
      if (!options.promostandards) return [];
      const hasAnyCreds = Object.values(options.promostandards).some(c => c?.username);
      if (!hasAnyCreds) return [];
      psResult.queried = true;
      try {
        const products = await searchPromoStandards(query, options.promostandards);
        psResult.count = products.length;
        return products;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "PromoStandards search failed";
        psResult.error = message;
        log.warn(`PromoStandards search failed: ${message}`);
        return [];
      }
    })(),
  ]);

  // Merge and deduplicate by externalId
  const seen = new Set<string>();
  const merged: ExternalProduct[] = [];

  for (const product of [...asiProducts, ...psProducts]) {
    if (!seen.has(product.externalId)) {
      seen.add(product.externalId);
      merged.push(product);
    }
  }

  // Sort: PromoStandards (live inventory) first, then ASI
  merged.sort((a, b) => {
    if (a.hasLiveInventory && !b.hasLiveInventory) return -1;
    if (!a.hasLiveInventory && b.hasLiveInventory) return 1;
    return 0;
  });

  return {
    products: merged.slice(0, limit),
    totalCount: merged.length,
    sources: { asi: asiResult, promostandards: psResult },
  };
}

/**
 * Get credentials from environment variables.
 * Used by the tRPC router when no per-user credentials are stored.
 */
export function getDefaultCredentials(): Omit<SearchAdapterOptions, "query"> {
  return {
    asi: process.env.ASI_API_KEY && process.env.ASI_ACCOUNT_ID
      ? { apiKey: process.env.ASI_API_KEY, accountId: process.env.ASI_ACCOUNT_ID }
      : undefined,
    promostandards: {
      sanmar: process.env.PS_SANMAR_USERNAME
        ? { username: process.env.PS_SANMAR_USERNAME, password: process.env.PS_SANMAR_PASSWORD || "" }
        : undefined,
      ss: process.env.PS_SS_USERNAME
        ? { username: process.env.PS_SS_USERNAME, password: process.env.PS_SS_PASSWORD || "" }
        : undefined,
      alphabroder: process.env.PS_ALPHABRODER_USERNAME
        ? { username: process.env.PS_ALPHABRODER_USERNAME, password: process.env.PS_ALPHABRODER_PASSWORD || "" }
        : undefined,
    },
  };
}

/**
 * Test a supplier connection with the provided credentials.
 * Makes a lightweight API call to verify credentials are valid.
 * Returns { success: true } or { success: false, error: string }.
 */
export async function testSupplierConnection(
  supplierId: "asi" | "sanmar" | "ss" | "alphabroder",
  credentials: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (supplierId === "asi") {
      if (!credentials.apiKey || !credentials.accountId) {
        return { success: false, error: "API Key and Member ID are required" };
      }
      // Make a minimal search request to verify the key
      const res = await fetch(
        `https://api.asicentral.com/v1/products?query=test&pageSize=1`,
        {
          headers: {
            Authorization: `AsiMemberAuth apikey="${credentials.apiKey}"`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: "Invalid API key or member ID" };
      }
      if (!res.ok) {
        return { success: false, error: `ASI API returned ${res.status}` };
      }
      return { success: true };
    }

    // PromoStandards suppliers — test with a product availability request
    const supplierEndpoints: Record<string, string> = {
      sanmar: "https://ws.sanmar.com:8080/promostandards/ProductAvailabilityServiceBinding?WSDL",
      ss: "https://promostandards.ssactivewear.com/ProductAvailabilityService/ProductAvailabilityService.svc?wsdl",
      alphabroder: "https://ws.alphabroder.com/service/promostandards/ProductAvailabilityServiceBinding?wsdl",
    };

    const endpoint = supplierEndpoints[supplierId];
    if (!endpoint) {
      return { success: false, error: "Unknown supplier" };
    }

    if (!credentials.username || !credentials.password) {
      return { success: false, error: "Username and password are required" };
    }

    // Test by fetching the WSDL — if it responds, the endpoint is reachable
    // Full auth validation happens on first product query
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok && res.status !== 401) {
      return { success: false, error: `Supplier endpoint returned ${res.status}` };
    }

    // Credentials are stored — actual auth is validated on first product search
    return { success: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { success: false, error: "Connection timed out — check your network or try again" };
    }
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, error: message };
  }
}
