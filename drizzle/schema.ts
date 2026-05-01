import { int, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, boolean, decimal, json, index, uniqueIndex, unique, date, bigint, char } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  // Stripe
  passwordHash: varchar("passwordHash", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  subscriptionTier: mysqlEnum("subscriptionTier", ["free", "pro", "enterprise"]).default("free").notNull(),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "past_due", "canceled", "trialing", "none"]).default("none").notNull(),
  // Stripe Connect — distributor's own connected account for collecting payments from end-clients
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 255 }),
  stripeConnectOnboardingComplete: boolean("stripeConnectOnboardingComplete").default(false).notNull(),
  stripeConnectPayoutsEnabled: boolean("stripeConnectPayoutsEnabled").default(false).notNull(),
  stripeConnectChargesEnabled: boolean("stripeConnectChargesEnabled").default(false).notNull(),
  // PCI DSS Req 8.1.6 — account lockout after repeated failed login attempts
  failedLoginAttempts: int("failedLoginAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  /**
   * AI copilot approval level for solo users (users without an organization).
   * When the user belongs to an org, the org-level `organizations.aiApprovalLevel`
   * takes precedence — this column is only consulted when `ctx.organizationId`
   * is null. Values match the org enum for parity.
   */
  aiApprovalLevel: mysqlEnum("aiApprovalLevel", ["all_auto", "review_auto", "all_review"])
    .notNull()
    .default("review_auto"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Clients — companies the distributor sells to.
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // owner distributor user
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  companyName: varchar("companyName", { length: 255 }).notNull(),
  industry: varchar("industry", { length: 128 }),
  companySize: varchar("companySize", { length: 64 }),
  website: varchar("website", { length: 512 }),
  address: text("address"),
  // Primary contact
  contactName: varchar("contactName", { length: 255 }).notNull(),
  contactTitle: varchar("contactTitle", { length: 128 }),
  contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
  contactPhone: varchar("contactPhone", { length: 32 }),
  // Settings
  hasWebstore: boolean("hasWebstore").default(false).notNull(),
  status: mysqlEnum("status", ["active", "inactive", "prospect"]).default("prospect").notNull(),
  // Per-client tax-exempt flag. Seeds the default Taxable toggle on each
  // line item in the Document Canvas invoice flow. Existing clients default
  // to FALSE (taxable), matching prior behaviour.
  taxExempt: boolean("taxExempt").default(false).notNull(),
  // POC identity — pocEmail is the source of truth before the POC storeUser
  // record exists; pocStoreUserId is populated on first POC login and updated
  // on succession.
  pocEmail: varchar("pocEmail", { length: 320 }),
  // FK → storeUsers.id enforced at DB level by `c_poc_store_user_fk`
  // (migration 0082). Declared without .references() here to avoid a
  // circular type inference cycle: clients → storeUsers → stores → clients.
  pocStoreUserId: int("pocStoreUserId"),
  notes: text("notes"),
  // PSRESTful Sub-Accounts — globally unique `mkf_client_xxx` prefix enforced
  // by CHECK constraint at the DB layer (migration 0087). Null until provisioned.
  externalCustomerId: varchar("externalCustomerId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("clients_userId_idx").on(t.userId),
  orgIdIdx: index("clients_orgId_idx").on(t.organizationId),
  orgStatusIdx: index("clients_orgStatus_idx").on(t.organizationId, t.status),
  externalCustomerIdUnique: uniqueIndex("client_external_id_unique").on(t.externalCustomerId),
}));

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

/**
 * Client contacts — multiple contact people per client company.
 *
 * The clients table retains its singular contactName/contactEmail/contactPhone/contactTitle
 * fields for backward compatibility. On create the primary contact is mirrored into
 * this table; subsequent edits to the primary contact keep both in sync where feasible.
 */
export const clientContacts = mysqlTable("clientContacts", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull().references(() => clients.id),
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  title: varchar("title", { length: 128 }),
  isPrimary: boolean("isPrimary").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  clientIdIdx: index("clientContacts_clientId_idx").on(t.clientId),
  clientPrimaryIdx: index("clientContacts_clientId_primary_idx").on(t.clientId, t.isPrimary),
}));

export type ClientContact = typeof clientContacts.$inferSelect;
export type InsertClientContact = typeof clientContacts.$inferInsert;

/**
 * Products — items in the distributor's catalog.
 */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // owner distributor user
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  name: varchar("name", { length: 255 }).notNull(),
  sku: varchar("sku", { length: 128 }),
  category: mysqlEnum("category", ["apparel", "drinkware", "tech", "bags", "writing", "wellness", "outdoor", "office", "other"]).default("other").notNull(),
  type: mysqlEnum("type", ["promotional", "print"]).default("promotional").notNull(),
  description: text("description"),
  supplier: varchar("supplier", { length: 255 }),
  supplierSku: varchar("supplierSku", { length: 128 }),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  // Additional images stored as JSON array of URLs
  additionalImages: json("additionalImages").$type<string[]>(),
  // Decoration options stored as JSON
  decorationMethods: json("decorationMethods").$type<string[]>(),
  // Pricing tiers stored as JSON: [{minQty, maxQty, price}]
  pricingTiers: json("pricingTiers").$type<{ minQty: number; maxQty: number; price: number }[]>(),
  // Source tracking
  source: mysqlEnum("source", ["manual", "csv", "api", "asi", "sage", "promostandards"]).default("manual").notNull(),
  sourceApiId: varchar("sourceApiId", { length: 255 }),
  // External integration fields (ASI ESP + PromoStandards)
  externalId: varchar("externalId", { length: 512 }),
  externalSource: mysqlEnum("externalSource", ["asi", "promostandards"]),
  hasLiveInventory: boolean("hasLiveInventory").default(false).notNull(),
  supplierCode: varchar("supplierCode", { length: 64 }),
  productNumber: varchar("productNumber", { length: 128 }),
  currency: varchar("currency", { length: 8 }).default("USD").notNull(),
  colors: json("colors").$type<string[]>(),
  sizes: json("sizes").$type<string[]>(),
  minQuantity: int("minQuantity"),
  // Print-on-demand specific fields
  printAreas: json("printAreas").$type<string[]>(), // e.g. ["front", "back", "full-bleed"]
  printMethods: json("printMethods").$type<string[]>(), // e.g. ["offset", "digital", "letterpress"]
  printColors: json("printColors").$type<string[]>(), // e.g. ["CMYK", "1-color", "2-color", "PMS"]
  minOrderQty: int("minOrderQty"),
  // File specs for print products
  fileSpecs: varchar("fileSpecs", { length: 512 }), // e.g. "PDF / AI · 3.5x2 · 300dpi"
  status: mysqlEnum("productStatus", ["active", "inactive", "draft"]).default("active").notNull(),
  // ── Webstore imprint placement (Tier 1: Claude vision → cached coordinates) ──
  // Per-product logo placement coordinates analyzed by Claude vision at
  // ingestion. Read by the customer-facing WebstoreLogoOverlay to composite
  // the client logo onto the correct spot on the product image. All values
  // are normalized 0..1 fractions of the source image so the same numbers
  // work at any render size. See server/services/webstore-imprint-placement.ts
  // for the analysis contract.
  //
  // Intentionally distinct from virtualProofs.placementData (server-rendered
  // raster proofs for the distributor proofing studio). Different pipeline,
  // different audience — see docs/virtual-proofing-recon.md.
  webstoreImprintPlacementX:          decimal("webstoreImprintPlacementX",          { precision: 5, scale: 4 }),
  webstoreImprintPlacementY:          decimal("webstoreImprintPlacementY",          { precision: 5, scale: 4 }),
  webstoreImprintPlacementWidth:      decimal("webstoreImprintPlacementWidth",      { precision: 5, scale: 4 }),
  webstoreImprintPlacementHeight:     decimal("webstoreImprintPlacementHeight",     { precision: 5, scale: 4 }),
  webstoreImprintPlacementZone:       varchar("webstoreImprintPlacementZone",       { length: 50 }),
  webstoreImprintPlacementBlendMode:  varchar("webstoreImprintPlacementBlendMode",  { length: 20 }),
  webstoreImprintPlacementConfidence: decimal("webstoreImprintPlacementConfidence", { precision: 3, scale: 2 }),
  webstoreImprintPlacementAnalyzedAt: timestamp("webstoreImprintPlacementAnalyzedAt"),
  webstoreImprintPlacementSource:     mysqlEnum("webstoreImprintPlacementSource", ["ai", "distributor_override"]).default("ai"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("products_userId_idx").on(t.userId),
  orgIdIdx: index("products_orgId_idx").on(t.organizationId),
  categoryIdx: index("products_category_idx").on(t.category),
  statusIdx: index("products_status_idx").on(t.status),
  orgCategoryIdx: index("products_orgCategory_idx").on(t.organizationId, t.category),
  // Backfill script seeks rows where analyzedAt IS NULL.
  webstorePlacementPendingIdx: index("products_webstore_placement_pending_idx").on(t.webstoreImprintPlacementAnalyzedAt),
}));

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Custom API Connections — for suppliers outside ASI/Sage.
 */
export const apiConnections = mysqlTable("apiConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  name: varchar("name", { length: 255 }).notNull(),
  baseUrl: varchar("baseUrl", { length: 1024 }).notNull(),
  format: mysqlEnum("format", ["rest_json", "rest_xml", "graphql", "soap"]).default("rest_json").notNull(),
  authType: mysqlEnum("authType", ["api_key", "oauth2", "basic_auth", "none"]).default("api_key").notNull(),
  // Encrypted credentials stored as JSON
  credentials: json("credentials").$type<Record<string, string>>(),
  // Field mapping: { productName: "response.items[].name", ... }
  fieldMapping: json("fieldMapping").$type<Record<string, string>>(),
  lastSyncAt: timestamp("lastSyncAt"),
  syncStatus: mysqlEnum("syncStatus", ["connected", "error", "pending", "never"]).default("never").notNull(),
  productCount: int("productCount").default(0).notNull(),
  status: mysqlEnum("apiStatus", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiConnection = typeof apiConnections.$inferSelect;
export type InsertApiConnection = typeof apiConnections.$inferInsert;

/**
 * Stores — webstores created for clients.
 */
export const stores = mysqlTable("stores", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // owner distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  clientId: int("clientId").notNull().references(() => clients.id),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  storeType: mysqlEnum("storeType", ["permanent", "popup"]).default("permanent").notNull(),
  // Branding
  logoUrl: varchar("logoUrl", { length: 1024 }),
  primaryColor: varchar("primaryColor", { length: 7 }).default("#6C2BD9"),
  bannerUrl: varchar("bannerUrl", { length: 1024 }),
  welcomeMessage: text("welcomeMessage"),
  // AI-generated content
  aiDescription: text("aiDescription"), // AI-generated store description
  aiTagline: varchar("aiTagline", { length: 512 }), // AI-generated tagline
  aiCategoryDescriptions: json("aiCategoryDescriptions"), // { category: description } map
  aiOptimizedAt: timestamp("aiOptimizedAt"), // when AI last optimized this store
  // Template & AI-generated hero content
  template: mysqlEnum("template", ["classic", "modern", "minimal"]).default("modern").notNull(),
  aiHeroHeadline: varchar("aiHeroHeadline", { length: 255 }), // AI-generated hero headline
  aiHeroSubtitle: varchar("aiHeroSubtitle", { length: 512 }), // AI-generated hero subtitle
  aiIndustryTheme: varchar("aiIndustryTheme", { length: 128 }), // AI-detected industry theme
  aiColorPalette: json("aiColorPalette"), // AI-suggested complementary colors
  aiProductPageCTA: varchar("aiProductPageCTA", { length: 100 }),
  aiProductGridHeading: varchar("aiProductGridHeading", { length: 150 }),
  aiProductBadgeStyle: mysqlEnum("aiProductBadgeStyle", ["pill", "ribbon", "corner"]),
  aiTemplateSuggestion: mysqlEnum("aiTemplateSuggestion", ["classic", "modern", "minimal"]), // AI-suggested best template
  // Features
  stripeEnabled: boolean("stripeEnabled").default(false).notNull(),
  multiDepartment: boolean("multiDepartment").default(false).notNull(),
  multiLocationEnabled: boolean("multiLocationEnabled").default(false).notNull(),
  rbacEnabled: boolean("rbacEnabled").default(false).notNull(),
  ssoEnabled: boolean("ssoEnabled").default(false).notNull(),
  ssoProvider: mysqlEnum("ssoProvider", ["microsoft_entra", "google_workspace", "okta", "none"]).default("none").notNull(),
  // Email sender override (for store-branded outbound emails)
  senderName: varchar("senderName", { length: 255 }), // display name for store emails (e.g. "Acme Store")
  senderEmail: varchar("senderEmail", { length: 320 }), // reply-to email for store emails
  // Access control
  allowedEmailsJson: json("allowedEmailsJson"), // array of whitelisted emails
  requireAuth: boolean("requireAuth").default(true).notNull(),
  /**
   * Self-signup gate (added 2026-04-27 in migration 0100). Replaces the
   * legacy implicit "no domain restrictions = allow all" fallback in
   * storeAuth.ts:requestLogin with an explicit four-state mode:
   *   - closed:           reject ALL new authentication attempts (active
   *                       JWT sessions remain valid; closed blocks the
   *                       OTP-issue path, not protected-procedure use).
   *   - invite_only:      allow only emails listed in allowedEmailsJson.
   *   - domain_whitelist: allow only emails whose domain matches a row
   *                       in storeAllowedDomains.
   *   - open_signup:      any email may self-sign-up (preserves the
   *                       legacy permissive default).
   *
   * Default for NEW stores: 'invite_only' (closed-by-default — distributor
   * must opt in to broader signup). Existing stores backfilled by 0100.
   */
  selfSignupMode: mysqlEnum("selfSignupMode", ["closed", "invite_only", "domain_whitelist", "open_signup"]).default("invite_only").notNull(),
  // Pop-up specific
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  linkedStoreId: int("linkedStoreId"), // self-reference FK → stores.id (circular ref handled by migration 0027)
  status: mysqlEnum("storeStatus", ["active", "inactive", "setup", "draft", "pending_approval", "revision_requested"]).default("setup").notNull(),
  // Client approval workflow
  approvalToken: varchar("approvalToken", { length: 64 }),              // unique token for client approval link
  approvalClientEmail: varchar("approvalClientEmail", { length: 320 }), // email address approval was sent to
  approvalClientName: varchar("approvalClientName", { length: 255 }),   // display name used in email
  approvalSentAt: timestamp("approvalSentAt"),                          // when approval email was dispatched
  approvalApprovedAt: timestamp("approvalApprovedAt"),                  // when client clicked Approve
  approvalNotes: text("approvalNotes"),                                 // optional client comment
  approvalExpiresAt: timestamp("approvalExpiresAt"),                    // token expiry (default 14 days)
  // Store Editor overrides (pre-launch editable fields)
  editorHeroHeadline: varchar("editorHeroHeadline", { length: 255 }),
  editorHeroSubtitle: varchar("editorHeroSubtitle", { length: 512 }),
  editorTagline: varchar("editorTagline", { length: 512 }),
  editorWelcomeMessage: text("editorWelcomeMessage"),
  editorCategoryOrder: json("editorCategoryOrder"), // ordered array of category ids
  editorCategoryNames: json("editorCategoryNames"), // { id: displayName } map
  editorSubCategories: json("editorSubCategories"), // { catId: [{ id, name, productIds[] }] }
  editorProductNames: json("editorProductNames"), // { productId: displayName } map
  editorProductDescriptions: json("editorProductDescriptions"), // { productId: description } map
  // Checkout settings
  taxRate: decimal("taxRate", { precision: 5, scale: 4 }), // e.g. "0.0875" = 8.75%; null = tax-exempt
  /** ISO 4217 currency code used for Stripe checkout. Defaults to "usd"; "cad" for Canadian distributors. */
  currency: varchar("currency", { length: 3 }).default("usd"),
  branchLocations: json("branchLocations").$type<Array<{ id: string; name: string; address: string; isDefault?: boolean }>>(),
  allowedPaymentMethods: json("allowedPaymentMethods").$type<string[]>(), // null = all methods allowed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("stores_userId_idx").on(t.userId),
  orgIdIdx: index("stores_orgId_idx").on(t.organizationId),
  clientIdIdx: index("stores_clientId_idx").on(t.clientId),
  orgStatusIdx: index("stores_orgStatus_idx").on(t.organizationId, t.status),
}));

