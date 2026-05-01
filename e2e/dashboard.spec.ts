/**
 * e2e/dashboard.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dashboard E2E tests:
 *   • Dashboard renders key metric cards
 *   • Navigation sidebar links work
 *   • AI command bar is present
 *   • Quick action buttons are present
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Dashboard", () => {
  test("renders after sign-in", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    // Wait for the heading — reliable signal that the page has rendered
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows key metric stat cards", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // At least one of the common metric labels should be visible
    const metricLabels = [
      /total revenue|revenue/i,
      /proposals/i,
      /clients/i,
      /orders/i,
    ];

    let found = 0;
    for (const label of metricLabels) {
      const visible = await page.getByText(label).first().isVisible({ timeout: 2_000 }).catch(() => false);
      if (visible) found++;
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });

  test("navigation sidebar is present with key links", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    const navLinks = [
      /proposals/i,
      /clients/i,
      /products/i,
    ];

    for (const label of navLinks) {
      await expect(page.getByRole("link", { name: label }).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("AI command bar or assistant button is visible", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    const aiBar = page
      .getByPlaceholder(/ask mergetasks|ask ai|command/i)
      .or(page.getByRole("button", { name: /ai assistant|copilot/i }))
      .first();

    await expect(aiBar).toBeVisible({ timeout: 8_000 });
  });

  test("navigating to Proposals via sidebar works", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("link", { name: /^proposals$/i }).first().click();
    await expect(page).toHaveURL(/proposals/, { timeout: 8_000 });
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible();
  });

  test("navigating to Clients via sidebar works", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard|welcome/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("link", { name: /^clients$/i }).first().click();
    await expect(page).toHaveURL(/clients/, { timeout: 8_000 });
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible();
  });
});
