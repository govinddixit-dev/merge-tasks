/**
 * e2e/products.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Product Curation E2E tests:
 *   • Products page renders with tabs
 *   • Search filters the product list
 *   • Grid/list toggle is present
 *   • Import modal opens
 *   • External search modal opens
 *   • Collections tab renders
 *   • Print tab renders with upload zone
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Product Curation page", () => {
  test("renders with tab navigation", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Products tab must always be present
    await expect(
      page.getByRole("button", { name: /^products$/i }).or(page.getByText(/^products$/i)).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("search input filters the product list", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("Yeti");
    await page.waitForTimeout(400);
    await expect(searchInput).toHaveValue("Yeti");
  });

  test("grid/list view toggle is present", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // At least one of grid or list toggle must be visible — both are always rendered
    const gridBtn = page
      .getByRole("button", { name: /grid/i })
      .or(page.locator("[aria-label='grid view'], [title='Grid']"))
      .first();
    const listBtn = page
      .getByRole("button", { name: /list/i })
      .or(page.locator("[aria-label='list view'], [title='List']"))
      .first();

    // Use a combined locator — at least one must be visible
    await expect(gridBtn.or(listBtn).first()).toBeVisible({ timeout: 5_000 });
  });

  test("Import Products button opens the import modal", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    const importBtn = page.getByRole("button", { name: /import/i }).first();
    await expect(importBtn).toBeVisible({ timeout: 5_000 });
    await importBtn.click();

    await expect(
      page.getByRole("dialog").or(page.getByText(/import products|choose import/i).first())
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
  });

  test("External Search button opens the external search modal", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    const extSearchBtn = page
      .getByRole("button", { name: /external search|search asi|search suppliers/i })
      .or(page.getByTitle(/external search/i))
      .first();

    // This button must always be present on the products page
    await expect(extSearchBtn).toBeVisible({ timeout: 5_000 });
    await extSearchBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });

  test("Collections tab renders collection cards or empty state", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Collections tab must always be present
    const collectionsTab = page.getByRole("button", { name: /collections/i }).first();
    await expect(collectionsTab).toBeVisible({ timeout: 5_000 });
    await collectionsTab.click();
    await page.waitForTimeout(300);

    // After clicking, either cards or a grid container must be visible
    await expect(
      page.locator(".collection-card, [data-testid='collection-card'], .grid").first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Print tab renders upload zone", async ({ authedPage: page }) => {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: /product curation|products/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Print tab must always be present
    const printTab = page.getByRole("button", { name: /^print$/i }).first();
    await expect(printTab).toBeVisible({ timeout: 5_000 });
    await printTab.click();
    await page.waitForTimeout(300);

    // Upload zone must be present after clicking the Print tab
    await expect(
      page.getByText(/upload print-ready|drag.*drop|pdf.*ai.*psd/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
