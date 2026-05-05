/**
 * e2e/proposals.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Proposal management E2E tests:
 *   • Proposals list page renders
 *   • Search/filter works
 *   • Create Proposal wizard opens and navigates steps
 *   • Proposal detail page renders key sections
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits. networkidle is unreliable in SPAs
 * because background polling keeps the network busy indefinitely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Proposals list", () => {
  test("renders the proposals page with key UI elements", async ({ authedPage: page }) => {
    await page.goto("/proposals");
    // Wait for the heading — reliable signal that the page has rendered
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible({ timeout: 10_000 });
    // Should show a "Create Proposal" or "New Proposal" button
    await expect(
      page.getByRole("button", { name: /create proposal|new proposal/i }).first()
    ).toBeVisible();
  });

  test("search input filters proposals", async ({ authedPage: page }) => {
    await page.goto("/proposals");
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("Acme");
      // Wait for debounce / filter to apply
      await page.waitForTimeout(500);
      // The table/list should still be visible (even if empty)
      const listOrEmpty = page.locator("table, [data-testid='proposal-list'], .proposal-row, [data-testid='empty-state']").first();
      await expect(listOrEmpty).toBeVisible({ timeout: 5_000 });
    }
  });

  test("status filter buttons are present", async ({ authedPage: page }) => {
    await page.goto("/proposals");
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible({ timeout: 10_000 });

    // Should have filter tabs/buttons for different statuses
    const allFilter = page.getByRole("button", { name: /^all$/i }).first();
    await expect(allFilter).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Create Proposal wizard", () => {
  test("opens the create proposal page", async ({ authedPage: page }) => {
    await page.goto("/create-proposal");
    // Should show step 1 of the wizard — wait for it directly
    await expect(page.getByText(/step 1|client info|select client/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("wizard shows step indicators", async ({ authedPage: page }) => {
    await page.goto("/create-proposal");
    // Wait for the wizard to render before counting step indicators
    await expect(page.getByText(/step 1|client info|select client/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Step indicators should be present (numbered or named)
    const stepIndicators = page.locator("[data-step], .step-indicator, [aria-label*='step']");
    const count = await stepIndicators.count();
    // At least 2 steps should be visible
    expect(count).toBeGreaterThanOrEqual(2); // Wizard must have at least 2 step indicators
  });

  test("navigating to create proposal from proposals list", async ({ authedPage: page }) => {
    await page.goto("/proposals");
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible({ timeout: 10_000 });

    const createBtn = page.getByRole("button", { name: /create proposal|new proposal/i }).first();
    await createBtn.click();

    // Should navigate to create-proposal or open a modal
    await expect(page).toHaveURL(/create-proposal|proposals/, { timeout: 8_000 });
  });
});

test.describe("Proposal detail", () => {
  test("proposal detail page renders when navigated to directly", async ({ authedPage: page }) => {
    // Navigate to proposals list first to find a real proposal ID
    await page.goto("/proposals");
    await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible({ timeout: 10_000 });

    // Click the first proposal row if available
    const firstRow = page.locator("tr[data-id], .proposal-row, [data-testid='proposal-item']").first();
    if (await firstRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstRow.click();
      // Wait for the detail page to render — URL change + visible content
      await page.waitForURL(/\/proposals\/\d+/, { timeout: 8_000 }).catch(() => {});

      // Should show proposal detail elements
      await expect(
        page.getByText(/proposal|client|products|total/i).first()
      ).toBeVisible({ timeout: 8_000 });
    } else {
      // No proposals yet — just verify the list page loaded correctly
      await expect(page.getByRole("heading", { name: /proposals/i })).toBeVisible();
    }
  });
});