export type Store = typeof stores.$inferSelect;
export type InsertStore = typeof stores.$inferInsert;

/**
 * Store Products — products assigned to a specific store.
 */
export const storeProducts = mysqlTable("storeProducts", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  productId: int("productId").notNull().references(() => products.id),
  customPrice: decimal("customPrice", { precision: 10, scale: 2 }),
  featured: boolean("featured").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  trackInventory: boolean("trackInventory").default(false).notNull(),
  stockQuantity: int("stockQuantity"),  // null = unlimited when trackInventory is false
  // Division visibility: JSON array of division IDs this product is restricted to.
  // NULL or [] = shared (visible to every division's employees).
  divisionIds: json("divisionIds").$type<number[]>(),
  // ── Webstore photorealistic render (Tier 1: nano-banana → S3 WebP) ──
  // Per-binding render outputs. Moved from `products` in 0099 — same product
  // bound to two stores with different client logos must render twice, once
  // per (storeId, productId). Populated by the BullMQ render worker; read by
  // storesCrud.getBySlug and projected to WebstoreLogoOverlay on the client.
  // Distinct from virtualProofs.proofImageUrl (distributor proofing studio).
  webstoreRenderedImageUrl: text("webstoreRenderedImageUrl"),
  webstoreRenderedAt:       timestamp("webstoreRenderedAt"),
  webstoreRenderDecoration: varchar("webstoreRenderDecoration", { length: 50 }),
  webstoreRenderStatus:     mysqlEnum("webstoreRenderStatus", ["pending", "rendering", "complete", "failed"]),
  webstoreRenderModel:      varchar("webstoreRenderModel", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  storeIdIdx: index("storeProducts_storeId_idx").on(t.storeId),
  productIdIdx: index("storeProducts_productId_idx").on(t.productId),
}));
export type StoreProduct = typeof storeProducts.$inferSelect;;
export type InsertStoreProduct = typeof storeProducts.$inferInsert;

/**
 * Proposals — proposals sent to clients.
 */
export const proposals = mysqlTable("proposals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  clientId: int("clientId").notNull().references(() => clients.id),
  title: varchar("title", { length: 255 }).notNull(),
  proposalType: mysqlEnum("proposalType", ["promo", "print", "promo_print"]).default("promo").notNull(),
  status: mysqlEnum("proposalStatus", ["draft", "sent", "viewed", "accepted", "declined", "expired", "fulfilled"]).default("draft").notNull(),
  estimatedValue: decimal("estimatedValue", { precision: 12, scale: 2 }),
  // Delivery settings
  deliveryMethod: mysqlEnum("deliveryMethod", ["email", "webstore", "both"]).default("email").notNull(),
  storeId: int("storeId").references(() => stores.id),
  // Features
  stripeCheckout: boolean("stripeCheckout").default(false).notNull(),
  multiDepartment: boolean("multiDepartment").default(false).notNull(),
  approvalRouting: mysqlEnum("approvalRouting", ["parallel", "sequential"]).default("parallel").notNull(),
  virtualProofs: boolean("virtualProofs").default(false).notNull(),
  // When true, department approval tokens expire 72h after issuance.
  // When false (default), tokens never expire.
  approvalLinkExpiryEnabled: boolean("approvalLinkExpiryEnabled").default(false).notNull(),
  // Public access
  viewToken: varchar("viewToken", { length: 32 }),
  // Metadata
  notes: text("notes"),
  validDays: int("validDays").default(30).notNull(), // 0 = no expiration (permanent)
  sentAt: timestamp("sentAt"),
  viewedAt: timestamp("viewedAt"),
  respondedAt: timestamp("respondedAt"),
  fulfillmentRequestedAt: timestamp("fulfillmentRequestedAt"),
  fulfilledAt: timestamp("fulfilledAt"),
  // Free-form comment a POC leaves when accepting the proposal (request
  // fulfillment or override). Stored distinct from `notes` so the client's
  // words can be surfaced on the distributor view separate from the system
  // audit log. NULL when no comment was given.
  acceptanceComment: text("acceptanceComment"),
  // Payment & refund tracking
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  paymentRefunded: boolean("paymentRefunded").default(false).notNull(),
  refundedAmount: int("refundedAmount").default(0).notNull(),
  refundedAt: timestamp("refundedAt"),
  stripeRefundId: varchar("stripeRefundId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("proposals_userId_idx").on(t.userId),
  orgIdIdx: index("proposals_orgId_idx").on(t.organizationId),
  clientIdIdx: index("proposals_clientId_idx").on(t.clientId),
  statusIdx: index("proposals_status_idx").on(t.status),
  orgStatusIdx: index("proposals_orgStatus_idx").on(t.organizationId, t.status),
  viewTokenIdx: index("proposals_viewToken_idx").on(t.viewToken),
}));

export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = typeof proposals.$inferInsert;

/**
 * Proposal Products — products included in a proposal.
 */
export const proposalProducts = mysqlTable("proposalProducts", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull().references(() => proposals.id),
  productId: int("productId").notNull().references(() => products.id),
  quantity: int("quantity").default(1).notNull(),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  // Supplier cost / wholesale price — used for PO generation only, NEVER shown
  // to clients. Nullable: when null, falls back to products.basePrice; if that
  // is also null the PO line shows "TBD" until populated.
  costPrice: decimal("costPrice", { precision: 10, scale: 2 }),
  decorationType: varchar("decorationType", { length: 128 }),
  decorationNotes: text("decorationNotes"),
  // Bare int — DB-level FK to productImprintZones.id enforced by migration 0084.
  // Not declared with .references() to avoid a forward reference on productImprintZones.
  imprintZoneId: int("imprintZoneId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("proposalProducts_proposalId_idx").on(t.proposalId),
  productIdIdx: index("proposalProducts_productId_idx").on(t.productId),
}));

export type ProposalProduct = typeof proposalProducts.$inferSelect;
export type InsertProposalProduct = typeof proposalProducts.$inferInsert;

/**
 * Orders — orders placed through webstores.
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  clientId: int("clientId").notNull().references(() => clients.id),
  storeId: int("storeId").references(() => stores.id),
  storeUserId: int("storeUserId").references(() => storeUsers.id),
  proposalId: int("proposalId").references(() => proposals.id),
  orderNumber: varchar("orderNumber", { length: 32 }).notNull().unique(),
  status: mysqlEnum("orderStatus", ["pending", "processing", "production", "shipped", "delivered", "cancelled", "refunded", "partially_refunded", "payment_failed"]).default("pending").notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0.00").notNull(),
  shipping: decimal("shipping", { precision: 10, scale: 2 }).default("0.00").notNull(),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  // Shipping info
  shippingName: varchar("shippingName", { length: 255 }),
  shippingAddress: text("shippingAddress"),
  trackingNumber: varchar("trackingNumber", { length: 128 }),
  // Payment
  paymentMethod: mysqlEnum("paymentMethod", ["credit_card", "po_number", "gl_code", "company_points"]).default("credit_card"),
  paymentReference: varchar("paymentReference", { length: 255 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }), // Stripe PaymentIntent or Checkout Session ID
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 255 }), // Connected account that received the funds
  platformFeeAmount: decimal("platformFeeAmount", { precision: 10, scale: 2 }), // MergeTasks platform fee collected
  notes: text("notes"),
  // PO/GL checkout fields
  billingAddress: text("billingAddress"),
  branchLocationId: varchar("branchLocationId", { length: 64 }),  // references store's branchLocations[].id
  glCode: varchar("glCode", { length: 128 }),
  branchAllocation: json("branchAllocation").$type<Array<{ branchId: string; percentage: number }>>(),
  // Refund tracking
  refundedAmount: int("refundedAmount").default(0).notNull(),
  refundedAt: timestamp("refundedAt"),
  stripeRefundId: varchar("stripeRefundId", { length: 255 }),
  // Promo code support
  promoCodeId: int("promoCodeId").references(() => promoCodes.id),
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("orders_userId_idx").on(t.userId),
  orgIdIdx: index("orders_orgId_idx").on(t.organizationId),
  clientIdIdx: index("orders_clientId_idx").on(t.clientId),
  statusIdx: index("orders_status_idx").on(t.status),
  orgStatusIdx: index("orders_orgStatus_idx").on(t.organizationId, t.status),
  storeUserIdIdx: index("orders_storeUserId_idx").on(t.storeUserId),
  // Unique index on stripePaymentIntentId prevents duplicate webhook processing at the DB level.
  stripePaymentIntentIdx: uniqueIndex("orders_stripePaymentIntent_idx").on(t.stripePaymentIntentId),
}));
export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Order Items — individual products in an order.
 */
export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull().references(() => orders.id),
  productId: int("productId").notNull().references(() => products.id),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 10, scale: 2 }).notNull(),
  decorationType: varchar("decorationType", { length: 128 }),
  size: varchar("size", { length: 32 }),
  color: varchar("color", { length: 64 }),
  // Bare int — DB-level FK to productImprintZones.id enforced by migration 0084.
  // Not declared with .references() to avoid a forward reference on productImprintZones.
  imprintZoneId: int("imprintZoneId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orderIdIdx: index("orderItems_orderId_idx").on(t.orderId),
}));

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

/**
 * Virtual Proofs — AI-generated product mockups with realistic decoration effects.
 */
export const virtualProofs = mysqlTable("virtualProofs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  productId: int("productId").references(() => products.id),
  proposalId: int("proposalId").references(() => proposals.id),
  clientId: int("clientId").references(() => clients.id),
  // Product info
  productName: varchar("productName", { length: 255 }).notNull(),
  productImageUrl: text("productImageUrl"),
  // Logo/artwork
  logoUrl: text("logoUrl"), // uploaded client logo
  logoName: varchar("logoName", { length: 255 }),
  // Decoration
  decorationMethod: mysqlEnum("decorationMethod", [
    "embroidery", "screen_print", "laser_engraving",
    "heat_transfer", "dtg", "sublimation", "deboss", "patch"
  ]).default("screen_print").notNull(),
  decorationZone: varchar("decorationZone", { length: 64 }).default("front"), // front, back, left_sleeve, right_sleeve, pocket
  // Bare int — DB-level FK to productImprintZones.id enforced by migration 0086.
  // Not declared with .references() to avoid a forward reference (productImprintZones
  // is defined later in this file).
  imprintZoneId: int("imprintZoneId"),
  // Placement data (JSON: x, y, width, height, rotation)
  placementData: text("placementData"),
  // AI-generated proof
  proofImageUrl: text("proofImageUrl"), // final rendered proof
  // Status
  status: mysqlEnum("proofStatus", ["draft", "rendering", "ready", "approved", "revision_requested"]).default("draft").notNull(),
  revisionNotes: text("revisionNotes"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("virtualProofs_proposalId_idx").on(t.proposalId),
  clientIdIdx: index("virtualProofs_clientId_idx").on(t.clientId),
}));

export type VirtualProof = typeof virtualProofs.$inferSelect;
export type InsertVirtualProof = typeof virtualProofs.$inferInsert;

/**
 * Client Logos — logo library per client for reuse across proposals and proofs.
 */
export const clientLogos = mysqlTable("clientLogos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // distributor who uploaded
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  clientId: int("clientId").notNull().references(() => clients.id), // which client this logo belongs to
  logoUrl: text("logoUrl").notNull(), // S3 URL
  logoName: varchar("logoName", { length: 255 }).notNull(), // original filename or label
  fileSize: int("fileSize"), // bytes
  mimeType: varchar("mimeType", { length: 64 }),
  isPrimary: boolean("isPrimary").default(false).notNull(), // primary brand logo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // Cloudinary background-removed transparent PNG, lazy-populated on first
  // webstore render by server/services/logo-background-removal.ts. Original
  // logoUrl remains the source of truth; this is just the overlay-friendly
  // cache.
  processedLogoUrl: text("processedLogoUrl"),
  processedAt: timestamp("processedAt"),
}, (t) => ({
  clientIdIdx: index("clientLogos_clientId_idx").on(t.clientId),
}));

