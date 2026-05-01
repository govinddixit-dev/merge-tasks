/**
 * copilotExecProducts.ts — Product catalog executors for the AI copilot.
 *
 * Handles: createProduct, updateProduct, deleteProduct,
 *          searchExternalProducts, importExternalProduct
 *
 * Audit fix #11 (CRITICAL): All INSERT operations now include organizationId
 * to prevent cross-tenant data isolation failures in team setups.
 */
import { getDb } from "../db";
import { products } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { buildToolScope } from "./copilotExecScope";
import { searchProducts, getDefaultCredentials } from "../integrations/productSearchAdapter";
import { runAnalysisAndPersistInBackground } from "../services/webstore-imprint-placement";

export async function executeCreateProduct(userId: number, organizationId: number | null, args: {
  name: string; sku?: string; category?: string; basePrice: string;
  description?: string; supplier?: string; decorationMethods?: string; minQuantity?: number;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const result = await db.insert(products).values({
    userId,
    // Audit fix #11: scope new products to the organization so team members
    // in the same org can see them and other tenants cannot.
    organizationId: organizationId ?? null,
    name: args.name,
    sku: args.sku || null,
    category: (args.category || "other") as "apparel" | "drinkware" | "tech" | "bags" | "writing" | "wellness" | "outdoor" | "office" | "other",
    basePrice: args.basePrice,
    description: args.description || null,
    supplier: args.supplier || null,
    decorationMethods: args.decorationMethods ? (Array.isArray(args.decorationMethods) ? args.decorationMethods : [args.decorationMethods]) : null,
    minQuantity: args.minQuantity || 1,
    status: "active" as const,
  });

  const productId = Number(result[0].insertId);
  return { success: true, productId, name: args.name, sku: args.sku, basePrice: args.basePrice };
}

export async function executeUpdateProduct(userId: number, organizationId: number | null, args: {
  productId: number; name?: string; sku?: string; category?: string;
  basePrice?: string; description?: string; supplier?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const existing = await db.select().from(products)
    .where(and(eq(products.id, args.productId), scope.products)).limit(1);
  if (existing.length === 0) return { error: `Product ID ${args.productId} not found` };

  const updates: Record<string, unknown> = {};
  if (args.name) updates.name = args.name;
  if (args.sku !== undefined) updates.sku = args.sku;
  if (args.category) updates.category = args.category;
  if (args.basePrice) updates.basePrice = args.basePrice;
  if (args.description !== undefined) updates.description = args.description;
  if (args.supplier !== undefined) updates.supplier = args.supplier;
  if (args.status) updates.status = args.status;

  if (Object.keys(updates).length === 0) return { error: "No fields to update" };

  await db.update(products).set(updates).where(and(eq(products.id, args.productId), scope.products));
  return { success: true, productId: args.productId, updated: Object.keys(updates) };
}

export async function executeDeleteProduct(userId: number, organizationId: number | null, args: { productId: number; confirm: boolean }) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);
  if (!args.confirm) return { error: "Deletion not confirmed. Set confirm: true to proceed." };

  const existing = await db.select().from(products)
    .where(and(eq(products.id, args.productId), scope.products)).limit(1);
  if (existing.length === 0) return { error: `Product ID ${args.productId} not found` };

  const productName = existing[0].name;
  await db.delete(products).where(and(eq(products.id, args.productId), scope.products));
  return { success: true, deleted: productName };
}

