/**
 * copilotExec/clientsProducts.ts
 * Executors for the search_clients and search_products copilot tools.
 * Layer 3 (contextSanitizer) is applied to all DB records before returning to the LLM.
 */

import { and, or, like, sql, desc } from "drizzle-orm";
import { clients, products } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getOrSanitizeContext } from "../../utils/contextSanitizer";
import { buildToolScope } from "./scope";

export async function executeSearchClients(
  userId: number,
  organizationId: number | null,
  args: { query: string }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const searchPattern = `%${args.query}%`;

  const matches = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      contactEmail: clients.contactEmail,
      contactPhone: clients.contactPhone,
      industry: clients.industry,
      status: clients.status,
    })
    .from(clients)
    .where(
      and(
        scope.clients,
        or(
          like(clients.companyName, searchPattern),
          like(clients.contactName, searchPattern),
          like(clients.industry, searchPattern),
          like(clients.contactEmail, searchPattern)
        )
      )
    )
    .limit(10);

  if (matches.length === 0) {
    const sample = await db
      .select({ companyName: clients.companyName })
      .from(clients)
      .where(scope.clients)
      .limit(5);
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(scope.clients);
    const total = totalCount[0]?.count ?? 0;

    return {
      found: 0,
      clients: [],
      message: `No clients found matching "${args.query}". Available clients: ${sample
        .map((c) => c.companyName)
        .join(", ")}${total > 5 ? ` and ${total - 5} more` : ""}`,
    };
  }

  const sanitizedMatches = await getOrSanitizeContext(
    `${userId}:clients:${args.query}`,
    "clients",
    matches
  );

  return {
    found: matches.length,
    clients: sanitizedMatches.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      industry: c.industry,
      status: c.status,
    })),
  };
}

export async function executeSearchProducts(
  userId: number,
  organizationId: number | null,
  args: { query: string; category?: string }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const searchPattern = `%${args.query}%`;

  const searchConditions: ReturnType<typeof and>[] = [
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
    // category is a varchar — direct equality is safe
    searchConditions.push(like(products.category, args.category));
  }

  let matches = await db
    .select()
    .from(products)
    .where(and(...searchConditions))
    .orderBy(desc(products.updatedAt))
    .limit(15);

  if (matches.length === 0) {
    matches = await db
      .select()
      .from(products)
      .where(and(scope.products, like(products.category, searchPattern)))
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