export type ClientLogo = typeof clientLogos.$inferSelect;
export type InsertClientLogo = typeof clientLogos.$inferInsert;

/**
 * Email Connections — Gmail/Outlook OAuth connections for sending proposals.
 */
export const emailConnections = mysqlTable("emailConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  provider: mysqlEnum("provider", ["gmail", "outlook", "smtp"]).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  displayName: varchar("displayName", { length: 255 }),
  // OAuth tokens (encrypted in production)
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  isDefault: boolean("isDefault").default(false).notNull(),
  // SMTP config (only for smtp provider)
  smtpHost: varchar("smtpHost", { length: 255 }),
  smtpPort: int("smtpPort"),
  smtpUsername: varchar("smtpUsername", { length: 255 }),
  smtpPassword: text("smtpPassword"),
  smtpSecure: boolean("smtpSecure").default(true),
  status: mysqlEnum("emailStatus", ["connected", "expired", "disconnected"]).default("connected").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailConnection = typeof emailConnections.$inferSelect;
export type InsertEmailConnection = typeof emailConnections.$inferInsert;

/**
 * Verification codes for email-based 2FA.
 */
export const verificationCodes = mysqlTable("verificationCodes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  email: varchar("email", { length: 320 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(), // SHA-256 hex hash of 6-digit OTP
  type: mysqlEnum("codeType", ["login_2fa", "signup_verify", "password_reset"]).default("login_2fa").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("verificationCodes_userId_idx").on(t.userId),
  emailIdx: index("verificationCodes_email_idx").on(t.email),
}));

export type VerificationCode = typeof verificationCodes.$inferSelect;
export type InsertVerificationCode = typeof verificationCodes.$inferInsert;

/**
 * Distributor profiles — onboarding questionnaire answers + AI personalization.
 */
export const distributorProfiles = mysqlTable("distributorProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  companyName: varchar("companyName", { length: 255 }),
  companySize: varchar("companySize", { length: 64 }),
  annualRevenue: varchar("annualRevenue", { length: 64 }),
  yearsInBusiness: varchar("yearsInBusiness", { length: 32 }),
  specialties: json("specialties"), // array of strings
  topCategories: json("topCategories"), // array of strings
  targetIndustries: json("targetIndustries"), // array of strings
  primaryGoal: varchar("primaryGoal", { length: 255 }),
  currentTools: varchar("currentTools", { length: 512 }),
  teamSize: varchar("teamSize", { length: 32 }),
  // Branding
  brandLogoUrl: text("brandLogoUrl"), // processed logo with bg removed, stored in S3
  brandLogoOriginalUrl: text("brandLogoOriginalUrl"), // original uploaded logo
  brandPrimaryColor: varchar("brandPrimaryColor", { length: 7 }).default("#654BF9"),
  brandSecondaryColor: varchar("brandSecondaryColor", { length: 7 }).default("#1A1A1A"),
  brandBannerColor: varchar("brandBannerColor", { length: 7 }).default("#654BF9"), // email banner/header color
  brandCompanyName: varchar("brandCompanyName", { length: 255 }), // display name for emails/branding
  // Contact details shown on branded PDFs (estimates, invoices, POs)
  companyAddress: text("companyAddress"), // full mailing address
  companyPhone: varchar("companyPhone", { length: 40 }),
  companyEmail: varchar("companyEmail", { length: 320 }),
  companyWebsite: varchar("companyWebsite", { length: 512 }),
  senderEmail: varchar("senderEmail", { length: 320 }), // reply-to email for distributor→client emails
  senderName: varchar("senderName", { length: 255 }), // sender display name override for distributor→client emails
  // AI-generated personalization
  aiRecommendations: json("aiRecommendations"), // AI-generated feature recommendations
  aiWelcomeMessage: text("aiWelcomeMessage"), // personalized welcome message
  onboardingCompleted: boolean("onboardingCompleted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DistributorProfile = typeof distributorProfiles.$inferSelect;
export type InsertDistributorProfile = typeof distributorProfiles.$inferInsert;

/**
 * Client Assets — files stored per client (logos, brand guidelines, artwork, documents, photos).
 */
export const clientAssets = mysqlTable("clientAssets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id), // distributor who uploaded
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  clientId: int("clientId").notNull().references(() => clients.id), // which client this asset belongs to
  fileUrl: text("fileUrl").notNull(), // S3 URL
  fileName: varchar("fileName", { length: 255 }).notNull(), // original filename
  fileType: varchar("fileType", { length: 64 }), // mime type
  fileSize: int("fileSize"), // bytes
  category: mysqlEnum("assetCategory", ["logo", "brand_guide", "artwork", "document", "photo", "other"]).default("other").notNull(),
  description: text("description"), // optional note about the asset
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClientAsset = typeof clientAssets.$inferSelect;
export type InsertClientAsset = typeof clientAssets.$inferInsert;

/**
 * Waitlist — marketing leads who want to join Phase 2.
 */
export const waitlist = mysqlTable("waitlist", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }),
  email: varchar("email", { length: 320 }).notNull(),
  company: varchar("company", { length: 255 }),
  companySize: varchar("companySize", { length: 64 }),
  message: text("message"),
  status: mysqlEnum("waitlistStatus", ["pending", "contacted", "onboarded", "declined"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type InsertWaitlistEntry = typeof waitlist.$inferInsert;


/**
 * Store Users — end-users who can access a client webstore.
 * These are NOT distributors — they are the client's employees.
 */
/**
 * Store Locations — per-store location tabs (e.g. Ontario, Quebec, Michigan).
 * Controlled by stores.multiLocationEnabled; when disabled, tabs do not render.
 */
export const storeLocations = mysqlTable("storeLocations", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  storeIdx: index("sl_store_idx").on(t.storeId),
  storeSlugUnique: uniqueIndex("sl_store_slug_unique").on(t.storeId, t.slug),
}));

export type StoreLocation = typeof storeLocations.$inferSelect;
export type InsertStoreLocation = typeof storeLocations.$inferInsert;

/**
 * Location Branding Assets — per-location branding overrides. All fields
 * nullable; null means fall back to store-level branding. One row per location.
 */
export const locationBrandingAssets = mysqlTable("locationBrandingAssets", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull().references(() => storeLocations.id, { onDelete: "cascade" }),
  logoUrl: varchar("logoUrl", { length: 1024 }),
  primaryColor: varchar("primaryColor", { length: 32 }),
  bannerUrl: varchar("bannerUrl", { length: 1024 }),
  bannerText: varchar("bannerText", { length: 512 }),
  welcomeMessage: text("welcomeMessage"),
  aiTagline: varchar("aiTagline", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  locationUnique: uniqueIndex("lba_location_unique").on(t.locationId),
}));

export type LocationBrandingAsset = typeof locationBrandingAssets.$inferSelect;
export type InsertLocationBrandingAsset = typeof locationBrandingAssets.$inferInsert;

export const storeUsers = mysqlTable("storeUsers", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 255 }),
  role: mysqlEnum("storeUserRole", ["poc", "admin", "manager", "employee", "intern"]).default("employee").notNull(),
  department: varchar("department", { length: 128 }),           // Legacy free-text name (kept for display)
  departmentId: int("departmentId").references(() => storeDepartments.id, { onDelete: "set null" }), // FK to budget-tracked department
  passwordHash: varchar("passwordHash", { length: 255 }), // bcrypt hash for email/password login (No SSO)
  spendingLimit: decimal("spendingLimit", { precision: 10, scale: 2 }), // per-order limit based on role
  pointsBalance: int("pointsBalance").default(0).notNull(),
  status: mysqlEnum("storeUserStatus", ["active", "invited", "suspended"]).default("invited").notNull(),
  lastLoginAt: timestamp("lastLoginAt"),
  // SSO identity link (enterprise stores)
  ssoProviderId: int("ssoProviderId"),
  ssoSubject: varchar("ssoSubject", { length: 255 }),
  ssoGroup: varchar("ssoGroup", { length: 255 }),
  // Location assignment (resolved from SSO group/email mapping at login).
  // NULL on legacy stores without multi-location enabled.
  locationId: int("locationId").references(() => storeLocations.id, { onDelete: "set null" }),
  roleInDepartment: mysqlEnum("roleInDepartment", ["member", "head"]).default("member").notNull(),
  // PCI DSS Req 8.1.6 — account lockout after repeated failed login attempts
  failedLoginAttempts: int("failedLoginAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  /**
   * Soft-delete timestamp. When non-null the user can no longer log in and
   * is filtered out of every active-user query, but all historical records
   * (orders, approvals, spend history) remain intact and linked.
   */
  deletedAt: timestamp("deletedAt"),
}, (t) => ({
  storeIdIdx: index("storeUsers_storeId_idx").on(t.storeId),
  emailIdx: index("storeUsers_email_idx").on(t.email),
}));

export type StoreUser = typeof storeUsers.$inferSelect;
export type InsertStoreUser = typeof storeUsers.$inferInsert;

/**
 * Store Departments — budget-tracked departments within a client webstore.
 *
 * Three-layer model:
 *   Distributor → creates departments with budgets + fiscal periods
 *   POC/Client Admin → adjusts budgets within distributor-set limits
 *   Employee → sees remaining budget at checkout, blocked if exceeded
 *
 * Budgets stored in cents (integer) to avoid floating-point issues.
 * spentCents is atomically incremented on each confirmed order.
 */
export const departmentCreatedByEnum = mysqlEnum("departmentCreatedBy", ["distributor", "poc"]);

