/**
 * supplierGrouping.ts — AI-powered three-tier supplier grouping engine.
 *
 * Takes order items (with linked product metadata) and groups them into
 * supplier buckets for purchase order generation.
 *
 * Three tiers:
 *   1. Exact — supplierCode + externalSource match → 100% confidence
 *   2. Fuzzy — normalized supplier name match → 85-95% confidence
 *   3. LLM  — AI inference from product name/SKU/brand → 50-80% confidence
 *
 * Products with confidence < 50 get flagged for manual assignment.
 */

import { normalizeSupplierName, areSameSupplier } from "./supplierNormalizer";
import { safeLLM } from "../_core/safeLLM";
import { getLogger } from "./logger";

const log = getLogger("supplier-grouping");

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrderItemWithProduct {
  orderItemId: number;
  productId: number;
  productName: string;
  sku: string | null;
  category: string | null;
  imageUrl: string | null;
  basePrice: string | null;
  unitPrice: string | null;
  quantity: number;
  color: string | null;
  size: string | null;
  decorationType: string | null;
  decorationLocation: string | null;
  logoUrl: string | null;
  // Supplier metadata from products table
  supplier: string | null;
  supplierSku: string | null;
  supplierCode: string | null;
  externalSource: string | null;   // "asi" | "promostandards" | null
  source: string | null;           // "manual" | "csv" | "api" | "asi" | "sage" | "promostandards"
}

export interface SupplierBucket {
  supplierName: string;
  supplierCode: string | null;
  supplierSource: string | null;
  confidence: number;              // 0-100
  reason: string;
  items: OrderItemWithProduct[];
  needsManualAssignment: boolean;
}

// ── Main grouping function ──────────────────────────────────────────────────

