/**
 * Email & Notification Test Suite
 * Tests all email templates, content correctness, branding, and token security.
 * No real SMTP required — tests the template logic and content directly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildProposalSentEmail,
  buildStoreApprovalRequestEmail,
  buildStoreApprovedEmail,
  buildStoreChangesRequestedEmail,
  buildStoreInviteEmail,
  buildVerificationCodeEmail,
  buildDeptApprovalRequestEmail,
  buildOrderShippedEmail,
  buildFulfillmentApprovedEmail,
  buildEmailHtml,
} from "./email/emailTemplates";

// ─── Mock ENV ─────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    jwtSecret: "test-jwt-secret-32-chars-minimum!!",
    sessionSecret: "test-session-secret",
    databaseUrl: undefined,
    openaiApiKey: "sk-test-openai",
    stripeSecretKey: undefined,
  },
}));

// ─── Proposal Email Tests ─────────────────────────────────────────────────────
describe("Email Templates — Proposal Sent", () => {
  const baseOpts = {
    distributorName: "ABC Promotions",
    clientName: "John Smith",
    proposalTitle: "Q4 Branded Merchandise",
    viewUrl: "https://app.mergetasks.com/p/view/abc123viewtoken",
  };

  it("proposal email contains distributor name", () => {
    const { html } = buildProposalSentEmail(baseOpts);
    expect(html).toContain("ABC Promotions");
  });

  it("proposal email contains client name", () => {
    const { html } = buildProposalSentEmail(baseOpts);
    expect(html).toContain("John Smith");
  });

  it("proposal email contains proposal title", () => {
    const { html } = buildProposalSentEmail(baseOpts);
    expect(html).toContain("Q4 Branded Merchandise");
  });

  it("proposal email contains view URL with token", () => {
    const { html } = buildProposalSentEmail(baseOpts);
    expect(html).toContain("abc123viewtoken");
    expect(html).toContain("https://app.mergetasks.com/p/view/");
  });

  it("proposal email is valid HTML (has html/body tags)", () => {
    const { html } = buildProposalSentEmail(baseOpts);
    expect(html.toLowerCase()).toContain("<html");
    expect(html.toLowerCase()).toContain("</html>");
  });

  it("proposal email with personal message includes the message", () => {
    const { html } = buildProposalSentEmail({
      ...baseOpts,
      personalMessage: "Hi John, here is your custom proposal!",
    });
    expect(html).toContain("Hi John, here is your custom proposal!");
  });

  it("proposal email with branding uses custom company name", () => {
    const { html } = buildProposalSentEmail({
      ...baseOpts,
      branding: {
        lane: "distributor",
        companyName: "ABC Promotions LLC",
        primaryColor: "#1a73e8",
      },
    });
    expect(html).toContain("ABC Promotions LLC");
  });
});

// ─── Store Approval Email Tests ───────────────────────────────────────────────
describe("Email Templates — Store Approval Request", () => {
  const baseOpts = {
    clientName: "Acme Corp",
    storeName: "Chicago Bears Fan Store",
    distributorName: "XYZ Merch",
    approvalUrl: "https://app.mergetasks.com/approve/store/token123",
    branding: {
      companyName: "XYZ Merch",
      primaryColor: "#6B21A8",
    },
  };

  it("store approval email contains store name", () => {
    const { html } = buildStoreApprovalRequestEmail(baseOpts);
    expect(html).toContain("Chicago Bears Fan Store");
  });

  it("store approval email contains approval URL", () => {
    const { html } = buildStoreApprovalRequestEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/approve/store/token123");
  });

  it("store approval email contains distributor name", () => {
    const { html } = buildStoreApprovalRequestEmail(baseOpts);
    expect(html).toContain("XYZ Merch");
  });

  it("store approval email is valid HTML", () => {
    const { html } = buildStoreApprovalRequestEmail(baseOpts);
    expect(html.toLowerCase()).toContain("<html");
  });
});

// ─── Store Approved Email Tests ───────────────────────────────────────────────
describe("Email Templates — Store Approved", () => {
  const baseOpts = {
    distributorName: "XYZ Merch",
    clientCompany: "Acme Corp",
    storeName: "Chicago Bears Fan Store",
    approverName: "Jane Smith",
    launchUrl: "https://store.mergetasks.com/chicago-bears-fan-store",
  };

  it("store approved email contains store URL", () => {
    const { html } = buildStoreApprovedEmail(baseOpts);
    expect(html).toContain("chicago-bears-fan-store");
  });

  it("store approved email contains distributor name", () => {
    const { html } = buildStoreApprovedEmail(baseOpts);
    expect(html).toContain("XYZ Merch");
  });

  it("store approved email contains store name", () => {
    const { html } = buildStoreApprovedEmail(baseOpts);
    expect(html).toContain("Chicago Bears Fan Store");
  });

  it("store approved email contains approver name", () => {
    const { html } = buildStoreApprovedEmail(baseOpts);
    expect(html).toContain("Jane Smith");
  });
});

// ─── Store Changes Requested Email Tests ──────────────────────────────────────
describe("Email Templates — Store Changes Requested", () => {
  const baseOpts = {
    distributorName: "XYZ Merch",
    clientCompany: "Acme Corp",
    storeName: "Chicago Bears Fan Store",
    approverName: "Jane Smith",
    notes: "Please update the logo and remove the red background.",
    editUrl: "https://app.mergetasks.com/stores/123/edit",
  };

  it("changes requested email contains feedback notes", () => {
    const { html } = buildStoreChangesRequestedEmail(baseOpts);
    expect(html).toContain("Please update the logo and remove the red background.");
  });

  it("changes requested email contains edit URL", () => {
    const { html } = buildStoreChangesRequestedEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/stores/123/edit");
  });

  it("changes requested email contains approver name", () => {
    const { html } = buildStoreChangesRequestedEmail(baseOpts);
    expect(html).toContain("Jane Smith");
  });
});

// ─── Verification Code Email Tests ────────────────────────────────────────────
describe("Email Templates — Verification Code", () => {
  it("welcome email contains the verification code", () => {
    const { html } = buildVerificationCodeEmail({
      code: "847291",
      type: "welcome",
    });
    expect(html).toContain("847291");
  });

  it("login email contains the verification code", () => {
    const { html } = buildVerificationCodeEmail({
      code: "123456",
      type: "login",
    });
    expect(html).toContain("123456");
  });

  it("store login email contains the verification code and store branding", () => {
    const { html } = buildVerificationCodeEmail({
      code: "999888",
      type: "store_login",
      storeName: "My Brand Store",
      branding: {
        lane: "store",
        companyName: "My Brand Store",
        primaryColor: "#FF5733",
      },
    });
    expect(html).toContain("999888");
    expect(html).toContain("My Brand Store");
  });

  it("verification code is 6 digits", () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });

  it("two generated codes are statistically different", () => {
    const codes = new Set(
      Array.from({ length: 20 }, () =>
        Math.floor(100000 + Math.random() * 900000).toString()
      )
    );
    expect(codes.size).toBeGreaterThan(15);
  });
});

// ─── Department Approval Email Tests ──────────────────────────────────────────
describe("Email Templates — Department Approval Request", () => {
  const baseOpts = {
    approverName: "Jane Doe",
    departmentName: "Marketing",
    clientCompany: "Acme Corp",
    proposalTitle: "Q4 Branded Merchandise",
    approveUrl: "https://app.mergetasks.com/dept/approve/token456",
    declineUrl: "https://app.mergetasks.com/dept/decline/token456",
  };

  it("dept approval email contains proposal title", () => {
    const { html } = buildDeptApprovalRequestEmail(baseOpts);
    expect(html).toContain("Q4 Branded Merchandise");
  });

  it("dept approval email contains department name", () => {
    const { html } = buildDeptApprovalRequestEmail(baseOpts);
    expect(html).toContain("Marketing");
  });

  it("dept approval email contains approve URL", () => {
    const { html } = buildDeptApprovalRequestEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/dept/approve/token456");
  });

  it("dept approval email contains approver name", () => {
    const { html } = buildDeptApprovalRequestEmail(baseOpts);
    expect(html).toContain("Jane Doe");
  });

  it("dept approval email contains decline URL", () => {
    const { html } = buildDeptApprovalRequestEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/dept/decline/token456");
  });
});

// ─── Order Shipped Email Tests ────────────────────────────────────────────────
describe("Email Templates — Order Shipped", () => {
  const baseOpts = {
    orderNumber: "ORD-2024-001",
    clientName: "John Smith",
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    status: "shipped" as const,
    dashboardUrl: "https://app.mergetasks.com/orders/123",
  };

  it("order shipped email contains order number", () => {
    const { html } = buildOrderShippedEmail(baseOpts);
    expect(html).toContain("ORD-2024-001");
  });

  it("order shipped email contains tracking number", () => {
    const { html } = buildOrderShippedEmail(baseOpts);
    expect(html).toContain("1Z999AA10123456784");
  });

  it("order shipped email contains carrier name", () => {
    const { html } = buildOrderShippedEmail(baseOpts);
    expect(html).toContain("UPS");
  });

  it("order shipped email contains dashboard URL", () => {
    const { html } = buildOrderShippedEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/orders/123");
  });
});

// ─── Store Invite Email Tests ─────────────────────────────────────────────────
describe("Email Templates — Store Invite", () => {
  const baseOpts = {
    recipientName: "Bob Johnson",
    storeName: "Company Store",
    role: "buyer",
    setPasswordUrl: "https://store.mergetasks.com/company-store?invite=token789",
  };

  it("store invite email contains recipient name", () => {
    const { html } = buildStoreInviteEmail(baseOpts);
    expect(html).toContain("Bob Johnson");
  });

  it("store invite email contains store name", () => {
    const { html } = buildStoreInviteEmail(baseOpts);
    expect(html).toContain("Company Store");
  });

  it("store invite email contains invite URL", () => {
    const { html } = buildStoreInviteEmail(baseOpts);
    expect(html).toContain("token789");
  });

  it("store invite email with admin role shows admin messaging", () => {
    const { html } = buildStoreInviteEmail({ ...baseOpts, role: "admin" });
    expect(html).toContain("administrator");
  });
});

// ─── Fulfillment Approved Email Tests ─────────────────────────────────────────
describe("Email Templates — Fulfillment Approved", () => {
  const baseOpts = {
    pocName: "John Smith",
    clientCompany: "Acme Corp",
    proposalTitle: "Q4 Branded Merchandise",
    dashboardUrl: "https://app.mergetasks.com/orders/123",
  };

  it("fulfillment approved email contains proposal title", () => {
    const { html } = buildFulfillmentApprovedEmail(baseOpts);
    expect(html).toContain("Q4 Branded Merchandise");
  });

  it("fulfillment approved email contains poc name", () => {
    const { html } = buildFulfillmentApprovedEmail(baseOpts);
    expect(html).toContain("John Smith");
  });

  it("fulfillment approved email contains dashboard URL", () => {
    const { html } = buildFulfillmentApprovedEmail(baseOpts);
    expect(html).toContain("https://app.mergetasks.com/orders/123");
  });
});

// ─── Base Email HTML Builder Tests ────────────────────────────────────────────
describe("Email Templates — Base HTML Builder", () => {
  it("buildEmailHtml produces valid HTML structure", () => {
    const html = buildEmailHtml({
      headline: "Test Email",
      bodyParagraphs: ["Hello World", "Second paragraph"],
    });
    expect(html.toLowerCase()).toContain("<!doctype html");
    expect(html.toLowerCase()).toContain("<html");
    expect(html.toLowerCase()).toContain("</html>");
    expect(html).toContain("Hello World");
  });

  it("buildEmailHtml includes all body paragraphs", () => {
    const html = buildEmailHtml({
      headline: "Test",
      bodyParagraphs: ["Paragraph one", "Paragraph two", "Paragraph three"],
    });
    expect(html).toContain("Paragraph one");
    expect(html).toContain("Paragraph two");
    expect(html).toContain("Paragraph three");
  });

  it("buildEmailHtml includes the headline", () => {
    const html = buildEmailHtml({
      headline: "My Custom Headline",
      bodyParagraphs: ["Content here"],
    });
    expect(html).toContain("My Custom Headline");
  });

  it("buildEmailHtml with CTA button includes button label and URL", () => {
    const html = buildEmailHtml({
      headline: "Test",
      bodyParagraphs: ["Click below"],
      cta: { label: "View Proposal", url: "https://app.mergetasks.com/p/view/token" },
    });
    expect(html).toContain("View Proposal");
    expect(html).toContain("https://app.mergetasks.com/p/view/token");
  });

  it("buildEmailHtml with badge includes badge text", () => {
    const html = buildEmailHtml({
      headline: "Test",
      bodyParagraphs: ["Content"],
      badge: { text: "NEW PROPOSAL" },
    });
    expect(html).toContain("NEW PROPOSAL");
  });

  it("buildEmailHtml with branding uses custom company name", () => {
    const html = buildEmailHtml({
      headline: "Test",
      bodyParagraphs: ["Content"],
      branding: {
        lane: "distributor",
        companyName: "Custom Brand Co",
        primaryColor: "#FF5733",
      },
    });
    expect(html).toContain("Custom Brand Co");
  });

  it("buildEmailHtml with branding uses custom primary color", () => {
    const html = buildEmailHtml({
      headline: "Test",
      bodyParagraphs: ["Content"],
      branding: {
        lane: "distributor",
        companyName: "Brand Co",
        primaryColor: "#FF5733",
      },
    });
    expect(html).toContain("#FF5733");
  });

  it("buildEmailHtml with infoCard includes card title and meta", () => {
    const html = buildEmailHtml({
      headline: "Order Confirmed",
      bodyParagraphs: ["Your order has been placed."],
      infoCard: {
        title: "Order #ORD-2024-001",
        meta: [
          { label: "Status", value: "Processing" },
          { label: "Total", value: "$249.99" },
        ],
      },
    });
    expect(html).toContain("Order #ORD-2024-001");
    expect(html).toContain("Processing");
    expect(html).toContain("$249.99");
  });

  it("buildEmailHtml with alertBox includes alert text", () => {
    const html = buildEmailHtml({
      headline: "Warning",
      bodyParagraphs: ["Please review."],
      alertBox: { text: "This proposal expires in 24 hours.", type: "warning" },
    });
    expect(html).toContain("This proposal expires in 24 hours.");
  });
});

// ─── Mailer sendEmail Tests ───────────────────────────────────────────────────
describe("Email — sendEmail (email provider not configured)", () => {
  it("sendEmail returns sent=false when email provider not configured", async () => {
    const { sendEmail } = await import("./email/mailer");
    const result = await sendEmail(
      "test@example.com",
      "Test Subject",
      "<p>Test body</p>"
    );
    expect(result.sent).toBe(false);
    // The mailer may use SMTP or Resend depending on env. When no provider
    // env vars are set we get "... not configured". When CI sets a
    // placeholder RESEND_API_KEY (a sentinel value so import-time checks
    // don't hard-fail), the provider call reaches Resend and comes back
    // with "API key is invalid" — still sent=false, still the behaviour
    // the caller cares about. Accept either.
    expect(result.error).toMatch(/not configured|api key is invalid/i);
  });

  it("sendEmail with all params returns sent=false when email provider not configured", async () => {
    const { sendEmail } = await import("./email/mailer");
    const result = await sendEmail(
      "test@example.com",
      "Test Subject",
      "<p>Test body</p>",
      "Custom Sender",
      "reply@example.com"
    );
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/not configured|api key is invalid/i);
  });

  it("sendEmail does not throw even when SMTP is not configured", async () => {
    const { sendEmail } = await import("./email/mailer");
    await expect(
      sendEmail("test@example.com", "Subject", "<p>Body</p>")
    ).resolves.not.toThrow();
  });
});