export const storeDepartments = mysqlTable("storeDepartments", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  // Optional link to a location (enterprise feature). NULL = legacy/flat shape.
  locationId: int("locationId").references(() => storeLocations.id, { onDelete: "set null" }),
  // Department head — one storeUser designated as head (enforced in application layer).
  // FK → storeUsers.id enforced at DB level by `sd_dept_head_fk` (migration 0082).
  // Declared without .references() here to avoid a circular type inference
  // cycle: storeDepartments → storeUsers → storeDepartments (via departmentId).
  departmentHeadId: int("departmentHeadId"),
  name: varchar("name", { length: 255 }).notNull(),
  budgetCents: int("budgetCents").notNull().default(0),       // Total budget for the fiscal period
  spentCents: int("spentCents").notNull().default(0),         // Running total — atomically incremented
  maxPerOrderCents: int("maxPerOrderCents"),                   // Optional per-order cap (NULL = no limit)
  fiscalPeriodStart: date("fiscalPeriodStart").notNull(),
  fiscalPeriodEnd: date("fiscalPeriodEnd").notNull(),
  warnThresholdPct: int("warnThresholdPct").notNull().default(80), // % at which storefront surfaces a "nearing limit" warning
  isActive: boolean("isActive").notNull().default(true),       // Soft delete — inactive = excluded from checks
  createdBy: departmentCreatedByEnum.notNull().default("distributor"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StoreDepartment = typeof storeDepartments.$inferSelect;
export type InsertStoreDepartment = typeof storeDepartments.$inferInsert;

/**
 * Store Verification Codes — OTP codes for store user email login.
 */
export const storeVerificationCodes = mysqlTable("storeVerificationCodes", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  email: varchar("email", { length: 320 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(), // SHA-256 hex hash of 6-digit OTP
  expiresAt: timestamp("expiresAt").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StoreVerificationCode = typeof storeVerificationCodes.$inferSelect;
export type InsertStoreVerificationCode = typeof storeVerificationCodes.$inferInsert;

/**
 * Store Access Config — controls who can access a store (allowed domains, emails, SSO).
 * Stored as JSON fields on the stores table would be simpler, but a separate table
 * gives us flexibility for multiple domains/emails.
 */
export const storeAllowedDomains = mysqlTable("storeAllowedDomains", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  domain: varchar("domain", { length: 255 }).notNull(), // e.g. "altamaterial.com"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StoreAllowedDomain = typeof storeAllowedDomains.$inferSelect;
export type InsertStoreAllowedDomain = typeof storeAllowedDomains.$inferInsert;

/**
 * AI Training Data — logs every AI generation for future model fine-tuning.
 * This is the core of the closed-loop AI system.
 * Input context + AI output = training pair for fine-tuning.
 */
export const aiTrainingData = mysqlTable("aiTrainingData", {
  id: int("id").autoincrement().primaryKey(),
  // What triggered this generation
  entityType: varchar("entityType", { length: 50 }).notNull(), // 'store_optimization', 'proposal_draft', 'proof_prompt', etc.
  entityId: int("entityId").notNull(), // ID of the store, proposal, etc.
  userId: int("userId").references(() => users.id), // who triggered it (null = system auto)
  // The input context sent to the LLM
  inputContext: json("inputContext").notNull(), // { clientName, industry, products[], categories[], brandColor, etc. }
  // The system prompt used
  systemPrompt: text("systemPrompt"),
  // The raw AI output
  aiOutput: json("aiOutput").notNull(), // { tagline, description, categoryDescriptions, etc. }
  // Model metadata for reproducibility
  modelId: varchar("modelId", { length: 100 }), // e.g. 'gpt-4.1-mini', 'mergetasks-ft-v1'
  // Quality signals
  wasAccepted: boolean("wasAccepted").default(true), // did the user keep the AI output as-is?
  wasEdited: boolean("wasEdited").default(false), // did the user modify the output?
  // Performance signals (updated later)
  storeOrderCount: int("storeOrderCount").default(0), // how many orders this store got (proxy for quality)
  storeViewCount: int("storeViewCount").default(0), // how many views
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AiTrainingData = typeof aiTrainingData.$inferSelect;
export type InsertAiTrainingData = typeof aiTrainingData.$inferInsert;

/**
 * AI Edit Feedback — logs every human correction to AI-generated content.
 * Each row = one field edit. The "before" is what AI wrote, "after" is what the human changed it to.
 * This is the most valuable training signal — it teaches the model what "good" looks like.
 */
export const aiEditFeedback = mysqlTable("aiEditFeedback", {
  id: int("id").autoincrement().primaryKey(),
  trainingDataId: int("trainingDataId").notNull().references(() => aiTrainingData.id), // links back to the original AI generation
  entityType: varchar("entityType", { length: 50 }).notNull(), // 'store_optimization', etc.
  entityId: int("entityId").notNull(), // store ID, proposal ID, etc.
  userId: int("userId").notNull().references(() => users.id), // who made the edit
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  // The specific field that was edited
  fieldName: varchar("fieldName", { length: 100 }).notNull(), // 'tagline', 'description', 'categoryDescription_apparel', etc.
  // Before (AI-generated) and After (human-corrected)
  valueBefore: text("valueBefore"), // what the AI wrote
  valueAfter: text("valueAfter"), // what the human changed it to
  // Metadata
  editType: mysqlEnum("editType", ["replace", "refine", "delete"]).default("replace").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AiEditFeedback = typeof aiEditFeedback.$inferSelect;
export type InsertAiEditFeedback = typeof aiEditFeedback.$inferInsert;

/**
 * Department Approvals — tracks per-department approval status on multi-department proposals.
 * Each row = one department that needs to review/approve a proposal.
 * The POC (point of contact) can also add departments from the client portal.
 * Each department gets a unique approval token for their own approval link.
 */
export const departmentApprovals = mysqlTable("departmentApprovals", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull().references(() => proposals.id),
  departmentName: varchar("departmentName", { length: 255 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  description: varchar("description", { length: 512 }),
  // Unique token for this department's approval link
  approvalToken: varchar("approvalToken", { length: 64 }).notNull().unique(),
  // Optional expiry — only set when the proposal has approvalLinkExpiryEnabled.
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  // Approval status
  status: mysqlEnum("deptApprovalStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  // Who added this department: 'distributor' (during proposal creation) or 'poc' (from client portal)
  addedBy: mysqlEnum("addedBy", ["distributor", "poc"]).default("distributor").notNull(),
  // Approval details
  approvedAt: timestamp("approvedAt"),
  approverName: varchar("approverName", { length: 255 }),
  approverNotes: text("approverNotes"),
  // Email tracking
  emailSentAt: timestamp("emailSentAt"),
  emailViewedAt: timestamp("emailViewedAt"),
  // Ordering for sequential approval
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("departmentApprovals_proposalId_idx").on(t.proposalId),
}));
export type DepartmentApproval = typeof departmentApprovals.$inferSelect;
export type InsertDepartmentApproval = typeof departmentApprovals.$inferInsert;

//  AI Copilot Memory 
// Standard MySQL tables.
// When migrating, these tables work with any MySQL/Postgres/TiDB database.

/**
 * Stores AI conversation history so the copilot remembers past interactions.
 * Each row = one complete conversation session (user opens chat, has exchange, closes).
 */
export const copilotConversations = mysqlTable("copilot_conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  // Compact summary of the conversation (generated by LLM after session ends)
  summary: text("summary"),
  // Full message log as JSON array: [{role, content, actions?, timestamp}]
  messages: json("messages").$type<Array<{ role: string; content: string; actions?: Array<Record<string, unknown>>; timestamp?: string }>>().notNull(),
  // How many messages in this conversation
  messageCount: int("messageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userCreatedIdx: index("idx_cc_user_created").on(t.userId, t.createdAt),
  orgCreatedIdx: index("idx_cc_org_created").on(t.organizationId, t.createdAt),
}));
export type CopilotConversation = typeof copilotConversations.$inferSelect;

/**
 * Learned preferences and patterns extracted from user behavior.
 * Key-value store with categories for easy querying.
 * Examples:
 *   category="client_preference", key="most_used_client", value="Acme Corp"
 *   category="product_preference", key="common_product", value="Classic Hoodie"
 *   category="workflow_preference", key="default_quantity", value="50"
 */
export const copilotMemory = mysqlTable("copilot_memory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  category: varchar("category", { length: 64 }).notNull(),
  memoryKey: varchar("memoryKey", { length: 128 }).notNull(),
  memoryValue: text("memoryValue").notNull(),
  // How many times this preference has been reinforced (higher = more confident)
  confidence: int("confidence").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userCatIdx: index("idx_cm_user_cat").on(t.userId, t.category),
  userKeyIdx: index("idx_cm_user_key").on(t.userId, t.memoryKey),
}));
export type CopilotMemory = typeof copilotMemory.$inferSelect;

/**
 * Log of every task the AI executed — proposals created, stores built, emails sent.
 * Gives the AI context about what it's done before.
 */
export const copilotTaskLog = mysqlTable("copilot_task_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  // Task type: "proposal_created", "proposal_sent", "webstore_created", "products_assigned", "store_optimized"
  taskType: varchar("taskType", { length: 64 }).notNull(),
  // Structured data about the task (client, products, amounts, etc.)
  taskData: json("taskData").$type<Record<string, any>>().notNull(),
  // Human-readable summary: "Created proposal for Acme Corp — $2,450 (50 hoodies, 100 mugs)"
  taskSummary: text("taskSummary").notNull(),
  // Status of the task
  status: mysqlEnum("taskLogStatus", ["completed", "failed"]).default("completed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userCreatedIdx: index("idx_ctl_user_created").on(t.userId, t.createdAt),
  orgCreatedIdx: index("idx_ctl_org_created").on(t.organizationId, t.createdAt),
}));
export type CopilotTaskLog = typeof copilotTaskLog.$inferSelect;

/**
 * Print Requests — POC submits print/decoration requests from the client portal.
 * Covers business cards, envelopes, promotional materials, signage, etc.
 */
export const printRequests = mysqlTable("printRequests", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  clientId: int("clientId").references(() => clients.id),
  userId: int("userId").notNull().references(() => users.id), // distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  // Legacy division scope — divisions table removed in migration 0082;
  // the FK was dropped but the column retained for historical request
  // records. No longer written by new code. Superseded by locationId below.
  divisionId: int("divisionId"),
  // Portal-resolved location (migration 0090). Nullable because the
  // submitting storeUser may not be location-scoped (global admin / POC).
  locationId: int("locationId").references(() => storeLocations.id, { onDelete: "set null" }),
  requestedBy: varchar("requestedBy", { length: 320 }).notNull(), // email of the POC who submitted
  requestedByName: varchar("requestedByName", { length: 255 }),
  // Print details
  category: mysqlEnum("printCategory", ["business_cards", "envelopes", "letterhead", "brochures", "flyers", "banners", "signage", "promotional", "packaging", "other"]).default("other").notNull(),
  title: varchar("printTitle", { length: 255 }).notNull(),
  description: text("printDescription"),
  quantity: int("printQuantity").default(1).notNull(),
  // File attachments (artwork, specs, etc.) stored as JSON array of URLs
  attachments: json("attachments").$type<string[]>(),
  // Status workflow: submitted → reviewed → in_production → completed / rejected
  status: mysqlEnum("printStatus", ["submitted", "reviewed", "quoted", "approved", "in_production", "completed", "rejected"]).default("submitted").notNull(),
  // Distributor response
  quotedPrice: decimal("quotedPrice", { precision: 10, scale: 2 }),
  distributorNotes: text("distributorNotes"),
  estimatedDelivery: timestamp("estimatedDelivery"),
  // Timestamps
  reviewedAt: timestamp("reviewedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PrintRequest = typeof printRequests.$inferSelect;
export type InsertPrintRequest = typeof printRequests.$inferInsert;

/**
 * Store Password Tokens — set-password / reset-password tokens for No-SSO store users.
 * Distributor creates users → each gets a token emailed → user clicks link → sets password.
 */
export const storePasswordTokens = mysqlTable("storePasswordTokens", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  storeUserId: int("storeUserId").notNull().references(() => storeUsers.id),
  token: varchar("token", { length: 64 }).notNull().unique(),
  type: mysqlEnum("tokenType", ["set_password", "reset_password"]).default("set_password").notNull(),
  expiresAt: timestamp("tokenExpiresAt").notNull(),
  used: boolean("tokenUsed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StorePasswordToken = typeof storePasswordTokens.$inferSelect;
export type InsertStorePasswordToken = typeof storePasswordTokens.$inferInsert;

//  Proposal Redesign: Catalog-Style Interactive Proposals 

/**
 * Product Variants — available colors and sizes per product.
 * Manual input for now; API-ready for ASI/Sage integration later.
 */export const productVariants = mysqlTable("productVariants", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("pvProductId").notNull().references(() => products.id),  variantType: mysqlEnum("variantType", ["color", "size", "logo_position"]).notNull(),
  value: varchar("value", { length: 128 }).notNull(), // e.g. "Red", "XL"
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  productIdIdx: index("productVariants_productId_idx").on(t.productId),
}));
export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = typeof productVariants.$inferInsert;

/**
 * Proposal Product Variants — which variants are available for each product in a specific proposal.
 * Distributor picks which colors/sizes to offer per proposal.
 */
export const proposalProductVariants = mysqlTable("proposalProductVariants", {
  id: int("id").autoincrement().primaryKey(),
  proposalProductId: int("ppvProdId").notNull().references(() => proposalProducts.id),// FK → proposalProducts.id
  variantType: mysqlEnum("ppvVariantType", ["color", "size", "logo_position"]).notNull(),
  value: varchar("ppvValue", { length: 128 }).notNull(),
  sortOrder: int("ppvSortOrder").default(0).notNull(),
  createdAt: timestamp("ppvCreatedAt").defaultNow().notNull(),
}, (t) => ({
  proposalProductIdIdx: index("proposalProductVariants_ppId_idx").on(t.proposalProductId),
}));
export type ProposalProductVariant = typeof proposalProductVariants.$inferSelect;
export type InsertProposalProductVariant = typeof proposalProductVariants.$inferInsert;

/**
 * Proposal Price Tiers — quantity-based and/or size-based pricing per proposal product.
 * Distributor sets custom pricing per client/proposal.
 */
export const proposalPriceTiers = mysqlTable("proposalPriceTiers", {
  id: int("id").autoincrement().primaryKey(),
  proposalProductId: int("pptProdId").notNull().references(() => proposalProducts.id), // FK → proposalProducts.id
  tierType: mysqlEnum("tierType", ["quantity", "size"]).notNull(),
  label: varchar("tierLabel", { length: 128 }).notNull(), // e.g. "1-9", "10-49", "XS-XL", "2XL-4XL"
  minQty: int("tierMinQty"), // for quantity tiers
  maxQty: int("tierMaxQty"), // for quantity tiers (null = unlimited)
  price: decimal("tierPrice", { precision: 10, scale: 2 }).notNull(),
  sortOrder: int("tierSortOrder").default(0).notNull(),
  createdAt: timestamp("tierCreatedAt").defaultNow().notNull(),
});
export type ProposalPriceTier = typeof proposalPriceTiers.$inferSelect;
export type InsertProposalPriceTier = typeof proposalPriceTiers.$inferInsert;

/**
 * Proposal Order List Items — client's selected items from the catalog-style proposal.
 * Each row = one product configuration (product + color + size + quantity + comment).
 */
export const proposalOrderItems = mysqlTable("proposalOrderItems", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("poiProposalId").notNull().references(() => proposals.id),
  proposalProductId: int("poiProposalProductId").notNull().references(() => proposalProducts.id),
  productId: int("poiProductId").notNull().references(() => products.id), // FK → products.id (denormalized for convenience)
  color: varchar("poiColor", { length: 128 }),
  size: varchar("poiSize", { length: 128 }),
  logoPosition: varchar("poiLogoPosition", { length: 256 }),
  quantity: int("poiQuantity").default(1).notNull(),
  unitPrice: decimal("poiUnitPrice", { precision: 10, scale: 2 }),
  // Supplier cost / wholesale price for this line — PO-only, never shown to client.
  costPrice: decimal("poiCostPrice", { precision: 10, scale: 2 }),
  comment: text("poiComment"), // client's note for this specific item
  createdAt: timestamp("poiCreatedAt").defaultNow().notNull(),
  updatedAt: timestamp("poiUpdatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("proposalOrderItems_proposalId_idx").on(t.proposalId),
  proposalProductIdIdx: index("proposalOrderItems_proposalProductId_idx").on(t.proposalProductId),
}));
export type ProposalOrderItem = typeof proposalOrderItems.$inferSelect;
export type InsertProposalOrderItem = typeof proposalOrderItems.$inferInsert;

/**
 * Proposal Product Images — multiple images per proposal product.
 * Supports image carousel in the catalog-style proposal view.
 */
export const proposalProductImages = mysqlTable("proposalProductImages", {
  id: int("id").autoincrement().primaryKey(),
  proposalProductId: int("ppiProdId").notNull().references(() => proposalProducts.id), // FK → proposalProducts.id
  imageUrl: varchar("ppiImageUrl", { length: 1024 }).notNull(),
  sortOrder: int("ppiSortOrder").default(0).notNull(),
  createdAt: timestamp("ppiCreatedAt").defaultNow().notNull(),
});
export type ProposalProductImage = typeof proposalProductImages.$inferSelect;
export type InsertProposalProductImage = typeof proposalProductImages.$inferInsert;

/**
 * Proposal Size Charts — size chart data per proposal product.
 * Manual input for now; API-ready for ASI/Sage later.
 */
export const proposalSizeCharts = mysqlTable("proposalSizeCharts", {
  id: int("id").autoincrement().primaryKey(),
  proposalProductId: int("pscProdId").notNull().references(() => proposalProducts.id), // FK → proposalProducts.id
  // Stored as JSON: array of { size, chest, waist, length, ... }
  chartData: json("pscChartData").$type<Array<Record<string, string>>>(),
  imageUrl: varchar("pscImageUrl", { length: 1024 }), // optional image-based size chart
  createdAt: timestamp("pscCreatedAt").defaultNow().notNull(),
});
export type ProposalSizeChart = typeof proposalSizeCharts.$inferSelect;
export type InsertProposalSizeChart = typeof proposalSizeCharts.$inferInsert;

/**
 * Estimates — preliminary quotes generated from accepted proposals.
 * Can be converted to invoices.
 */
export const estimates = mysqlTable("estimates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("estUserId").notNull().references(() => users.id), // distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  // Nullable as of migration 0078 — the unified-canvas Estimate Builder mints
  // estimates from scratch, not from a proposal. createFromProposal still sets this.
  proposalId: int("estProposalId").references(() => proposals.id),
  clientId: int("estClientId").notNull().references(() => clients.id), // FK → clients.id
  estimateNumber: varchar("estimateNumber", { length: 32 }).notNull(),
  status: mysqlEnum("estStatus", ["draft", "sent", "accepted", "declined", "expired", "converted", "fulfilled"]).default("draft").notNull(),
  // DEPRECATED as of migration 0089. Every writer (createFromProposal,
  // builderSave) now persists to estimateLineItems + estimatePackages and
  // sets this column to NULL. Legacy rows created before 0089 were
  // backfilled by the same migration. Column is retained as a rollback
  // escape hatch for one release cycle; a follow-up migration will drop it.
  lineItems: json("estLineItems").$type<Array<{
    productName: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    imageUrl: string | null;
  }>>(),
  subtotal: decimal("estSubtotal", { precision: 12, scale: 2 }).notNull(),
  tax: decimal("estTax", { precision: 10, scale: 2 }).default("0.00").notNull(),
  shipping: decimal("estShipping", { precision: 10, scale: 2 }).default("0.00").notNull(),
  total: decimal("estTotal", { precision: 12, scale: 2 }).notNull(),
  notes: text("estNotes"),
  terms: text("estTerms"),
  currency: varchar("estCurrency", { length: 3 }).default("CAD").notNull(),
  validDays: int("estValidDays").default(30).notNull(), // legacy; new rows set validUntil instead
  validUntil: timestamp("estValidUntil"),
  convertedToInvoiceId: int("convertedToInvoiceId"), // FK → invoices.id (circular ref — enforced by migration SQL, not Drizzle .references() to avoid TS circular initializer error)
  sentAt: timestamp("estSentAt"),
  fulfilledAt: timestamp("estFulfilledAt"),
  createdAt: timestamp("estCreatedAt").defaultNow().notNull(),
  updatedAt: timestamp("estUpdatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("estimates_proposalId_idx").on(t.proposalId),
  clientIdIdx: index("estimates_clientId_idx").on(t.clientId),
  orgStatusIdx: index("estimates_org_status_idx").on(t.organizationId, t.status),
}));
export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = typeof estimates.$inferInsert;
// Inferred from the estStatus enum — callers that narrow `string` input into
// a status filter should cast to this, never a hand-rolled union.
export type EstStatus = Estimate["status"];

/**
 * Estimate packages — optional groupings for line items on a single estimate.
 * Packages carry a display name; the relationship to line items is via
 * estimateLineItems.packageId. The name is propagated into POLineItem.packageName
 * at conversion so grouping survives when estimates become POs.
 */
export const estimatePackages = mysqlTable("estimatePackages", {
  id: int("id").autoincrement().primaryKey(),
  estimateId: int("epEstimateId").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  name: varchar("epName", { length: 255 }).notNull(),
  sortOrder: int("epSortOrder").default(0).notNull(),
  createdAt: timestamp("epCreatedAt").defaultNow().notNull(),
}, (t) => ({
  estimateIdx: index("ep_estimate_idx").on(t.estimateId),
}));
export type EstimatePackage = typeof estimatePackages.$inferSelect;
export type InsertEstimatePackage = typeof estimatePackages.$inferInsert;

/**
 * Estimate line items — normalized rows (replaces the legacy JSON lineItems
 * column on estimates for builder-created rows). product_id is nullable to
 * support custom/one-off items. package_id is nullable — ungrouped rows sit
 * at the root level of the estimate.
 */
export const estimateLineItems = mysqlTable("estimateLineItems", {
  id: int("id").autoincrement().primaryKey(),
  estimateId: int("eliEstimateId").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  packageId: int("eliPackageId").references(() => estimatePackages.id, { onDelete: "set null" }),
  productId: int("eliProductId").references(() => products.id),
  description: text("eliDescription").notNull(),
  quantity: decimal("eliQuantity", { precision: 12, scale: 3 }).notNull().default("1.000"),
  unitPrice: decimal("eliUnitPrice", { precision: 12, scale: 2 }).notNull().default("0.00"),
  lineTotal: decimal("eliLineTotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  sortOrder: int("eliSortOrder").default(0).notNull(),
  // Snapshot columns added in migration 0089 so the relational form is
  // lossless. Legacy JSON lineItems carried color/size/imageUrl/sku; the
  // rewritten createFromProposal + builder write these on every insert.
  color: varchar("eliColor", { length: 128 }),
  size: varchar("eliSize", { length: 128 }),
  imageUrl: varchar("eliImageUrl", { length: 1024 }),
  sku: varchar("eliSku", { length: 128 }),
  createdAt: timestamp("eliCreatedAt").defaultNow().notNull(),
  updatedAt: timestamp("eliUpdatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  estimateIdx: index("eli_estimate_idx").on(t.estimateId),
  packageIdx: index("eli_package_idx").on(t.packageId),
}));
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;
export type InsertEstimateLineItem = typeof estimateLineItems.$inferInsert;

/**
 * Invoices — final invoices generated from accepted proposals or estimates.
 * Downloadable as PDF.
 */
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("invUserId").notNull().references(() => users.id), // distributor
  organizationId: int("organizationId").references(() => organizations.id), // multi-tenancy scope
  proposalId: int("invProposalId").references(() => proposals.id), // FK → proposals.id (optional if from estimate)
  estimateId: int("invEstimateId").references(() => estimates.id), // FK → estimates.id (optional if from proposal)
  clientId: int("invClientId").notNull().references(() => clients.id), // FK → clients.id
  orderId: int("invOrderId").references(() => orders.id), // FK → orders.id (if linked to an order)
  invoiceNumber: varchar("invoiceNumber", { length: 32 }).notNull(),
  status: mysqlEnum("invStatus", ["draft", "sent", "paid", "overdue", "cancelled", "void", "refunded", "partially_refunded", "credit_issued", "fulfilled"]).default("draft").notNull(),
  // Line items stored as JSON (snapshot). The discount/taxable fields are
  // optional and only populated by the Document Canvas creation flow —
  // legacy rows created by createFromProposal leave them undefined, which
  // every existing reader already tolerates (they read totalPrice).
  lineItems: json("invLineItems").$type<Array<{
    productName: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    imageUrl: string | null;
    description?: string | null;
    discountType?: "percent" | "flat";
    discountValue?: number;
    taxable?: boolean;
  }>>(),
  subtotal: decimal("invSubtotal", { precision: 12, scale: 2 }).notNull(),
  tax: decimal("invTax", { precision: 10, scale: 2 }).default("0.00").notNull(),
  shipping: decimal("invShipping", { precision: 10, scale: 2 }).default("0.00").notNull(),
  total: decimal("invTotal", { precision: 12, scale: 2 }).notNull(),
  notes: text("invNotes"),
  // Payment tracking
  paidAt: timestamp("invPaidAt"),
  paymentMethod: varchar("invPaymentMethod", { length: 64 }),
  paymentReference: varchar("invPaymentReference", { length: 255 }),
  stripePaymentIntentId: varchar("invStripePaymentIntentId", { length: 255 }),
  // Session-2 payment flow — Checkout Session created when the distributor
  // sends the invoice and their Stripe Connect account can accept cards.
  // publicToken is the opaque key that lets the client load the invoice at
  // /invoices/pay/:token without an account; NULL until sent so drafts
  // never leak publicly.
  publicToken: varchar("invPublicToken", { length: 64 }),
  stripeCheckoutSessionId: varchar("invStripeCheckoutSessionId", { length: 255 }),
  stripeCheckoutUrl: varchar("invStripeCheckoutUrl", { length: 1024 }),
  // Due date
  dueDate: timestamp("invDueDate"),
  // Payment terms selector — "due_on_receipt" | "net_15" | "net_30"
  // | "net_60" | "custom". NULL for legacy rows; the detail page falls
  // back to the dueDate alone when absent.
  paymentTerms: varchar("invPaymentTerms", { length: 32 }),
  sentAt: timestamp("invSentAt"),
  fulfilledAt: timestamp("invFulfilledAt"),
  // Refund / credit note tracking
  refundedAmount: int("invRefundedAmount").default(0).notNull(),
  refundedAt: timestamp("invRefundedAt"),
  creditNoteNumber: varchar("invCreditNoteNumber", { length: 64 }),
  stripeRefundId: varchar("invStripeRefundId", { length: 255 }),
  createdAt: timestamp("invCreatedAt").defaultNow().notNull(),
  updatedAt: timestamp("invUpdatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  proposalIdIdx: index("invoices_proposalId_idx").on(t.proposalId),
  publicTokenIdx: index("invoices_publicToken_idx").on(t.publicToken),
}));
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

/**
 * Proposal Versions — audit trail for proposal changes.
 * Each time a proposal is saved/updated, a version snapshot is recorded.
 */
export const proposalVersions = mysqlTable("proposalVersions", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull().references(() => proposals.id),
  userId: int("userId").notNull().references(() => users.id),
  authorName: varchar("authorName", { length: 255 }).notNull(),
  // Snapshot of key fields at this version
  snapshotTitle: varchar("snapshotTitle", { length: 255 }),
  snapshotEstimatedValue: decimal("snapshotEstimatedValue", { precision: 12, scale: 2 }),
  snapshotStatus: varchar("snapshotStatus", { length: 64 }),
  snapshotProductCount: int("snapshotProductCount"),
  snapshotDepartmentCount: int("snapshotDepartmentCount"),
  // Human-readable change summary
  changes: json("changes").$type<string[]>().notNull(),
  // Action type
  action: mysqlEnum("versionAction", ["created", "updated", "sent", "reverted"]).default("updated").notNull(),
  createdAt: timestamp("versionCreatedAt").defaultNow().notNull(),
});
export type ProposalVersion = typeof proposalVersions.$inferSelect;
export type InsertProposalVersion = typeof proposalVersions.$inferInsert;

// 
// Organizations — Multi-Tenancy Layer
// Each distributor account is an organization. Users belong to one or more orgs.
// 

/**
 * Organizations — one per distributor account.
 * A single user can own or belong to multiple organizations.
 */
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  ownerId: int("ownerId").notNull().references(() => users.id), // FK → users.id
  /**
   * AI Approval Level — controls how much autonomy the AI copilot has.
   *
   * - all_auto:     All tool calls execute immediately (no approval required).
   *                 Suitable for power users who trust the AI.
   * - review_auto:  SAFE-tier calls execute immediately; CONFIRM-tier calls
   *                 require 1-click approval. (Default)
   * - all_review:   Every tool call — including SAFE reads — requires approval.
   *                 Maximum control; suitable for regulated environments.
   */
  aiApprovalLevel: mysqlEnum("aiApprovalLevel", ["all_auto", "review_auto", "all_review"])
    .notNull()
    .default("review_auto"),
  /**
   * Default tax rate applied to newly-created stores under this org.
   * Stored as a fraction (e.g. 0.1300 for 13% HST). Nullable = unset; store-level
   * taxRate always wins at checkout — this is only a default for new stores.
   */
  defaultTaxRate: decimal("defaultTaxRate", { precision: 5, scale: 4 }),
  /**
   * Wall-clock time of the most recent successful agent scan (cron or manual).
   * NULL until the first scan runs. Read by the Agent Inbox empty state to
   * render "Last scanned: X minutes ago".
   */
  lastAgentScanAt: timestamp("lastAgentScanAt"),
  // PSRESTful Sub-Accounts — globally unique `mkf_org_xxx` prefix enforced
  // by CHECK constraint at the DB layer (migration 0087). Null until provisioned.
  externalCustomerId: varchar("externalCustomerId", { length: 255 }),
  // Per-distributor toggle for the PSRESTful Sub-Accounts feature. Must be true
  // in combination with the USE_SUB_ACCOUNTS env kill-switch before sub-account
  // keys are used; otherwise the system falls back to the master key.
  subAccountsEnabled: boolean("subAccountsEnabled").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  ownerIdIdx: index("organizations_ownerId_idx").on(t.ownerId),
  externalCustomerIdUnique: uniqueIndex("org_external_id_unique").on(t.externalCustomerId),
}));

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
export type AiApprovalLevel = "all_auto" | "review_auto" | "all_review";

/**
 * OrgMembers — maps users to organizations with roles.
 * An owner is automatically added as a member with role 'owner' on org creation.
 */
export const orgMembers = mysqlTable("orgMembers", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull().references(() => organizations.id), // FK → organizations.id
  userId: int("userId").references(() => users.id), // null until invite is accepted
  role: mysqlEnum("orgRole", ["owner", "admin", "member"]).notNull().default("member"),
  invitedByUserId: int("invitedByUserId").references(() => users.id), // FK → users.id
  inviteEmail: varchar("inviteEmail", { length: 320 }),
  inviteToken: varchar("inviteToken", { length: 255 }),
  inviteAcceptedAt: timestamp("inviteAcceptedAt"),
  createdAt: timestamp("orgMemberCreatedAt").defaultNow().notNull(),
}, (t) => ({
  orgIdIdx: index("orgMembers_organizationId_idx").on(t.organizationId),
  userIdIdx: index("orgMembers_userId_idx").on(t.userId),
  inviteTokenIdx: index("orgMembers_inviteToken_idx").on(t.inviteToken),
}));

export type OrgMember = typeof orgMembers.$inferSelect;
export type InsertOrgMember = typeof orgMembers.$inferInsert;

//  Notifications 
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),            // FK → users.id
  organizationId: int("organizationId").references(() => organizations.id),      // optional org scope
  type: mysqlEnum("notifType", [
    "proposal_sent", "proposal_viewed", "proposal_approved", "proposal_declined",
    "order_placed", "order_shipped", "order_delivered",
    "store_order", "store_user_joined",
    "payment_received", "invoice_overdue",
    "approval_requested", "approval_granted", "approval_denied",
    "ai_insight", "system",
    // Purchase order lifecycle events
    "po_created", "po_sent", "po_acknowledged", "po_shipped", "po_received", "po_overdue",
    // Custom order requests
    "custom_order_request",
    // Print requests from portal users
    "print_request",
    // Supplier price changes detected by the sync engine
    "supplier_cost_change",
    // Stripe Connect payment lifecycle (payout/dispute/deauthorization alerts)
    "payment",
  ]).notNull().default("system"),
  title: varchar("notifTitle", { length: 255 }).notNull(),
  message: text("notifMessage").notNull(),
  read: boolean("notifRead").notNull().default(false),
  actionPath: varchar("notifActionPath", { length: 512 }), // e.g. /proposals/42
  actionLabel: varchar("notifActionLabel", { length: 100 }),
  entityId: int("notifEntityId"),             // e.g. proposalId, orderId
  entityType: varchar("notifEntityType", { length: 50 }), // "proposal" | "order" etc.
  createdAt: timestamp("notifCreatedAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("notifications_userId_idx").on(t.userId),
  orgIdIdx: index("notifications_orgId_idx").on(t.organizationId),
  readIdx: index("notifications_read_idx").on(t.userId, t.read),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Store Identity Providers — SSO configurations (SAML 2.0 / OIDC) per store.
 * Each row represents one IdP connection for a store, keyed by email domain.
 * Enterprise plan stores can have multiple IdP connections for different client divisions.
 */
export const storeIdentityProviders = mysqlTable("storeIdentityProviders", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  protocol: mysqlEnum("sipProtocol", ["saml", "oidc"]).notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  // SAML fields
  samlEntryPoint: text("samlEntryPoint"),
  samlCertificate: text("samlCertificate"),
  samlIssuer: varchar("samlIssuer", { length: 512 }),
  // OIDC fields
  oidcDiscoveryUrl: text("oidcDiscoveryUrl"),
  oidcClientId: varchar("oidcClientId", { length: 255 }),
  oidcClientSecret: text("oidcClientSecret"), // encrypted at rest via encryptCredential()
  // Map SSO group name (or email-domain attribute) -> locationId so JIT
  // provisioning can assign incoming users to the correct location.
  // Shape: { [groupOrAttr: string]: number }
  groupToLocationMap: json("groupToLocationMap").$type<Record<string, number>>(),
  // Multi-division SSO routing: when set, successful auth for this IdP
  // redirects the user to this child store (division) instead of the
  // parent store's slug. Must belong to the same organization.
  targetStoreId: int("targetStoreId").references(() => stores.id, { onDelete: "set null" }),
  // JIT provisioning: when set, newly auto-created storeUsers via this IdP
  // are assigned this department.
  defaultDepartmentId: int("defaultDepartmentId").references(() => storeDepartments.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => ({
  storeDomainIdx: uniqueIndex("uq_store_domain").on(table.storeId, table.domain),
}));

export type StoreIdentityProvider = typeof storeIdentityProviders.$inferSelect;
export type InsertStoreIdentityProvider = typeof storeIdentityProviders.$inferInsert;

// ── Print Products ──────────────────────────────────────────────────────────
// Store-specific catalog of printed goods (business cards, flyers, banners,
// posters). Separate from the promotional products catalog because pricing
// here is tiered by quantity and split across variant dimensions (size +
// stock) that don't apply to promotional goods.

export const printProducts = mysqlTable("printProducts", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  productType: mysqlEnum("productType", ["business_cards", "flyers", "banners", "posters"]).notNull(),
  imageUrls: json("imageUrls").$type<string[]>().default([]).notNull(),
  isActive: boolean("isActive").notNull().default(true),
  // For future division filtering — null/empty means shared.
  divisionIds: json("divisionIds").$type<number[]>().default([]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PrintProduct = typeof printProducts.$inferSelect;
export type InsertPrintProduct = typeof printProducts.$inferInsert;

export const printProductVariants = mysqlTable("printProductVariants", {
  id: int("id").autoincrement().primaryKey(),
  printProductId: int("printProductId").notNull().references(() => printProducts.id, { onDelete: "cascade" }),
  size: varchar("size", { length: 64 }).notNull(),
  stock: varchar("stock", { length: 128 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PrintProductVariant = typeof printProductVariants.$inferSelect;
export type InsertPrintProductVariant = typeof printProductVariants.$inferInsert;

export const printProductPricing = mysqlTable("printProductPricing", {
  id: int("id").autoincrement().primaryKey(),
  printProductVariantId: int("printProductVariantId").notNull().references(() => printProductVariants.id, { onDelete: "cascade" }),
  quantity: int("quantity").notNull(),
  priceInCents: int("priceInCents").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PrintProductPricing = typeof printProductPricing.$inferSelect;
export type InsertPrintProductPricing = typeof printProductPricing.$inferInsert;

export const printSupplierConnections = mysqlTable("printSupplierConnections", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  apiEndpoint: varchar("apiEndpoint", { length: 1024 }),
  apiKey: text("apiKey"), // encrypted at rest via encryptCredential()
  isActive: boolean("isActive").notNull().default(true),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PrintSupplierConnection = typeof printSupplierConnections.$inferSelect;
export type InsertPrintSupplierConnection = typeof printSupplierConnections.$inferInsert;

// ── Store Media Library ─────────────────────────────────────────────────────
// Two-way shared file library between distributor and POC, scoped per store.

export const storeMediaFiles = mysqlTable("storeMediaFiles", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "cascade" }),
  uploadedBy: mysqlEnum("uploadedBy", ["distributor", "poc"]).notNull(),
  // userId when uploadedBy="distributor", storeUsers.id when "poc"
  uploadedByUserId: int("uploadedByUserId").notNull(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 2048 }).notNull(),
  fileType: varchar("fileType", { length: 128 }).notNull(),
  fileSizeBytes: int("fileSizeBytes").notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StoreMediaFile = typeof storeMediaFiles.$inferSelect;
export type InsertStoreMediaFile = typeof storeMediaFiles.$inferInsert;

/**
 * Refund history — tracks all refunds across orders, invoices, and proposals.
 */
export const refundHistory = mysqlTable("refund_history", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").references(() => organizations.id),
  entityType: mysqlEnum("entityType", ["order", "invoice", "proposal"]).notNull(),
  entityId: int("entityId").notNull(),
  amount: int("amount").notNull(), // cents
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  type: mysqlEnum("type", ["full", "partial"]).notNull(),
  reason: text("reason"),
  stripeRefundId: varchar("stripeRefundId", { length: 255 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "succeeded", "failed"]).default("pending").notNull(),
  processedBy: int("processedBy"),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("rh_org_idx").on(t.organizationId),
  entityIdx: index("rh_entity_idx").on(t.entityType, t.entityId),
  stripeIdx: index("rh_stripe_idx").on(t.stripeRefundId),
  processedIdx: index("rh_processed_idx").on(t.processedAt),
}));
export type RefundHistory = typeof refundHistory.$inferSelect;
export type InsertRefundHistory = typeof refundHistory.$inferInsert;

/**
 * Refund requests — POC-initiated refund request workflow.
 * POC submits a request with a reason → distributor approves or denies.
 */
export const refundRequests = mysqlTable("refund_requests", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").references(() => organizations.id),
  storeId: int("storeId").notNull().references(() => stores.id),
  proposalId: int("proposalId").notNull().references(() => proposals.id),
  storeUserId: int("storeUserId").notNull().references(() => storeUsers.id),
  distributorUserId: int("distributorUserId").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: mysqlEnum("rrStatus", ["pending", "approved", "denied"]).default("pending").notNull(),
  responseNote: text("responseNote"),
  respondedAt: timestamp("respondedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (t) => ({
  orgIdx: index("rr_org_idx").on(t.organizationId),
  storeIdx: index("rr_store_idx").on(t.storeId),
  proposalIdx: index("rr_proposal_idx").on(t.proposalId),
  distributorIdx: index("rr_distributor_idx").on(t.distributorUserId),
  statusIdx: index("rr_status_idx").on(t.status),
}));
export type RefundRequest = typeof refundRequests.$inferSelect;
export type InsertRefundRequest = typeof refundRequests.$inferInsert;


/* ------------------------------------------------------------------ */
/*  AI Audit Log — Layer 5: Pre-flight audit of every LLM invocation   */
/* ------------------------------------------------------------------ */

export const aiAuditLog = mysqlTable("aiAuditLog", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").references(() => organizations.id),
  userId: int("userId").references(() => users.id),
  messageCount: int("messageCount").notNull(),
  toolCount: int("toolCount").default(0).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  promptHash: varchar("promptHash", { length: 64 }).notNull(),
  promptSizeBytes: int("promptSizeBytes").notNull(),
  /** Complete sanitized payload — proof of what was sent to the LLM */
  // mediumtext (16 MB) instead of text (64 KB) — long conversations with many
  // tool results can exceed 64 KB. mediumtext prevents silent truncation.
  sanitizedPayload: mediumtext("sanitizedPayload").notNull(),
  /** Whether sanitizedPayload is gzip-compressed (base64-encoded) */
  compressed: boolean("compressed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orgCreatedIdx: index("aal_org_created_idx").on(t.organizationId, t.createdAt),
  hashIdx: index("aal_hash_idx").on(t.promptHash),
}));
export type AiAuditLogEntry = typeof aiAuditLog.$inferSelect;
export type InsertAiAuditLogEntry = typeof aiAuditLog.$inferInsert;

/* ------------------------------------------------------------------ */
/*  Copilot Pending Actions — Layer 2: Human Approval Gate             */
/* ------------------------------------------------------------------ */

/**
 * Stores tool calls that require human approval before execution.
 * Status lifecycle: pending → approved | denied
 *
 * When the copilot classifies a tool call as CONFIRM-tier, it writes a row
 * here and returns { awaitingApproval: true, pendingActionId } to the client.
 * The client renders an approval card; the user clicks Approve/Deny which
 * calls actionApproval.approve / actionApproval.deny.
 */
export const copilotPendingActions = mysqlTable("copilotPendingActions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: int("organizationId").references(() => organizations.id, { onDelete: "cascade" }),
  /** The LLM-assigned tool call ID (for conversation continuity) */
  toolCallId: varchar("toolCallId", { length: 128 }).notNull(),
  /** Tool function name, e.g. "send_proposal" */
  toolName: varchar("toolName", { length: 128 }).notNull(),
  /** Human-readable description shown in the approval card */
  summary: text("summary").notNull(),
  /** Full JSON-serialized arguments for the tool call */
  serializedArgs: text("serializedArgs").notNull(),
  status: mysqlEnum("cpaStatus", ["pending", "approved", "denied"]).default("pending").notNull(),
  source: mysqlEnum("source", ["user", "agent"]),
  /** Optional reason provided when denying */
  denyReason: text("denyReason"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userStatusIdx: index("cpa_user_status_idx").on(t.userId, t.status),
  orgIdx: index("cpa_org_idx").on(t.organizationId),
  createdIdx: index("cpa_created_idx").on(t.createdAt),
}));

export type CopilotPendingAction = typeof copilotPendingActions.$inferSelect;
export type InsertCopilotPendingAction = typeof copilotPendingActions.$inferInsert;


/* ------------------------------------------------------------------ */
/*  Purchase Orders — supplier-facing POs generated from client orders  */
/* ------------------------------------------------------------------ */

/**
 * POLineItem — each line item in a purchase order.
 * Uses COST prices (products.basePrice), NEVER sell prices (orderItems.unitPrice).
 */
export type POLineItem = {
  orderItemId: number;
  productId: number;
  productName: string;
  supplierSku: string | null;
  productNumber: string | null;
  quantity: number;
  costPrice: number;             // products.basePrice — NEVER orderItems.unitPrice
  totalCost: number;             // quantity × costPrice
  quantityReceived: number;      // accumulated across partial receives (default 0)
  color: string | null;
  size: string | null;
  decorationType: string | null;
  decorationLocation: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  notes: string | null;
  // Carries estimatePackages.name through estimate → PO conversion so grouping
  // survives. Undefined/null when the line is ungrouped or came from a flow
  // that predates packages.
  packageName?: string | null;
};

export const purchaseOrders = mysqlTable("purchaseOrders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id),
  // Nullable from migration 0054 to allow proposal-only POs (no parent order).
  orderId: int("orderId").references(() => orders.id),
  // Optional FK to source proposal (for proposal-based PO generation, migration 0054).
  proposalId: int("proposalId").references(() => proposals.id),
  // Supplier identification (provider-agnostic)
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  supplierCode: varchar("supplierCode", { length: 64 }),
  supplierSource: varchar("supplierSource", { length: 32 }),   // asi | promostandards | sage | manual | csv | api
  supplierContactEmail: varchar("supplierContactEmail", { length: 255 }),
  supplierContactPhone: varchar("supplierContactPhone", { length: 64 }),
  supplierAccountNumber: varchar("supplierAccountNumber", { length: 128 }),
  // PO document
  poNumber: varchar("poNumber", { length: 32 }).notNull().unique(),
  status: mysqlEnum("poStatus", [
    "draft", "sent", "acknowledged", "in_production",
    "shipped", "received", "cancelled", "partial", "declined",
    "consolidated", "merged",
  ]).default("draft").notNull(),
  // When this PO is the result of aggregating multiple originals, the
  // source PO IDs are recorded here so the merged PO can link back to
  // them and the UI can show "merged from N originals".
  mergedFromPoIds: json("mergedFromPoIds").$type<number[]>(),
  lineItems: json("lineItems").$type<POLineItem[]>().notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  shipping: decimal("shipping", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0.00"),
  total: decimal("total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Shipping
  shipToName: varchar("shipToName", { length: 255 }),
  shipToAddress: text("shipToAddress"),
  shipToType: mysqlEnum("shipToType", ["decorator", "warehouse", "client_direct"]).default("warehouse"),
  decorationInstructions: text("decorationInstructions"),
  // Dates
  requestedShipDate: timestamp("requestedShipDate"),
  expectedDeliveryDate: timestamp("expectedDeliveryDate"),
  actualShipDate: timestamp("actualShipDate"),
  // Tracking
  trackingNumbers: json("trackingNumbers").$type<string[]>(),
  // Notes
  internalNotes: text("internalNotes"),
  supplierNotes: text("supplierNotes"),
  // AI metadata
  aiGroupingConfidence: decimal("aiGroupingConfidence", { precision: 5, scale: 2 }),
  aiGroupingReason: text("aiGroupingReason"),
  // Timestamps
  sentAt: timestamp("sentAt"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("po_order_idx").on(t.orderId),
  orgIdx: index("po_org_idx").on(t.organizationId),
  statusIdx: index("po_status_idx").on(t.status),
  supplierIdx: index("po_supplier_idx").on(t.supplierCode, t.supplierSource),
}));

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;

export const purchaseOrderEvents = mysqlTable("purchaseOrderEvents", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  eventType: mysqlEnum("poeEventType", [
    "created", "sent", "acknowledged", "status_changed",
    "tracking_added", "note_added", "cancelled", "received",
  ]).notNull(),
  description: text("description"),
  userId: int("userId").notNull().references(() => users.id),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  poIdx: index("poe_po_idx").on(t.purchaseOrderId),
}));

export type PurchaseOrderEvent = typeof purchaseOrderEvents.$inferSelect;
export type InsertPurchaseOrderEvent = typeof purchaseOrderEvents.$inferInsert;


/* ------------------------------------------------------------------ */
/*  Supplier Directory — auto-populated from PO creation history       */
/* ------------------------------------------------------------------ */

export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }),
  source: varchar("source", { length: 32 }),
  contactEmail: varchar("contactEmail", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 64 }),
  accountNumber: varchar("accountNumber", { length: 128 }),
  website: varchar("website", { length: 512 }),
  defaultShipTo: mysqlEnum("defaultShipTo", ["decorator", "warehouse", "client_direct"]).default("warehouse"),
  notes: text("notes"),
  poCount: int("poCount").notNull().default(0),
  totalSpend: decimal("totalSpend", { precision: 14, scale: 2 }).notNull().default("0.00"),
  lastOrderDate: timestamp("lastOrderDate"),
  avgFulfillmentDays: decimal("avgFulfillmentDays", { precision: 5, scale: 1 }),
  // Supplier's code in the PSRESTful network (e.g. "SanMar", "pcna", "alphabroder").
  // Used by the sync engine to route API calls to the correct supplier endpoint.
  psRestfulCode: varchar("psRestfulCode", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  orgNameIdx: index("supplier_org_name_idx").on(t.organizationId, t.normalizedName),
  codeIdx: index("supplier_code_idx").on(t.code, t.source),
  userIdx: index("supplier_user_idx").on(t.userId),
}));

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;


