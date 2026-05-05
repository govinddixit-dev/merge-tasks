import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for MergeTasks.
 *
 * Local dev: runs `pnpm dev` (Vite dev middleware serves client HTML with
 * live HMR). Tests hit http://localhost:5000.
 *
 * CI: runs `pnpm build && pnpm start` to exercise the production code path
 * (Vite builds static assets to dist/public/, then NODE_ENV=production node
 * dist/index.js serves them via serveStatic()). This is required because
 * the app's /sign-in route depends on serveStatic's built index.html
 * (with hashed script + css tags) — dev-mode serving returns client/index.html
 * which has no bundled <script> tag and produces a blank page.
 *
 * Set E2E_BASE_URL to override the baseURL (e.g. test against a staging URL).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.CI
      ? "pnpm build && pnpm start"
      : "pnpm dev",
    url: "http://localhost:5000",
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180_000 : 60_000,
  },
});
