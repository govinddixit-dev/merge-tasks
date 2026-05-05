# MergeTasks — Full System Map

**Date:** 2026-04-21
**Scope:** Read-only structural audit of the entire codebase. Ground truth for Q2 2026 rebuild decisions.
**Author:** audit agent (Claude)
**Status:** read-only catalog. No recommendations. No vision. Facts only.

---

## 1. Top-level architecture

### 1.1 Tech stack (confirmed against `package.json`)

| Layer | Choice | Confirmed |
|---|---|---|
| Language | TypeScript 5.9 (strict) | yes |
| Frontend | React 19.2, Vite 7, Tailwind 4.1, Framer Motion 12, Radix UI, wouter 3.3, TanStack Query 5 | yes |
| API | tRPC 11.6 over Express 4.21 | yes |
| DB ORM | Drizzle 0.44 on MySQL (`mysql2` driver) | yes |
| Email | Resend 6.11 **and** Nodemailer 8 (Gmail OAuth, Outlook OAuth, generic SMTP) | yes — both in deps |
| File storage | AWS S3 (`@aws-sdk/client-s3`) + local-disk fallback; `sharp` 0.34 for image processing | yes |
| Payments | Stripe 22 + Stripe Connect (Express accounts) | yes |
| Auth | JWT in httpOnly cookies (session + refresh), `@node-saml/node-saml`, `openid-client` 6, `bcryptjs`, `jose` | yes |
| AI | `@anthropic-ai/sdk` (no `openai` SDK in deps despite README claim — see §8) | *README inaccurate* |
| Queue | BullMQ 5 + `ioredis` — **present in deps, not driving any workers yet** (see §7) | yes |
| Observability | Sentry (client + server) | yes |
| Process mgmt | pm2 via `ecosystem.config.cjs` → `start-server.sh` → `node dist/index.js` | yes |
| Testing | Vitest 2 (30+ `*.test.ts` files in `server/`), Playwright 1.59 (`e2e/`) | yes |

### 1.2 Directory layout (repo root)

| Path | Purpose |
|---|---|
| `client/` | React SPA (Vite). `src/pages`, `src/components`, `src/contexts`, `src/hooks`, `src/lib`. |
| `server/` | Express + tRPC backend. Co-mingled: `_core/`, `routers/`, `routes/`, `utils/`, `email/`, `jobs/`, `queue/`, `stripe/`, `integrations/`, plus 30+ `*.test.ts` files at the top level. |
| `shared/` | `_core/errors.ts`, `const.ts`, `types.ts`, `invoiceMath.ts`. Imported as `@shared/*`. |
| `drizzle/` | `schema.ts` (2020 lines, 65 `mysqlTable` declarations), `relations.ts` (empty — 5 lines, TODO), 80 numbered SQL migrations (`0000`–`0080`) plus `meta/` snapshots. |
| `e2e/` | Playwright specs. |
| `scripts/` | `migrate.sh`, `seed.ts`. |
| `patches/` | pnpm patches — currently `wouter@3.7.1.patch`. |
| `uploads/` | Local-disk upload destination (dev + prod fallback when `AWS_S3_BUCKET` unset). |
| `dist/` | Production build output (`esbuild`-bundled server ESM + Vite-built client). |
| `docs/` | Prior audits + onboarding docs (this file lives in `docs/audits/`). |
| *repo root* | Many `fix-*.cjs`, `diagnose*.sh`, `fix-*.sh` one-off scripts left in the tree (see §7). Plus `ARCHITECTURE.md`, `README.md`, 7 `CHANGELOG_*.md` files. |

### 1.3 Entry points

| Entry | Path |
|---|---|
| Server | `server/_core/index.ts` → `startServer()` on `PORT` (default 3000). Dev: `tsx watch server/_core/index.ts`. Prod: `node dist/index.js`. |
| Client | `client/src/main.tsx` → `client/src/App.tsx` (routed via `wouter`). |
| tRPC root | `server/routers.ts` → `appRouter` (50 sub-routers; see §3). |
| Public Express routes | `server/routes/*.ts` — `publicProposal`, `publicInvoice`, `unsubscribe`, `deployWebhook`, `storeApproval`, `storeSsoCallback`, `files`. Registered in `server/_core/index.ts:293-303`. |
| Background jobs | **Inside the same Node process** via `setInterval` — `server/jobs/agentCron.ts` (`scheduleAgentCron`, 24 h) and `server/jobs/dataRetentionCleanup.ts` (`scheduleDataRetentionCleanup`). Kicked off at bottom of `startServer()` (`_core/index.ts:364-369`). |
| Queue | `server/queue/bullmq.ts` + `server/queue/redisClient.ts` — BullMQ connection set up, **no queues/workers registered** (explicit `TODO(Phase 8)` at `queue/bullmq.ts:9`). |
| Webhooks | `POST /api/stripe/webhook` (raw body, HMAC via `stripe/webhook.ts`). `POST /api/deploy/webhook` (raw body, GitHub HMAC → pulls + `pnpm build` + pm2 reload). |

### 1.4 Deployment on EC2