/* ------------------------------------------------------------------ */
/*  Custom Order Requests                                              */
/* ------------------------------------------------------------------ */

export const customOrderRequests = mysqlTable("customOrderRequests", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  storeUserId: int("storeUserId").notNull().references(() => storeUsers.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  quantity: int("quantity"),
  targetDate: timestamp("targetDate"),
  attachmentUrls: json("attachmentUrls").$type<string[]>(),
  status: mysqlEnum("customOrderStatus", ["pending", "reviewed", "approved", "declined", "fulfilled"]).default("pending").notNull(),
  // POC routed to review this request — set on submission.
  assignedPocId: int("assignedPocId").references(() => storeUsers.id, { onDelete: "set null" }),
  pocNotes: text("pocNotes"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  storeIdIdx: index("customOrderRequests_storeId_idx").on(t.storeId),
  storeUserIdIdx: index("customOrderRequests_storeUserId_idx").on(t.storeUserId),
  statusIdx: index("customOrderRequests_status_idx").on(t.status),
}));
export type CustomOrderRequest = typeof customOrderRequests.$inferSelect;
export type InsertCustomOrderRequest = typeof customOrderRequests.$inferInsert;


/* ------------------------------------------------------------------ */
/*  Promo Codes                                                        */
/* ------------------------------------------------------------------ */

