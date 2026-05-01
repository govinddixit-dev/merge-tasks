/**
 * SanMarBulkService — Client for SanMar Canada Bulk Data SOAP API.
 *
 * Endpoint: https://edi.atc-apparel.com/bulk-data/BulkDataService.php
 *
 * Auth is account-id + password, set in .env as SANMAR_ACCOUNT_ID and
 * SANMAR_PASSWORD. SanMar enforces a one-call-per-day rate limit at the
 * credential level — schedule one bulk pull per 24h, not per supplier row.
 *
 * The service returns products in the same `PSRestfulProduct` shape that
 * `PSRestfulService.getProducts` returns so `supplierSyncEngine` (and any
 * upsert path) can call either source interchangeably.
 *
 * Discontinued products (discountCode of S, M, X, or C) are filtered out
 * before normalization.
 */

import { parseStringPromise, processors } from "xml2js";
import { getLogger } from "../utils/logger";
import type { PSRestfulProduct } from "./PSRestfulService";

const log = getLogger("sanmar-bulk");

const ENDPOINT = "https://edi.atc-apparel.com/bulk-data/BulkDataService.php";
const WS_VERSION = "1.0.0";
const DISCONTINUED_CODES = new Set(["S", "M", "X", "C"]);

// ─────────────────────────────────────────────────────────────────────────────
// Types — raw SanMar bulk record (post xml2js parse, before normalization)
// ─────────────────────────────────────────────────────────────────────────────

export interface SanMarBulkProduct {
  productId: string;
  productName: string;
  style: string;
  size: string;
  swatchColor: string;
  brand: string;
  image: string;
  weight: string;
  quantity: string;
  price: string;
  salePrice: string;
  discountCode: string;
}

// xml2js with explicitArray:false returns scalar tag content as string,
// repeated tags as arrays. We treat every field as `unknown` and coerce.
type RawXmlNode = Record<string, unknown>;

