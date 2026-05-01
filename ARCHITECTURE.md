# MergeTasks Architecture

> A full-stack TypeScript SaaS platform for promotional-products distributors.
> Distributors create branded webstores, manage proposals, and fulfill orders for their clients.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, Radix UI (shadcn/ui) |
| Backend | Express, tRPC 11 (end-to-end type safety) |
| Database | MySQL via Drizzle ORM |
| Auth | JWT (access + refresh), OAuth 2.0, SAML 2.0, OIDC |
| AI | Anthropic Claude (via `safeLLM` abstraction) |
| Payments | Stripe (subscriptions + Connect for distributor payouts) |
| Email | Nodemailer (Gmail OAuth, Outlook OAuth, SMTP) |
| Monitoring | Sentry (client + server) |
| Testing | Vitest (unit/integration), Playwright (E2E) |

---

## Directory Structure

```
mt-test/
├── client/                     # React SPA
│   └── src/
│       ├── _core/              # Auth hooks, route config
│       ├── components/         # Reusable UI components
│       │   ├── ui/             # shadcn/ui primitives (Button, Dialog, etc.)
│       │   ├── dashboard/      # Dashboard-specific components
│       │   ├── proposal/       # Proposal workflow components
│       │   ├── webstore/       # Webstore creation wizard steps
│       │   ├── settings/       # Settings tab panels
│       │   ├── curation/       # Product curation/import
│       │   ├── proofing/       # Virtual proofing components
│       │   ├── marketing/      # Marketing/landing page components
│       │   └── motion/         # Animation wrappers (Framer Motion)
│       ├── contexts/           # React contexts (Theme, Cart, WebstoreTheme)
│       ├── hooks/              # Custom hooks (useAuth, usePersistFn, useMobile)
│       ├── lib/                # Client utilities (trpc client, logger, sentry)
│       ├── pages/              # Page-level components (one per route)
│       │   ├── StoreManagement/ # Store management tabs
│       │   └── webstore/       # Public webstore pages + utilities
│       └── utils/              # Shared client utilities
│
├── server/                     # Express + tRPC backend
│   ├── _core/                  # Server infrastructure
│   │   ├── index.ts            # Express app bootstrap (middleware, TLS, CORS)
│   │   ├── trpc.ts             # tRPC router/procedure definitions
│   │   ├── context.ts          # Request context (auth, org, user)
│   │   ├── env.ts              # Environment variable validation
│   │   ├── safeLLM.ts          # LLM abstraction with privacy pipeline
│   │   ├── aiGatekeeper.ts     # AI content filtering & PII redaction
│   │   ├── imageGeneration.ts  # AI image generation service
│   │   ├── voiceTranscription.ts # Whisper transcription service
│   │   ├── notification.ts     # In-app notification system
│   │   ├── oauth.ts            # OAuth provider configuration
│   │   ├── cookies.ts          # Secure cookie management
│   │   ├── sdk.ts              # SDK/client initialization
│   │   └── vite.ts             # Vite dev server middleware
│   │
│   ├── routers/                # tRPC routers (API endpoints)
│   │   ├── copilotExec/        # AI copilot tool executors
│   │   ├── copilotServices/    # Copilot support services
│   │   ├── email/              # Email-related routers
│   │   └── storeUserProvisioning/ # Store user management
│   │
│   ├── routes/                 # Express REST routes (non-tRPC)
│   │   └── publicProposal/     # Public proposal viewing endpoints
│   │
│   ├── utils/                  # Server utilities
│   │   ├── agentTriggers.ts    # AI agent event triggers
│   │   ├── agentActions.ts     # Agent action runner (LLM → pending actions)
│   │   ├── agentMemory.ts      # Agent memory/context retrieval
│   │   ├── logger.ts           # Structured logger (pino)
│   │   ├── encryption.ts       # AES-256-GCM encryption utilities
│   │   ├── orgScope.ts         # Multi-tenant query scoping
│   │   └── ...                 # Security utils (CSRF, rate limiting, etc.)
│   │
│   ├── jobs/                   # Background jobs
│   │   └── agentCron.ts        # Periodic agent scan (low-engagement stores)
│   │
│   ├── stripe/                 # Stripe integration
│   │   ├── products.ts         # Product/price management
│   │   └── webhook.ts          # Stripe webhook handler
│   │
│   ├── email/                  # Email templates & mailer
│   ├── integrations/           # External service adapters (ASI, PromoStandards)
│   └── db/                     # Database utilities
│
├── shared/                     # Code shared between client and server
│   ├── types.ts                # Re-exports from drizzle/schema
│   ├── const.ts                # Shared constants (cookie names, token TTLs)
│   └── _core/
│       └── errors.ts           # HttpError class hierarchy
│
├── drizzle/                    # Database migrations
│   ├── schema.ts               # Drizzle table definitions (source of truth)
│   └── meta/                   # Migration metadata
│
├── scripts/                    # CLI scripts (seed, migrate)
├── e2e/                        # Playwright E2E tests
└── patches/                    # Dependency patches
```

---

## Key Architecture Patterns

### 1. tRPC End-to-End Type Safety

All client-server communication uses tRPC. The client imports router types directly — no codegen, no REST schemas.

```
client/src/lib/trpc.ts          → tRPC client setup
server/_core/trpc.ts            → router + procedure definitions
server/routers/*.ts             → individual routers
```