export const promoCodes = mysqlTable("promoCodes", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id),
  organizationId: int("organizationId").references(() => organizations.id),
  code: varchar("code", { length: 64 }).notNull(),
  description: varchar("description", { length: 255 }),
  discountType: mysqlEnum("discountType", ["percentage", "fixed_amount"]).notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).notNull(),
  minOrderAmount: decimal("minOrderAmount", { precision: 10, scale: 2 }),
  maxDiscountAmount: decimal("maxDiscountAmount", { precision: 10, scale: 2 }),
  maxUses: int("maxUses"),
  usedCount: int("usedCount").default(0).notNull(),
  maxUsesPerUser: int("maxUsesPerUser").default(1),
  startsAt: timestamp("startsAt"),
  expiresAt: timestamp("expiresAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  storeCodeIdx: uniqueIndex("promoCodes_storeCode_idx").on(t.storeId, t.code),
  orgIdIdx: index("promoCodes_orgId_idx").on(t.organizationId),
}));
export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = typeof promoCodes.$inferInsert;

export const promoCodeUsages = mysqlTable("promoCodeUsages", {
  id: int("id").autoincrement().primaryKey(),
  promoCodeId: int("promoCodeId").notNull().references(() => promoCodes.id),
  storeUserId: int("storeUserId").notNull().references(() => storeUsers.id),
  orderId: int("orderId").notNull().references(() => orders.id),
  discountApplied: decimal("discountApplied", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  promoUserIdx: index("promoCodeUsages_promoUser_idx").on(t.promoCodeId, t.storeUserId),
}));
export type PromoCodeUsage = typeof promoCodeUsages.$inferSelect;
export type InsertPromoCodeUsage = typeof promoCodeUsages.$inferInsert;

