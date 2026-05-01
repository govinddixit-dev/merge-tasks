import { describe, it, expect } from "vitest";
/**
 * Validates that Google OAuth credentials are properly configured
 * and the Google OAuth discovery endpoint is reachable.
 *
 * NOTE: These tests require real environment variables to be set in production.
 * They are skipped in CI/sandbox environments where env vars are not configured.
 *
 * The single live-network probe (the discovery-document fetch) is gated behind
 * RUN_LIVE_NETWORK_TESTS=true so default unit-test runs stay hermetic. Set the
 * env var to opt in during integration runs.
 */
describe("Google OAuth Credentials Validation", () => {
  const hasGoogleCreds = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const runLiveNetwork = process.env.RUN_LIVE_NETWORK_TESTS === "true";

  it("should have GOOGLE_CLIENT_ID configured", () => {
    if (!hasGoogleCreds) {
      // In sandbox/CI without real creds, just verify the env var key exists in .env.example
      console.log("SKIP: GOOGLE_CLIENT_ID not set in this environment");
      return;
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId).not.toBe("");
    expect(clientId).toContain(".apps.googleusercontent.com");
  });

  it("should have GOOGLE_CLIENT_SECRET configured", () => {
    if (!hasGoogleCreds) {
      console.log("SKIP: GOOGLE_CLIENT_SECRET not set in this environment");
      return;
    }
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret).not.toBe("");
    expect(clientSecret!.startsWith("GOCSPX-")).toBe(true);
    expect(clientSecret!.length).toBeGreaterThan(20);
  });

  it.skipIf(!runLiveNetwork)("should be able to reach Google OAuth token endpoint [live network]", async () => {
    // Live network probe — opt in via RUN_LIVE_NETWORK_TESTS=true
    const res = await fetch("https://accounts.google.com/.well-known/openid-configuration");
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.authorization_endpoint).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(data.token_endpoint).toContain("oauth2");
  });

  describe("RUN_LIVE_NETWORK_TESTS gate", () => {
    /** Decoupled from the surrounding closure so we can re-evaluate after mutating env. */
    function isLiveGateOpen(env: NodeJS.ProcessEnv = process.env): boolean {
      return env.RUN_LIVE_NETWORK_TESTS === "true";
    }

    it("default run skips the live network test (gate closed)", () => {
      const original = process.env.RUN_LIVE_NETWORK_TESTS;
      delete process.env.RUN_LIVE_NETWORK_TESTS;
      try {
        expect(isLiveGateOpen()).toBe(false);
      } finally {
        if (original !== undefined) process.env.RUN_LIVE_NETWORK_TESTS = original;
      }
    });

    it("flagged run executes the live network test (gate open)", () => {
      const original = process.env.RUN_LIVE_NETWORK_TESTS;
      process.env.RUN_LIVE_NETWORK_TESTS = "true";
      try {
        expect(isLiveGateOpen()).toBe(true);
      } finally {
        if (original === undefined) delete process.env.RUN_LIVE_NETWORK_TESTS;
        else process.env.RUN_LIVE_NETWORK_TESTS = original;
      }
    });

    it("non-true values (e.g. '1', 'yes') keep the gate closed", () => {
      const original = process.env.RUN_LIVE_NETWORK_TESTS;
      try {
        for (const v of ["1", "yes", "TRUE", ""]) {
          process.env.RUN_LIVE_NETWORK_TESTS = v;
          expect(isLiveGateOpen()).toBe(false);
        }
      } finally {
        if (original === undefined) delete process.env.RUN_LIVE_NETWORK_TESTS;
        else process.env.RUN_LIVE_NETWORK_TESTS = original;
      }
    });
  });

  it("should generate a valid Google OAuth URL with the configured client ID", () => {
    if (!hasGoogleCreds) {
      console.log("SKIP: GOOGLE_CLIENT_ID not set in this environment");
      return;
    }
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const origin = "https://app.mergetasks.com";
    const redirectUri = `${origin}/api/auth/google/callback`;
    const scope = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
    const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    expect(url.toString()).toContain(clientId.split(".")[0]);
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.mergetasks.com/api/auth/google/callback");
  });
});
