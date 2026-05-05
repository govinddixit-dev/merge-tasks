# MergeTasks Developer Progress Log

This log is designed for the development team to track ongoing maintenance, feature additions, and bug fixes across the MergeTasks v8 codebase. It is organized by architectural domain to ensure that cross-cutting concerns (like database migrations) are documented alongside their corresponding API and UI changes.

Developers should duplicate the template row and fill it out for every pull request or significant commit.

---

## 1. Database & Schema Changes (`drizzle/`)
*Log any modifications to table structures, new indices, or data migrations.*

| Date | Developer | Schema File Modified | Migration Generated? | Description of Change | PR / Issue # |
|------|-----------|----------------------|----------------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *e.g., `schema.ts`* | *Yes/No* | *Added `stripeSubscriptionId` to `users` table.* | *#123* |
| | | | | | |
| | | | | | |

---

## 2. Core Infrastructure & Security (`server/_core/`, `server/utils/`)
*Log changes to rate limiting, orgScope guards, audit logging, or tRPC middleware.*

| Date | Developer | File Modified | Security Impact | Description of Change | PR / Issue # |
|------|-----------|---------------|-----------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *e.g., `orgScope.ts`* | *High/Low/None* | *Added `buildToolScope()` to enforce org boundaries in Copilot executors.* | *#124* |
| | | | | | |
| | | | | | |

---

## 3. Backend API Routers (`server/routers/`)
*Log additions or modifications to tRPC procedures, external API integrations, or webhook handlers.*

| Date | Developer | Router File | Procedure Modified | Description of Change | PR / Issue # |
|------|-----------|-------------|--------------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *e.g., `storeCheckout.ts`* | *`processOrder`* | *Fixed N+1 query issue by batch loading product prices before checkout.* | *#125* |
| | | | | | |
| | | | | | |

---

## 4. Frontend UI & Motion (`client/src/components/`, `client/src/pages/`)
*Log new React components, page layout changes, or Framer Motion animation updates.*

| Date | Developer | Component / Page | Motion Impact? | Description of Change | PR / Issue # |
|------|-----------|------------------|----------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *e.g., `DashboardLayout.tsx`* | *Yes* | *Replaced CSS page transitions with `AnimatePresence` cross-fade.* | *#126* |
| | | | | | |
| | | | | | |

---

## 5. Third-Party Integrations (Stripe, OpenAI, SMTP)
*Log changes to payment flows, AI prompts, or email templates.*

| Date | Developer | Integration | File Modified | Description of Change | PR / Issue # |
|------|-----------|-------------|---------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *Stripe* | *`webhook.ts`* | *Added handler for `customer.subscription.deleted` to downgrade user tier.* | *#127* |
| | | | | | |
| | | | | | |

---

## 6. DevOps & Deployment (OVH, PM2, Nginx)
*Log changes to server configuration, environment variables, or build scripts.*

| Date | Developer | Environment | Config Modified | Description of Change | PR / Issue # |
|------|-----------|-------------|-----------------|-----------------------|--------------|
| *YYYY-MM-DD* | *Name* | *Production* | *`.env`* | *Swapped Mailtrap SMTP credentials for live SendGrid keys.* | *#128* |
| | | | | | |
| | | | | | |