/**
 * Product Collections — reusable groupings for proposals & stores.
 */
export const productCollections = mysqlTable("productCollections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  organizationId: int("organizationId").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 32 }).default("#654BF9").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("collections_userId_idx").on(t.userId),
  orgIdIdx: index("collections_orgId_idx").on(t.organizationId),
}));
export type ProductCollection = typeof productCollections.$inferSelect;
export type InsertProductCollection = typeof productCollections.$inferInsert;

/**
 * Join table: which products belong to which collection.
 */
export const collectionProducts = mysqlTable("collectionProducts", {
  id: int("id").autoincrement().primaryKey(),
  collectionId: int("collectionId").notNull().references(() => productCollections.id, { onDelete: "cascade" }),
  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
}, (t) => ({
  collectionIdx: index("cp_collectionId_idx").on(t.collectionId),
  productIdx: index("cp_productId_idx").on(t.productId),
  uniquePair: uniqueIndex("cp_collection_product_idx").on(t.collectionId, t.productId),
}));
export type CollectionProduct = typeof collectionProducts.$inferSelect;
export type InsertCollectionProduct = typeof collectionProducts.$inferInsert;


/**
 * Stripe webhook event idempotency — QA v2 stress test.
 * Tracks processed Stripe event IDs so duplicate deliveries (at-least-once)
 * are short-circuited instead of being re-processed.
 */
export const stripeWebhookEvents = mysqlTable("stripe_webhook_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 128 }).notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
}, (t) => ({
  typeIdx: index("stripe_webhook_events_type_idx").on(t.type),
}));
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;


/* ------------------------------------------------------------------ */
/*  Document Sequences — per-org auto-increment for PO/EST/INV         */
/* ------------------------------------------------------------------ */

/**
 * documentSequences — atomic, monotonic counter per (org, docType).
 *
 * Used to mint sequential, human-friendly document numbers
 * (`PO-1001`, `EST-1001`, `INV-1001`) instead of random nanoids.
 *
 * Concurrency: the writer uses `INSERT ... ON DUPLICATE KEY UPDATE
 * nextNumber = nextNumber + 1` + `LAST_INSERT_ID()` for atomicity.
 *
 * Uniqueness keying (migration 0079): uniqueness is enforced on
 * `(orgKey, userId, docType)` where `orgKey = COALESCE(organizationId, 0)`
 * is a STORED generated column. This replaces the previous composite
 * unique index on `(organizationId, userId, docType)`, which failed for
 * solo-user rows because MySQL treats NULL as distinct in unique indexes.
 * Team rows see byte-identical behaviour (orgKey = organizationId).
 */
export const documentSequences = mysqlTable("documentSequences", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").references(() => organizations.id),
  // Generated column: COALESCE(organizationId, 0). Never NULL, never directly
  // written — MySQL populates it automatically from organizationId.
  orgKey: int("orgKey")
    .generatedAlwaysAs(sql`COALESCE(\`organizationId\`, 0)`, { mode: "stored" })
    .notNull(),
  userId: int("userId").notNull().references(() => users.id),
  docType: varchar("docType", { length: 16 }).notNull(), // "po" | "est" | "inv"
  nextNumber: int("nextNumber").notNull().default(1001),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // Unique on the generated orgKey so solo rows (organizationId IS NULL →
  // orgKey = 0) collide correctly; team rows behave identically to before.
  orgKeyUserDocTypeUniq: uniqueIndex("docseq_orgkey_user_doctype_uniq").on(t.orgKey, t.userId, t.docType),
  // FK-backing index for docseq_org_fk — required because the new unique
  // index leads with orgKey (generated), not organizationId itself.
  organizationIdIdx: index("docseq_organizationId_idx").on(t.organizationId),
}));
export type DocumentSequence = typeof documentSequences.$inferSelect;
export type InsertDocumentSequence = typeof documentSequences.$inferInsert;


/* ------------------------------------------------------------------ */
/*  PO Preview Drafts — short-lived AI-generated PO previews           */
/* ------------------------------------------------------------------ */

/**
 * poPreviewDrafts — holds AI-grouped supplier buckets between the
 * `previewFromProposal` / `previewBulkFromApproved` call and the
 * `confirmGeneration` commit.
 *
 * One row per preview session, identified by a single-use `token`.
 * The payload JSON stores `{ groups: SupplierBucket[], flagged: Item[],
 * sourceProposalIds: number[] }`.
 *
 * Rows expire after 1 hour and are deleted on confirm. Single-use enforced
 * by setting `confirmedAt` on commit.
 */
/**
 * Email unsubscribe records (CASL / CAN-SPAM compliance).
 *
 * A row here suppresses commercial emails to {email} for the given scope:
 *   - unsubscribeType="all"        → suppress every commercial email
 *   - unsubscribeType="proposals"  → suppress only proposal-style sends
 *   - unsubscribeType="marketing"  → suppress marketing-style sends
 *
 * storeId is nullable so platform-level unsubscribes (no store context) can
 * coexist with per-store unsubscribes. Transactional emails are NEVER
 * suppressed by this table — they relate to an active account action and
 * are exempt from CASL/CAN-SPAM consent rules.
 */
export const emailUnsubscribes = mysqlTable("emailUnsubscribes", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  storeId: int("storeId").references(() => stores.id),
  unsubscribeType: mysqlEnum("unsubscribeType", ["all", "proposals", "marketing"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  emailTypeStoreIdx: uniqueIndex("email_unsubs_unique_idx").on(t.email, t.unsubscribeType, t.storeId),
  emailIdx: index("email_unsubs_email_idx").on(t.email),
}));
export type EmailUnsubscribe = typeof emailUnsubscribes.$inferSelect;
export type InsertEmailUnsubscribe = typeof emailUnsubscribes.$inferInsert;

export const poPreviewDrafts = mysqlTable("poPreviewDrafts", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  organizationId: int("organizationId").references(() => organizations.id),
  userId: int("userId").notNull().references(() => users.id),
  /**
   * Snapshot of supplier buckets + flagged items + source proposal IDs.
   * Shape is intentionally generic to allow the schema to evolve without
   * a migration; consumers cast to the documented shape.
   */
  payload: json("payload").notNull(),
  sourceProposalIds: json("sourceProposalIds").$type<number[]>().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tokenIdx: index("popd_token_idx").on(t.token),
  orgIdx: index("popd_org_idx").on(t.organizationId),
  expiresIdx: index("popd_expires_idx").on(t.expiresAt),
}));
export type POPreviewDraft = typeof poPreviewDrafts.$inferSelect;
export type InsertPOPreviewDraft = typeof poPreviewDrafts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Unified Pricing Engine
// Migration 0081
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decoration Methods — canonical list of decoration techniques.
 * Replaces hardcoded enum on proposalProducts and JSON array on products.
 * Seeded: embroidery, screen_print, laser_engraving, heat_transfer,
 *         dtg, sublimation, deboss, patch.
 */