export async function executeSearchExternalProducts(userId: number, organizationId: number | null, args: { query: string; limit?: number }) {
  const { query, limit = 20 } = args;
  try {
    const { apiConnections: apiConnsTable } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { error: "Database unavailable" };
    const connScope = organizationId !== null
      ? eq(apiConnsTable.organizationId, organizationId)
      : eq(apiConnsTable.userId, userId);
    const conns = await db.select().from(apiConnsTable).where(connScope);
    const findCreds = (prefix: string) => {
      const c = conns.find((x) => {
        const name = (x as { name?: string }).name;
        const syncStatus = (x as { syncStatus?: string }).syncStatus;
        return name?.toLowerCase().includes(prefix.toLowerCase()) && syncStatus !== "error";
      });
      return c ? (c as { credentials?: Record<string, string> }).credentials : undefined;
    };
    const asiCreds = findCreds("asi");
    const sanmarCreds = findCreds("sanmar");
    const ssCreds = findCreds("s&s") || findCreds("ssact");
    const alphabroderCreds = findCreds("alphabroder");
    const defaults = getDefaultCredentials();
    const credentials = {
      asi: asiCreds?.apiKey ? { apiKey: asiCreds.apiKey, accountId: asiCreds.accountId || "" } : defaults.asi,
      promostandards: {
        sanmar: sanmarCreds?.username ? { username: sanmarCreds.username, password: sanmarCreds.password || "" } : defaults.promostandards?.sanmar,
        ss: ssCreds?.username ? { username: ssCreds.username, password: ssCreds.password || "" } : defaults.promostandards?.ss,
        alphabroder: alphabroderCreds?.username ? { username: alphabroderCreds.username, password: alphabroderCreds.password || "" } : defaults.promostandards?.alphabroder,
      },
    };
    const result = await searchProducts({ query, limit: Math.min(limit, 50), ...credentials });
    return {
      products: result.products.slice(0, limit),
      totalCount: result.totalCount,
      sources: result.sources,
      tip: result.products.length === 0
        ? "No results found. The distributor may need to connect supplier accounts in Settings > Integrations."
        : `Found ${result.products.length} products. Use import_external_product to add any to the catalog.`,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export async function executeImportExternalProduct(userId: number, organizationId: number | null, args: {
  externalId: string; source: "asi" | "promostandards"; supplier: string;
  supplierCode: string; productNumber: string; name: string; description: string;
  category: string; imageUrl?: string; basePrice?: number; minQuantity?: number;
}) {
  try {
    const db = await getDb();
    if (!db) return { error: "Database unavailable" };
    const existing = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.userId, userId), eq(products.externalId, args.externalId))).limit(1);
    if (existing.length > 0) {
      return { success: true, productId: existing[0].id, alreadyExists: true, message: `Product "${args.name}" is already in the catalog (ID: ${existing[0].id})` };
    }
    const inserted = await db.insert(products).values({
      userId,
      // Audit fix #11: scope imported products to the organization
      organizationId: organizationId ?? null,
      name: args.name,
      description: args.description,
      category: "other" as const,
      supplier: args.supplier,
      supplierSku: args.productNumber,
      supplierCode: args.supplierCode,
      productNumber: args.productNumber,
      imageUrl: args.imageUrl || null,
      basePrice: args.basePrice ? String(args.basePrice) : null,
      minQuantity: args.minQuantity || 1,
      source: args.source === "asi" ? "asi" as const : "promostandards" as const,
      sourceApiId: args.externalId,
      externalId: args.externalId,
      externalSource: args.source,
    });
    const productId = Number(inserted[0].insertId);

    // Fire-and-forget vision analysis. ASI/PromoStandards imports
    // almost always carry an imageUrl from the supplier feed; on the
    // rare row without one the helper's no_image skip handles it
    // silently. The copilot tool returns its success message
    // immediately — the analysis completes in the background and the
    // storefront's WebstoreLogoOverlay picks up the cached coordinates
    // on the next render.
    if (args.imageUrl) {
      const scope = buildToolScope(userId, organizationId);
      runAnalysisAndPersistInBackground(db, {
        id: productId,
        imageUrl: args.imageUrl,
        webstoreImprintPlacementSource: null,
        supplierCode: args.supplierCode,
        name: args.name,
      }, scope.products);
    }

    return { success: true, productId, alreadyExists: false, message: `Product "${args.name}" imported successfully (ID: ${productId})` };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}
