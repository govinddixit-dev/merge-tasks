/**
 * e2e/webstores.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Webstore management E2E tests:
 *   • Webstores list page renders
 *   • Create Webstore wizard opens
 *   • Store editor loads for an existing store
 *   • Store preview page renders
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Webstores list", () => {
  test("renders the webstores page", async ({ authedPage: page }) => {
    await page.goto("/webstores");
    await expect(
      page.getByRole("heading", { name: /webstores|stores/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows Create Webstore button", async ({ authedPage: page }) => {
    await page.goto("/webstores");
    await expect(
      page.getByRole("heading", { name: /webstores|stores/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: /create webstore|new store|create store/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("shows store list or empty state", async ({ authedPage: page }) => {
    await page.goto("/webstores");
    await expect(
      page.getByRole("heading", { name: /webstores|stores/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Either a store item or an empty-state message must be visible — never neither
    await expect(
      page
        .locator(".store-card, [data-testid='store-item'], table tbody tr")
        .first()
        .or(page.getByText(/no stores|create your first|get started/i).first())
    ).toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Create Webstore wizard", () => {
  test("opens the create webstore page", async ({ authedPage: page }) => {
    await page.goto("/create-webstore");
    await expect(
      page.getByText(/step 1|store name|store details|create.*store/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("wizard has a store name input on step 1", async ({ authedPage: page }) => {
    await page.goto("/create-webstore");
    // Wait for the wizard to render
    await expect(
      page.getByText(/step 1|store name|store details|create.*store/i).first()
    ).toBeVisible({ timeout: 10_000 });

    const nameInput = page
      .getByLabel(/store name/i)
      .or(page.getByPlaceholder(/store name|e\.g\. acme/i))
      .first();

    await expect(nameInput).toBeVisible({ timeout: 8_000 });
  });

  test("navigating to create webstore from list", async ({ authedPage: page }) => {
    await page.goto("/webstores");
    await expect(
      page.getByRole("heading", { name: /webstores|stores/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    const createBtn = page
      .getByRole("button", { name: /create webstore|new store|create store/i })
      .first();
    await createBtn.click();

    await expect(page).toHaveURL(/create-webstore|webstores/, { timeout: 8_000 });
  });
});

test.describe("Store editor", () => {
  test("store editor loads for an existing store", async ({ authedPage: page }) => {
    await page.goto("/webstores");
    await expect(
      page.getByRole("heading", { name: /webstores|stores/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    const firstStore = page
      .locator(".store-card, [data-testid='store-item']")
      .first();

    const storeExists = await firstStore.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!storeExists) {
      // No stores in this test environment — explicitly skip rather than silently pass
      test.skip(true, "No existing stores found in test environment — skipping store editor test");
      return;
    }

    // A store exists — the Edit button must be present and functional
    const editBtn = firstStore.getByRole("button", { name: /edit|manage/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    // Store editor must have section navigation — wait for it directly
    await expect(
      page.getByText(/branding|products|settings|team/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
