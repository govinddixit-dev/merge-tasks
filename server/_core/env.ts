/**
 * Resolve the session signing secret.
 * Reads SESSION_SECRET first, falls back to JWT_SECRET for backward compatibility.
 *
 * Audit fix #10 (CRITICAL): Require a real secret in ALL environments — not just production.
 * A staging/QA server with real data and an empty JWT secret allows full account takeover
 * via arbitrary JWT forgery. The only exception is a pure local unit-test run where
 * NODE_ENV=test AND the CI environment variable is unset (developer laptop).
 * PCI DSS Req 2.1.
 */
function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || "";
  // Allow empty secret only during local unit tests (not CI, not staging, not production)
  const isLocalUnitTest =
    process.env.NODE_ENV === "test" && !process.env.CI;
  if (!secret && !isLocalUnitTest) {
    console.error(
      "\n" +
      "╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: SESSION_SECRET (or JWT_SECRET) is not set.             ║\n" +
      "║  The server cannot start without a signing secret in any       ║\n" +
      "║  internet-facing environment (production, staging, QA, CI).   ║\n" +
      "║  Set SESSION_SECRET in your .env file or environment.          ║\n" +
      "║  Generate one: node -e \"console.log(require('crypto')          ║\n" +
      "║    .randomBytes(48).toString('hex'))\"                          ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }
  if (!secret) {
    // Local unit-test only — warn but allow startup
    console.warn(
      "⚠️  WARNING: SESSION_SECRET is not set. Allowing empty secret for local unit tests only. " +
      "This is NOT safe for any internet-facing environment."
    );
  }
  return secret;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  /**
   * Secret for signing JWT session tokens.
   * Hard-fails in all internet-facing environments if not set (PCI DSS Req 2.1).
   */
  cookieSecret: resolveSessionSecret(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "",
  /**
   * Platform fee multiplier applied to every connected-account checkout
   * (e.g. 0.02 = 2%). Configurable per deployment via the PLATFORM_FEE_PERCENT
   * env variable. Falls back to 0.02 if unset or invalid.
   */
  platformFeePercent: (() => {
    const raw = process.env.PLATFORM_FEE_PERCENT;
    if (!raw) return 0.02;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) {
      // Out-of-range or unparseable — fall back to safe default rather than
      // accidentally overcharging.
      return 0.02;
    }
    return parsed;
  })(),
  stripePriceStarterMonthly: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "",
  stripePriceStarterAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL ?? "",
  stripePriceGrowthMonthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? "",
  stripePriceGrowthAnnual: process.env.STRIPE_PRICE_GROWTH_ANNUAL ?? "",
  stripePriceEnterpriseMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? "",
  stripePriceEnterpriseAnnual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? "",
  // Resend email API (platform-level emails: 2FA, invites, notifications)
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFrom: process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "noreply@mergetasks.com",
  // Legacy SMTP — kept for distributor-connected email accounts (Gmail/Outlook/SMTP)
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  // OpenAI API key — set APP_OPENAI_API_KEY in .env or fall back to OPENAI_API_KEY
  appOpenAiApiKey: process.env.APP_OPENAI_API_KEY ?? "",
  // Anthropic API key — used by the Anthropic provider in llmConfig.ts
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Google Gemini API key — used by the Google provider in llmConfig.ts
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",

  // --- AI Privacy Enhancement (Layer 4) ---
  /** Send X-OpenAI-Data-Policy: zdr header to prevent prompt storage/training */
  openaiZeroDataRetention: process.env.OPENAI_ZERO_DATA_RETENTION === "true",

  // --- LLM Provider Flexibility ---
  /** LLM provider: openai | anthropic | google | together | groq | mistral */
  llmProvider: (process.env.LLM_PROVIDER || "openai") as string,
  llmApiUrl: process.env.LLM_API_URL || "",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",
  llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || "16384", 10),
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0"),

  /** Optional fallback provider for automatic retry on primary failure */
  llmFallbackProvider: process.env.LLM_FALLBACK_PROVIDER || "",
  llmFallbackApiUrl: process.env.LLM_FALLBACK_API_URL || "",
  llmFallbackApiKey: process.env.LLM_FALLBACK_API_KEY || "",
  llmFallbackModel: process.env.LLM_FALLBACK_MODEL || "",

  /**
   * DEMO/DEV ONLY — skip 2FA email verification and auto-approve login.
   * NEVER set this to true in production. It is ignored when NODE_ENV=production.
   */
  demoSkip2FA: process.env.DEMO_SKIP_2FA === "true" && process.env.NODE_ENV !== "production",
};