export const decorationMethods = mysqlTable("decorationMethods", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DecorationMethod = typeof decorationMethods.$inferSelect;
export type InsertDecorationMethod = typeof decorationMethods.$inferInsert;

/**
 * Imprint Zone Presets — catalog of common zones used to seed productImprintZones.
 * Coordinates are percentages (0–100) of the product image bounding box.
 */
export const imprintZonePresets = mysqlTable("imprintZonePresets", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  category: varchar("category", { length: 64 }),
  x: decimal("x", { precision: 5, scale: 2 }).notNull(),
  y: decimal("y", { precision: 5, scale: 2 }).notNull(),
  w: decimal("w", { precision: 5, scale: 2 }).notNull(),
  h: decimal("h", { precision: 5, scale: 2 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ImprintZonePreset = typeof imprintZonePresets.$inferSelect;
export type InsertImprintZonePreset = typeof imprintZonePresets.$inferInsert;

/**
 * Product Imprint Zones — per-master-product decoration zones.
 * Coordinates are percentages (0–100) of the product image bounding box.
 */
export const productImprintZones = mysqlTable("productImprintZones", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull(),
  x: decimal("x", { precision: 5, scale: 2 }).notNull(),
  y: decimal("y", { precision: 5, scale: 2 }).notNull(),
  w: decimal("w", { precision: 5, scale: 2 }).notNull(),
  h: decimal("h", { precision: 5, scale: 2 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  isDefault: boolean("isDefault").notNull().default(false),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  productIdx: index("piz_product_idx").on(t.productId),
  productSlugUnique: unique("piz_product_slug_unique").on(t.productId, t.slug),
}));
export type ProductImprintZone = typeof productImprintZones.$inferSelect;
export type InsertProductImprintZone = typeof productImprintZones.$inferInsert;

/**
 * Product Imprint Zone Decorations — valid decoration methods per zone.
 */
export const productImprintZoneDecorations = mysqlTable("productImprintZoneDecorations", {
  id: int("id").autoincrement().primaryKey(),
  imprintZoneId: int("imprintZoneId").notNull().references(() => productImprintZones.id, { onDelete: "cascade" }),
  decorationMethodId: int("decorationMethodId").notNull().references(() => decorationMethods.id),
  isDefault: boolean("isDefault").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  zoneMethodUnique: unique("pizd_zone_method_unique").on(t.imprintZoneId, t.decorationMethodId),
}));
export type ProductImprintZoneDecoration = typeof productImprintZoneDecorations.$inferSelect;
export type InsertProductImprintZoneDecoration = typeof productImprintZoneDecorations.$inferInsert;

/**
 * Master Product Pricing — supplier cost track.
 * What the distributor pays the supplier. Sourced from supplier API sync.
 * Distributor never edits manually.
 * Stores both native supplier currency and converted distributor currency.
 */
export const masterProductPricing = mysqlTable("masterProductPricing", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id),
  supplierId: int("supplierId").notNull().references(() => suppliers.id),

  // Flat string variant reference e.g. "color:Red", "size:XL"
  // NULL = base product with no variant dimension.
  // Intentionally not a FK: pricing engine does not own the variant catalog.
  variantKey: varchar("variantKey", { length: 256 }),

  minQty: int("minQty").notNull(),
  maxQty: int("maxQty"), // null = open-ended top tier

  // Supplier's native quoted cost
  nativeCostCents: bigint("nativeCostCents", { mode: "number" }).notNull(),
  nativeCurrency: char("nativeCurrency", { length: 3 }).notNull(),

  // Converted to distributor home currency by pricing engine (not the adapter)
  unitCostCents: bigint("unitCostCents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),

  syncedAt: timestamp("syncedAt").notNull(),
  isActive: boolean("isActive").notNull().default(true),
}, (t) => ({
  productSupplierIdx: index("mpp_product_supplier_idx").on(t.productId, t.supplierId),
  variantIdx: index("mpp_variant_idx").on(t.productId, t.variantKey),
}));
export type MasterProductPricing = typeof masterProductPricing.$inferSelect;
export type InsertMasterProductPricing = typeof masterProductPricing.$inferInsert;

/**
 * Client Product Config — anchor record per client × product combination.
 * All client-product pricing configuration hangs off this record.
 * One row per (clientId, productId).
 */
export const clientProductConfig = mysqlTable("clientProductConfig", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  clientId: int("clientId").notNull().references(() => clients.id),
  productId: int("productId").notNull().references(() => products.id),

  // Controls how setup fee + other costs appear to the client at checkout
  displayMode: mysqlEnum("displayMode", ["itemize", "roll_into_unit"])
    .notNull()
    .default("itemize"),

  // Bare int — DB-level FK to productImprintZones.id enforced by migration 0084.
  // Not declared with .references() to avoid a forward/circular reference on productImprintZones.
  defaultImprintZoneId: int("defaultImprintZoneId"),

  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  clientProductUnique: unique("cpc_client_product_unique").on(t.clientId, t.productId),
  clientIdx: index("cpc_client_idx").on(t.clientId),
}));
export type ClientProductConfig = typeof clientProductConfig.$inferSelect;
export type InsertClientProductConfig = typeof clientProductConfig.$inferInsert;

/**
 * Client Product Pricing Tiers — client sell price by quantity range.
 * Child of clientProductConfig. One row per (config, minQty).
 */
export const clientProductPricingTiers = mysqlTable("clientProductPricingTiers", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  clientProductConfigId: bigint("clientProductConfigId", { mode: "number" })
    .notNull()
    .references(() => clientProductConfig.id, { onDelete: "cascade" }),

  minQty: int("minQty").notNull(),
  maxQty: int("maxQty"), // null = open-ended top tier
  unitPriceCents: bigint("unitPriceCents", { mode: "number" }).notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  configMinQtyUnique: unique("cppt_config_minqty_unique").on(
    t.clientProductConfigId,
    t.minQty
  ),
}));
export type ClientProductPricingTier = typeof clientProductPricingTiers.$inferSelect;
export type InsertClientProductPricingTier = typeof clientProductPricingTiers.$inferInsert;

/**
 * Client Product Variant Upcharges — per-variant upcharge on top of base tier price.
 * Implements Option A: base tier price + per-variant upcharge.
 * Child of clientProductConfig. One row per (config, variantKey).
 */
export const clientProductVariantUpcharges = mysqlTable("clientProductVariantUpcharges", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  clientProductConfigId: bigint("clientProductConfigId", { mode: "number" })
    .notNull()
    .references(() => clientProductConfig.id, { onDelete: "cascade" }),

  // Same flat string convention as masterProductPricing.variantKey
  variantKey: varchar("variantKey", { length: 256 }).notNull(),
  upchargeCents: bigint("upchargeCents", { mode: "number" }).notNull().default(0),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  configVariantUnique: unique("cpvu_config_variant_unique").on(
    t.clientProductConfigId,
    t.variantKey
  ),
}));
export type ClientProductVariantUpcharge = typeof clientProductVariantUpcharges.$inferSelect;
export type InsertClientProductVariantUpcharge = typeof clientProductVariantUpcharges.$inferInsert;

/**
 * Client Product Other Costs — persistent free-form line items per client-product.
 * side=buying: distributor pays, affects margin only, not invoiced to client.
 * side=selling: client pays, appears on invoice.
 * Soft-deleted — never hard-deleted. Preserves audit trail for order disputes.
 */
export const clientProductOtherCosts = mysqlTable("clientProductOtherCosts", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  clientProductConfigId: bigint("clientProductConfigId", { mode: "number" })
    .notNull()
    .references(() => clientProductConfig.id, { onDelete: "cascade" }),

  label: varchar("label", { length: 255 }).notNull(),
  amountCents: bigint("amountCents", { mode: "number" }).notNull(),
  side: mysqlEnum("side", ["buying", "selling"]).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  isActive: boolean("isActive").notNull().default(true), // soft delete

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  configIdx: index("cpoc_config_idx").on(t.clientProductConfigId),
}));
export type ClientProductOtherCost = typeof clientProductOtherCosts.$inferSelect;
export type InsertClientProductOtherCost = typeof clientProductOtherCosts.$inferInsert;

/**
 * Client Product Decoration Method — one decoration method per client-product.
 * Setup fee lives here — tied to the decoration method semantically.
 * Unique constraint on clientProductConfigId enforces one-per-client-product.
 * Soft-deleted.
 */
export const clientProductDecorationMethod = mysqlTable("clientProductDecorationMethod", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  clientProductConfigId: bigint("clientProductConfigId", { mode: "number" })
    .notNull()
    .references(() => clientProductConfig.id, { onDelete: "cascade" }),
  decorationMethodId: int("decorationMethodId")
    .notNull()
    .references(() => decorationMethods.id),

  setupFeeCents: bigint("setupFeeCents", { mode: "number" }).notNull().default(0),
  setupFeeMode: mysqlEnum("setupFeeMode", ["one_time", "per_order"])
    .notNull()
    .default("one_time"),
  isActive: boolean("isActive").notNull().default(true), // soft delete

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // Enforces one decoration method per client-product (webstore constraint)
  configUnique: unique("cpdm_config_unique").on(t.clientProductConfigId),
}));
export type ClientProductDecorationMethod = typeof clientProductDecorationMethod.$inferSelect;
export type InsertClientProductDecorationMethod = typeof clientProductDecorationMethod.$inferInsert;


/* ------------------------------------------------------------------ */
/*  Phase 3 — Supplier Sync Infrastructure                             */
/* ------------------------------------------------------------------ */

/**
 * PSRESTful Sub-Accounts — maps a MergeTasks client to a PRESTful sub-account.
 *
 * NULL apiKey = not yet provisioned → system falls back to master key
 * (PSRESTFUL_MASTER_KEY env var). The two-layer feature flag — USE_SUB_ACCOUNTS
 * env var AND organizations.subAccountsEnabled — must both be true before
 * sub-account keys are used at all.
 *
 * apiKey is stored encrypted via encryptCredential() — TEXT (not VARCHAR)
 * because encrypted payload length is unpredictable.
 */
export const psRestfulSubAccounts = mysqlTable("psRestfulSubAccounts", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull().references(() => clients.id, { onDelete: "cascade" }),
  organizationId: int("organizationId").references(() => organizations.id, { onDelete: "set null" }),
  // Upstream PRESTful numeric sub-account identifier (null until provisioned).
  psRestfulSubAccountId: int("psRestfulSubAccountId"),
  externalCustomerId: varchar("externalCustomerId", { length: 255 }).notNull(),
  // Encrypted via encryptCredential(); TEXT for unpredictable ciphertext length.
  apiKey: text("apiKey"),
  isActive: boolean("isActive").notNull().default(true),
  provisionedAt: timestamp("provisionedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  clientUnique: uniqueIndex("prsa_client_unique").on(t.clientId),
  externalIdUnique: uniqueIndex("prsa_external_id_unique").on(t.externalCustomerId),
  orgIdx: index("prsa_org_idx").on(t.organizationId),
}));

export type PsRestfulSubAccount = typeof psRestfulSubAccounts.$inferSelect;
export type InsertPsRestfulSubAccount = typeof psRestfulSubAccounts.$inferInsert;


/**
 * Supplier Sync Jobs — tracks each sync run.
 *
 * syncScope NULL = full supplier sync.
 * syncScope JSON array of productIds = targeted sync (future use).
 */
export const supplierSyncJobs = mysqlTable("supplierSyncJobs", {
  id: int("id").autoincrement().primaryKey(),
  supplierId: int("supplierId").notNull().references(() => suppliers.id),
  // Nullable for solo users (no organization). FK uses ON DELETE SET NULL.
  organizationId: int("organizationId").references(() => organizations.id, { onDelete: "set null" }),
  status: mysqlEnum("status", ["running", "completed", "failed"]).notNull().default("running"),
  trigger: mysqlEnum("trigger", ["manual", "scheduled", "webhook"]).notNull().default("manual"),
  // NULL = full sync; JSON array of productIds = targeted sync.
  syncScope: json("syncScope").$type<number[]>(),
  productsScanned: int("productsScanned").notNull().default(0),
  productsUpdated: int("productsUpdated").notNull().default(0),
  priceChanges: int("priceChanges").notNull().default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  supplierIdx: index("ssj_supplier_idx").on(t.supplierId, t.createdAt),
  orgIdx: index("ssj_org_idx").on(t.organizationId, t.createdAt),
}));

export type SupplierSyncJob = typeof supplierSyncJobs.$inferSelect;
export type InsertSupplierSyncJob = typeof supplierSyncJobs.$inferInsert;


/**
 * Supplier Cost Change Log — permanent audit log of supplier price changes.
 *
 * Never purge; partition by createdAt if volume demands. previousCostCents is
 * NULL on the first sync for a product (no prior price to compare against).
 *
 * variantKey encodes multi-dimension variants as pipe-separated dimension:value
 * pairs, e.g. "size:XL" or "size:XL|color:Red". Same format is used across
 * all pricing tables.
 */
export const supplierCostChangeLog = mysqlTable("supplierCostChangeLog", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  supplierId: int("supplierId").notNull().references(() => suppliers.id),
  productId: int("productId").notNull().references(() => products.id),
  // e.g. "size:XL" or "size:XL|color:Red" (pipe-separated multi-dimension).
  variantKey: varchar("variantKey", { length: 256 }),
  // NULL on first sync — no previous price exists.
  previousCostCents: bigint("previousCostCents", { mode: "number" }),
  newCostCents: bigint("newCostCents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  syncJobId: int("syncJobId").notNull().references(() => supplierSyncJobs.id),
  notificationSent: boolean("notificationSent").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  productHistoryIdx: index("sccl_product_history_idx").on(t.supplierId, t.productId, t.createdAt),
  notificationIdx: index("sccl_notification_idx").on(t.notificationSent, t.createdAt),
  jobIdx: index("sccl_job_idx").on(t.syncJobId),
}));

export type SupplierCostChangeLog = typeof supplierCostChangeLog.$inferSelect;
export type InsertSupplierCostChangeLog = typeof supplierCostChangeLog.$inferInsert;

/**
 * Per-org supplier credentials.
 *
 * Generic store for distributors' supplier login pairs (account id +
 * password) used by integrations that authenticate against external
 * supplier services (SanMar, S&S Canada, ASI, alphabroder, etc.).
 *
 * Both `accountId` and `password` are encrypted at rest using the same
 * AES-256-GCM helper as other sensitive fields (server/utils/encryption.ts).
 * The columns are sized at 512 chars to accommodate the "enc:v1:"-prefixed
 * base64 ciphertext, not the plaintext length.
 *
 * Uniqueness: one credential per (organizationId, supplierCode). Solo users
 * (no org) are not yet supported on this table — credentials are always
 * org-scoped because supplier sync jobs run per organization.
 */
export const supplierCredentials = mysqlTable("supplierCredentials", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull().references(() => organizations.id),
  supplierCode: varchar("supplierCode", { length: 64 }).notNull(),
  accountId: varchar("accountId", { length: 512 }).notNull(),
  password: varchar("password", { length: 512 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  orgSupplierUnique: unique("sc_org_supplier_unique").on(t.organizationId, t.supplierCode),
}));

export type SupplierCredential = typeof supplierCredentials.$inferSelect;
export type InsertSupplierCredential = typeof supplierCredentials.$inferInsert;

/**
 * Admin audit log.
 *
 * Append-only record of every platform-admin action that touches another
 * organization's data. Lives outside the org-scope helpers because, by
 * definition, admin actions cross tenant boundaries — instead, the row
 * itself names the targetOrgId so an oncall reviewer can answer "who
 * touched org X, when, and why" without reconstructing intent from logs.
 *
 * `action` is a free-form string (e.g. "platformAdmin.listUsers",
 * "platformAdmin.impersonate"); we keep it as a varchar rather than an
 * enum so adding a new admin endpoint doesn't need a schema migration.
 */
export const adminAuditLog = mysqlTable("adminAuditLog", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  adminUserId: int("adminUserId").notNull().references(() => users.id),
  action: varchar("action", { length: 128 }).notNull(),
  targetOrgId: int("targetOrgId"),
  /** Optional free-form JSON blob — e.g. { reason: "support ticket #1234" } */
  metadata: json("metadata").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (t) => ({
  adminIdx: index("aal_admin_idx").on(t.adminUserId, t.timestamp),
  targetOrgIdx: index("aal_target_org_idx").on(t.targetOrgId, t.timestamp),
}));

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLog.$inferInsert;
