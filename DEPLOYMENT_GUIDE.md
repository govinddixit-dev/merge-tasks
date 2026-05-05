# MergeTasks Deployment Guide

This is the complete, step-by-step guide for deploying MergeTasks to an OVH VPS from scratch. Follow every section in order. Do not skip steps. If a step fails, stop and resolve it before continuing.

The application is a full-stack React + Express + MySQL platform with Redis for rate limiting and session revocation, Stripe for billing, and Resend for transactional email (2FA codes, proposals, invites).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Server Preparation (OVH)](#2-server-preparation-ovh)
3. [Install System Dependencies](#3-install-system-dependencies)
4. [Database Setup (MySQL)](#4-database-setup-mysql)
5. [Redis Setup](#5-redis-setup)
6. [Upload and Install Application](#6-upload-and-install-application)
7. [Environment Configuration](#7-environment-configuration)
8. [Run Database Migrations](#8-run-database-migrations)
9. [Build the Application](#9-build-the-application)
10. [Verify Resend Before Going Live](#10-verify-resend-before-going-live)
11. [Process Management (PM2)](#11-process-management-pm2)
12. [DNS Configuration (GoDaddy)](#12-dns-configuration-godaddy)
13. [Nginx Reverse Proxy + SSL](#13-nginx-reverse-proxy--ssl)
14. [Post-Deploy Verification Checklist](#14-post-deploy-verification-checklist)
15. [Monitoring and Health Checks](#15-monitoring-and-health-checks)
16. [Platform Admin Dashboard](#16-platform-admin-dashboard)
17. [Updating to a New Version](#17-updating-to-a-new-version)
18. [Troubleshooting](#18-troubleshooting)
19. [Environment Variables Reference](#19-environment-variables-reference)
20. [Migration Files Reference](#20-migration-files-reference)

---

## 1. Prerequisites

Before you begin, confirm you have all of the following:

| Requirement | Details |
|---|---|
| **OVH VPS** | Ubuntu 22.04 LTS, minimum 2 vCPU / 4 GB RAM / 40 GB SSD |
| **Domain** | `mergetasks.com` on GoDaddy (or your registrar) |
| **SSH access** | Root or sudo user on the OVH VPS |
| **Source code** | The latest `mergetasks-*.zip` archive |
| **Resend API Key** | For transactional email. Get from https://resend.com/api-keys |
| **OpenAI API Key** | For AI copilot. Get from https://platform.openai.com/api-keys |
| **Stripe Keys** (optional) | For subscription billing. Get from https://dashboard.stripe.com/apikeys |
| **Sentry DSN** (optional) | For error tracking. Free at https://sentry.io |

**Critical warning**: Login requires a working Resend configuration. If email delivery fails, users cannot receive verification codes and cannot sign in. Do not skip the Resend verification step.

---

## 2. Server Preparation (OVH)

Connect to your server via SSH:

```bash
ssh root@YOUR_OVH_IP
```

Create a deploy user (do not run the app as root):

```bash
adduser mergetasks
usermod -aG sudo mergetasks
su - mergetasks
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 3. Install System Dependencies

Install Node.js 22.x, pnpm, MySQL, Redis, Nginx, and Certbot:

```bash
# Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # should print v22.x.x

# pnpm
sudo npm install -g pnpm

# MySQL 8
sudo apt install -y mysql-server

# Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify Redis
redis-cli ping   # should print PONG

# Nginx
sudo apt install -y nginx

# Certbot (SSL)
sudo apt install -y certbot python3-certbot-nginx

# PM2 (process manager)
sudo npm install -g pm2
```

---

## 4. Database Setup (MySQL)

Secure MySQL and create the application database:

```bash
sudo mysql_secure_installation
```

Then create the database and user:

```bash
sudo mysql
```

```sql
CREATE DATABASE mergetasks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mergetasks'@'localhost' IDENTIFIED BY 'GENERATE_A_STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON mergetasks.* TO 'mergetasks'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Save this password** — you will need it for `DATABASE_URL` in the `.env` file.

Test the connection:

```bash
mysql -u mergetasks -p mergetasks -e "SELECT 1;"
```

---

## 5. Redis Setup

Redis should already be running from step 3. Verify:

```bash
redis-cli ping
# Expected: PONG
```

If you want to password-protect Redis (recommended for production):

```bash
sudo nano /etc/redis/redis.conf
```

Find and set:
```
requirepass YOUR_REDIS_PASSWORD
```

Then restart:
```bash
sudo systemctl restart redis-server
```

Your `REDIS_URL` will be: `redis://:YOUR_REDIS_PASSWORD@localhost:6379`

If no password: `redis://localhost:6379`

---

## 6. Upload and Install Application

From your local machine, upload the source archive:

```bash
scp mergetasks-*.zip mergetasks@YOUR_OVH_IP:~/
```

On the server:

```bash
cd ~
unzip mergetasks-*.zip -d mergetasks-app
cd mergetasks-app
```

Install dependencies:

```bash
pnpm install
```

This will take 2-5 minutes. Verify it completes without errors.

Create the uploads directory (for file storage):

```bash
mkdir -p uploads
```

---

## 7. Environment Configuration

Copy the example and fill in every required value:

```bash
cp .env.example .env
nano .env
```

**You must set every variable marked `[REQUIRED]`.** Here is the minimum viable configuration:

```env
# App
NODE_ENV=production
VITE_APP_ID=mergetasks
PORT=3000
APP_BASE_URL=https://app.mergetasks.com
APP_URL=https://app.mergetasks.com
ALLOWED_ORIGINS=https://app.mergetasks.com,https://mergetasks.com

# Database
DATABASE_URL=mysql://mergetasks:YOUR_DB_PASSWORD@localhost:3306/mergetasks

# Auth secrets — generate both with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=PASTE_GENERATED_SECRET_HERE
CREDENTIAL_ENCRYPTION_KEY=PASTE_GENERATED_KEY_HERE

# Resend — REQUIRED FOR LOGIN (2FA codes, invites, notifications)
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM=noreply@mail.yourdomain.com

# OpenAI
OPENAI_API_KEY=sk-...

# Redis
REDIS_URL=redis://localhost:6379
```

Generate the secrets now:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('CREDENTIAL_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into your `.env` file.

---

## 8. Run Database Migrations

The migrations must be run **in order**. There are 31 migration files. The safest approach is to push the full schema using Drizzle, then run the two newest migrations manually:

```bash
# Push the base schema (handles migrations 0000-0028 automatically)
pnpm db:push
```

Then run the two new PCI/FK migrations that require manual execution:

```bash
mysql -u mergetasks -p mergetasks < drizzle/0029_pci_lockout_and_audit_fix.sql
mysql -u mergetasks -p mergetasks < drizzle/0030_complete_foreign_keys.sql
```

**What these migrations do:**

| Migration | Purpose |
|---|---|
| `0029` | Adds account lockout columns (`failedLoginAttempts`, `lockedUntil`) to `users` and `storeUsers`. Widens OTP code columns from 6 to 64 chars for SHA-256 hashes. Converts `audit_log.timestamp` from VARCHAR to DATETIME(3). |
| `0030` | Adds 32 missing foreign key constraints with proper CASCADE/SET NULL behavior. Prevents orphaned records on deletes. |

Verify the migrations applied:

```bash
mysql -u mergetasks -p mergetasks -e "SHOW COLUMNS FROM users LIKE 'failedLoginAttempts';"
# Should return one row

mysql -u mergetasks -p mergetasks -e "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA='mergetasks' AND CONSTRAINT_TYPE='FOREIGN KEY' LIMIT 5;"
# Should return FK constraint names
```

---

## 9. Build the Application

```bash
pnpm build
```

This runs two steps:
1. `vite build` — compiles the React frontend into `dist/client/`
2. `esbuild` — bundles the Express server into `dist/index.js`

Verify the build succeeded:

```bash
ls -la dist/index.js
# Should exist and be > 1 MB
```

---

## 10. Verify Resend Before Going Live

**This is the most important pre-launch check.** If Resend is not configured, users cannot receive 2FA codes and cannot sign in.

**Prerequisites:**
1. Create an account at [resend.com](https://resend.com)
2. Add and verify your sending domain (e.g. `mail.mergetasks.com`) under **Domains**
3. Create an API key under **API Keys** and set it as `RESEND_API_KEY` in your `.env`
4. Set `RESEND_FROM` to a verified address on that domain (e.g. `noreply@mail.mergetasks.com`)

**Send a test email:**

```bash
node -e "
const { Resend } = require('resend');
const r = new Resend(process.env.RESEND_API_KEY);
r.emails.send({
  from: process.env.RESEND_FROM || 'noreply@mergetasks.com',
  to: ['your-email@example.com'],
  subject: 'MergeTasks Resend Test',
  html: '<p>If you see this, Resend is working.</p>'
}).then(res => console.log('Sent:', res.data?.id || res.error)).catch(e => console.error('FAILED:', e.message));
"
```

Check your inbox. If the email arrives, Resend is confirmed working. Proceed.

If it fails:
- Verify the domain is confirmed in the Resend dashboard (DNS propagation can take up to 48 hours)
- Confirm `RESEND_API_KEY` starts with `re_`
- Confirm `RESEND_FROM` uses the exact verified domain address
- Check the Resend dashboard logs for delivery errors

---

## 11. Process Management (PM2)

Start the application with PM2:

```bash
pm2 start dist/index.js --name "mergetasks" --env production
```

Verify it is running:

```bash
pm2 status
# Should show "mergetasks" with status "online"

pm2 logs mergetasks --lines 20
# Should show startup logs without errors
```

Configure PM2 to start on boot:

```bash
pm2 save
pm2 startup
# Follow the printed command (copy-paste and run it)
```

---

## 12. DNS Configuration (GoDaddy)

Log into your GoDaddy account and navigate to DNS management for `mergetasks.com`.

**Do NOT modify any existing MX, TXT, SRV, or CNAME records** related to Outlook/Microsoft 365. Those control your `info@mergetasks.com` email.

Add this record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `app` | `YOUR_OVH_IP` | 1 Hour |

This creates `app.mergetasks.com` pointing to your server.

Verify DNS propagation (may take 5-30 minutes):

```bash
dig app.mergetasks.com +short
# Should return your OVH IP
```

---

## 13. Nginx Reverse Proxy + SSL

Create the Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/mergetasks
```

Paste this configuration:

```nginx
server {
    server_name app.mergetasks.com;

    # Max upload size (for product images, logos)
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-running AI requests
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Serve uploaded files directly (bypasses Node.js for static assets)
    location /uploads/ {
        alias /home/mergetasks/mergetasks-app/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Health check (no auth, no proxy overhead)
    location = /health {
        proxy_pass http://localhost:3000/health;
        proxy_set_header Host $host;
    }
}
```

Enable the site and get SSL:

```bash
# Enable
sudo ln -s /etc/nginx/sites-available/mergetasks /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Restart
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d app.mergetasks.com
```

Certbot will automatically update the Nginx config to handle HTTPS and redirect HTTP to HTTPS.

---

## 14. Post-Deploy Verification Checklist

Run through every item. Do not skip any.

| Step | How to verify | Expected result |
|---|---|---|
| **Health check** | `curl https://app.mergetasks.com/health` | `{"status":"healthy","checks":{"database":"ok","redis":"ok"}}` |
| **Homepage loads** | Open `https://app.mergetasks.com` in browser | Sign-in page renders |
| **Sign up** | Create a new account | Verification code email arrives within 30 seconds |
| **Sign in** | Enter the code from email | Redirected to dashboard |
| **Password policy** | Try signing up with "abc123" | Rejected — must be 12+ chars with uppercase, lowercase, digit, special |
| **Account lockout** | Enter wrong password 10 times | "Account temporarily locked" message |
| **Create a client** | Dashboard → Clients → Add | Client saved |
| **Create a store** | Dashboard → Stores → Create | Store created with slug |
| **Store public page** | Visit `https://app.mergetasks.com/s/YOUR-SLUG` | Store renders publicly |
| **AI copilot** | Type "Show me my clients" in dashboard chat | AI responds with client list |
| **Admin console** | Navigate to `/platform-admin` | Shows signup/MRR metrics (admin only) |

---

## 15. Monitoring and Health Checks

The `/health` endpoint pings both MySQL and Redis and returns:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

If either service is down, it returns HTTP 503 with `"status": "degraded"`.

**Set up uptime monitoring** with any of these free services:
- [UptimeRobot](https://uptimerobot.com) — free for 50 monitors
- [Better Uptime](https://betteruptime.com) — free tier available
- [Cronitor](https://cronitor.io) — free for 5 monitors

Configure them to check `https://app.mergetasks.com/health` every 60 seconds and alert you on 503 or timeout.

**PM2 monitoring:**

```bash
# View real-time logs
pm2 logs mergetasks

# View process metrics
pm2 monit

# Restart if needed
pm2 restart mergetasks
```

**Automated data retention** runs automatically every 6 hours after server startup. It cleans up:
- Expired verification codes (platform and store)
- Used/expired password reset tokens
- Read notifications older than 90 days
- Unread notifications older than 180 days
- Expired store approval tokens

No cron job setup is needed — it runs inside the Node.js process.

---

## 16. Platform Admin Dashboard

As the platform owner, you have access to `/platform-admin` — a dashboard that only users with `role: "admin"` can see. Regular distributors cannot access it.

**What it shows:**

| Metric | Description |
|---|---|
| Total Users | All registered accounts |
| Signups (24h / 7d / 30d) | New registrations over time |
| Active Users (7d / 30d) | Users who signed in recently |
| Churned (30d) | Users active 30-60 days ago but not in the last 30 days |
| MRR | Monthly recurring revenue from paying subscribers |
| Tier Breakdown | Free / Pro / Enterprise counts with active/canceled/past-due status |
| Platform Totals | Total stores, proposals, and orders across all users |
| User List | Paginated, filterable list of all users with last-active timestamps |
| Suspend/Unsuspend | Immediately revoke all sessions and lock any user account |

**To set yourself as admin** (first-time setup):

After your first sign-up, run this SQL to promote your account:

```bash
mysql -u mergetasks -p mergetasks -e "UPDATE users SET role = 'admin' WHERE id = 1;"
```

Then sign out and sign back in. The "Admin Console" link will appear in the sidebar.

---

## 17. Updating to a New Version

When you receive a new source archive:

```bash
# On the server
cd ~/mergetasks-app

# Back up the current version
cp -r . ../mergetasks-backup-$(date +%Y%m%d)

# Upload and extract new version (preserves uploads/ and .env)
# From local: scp mergetasks-new.zip mergetasks@YOUR_OVH_IP:~/
unzip -o ~/mergetasks-new.zip -d ~/mergetasks-app

# Restore your .env (if overwritten)
# cp ../mergetasks-backup-YYYYMMDD/.env .

# Install any new dependencies
pnpm install

# Run any new migrations (check the changelog for migration instructions)
# pnpm db:push
# mysql -u mergetasks -p mergetasks < drizzle/0031_whatever.sql

# Rebuild
pnpm build

# Restart
pm2 restart mergetasks

# Verify
curl https://app.mergetasks.com/health
```

**Always preserve:**
- `.env` — your configuration
- `uploads/` — user-uploaded files
- The MySQL database (never drop it)

---

## 18. Troubleshooting

**"Cannot connect to database"**
```bash
sudo systemctl status mysql
mysql -u mergetasks -p mergetasks -e "SELECT 1;"
# Check DATABASE_URL in .env matches the credentials
```

**"Email delivery failed" / Users can't receive 2FA codes**
```bash
# Test Resend directly
node -e "const {Resend}=require('resend');new Resend(process.env.RESEND_API_KEY).emails.send({from:process.env.RESEND_FROM||'noreply@mergetasks.com',to:['test@example.com'],subject:'Test',html:'<p>Test</p>'}).then(r=>console.log('OK',r.data?.id)).catch(e=>console.error(e.message))"
```
- Confirm `RESEND_API_KEY` is set and starts with `re_`
- Confirm the sending domain is verified in the Resend dashboard
- Confirm `RESEND_FROM` uses an address on the verified domain
- Check the Resend dashboard → Logs for delivery errors and bounce reasons

**"Redis connection refused"**
```bash
redis-cli ping
sudo systemctl status redis-server
# If using a password, verify REDIS_URL includes it
```

**"502 Bad Gateway" from Nginx**
```bash
pm2 status
# If mergetasks is "errored", check logs:
pm2 logs mergetasks --lines 50
# Common cause: PORT mismatch between .env and Nginx proxy_pass
```

**"Account temporarily locked"**
```bash
# Unlock a specific user
mysql -u mergetasks -p mergetasks -e "UPDATE users SET failedLoginAttempts = 0, lockedUntil = NULL WHERE email = 'user@example.com';"
```

**SSL certificate renewal**
Certbot auto-renews via a systemd timer. Verify:
```bash
sudo certbot renew --dry-run
```

---

## 19. Environment Variables Reference

The complete list is in `.env.example`. Here is a summary grouped by criticality:

**Required (server will not function without these):**

| Variable | Example | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Enables production optimizations |
| `DATABASE_URL` | `mysql://user:pass@localhost:3306/mergetasks` | MySQL connection |
| `SESSION_SECRET` | (64+ hex chars) | JWT signing key |
| `CREDENTIAL_ENCRYPTION_KEY` | (64 hex chars) | AES-256 encryption for stored credentials |
| `APP_BASE_URL` | `https://app.mergetasks.com` | Used in email links and redirects |
| `APP_URL` | `https://app.mergetasks.com` | Stripe redirect validation allowlist |
| `TRUSTED_PROXY_COUNT` | `1` | Prevents IP spoofing in X-Forwarded-For |
| `RESEND_API_KEY` | `re_...` | Resend API key for all platform emails (2FA, invites, notifications) |
| `RESEND_FROM` | `noreply@mail.mergetasks.com` | Verified Resend sender address (must be a Resend-verified domain) |
| `OPENAI_API_KEY` | `sk-...` | AI copilot |

**Required in production:**

| Variable | Example | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Rate limiting + session revocation |

**Optional but recommended:**

| Variable | Example | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Subscription billing |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe webhook verification |
| `SENTRY_DSN` | `https://...@sentry.io/...` | Server error tracking |
| `VITE_SENTRY_DSN` | `https://...@sentry.io/...` | Client error tracking |

**Optional (feature-specific):**

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth login |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Gmail send integration |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | Outlook send integration |
| `ASI_API_KEY` / `ASI_ACCOUNT_ID` | ASI ESP product search |
| `PS_SANMAR_USERNAME` / `PS_SANMAR_PASSWORD` | SanMar PromoStandards |
| `PS_SS_USERNAME` / `PS_SS_PASSWORD` | S&S Activewear PromoStandards |
| `PS_ALPHABRODER_USERNAME` / `PS_ALPHABRODER_PASSWORD` | alphabroder PromoStandards |

---

## 20. Migration Files Reference

All migrations live in `drizzle/`. They are numbered sequentially and must be applied in order.

| Migration | Description |
|---|---|
| `0000` - `0024` | Core schema: users, clients, products, proposals, orders, stores, etc. |
| `0025_organizations_multitenancy` | Multi-tenancy: organizations, org members, org invites |
| `0026_external_products_columns` | External product catalog columns (ASI, PromoStandards) |
| `0027_add_foreign_keys` | Initial FK constraints batch |
| `0028_create_audit_log_table` | PCI audit log table |
| `0029_pci_lockout_and_audit_fix` | Account lockout columns, OTP hash widening, audit timestamp fix |
| `0030_complete_foreign_keys` | 32 remaining FK constraints for full referential integrity |
| `0031` - `0039` | V11 post-audit schema changes (taxRate, paidAt, etc.) |

For a fresh deployment, `pnpm db:push` handles 0000-0028 automatically. Then run 0029 and 0030 manually as shown in step 8.
