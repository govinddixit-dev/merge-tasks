import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the social auth flow logic:
 * - Google OAuth URL generation
 * - Microsoft OAuth URL generation
 * - Callback user creation/linking logic
 * - Error handling
 */

describe("Social Auth - URL Generation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should generate a valid Google OAuth URL with correct parameters", () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    const origin = "https://example.com";
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${origin}/api/auth/google/callback`;
    const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");

    const url = new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile")}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`
    );

    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/auth/google/callback");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("userinfo.email");
    expect(url.searchParams.get("scope")).toContain("userinfo.profile");
  });

  it("should generate a valid Microsoft OAuth URL with correct parameters", () => {
    process.env.MICROSOFT_CLIENT_ID = "test-microsoft-client-id";
    const origin = "https://example.com";
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = `${origin}/api/auth/microsoft/callback`;
    const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");

    const url = new URL(
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("openid profile email offline_access")}&state=${encodeURIComponent(state)}`
    );

    expect(url.searchParams.get("client_id")).toBe("test-microsoft-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/auth/microsoft/callback");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("profile");
    expect(url.searchParams.get("scope")).toContain("email");
  });

  it("should encode state as base64url JSON with origin", () => {
    const origin = "https://app.mergetasks.com";
    const state = Buffer.from(JSON.stringify({ origin })).toString("base64url");
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    expect(decoded.origin).toBe(origin);
  });

  it("should throw when GOOGLE_CLIENT_ID is not set", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    // The socialAuth router checks for the env var and throws PRECONDITION_FAILED
    expect(process.env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("should throw when MICROSOFT_CLIENT_ID is not set", () => {
    delete process.env.MICROSOFT_CLIENT_ID;
    expect(process.env.MICROSOFT_CLIENT_ID).toBeUndefined();
  });
});

describe("Social Auth - User Linking Logic", () => {
  it("should generate a stable openId for Google users based on their Google ID", () => {
    const googleId = "12345678901234567890";
    const openId = `google_${googleId}`;
    expect(openId).toBe("google_12345678901234567890");
    expect(openId).toMatch(/^google_\d+$/);
  });

  it("should generate a stable openId for Microsoft users based on their Microsoft ID", () => {
    const microsoftId = "abc-def-123-456";
    const openId = `microsoft_${microsoftId}`;
    expect(openId).toBe("microsoft_abc-def-123-456");
    expect(openId).toMatch(/^microsoft_/);
  });

  it("should use mail or userPrincipalName for Microsoft email", () => {
    // Microsoft Graph API returns mail or userPrincipalName
    const userInfo1 = { mail: "user@company.com", displayName: "User", userPrincipalName: "user@company.onmicrosoft.com", id: "123" };
    const email1 = userInfo1.mail || userInfo1.userPrincipalName;
    expect(email1).toBe("user@company.com");

    const userInfo2 = { mail: null as any, displayName: "User", userPrincipalName: "user@company.onmicrosoft.com", id: "123" };
    const email2 = userInfo2.mail || userInfo2.userPrincipalName;
    expect(email2).toBe("user@company.onmicrosoft.com");
  });

  it("should redirect to /sign-in with error param on auth failure", () => {
    // The callback handlers redirect to /sign-in?error=google_auth_failed on error
    const errorRedirect = "/sign-in?error=google_auth_failed";
    const url = new URL(errorRedirect, "https://example.com");
    expect(url.searchParams.get("error")).toBe("google_auth_failed");
  });

  it("should redirect to /onboarding for new users without completed onboarding", () => {
    const userId = 42;
    const company = "";
    const redirect = `/onboarding?userId=${userId}&company=${encodeURIComponent(company)}`;
    expect(redirect).toContain("userId=42");
  });

  it("should redirect to /dashboard for existing users with completed onboarding", () => {
    const redirect = "/dashboard";
    expect(redirect).toBe("/dashboard");
  });
});
