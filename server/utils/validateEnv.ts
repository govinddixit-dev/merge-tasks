/**
 * Environment Validation
 *
 * Validates all required environment variables at server startup.
 * Fails fast with a clear, actionable error message so misconfigured
 * deployments are caught immediately rather than failing silently at runtime.
 *
 * Usage: call validateEnv() as the very first thing in server startup,
 * before any other imports or initialization.
 */

interface EnvVar {
  name: string;
  description: string;
  required: boolean;
  /** If true, only required when a specific feature is enabled */
  featureFlag?: string;
}

const ENV_VARS: EnvVar[] = [
  //  Core 
  {
    name: "DATABASE_URL",
    description: "MySQL connection string (mysql://user:pass@host:port/dbname)",
    required: true,
  },
  {
    name: "SESSION_SECRET",
    description: "Secret key for signing session cookies (min 32 chars, random string)",
    required: true,
  },
  {
    name: "CREDENTIAL_ENCRYPTION_KEY",
    description: "AES-256 key for encrypting OAuth tokens and SMTP passwords at rest (min 32 chars). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    required: true,
  },
  {
    name: "APP_BASE_URL",
    description: "Public URL of the application (e.g. https://app.mergetasks.com)",
    required: true,
  },

  //  AI 
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key for AI copilot, virtual proofing, and store optimization",
    required: true,
  },

  //  Queue / cache (Redis — Decision 27)
  {
    name: "REDIS_URL",
    description:
      "Redis connection string for the shared ElastiCache instance (BullMQ queues, rate limiter, " +
      "token blocklist, PKCE store). Use rediss:// to enable TLS — required in production per Decision 27.",
    required: true,
  },

  //  Email (Resend)
  {
    name: "RESEND_API_KEY",
    description: "Resend.com API key for all platform emails (2FA, invites, notifications). Get from resend.com/api-keys",
    required: true,
  },
  {
    name: "RESEND_FROM",
    description: "Verified sender address for Resend (e.g. noreply@mail.mergetasks.com). Must be a Resend-verified domain.",
    required: false,
  },

  //  File Storage 
  {
    name: "AWS_S3_BUCKET",
    description: "S3 bucket name for storing uploaded logos and images",
    required: false,
  },
  {
    name: "AWS_REGION",
    description: "AWS region for the S3 bucket (e.g. us-east-1)",
    required: false,
  },
  {
    name: "AWS_ACCESS_KEY_ID",
    description: "AWS access key ID for S3 uploads",
    required: false,
  },
  {
    name: "AWS_SECRET_ACCESS_KEY",
    description: "AWS secret access key for S3 uploads",
    required: false,
  },

  //  Payments 
  {
    name: "STRIPE_SECRET_KEY",
    description: "Stripe secret key for processing store payments",
    required: false,
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    description: "Stripe webhook signing secret for verifying webhook events",
    required: false,
  },

  //  Monitoring
  {
    name: "SENTRY_DSN",
    description: "Sentry DSN for error tracking (optional but recommended in production)",
    required: false,
  },

  //  Deployment automation
  {
    name: "DEPLOY_WEBHOOK_SECRET",
    description:
      "Shared secret for the GitHub push webhook at POST /api/deploy/webhook. " +
      "When unset, the endpoint returns 503 and auto-deploy is disabled.",
    required: false,
  },
];

