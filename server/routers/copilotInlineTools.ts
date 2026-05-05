/**
 * copilotInlineTools.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenAI function-calling tool definitions for the core copilot procedures:
 *   search_clients, search_products, create_proposal, send_proposal,
 *   create_webstore, assign_store_products, optimize_store, navigate_to_page
 *
 * Extended tools (orders, estimates, analytics, etc.) live in copilotToolDefs.ts
 * and are imported via copilotTools.ts barrel.
 *
 * Editing guide:
 *  - Add a new entry to INLINE_TOOLS when adding a new core tool executor in
 *    copilotInlineExecutors.ts.
 *  - Keep descriptions precise — they directly affect LLM tool selection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Tool } from "../_core/llm";

export const INLINE_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_clients",
      description:
        "Search for clients by name, industry, or any keyword. Returns matching clients with their IDs, contact info, and status. Use this FIRST when the user mentions a client name.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query — client company name, contact name, or industry keyword",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the product catalog by name, category, or keyword. Returns matching products with IDs, prices, and details. Use this to find real products before creating a proposal.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query — product name, category (apparel, drinkware, tech, bags, etc.), or keyword",
          },
          category: {
            type: "string",
            enum: [
              "apparel",
              "drinkware",
              "tech",
              "bags",
              "writing",
              "wellness",
              "outdoor",
              "office",
              "other",
            ],
            description: "Optional category filter",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_proposal",
      description:
        "Create a new proposal with real products from the catalog. MUST use product IDs from search_products results. This creates the proposal in draft status with actual product line items.",
      parameters: {
        type: "object",
        properties: {
          clientId: {
            type: "number",
            description: "The client ID (from search_clients results)",
          },
          title: {
            type: "string",
            description: "Descriptive title for the proposal",
          },
          notes: {
            type: "string",
            description: "Optional notes or description for the proposal",
          },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: {
                  type: "number",
                  description: "Product ID from search_products results",
                },
                quantity: { type: "number", description: "Quantity to include" },
                unitPrice: {
                  type: "string",
                  description:
                    "Unit price as string (e.g., '12.50'). Use the price from search results or pricing tiers.",
                },
                decorationType: {
                  type: "string",
                  description:
                    "Optional decoration method (e.g., 'Screen Print', 'Embroidery')",
                },
              },
              required: ["productId", "quantity"],
            },
            description:
              "Products to include in the proposal — use real IDs from search_products",
          },
          multiDepartment: {
            type: "boolean",
            description: "Whether this proposal requires multi-department approval",
          },
          validDays: {
            type: "number",
            description: "Number of days the proposal is valid (default: 30)",
          },
        },
        required: ["clientId", "title", "products"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_proposal",
      description:
        "Send a proposal email to the client's POC. The proposal must already exist. This sends the branded email and changes status to 'sent'.",
      parameters: {
        type: "object",
        properties: {
          proposalId: {
            type: "number",
            description: "The proposal ID to send (from create_proposal result)",
          },
        },
        required: ["proposalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_webstore",
      description:
        "Create a new branded webstore for a client. The store will be set up with the client's branding. Use search_clients first to get the client ID.",
      parameters: {
        type: "object",
        properties: {
          clientId: {
            type: "number",
            description: "The client ID (from search_clients results)",
          },
          name: {
            type: "string",
            description: "Store name (e.g., 'Acme Corp Store')",
          },
          slug: {
            type: "string",
            description:
              "URL-friendly slug for the store (e.g., 'acme-corp'). Lowercase, hyphens only.",
          },
          storeType: {
            type: "string",
            enum: ["permanent", "popup"],
            description: "Store type — permanent or popup (time-limited)",
          },
          welcomeMessage: {
            type: "string",
            description: "Optional welcome message displayed on the store homepage",
          },
          primaryColor: {
            type: "string",
            description: "Optional primary brand color hex code (e.g., '#654BF9')",
          },
        },
        required: ["clientId", "name", "slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_store_products",
      description:
        "Assign products from the catalog to a webstore. Use search_products first to find product IDs, then assign them to the store.",
      parameters: {
        type: "object",
        properties: {
          storeId: {
            type: "number",
            description: "The store ID (from create_webstore result)",
          },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: {
                  type: "number",
                  description: "Product ID from search_products results",
                },
                customPrice: {
                  type: "string",
                  description: "Optional custom price for this store (e.g., '24.99')",
                },
                featured: {
                  type: "boolean",
                  description: "Whether to feature this product on the store homepage",
                },
              },
              required: ["productId"],
            },
            description: "Products to assign to the store",
          },
        },
        required: ["storeId", "products"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "optimize_store",
      description:
        "Use AI to auto-generate store description, tagline, and welcome message based on the client and products. Call this AFTER creating the store and assigning products.",
      parameters: {
        type: "object",
        properties: {
          storeId: {
            type: "number",
            description: "The store ID to optimize",
          },
        },
        required: ["storeId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to_page",
      description: "Navigate the user to a specific page in the application.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "The URL path to navigate to (e.g., '/proposals', '/clients', '/webstores', '/create-proposal')",
          },
          reason: {
            type: "string",
            description: "Brief explanation of why navigating there",
          },
        },
        required: ["path"],
      },
    },
  },

  // ── Purchase Order tools ────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "search_purchase_orders",
      description:
        "Search purchase orders by PO number, supplier name, or status. Returns matching POs with supplier, cost totals, and status.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "PO number, supplier name, or order number",
          },
          status: {
            type: "string",
            enum: ["draft", "sent", "acknowledged", "in_production", "shipped", "received", "cancelled", "partial"],
            description: "Optional status filter",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_purchase_orders",
      description:
        "Generate purchase orders for an order. AI will group items by supplier and create separate POs with cost prices. Returns the created POs.",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "number",
            description: "The order ID to generate POs for",
          },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_po_details",
      description:
        "Get full details of a purchase order including line items, costs, supplier info, and activity timeline.",
      parameters: {
        type: "object",
        properties: {
          poId: {
            type: "number",
            description: "The purchase order ID",
          },
        },
        required: ["poId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_margin_analysis",
      description:
        "Get margin analysis for an order — compares sell prices (what the client pays) to cost prices (from purchase orders). Shows gross margin and per-item breakdown.",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "number",
            description: "The order ID to analyze margins for",
          },
        },
        required: ["orderId"],
      },
    },
  },
];
