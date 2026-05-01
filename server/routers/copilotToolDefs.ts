/**
 * copilotToolDefs.ts — Extended AI Copilot Tool Definitions
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure data file: JSON-schema tool definitions consumed by the LLM.
 * No logic here — all executor logic lives in copilotExec/ and copilotExec*.ts.
 *
 * Domain sections (Ctrl+F the section header to jump):
 *   ── CLIENT MANAGEMENT      create_client, update_client, delete_client, get_client_details, list_clients
 *   ── ORDERS                 list_orders, get_order_details, create_order, update_order_status
 *   ── PRODUCTS               create_product, update_product, delete_product, configure_catalog_variants, search_external_products, import_external_product
 *   ── ESTIMATES & INVOICES   create_estimate, create_invoice, list_estimates, list_invoices, update_invoice_status
 *   ── PROPOSALS              list_proposals, update_proposal, delete_proposal, duplicate_proposal, get_proposal_details
 *   ── VIRTUAL PROOFS         create_virtual_proof, list_proofs, update_proof_status
 *   ── ANALYTICS              get_dashboard_stats, get_reorder_alerts, get_churn_signals, get_refund_report
 *   ── WEBSTORE               update_store, list_stores, get_store_details, delete_store
 *   ── BRANDING & EMAIL       send_custom_email, get_branding, update_branding
 *
 * All tools use standard Drizzle ORM + MySQL queries.
 * Fully portable to AWS/OVH — no vendor lock-in.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { Tool } from "../_core/llm";

// ── TOOL DEFINITIONS ───────────────────────────────────────────────────────────────────────────

export const EXTENDED_TOOLS: Tool[] = [
  //  Client Management 
  {
    type: "function",
    function: {
      name: "create_client",
      description: "Create a new client for the distributor. Returns the new client ID.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Company name (required)" },
          contactName: { type: "string", description: "Primary contact person name" },
          contactEmail: { type: "string", description: "Contact email address" },
          contactPhone: { type: "string", description: "Contact phone number" },
          industry: { type: "string", description: "Industry (e.g., 'Technology', 'Healthcare', 'Education')" },
          address: { type: "string", description: "Company address" },
          city: { type: "string", description: "City" },
          state: { type: "string", description: "State/Province" },
          zip: { type: "string", description: "ZIP/Postal code" },
          notes: { type: "string", description: "Internal notes about the client" },
        },
        required: ["companyName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_client",
      description: "Update an existing client's information. Only provide fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "number", description: "Client ID to update" },
          companyName: { type: "string", description: "New company name" },
          contactName: { type: "string", description: "New contact name" },
          contactEmail: { type: "string", description: "New contact email" },
          contactPhone: { type: "string", description: "New contact phone" },
          industry: { type: "string", description: "New industry" },
          address: { type: "string", description: "New address" },
          city: { type: "string", description: "New city" },
          state: { type: "string", description: "New state" },
          zip: { type: "string", description: "New ZIP code" },
          notes: { type: "string", description: "New notes" },
          status: { type: "string", enum: ["active", "inactive"], description: "Client status" },
        },
        required: ["clientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_client",
      description: "Delete a client and all associated data (proposals, orders, stores). This is irreversible.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "number", description: "Client ID to delete" },
          confirm: { type: "boolean", description: "Must be true to confirm deletion" },
        },
        required: ["clientId", "confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_details",
      description: "Get full details about a client including their proposals, orders, stores, and revenue summary.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "number", description: "Client ID to look up" },
        },
        required: ["clientId"],
      },
    },
  },

  //  Order Management 
  {
    type: "function",
    function: {
      name: "list_orders",
      description: "List orders with optional filters. Returns recent orders with client info.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "processing", "production", "shipped", "delivered", "cancelled"], description: "Filter by status" },
          clientId: { type: "number", description: "Filter by client ID" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Get full order details including line items, client info, and payment details.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "number", description: "Order ID" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_order",
      description: "Create a new order for a client with line items.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "number", description: "Client ID" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "number", description: "Product ID" },
                quantity: { type: "number", description: "Quantity" },
                unitPrice: { type: "string", description: "Unit price (e.g., '24.99')" },
                size: { type: "string", description: "Size (e.g., 'L', 'XL')" },
                color: { type: "string", description: "Color" },
                decorationType: { type: "string", description: "Decoration method" },
              },
              required: ["productId", "quantity", "unitPrice"],
            },
            description: "Order line items",
          },
          shippingName: { type: "string", description: "Shipping recipient name" },
          shippingAddress: { type: "string", description: "Shipping address" },
          notes: { type: "string", description: "Order notes" },
          tax: { type: "string", description: "Tax amount (e.g., '5.00')" },
          shipping: { type: "string", description: "Shipping cost (e.g., '10.00')" },
        },
        required: ["clientId", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order_status",
      description: "Update an order's status and optionally add tracking number.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "number", description: "Order ID" },
          status: { type: "string", enum: ["pending", "processing", "production", "shipped", "delivered", "cancelled"], description: "New status" },
          trackingNumber: { type: "string", description: "Tracking number (for shipped status)" },
          notes: { type: "string", description: "Status update notes" },
        },
        required: ["orderId", "status"],
      },
    },
  },

  //  Product Catalog 
  {
    type: "function",
    function: {
      name: "create_product",
      description: "Add a new product to the catalog.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product name" },
          sku: { type: "string", description: "SKU code" },
          category: { type: "string", description: "Category (e.g., 'Apparel', 'Drinkware', 'Tech')" },
          basePrice: { type: "string", description: "Base price (e.g., '15.99')" },
          description: { type: "string", description: "Product description" },
          supplier: { type: "string", description: "Supplier name" },
          decorationMethods: { type: "string", description: "Comma-separated decoration methods (e.g., 'screen_print,embroidery')" },
          minQuantity: { type: "number", description: "Minimum order quantity" },
        },
        required: ["name", "basePrice"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_product",
      description: "Update an existing product's details. Only provide fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID to update" },
          name: { type: "string", description: "New name" },
          sku: { type: "string", description: "New SKU" },
          category: { type: "string", description: "New category" },
          basePrice: { type: "string", description: "New base price" },
          description: { type: "string", description: "New description" },
          supplier: { type: "string", description: "New supplier" },
          status: { type: "string", enum: ["active", "discontinued"], description: "Product status" },
        },
        required: ["productId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_product",
      description: "Delete a product from the catalog. This is irreversible.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID to delete" },
          confirm: { type: "boolean", description: "Must be true to confirm deletion" },
        },
        required: ["productId", "confirm"],
      },
    },
  },

  //  Estimates & Invoices 
  {
    type: "function",
    function: {
      name: "create_estimate",
      description: "Create an estimate from an accepted proposal. Snapshots the proposal products as line items.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "Accepted proposal ID to create estimate from" },
          tax: { type: "string", description: "Tax amount (default '0.00')" },
          shipping: { type: "string", description: "Shipping cost (default '0.00')" },
          notes: { type: "string", description: "Estimate notes" },
        },
        required: ["proposalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Create an invoice from an accepted proposal or from an existing estimate.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "Proposal ID (if creating directly from proposal)" },
          estimateId: { type: "number", description: "Estimate ID (if converting estimate to invoice)" },
          tax: { type: "string", description: "Tax amount" },
          shipping: { type: "string", description: "Shipping cost" },
          notes: { type: "string", description: "Invoice notes" },
          dueDate: { type: "string", description: "Due date (ISO format, e.g., '2026-05-01')" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_estimates",
      description: "List all estimates for the distributor, optionally filtered by status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "sent", "accepted", "declined", "converted"], description: "Filter by status" },
          clientId: { type: "number", description: "Filter by client ID" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_invoices",
      description: "List all invoices for the distributor, optionally filtered by status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "cancelled", "void"], description: "Filter by status" },
          clientId: { type: "number", description: "Filter by client ID" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_invoice_status",
      description: "Update an invoice's status (e.g., mark as sent, paid, overdue, void).",
      parameters: {
        type: "object",
        properties: {
          invoiceId: { type: "number", description: "Invoice ID" },
          status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "cancelled", "void"], description: "New status" },
        },
        required: ["invoiceId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_fulfilled",
      description: "Mark a proposal, invoice, or estimate as fulfilled and send a delivery confirmation email to the client. Use this when the distributor confirms that branded merchandise has been delivered.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["proposal", "invoice", "estimate"], description: "Type of document to mark as fulfilled" },
          entityId: { type: "number", description: "ID of the document" },
          notes: { type: "string", description: "Optional delivery note to include in the confirmation email" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },

  //  Proposal Management (extend existing)
  {
    type: "function",
    function: {
      name: "list_proposals",
      description: "List proposals with optional filters by status and client.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "sent", "viewed", "accepted", "declined", "expired"], description: "Filter by status" },
          clientId: { type: "number", description: "Filter by client ID" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_proposal",
      description: "Update a proposal's details. Only provide fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "Proposal ID" },
          title: { type: "string", description: "New title" },
          notes: { type: "string", description: "New notes" },
          validDays: { type: "number", description: "New validity period in days" },
          status: { type: "string", enum: ["draft", "sent", "viewed", "accepted", "declined", "expired"], description: "New status" },
        },
        required: ["proposalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_proposal",
      description: "Delete a proposal and its associated products. This is irreversible.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "Proposal ID to delete" },
          confirm: { type: "boolean", description: "Must be true to confirm deletion" },
        },
        required: ["proposalId", "confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_proposal",
      description: "Duplicate an existing proposal (creates a new draft copy with all products).",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "Proposal ID to duplicate" },
          newTitle: { type: "string", description: "Title for the duplicate (defaults to 'Copy of [original]')" },
          newClientId: { type: "number", description: "Optionally assign to a different client" },
        },
        required: ["proposalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_catalog_variants",
      description: "Configure product variants (colors, sizes) and price tiers for a proposal product. Used to set up the catalog-style proposal view.",
      parameters: {
        type: "object",
        properties: {
          proposalProductId: { type: "number", description: "Proposal product ID (from proposal's product list)" },
          colors: {
            type: "array",
            items: { type: "string" },
            description: "Available colors (e.g., ['Black', 'Navy', 'White'])",
          },
          sizes: {
            type: "array",
            items: { type: "string" },
            description: "Available sizes (e.g., ['S', 'M', 'L', 'XL', '2XL'])",
          },
          priceTiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tierType: { type: "string", enum: ["quantity", "size"], description: "Tier type" },
                label: { type: "string", description: "Tier label (e.g., '10-49 units' or 'XS-XL')" },
                minQty: { type: "number", description: "Min quantity (for quantity tiers)" },
                maxQty: { type: "number", description: "Max quantity (for quantity tiers)" },
                price: { type: "string", description: "Price for this tier" },
              },
              required: ["tierType", "label", "price"],
            },
            description: "Price tiers (quantity-based and/or size-based)",
          },
        },
        required: ["proposalProductId"],
      },
    },
  },

  //  Virtual Proofing 
  {
    type: "function",
    function: {
      name: "create_virtual_proof",
      description: "Create a virtual proof for a product with a client logo. Uses AI to generate a realistic mockup.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID" },
          clientId: { type: "number", description: "Client ID (to find their logos)" },
          decorationMethod: { type: "string", enum: ["embroidery", "screen_print", "laser_engraving", "heat_transfer", "dtg", "sublimation", "deboss", "patch"], description: "Decoration method" },
          decorationZone: { type: "string", enum: ["front", "back", "left_sleeve", "right_sleeve", "pocket"], description: "Where to place the logo (default: front)" },
          proposalId: { type: "number", description: "Optional proposal ID to link the proof to" },
        },
        required: ["productId", "clientId", "decorationMethod"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_proofs",
      description: "List virtual proofs, optionally filtered by client or status.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "number", description: "Filter by client ID" },
          status: { type: "string", enum: ["draft", "rendering", "ready", "approved", "revision_requested"], description: "Filter by status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_proof_status",
      description: "Approve or request revision on a virtual proof.",
      parameters: {
        type: "object",
        properties: {
          proofId: { type: "number", description: "Proof ID" },
          action: { type: "string", enum: ["approve", "request_revision"], description: "Action to take" },
          revisionNotes: { type: "string", description: "Notes for revision (required if requesting revision)" },
        },
        required: ["proofId", "action"],
      },
    },
  },

  //  Reports & Analytics 
  {
    type: "function",
    function: {
      name: "get_dashboard_stats",
      description: "Get dashboard statistics: active stores, pending orders, monthly GMV, total clients, total products.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reorder_alerts",
      description: "Get predictive reorder alerts — clients who may need to reorder based on past order patterns.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_churn_signals",
      description: "Get churn risk signals — clients showing signs of disengagement based on order/activity patterns.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_refund_report",
      description: "Get a refund report — lists all refund requests (pending, approved, denied) with proposal details, requester info, and amounts. Optionally filter by status. Use this when the user asks about refunds, refund requests, refund history, or refund analytics.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "approved", "denied"],
            description: "Optional filter by request status. Omit to get all.",
          },
          limit: {
            type: "number",
            description: "Max results (default 20)",
          },
        },
        required: [],
      },
    },
  },

  //  Store Management (extend existing) 
  {
    type: "function",
    function: {
      name: "update_store",
      description: "Update a webstore's settings (name, welcome message, status, colors, etc.).",
      parameters: {
        type: "object",
        properties: {
          storeId: { type: "number", description: "Store ID" },
          name: { type: "string", description: "New store name" },
          welcomeMessage: { type: "string", description: "New welcome message" },
          primaryColor: { type: "string", description: "New primary color hex" },
          status: { type: "string", enum: ["active", "inactive", "archived"], description: "Store status" },
        },
        required: ["storeId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_stores",
      description: "List all webstores for the distributor.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "archived"], description: "Filter by status" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_store_details",
      description: "Get full store details including products, client info, and AI-generated copy.",
      parameters: {
        type: "object",
        properties: {
          storeId: { type: "number", description: "Store ID" },
        },
        required: ["storeId"],
      },
    },
  },

  //  Email & Communication 
  {
    type: "function",
    function: {
      name: "send_custom_email",
      description: "Send a custom email to any recipient. Use for follow-ups, thank you notes, reminders, etc.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (HTML supported)" },
          fromName: { type: "string", description: "Sender display name (defaults to distributor company name)" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },

  //  Branding 
  {
    type: "function",
    function: {
      name: "get_branding",
      description: "Get the distributor's current branding settings (logo, colors, company name).",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_branding",
      description: "Update the distributor's branding settings (colors, company name). Logo upload must be done through the Settings UI.",
      parameters: {
        type: "object",
        properties: {
          primaryColor: { type: "string", description: "Primary brand color hex (e.g., '#654BF9')" },
          secondaryColor: { type: "string", description: "Secondary brand color hex" },
          bannerColor: { type: "string", description: "Email banner/header color hex" },
          companyName: { type: "string", description: "Display company name for branding" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_store",
      description: "Permanently delete a webstore and all its associated products. Use with caution — this cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          storeId: { type: "number", description: "The ID of the store to delete" },
        },
        required: ["storeId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_clients",
      description: "List all clients for the distributor, optionally filtered by status or industry. Use this when the user asks to see all clients or browse their client list.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: 'active', 'inactive', or 'prospect'" },
          industry: { type: "string", description: "Filter by industry keyword" },
          limit: { type: "number", description: "Maximum number of clients to return (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_proposal_details",
      description: "Get the full details of a specific proposal including all products, pricing, status, and client info. Use this when the user asks about a specific proposal.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "number", description: "The ID of the proposal to retrieve" },
        },
        required: ["proposalId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_external_products",
      description: "Search the live ASI ESP and PromoStandards supplier catalogs for products. Use this when the user asks to find products from suppliers, search for specific items by name/category/color, or wants to see what's available from SanMar, S&S, alphabroder, or ASI. Returns real-time results from connected supplier accounts.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — product name, category, color, or description (e.g. 'blue polo shirt', 'tote bag', 'fleece jacket under $30')" },
          limit: { type: "number", description: "Max results to return (default 20, max 50)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "import_external_product",
      description: "Import a product from ASI ESP or PromoStandards into the distributor's local catalog. Use this after search_external_products when the user wants to add a specific product to their catalog. Requires the externalId from the search results.",
      parameters: {
        type: "object",
        properties: {
          externalId: { type: "string", description: "The externalId of the product from search_external_products results" },
          source: { type: "string", enum: ["asi", "promostandards"], description: "The source the product came from" },
          supplier: { type: "string", description: "Supplier name" },
          supplierCode: { type: "string", description: "Supplier code" },
          productNumber: { type: "string", description: "Product number" },
          name: { type: "string", description: "Product name" },
          description: { type: "string", description: "Product description" },
          category: { type: "string", description: "Product category" },
          imageUrl: { type: "string", description: "Product image URL" },
          basePrice: { type: "number", description: "Base price" },
          minQuantity: { type: "number", description: "Minimum order quantity" },
        },
        required: ["externalId", "source", "supplier", "supplierCode", "productNumber", "name", "description", "category"],
      },
    },
  },
  // ── BULK PURCHASE ORDER GENERATION ─────────────────────────────────────
  {
    type: "function",
    function: {
      name: "generate_bulk_purchase_orders",
      description: "Generate purchase orders for ALL approved (status=accepted) proposals in the org, AI-grouping line items by supplier ACROSS proposals so that orders going to the same supplier merge into one PO. Returns a preview (no POs are created until the user confirms via the preview screen). Use when the user asks to 'generate POs for all approved proposals', 'bulk PO from proposals', or similar.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  // ── AGGREGATE EXISTING POs ─────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "aggregate_pending_purchase_orders",
      description: "Look across the distributor's unprocessed purchase orders (status draft / sent / acknowledged) and identify consolidation opportunities — POs with the same supplier that could be merged into a single PO per supplier. Returns a preview grouping (no POs are modified until the user confirms via the preview card). Use when the user says 'aggregate my pending POs', 'consolidate my POs', 'merge POs by supplier', or similar.",
      parameters: {
        type: "object",
        properties: {
          poIds: {
            type: "array",
            items: { type: "number" },
            description: "Optional list of specific PO IDs to consider. If omitted, every unprocessed PO in the org is considered.",
          },
        },
        required: [],
      },
    },
  },
];
