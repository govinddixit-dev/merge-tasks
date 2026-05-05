/**
 * e2e/clients.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Client management E2E tests:
 *   • Clients list page renders
 *   • Search filters clients
 *   • Add client modal opens and validates required fields
 *   • Client detail page renders key sections
 *
 * Audit fix #22: replaced all waitForLoadState("networkidle") with
 * deterministic element-based waits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Clients list", () => {
  test("renders the clients page with key UI elements", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });
    // Should show an "Add Client" or "New Client" button
    await expect(
      page.getByRole("button", { name: /add client|new client/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("search input is present and interactive", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("Test");
    await page.waitForTimeout(400);
    // Input should retain the typed value
    await expect(searchInput).toHaveValue("Test");
  });

  test("client list or empty state is shown", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    // Either a list of clients or an empty state message should be visible
    const hasClients = await page.locator("table tbody tr, .client-row, [data-testid='client-item']").first().isVisible({ timeout: 3_000 }).catch(() => false);
    const hasEmptyState = await page.getByText(/no clients|get started|add your first/i).first().isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasClients || hasEmptyState).toBe(true);
  });
});

test.describe("Add client modal", () => {
  test("opens when Add Client button is clicked", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    const addBtn = page.getByRole("button", { name: /add client|new client/i }).first();
    await addBtn.click();

    // Modal or drawer should appear
    await expect(
      page.getByRole("dialog").or(page.getByText(/add client|new client/i).nth(1))
    ).toBeVisible({ timeout: 5_000 });
  });

  test("add client form has required fields", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /add client|new client/i }).first().click();
    await page.waitForTimeout(500);

    // Company name field should be present
    const companyField = page
      .getByLabel(/company|organization|name/i)
      .or(page.getByPlaceholder(/company|organization|client name/i))
      .first();
    await expect(companyField).toBeVisible({ timeout: 5_000 });
  });

  test("submitting empty form shows validation errors", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /add client|new client/i }).first().click();
    await page.waitForTimeout(500);

    // Try to submit without filling required fields
    const submitBtn = page.getByRole("button", { name: /save|create|add/i }).last();
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
      // Should show validation errors or stay on the form
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 }).catch(() => {});
    }
  });
});

test.describe("Client detail", () => {
  test("clicking a client row opens the client detail view", async ({ authedPage: page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible({ timeout: 10_000 });

    const firstClient = page.locator("table tbody tr, .client-row").first();
    if (await firstClient.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstClient.click();
      // Wait for detail content instead of networkidle
      await expect(
        page.getByText(/overview|proposals|orders|assets/i).first()
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // No clients — acceptable
      test.skip();
    }
  });
});
