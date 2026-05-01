/**
 * SanMarInventoryService — Client for SanMar Canada PromoStandards Inventory 2.0.0 SOAP API.
 *
 * Endpoint: https://edi.atc-apparel.com/pstd/inventory2.0/InventoryServiceV2.php
 * Spec: PromoStandards Inventory Service v2.0.0 (GetInventoryLevelsRequest).
 *
 * Auth: account-id + password from SANMAR_ACCOUNT_ID / SANMAR_PASSWORD env vars
 * (the same credentials SanMarBulkService uses). Credentials live in the SOAP
 * body — there is no WS-Security header.
 *
 * Unlike the bulk endpoint (one call per day), this is a per-style live lookup
 * intended for product detail pages. Callers should pass the style number
 * (e.g. "108085") as productId.
 */

import { parseStringPromise, processors } from "xml2js";
import { getLogger } from "../utils/logger";

const log = getLogger("sanmar-inventory");

const ENDPOINT = "https://edi.atc-apparel.com/pstd/inventory2.0/InventoryServiceV2.php";
const WS_VERSION = "2.0.0";

// SanMar Canada warehouse identifiers (from the inventory feed).
const WAREHOUSE_NAMES: Record<string, string> = {
  "1": "Vancouver",
  "2": "Mississauga",
  "4": "Calgary",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SanMarInventoryLocation {
  inventoryLocationId: string;
  inventoryLocationName: string;
  inventoryLocationQuantity: number;
}

export interface SanMarInventoryPart {
  partId: string;
  partColor: string;
  labelSize: string;
  partDescription: string;
  quantityAvailable: number;
  locations: SanMarInventoryLocation[];
}

export interface SanMarInventoryResponse {
  productId: string;
  totalQuantityAvailable: number;
  parts: SanMarInventoryPart[];
  warehouseTotals: SanMarInventoryLocation[];
  fetchedAt: string;
}

type RawXmlNode = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickString(node: RawXmlNode | undefined, key: string): string {
  if (!node) return "";
  const v = node[key];
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "_" in (v as object)) {
    const inner = (v as { _?: unknown })._;
    return typeof inner === "string" ? inner.trim() : "";
  }
  return "";
}

