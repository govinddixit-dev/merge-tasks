# MergeTasks v8 — Annotated Source Map & Codebase Guide

This document serves as the definitive map of the MergeTasks codebase for incoming developers. It explains the architectural boundaries, the purpose of each directory, and where specific business logic lives. There is no "magic" or hidden technical debt — everything is documented here.

## 1. High-Level Architecture

MergeTasks is a monolithic full-stack application built on the **PERN stack** (PostgreSQL/MySQL, Express, React, Node.js) but using modern tooling:
- **Frontend**: React 18 + Vite + Tailwind CSS + Framer Motion
- **Backend**: Node.js + Express + tRPC (for type-safe API calls)
- **Database**: MySQL 8.0 (via PlanetScale/TiDB) + Drizzle ORM
- **Build System**: Vite (client) + ESBuild (server)

The codebase is divided into three main roots:
1. `client/` — The React frontend
2. `server/` — The Express/tRPC backend
3. `drizzle/` — Database schema and migrations

---

## 2. The Database (`drizzle/`)

MergeTasks uses Drizzle ORM for type-safe database access. The schema is the source of truth for the entire application.

| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `drizzle/schema.ts` | The master database schema. Contains all table definitions (users, clients, stores, products, proposals, etc.). If you need to add a column, add it here first. |
| `drizzle/relations.ts` | Defines the foreign key relationships (one-to-many, many-to-many) for Drizzle's query builder. |
| `drizzle/migrations/` | Automatically generated SQL migration files. Generated via `pnpm db:push` or `drizzle-kit generate`. |

**Developer Rule:** Never write raw SQL `CREATE TABLE` statements. Always update `schema.ts` and run `npx drizzle-kit generate` to create the migration.

---

## 3. The Backend (`server/`)

The backend is an Express server that primarily serves tRPC endpoints. It is located in the `server/` directory.

### Core Infrastructure (`server/_core/` and `server/utils/`)
| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `server/_core/index.ts` | **The true entrypoint.** Bootstraps Express, attaches security middleware (helmet, CORS, rate limiting), and mounts the tRPC router. Do not use `server/index.ts` (it is deprecated). |
| `server/_core/trpc.ts` | Defines the base tRPC procedures (`publicProcedure`, `protectedProcedure`, `adminProcedure`). This is where authentication context is injected. |
| `server/db.ts` | Database connection pool setup. Exports `getDb()` which returns the Drizzle instance. |
| `server/utils/orgScope.ts` | **CRITICAL:** Contains `buildOrgScope()` and `buildToolScope()`. These functions enforce multi-tenancy. Every `UPDATE` or `DELETE` query must use these to prevent data leakage between organizations. |
| `server/utils/auditLog.ts` | PCI-DSS compliant audit logging system. Used to track sensitive actions (logins, purchases, store approvals). |

### The API Layer (`server/routers/`)
MergeTasks uses tRPC, meaning there are no traditional REST controllers (except for webhooks). Everything is a "router" exporting procedures.

| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `server/routers.ts` | The root router that combines all sub-routers into the single `appRouter`. |
| `server/routers/stores*.ts` | Logic for managing Webstores (creation, editing, approval workflows, catalog management). |
| `server/routers/storeCheckout.ts` | Handles the end-user checkout process on a webstore, including price validation and order creation. |
| `server/routers/proposals*.ts` | Logic for creating, editing, and sending sales proposals to clients. |
| `server/routers/copilot*.ts` | The AI Assistant infrastructure. Handles tool calling, permissions, and pending action approvals. |
| `server/routers/billing.ts` | Stripe subscription management for the distributor (the MergeTasks user). |

### External Integrations (`server/stripe/` and `server/email/`)
| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `server/stripe/webhook.ts` | **REST Endpoint.** Listens for Stripe events (successful payments, subscription changes) and updates the database. Uses raw body parsing for signature validation. |
| `server/email/mailer.ts` | Nodemailer configuration. Handles sending transactional emails (invites, 2FA, receipts). |
| `server/email/emailTemplates/` | React-based email templates rendered to HTML strings before sending. |

---

## 4. The Frontend (`client/`)

The frontend is a standard Vite + React application.

### Entry & Routing (`client/src/`)
| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `client/src/main.tsx` | React DOM entrypoint. Sets up the tRPC Provider, QueryClient, and ThemeProvider. |
| `client/src/App.tsx` | Wouter configuration. Defines all application routes (public, authenticated, store portal). |
| `client/src/lib/trpc.ts` | The tRPC React hook client. This is how the frontend talks to the backend with full type safety. |

### Pages (`client/src/pages/`)
Top-level route components.

| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `Dashboard.tsx` | The main distributor dashboard (metrics, recent activity). |
| `StoreManagement.tsx` | The tabbed interface for distributors to manage a specific webstore. |
| `Webstores.tsx` | The list view of all webstores owned by the distributor. |
| `ProposalEditor.tsx` | The drag-and-drop interface for building sales proposals. |
| `public-proposal/` | The read-only view that end-clients see when they receive a proposal link. |
| `webstore/` | The actual storefronts that end-users shop on. |

### Components (`client/src/components/`)
Reusable UI pieces.

| File/Directory | Purpose & Developer Notes |
|----------------|---------------------------|
| `ui/` | shadcn/ui components (buttons, inputs, dialogs). Built on Radix UI and Tailwind. Do not modify these unless changing global design systems. |
| `motion/` | Premium Polish animation components (Framer Motion). Includes `FadeIn`, `StaggerGroup`, `TabContent`, and `AnimatedBadge`. Use these instead of raw CSS animations. |
| `layout/` | Structural components like `DashboardLayout.tsx` (sidebar + header) and `Sidebar.tsx`. |
| `GlobalAIAssistant.tsx` | The floating AI Copilot chat interface available on all authenticated pages. |

---

## 5. Security & Technical Debt Rules

To maintain the "zero technical debt" state of v8, incoming developers must adhere to these rules:

1. **Multi-Tenancy is Absolute:** You must never write a `db.select()`, `db.update()`, or `db.delete()` without explicitly filtering by `organizationId` (or `userId` if orgs are not used). Use `buildOrgScope()` from `server/utils/orgScope.ts`.
2. **Server-Side Price Trust Only:** When processing an order (`storeCheckout.ts`), never trust the `unitPrice` sent by the React client. Always query the database (`storeProducts`) to find the canonical price before charging Stripe.
3. **No N+1 Queries:** When loading lists of items (e.g., an order and its products), use `inArray()` to fetch all related records in a single query, then map them in memory.
4. **Use tRPC, Not REST:** Do not add new `app.get()` or `app.post()` routes to Express unless absolutely necessary (e.g., webhooks or file serving). All business logic must go through tRPC routers for type safety.
5. **Animations:** Use the components in `client/src/components/motion/`. Do not write custom `@keyframes` in CSS. All motion components respect `useReducedMotion()` automatically.
