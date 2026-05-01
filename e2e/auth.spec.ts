/**
 * e2e/auth.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Authentication flow tests:
 *   • Sign-in page renders correctly
 *   • Valid credentials redirect to dashboard
 *   • Invalid credentials show an error
 *   • Unauthenticated users are redirected to /sign-in
 *   • Sign-out clears session and redirects to /sign-in
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect, signIn, TEST_USER } from "./helpers";

test.describe("Authentication", () => {
  test("sign-in page renders key elements", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page).toHaveTitle(/MergeTasks/i);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("valid credentials redirect to dashboard", async ({ page }) => {
    await signIn(page);
    // Should be on dashboard (or root which redirects to dashboard)
    await expect(page).toHaveURL(/\/(dashboard|$)/);
    // Dashboard should show the AI command bar
    await expect(page.getByText(/ask mergetasks ai/i)).toBeVisible();
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill("wrong@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Error toast or inline error should appear
    await expect(
      page.getByText(/invalid|incorrect|wrong|not found/i).first()
    ).toBeVisible({ timeout: 8_000 });

    // Should stay on sign-in page
    await expect(page).toHaveURL(/sign-in/);
  });

  test("unauthenticated users are redirected to sign-in", async ({ page }) => {
    // Try to access a protected route directly
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/sign-in/, { timeout: 8_000 });
  });

  test("sign-out clears session", async ({ page }) => {
    await signIn(page);

    // Find and click the sign-out button (usually in a user menu)
    // Try the avatar/menu button first
    const userMenu = page.getByRole("button", { name: /account|profile|user menu/i }).first();
    if (await userMenu.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await userMenu.click();
    }

    // Look for sign-out link
    const signOutBtn = page.getByRole("button", { name: /sign out|log out/i }).first();
    if (await signOutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signOutBtn.click();
      await expect(page).toHaveURL(/sign-in/, { timeout: 8_000 });
    } else {
      // Fallback: navigate to /sign-out or /api/auth/logout
      await page.goto("/sign-out");
      await expect(page).toHaveURL(/sign-in/, { timeout: 8_000 });
    }
  });

  test("sign-in page has link to sign-up", async ({ page }) => {
    await page.goto("/sign-in");
    const signUpLink = page.getByRole("link", { name: /sign up|create account|register/i });
    await expect(signUpLink).toBeVisible();
  });
});

test.describe("Protected routes (auth required)", () => {
  const protectedRoutes = [
    "/dashboard",
    "/proposals",
    "/clients",
    "/products",
    "/webstores",
    "/reports",
  ];

  for (const route of protectedRoutes) {
    test(`${route} redirects unauthenticated users`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/sign-in/, { timeout: 8_000 });
    });
  }
});