function pickNumber(node: RawXmlNode | undefined, key: string): number {
  const s = pickString(node, key);
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function asArray<T = RawXmlNode>(v: unknown): T[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "object") return [v as T];
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
// SanMarInventoryService
// ─────────────────────────────────────────────────────────────────────────────

export interface SanMarCredentials {
  accountId: string;
  password: string;
}

export class SanMarInventoryService {
  private readonly accountId: string;
  private readonly password: string;

  /**
   * Pass `creds` to use per-org credentials (decrypted from the
   * supplierCredentials table); omit to fall back to the platform env
   * vars. See SanMarBulkService for the same pattern.
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
      log.warn("SANMAR_ACCOUNT_ID / SANMAR_PASSWORD not set — SanMar inventory lookups will fail");
    }
  }

  private buildEnvelope(productId: string): string {
    return [
      "<?xml version='1.0' encoding='UTF-8'?>",
      "<Envelope xmlns='http://schemas.xmlsoap.org/soap/envelope/'>",
      "  <Body>",
      "    <GetInventoryLevelsRequest xmlns='http://www.promostandards.org/WSDL/Inventory/2.0.0/'>",
      `      <wsVersion>${WS_VERSION}</wsVersion>`,
      `      <id>${escapeXml(this.accountId)}</id>`,
      `      <password>${escapeXml(this.password)}</password>`,
      `      <productId>${escapeXml(productId)}</productId>`,
      "    </GetInventoryLevelsRequest>",
      "  </Body>",
      "</Envelope>",
    ].join("\n");
  }

  private async fetchXml(productId: string): Promise<string> {
    if (!this.accountId || !this.password) {
      throw new Error("SanMar credentials not configured (SANMAR_ACCOUNT_ID / SANMAR_PASSWORD)");
    }

    const body = this.buildEnvelope(productId);
    log.info(`SanMar inventory SOAP request → productId=${productId}`);

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "http://www.promostandards.org/WSDL/Inventory/2.0.0/GetInventoryLevels",
        "Accept": "text/xml, application/xml",
      },
      body,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`SanMar inventory SOAP error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    return response.text();
  }

  /**
   * Look up live inventory for a single style. Returns one entry per part
   * (size/color combo) plus a roll-up of total stock per warehouse across
   * all parts.
   */
  async getInventoryLevels(productId: string): Promise<SanMarInventoryResponse> {
    const trimmed = productId.trim();
    if (!trimmed) {
      throw new Error("getInventoryLevels: productId is required");
    }

    const xml = await this.fetchXml(trimmed);

    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [processors.stripPrefix],
    }) as RawXmlNode;

    const envelope = parsed.Envelope as RawXmlNode | undefined;
    const bodyNode = envelope?.Body as RawXmlNode | undefined;

    const fault = bodyNode?.Fault as RawXmlNode | undefined;
    if (fault) {
      const faultString = pickString(fault, "faultstring") || JSON.stringify(fault);
      throw new Error(`SanMar SOAP fault: ${faultString}`);
    }

    const responseNode = (bodyNode?.GetInventoryLevelsResponse
      ?? bodyNode?.GetInventoryLevelsResult) as RawXmlNode | undefined;

    if (!responseNode) {
      log.warn(
        `SanMar inventory response missing GetInventoryLevelsResponse — body keys: [${Object.keys(bodyNode ?? {}).join(", ")}]`,
      );
      return {
        productId: trimmed,
        totalQuantityAvailable: 0,
        parts: [],
        warehouseTotals: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    // The PromoStandards Inventory 2.0.0 envelope shape (after stripPrefix):
    //   GetInventoryLevelsResponse
    //     productId
    //     Inventory
    //       PartInventoryArray
    //         PartInventory (one per size/color, may repeat)
    //           partId, partColor, labelSize, partDescription, quantityAvailable
    //           InventoryLocationArray
    //             InventoryLocation (repeats per warehouse)
    //               inventoryLocationId
    //               inventoryLocationName
    //               inventoryLocationQuantity { Quantity { value } | value }
    const inventoryNode = (responseNode.Inventory ?? responseNode) as RawXmlNode;
    const partArrayNode = inventoryNode.PartInventoryArray as RawXmlNode | undefined;
    const partNodes = asArray<RawXmlNode>(partArrayNode?.PartInventory ?? inventoryNode.PartInventory);

    const responseProductId = pickString(responseNode, "productId")
      || pickString(inventoryNode, "productId")
      || trimmed;

    const parts: SanMarInventoryPart[] = [];
    const warehouseRollup = new Map<string, SanMarInventoryLocation>();
    let total = 0;

    for (const partNode of partNodes) {
      const partId = pickString(partNode, "partId");
      const partColor = pickString(partNode, "partColor");
      const labelSize = pickString(partNode, "labelSize");
      const partDescription = pickString(partNode, "partDescription");
      const partQty = pickNumber(partNode, "quantityAvailable");

      const locArrayNode = partNode.InventoryLocationArray as RawXmlNode | undefined;
      const locNodes = asArray<RawXmlNode>(locArrayNode?.InventoryLocation ?? partNode.InventoryLocation);

      const locations: SanMarInventoryLocation[] = locNodes.map((loc) => {
        const id = pickString(loc, "inventoryLocationId");
        // The PromoStandards spec wraps the warehouse stock in an
        // <inventoryLocationQuantity><Quantity><value>N</value></Quantity></...>
        // sub-tree, but several distributors flatten it to a scalar tag.
        // Handle both shapes.
        let qty = 0;
        const qtyRaw = loc.inventoryLocationQuantity;
        if (qtyRaw && typeof qtyRaw === "object") {
          const inner = (qtyRaw as RawXmlNode).Quantity as RawXmlNode | undefined ?? (qtyRaw as RawXmlNode);
          qty = pickNumber(inner, "value");
          if (!qty) qty = pickNumber(qtyRaw as RawXmlNode, "value");
        } else if (qtyRaw != null) {
          const n = Number(qtyRaw);
          qty = Number.isFinite(n) ? n : 0;
        }
        const name = pickString(loc, "inventoryLocationName") || WAREHOUSE_NAMES[id] || id;
        return {
          inventoryLocationId: id,
          inventoryLocationName: name,
          inventoryLocationQuantity: qty,
        };
      });

      total += partQty;
      for (const loc of locations) {
        const prev = warehouseRollup.get(loc.inventoryLocationId);
        if (prev) {
          prev.inventoryLocationQuantity += loc.inventoryLocationQuantity;
        } else {
          warehouseRollup.set(loc.inventoryLocationId, { ...loc });
        }
      }

      parts.push({
        partId,
        partColor,
        labelSize,
        partDescription,
        quantityAvailable: partQty,
        locations,
      });
    }

    const warehouseTotals = Array.from(warehouseRollup.values()).sort((a, b) =>
      a.inventoryLocationId.localeCompare(b.inventoryLocationId),
    );

    log.info(
      `SanMar inventory: productId=${responseProductId}, parts=${parts.length}, total=${total}, warehouses=${warehouseTotals.length}`,
    );

    return {
      productId: responseProductId,
      totalQuantityAvailable: total,
      parts,
      warehouseTotals,
      fetchedAt: new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const sanMarInventoryService = new SanMarInventoryService();