function pickString(node: RawXmlNode | undefined, key: string): string {
  if (!node) return "";
  const v = node[key];
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // xml2js sometimes wraps content in { _: "value", $: { ... } }
  if (typeof v === "object" && "_" in (v as object)) {
    const inner = (v as { _?: unknown })._;
    return typeof inner === "string" ? inner.trim() : "";
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// SanMarBulkService
// ─────────────────────────────────────────────────────────────────────────────

export interface SanMarCredentials {
  accountId: string;
  password: string;
}

export class SanMarBulkService {
  private readonly accountId: string;
  private readonly password: string;

  /**
   * If `creds` is supplied, the service uses those values verbatim. This is
   * how per-org credentials reach the service — sanMarBulkSync looks up the
   * org's row in supplierCredentials, decrypts it, and constructs a
   * dedicated SanMarBulkService for that org's run.
   *
   * If `creds` is omitted, the service falls back to the env-var pair so
   * existing platform-managed callers (e.g. Otentik Brand pre-seed) keep
   * working without code changes.
   */
  constructor(creds?: SanMarCredentials) {
    if (creds) {
      this.accountId = creds.accountId;
      this.password = creds.password;
    } else {
      this.accountId = process.env.SANMAR_ACCOUNT_ID ?? "";
      this.password = process.env.SANMAR_PASSWORD ?? "";
    }

    if (!this.accountId || !this.password) {
      log.warn("SANMAR_ACCOUNT_ID / SANMAR_PASSWORD not set — SanMar bulk sync will fail");
    }
  }

  /**
   * Build the SOAP envelope. Credentials live in the request body
   * (SanMar's contract — there is no WS-Security header).
   */
  private buildEnvelope(): string {
    return [
      "<?xml version='1.0' encoding='UTF-8'?>",
      "<Envelope xmlns='http://schemas.xmlsoap.org/soap/envelope/'>",
      "  <Body>",
      "    <GetBulkDataRequest xmlns='https://edi.atc-apparel.com/bulk-data/'>",
      `      <wsVersion>${WS_VERSION}</wsVersion>`,
      `      <id>${escapeXml(this.accountId)}</id>`,
      `      <password>${escapeXml(this.password)}</password>`,
      "    </GetBulkDataRequest>",
      "  </Body>",
      "</Envelope>",
    ].join("\n");
  }

  /**
   * Issue the SOAP call and return the raw XML body.
   */
  private async fetchXml(): Promise<string> {
    if (!this.accountId || !this.password) {
      throw new Error("SanMar credentials not configured (SANMAR_ACCOUNT_ID / SANMAR_PASSWORD)");
    }

    const body = this.buildEnvelope();
    log.info("SanMar bulk SOAP request →");

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        // SanMar's PHP backend doesn't enforce SOAPAction, but sending it
        // matches the documented contract and is harmless if unset.
        "SOAPAction": "https://edi.atc-apparel.com/bulk-data/GetBulkDataRequest",
        "Accept": "text/xml, application/xml",
      },
      body,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`SanMar bulk SOAP error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    return response.text();
  }

  /**
   * Parse the SOAP response and return the list of raw bulk products
   * (still in SanMar's native field naming). Discontinued products are
   * dropped here so callers never see them.
   */
  async getRawProducts(): Promise<SanMarBulkProduct[]> {
    const xml = await this.fetchXml();

    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
      // Strip the namespace prefix from tags (e.g. "ns2:GetBulkDataResponse"
      // → "GetBulkDataResponse", "ns1:Product" → "Product") so traversal
      // isn't sensitive to which prefix the server picked.
      tagNameProcessors: [processors.stripPrefix],
    }) as RawXmlNode;

    log.info(`SanMar bulk parse: top-level keys = [${Object.keys(parsed).join(", ")}]`);

    const envelope = parsed.Envelope as RawXmlNode | undefined;
    const bodyNode = envelope?.Body as RawXmlNode | undefined;
    const responseNode = bodyNode?.GetBulkDataResponse as RawXmlNode | undefined
      ?? bodyNode?.GetBulkDataResult as RawXmlNode | undefined;

    if (!responseNode) {
      // Some SanMar deployments return a SOAP fault rather than an empty
      // response — surface a useful error in that case.
      const fault = bodyNode?.Fault as RawXmlNode | undefined;
      if (fault) {
        const faultString = pickString(fault, "faultstring") || JSON.stringify(fault);
        throw new Error(`SanMar SOAP fault: ${faultString}`);
      }
      log.warn(
        `SanMar bulk response missing GetBulkDataResponse — body keys: [${Object.keys(bodyNode ?? {}).join(", ")}]`,
      );
      return [];
    }

    const productNodes = collectProductNodes(responseNode);

    if (productNodes.length === 0) {
      log.warn(
        `SanMar bulk: 0 product nodes under GetBulkDataResponse — response keys: [${Object.keys(responseNode).join(", ")}]`,
      );
    }

    const out: SanMarBulkProduct[] = [];
    let discontinuedCount = 0;
    for (const node of productNodes) {
      const discountCode = pickString(node, "discountCode").toUpperCase();
      if (DISCONTINUED_CODES.has(discountCode)) {
        discontinuedCount++;
        continue;
      }
      out.push({
        productId: pickString(node, "productId"),
        productName: pickString(node, "productName"),
        style: pickString(node, "style"),
        size: pickString(node, "size"),
        swatchColor: pickString(node, "swatchColor"),
        brand: pickString(node, "brand"),
        image: pickString(node, "image"),
        weight: pickString(node, "weight"),
        quantity: pickString(node, "quantity"),
        price: pickString(node, "price"),
        salePrice: pickString(node, "salePrice"),
        discountCode,
      });
    }

    log.info(`SanMar bulk: parsed ${out.length} active products (filtered ${discontinuedCount} discontinued)`);
    return out;
  }

  /**
   * Return products in the same shape PSRestfulService.getProducts returns,
   * so supplierSyncEngine and other consumers can treat the two services as
   * interchangeable. The PSRestful contract supplies productId, productName,
   * description, supplierCode, categoryName?, imageUrl? — we map SanMar's
   * fields into those slots and stash size/color/brand/quantity/price into
   * the description (a single, readable line) so no information is lost.
   *
   * SanMar emits one row per (style, size, color) combination, so the rows
   * are first collapsed by style before mapping — one PSRestfulProduct per
   * style, with sizes and colors aggregated into the description.
   */
  async getProducts(): Promise<PSRestfulProduct[]> {
    const raw = await this.getRawProducts();
    log.info(`SanMar getProducts: raw array length=${raw.length}`);
    for (let i = 0; i < raw.length; i++) {
      log.info(`SanMar getProducts: raw[${i}] = ${JSON.stringify(raw[i])}`);
    }

    const collapsed = collapseByStyle(raw);
    log.info(`SanMar getProducts: after collapseByStyle length=${collapsed.length} (dropped ${raw.length - dedupeCount(raw)} non-first duplicates, ${emptyIdCount(raw)} empty-productId rows)`);
    for (let i = 0; i < collapsed.length; i++) {
      log.info(`SanMar getProducts: collapsed[${i}] = ${JSON.stringify(collapsed[i])}`);
    }

    const mapped = collapsed.map(toPSRestfulProduct);
    log.info(`SanMar getProducts: after toPSRestfulProduct length=${mapped.length}`);
    for (let i = 0; i < mapped.length; i++) {
      log.info(`SanMar getProducts: ps[${i}] = ${JSON.stringify(mapped[i])}`);
    }
    return mapped;
  }
}

function emptyIdCount(raw: SanMarBulkProduct[]): number {
  return raw.reduce((n, r) => (r.productId ? n : n + 1), 0);
}

function dedupeCount(raw: SanMarBulkProduct[]): number {
  const ids = new Set<string>();
  for (const r of raw) if (r.productId) ids.add(r.productId);
  return ids.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group raw bulk records by productId so each PSRestfulProduct represents
 * a single style. SanMar emits one row per (style, size, color) combo, but
 * the PSRestful product model is one entry per style — collapse on the way
 * out. Sizes and swatchColors are aggregated as comma-separated lists in
 * the description; the first row's image/price wins.
 */
export function collapseByStyle(raw: SanMarBulkProduct[]): SanMarBulkProduct[] {
  const byId = new Map<string, SanMarBulkProduct & { sizes: Set<string>; colors: Set<string> }>();
  for (const r of raw) {
    if (!r.productId) {
      log.warn(`SanMar collapseByStyle: dropping row with empty productId: ${JSON.stringify(r)}`);
      continue;
    }
    const existing = byId.get(r.productId);
    if (existing) {
      if (r.size) existing.sizes.add(r.size);
      if (r.swatchColor) existing.colors.add(r.swatchColor);
      continue;
    }
    byId.set(r.productId, {
      ...r,
      sizes: new Set(r.size ? [r.size] : []),
      colors: new Set(r.swatchColor ? [r.swatchColor] : []),
    });
  }
  return Array.from(byId.values()).map((p) => ({
    ...p,
    size: Array.from(p.sizes).join(", "),
    swatchColor: Array.from(p.colors).join(", "),
  }));
}

function toPSRestfulProduct(p: SanMarBulkProduct): PSRestfulProduct {
  // Build a one-line description that preserves the bulk fields PSRestful
  // doesn't have a slot for. Skipping any blank fields keeps the line tidy.
  const parts: string[] = [];
  if (p.brand) parts.push(`Brand: ${p.brand}`);
  if (p.style) parts.push(`Style: ${p.style}`);
  if (p.swatchColor) parts.push(`Color: ${p.swatchColor}`);
  if (p.size) parts.push(`Size: ${p.size}`);
  if (p.weight) parts.push(`Weight: ${p.weight}`);
  if (p.quantity) parts.push(`Available: ${p.quantity}`);
  if (p.price) parts.push(`Price: ${p.price}`);
  if (p.salePrice && p.salePrice !== p.price) parts.push(`Sale: ${p.salePrice}`);
  return {
    productId: p.productId,
    productName: p.productName,
    description: parts.join(" · "),
    supplierCode: "sanmar",
    imageUrl: p.image || undefined,
  };
}

function collectProductNodes(container: RawXmlNode | undefined): RawXmlNode[] {
  if (!container) return [];
  // Common shapes (after stripPrefix):
  //   { Product: [...] }                              — repeated child (xml2js array)
  //   { Product: {...} }                              — single child (xml2js collapses to object)
  //   { ProductInventoryArray: { Product: [...] } }   — SanMar bulk wrapper
  //   { ProductArray: { Product: [...] } }            — generic PromoStandards wrapper
  //   { Products: { Product: [...] } }                — alt wrapper
  // xml2js with explicitArray:false returns a single child as an object, not
  // a one-element array — force-coerce so downstream iteration always sees an array.
  const raw = container.Product as unknown;
  if (raw != null && (Array.isArray(raw) || typeof raw === "object")) {
    return (Array.isArray(raw) ? raw : [raw]) as RawXmlNode[];
  }

  const wrapped = (container.ProductInventoryArray
    ?? container.ProductArray
    ?? container.Products) as RawXmlNode | undefined;
  if (wrapped) return collectProductNodes(wrapped);

  return [];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const sanMarBulkService = new SanMarBulkService();
