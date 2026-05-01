/**
 * CI smoke spec — Phase 1 Task 1a (Decision 41).
 *
 * This is the single spec the CI `e2e` job runs. It asserts that the
 * public `/sign-in` route renders and its credentials form is present.
 * No auth, no seeded fixtures, no tRPC calls — just "the app boots and
 * serves the login page."
 *
 * Selector strategy: we use getByPlaceholder instead of getByLabel because
 * the SignIn page's <Input> component doesn't forward `id` to the underlying
 * <input> element, so htmlFor/id label association is broken for accessible-
 * name computation. Placeholders sit directly on the <input> element and are
 * unambiguous. Fixing Input to forward id properly is a separate follow-up
 * (tracked as a client-side accessibility improvement, not blocking here).
 *
 * The existing e2e/*.spec.ts files depend on a demo user + richer
 * fixtures and are out of scope until a follow-up task wires seed
 * + auth storageState for CI.
 */
import { test, expect } from "@playwright/test";

test.describe("CI smoke — /sign-in renders", () => {
  test("sign-in page loads with email, password, and submit button", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder("Enter your password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });
});
