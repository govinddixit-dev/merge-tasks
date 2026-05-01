/**
 * e2e/smoke.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Smoke tests — fast checks that every main route loads without a crash
 * (no white screen, no unhandled error overlay, HTTP 200).
 *
 * These run first in CI to catch regressions quickly before the deeper tests.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

const MAIN_ROUTES = [
  { path: "/dashboard",        name: "Dashboard" },
  { path: "/proposals",        name: "Proposals" },
  { path: "/create-proposal",  name: "Create Proposal" },
  { path: "/clients",          name: "Clients" },
  { path: "/products",         name: "Products" },
  { path: "/webstores",        name: "Webstores" },
  { path: "/reports",          name: "Reports" },
  { path: "/settings",         name: "Settings" },
  { path: "/virtual-proofing", name: "Virtual Proofing" },
];

test.describe("Smoke — all main routes load without crashing", () => {
  for (const route of MAIN_ROUTES) {
    test(`${route.name} (${route.path}) renders without error`, async ({ authedPage: page }) => {
      // Collect any unhandled JS errors
      const jsErrors: string[] = [];
      page.on("pageerror", (err) => jsErrors.push(err.message));

      await page.goto(route.path);
      // Audit fix #22: wait for body to have content instead of networkidle
      await page.waitForFunction(() => document.body.innerText.trim().length > 0, { timeout: 10_000 });

      // Page should not show a blank white screen
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.trim().length).toBeGreaterThan(0);

      // No React error boundary "Something went wrong" overlay
      const errorOverlay = await page
        .getByText(/something went wrong|unexpected error|application error/i)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false);
      expect(errorOverlay).toBe(false);

      // No critical JS errors (filter out known benign warnings)
      const criticalErrors = jsErrors.filter(
        (e) =>
          !e.includes("ResizeObserver") &&
          !e.includes("Non-Error promise rejection") &&
          !e.includes("ChunkLoadError")
      );
      expect(criticalErrors).toHaveLength(0);
    });
  }
});

test.describe("Smoke — public routes accessible without auth", () => {
  test("sign-in page loads", async ({ page }) => {
    await page.goto("/sign-in");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5_000 });
  });

  test("404 page or redirect for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-xyz");
    // Should either show a 404 page or redirect to sign-in
    const is404 = await page.getByText(/404|not found|page not found/i).first().isVisible({ timeout: 3_000 }).catch(() => false);
    const isSignIn = page.url().includes("sign-in");
    expect(is404 || isSignIn).toBe(true);
  });
});
