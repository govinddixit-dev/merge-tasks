/**
 * e2e/reports.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reports page E2E tests:
 *   • Reports page renders with entity type selector
 *   • Date range selector is present
 *   • Export button is present
 *   • Summary stats are shown
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Reports page", () => {
  test("renders the reports page", async ({ authedPage: page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: /reports|analytics/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("entity type selector is present", async ({ authedPage: page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: /reports|analytics/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Should have a selector for proposals / invoices / estimates
    const selector = page
      .getByRole("combobox")
      .or(page.getByRole("button", { name: /proposals|invoices|estimates/i }))
      .first();

    await expect(selector).toBeVisible({ timeout: 8_000 });
  });

  test("date range controls are present", async ({ authedPage: page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: /reports|analytics/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Date range picker or preset buttons
    const dateControl = page
      .getByRole("button", { name: /last 30|last 7|this month|date range|custom/i })
      .or(page.locator("input[type='date']"))
      .first();

    await expect(dateControl).toBeVisible({ timeout: 8_000 });
  });

  test("export button is present", async ({ authedPage: page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: /reports|analytics/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: /export|download|csv/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("summary stat cards are visible", async ({ authedPage: page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: /reports|analytics/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // At least one stat card (total, count, etc.) should be visible
    const statLabels = [/total|revenue|count|average|amount/i];
    let found = 0;
    for (const label of statLabels) {
      const visible = await page.getByText(label).first().isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) found++;
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });
});
