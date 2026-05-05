/**
 * Endpoint risk-tier classification.
 *
 * Tier A — fail-closed on backend errors (rate limiter / token blocklist):
 *   auth, billing, admin, password reset, session-affecting endpoints.
 *   A Redis outage must not silently disable rate limiting or token revocation
 *   on these surfaces; any infrastructure failure is treated as a denial.
 *
 * Tier B — fail-open on backend errors:
 *   low-risk reads (catalog browsing, public listings, health probes).
 *   A Redis outage should not break read traffic; instead, a structured
 *   `fallback_mode` log line is emitted so operators can detect the condition.
 */

export type RiskTier = "A" | "B";

/**
 * Tier A path matchers — order matters only loosely; first hit wins.
 * Includes both raw REST paths and tRPC proc paths under /api/trpc/.
 */
const TIER_A_PATTERNS: RegExp[] = [
  // Raw REST surfaces
  /^\/api\/auth\b/i,
  /^\/api\/billing\b/i,
  /^\/api\/admin\b/i,
  /^\/api\/oauth\b/i,
  /^\/api\/sso\b/i,
  /^\/api\/stripe\b/i,
  /^\/api\/deploy\b/i,
  /^\/api\/store-approval\b/i,
  // tRPC procs that affect auth, billing, admin, password, or session state
  /^\/api\/trpc\/auth\./i,
  /^\/api\/trpc\/billing\./i,
  /^\/api\/trpc\/platformAdmin\./i,
  /^\/api\/trpc\/onboarding\./i,
  /^\/api\/trpc\/socialAuth\./i,
  /^\/api\/trpc\/storeAuth\./i,
  /^\/api\/trpc\/accountDeletion\./i,
  /^\/api\/trpc\/storeSso\./i,
  /^\/api\/trpc\/refunds\./i,
  /^\/api\/trpc\/stripeConnect\./i,
  // Generic password / reset / session keywords
  /password/i,
  /reset/i,
  /logout/i,
  /signin|sign-in/i,
  /signup|sign-up/i,
  /session/i,
];

/**
 * Classify an HTTP request path into a risk tier.
 *
 * Defaults to Tier B (fail-open) when no Tier A pattern matches. New
 * sensitive endpoints should be added explicitly to TIER_A_PATTERNS.
 */
export function classifyPath(path: string): RiskTier {
  for (const re of TIER_A_PATTERNS) {
    if (re.test(path)) return "A";
  }
  return "B";
}