export async function groupBySupplier(
  items: OrderItemWithProduct[],
  options?: { useLLM?: boolean },
): Promise<SupplierBucket[]> {
  const useLLM = options?.useLLM !== false; // default true
  const buckets = new Map<string, SupplierBucket>();
  const unmatched: OrderItemWithProduct[] = [];

  // ── Tier 1: Exact match ───────────────────────────────────────────────
  for (const item of items) {
    if (item.supplierCode && item.externalSource) {
      const key = `${item.supplierCode}::${item.externalSource}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        buckets.set(key, {
          supplierName: item.supplier || item.supplierCode,
          supplierCode: item.supplierCode,
          supplierSource: item.externalSource,
          confidence: 100,
          reason: `Matched by supplier code '${item.supplierCode}' from ${item.externalSource} catalog`,
          items: [item],
          needsManualAssignment: false,
        });
      }
      continue;
    }

    // Exact supplier name match
    if (item.supplier) {
      const normalized = normalizeSupplierName(item.supplier);
      const existingKey = Array.from(buckets.keys()).find((k) => {
        const bucket = buckets.get(k)!;
        return normalizeSupplierName(bucket.supplierName) === normalized;
      });

      if (existingKey) {
        buckets.get(existingKey)!.items.push(item);
      } else {
        const key = `name::${normalized}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.items.push(item);
        } else {
          buckets.set(key, {
            supplierName: item.supplier,
            supplierCode: item.supplierCode || null,
            supplierSource: item.source || null,
            confidence: 100,
            reason: `Matched by exact supplier name '${item.supplier}'`,
            items: [item],
            needsManualAssignment: false,
          });
        }
      }
      continue;
    }

    // No supplier metadata — goes to tier 2/3
    unmatched.push(item);
  }

  // ── Tier 2: Fuzzy match unmatched items against existing buckets ───────
  const stillUnmatched: OrderItemWithProduct[] = [];

  for (const item of unmatched) {
    if (item.supplier) {
      // Has a name but didn't exact-match in tier 1 (shouldn't happen, but safety)
      let matched = false;
      for (const [key, bucket] of Array.from(buckets)) {
        if (areSameSupplier(item.supplier, bucket.supplierName)) {
          bucket.items.push(item);
          // Lower confidence since it's fuzzy
          bucket.confidence = Math.min(bucket.confidence, 90);
          bucket.reason = `Fuzzy matched '${item.supplier}' to '${bucket.supplierName}' (normalized)`;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Create new bucket with fuzzy confidence
        const normalized = normalizeSupplierName(item.supplier);
        buckets.set(`fuzzy::${normalized}`, {
          supplierName: item.supplier,
          supplierCode: null,
          supplierSource: item.source || null,
          confidence: 85,
          reason: `Supplier name '${item.supplier}' — no code match, name-based grouping`,
          items: [item],
          needsManualAssignment: false,
        });
      }
    } else {
      stillUnmatched.push(item);
    }
  }

  // ── Tier 3: LLM inference for products with NO supplier data ──────────
  if (stillUnmatched.length > 0 && useLLM) {
    log.info(`Tier 3: ${stillUnmatched.length} items need LLM supplier inference`);

    try {
      const productDescriptions = stillUnmatched.map((item, i) => (
        `${i + 1}. "${item.productName}" — category: ${item.category || "unknown"}, SKU: ${item.sku || "none"}`
      )).join("\n");

      const prompt = `You are a promotional products industry expert. Given these products, identify the most likely supplier for each.

Products:
${productDescriptions}

For each product, respond with a JSON array (no markdown, no backticks):
[
  { "productIndex": 1, "supplierName": "SanMar", "confidence": 75, "reason": "Hanes brand is typically distributed through SanMar" },
  ...
]

If you cannot determine the supplier, set supplierName to "Unknown" and confidence to 0.
Only respond with valid JSON.`;

      const result = await safeLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 1000,
      });

      const rawContent = result?.choices?.[0]?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.map(c => "text" in c ? c.text : "").join("") : "";
      // Parse JSON from response (strip any markdown fencing)
      const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const predictions = JSON.parse(jsonStr) as Array<{
        productIndex: number;
        supplierName: string;
        confidence: number;
        reason: string;
      }>;

      for (const pred of predictions) {
        const item = stillUnmatched[pred.productIndex - 1];
        if (!item) continue;

        const confidence = Math.min(Math.max(pred.confidence, 0), 100);
        const normalized = normalizeSupplierName(pred.supplierName);

        // Try to merge with existing bucket
        let merged = false;
        for (const [, bucket] of Array.from(buckets)) {
          if (areSameSupplier(pred.supplierName, bucket.supplierName)) {
            bucket.items.push(item);
            bucket.confidence = Math.min(bucket.confidence, confidence);
            merged = true;
            break;
          }
        }

        if (!merged) {
          const key = `llm::${normalized}::${pred.productIndex}`;
          const existingLLMBucket = Array.from(buckets.entries()).find(
            ([k, b]) => k.startsWith("llm::") && areSameSupplier(b.supplierName, pred.supplierName),
          );

          if (existingLLMBucket) {
            existingLLMBucket[1].items.push(item);
            existingLLMBucket[1].confidence = Math.min(existingLLMBucket[1].confidence, confidence);
          } else {
            buckets.set(key, {
              supplierName: pred.supplierName,
              supplierCode: null,
              supplierSource: null,
              confidence,
              reason: pred.reason,
              items: [item],
              needsManualAssignment: confidence < 50,
            });
          }
        }
      }
    } catch (err) {
      log.warn("LLM supplier inference failed, marking items for manual assignment:", err);
      // Fall back: put all unmatched in an "Unknown" bucket
      if (stillUnmatched.length > 0) {
        buckets.set("unknown", {
          supplierName: "Unknown Supplier",
          supplierCode: null,
          supplierSource: null,
          confidence: 0,
          reason: "No supplier metadata and AI inference unavailable — manual assignment required",
          items: stillUnmatched,
          needsManualAssignment: true,
        });
      }
    }
  } else if (stillUnmatched.length > 0) {
    // LLM disabled, put unmatched in unknown bucket
    buckets.set("unknown", {
      supplierName: "Unknown Supplier",
      supplierCode: null,
      supplierSource: null,
      confidence: 0,
      reason: "No supplier metadata — manual assignment required",
      items: stillUnmatched,
      needsManualAssignment: true,
    });
  }

  // ── Convert to array and sort by confidence desc ──────────────────────
  const result = Array.from(buckets.values());
  result.sort((a, b) => b.confidence - a.confidence);

  log.info(`Grouped ${items.length} items into ${result.length} supplier buckets`);
  return result;
}
