# Welcome to MergeTasks

*The operating system for modern promotional products distributorships.*

---

**MergeTasks** was built for one specific kind of business: the promotional products distributorship that's outgrowing spreadsheets, scattered email threads, and PDF proposals. If that sounds like you, welcome — this guide will walk you through everything you need to go live, from your first login to your first paid order.

We'll move through the essentials, pausing to explain the parts that matter most to you as an owner (not as a developer). No jargon. No assumed technical background. Just the shortest path from *signed up* to *running your business on MergeTasks*.

If you get stuck, jump to **Getting Support** at the bottom — a real person will help.

---

## Table of contents

1. [Welcome to MergeTasks](#welcome-to-mergetasks)
2. [Account Setup](#account-setup)
3. [Inviting Your Team](#inviting-your-team)
4. [Connecting Stripe](#connecting-stripe)
5. [Setting Up Your First Workstore](#setting-up-your-first-workstore)
6. [Creating Your First Proposal](#creating-your-first-proposal)
7. [Budget & Department Setup](#budget--department-setup)
8. [AI Features](#ai-features)
9. [Getting Support](#getting-support)
10. [Launch Checklist](#launch-checklist)

---

## Account Setup

The first time you sign in, MergeTasks runs a short onboarding questionnaire. It's not busy work — your answers personalize the dashboard, surface the right AI suggestions, and pre-configure sensible defaults.

**You'll be asked about:**

- **Company size & revenue range** — so we scale recommendations to your stage.
- **Specialties** — apparel decoration, hard goods, drinkware, tech, etc.
- **Markets you serve** — corporate, healthcare, education, government, etc.
- **Your primary goal for the next 90 days** — grow sales, cut admin time, or launch a customer portal.
- **Tools you're migrating from** — so we can import where possible.
- **Branding** — upload your logo and pick your primary brand color. This will appear on proposals, customer-facing stores, and transactional emails.

> **Tip:** You can update any of these later under **Settings → Branding** and **Settings → Profile**. Don't overthink it on day one.

*[screenshot: onboarding welcome step]*

*[screenshot: branding step with logo upload]*

---

## Inviting Your Team

MergeTasks is designed to be collaborative. Sales reps, account managers, production coordinators, and finance teams all work from the same shared workspace — with role-based permissions so nobody sees what they shouldn't.

**To invite a team member:**

1. Go to **Settings → Team**.
2. Click **Invite member**.
3. Enter their email and choose a role:
   - **Owner** — full access, including billing.
   - **Admin** — everything except billing.
   - **Sales Rep** — proposals, clients, and their own pipeline.
   - **Production** — orders, purchase orders, and proofing.
   - **Viewer** — read-only.
4. They'll receive an email invite and will be prompted to set a password (or sign in with Google / Microsoft SSO).

*[screenshot: team invite modal]*

> **Best practice:** Start with 2–3 people. Roles and permissions can be changed later as you learn what each person actually needs access to.

---

## Connecting Stripe

This is the most important step for any distributor planning to accept credit card payments on a customer-facing workstore. Let's walk through it carefully — in plain English.

### What is Stripe, and why do I need it?

**Stripe** is the payment processor MergeTasks uses to securely accept credit cards on your behalf. Think of it as the company that sits between your customer's credit card and your bank account.

**The good news:**

- **You do not need an existing Stripe account.** You can create one inline in under 5 minutes as part of the setup flow.
- **You do not need to be a developer.** Stripe walks you through every step on their own website — we just launch it for you.
- **You do not have to handle any card data.** Customers enter their card on Stripe's secure checkout page. MergeTasks never sees or stores card numbers.

### How payouts work

When a customer pays on your workstore:

1. The payment is charged to their credit card through Stripe.
2. Stripe deposits the money **directly into your bank account** — not ours.
3. **Typical payout timeline: 2 business days** after the charge clears. (Stripe may hold the first few payouts slightly longer while they verify your account — this is normal.)
4. MergeTasks takes a **2% platform fee** per transaction, automatically. No monthly fees, no surprise charges.

> **In short:** You keep 98% of every sale, minus Stripe's standard processing fees (typically 2.9% + 30¢ per transaction — paid to Stripe, not to us).

### What your customers see at checkout

A clean, professional, Stripe-hosted checkout page branded with your company name. Your customer never sees the word "MergeTasks" unless you want them to. They see:

- Your logo and company name at the top.
- A line-item summary of what they're buying.
- Standard Stripe payment form (card, Apple Pay, Google Pay, Link).
- A confirmation email sent from your company's name.

*[screenshot: example Stripe-hosted checkout]*

### Step-by-step: connecting Stripe

**Option A — During onboarding:**

When the onboarding wizard reaches the **Payments** step, click **Connect Stripe account**. A new browser tab will open on Stripe's site. Follow the prompts — Stripe will ask for basic business information (legal name, address, tax ID, bank account). This typically takes 3–5 minutes.

*[screenshot: onboarding Payments step with Connect button]*

**Option B — Later, from Settings:**

1. Go to **Settings → Billing**.
2. Scroll to the **Accept payments** panel.
3. Click **Connect Stripe account**.
4. Complete the Stripe onboarding form in the new tab.
5. Return to MergeTasks — the panel will automatically refresh and show ✅ *Connected*.

*[screenshot: Settings → Billing → Stripe Connect panel]*

### Once connected

- Your workstores can accept credit card payments immediately.
- Every transaction shows up in your **Orders** view with the Stripe charge ID linked.
- Full transaction history lives on your Stripe dashboard (a link is provided in Settings).
- You can issue refunds directly from the MergeTasks order page.

### Stripe FAQ

**Q: I already have a Stripe account for another business — can I reuse it?**
A: Yes. When Stripe prompts you to sign in during the Connect flow, use the existing account's email and password.

**Q: What countries does Stripe support?**
A: Stripe operates in 40+ countries including the US, Canada, UK, EU, and Australia. Full list at stripe.com/global.

**Q: Can I accept payments in multiple currencies?**
A: Yes — your workstore's currency is configurable. Stripe handles currency conversion automatically.

**Q: How do I get paid faster than 2 business days?**
A: Stripe offers **Instant Payouts** for an additional 1% fee. You can enable this in your Stripe dashboard.

**Q: What if I don't want to accept credit card payments?**
A: You can skip this entirely. Your workstore will display a friendly *"Payment setup coming soon"* message, and you can still use MergeTasks for proposals, quotes, and manual invoicing. Connect Stripe later when you're ready.

**Q: Is my financial data safe?**
A: Yes. Stripe is PCI DSS Level 1 certified — the highest level of payment security. MergeTasks never stores card data, and bank details are entered directly on Stripe's secure servers.

---

## Setting Up Your First Workstore

A **workstore** is a branded online storefront — think of it as a private e-commerce site for one specific client. Great for:

- Corporate clients ordering swag for new hires.
- Sports teams and schools running spirit wear stores.
- Franchise groups standardizing branded merchandise across locations.

**To create one:**

1. Go to **Workstores → New workstore**.
2. Give it a name (e.g., *"Acme Corp Employee Store"*) and a slug (the URL: `yourstore.mergetasks.com/acme`).
3. Pick a logo and color scheme — inherits from your brand by default.
4. Add products from your catalog.
5. (Optional) Set up **departments** and **budgets** — see the next section.
6. Click **Publish**.

*[screenshot: new workstore wizard]*

Share the URL with your client. They'll get their own login and can start ordering immediately.

---

## Creating Your First Proposal

Proposals are how you quote and close deals with new and existing clients. MergeTasks proposals are far more than PDFs:

- **Interactive** — the client picks quantities, sizes, and decoration options directly on the proposal.
- **Tracked** — you see the moment they open it, click an item, or submit a decision.
- **Convertible** — accepted proposals become orders with a single click.

**To create one:**

1. Go to **Proposals → New proposal**.
2. Pick or create a client.
3. Use the AI builder (recommended) — describe the job in plain English and let the AI assemble line items, or start from a blank canvas.
4. Add products, specify decoration, set pricing.
5. Click **Send** — the client receives a clean, branded link.

*[screenshot: proposal builder]*

> **Pro tip:** Start with the AI builder. It often finds relevant products in your catalog and drafts a near-final proposal in 30 seconds.

---

## Budget & Department Setup

For larger workstore clients (corporate, franchise, enterprise), you'll want to set up **departments** with **spending budgets**. This prevents overspend and gives your client's finance team full visibility.

**How it works:**

- Create departments inside a workstore (e.g., *Sales*, *Marketing*, *HR*).
- Assign each department a monthly or quarterly budget.
- Assign users to departments.
- When a user tries to place an order that exceeds their department's remaining budget, the order either (a) blocks entirely or (b) routes to a department approver — your choice.

*[screenshot: department budget configuration]*

This is an **Enterprise-tier** feature. See **Settings → Billing** to upgrade.

---

## AI Features

MergeTasks ships with an AI copilot woven throughout the app. Here are the features worth knowing about on day one:

- **AI Proposal Builder** — type a description ("500 heather-gray polos for a trade show, left-chest logo, rush to 10 days"), and MergeTasks drafts the proposal.
- **Dashboard AI Chat** — ask anything: *"Which clients haven't ordered in 60 days?"* or *"What's my gross margin this month?"*
- **Predictive Reorder Alerts** — AI spots which clients are due to reorder based on historical patterns.
- **Churn Signals** — early-warning flags for at-risk clients.
- **Daily Briefing** — a 30-second voice summary of what needs your attention today.
- **Copilot Executors** — natural-language actions (*"create a PO for order #412 from S&S Activewear"*) executed safely with a confirmation step.

AI features require the **Growth** or **Enterprise** plan.

---

## Getting Support

We offer three support channels:

- **In-app chat** — click the chat bubble at the bottom-right of any page. Real humans during business hours; AI assistance 24/7.
- **Email** — support@mergetasks.com. Typical response: under 4 hours on weekdays.
- **Knowledge base** — help.mergetasks.com, searchable, with video walkthroughs.

For Enterprise customers, you also get a dedicated onboarding specialist and a Slack channel.

---

## Launch Checklist

Work through these 10 items before going live. You'll be running on MergeTasks, confidently, by the time you're done.

1. ☐ **Complete the onboarding questionnaire** — all 7 steps.
2. ☐ **Upload your company logo and set your brand colors** (Settings → Branding).
3. ☐ **Invite at least one teammate** and confirm they can log in.
4. ☐ **Connect your Stripe account** and verify the *Connected* badge appears in Settings → Billing.
5. ☐ **Import or add your product catalog** — at minimum, your 20 most-used SKUs.
6. ☐ **Create one test client** and send a test proposal to your own email to verify the end-to-end flow.
7. ☐ **Create one workstore** (even if private/hidden) and place a test order end-to-end.
8. ☐ **Choose your subscription plan** in Settings → Billing. Starter for core features, Growth to unlock AI, Enterprise for SSO and multi-division.
9. ☐ **Set up email forwarding** — update your SPF/DKIM records if you want outbound emails to come from your domain (optional; our team can help).
10. ☐ **Book a 30-minute onboarding call** with our team — email onboarding@mergetasks.com. It's free, and it's the fastest way to go live with confidence.

---

*MergeTasks is built in Montréal with care. Thanks for choosing us.*