- **Process:** Single Node process under pm2, name `mergetasks`, 1 GB `max_memory_restart`, auto-restart with 3 s delay. Started by `start-server.sh` which `source`s `/home/ubuntu/mergetasks/.env` and execs `/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node /home/ubuntu/mergetasks/dist/index.js`.
- **Bind:** In production the process binds to `127.0.0.1` by default (`_core/index.ts:341-342`) — reachable only via the local reverse proxy.
- **TLS termination:** nginx (or Caddy) in front; Node can also terminate TLS directly if `TLS_CERT_PATH` + `TLS_KEY_PATH` are set (with `minVersion: TLSv1.2` — `_core/index.ts:101-108`). `trust proxy = 1` is set so `req.ip` / `Secure` cookies work behind the proxy.
- **Subdomain routing:** nginx adds `X-Store-Slug` for `*.mergetasks.com`; middleware at `_core/index.ts:226-242` 302-redirects non-API paths to `/s/{slug}`.
- **DB:** MySQL on RDS (per memory: EC2 role can't snapshot; user takes pre-apply snapshots manually).
- **Redis:** Optional (`REDIS_URL`). Required for BullMQ + rate limiter. Boot logs a warning if PING fails but does not fail-fast — explicit note: "Phase 1 has no Redis-dependent runtime paths, so a transient outage here must not prevent boot" (`_core/index.ts:349-351`).
- **Deploys:** GitHub webhook at `/api/deploy/webhook` (HMAC-signed) — triggers `deploy.sh`. `deploy.log` at repo root shows ~117 KB of recent deploy activity.

---

## 2. Database schema inventory

**Source:** `drizzle/schema.ts`. 65 `mysqlTable(...)` declarations. Row counts unknown (no DB access during audit). Every table below is reflected in `schema.ts` unless flagged otherwise. "orgScope" = has an `organizationId` column.

### 2.1 Schema drift flags (read first)

| Issue | Detail |
|---|---|
| **Duplicate migration numbers** | `0025_daffy_genesis.sql` + `0025_organizations_multitenancy.sql`; `0026_dashing_lady_deathstrike.sql` + `0026_external_products_columns.sql`. Both pairs use idempotent guards (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` via stored procedures) so fresh replays succeed. Running order is determined by the drizzle journal. |
| **`audit_log` table (migration-only)** | Created by `0028_create_audit_log_table.sql` (append-only, PCI-DSS 10.7). **Not declared in `drizzle/schema.ts`** — written via raw SQL from `server/utils/auditLog.ts`. Canonical schema drift. |
| **`relations.ts` empty** | `drizzle/relations.ts` is 5 lines with a TODO. All joins in the codebase are written manually. |
| **Legacy JSON columns still populated** | `estimates.lineItems` (JSON) marked DEPRECATED in `0078_estimate_builder.sql` — Estimate Builder writes to `estimateLineItems` rows instead. Old rows still render from JSON. `stores.divisions` (JSON) holds free-text division shape captured at store-creation wizard Step 4, not normalized to the `divisions` table. |

### 2.2 Tables by subsystem

#### Auth (2)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `users` | Distributor-side user. Owns Stripe customer + subscription + Connect account; tracks lockout. | n/a | — |
| `verificationCodes` | Email verification + password-reset OTPs for distributors. | no | `userId` → users |

#### Org hierarchy (5)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `organizations` | SaaS tenant — one per distributor company. Holds `defaultTaxRate`, `aiApprovalLevel`, `lastAgentScanAt`. | n/a (is the org) | `ownerId` → users |
| `orgMembers` | Multi-seat: additional distributor users belonging to an org. | yes | `userId` → users, `organizationId` → organizations |
| `divisions` | Enterprise-tier sub-unit of an organization. Soft delete via `isActive`. | yes | `organizationId` → organizations (CASCADE) |
| `clients` | Distributor's end-customer company. Legacy `contactName/contactEmail/contactPhone` mirrored from `clientContacts` primary. | yes (nullable) | `userId` → users |
| `clientContacts` | Multiple contact people per client. `isPrimary` flag (exactly one expected). | no (via client) | `clientId` → clients |

#### Webstore core (10)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `stores` | Webstore config. 80+ columns spanning branding, AI-generated content, editor overrides, multi-division JSON, approval workflow, popup-window dates, tax, currency, payment methods. | yes (nullable) | `userId`, `clientId`, `linkedStoreId` (self) |
| `storeProducts` | Per-store product mapping with `customPrice`, `featured`, inventory, `divisionIds` JSON. | no (via store) | `storeId`, `productId` |
| `storeUsers` | End-user portal account (role: admin / manager / employee / intern). PCI lockout columns. Soft delete via `deletedAt`. | no | `storeId`, `departmentId`, `divisionId` |
| `storeDepartments` | Budget-tracked departments inside a store. `budgetCents`, `spentCents`, `maxPerOrderCents`. | no | `storeId` (CASCADE), `divisionId` (SET NULL) |
| `storeVerificationCodes` | Store-user OTPs for portal login/signup. | no | `storeId` |
| `storePasswordTokens` | Store-user password-reset tokens. | no | `storeId`, `storeUserId` |
| `storeAllowedDomains` | Allowlist of email domains for self-signup into a store. | no | `storeId` |
| `storeIdentityProviders` | SSO (SAML or OIDC) config per store. `groupToDivisionMap` JSON; `targetStoreId` redirects; `defaultDepartmentId` for JIT provisioning. | no | `storeId` (CASCADE), `targetStoreId`, `defaultDepartmentId` |
| `storeMediaFiles` | Shared media library between distributor and POC. | no | `storeId`, `uploadedByUserId`, `uploadedByStoreUserId` |
| `customOrderRequests` | "Custom request" submissions from store end users. | no | `storeId`, `storeUserId` |

#### Product catalog + print + suppliers (10)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `products` | Master distributor product. `basePrice` (decimal 10,2), `pricingTiers` (JSON). | yes | `userId` |
| `productCollections` | Distributor-curated product groupings. | yes | `userId` |
| `collectionProducts` | Many-to-many: collection ↔ product. | no | `collectionId`, `productId` |
| `apiConnections` | ASI ESP / PromoStandards / Sage credentials per distributor. | yes | `userId` |
| `printRequests` | Customer print-on-demand request submissions. | yes | `storeId`, `storeUserId`, `divisionId` |
| `printProducts` | Print-store products (distinct catalog from `products`). | yes | — |
| `printProductVariants` | Variant (size / material) of a `printProducts` row. | no | `printProductId` |
| `printProductPricing` | Quantity-tier pricing per variant, stored in **integer cents**. | no | `printProductVariantId` |
| `printSupplierConnections` | Per-distributor print-supplier API config. | yes | — |
| `suppliers` | Supplier directory (for POs). | yes | — |

#### Proposals (8)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `proposals` | Rich proposal — intro copy, recipient, status, totals, approvalLinkExpiry, `paid_at` (added `0039`), `costPrice` flag (added `0068`). | yes | `userId`, `clientId` |
| `proposalProducts` | Product rows on a proposal (with `unitPrice`, `costPrice`). | no | `proposalId`, `productId` |
| `proposalProductVariants` | Per-variant config (color/size) on a proposal product. | no | `proposalProductId` |
| `proposalPriceTiers` | Quantity- or size-tiered pricing. | no | `proposalProductId` |
| `proposalProductImages` | Ordered images on a proposal product. | no | `proposalProductId` |
| `proposalSizeCharts` | Size chart per proposal product. | no | `proposalProductId` |
| `proposalOrderItems` | Line items of an accepted-for-payment proposal (what the client actually buys). `unitPrice`, `costPrice`, quantity. | no | `proposalId`, `proposalProductId` |
| `proposalVersions` | Version-history snapshots of proposals (for revert). | no | `proposalId` |

#### Estimates (3)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `estimates` | Binding cost estimate built from proposals. `lineItems` JSON marked DEPRECATED. `convertedToInvoiceId` → invoices (FK declared in SQL, not Drizzle, to avoid TS circular init). | yes | `userId`, `clientId`, `proposalId` |
| `estimatePackages` | Package groupings within an estimate. | no | `estimateId` |
| `estimateLineItems` | Normalized line items (replaces legacy JSON). | no | `estimateId`, `packageId` |

#### Invoices (1)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `invoices` | Billable document. `stripeInvoiceId`, `publicAccessToken`, payment status. | yes | `clientId`, `proposalId`, `estimateId` |

#### Orders (webstore) (2)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `orders` | Webstore-checkout order. `orderNumber`, `status`, `total`, `stripeCheckoutSessionId`, `paymentFailedAt` (from `0072`). Attribution cols `promoCodeId`, `customRequestId` (from `0044`). | no (via store) | `storeId`, `storeUserId`, `promoCodeId`, `customRequestId` |
| `orderItems` | Line items on an order. `productId`, `unitPrice`. | no | `orderId`, `productId`, `storeProductId` |

#### Purchase orders (4)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `purchaseOrders` | Supplier-bound PO aggregated from order/proposal items. Statuses incl. `declined` (from `0062`). | yes | `supplierId`, `orderId`, `proposalId` |
| `purchaseOrderEvents` | Timeline events on a PO (audit). | no | `purchaseOrderId` |
| `suppliers` | *(also listed above under catalog)* — shared by both subsystems. | yes | — |
| `poPreviewDrafts` | Transient preview drafts for PO aggregation UI. | yes | — |

#### Department approval (1)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `departmentApprovals` | Per-department approval rows on a proposal. **Department is a free-text string, not FK to `storeDepartments`.** `approvalToken` is the public link. `addedBy: distributor|poc`. | no (via proposal) | `proposalId` |

#### Stripe / billing / refunds (4)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `stripe_webhook_events` | Idempotent webhook-event log (added `0053`). | no | — |
| `refund_history` | Issued refunds (Stripe refund id, amount, status). | yes | `distributorUserId`, `orderId`, `proposalId`, `invoiceId` |
| `refund_requests` | Client-initiated refund requests awaiting distributor action. | yes | `distributorUserId`, `orderId`, `storeUserId` |
| `promoCodes` / `promoCodeUsages` | Promo-code definitions and per-usage ledger. | yes (promoCodes) / no (usages) | `storeId`; `promoCodeId`, `orderId` |

#### Copilot & Agent (7)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `copilot_conversations` | User ↔ copilot chat sessions. | yes | `userId` |
| `copilot_memory` | Persistent memory entries for copilot context builds (indexed `0035`). | yes | `userId` |
| `copilot_task_log` | Action/tool-call history for the copilot. | yes | `userId` |
| `copilotPendingActions` | Agent inbox — proposed actions awaiting approval. | yes | `userId` |
| `aiAuditLog` | AI-call audit trail (added `0033`). | yes | `userId` |
| `aiTrainingData` | AI store-content prompts + generations (for retraining). | yes | `storeId`, `userId` |
| `aiEditFeedback` | Thumbs-up/down on AI-edited store content. | yes | `storeId`, `userId` |

#### Email pipeline (2)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `emailConnections` | Gmail / Outlook / SMTP transport config per distributor. | yes | `userId` |
| `emailUnsubscribes` | RFC 8058 / CASL unsubscribe ledger (added `0064`). | no | `userId` |

#### Files / media (3)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `clientLogos` | Client brand logos. | no | `clientId`, `userId` |
| `clientAssets` | Client-approved brand assets (fonts, etc.). | yes | `clientId`, `userId` |
| `storeMediaFiles` | *(also listed above under webstore)* — distributor ↔ POC shared library. | — | — |

#### Notifications (1)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `notifications` | In-app notification center. Enum includes `print_request` (`0080`), `department_approval`, `custom_request`, etc. | yes | `userId` |

#### Proofing (1)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `virtualProofs` | AI-generated virtual proofs of decorated products. | yes | `proposalProductId`, `userId` |

#### Misc (4)
| Table | Purpose | orgScope | Key FKs out |
|---|---|---|---|
| `distributorProfiles` | Post-signup distributor profile (title, phone, company URL). Placeholder-created at social auth (see §7). | yes | `userId` |
| `waitlist` | Marketing leads. **Zero router imports found** — flagged orphan (see §7). | no | — |
| `documentSequences` | Per-org monotonic numbering for proposals / invoices / POs. Legacy `0079` fix-up for NULL orgs. | yes | — |
| *(migration-only)* `audit_log` | **Not declared in `schema.ts`.** Written via raw SQL by `server/utils/auditLog.ts`. Append-only; 90-day retention enforced by `dataRetentionCleanup.ts`. | no | — |

### 2.3 Orphan / dead / deprecated tables

| Flag | Table | Evidence |
|---|---|---|
| Orphan | `waitlist` | Zero imports from `server/routers/*` outside of its own router. Marketing-page holdover. |
| Deprecated column | `estimates.lineItems` (JSON) | `0078_estimate_builder.sql` + `TODO(estimate-builder)` at `routers/estimatesInvoices.ts:256` — builder migration incomplete. |
| Drift | `audit_log` table | Migration-only, never added to `schema.ts`. |
| Drift | `relations.ts` | Effectively unused. |
| Legacy mirror | `clients.contactName` / `.contactEmail` / `.contactPhone` / `.contactTitle` | Mirrored from `clientContacts` primary row for back-compat. Both paths still read by different callers. |
| Legacy mirror | `stores.divisions` (JSON) | Wizard-captured division blobs, not normalized to `divisions` table. |

---

## 3. Subsystem inventory

**Convention:** status = production | partial | experimental | dead. Table ownership lists primary tables only; shared tables (`suppliers`, `storeMediaFiles`, etc.) appear in their primary subsystem.

| # | Subsystem | Purpose | Tables | tRPC / files | External | Status |
|---|---|---|---|---|---|---|
| 1 | **Distributor auth** | Email/password login (bcrypt), Google & Microsoft OAuth, JWT cookies, refresh rotation, account lockout, revocation via Redis blocklist. | `users`, `verificationCodes`, `audit_log` | `routers/socialAuth.ts`, `routes/storeSsoCallback.ts`, `_core/oauth.ts`, `utils/tokenBlocklist.ts`, `socialAuthCallbacks.ts` (Google/MS). `appRouter.auth.logout/logoutAll` inline in `routers.ts`. | Google OAuth, Microsoft OAuth, `jose` | production |
| 2 | **Store auth + SSO** | End-user login to webstore portals (email/password + OTP). SAML 2.0 + OIDC SSO with JIT provisioning, `groupToDivisionMap`, `targetStoreId` redirect. | `storeUsers`, `storeVerificationCodes`, `storePasswordTokens`, `storeIdentityProviders` | `routers/storeAuth.ts`, `routers/storePortalAuth.ts`, `routers/storeSso.ts`, `routers/storeUserProvisioning*.ts`, `routes/storeSsoCallback.ts`, `utils/samlProvider.ts`, `utils/oidcProvider.ts`, `utils/ssoUserResolver.ts`, `utils/pkceStore.ts` | `@node-saml/node-saml`, `openid-client` | production |
| 3 | **Product catalog + supplier sync** | Manual product entry + import from ASI ESP / PromoStandards / Sage. Per-distributor API creds. | `products`, `productCollections`, `collectionProducts`, `apiConnections` | `routers/products.ts`, `routers/externalProducts.ts`, `routers/collections.ts`, `integrations/productSearchAdapter.ts` | ASI ESP, PromoStandards (SOAP/XML), Sage | production (coverage per-supplier varies) |
| 4 | **Imprint zones / decoration** | Configure decoration method + placement per proposal product. Generate AI virtual proofs. | `virtualProofs`, `proposalProducts` (decoration cols) | `routers/proofing.ts`, `_core/imageGeneration.ts` | Anthropic (image gen via Claude), `sharp` | production |
| 5 | **Proposals** | Build/version/send/track proposals with rich product config, tiered pricing, multi-dept approval, PDF export, signed-link expiry. | `proposals`, `proposalProducts`, `proposalProductVariants`, `proposalPriceTiers`, `proposalProductImages`, `proposalSizeCharts`, `proposalOrderItems`, `proposalVersions` | `routers/proposals.ts` (barrel), `proposalsCrud.ts`, `proposalsSend.ts`, `proposalsCatalog.ts`, `proposalsVersions.ts`, `routes/publicProposal.ts` | Stripe (accept-to-pay), email transport | production |
| 6 | **Estimates** | Distributor-built cost estimate, converts to invoice. | `estimates`, `estimatePackages`, `estimateLineItems` | `routers/estimatesInvoices.ts` (shared with invoices) | email | partial — line-item builder writes to legacy JSON in some paths (`TODO(estimate-builder)` at `routers/estimatesInvoices.ts:256`) |
| 7 | **Invoices** | Billable document, Stripe-linked payment collection, public view token, refund hooks. | `invoices` | `routers/estimatesInvoices.ts`, `routes/publicInvoice.ts` | Stripe, email | production |
| 8 | **Orders (webstore)** | Checkout-generated order with line items, attribution to promo code / custom request. | `orders`, `orderItems` | `routers/orders.ts`, `routers/storeCheckout.ts`, `routers/storePortalOrders.ts`, `utils/generatePOsForOrder.ts` | Stripe Connect | production |
| 9 | **Purchase orders** | Aggregate order/proposal items by supplier, generate POs, send by email/API, track status incl. `declined`. | `purchaseOrders`, `purchaseOrderEvents`, `suppliers`, `poPreviewDrafts` | `routers/purchaseOrders.ts`, `utils/supplierGrouping.ts`, `utils/supplierSubmission.ts`, `utils/supplierNormalizer.ts`, `utils/quickbooksPOSync.ts` | QuickBooks (skeleton), supplier email/API | production; QuickBooks sync skeleton only; supplier-email dispatch has "coming soon" at `routers/purchaseOrders.ts:483` |
| 10 | **Multi-department approval** | Route a proposal through N departments for signoff before client send. Per-dept signed token + expiry. | `departmentApprovals` | `routers/departmentApprovals.ts`, `routers/storePortalDepartments.ts`, `routes/storeApproval.ts`, `email/emailTemplates.ts` | email | production |
| 11 | **Stripe Connect (distributor payments from end-clients)** | Distributor onboards Express account; client CC charges flow through. Webhook verifies + records. | `users.stripeConnect*`, `stripe_webhook_events` | `routers/stripeConnect.ts`, `stripe/webhook.ts`, `stripe/stripeClient.ts`, `stripe/stripeVersion.ts` | Stripe | production |
| 12 | **SaaS billing (distributor subscription)** | Stripe subscription for distributor; 3 tiers (free / pro / enterprise); plan limits enforced per-feature. | `users.stripe*`, `users.subscriptionTier`, `users.subscriptionStatus` | `routers/billing.ts`, `stripe/products.ts`, `utils/planLimits.ts` | Stripe | production |
| 13 | **AI Copilot (user-facing chat)** | Multi-turn chat with tool execution (proposals/estimates/orders/etc). Persistent memory. | `copilot_conversations`, `copilot_memory`, `copilot_task_log`, `copilotPendingActions` | `routers/copilot.ts`, `copilotMemory.ts`, `copilotSystemPrompt.ts`, `copilotTools.ts`, `copilotInlineTools.ts`, `copilotToolDefs.ts`, `copilotExecutors.ts`, `copilotExec/` (split per tool group), `_core/llm.ts`, `_core/anthropicAdapter.ts`, `_core/safeLLM.ts`, `_core/aiGatekeeper.ts` | Anthropic Claude | production; `copilot.ts.bak` + `copilot.ts.fix-all.bak` left in tree (see §7) |
| 14 | **Agent infra (triggers / inbox / briefing)** | Scheduled scan detects low-engagement stores, overdue invoices, dormant clients, expiring proposals. LLM evaluates, creates `copilotPendingActions`. Daily briefing to org owner. | `copilotPendingActions`, `aiAuditLog`, `aiTrainingData` | `routers/agent.ts`, `routers/actionApproval.ts`, `routers/actionClassifier.ts`, `utils/agentTriggers.ts`, `utils/agentActions.ts`, `utils/agentMemory.ts`, `jobs/agentCron.ts` | Anthropic | production; runs inside main process via `setInterval`; Phase 8 plan moves to BullMQ |
| 15 | **Email pipeline** | Transactional email via Gmail OAuth / Outlook OAuth / generic SMTP / Resend. Per-org transport config. Branded sender resolver. Unsubscribe (RFC 8058 + CASL). | `emailConnections`, `emailUnsubscribes` | `email/mailer.ts`, `email/brandingResolver.ts`, `email/emailTemplateBase.ts`, `email/emailTemplates.ts`, `email/emailTemplates/`, `email/proposal*.ts`, `email/sendItOnboardingEmail.ts`, `email/sendOnboardingCompleteEmail.ts`, `email/sendSsoOnboardingEmail.ts`, `email/sendWelcomeEmail.ts`, `email/unsubscribe.ts`, `routers/email.ts`, `routers/email/` (split), `routes/unsubscribe.ts` | Gmail, Outlook, Resend | production |
| 16 | **PDF generation** | Proposal / invoice / PO PDFs delivered via `jspdf`. Download endpoint + email attachments. | n/a | distributed in `proposalsVersions.ts`, `estimatesInvoices.ts`, `purchaseOrders.ts`; client uses `jspdf` directly for front-end renders | `jspdf` | production |
| 17 | **File storage / media** | S3-backed upload/download with presigned URLs. Local-disk fallback for dev. `/api/files/:key` authenticated, `/api/files/public/:key` for branding. | `clientLogos`, `clientAssets`, `storeMediaFiles` | `server/storage.ts`, `routes/files.ts`, `routers/storeMedia.ts`, `routers/branding.ts`, `routers/clientsAssets.ts`, `utils/removeBackground.ts` | AWS S3, `sharp` | production |
| 18 | **Background jobs / cron** | In-process `setInterval`: 24 h agent scan, 90 d audit/notification cleanup. BullMQ wired but has zero consumers. | — | `jobs/agentCron.ts`, `jobs/dataRetentionCleanup.ts`, `queue/bullmq.ts`, `queue/redisClient.ts` | Redis (for BullMQ, currently unused) | partial — BullMQ skeleton only |
| 19 | **Admin / platform-admin** | Owner-only dashboard: signups, churn, MRR, store/proposal/order metrics. | reads from many tables | `routers/platformAdmin.ts` | — | production |
| 20 | **Notifications** | In-app notification center. CRUD + mark-read. | `notifications` | `routers/notifications.ts`, `_core/notification.ts` | — | production |
| 21 | **Webstore storefront (customer-facing)** | Public product browse, cart, checkout, portal dashboard, print store, department budget gate, promo codes, custom-request submission. | `stores`, `storeProducts`, `storeUsers`, `storeDepartments`, `printRequests`, `printProducts`, `promoCodes`, `customOrderRequests`, `orders` | server: `storeCheckout.ts`, `storePortal.ts`, `storePortalAuth.ts`, `storePortalBudgets.ts`, `storePortalCustomRequests.ts`, `storePortalDepartments.ts`, `storePortalOrders.ts`, `storePortalPrint.ts`, `storePortalProposals.ts`, `storePortalRefunds.ts`, `storePortalStats.ts`, `storeCheckout.ts`, `storesApproval.ts`, `storesAi.ts`, `storesCatalog.ts`, `storesCrud.ts`, `storeDivision.ts`, `storeDepartmentBudgets.ts`, `storeMedia.ts`, `printProducts.ts`, `printRequestsCrud.ts`, `promoCodesCrud.ts`. client: `client/src/pages/webstore/*` | Stripe | production |
| 22 | **Refunds** | Distributor issues refunds to clients (DB + Stripe); POC requests refunds; approval/denial cycle. | `refund_history`, `refund_requests` | `routers/refunds.ts`, `routers/storePortalRefunds.ts`, `utils/refundService.ts` | Stripe | production |
| 23 | **Onboarding (distributor)** | Post-signup profile capture, Stripe setup prompts, welcome email. | `distributorProfiles` | `routers/onboarding.ts`, `email/sendOnboardingCompleteEmail.ts`, `email/sendWelcomeEmail.ts` | email | production |
| 24 | **Account management** | Data export, account deletion (GDPR/CCPA-shaped). | users + related | `routers/accountDeletion.ts`, `routers/dataExport.ts` | email | production |
| 25 | **Voice** | Audio transcription + TTS for copilot. | n/a | `routers/voice.ts`, `_core/voiceTranscription.ts`, `_core/voiceTts.ts` | provider set by `_core/voiceTranscription.ts` | partial / experimental — small surface |
| 26 | **Waitlist** | Marketing lead capture for pre-launch flows. | `waitlist` | `routers/waitlist.ts` | — | dead — zero upstream callers noted; router still mounted |

---

## 4. Pricing engine deep-dive

**Why this section exists:** Phase 1 targets pricing. This section is longer than others.

### 4.1 The three pricing systems

| # | System | Primary tables | Units | Who sets it | Where it's read |
|---|---|---|---|---|---|
| A | **`customPrice` (webstore)** | `storeProducts.customPrice` (decimal 10,2), falls back to `products.basePrice` (decimal 10,2). | decimal dollars | distributor (per store) | webstore PDP display, ProductCard, webstore checkout |
| B | **`proposalPriceTiers` (proposals)** | `proposalPriceTiers` (`tierType` enum `quantity|size`, `minQty`, `maxQty`, `price` decimal 10,2). Sibling: `proposalProducts.unitPrice` (decimal 10,2) and `proposalOrderItems.unitPrice` (decimal 10,2). | decimal dollars | distributor (per proposal product) | proposal accept-to-pay flow, Stripe webhook total |
| C | **`printProductPricing` (print products)** | `printProductPricing.priceInCents` (int). Per-variant, per-quantity tier. | **integer cents** | distributor (per print variant) | print store catalog |

**Observation:** Three systems, three different storage shapes (decimal dollars with fallback / decimal dollars + tier table / integer cents). No shared resolver.

### 4.2 Every price-computation call site

**Webstore checkout (canonical, cents):**
- `server/routers/storeCheckout.ts:432` — `const canonicalPriceCents = priceToCents(sp.customPrice) || priceToCents(product.basePrice);`
- `server/routers/storeCheckout.ts:441` — `canonicalPriceCents * item.quantity` (subtotal).
- `server/routers/storeCheckout.ts:452` — sent to Stripe `line_item.unit_amount`.
- `server/routers/storeCheckout.ts:460` — written to `orderItems.unitPrice`.
- `server/routers/storeCheckout.ts:993` — **second copy** of the same fallback (duplicate path for a different create-order branch).
- `server/routers/storeCheckout.ts:1007` — `unitPriceCents: canonicalPriceCents` (second write).

**Webstore catalog API (server, decimal dollars):**
- `server/routers/storesCrud.ts:145` — `customPrice: sp?.customPrice ?? p.basePrice` (getById).
- `server/routers/storesCrud.ts:310` — `customPrice: sp?.customPrice ?? p.basePrice` (getBySlug).

**Webstore PDP (client, decimal dollars, tier-aware):**
- `client/src/pages/webstore/StoreProductDetailPage.tsx:78-84` — `getPrice()` checks `product.pricingTiers` JSON first (by quantity band), then `parseFloat(product.customPrice || product.basePrice || "0")`.
- `client/src/pages/webstore/ProductCard.tsx:77` — `parseFloat(product.customPrice ?? product.basePrice)` — **no tier evaluation** in the grid card.

**Proposals (decimal dollars, tiered at build time):**
- `server/routers/proposalsCatalog.ts:100` — `price: t.price?.toString() || "0"` reads tier rows.
- `server/routers/proposalsCrud.ts:93` — `price: parseFloat(pp.unitPrice || "0")` renders list totals.
- `server/routers/storePortalProposals.ts:152` — `unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null` (portal view; 3-way fallback).
- `server/stripe/webhook.ts:146-148` — **charges at accept-time:** `sum + parseFloat(oi.unitPrice?.toString() || "0") * oi.quantity`, reading `proposalOrderItems.unitPrice`. No server validation against `proposalPriceTiers` at charge time.
- `client/src/pages/public-proposal/StripeCheckout.tsx:25` — client-computed total from `p.unitPrice`.

**Print products (integer cents, quantity-tiered):**
- `server/routers/printProducts.ts:135` — `priceInCents: t.priceInCents` (public list).
- `server/routers/printProducts.ts:202,205,259,262,385,388` — insert/update mutations preserve `priceInCents`.

**Invoice / estimate math (shared):**
- `shared/invoiceMath.ts:41-44` — `round2(n)` helper. Used only in invoice calculations; not called from webstore or proposals.

### 4.3 The checkout-vs-PDP divergence — where and why

**Divergence #1 — `pricingTiers` ignored at webstore checkout.**
- PDP (`StoreProductDetailPage.tsx:78-84`) evaluates `product.pricingTiers` (JSON on `products`) by quantity, so a customer viewing the PDP sees a tiered price.
- Checkout (`storeCheckout.ts:432`) **does not read `pricingTiers`** — it uses flat `sp.customPrice || product.basePrice` only.
- Result: the displayed tier discount (e.g., "5+ units: $X") is lost when the order is actually placed. Customer gets charged the single `customPrice`, typically higher than the tier.

**Divergence #2 — fallback scope drift.**
- PDP fetch coalesces `sp.customPrice ?? p.basePrice` at the API boundary (`storesCrud.ts:145,310`).
- Checkout re-coalesces the same pair in cents (`storeCheckout.ts:432`).
- Both paths include the same logic, but if `basePrice` is deleted between PDP load and checkout, PDP breaks first (read before write) and the payment path still uses the cached `customPrice`.

**Divergence #3 — trust of client-submitted `unitPrice`.**
- **Webstore checkout:** client-submitted `unitPrice` in the cart request is **explicitly ignored** by server. Server re-resolves from `storeProducts` / `products` (`storeCheckout.ts:431` comment: "Client-submitted unitPrice is IGNORED — canonical price is authoritative").
- **Proposal checkout:** server trusts `proposalOrderItems.unitPrice` as-written and charges from it (`stripe/webhook.ts:147`). `proposalOrderItems` is populated by the proposal-accept flow, which copies from `proposalProducts.unitPrice` (set at proposal build time by the distributor via `proposalsCatalog.saveProductCatalogConfig`). There is no re-validation against `proposalPriceTiers` at the moment of payment.

### 4.4 Duplicate pricing logic across files

**Pattern: `customPrice ?? basePrice` fallback — 6 sites.**
- `server/routers/storesCrud.ts:145`
- `server/routers/storesCrud.ts:310`
- `server/routers/storeCheckout.ts:432`
- `server/routers/storeCheckout.ts:993`
- `client/src/pages/webstore/StoreProductDetailPage.tsx:84`
- `client/src/pages/webstore/ProductCard.tsx:77`

**Pattern: `Σ unitPrice × quantity` — 3 sites.**
- `server/routers/storeCheckout.ts:441`
- `server/stripe/webhook.ts:146-148` (proposal accept-to-pay)
- `client/src/pages/public-proposal/StripeCheckout.tsx:25`

**Pattern: decimal-dollar → cents conversion — localized to `storeCheckout.ts:133-137`** (`priceToCents`, `centsToDecimal` — not exported for re-use).

**Pattern: `round2` — `shared/invoiceMath.ts:41-44`** (used only by invoices).

### 4.5 Tables linkage summary for pricing

```
products (basePrice, pricingTiers JSON)                       ← only products has pricingTiers
   ↓
storeProducts (customPrice)   ──► used by webstore checkout + PDP
                              ──► pricingTiers read only by PDP client-side

proposalProducts (unitPrice, costPrice)
   ↓
proposalPriceTiers (price)    ← only proposal build-time UI references this
   ↓
proposalOrderItems (unitPrice, costPrice)  ← what Stripe webhook actually charges

printProductVariants
   ↓
printProductPricing (priceInCents)  ← print-store-only, distinct storage unit
```

---

## 5. Org hierarchy deep-dive

**Why this section exists:** Task 2a design decisions target this surface.

### 5.1 Schema snapshot (columns that matter — full types at `drizzle/schema.ts`)

**`organizations`** (`schema.ts:1274`): `id`, `name`, `slug` (unique), `ownerId`→`users.id` (NOT NULL), `aiApprovalLevel` enum, `defaultTaxRate` decimal(5,4), `lastAgentScanAt`, `createdAt`, `updatedAt`.

**`orgMembers`** (`schema.ts:1346`): `id`, `userId`→`users.id` (NOT NULL), `organizationId`→`organizations.id` (NOT NULL), plus role/invite cols.

**`clients`** (`schema.ts:39`): `id`, `userId`→`users.id` (NOT NULL, owner distributor), `organizationId`→`organizations.id` (**nullable** — legacy pre-org rows), `companyName`, `contactName`/`contactEmail`/`contactPhone`/`contactTitle` (legacy mirror of primary contact), `hasWebstore`, `status` enum (`active|inactive|prospect`), `taxExempt`, `industry`, `companySize`, `website`, `address`, `notes`.

**`clientContacts`** (`schema.ts:79`): `id`, `clientId`→`clients.id` (NOT NULL), `firstName`, `lastName`, `email`, `phone`, `title`, `isPrimary` bool (invariant: exactly one primary expected; enforced in code, not DB).

**`divisions`** (`schema.ts:1325`): `id`, `organizationId`→`organizations.id` ON DELETE CASCADE (NOT NULL), `name`, `code` (scoped unique), `settings` JSON, `isActive` (soft delete).

**`users`** (`schema.ts:7`): `id`, `openId` (unique), `name`, `email`, `role` enum (`user|admin`), Stripe fields, `subscriptionTier` enum (`free|pro|enterprise`), `subscriptionStatus`, Stripe Connect cols, `failedLoginAttempts`, `lockedUntil`.

**`storeUsers`** (`schema.ts:641`): `id`, `storeId`→`stores.id` (NOT NULL), `email`, `name`, `role` enum (`admin|manager|employee|intern`), `department` legacy varchar (display only), `departmentId`→`storeDepartments.id` ON DELETE SET NULL, `passwordHash`, `spendingLimit`, `pointsBalance`, `status` enum (`active|invited|suspended`), `lastLoginAt`, `ssoProviderId` (implicit ref), `ssoSubject`, `divisionId`→`divisions.id` ON DELETE SET NULL, `failedLoginAttempts`, `lockedUntil`, `deletedAt` (soft delete).

**`stores`** (`schema.ts:183`): 80+ cols. Ownership: `userId`→`users.id` (NOT NULL), `organizationId`→`organizations.id` (**nullable**), `clientId`→`clients.id` (NOT NULL). Typed/enum: `storeType` (`permanent|popup`), `status` (`active|inactive|setup|draft|pending_approval|revision_requested`), `ssoProvider` (`microsoft_entra|google_workspace|okta|none`). Flags: `multiDepartment`, `rbacEnabled`, `ssoEnabled`, `requireAuth`. Dates: `startDate`/`endDate` for popup windows. Self-ref: `linkedStoreId`→`stores.id`. Money: `taxRate` decimal(5,4), `currency` varchar(3) default `'usd'`, `allowedPaymentMethods` JSON. Multi-division: **`divisions` JSON** (array of `{id, name, departments[], pocEmail?, isActive?}` — **not normalized to the `divisions` table**). Approval link: `approvalToken`, `approvalExpiresAt`, etc. AI-generated content: `aiHeroHeadline`, `aiColorPalette`, `aiIndustryTheme`, `aiCategoryDescriptions`, `aiOptimizedAt`, … Editor overrides: `editorHeroHeadline`, `editorHeroSubtitle`, `editorTagline`, `editorWelcomeMessage`, `editorCategoryOrder`, `editorCategoryNames`, `editorSubCategories`, `editorProductNames`, `editorProductDescriptions`.

**`storeIdentityProviders`** (`schema.ts:1406`): `id`, `storeId`→`stores.id` ON DELETE CASCADE (NOT NULL), `name`, `protocol` enum (`saml|oidc`), `domain` (email domain, scoped unique with `storeId`), SAML cols (`samlEntryPoint`, `samlCertificate`, `samlIssuer`), OIDC cols (`oidcDiscoveryUrl`, `oidcClientId`, `oidcClientSecret` encrypted), `groupToDivisionMap` JSON (`Record<string, number>` — group/attr → `divisions.id`), `targetStoreId`→`stores.id` ON DELETE SET NULL (post-auth redirect to child store), `defaultDepartmentId`→`storeDepartments.id` ON DELETE SET NULL (JIT default dept), `enabled`.

**`storeDepartments`** (`schema.ts:692`): `id`, `storeId`→`stores.id` ON DELETE CASCADE (NOT NULL), `divisionId`→`divisions.id` ON DELETE SET NULL, `name`, `budgetCents`, `spentCents`, `maxPerOrderCents`, `fiscalPeriodStart`/`End`, `warnThresholdPct` default 80, `isActive`, `createdBy` enum (`distributor|poc`).

### 5.2 FK graph (text)

```
users
  ├─ (ownerId)      organizations
  └─ (userId)       clients / stores / products / emailConnections / proposals / …

organizations
  ├─ (organizationId CASCADE) divisions
  ├─ (organizationId nullable) clients
  ├─ (organizationId nullable) stores
  └─ (organizationId) products / proposals / estimates / invoices / refunds / …

clients
  ├─ clientContacts
  └─ stores

stores (CASCADE for all below)
  ├─ storeUsers
  │    ├─ departmentId → storeDepartments (SET NULL)
  │    └─ divisionId   → divisions        (SET NULL)
  ├─ storeDepartments
  │    └─ divisionId   → divisions        (SET NULL)
  ├─ storeIdentityProviders
  │    ├─ targetStoreId      → stores          (SET NULL)
  │    ├─ defaultDepartmentId → storeDepartments (SET NULL)
  │    └─ groupToDivisionMap (JSON → divisions.id, no FK)
  ├─ storeProducts (divisionIds JSON, no FK)
  └─ stores.divisions (JSON blob, no FK to divisions)

proposals
  └─ departmentApprovals (departmentName is a string; no FK to storeDepartments)
```

Nullability summary: `clients.organizationId` and `stores.organizationId` are nullable — legacy rows predate the multi-tenancy migration (`0025_organizations_multitenancy.sql`). `orgScope.ts` accommodates this with a `userId` fallback.

### 5.3 POC (point of contact)

There is no first-class `poc` entity. POC is represented in four overlapping places:

1. **`clientContacts.isPrimary = true`** — the primary contact for a client. On create/update, first contact auto-promotes to primary (`routers/clientContacts.ts`).
2. **`storeUsers.role IN ('admin','manager')`** — portal users allowed to manage departments/users. Enforced at `routers/storePortalDepartments.ts:55-56`.
3. **`departmentApprovals.contactName` / `.contactEmail`** — per-department approver (strings, not FK).
4. **`stores.divisions[].pocEmail`** (JSON) — wizard-captured POC per division.

`createdBy` enum values (`distributor|poc`) appear on `storeDepartments.createdBy` and `departmentApprovals.addedBy` — the system tracks which role authored the row.

### 5.4 SSO config location

**Per-store**, in `storeIdentityProviders`. Not per-organization, not per-division.
- Protocols: SAML 2.0 (`samlEntryPoint`, `samlCertificate`, `samlIssuer`) and OIDC (`oidcDiscoveryUrl`, `oidcClientId`, `oidcClientSecret`). OIDC secret is encrypted at rest (see `utils/encryption.ts`).
- Routing: `groupToDivisionMap` JSON assigns `storeUsers.divisionId` at JIT provisioning from an SSO group or attribute claim. `targetStoreId` can redirect successful auth to a different (child) store — division-specific subdomains share an IdP but land the user on their division's storefront. `defaultDepartmentId` auto-attaches the JIT user to a department.
- Handlers: `utils/samlProvider.ts`, `utils/oidcProvider.ts`, `utils/ssoUserResolver.ts`, `routes/storeSsoCallback.ts`, `routers/storeSso.ts`. Also `distributor-side` social auth (Google/Microsoft) lives separately in `socialAuthCallbacks.ts` and `routers/socialAuth.ts` — distinct code path, distinct concern.

### 5.5 Multi-division webstore scoping

Two mechanisms run in parallel:

**Mechanism A — normalized (`divisions` table).** Enterprise-tier gated. `storeDepartments.divisionId`, `storeUsers.divisionId`, `storeIdentityProviders.groupToDivisionMap`, `storeProducts.divisionIds` (JSON array of `divisions.id`) all participate. Catalog filter at checkout: a `storeProducts` row is visible to a `storeUser` iff `storeProducts.divisionIds` is NULL/empty OR contains the user's `divisionId`. Tier gate enforced in `routers/divisions.ts` (`assertEnterpriseTier`).

**Mechanism B — JSON on `stores.divisions`.** Captured by Create-Store Wizard Step 4. Shape: `Array<{id: string, name: string, departments: string[], pocEmail?, isActive?}>`. Not a FK to `divisions`. Used for rendering + capturing department names at setup; NULL on legacy stores.

Neither mechanism back-fills the other. A distributor can plausibly have a store where the `stores.divisions` JSON says one thing and the normalized `divisions` table says another.

### 5.6 Multi-department approval reads from

`departmentApprovals` (per-proposal), **not** `storeDepartments` (per-store). Department is stored as a free-text `departmentName` plus `contactName`/`contactEmail` strings. No FK. Read path: `routers/departmentApprovals.ts` → `SELECT ... FROM departmentApprovals WHERE proposalId = ?` ordered by `sortOrder`. Token-based approval link (`approvalToken` unique, optional 72 h expiry if `proposals.approvalLinkExpiryEnabled`). Email flow via `email/emailTemplates.ts#buildDeptApprovalRequestEmail`. Budget enforcement happens elsewhere — at webstore checkout against `storeDepartments.budgetCents` / `spentCents` / `maxPerOrderCents` — and is unrelated to proposal approval routing.

---

## 6. Cross-cutting concerns

### 6.1 orgScope multi-tenancy

- **Helper:** `server/utils/orgScope.ts` exposes a `getOrgScope(ctx)`-style function returning per-table WHERE predicates for ~22 scoped tables.
- **Fallback:** if the caller's `organizationId` is null (legacy solo accounts), the scope falls back to `userId`. Tables that can't use `userId` (e.g. `refund_history`) fall back to `distributorUserId`.
- **Enforcement:** manual — every protected router query must call `getOrgScope(ctx)` and add its clause. Not a middleware.
- **Known bypass risk:** raw `db.select().from(table)` without `orgScope` will return cross-tenant rows. Unscoped reads exist in `routers/accountDeletion.ts`, `routers/copilotExecStores.ts`, `routers/platformAdmin.ts` (intentional — admin is cross-org). No systematic audit of every router has been performed.
- **Write stamping:** insert helpers stamp `organizationId` from `ctx` at call sites. Nothing prevents a forgotten stamp.

### 6.2 Money math

- **Schema:** mostly `decimal(10,2)` — `products.basePrice`, `storeProducts.customPrice`, `proposalProducts.unitPrice`, `proposalOrderItems.unitPrice`, `proposalPriceTiers.price`, `invoices.total`, etc. Tax rates are `decimal(5,4)` (`organizations.defaultTaxRate`, `stores.taxRate`). Budget columns on `storeDepartments` are **integer cents** (`budgetCents`, `spentCents`, `maxPerOrderCents`). Print pricing is **integer cents** (`printProductPricing.priceInCents`). Refund amounts on `proposals` are cents. Webstore checkout computes in cents via local helpers at `storeCheckout.ts:133-137`.
- **Consistency:** not consistent. Decimal-as-string from Drizzle is routinely pushed through `parseFloat()` (6+ sites), then multiplied against `quantity`, then (sometimes) rounded. There is no project-wide Decimal library; `shared/invoiceMath.ts#round2` exists but is only used by invoice math.
- **Risk:** `parseFloat` on strings like `"12.99"` is fine up to ~$90 T before IEEE-754 precision bites, but aggregates can drift by cents. No reconciliation test between proposal-accept total (client-side at `StripeCheckout.tsx:25`) and webhook-side total (server at `stripe/webhook.ts:147`).

### 6.3 Audit trails

- **`audit_log`** (migration-only SQL). Write path: `server/utils/auditLog.ts` — fire-and-forget raw insert; DB failure logs and continues. 18 action types: auth, stripe, email, SSO, refund, role change, data export, etc. 90 d retention enforced by `jobs/dataRetentionCleanup.ts`.
- **`aiAuditLog`** — Drizzle-declared. Writes by copilot/agent call sites via `routers/copilot.ts`, `_core/aiGatekeeper.ts`.
- **`copilot_task_log`** — append-only for copilot actions (distinct from `aiAuditLog`).
- **`purchaseOrderEvents`** — per-PO timeline.
- **`stripe_webhook_events`** — idempotent log keyed by event id.
- **No automatic middleware** writes audit rows; all writers are explicit.

### 6.4 Feature flags

No runtime toggle system. No `FEATURE_*` env scan patterns. Gating is done by:
- `users.subscriptionTier` checks (e.g. `assertEnterpriseTier` in `routers/divisions.ts`).
- `utils/planLimits.ts` — plan-based caps on proofing renders, proposals, stores.
- Hard-coded constants inside jobs: `INITIAL_DELAY_MS`, trigger thresholds in `jobs/agentCron.ts`.
- Boolean columns on `stores` (`multiDepartment`, `rbacEnabled`, `ssoEnabled`, `requireAuth`) — per-store feature switches, not org-wide flags.

### 6.5 Error handling

- **Shared class:** `shared/_core/errors.ts` exports `HttpError` with `statusCode` + convenience subclasses (`BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`).
- **tRPC layer:** routers throw `TRPCError` with `code: "INTERNAL_SERVER_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED"`. Both patterns co-exist.
- **Express routes** (`routes/*.ts`, e.g. `files.ts`, `publicProposal.ts`, `unsubscribe.ts`): mix of `HttpError` and `TRPCError`. No consistent wrapper.
- **Sentry:** initialized at server boot (`_core/index.ts:5-7`) and captures via `sentryErrorHandler` at end of middleware chain.

---

## 7. Known debt / landmines (catalog only)

### 7.1 Schema drift

- Duplicate migrations `0025_*` and `0026_*` (see §2.1). Idempotent; runs clean but brittle.
- `audit_log` table created by SQL, missing from `drizzle/schema.ts`.
- `drizzle/relations.ts` empty (TODO inside the file).
- `estimates.lineItems` JSON — marked DEPRECATED but still read in some paths (`routers/estimatesInvoices.ts:256`: `TODO(estimate-builder): This handler still writes line items to the old schema`).
- `clients.contactName/contactEmail/contactPhone/contactTitle` — legacy mirror of `clientContacts` primary row; both read.
- `stores.divisions` JSON vs normalized `divisions` table — parallel representations, no sync.

### 7.2 "Coming soon" in production code paths

- `server/routers/purchaseOrders.ts:483` — supplier PO email dispatch shows "Email sending is coming soon…".
- `server/routers/storeCheckout.ts:353-365` — "Payment setup coming soon" fallback for distributors without Stripe Connect onboarded.

### 7.3 TODO / FIXME / HACK in critical paths

- `server/queue/bullmq.ts:9` — `TODO(Phase 8): first real queues/workers register here`. BullMQ present in deps, connected, but runs nothing.
- `server/_core/index.ts:348` — `TODO(Phase 8): once async agent tools depend on BullMQ, promote this to` (fail-fast on Redis). Currently Redis outage doesn't prevent boot.
- `server/routers/aiInsights.ts:13` — `TODO: Add Redis caching for dashboardSummary` (hot query runs uncached).
- `server/routers/departmentApprovals.ts:288` — `@deprecated Use buildDeptApprovalRequestEmail from emailTemplates.ts`. Old email builder still used somewhere.
- `server/socialAuthCallbacks.ts:91`, `server/routers/onboarding.ts:116` — `"Create distributor profile placeholder"`.
- `server/routers/proofing.ts:336,475,590` — placeholder-image URL filters (flaticon.com, via.placeholder.com). Dev artifact.

### 7.4 Dead / orphaned code

- `server/routers/copilot.ts.bak` and `server/routers/copilot.ts.fix-all.bak` — backup files checked into git.
- `server/_core/llm.ts.bak`, `server/_core/llm.ts.bak2`, `server/_core/llmConfig.ts.bak`, `server/_core/vite.ts.bak` — more `.bak` files in `_core`.
- `routers/waitlist.ts` + `waitlist` table — zero upstream callers (mount still present in `routers.ts:97`).
- Repo-root one-off scripts: `fix-bypass.cjs`, `fix-content-format.cjs`, `fix-copilot.cjs`, `fix-final.cjs`, `fix-null-content.cjs`, `fix-toolcall.cjs`, `fix-type.cjs`, `fix-image-url.sh`, `fix-product-detail.sh`, `fix-products.py`, `fix_guide2.py`, `patch.cjs`, `trace.cjs`, `debug-llm.cjs`, `find-paths.sh`/`find-paths2.sh`/`find-paths3.sh`, `diagnose-app.sh`/`diagnose2.sh`/`diagnose3.sh`, `check_proposal.mjs`, `gen_store_session.mjs`, `add-product-detail.sh`, `seed_employees.mjs`, `update-product-image.sh`.
- Repo-root ad-hoc docs: `CHANGELOG_FK_AND_SMTP.md`, `CHANGELOG_PCI_GAPS_AUDIT.md`, `CHANGELOG_SPRINT2_HARDENING.md`, `CHANGELOG_SSO.md`, `CHANGELOG_v10_REFACTORING_AND_ACCESS_CONTROL.md`, `CHANGELOG_v8_POLISH.md`, `CHANGELOG_v9_BUDGET_AND_CLEANUP.md`, `REVIEW_RESPONSE.md`, `CAPACITY_REPORT.md`, `MergeTasks_API_Handover.md`, `MergeTasks_Annotated_Source_Map.md`, `MergeTasks_Developer_Progress_Log.md`, `MergeTasks_OVH_Deployment_Guide.md` (OVH predates EC2), `copilot-audit.md`, `ideas.md`, `marketing-ideas.md`, `todo.md` (76 KB), `video_IMG_0400_analysis_20260404_154544.md`.
- `docker-compose.presidio.yml` — Presidio PII redaction service (see `utils/presidioClient.ts`); unknown whether still run.
- `.env.backup-20260421-020715` — recent, untracked; not in `.gitignore`.

### 7.5 Duplicate logic

- Pricing fallback `customPrice ?? basePrice` repeated 6× across server + client (see §4.4).
- Subtotal `Σ unitPrice × quantity` repeated in webstore checkout, proposal webhook, and client-side proposal checkout.
- Cents conversion helpers (`priceToCents`, `centsToDecimal`) defined locally in `storeCheckout.ts`, not exported.

### 7.6 Test file location

- 30+ `*.test.ts` files live at the top of `server/` (not in a `__tests__` dir, not co-located with source). Examples: `server/proposalWorkflow.test.ts`, `server/stress50.test.ts`, `server/paymentStress.test.ts`, `server/security.test.ts`, `server/aiStressTest.test.ts`, `server/publicProposal.test.ts`. Inconsistent with the `routers/` subdirectory split.

### 7.7 Environmental / docs inconsistencies

- `README.md` lists OpenAI SDK ("Anthropic + OpenAI"). `package.json` has **no** `openai` dep. Voice transcription implementation was not read in detail; may use a non-OpenAI provider.
- `ARCHITECTURE.md` mentions `pino` as the logger; actual logger is `server/utils/logger.ts` — verify in detail whether `pino` is used or a custom impl (not confirmed here).
- `MergeTasks_OVH_Deployment_Guide.md` refers to OVH; current deploy is EC2 per `DEPLOYMENT_GUIDE.md`.

---

## 8. Questions the audit surfaced

- Two `0025` + two `0026` migrations — was this intentional (parallel feature branches merging) or an accidental renumbering that was never reconciled?
- `audit_log` is PCI-critical but lives outside `schema.ts`. Was this deliberate (to keep `GRANT` semantics different) or an oversight?
- `clients.organizationId` and `stores.organizationId` are nullable, handled by a `userId` fallback in `orgScope`. Is there still a plan to back-fill, or is the dual-mode permanent?
- Two division representations coexist (`stores.divisions` JSON vs normalized `divisions` table). Which is source of truth in multi-division workflows?
- `departmentApprovals` stores department name as a string. If a proposal's approving department is later renamed in `storeDepartments`, historical approvals keep the old label — intentional for audit, or an artifact?
- Pricing decisions: PDP evaluates `products.pricingTiers` JSON; checkout uses flat `storeProducts.customPrice`. Is the PDP display purely decorative, or is the mismatch considered a bug?
- Proposal acceptance charges from `proposalOrderItems.unitPrice` with no re-validation against `proposalPriceTiers`. Is the tier table intended to be advisory-only post-accept?
- `subscriptionTier` enum is `free|pro|enterprise`; `stripe/products.ts` may define a different plan list (not confirmed here). Confirm which is authoritative.
- BullMQ is wired but unused. Was the Phase 8 plan already moved, or is this still the target for async tools?
- Voice transcription exists (`_core/voiceTranscription.ts`, `voiceTts.ts`) — which provider? Not confirmed without reading file.
- `.bak` files in source: are any still referenced, or is it safe to delete the whole class?
- `docker-compose.presidio.yml` + `utils/presidioClient.ts` — is Presidio still running in any environment?
- `waitlist` router still mounted (`routers.ts:97`) despite zero callers — kept as a public endpoint, or an oversight?
- `distributorProfiles` is created as a "placeholder" in social auth (`socialAuthCallbacks.ts:91`) — what completes it?
- `linkedStoreId` self-FK on `stores` — used for division child-stores, popup-store cloning, or both?
- `stripeConnectOnboardingComplete` vs `stripeConnectPayoutsEnabled` vs `stripeConnectChargesEnabled` — three booleans for overlapping Connect state. Which combinations are valid and which are undefined?
- `stores` has 80+ columns spanning 6 concerns (config, branding, AI content, editor overrides, approval workflow, popup window). Single wide table is by design or accreted?

---

*End of audit. 65 tables in schema. 50 tRPC sub-routers. 80 numbered migrations. 30+ top-level test files. Single-process Node server under pm2 on EC2, nginx fronted, MySQL + Redis sidecars, S3 for media.*
