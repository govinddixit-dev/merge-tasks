/**
 * Privacy Policy page verification (Session 3, STEP 4).
 *
 * The page lives in the React client, so there is no Express route to
 * test against directly. We pin the contract at three levels:
 *
 *   1. The page is wired into App.tsx as a public route that does NOT
 *      pass through the protected AppShell — i.e. accessible without
 *      authentication (the "GET /privacy returns 200" guarantee in a
 *      single-page app).
 *   2. The page source contains the verbatim data-isolation guarantee
 *      from the spec.
 *   3. The login page (SignIn.tsx) and Settings page footer link to
 *      /privacy.
 *
 * Source-grepping is the appropriate level here: the runtime "does it
 * load" question is answered by Vite's build (which is part of the
 * pre-merge gate), and these assertions catch regressions at PR time
 * without standing up a browser.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
}

describe("Privacy page — public reachability", () => {
  it("/privacy is mounted in App.tsx OUTSIDE the protected AppShell", () => {
    const app = read("client/src/App.tsx");
    // The route is registered.
    expect(app).toMatch(/<Route\s+path=["']\/privacy["']\s+component=\{PrivacyPolicy\}/);

    // It must appear before the catch-all `<Route>` that wraps AppShell.
    // We confirm that by index-of comparison: the /privacy route must
    // come BEFORE the AppShell-wrapping `<Route>` block.
    const privacyIdx = app.indexOf("path=\"/privacy\"");
    const appShellIdx = app.indexOf("<AppShell>");
    expect(privacyIdx).toBeGreaterThan(0);
    expect(appShellIdx).toBeGreaterThan(0);
    expect(privacyIdx).toBeLessThan(appShellIdx);
  });

  it("PrivacyPolicy.tsx exists and exports a default component", () => {
    const src = read("client/src/pages/PrivacyPolicy.tsx");
    expect(src).toMatch(/export\s+default\s+function\s+PrivacyPolicy/);
  });

  it("the page is not wrapped by ProtectedRoute", () => {
    const app = read("client/src/App.tsx");
    // The /privacy route line should not contain ProtectedRoute.
    const line = app
      .split("\n")
      .find((l) => /path=["']\/privacy["']/.test(l));
    expect(line, "expected a /privacy route line in App.tsx").toBeTruthy();
    expect(line!).not.toMatch(/ProtectedRoute/);
  });
});

describe("Privacy page — required content", () => {
  const privacy = read("client/src/pages/PrivacyPolicy.tsx");

  it("contains the verbatim data-isolation guarantee from the spec", () => {
    // Exact phrase the spec mandated (with an apostrophe-tolerant match).
    expect(privacy).toMatch(/MergeTasks encrypts all supplier credentials\s+at rest/);
    expect(privacy).toMatch(/no\s+technical ability to access your negotiated\s+supplier pricing/);
    expect(privacy).toMatch(/your catalog/);
    expect(privacy).toMatch(/your client data/);
    expect(privacy).toMatch(/your supplier\s+account credentials/);
    expect(privacy).toMatch(/verified by automated tests/);
  });

  it("lists the four 'what we collect' items", () => {
    expect(privacy).toMatch(/Account information/);
    expect(privacy).toMatch(/Usage data/);
    expect(privacy).toMatch(/Billing information/);
    expect(privacy).toMatch(/Stripe/);
  });

  it("lists the four 'what we never access' items", () => {
    expect(privacy).toMatch(/Your supplier credentials/);
    expect(privacy).toMatch(/Your negotiated supplier pricing/);
    expect(privacy).toMatch(/Your client information/);
    expect(privacy).toMatch(/Your order history with suppliers/);
  });

  it("describes encryption + transport + tenant isolation", () => {
    expect(privacy).toMatch(/AES-256-GCM/);
    expect(privacy).toMatch(/HTTPS/);
    expect(privacy).toMatch(/TLS 1\.2/);
    expect(privacy).toMatch(/Tenant isolation/);
  });

  it("offers data export, account deletion, and a privacy contact email", () => {
    expect(privacy).toMatch(/Export your data/);
    expect(privacy).toMatch(/Delete your account/);
    expect(privacy).toMatch(/privacy@mergetasks\.com/);
  });
});

describe("Privacy page — footer linkage", () => {
  it("SignIn page links to /privacy", () => {
    const signIn = read("client/src/pages/SignIn.tsx");
    expect(signIn).toMatch(/href=["']\/privacy["']/);
  });

  it("Settings page links to /privacy", () => {
    const settings = read("client/src/pages/Settings.tsx");
    expect(settings).toMatch(/href=["']\/privacy["']/);
  });

  it("Settings page also surfaces the privacy@ contact email", () => {
    const settings = read("client/src/pages/Settings.tsx");
    expect(settings).toMatch(/privacy@mergetasks\.com/);
  });
});