**Adding a new endpoint:**
1. Create or extend a router in `server/routers/`
2. Use `protectedProcedure` (authenticated) or `publicProcedure`
3. Import and merge in `server/_core/trpc.ts`
4. Call from client: `trpc.yourRouter.yourProcedure.useQuery()` / `.useMutation()`

### 2. Multi-Tenancy via Organization Scoping

Every database query is scoped to the user's organization using `getOrgScope(ctx)`:

```typescript
const scope = getOrgScope(ctx);
const rows = await db.select().from(stores).where(scope.stores);
```

The `scope` object contains pre-built Drizzle `where` clauses for each table. This ensures data isolation between organizations.

### 3. AI Pipeline (Copilot System)

The AI copilot has three layers:

1. **Chat Interface** — `GlobalAIAssistant.tsx` + `DashboardAIChat.tsx` on the client
2. **Tool Execution** — `server/routers/copilot.ts` dispatches to specialized executors in `copilotExec/`
3. **Agent System** — Autonomous agents that fire on platform events:
   - `agentTriggers.ts` — Event hooks (store created, custom order, low engagement)
   - `agentActions.ts` — LLM call + pending action creation
   - `agentMemory.ts` — Historical context from training data
   - `agentCron.ts` — Periodic low-engagement scan
   - `AgentInbox.tsx` — Human review UI for agent proposals

**Privacy Pipeline** (5 layers):
1. Input sanitization (`aiGatekeeper.ts`)
2. PII redaction (Presidio, optional)
3. Content filtering
4. Output validation
5. Audit logging (`aiTrainingData` table)

### 4. Webstore System

Distributors create branded webstores for their clients:

- **Creation Wizard** — `CreateWebstore.tsx` (9-step wizard)
- **Theme System** — `storeThemeUtils.ts` derives visual theme from AI branding fields
- **Public Store** — `LiveStore.tsx` renders the buyer-facing storefront
- **Cart** — `CartContext.tsx` with localStorage persistence
- **SSO** — `StoreSsoSettings.tsx` for enterprise SAML/OIDC login

### 5. Proposal Workflow

1. **Create** — `CreateProposal.tsx` (6-step wizard with optional dept routing)
2. **Proof** — `VirtualProofing.tsx` (AI-generated product mockups)
3. **Review** — `ProposalDetail.tsx` (detail view with send/approve)
4. **Send** — Email delivery via connected provider
5. **Accept** — Public proposal view + department approval flow

### 6. Database Schema (Drizzle ORM)

The schema is defined in `drizzle/schema.ts`. Key tables:

| Table | Purpose |
|---|---|
| `users` | Platform users (distributors) |
| `organizations` | Multi-tenant orgs |
| `orgMembers` | Org membership + roles |
| `clients` | Distributor's client companies |
| `products` | Product catalog |
| `proposals` | Proposals with status workflow |
| `proposalProducts` | Products within proposals |
| `stores` | Branded webstores |
| `storeProducts` | Products assigned to stores |
| `orders` | Store orders |
| `orderItems` | Line items within orders |
| `virtualProofs` | AI-generated product proofs |
| `copilotConversations` | AI chat history |
| `copilotPendingActions` | Agent proposals awaiting review |
| `aiTrainingData` | LLM interaction audit log |

---

## How to Add a New Feature

### New tRPC Endpoint

1. Create `server/routers/yourFeature.ts`
2. Define router with input validation (Zod) and org scoping
3. Register in `server/_core/trpc.ts` (add to `appRouter`)
4. Call from client using `trpc.yourFeature.procedure.useQuery()`

### New Page

1. Create `client/src/pages/YourPage.tsx`
2. Add route in `client/src/App.tsx`
3. Add sidebar link in `client/src/components/Sidebar.tsx`
4. Use `DashboardLayout` wrapper for consistent layout

### New Database Table

1. Add table definition in `drizzle/schema.ts`
2. Run `npm run db:push` to apply migration
3. Create router with CRUD procedures
4. Add org scoping via `getOrgScope()`

### New AI Copilot Tool

1. Create executor in `server/routers/copilotExec/copilotExec{Name}.ts`
2. Register tool definition in `server/routers/copilotToolDefs.ts`
3. Add dispatch case in `server/routers/copilotTools.ts`

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `SENTRY_DSN` | Sentry error tracking |
| `GOOGLE_CLIENT_ID/SECRET` | Gmail OAuth |
| `AZURE_CLIENT_ID/SECRET` | Outlook OAuth |
| `ENCRYPTION_KEY` | AES-256 key for credential encryption |

---

## Development Commands

```bash
npm run dev          # Start dev server (client + server with HMR)
npm run build        # Production build (Vite + esbuild)
npm run start        # Run production build
npm run check        # TypeScript type check (tsc --noEmit)
npm run test         # Run unit/integration tests (Vitest)
npm run e2e          # Run E2E tests (Playwright)
npm run db:push      # Apply database migrations
npm run seed         # Seed database with sample data
npm run format       # Format code with Prettier
```

---

## Migration Notes

- **Database**: Drizzle ORM supports MySQL, PostgreSQL, and SQLite. To switch providers, update `drizzle.config.ts` and connection setup in `server/db/`.
- **LLM Provider**: All LLM calls go through `safeLLM()` in `server/_core/safeLLM.ts`. Swap the underlying provider there.
- **Email**: The email system supports Gmail OAuth, Outlook OAuth, and generic SMTP. Provider configuration is per-user.
- **Payments**: Stripe is deeply integrated. Stripe Connect handles distributor payouts. See `server/stripe/` and `server/routers/billing.ts`.
