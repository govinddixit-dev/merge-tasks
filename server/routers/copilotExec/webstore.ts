/**
 * copilotExec/webstore.ts
 * Executors for the create_webstore, assign_store_products, and optimize_store copilot tools.
 */

import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  clients,
  products,
  stores,
  storeProducts,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { safeLLM } from "../../_core/safeLLM";
import { enqueueRenderForStoreProduct } from "../../services/webstore-render-orchestrator";
import { buildToolScope } from "./scope";

export async function executeCreateWebstore(
  userId: number,
  organizationId: number | null,
  args: {
    clientId: number;
    name: string;
    slug: string;
    storeType?: string;
    welcomeMessage?: string;
    primaryColor?: string;
  }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, args.clientId), scope.clients))
    .limit(1);
  if (clientRows.length === 0) return { error: `Client ID ${args.clientId} not found` };
  const client = clientRows[0];

  // Ensure slug uniqueness
  const existingStore = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.slug, args.slug))
    .limit(1);
  if (existingStore.length > 0) args.slug = `${args.slug}-${nanoid(4)}`;

  // storeType is a mysqlEnum("permanent", "popup") — validate before inserting
  const storeType: "permanent" | "popup" =
    args.storeType === "popup" ? "popup" : "permanent";

  const result = await db.insert(stores).values({
    userId,
    organizationId,
    clientId: args.clientId,
    name: args.name,
    slug: args.slug,
    storeType,
    welcomeMessage: args.welcomeMessage || `Welcome to ${client.companyName}'s company store`,
    primaryColor: args.primaryColor || "#654BF9",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const storeId = Number(result[0].insertId);
  await db.update(clients).set({ hasWebstore: true }).where(eq(clients.id, args.clientId));

  return {
    success: true,
    storeId,
    name: args.name,
    slug: args.slug,
    clientName: client.companyName,
    storeType,
  };
}

export async function executeAssignStoreProducts(
  userId: number,
  organizationId: number | null,
  args: {
    storeId: number;
    products: Array<{ productId: number; customPrice?: string; featured?: boolean }>;
  }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const storeRows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, args.storeId), scope.stores))
    .limit(1);
  if (storeRows.length === 0) return { error: `Store ID ${args.storeId} not found` };

  let assignedCount = 0;
  for (let i = 0; i < args.products.length; i++) {
    const p = args.products[i];
    const productRows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, p.productId), scope.products))
      .limit(1);
    if (productRows.length === 0) continue;

    await db.insert(storeProducts).values({
      storeId: args.storeId,
      productId: p.productId,
      customPrice: p.customPrice || productRows[0].basePrice || "0",
      featured: p.featured || false,
      sortOrder: i,
    });
    // Fire-and-forget render enqueue — see webstore-render-orchestrator.
    void enqueueRenderForStoreProduct(db, args.storeId, p.productId);
    assignedCount++;
  }

  return {
    success: true,
    storeId: args.storeId,
    assignedCount,
    totalRequested: args.products.length,
  };
}

export async function executeOptimizeStore(
  userId: number,
  organizationId: number | null,
  args: { storeId: number }
) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };
  const scope = buildToolScope(userId, organizationId);

  const storeRows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, args.storeId), scope.stores))
    .limit(1);
  if (storeRows.length === 0) return { error: `Store ID ${args.storeId} not found` };
  const store = storeRows[0];

  const clientRows = await db
    .select()
    .from(clients)
    .where(eq(clients.id, store.clientId))
    .limit(1);
  const client = clientRows[0];

  const spRows = await db
    .select()
    .from(storeProducts)
    .where(eq(storeProducts.storeId, store.id));
  const productIds = spRows.map((sp) => sp.productId);

  let productNames: string[] = [];
  if (productIds.length > 0) {
    const productRows = await db
      .select({ id: products.id, name: products.name, category: products.category })
      .from(products)
      .where(scope.products);
    productNames = productRows
      .filter((p) => productIds.includes(p.id))
      .map((p) => `${p.name} (${p.category})`);
  }

  try {
    const aiResult = await safeLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "You are a branding expert for promotional product stores. Generate compelling store copy.",
          },
          {
            role: "user",
            content: `Generate a store description, tagline, and welcome message for a company store:\n- Company: ${client?.companyName || store.name}\n- Industry: ${client?.industry || "Corporate"}\n- Products: ${productNames.join(", ") || "Various promotional products"}\n- Store type: ${store.storeType}\n\nRespond in JSON format: { "description": "...", "tagline": "...", "welcomeMessage": "..." }`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "store_optimization",
            strict: true,
            schema: {
              type: "object",
              properties: {
                description: { type: "string", description: "2-3 sentence store description" },
                tagline: { type: "string", description: "Short catchy tagline" },
                welcomeMessage: {
                  type: "string",
                  description: "Welcome message for the store homepage",
                },
              },
              required: ["description", "tagline", "welcomeMessage"],
              additionalProperties: false,
            },
          },
        },
        task: "copilot",
      },
      { organizationId, userId }
    );

    const content = aiResult.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : "") as {
      description: string;
      tagline: string;
      welcomeMessage: string;
    };

    await db
      .update(stores)
      .set({
        aiDescription: parsed.description,
        aiTagline: parsed.tagline,
        welcomeMessage: parsed.welcomeMessage,
        aiOptimizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, args.storeId));

    return {
      success: true,
      storeId: args.storeId,
      description: parsed.description,
      tagline: parsed.tagline,
      welcomeMessage: parsed.welcomeMessage,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `AI optimization failed: ${message}` };
  }
}
