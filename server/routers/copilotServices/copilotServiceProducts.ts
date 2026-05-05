/**
 * copilotServiceProducts.ts
 * ─────────────────────────
 * Service-layer executor for the `search_products` core copilot tool.
 */

import { eq, and, desc, or, like, sql } from "drizzle-orm";
import { products } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getOrSanitizeContext } from "../../utils/contextSanitizer";
import { buildToolScope } from "./copilotServiceScope";

export async function executeSearchProducts(
  userId: number,
  organizationId: number | null,
  args: { query: string; category?: string }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const searchPattern = `%${args.query}%`;

  const searchConditions = [
    scope.products,
    or(
      like(products.name, searchPattern),
      like(products.description, searchPattern),
      like(products.sku, searchPattern),
      like(products.supplier, searchPattern),
      like(products.category, searchPattern)
    ),
  ];

  if (args.category) {
    searchConditions.push(eq(products.category, args.category as "apparel" | "drinkware" | "tech" | "bags" | "writing" | "wellness" | "outdoor" | "office" | "other"));
  }

  let matches = await db
    .select()
    .from(products)
    .where(and(...searchConditions))
    .orderBy(desc(products.updatedAt))
    .limit(15);

  // Fallback: broaden to category-only match if no results
  if (matches.length === 0) {
    matches = await db
      .select()
      .from(products)
      .where(
        and(
          scope.products,
          like(products.category, searchPattern)
        )
      )
      .orderBy(desc(products.updatedAt))
      .limit(15);
  }

  if (matches.length === 0) {
    const catRows = await db
      .select({ category: products.category })
      .from(products)
      .where(scope.products)
      .groupBy(products.category);
    const categories = catRows.map((r) => r.category).filter(Boolean);
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(scope.products);
    const total = totalCount[0]?.count ?? 0;

    return {
      found: 0,
      products: [],
      message: `No products found matching "${args.query}". Available categories: ${categories.join(", ")}. Total catalog: ${total} products.`,
    };
  }

  const sanitizedProducts = await getOrSanitizeContext(
    `${userId}:products:${args.query}`,
    "products",
    matches
  );

  return {
    found: matches.length,
    products: sanitizedProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      basePrice: p.basePrice,
      currency: p.currency,
      supplier: p.supplier,
      supplierCode: p.supplierCode,
      productNumber: p.productNumber,
      decorationMethods: p.decorationMethods,
      pricingTiers: p.pricingTiers,
      imageUrl: p.imageUrl,
      externalId: p.externalId,
      externalSource: p.externalSource,
      hasLiveInventory: p.hasLiveInventory,
      source: p.source,
    })),
  };
}
