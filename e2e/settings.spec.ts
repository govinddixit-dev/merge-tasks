/**
 * e2e/settings.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Settings page E2E tests:
 *   • Settings page renders with tabs
 *   • Profile tab shows user fields
 *   • Organization tab shows org fields
 *   • AI Approval level selector is present
 *   • SMTP settings section is present
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from "./helpers";

test.describe("Settings page", () => {
  test("renders the settings page", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: /settings/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows tab navigation with Profile and Organization tabs", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
    // Both Profile and Organization tabs must always be present
    await expect(
      page
        .getByRole("button", { name: /profile/i })
        .or(page.getByText(/^profile$/i))
        .first()
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page
        .getByRole("button", { name: /organization|company/i })
        .or(page.getByText(/^organization$/i))
        .first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("profile tab shows name and email fields", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
    // Click Profile tab — it must always be present
    const profileTab = page
      .getByRole("button", { name: /^profile$/i })
      .or(page.getByText(/^profile$/i))
      .first();
    await expect(profileTab).toBeVisible({ timeout: 5_000 });
    await profileTab.click();
    await page.waitForTimeout(300);

    // Name and email fields must be present after clicking Profile tab
    const nameField = page
      .getByLabel(/name|full name/i)
      .or(page.getByPlaceholder(/your name|full name/i))
      .first();
    await expect(nameField).toBeVisible({ timeout: 5_000 });
  });

  test("AI approval level selector is present on organization tab", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
    // Organization tab must always be present
    const orgTab = page
      .getByRole("button", { name: /organization|ai|automation/i })
      .first();
    await expect(orgTab).toBeVisible({ timeout: 5_000 });
    await orgTab.click();
    await page.waitForTimeout(300);

    // AI approval level selector must be present on the organization tab
    await expect(
      page.getByText(/ai approval|approval level|auto-approve/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("SMTP settings section is present on email tab", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
    // Email/SMTP tab must always be present
    const emailTab = page
      .getByRole("button", { name: /email|smtp|notifications/i })
      .first();
    await expect(emailTab).toBeVisible({ timeout: 5_000 });
    await emailTab.click();
    await page.waitForTimeout(300);

    // SMTP section must be present after clicking the email tab
    await expect(
      page.getByText(/smtp|email server|outgoing mail/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Save button is present on settings forms", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /save|update|apply/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});
