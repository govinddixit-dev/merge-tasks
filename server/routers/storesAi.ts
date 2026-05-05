/**
 * storesAi — AI-powered store optimization, catalog classification, editor, and launch.
 *
 * Procedures: aiOptimize, autoClassifyCatalog, saveEditorChanges, launch
 */
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  stores, storeProducts, clients, products,
  aiTrainingData, aiEditFeedback,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { safeLLM } from "../_core/safeLLM";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { AI_STORE_OPTIMIZE_LIMIT } from "../utils/rateLimiter";

const log = getLogger("stores:ai");

export const storesAiRouter = router({
  aiOptimize: protectedProcedure
    .use(rateLimited("storesAi.aiOptimize", AI_STORE_OPTIMIZE_LIMIT))
    .input(z.object({ storeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const storeRows = await db
        .select()
        .from(stores)
        .where(and(eq(stores.id, input.storeId), scope.stores))
        .limit(1);
      if (storeRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      const store = storeRows[0];

      const clientRows = await db.select().from(clients).where(eq(clients.id, store.clientId)).limit(1);
      const client = clientRows[0];

      const spRows = await db.select().from(storeProducts).where(eq(storeProducts.storeId, store.id));
      const productIds = spRows.map(sp => sp.productId);
      let storeProductsList: (typeof products.$inferSelect)[] = [];
      if (productIds.length > 0) {
        storeProductsList = await db.select().from(products).where(and(scope.products, inArray(products.id, productIds)));
      }

      const categories = Array.from(new Set(storeProductsList.map(p => p.category).filter(Boolean))) as string[];

      const productSummary = storeProductsList.slice(0, 20).map(p =>
        `- ${p.name} (${p.category || "uncategorized"}) — $${p.basePrice}`
      ).join("\n");

      const companySize = client?.companySize || "";
      const brandColor = store.primaryColor || "#654BF9";

      // ── GAP 3 FIX: Closed-loop AI feedback ─────────────────────────────────
      // Fetch the most recent edit feedback for this store so the AI can learn
      // from corrections the distributor made to previous AI-generated copy.
      const recentFeedback = await db
        .select()
        .from(aiEditFeedback)
        .where(and(
          scope.aiEditFeedback,
          eq(aiEditFeedback.entityType, "store_optimization"),
          eq(aiEditFeedback.entityId, store.id),
        ))
        .orderBy(desc(aiEditFeedback.createdAt))
        .limit(20);

      // Group by fieldName, keeping only the most recent edit per field
      const feedbackByField = new Map<string, { before: string | null; after: string | null }>();
      for (const row of recentFeedback) {
        if (!feedbackByField.has(row.fieldName)) {
          feedbackByField.set(row.fieldName, { before: row.valueBefore ?? null, after: row.valueAfter ?? null });
        }
      }
      const feedbackSection = feedbackByField.size > 0
        ? `\n== DISTRIBUTOR CORRECTIONS (learn from these) ==\nThe distributor previously edited the following AI-generated fields for this store. Your new output MUST reflect these preferences:\n${Array.from(feedbackByField.entries()).map(([field, { before, after }]) => `- ${field}: AI wrote "${before}" → distributor changed to "${after}"`).join("\n")}\n`
        : "";

      const prompt = `You are a world-class e-commerce UX designer and brand copywriter for MergeTasks, a premium branded merchandise platform used by distributors to build company stores for their clients.

Your job is to generate FULLY PERSONALIZED store content that feels like it was custom-built for this specific company — not generic. Use the client's industry, company size, and brand color to inform tone, vocabulary, and visual suggestions.

== CLIENT PROFILE ==
Company: "${client?.companyName || "Unknown"}"
Industry: "${client?.industry || "General"}"
Company Size: "${companySize || "Unknown"}"
Website: "${client?.website || "N/A"}"
Brand Color: ${brandColor}

== STORE DETAILS ==
Store Name: "${store.name}"
Store Type: ${store.storeType === "popup" ? "Pop-Up (limited-time/seasonal event)" : "Permanent company store"}
Product Categories: ${categories.length > 0 ? categories.join(", ") : "General merchandise"}
Products (${storeProductsList.length} total):
${productSummary || "No products assigned yet"}

== WHAT TO GENERATE ==
Return a JSON object with these fields:

1. "tagline" — A SHORT, PUNCHY, INDUSTRY-SPECIFIC tagline (max 10 words). Must feel premium and tailored to the company's industry. E.g. for a tech company: "Gear Up. Ship Fast. Look Sharp." For a healthcare company: "Caring for Your Team, One Item at a Time."

2. "heroHeadline" — A bold hero banner headline (max 8 words). Should use the company name and feel like a premium brand moment. E.g. "Welcome to the [Company] Store"

3. "heroSubtitle" — A supporting line under the headline (max 20 words). Should describe what the store offers and why it matters to employees.

4. "description" — A 2-3 sentence store description. Professional, warm, and specific to the industry. Mention the company name. Make it feel like a premium branded experience.

5. "welcomeMessage" — A short 1-sentence welcome for the store banner overlay.

6. "categoryDescriptions" — An object where each key is a category name and the value is a 1-sentence description (max 15 words) tailored to the company's industry. Keys must match exactly: ${categories.map(c => `"${c}"`).join(", ")}.

7. "industryTheme" — A single word or short phrase describing the visual/tonal theme AI recommends for this industry (e.g. "corporate-professional", "healthcare-clean", "tech-bold", "retail-vibrant", "nonprofit-warm").

8. "templateSuggestion" — Which layout template best fits this company. Must be one of: "classic", "modern", or "minimal".
   - "classic": Best for large enterprises, government, healthcare — many categories, sidebar nav
   - "modern": Best for tech, startups, retail, sports — hero-first, card grid, vibrant
   - "minimal": Best for luxury brands, agencies, premium/boutique — clean, large imagery, few SKUs

9. "colorPalette" — An array of 3 complementary hex colors that work well with the brand color ${brandColor} for this industry. These will be used as accent colors in the store.

IMPORTANT RULES:
- All copy must feel SPECIFIC to ${client?.companyName || "this company"} and their ${client?.industry || "industry"} — not generic
- Category keys must match exactly: ${categories.map(c => `"${c}"`).join(", ")}
- templateSuggestion must be exactly one of: "classic", "modern", "minimal"
- colorPalette must be an array of exactly 3 valid hex color strings
- Respond ONLY with valid JSON, no markdown, no explanation${feedbackSection}`;

      try {
        const result = await safeLLM({
          messages: [
            { role: "system", content: "You are a professional e-commerce copywriter. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "store_optimization",
              strict: false,
              schema: {
                type: "object",
                properties: {
                  tagline: { type: "string", description: "Short punchy tagline" },
                  heroHeadline: { type: "string", description: "Bold hero banner headline" },
                  heroSubtitle: { type: "string", description: "Supporting hero subtitle" },
                  description: { type: "string", description: "2-3 sentence store description" },
                  welcomeMessage: { type: "string", description: "Brief welcome message" },
                  categoryDescriptions: {
                    type: "object",
                    description: "Map of category name to short description",
                    additionalProperties: { type: "string" },
                  },
                  industryTheme: { type: "string", description: "Visual/tonal theme for this industry" },
                  templateSuggestion: { type: "string", enum: ["classic", "modern", "minimal"], description: "Best layout template" },
                  colorPalette: { type: "array", items: { type: "string" }, description: "3 complementary hex colors" },
                  productPageCTA: {
                    type: "string",
                    description: "A short, branded call-to-action label for the add-to-cart button. Should feel personal to the client's company culture and industry. Examples: 'Add to My Kit' (tech/startup), 'Order for My Team' (enterprise), 'Request This Item' (budget-controlled), 'Add to Swag Bag' (events). Maximum 6 words.",
                  },
                  productGridHeading: {
                    type: "string",
                    description: "A branded heading for the products listing page. Should reference the client company name or their team identity. Examples: 'Acme Corp Gear', 'Your Team Store', 'Marketing Essentials', 'The Nike Kit'. Maximum 5 words.",
                  },
                  productBadgeStyle: {
                    type: "string",
                    enum: ["pill", "ribbon", "corner"],
                    description: "Visual badge style for featured product highlights. Use 'pill' for modern/minimal brands, 'ribbon' for classic/traditional brands, 'corner' for bold/enterprise brands.",
                  },
                },
                required: ["tagline", "heroHeadline", "heroSubtitle", "description", "welcomeMessage", "categoryDescriptions", "industryTheme", "templateSuggestion", "colorPalette", "productPageCTA", "productGridHeading", "productBadgeStyle"],
              },
            },
          },
        });

        const content = result.choices?.[0]?.message?.content;
        if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No AI response received" });

        let parsed;
        try { parsed = JSON.parse(content as string); }
        catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI returned invalid response. Please retry." }); }

        await db.update(stores).set({
          aiTagline: parsed.tagline || null,
          aiDescription: parsed.description || null,
          aiCategoryDescriptions: parsed.categoryDescriptions || null,
          welcomeMessage: parsed.welcomeMessage || store.welcomeMessage,
          aiOptimizedAt: new Date(),
          aiHeroHeadline: parsed.heroHeadline || null,
          aiHeroSubtitle: parsed.heroSubtitle || null,
          aiIndustryTheme: parsed.industryTheme || null,
          aiColorPalette: parsed.colorPalette || null,
          aiTemplateSuggestion: (parsed.templateSuggestion as "classic" | "modern" | "minimal" | undefined) || null,
          aiProductPageCTA: parsed.productPageCTA ?? null,
          aiProductGridHeading: parsed.productGridHeading ?? null,
          aiProductBadgeStyle: (parsed.productBadgeStyle as "pill" | "ribbon" | "corner" | undefined) ?? null,
          ...(store.template === "modern" && parsed.templateSuggestion ? { template: parsed.templateSuggestion as "classic" | "modern" | "minimal" } : {}),
        }).where(eq(stores.id, store.id));

        try {
          await db.insert(aiTrainingData).values({
            entityType: "store_optimization",
            entityId: store.id,
            userId: ctx.user.id,
            inputContext: {
              storeName: store.name,
              clientName: client?.companyName || "Unknown",
              clientIndustry: client?.industry || "General",
              clientWebsite: client?.website || null,
              storeType: store.storeType,
              categories,
              productCount: storeProductsList.length,
              productSample: storeProductsList.slice(0, 10).map(p => ({
                name: p.name,
                category: p.category,
                price: p.basePrice,
              })),
              brandColor: store.primaryColor,
            },
            systemPrompt: "Professional e-commerce copywriter for MergeTasks branded merchandise platform.",
            aiOutput: {
              tagline: parsed.tagline,
              heroHeadline: parsed.heroHeadline,
              heroSubtitle: parsed.heroSubtitle,
              description: parsed.description,
              categoryDescriptions: parsed.categoryDescriptions,
              welcomeMessage: parsed.welcomeMessage,
              productPageCTA: parsed.productPageCTA ?? null,
              productGridHeading: parsed.productGridHeading ?? null,
              productBadgeStyle: parsed.productBadgeStyle ?? null,
            },
            modelId: "gpt-4.1-mini",
            wasAccepted: true,
            wasEdited: false,
          });
          log.info(`Logged generation for store ${store.id}`);
        } catch (logErr) {
          log.warn("Failed to log training data:", logErr);
        }

        const updated = await db.select().from(stores).where(eq(stores.id, store.id)).limit(1);
        return {
          success: true,
          tagline: parsed.tagline,
          heroHeadline: parsed.heroHeadline,
          heroSubtitle: parsed.heroSubtitle,
          description: parsed.description,
          categoryDescriptions: parsed.categoryDescriptions,
          welcomeMessage: parsed.welcomeMessage,
          industryTheme: parsed.industryTheme,
          templateSuggestion: parsed.templateSuggestion,
          colorPalette: parsed.colorPalette,
          store: updated[0],
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        log.error("Error:", errMsg);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI optimization failed: " + errMsg,
        });
      }
    }),

  saveEditorChanges: protectedProcedure
    .input(z.object({
      id: z.number(),
      editorHeroHeadline: z.string().optional(),
      editorHeroSubtitle: z.string().optional(),
      editorTagline: z.string().optional(),
      editorWelcomeMessage: z.string().optional(),
      editorCategoryOrder: z.array(z.string()).optional(),
      editorCategoryNames: z.record(z.string(), z.string()).optional(),
      editorSubCategories: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string(), productIds: z.array(z.number()) }))).optional(),
      editorProductNames: z.record(z.string(), z.string()).optional(),
      editorProductDescriptions: z.record(z.string(), z.string()).optional(),
      primaryColor: z.string().optional(),
      bannerUrl: z.string().optional(),
      aiProductPageCTA: z.string().max(100).optional().nullable(),
      aiProductGridHeading: z.string().max(150).optional().nullable(),
      aiProductBadgeStyle: z.enum(["pill", "ribbon", "corner"]).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const { id, ...fields } = input;
      const setObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) { if (v !== undefined) setObj[k] = v; }
      if (input.aiProductPageCTA !== undefined) setObj.aiProductPageCTA = input.aiProductPageCTA;
      if (input.aiProductGridHeading !== undefined) setObj.aiProductGridHeading = input.aiProductGridHeading;
      if (input.aiProductBadgeStyle !== undefined) setObj.aiProductBadgeStyle = input.aiProductBadgeStyle;
      if (Object.keys(setObj).length > 0) {
        await db.update(stores).set(setObj).where(and(eq(stores.id, id), scope.stores));
      }
      return { success: true };
    }),

  launch: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);
      const existing = await db.select().from(stores).where(and(eq(stores.id, input.id), scope.stores)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });

      // Guard: if the store was sent for client approval, require approval before launch
      const store = existing[0];
      if (store.status === "pending_approval" && !store.approvalApprovedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This store is awaiting client approval. It cannot be launched until the client approves it.",
        });
      }

      await db.update(stores).set({ status: "active" }).where(and(eq(stores.id, input.id), scope.stores));
      const updated = await db.select().from(stores).where(eq(stores.id, input.id)).limit(1);
      return { success: true, store: updated[0] };
    }),

  autoClassifyCatalog: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      productIds: z.array(z.number()),
      clientIndustry: z.string().optional(),
      existingCategories: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const scope = getOrgScope(ctx);
      const productDetails = await db.select().from(products).where(and(scope.products, inArray(products.id, input.productIds)));
      if (productDetails.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No products found" });

      const productList = productDetails.map(p => `- ID ${p.id}: "${p.name}" (type: ${p.type || p.category || "general"}, category: ${p.category || "unknown"})`).join("\n");

      const existingCatList = (input.existingCategories || []).length > 0
        ? `\nExisting categories to use when possible: ${(input.existingCategories || []).join(", ")}\n`
        : "";

      const prompt = `You are a merchandise catalog organizer for a corporate branded store.

Industry: ${input.clientIndustry || "General"}${existingCatList}
Products to classify:
${productList}

Create a logical category and sub-category structure for these products.
${existingCatList ? "Try to fit products into the existing categories first. Create new categories only if a product clearly does not belong to any existing category." : "Create 2-6 main categories based on the products."}

Return ONLY valid JSON in this exact format:
{
  "categories": [
    {
      "id": "cat_1",
      "name": "Category Name",
      "subCategories": [
        {
          "id": "sub_1_1",
          "name": "Sub-category Name",
          "productIds": [1, 2, 3]
        }
      ]
    }
  ]
}

Rules:
- Use existing category names exactly as provided when applicable
- Create new categories only when no existing category fits
- Each category should have 1-4 sub-categories
- Every product must appear in exactly one sub-category
- Use industry-appropriate names
- Keep names concise (1-3 words)`;

      const llmResult = await safeLLM({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        temperature: 0.3,
        responseFormat: { type: "json_object" },
      });

      const rawContent = llmResult.choices[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "{}";
      let parsed;
      try { parsed = JSON.parse(content); }
      catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI returned invalid response. Please retry." }); }

      return {
        success: true,
        categories: parsed.categories || [],
      };
    }),
});
