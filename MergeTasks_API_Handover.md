# MergeTasks v8 — API Credentials & Secrets Handover

This document outlines every third-party API and cryptographic secret required to run MergeTasks in production. It explains the difference between sandbox (test) keys and live (production) keys, where to get them, and how the developer should configure them.

---

## 1. Cryptographic Secrets (Required)

These are not third-party APIs, but they are critical for security. Do not reuse development secrets in production.

| Variable Name | Purpose | Developer Instructions |
|---------------|---------|------------------------|
| `SESSION_SECRET` | Signs the express-session cookies. | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` to generate a secure random 64-character hex string. Paste it into `.env`. |
| `CREDENTIAL_ENCRYPTION_KEY` | Encrypts OAuth tokens (Google/Microsoft) and SMTP passwords at rest in the database. | Generate another secure 32-byte hex string using the same command as above. |

---

## 2. Transactional Email (Required)

MergeTasks uses magic links and 2FA codes for login. **If SMTP is not configured, users cannot log in.**

| Variable Name | Purpose | Developer Instructions |
|---------------|---------|------------------------|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Sends system emails (invites, password resets, receipts). | **Sandbox:** You can use Mailtrap (mailtrap.io) to catch emails during testing. <br><br> **Live:** Use SendGrid, AWS SES, or a Google Workspace App Password. Enter the credentials into `.env`. Set `SMTP_FROM` to a legitimate address (e.g., `noreply@yourdomain.com`). |

---

## 3. Stripe (Required for Billing & Store Checkout)

Stripe handles both the distributor's SaaS subscription and the end-user payments on webstores (via Stripe Connect).

| Variable Name | Purpose | Developer Instructions |
|---------------|---------|------------------------|
| `STRIPE_SECRET_KEY` | Authenticates backend API calls to Stripe. | **Sandbox:** Starts with `sk_test_...`. Found in the Stripe Dashboard with "Test mode" toggled ON. <br><br> **Live:** Starts with `sk_live_...`. Found in the Stripe Dashboard with "Test mode" toggled OFF. **The app will crash if a test key is used when `NODE_ENV=production`.** |
| `STRIPE_WEBHOOK_SECRET` | Verifies that incoming webhooks actually came from Stripe. | **Sandbox:** Use the Stripe CLI: `stripe listen --forward-to localhost:5000/api/webhook`. The CLI will print a secret starting with `whsec_...`. <br><br> **Live:** Go to Stripe Dashboard > Developers > Webhooks. Add an endpoint pointing to `https://yourdomain.com/api/webhook`. Reveal the signing secret (`whsec_...`) and paste it into `.env`. |

---

## 4. OpenAI (Required for AI Copilot)

Powers the AI Assistant, product curation, and automated insights.

| Variable Name | Purpose | Developer Instructions |
|---------------|---------|------------------------|
| `OPENAI_API_KEY` | Authenticates calls to GPT-4o. | Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Create a new secret key. There is no separate "test" key for OpenAI; you use the same key format for dev and prod, but you should create a dedicated key named "MergeTasks Production" so you can track its usage and revoke it if compromised. |

---

## 5. Redis (Highly Recommended for Production)

Required for persistent rate limiting and session revocation across multiple server instances or restarts.

| Variable Name | Purpose | Developer Instructions |
|---------------|---------|------------------------|
| `REDIS_URL` | Connection string for Redis. | Install Redis on your OVH server (`sudo apt install redis-server`) or use a managed service like Upstash. Format: `redis://localhost:6379` or `rediss://user:password@host:port`. |

---

## 6. Optional Integrations

### Google & Microsoft OAuth (Social Login & Email Sync)
- **Variables:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- **Setup:** Create an OAuth app in Google Cloud Console and Azure Portal. Ensure the authorized redirect URIs match your production domain exactly (e.g., `https://yourdomain.com/api/auth/google/callback`).

### AWS S3 (File Storage)
- **Variables:** `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **Setup:** Create an S3 bucket with public read access for uploaded images. Create an IAM user with programmatic access and attach an S3 write policy.

### Supplier APIs (PromoStandards)
- **Variables:** `PS_SANMAR_USERNAME`, `PS_ALPHABRODER_PASSWORD`, etc.
- **Setup:** Request production API credentials from each respective supplier. These are usually provided by the supplier's IT or sales team after signing an agreement.