export function validateEnv(): void {
  const missing: EnvVar[] = [];
  const warnings: EnvVar[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];
    const isEmpty = !value || value.trim() === "";

    if (isEmpty) {
      if (envVar.required) {
        missing.push(envVar);
      } else {
        warnings.push(envVar);
      }
    }
  }

  // Warn clearly if RESEND_API_KEY looks like a placeholder or test value
  const resendKey = process.env.RESEND_API_KEY ?? "";
  if (resendKey && !resendKey.startsWith("re_")) {
    console.warn(
      "\n⚠️  WARNING: RESEND_API_KEY does not start with 're_'. " +
      "This may not be a valid Resend API key.\n" +
      "   Get a valid key from: https://resend.com/api-keys\n"
    );
  }

  // Accept JWT_SECRET as legacy fallback for SESSION_SECRET
  if (!process.env.SESSION_SECRET && process.env.JWT_SECRET) {
    // Remove SESSION_SECRET from missing list if JWT_SECRET is present
    const idx = missing.findIndex(v => v.name === "SESSION_SECRET");
    if (idx !== -1) missing.splice(idx, 1);
  }

  // Validate SESSION_SECRET / JWT_SECRET length
  const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (sessionSecret && sessionSecret.length < 32) {
    console.error(
      `\n⚠️  WARNING: SESSION_SECRET is only ${sessionSecret.length} characters long.\n` +
      `   It should be at least 32 random characters for security.\n` +
      `   Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n`
    );
  }

  // Print warnings for optional missing vars
  if (warnings.length > 0 && process.env.NODE_ENV !== "test") {
    console.warn("\n⚠️  Optional environment variables not set (some features will be disabled):");
    for (const v of warnings) {
      console.warn(`   ${v.name.padEnd(28)} — ${v.description}`);
    }
    console.warn("");
  }

  // Hard fail on required missing vars
  if (missing.length > 0) {
    const lines = [
      "",
      "",
      "          FATAL: Missing required environment variables           ",
      "",
      "",
      "The following required environment variables are not set:",
      "",
    ];

    for (const v of missing) {
      lines.push(`  ❌  ${v.name}`);
      lines.push(`       ${v.description}`);
      lines.push("");
    }

    lines.push("Set these variables in your .env file or deployment environment.");
    lines.push("See DEPLOYMENT_GUIDE.md for the full list of required variables.");
    lines.push("");

    console.error(lines.join("\n"));
    process.exit(1);
  }

  // ── Stripe key prefix validation ────────────────────────────────────────────
  // Prevents test keys from reaching production and live keys from running in dev.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    const isLiveKey = stripeKey.startsWith("sk_live_");
    const isTestKey = stripeKey.startsWith("sk_test_");
    const isRestricted = stripeKey.startsWith("rk_live_") || stripeKey.startsWith("rk_test_");

    if (!isLiveKey && !isTestKey && !isRestricted) {
      console.error(
        "\n❌  FATAL: STRIPE_SECRET_KEY does not have a recognized prefix.\n" +
        "   Expected: sk_live_... (production) or sk_test_... (development)\n" +
        "   Got: " + stripeKey.substring(0, 12) + "...\n"
      );
      process.exit(1);
    }

    if (process.env.NODE_ENV === "production" && !isLiveKey && !stripeKey.startsWith("rk_live_")) {
      console.error(
        "\n" +
        "          FATAL: Test Stripe key detected in production           \n" +
        "\n" +
        "  STRIPE_SECRET_KEY starts with 'sk_test_' but NODE_ENV=production.\n" +
        "  Using a test key in production means real credit cards will NOT be charged.\n" +
        "  Payments will appear to succeed but no money will move.\n" +
        "\n" +
        "  Set STRIPE_SECRET_KEY to your live key (sk_live_...) before deploying.\n" +
        "  See DEPLOYMENT_GUIDE.md for the key rotation checklist.\n" +
        ""
      );
      process.exit(1);
    }

    if (process.env.NODE_ENV !== "production" && isLiveKey) {
      console.warn(
        "\n⚠️  WARNING: Live Stripe key (sk_live_...) detected in a non-production environment.\n" +
        "   NODE_ENV=" + process.env.NODE_ENV + "\n" +
        "   Real money will be charged if checkout sessions are created.\n" +
        "   Use sk_test_... for development and testing.\n"
      );
      // Warn only — do not fail. Some developers intentionally test with live keys.
    }
  }

  // ── Stripe webhook secret validation ─────────────────────────────────────────
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    console.error(
      "\n❌  FATAL: STRIPE_WEBHOOK_SECRET does not start with 'whsec_'.\n" +
      "   This is likely a copy-paste error. Get the correct secret from\n" +
      "   Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret.\n"
    );
    process.exit(1);
  }

  if (process.env.NODE_ENV !== "test") {
    console.log("✅  Environment validation passed");
  }
}
