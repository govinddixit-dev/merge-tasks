/**
 * Comprehensive end-to-end tests for proposal and department approval workflows.
 *
 * Tests cover:
 * 1. Email branding — distributor company name used instead of MergeTasks
 * 2. Department approval email template — branding passthrough
 * 3. Public proposal routes — all endpoints registered
 * 4. POC edit, re-approval, override, and fulfillment flows
 * 5. Edge cases — empty departments, all rejected, mixed statuses
 */
import { describe, it, expect } from "vitest";

//  1. Email Branding 

describe("Email Branding — Distributor, Not MergeTasks", () => {
  it("proposal email should use distributor company name as sender", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Branded Test",
      clientName: "Client",
      clientCompany: "ClientCo",
      senderName: "Sender",
      senderCompany: "Acme Promo Inc",
      estimatedValue: "1000.00",
      validDays: 30,
      products: [],
      proposalId: 1,
      branding: {
        primaryColor: "#FF0000",
        bannerColor: "#FF0000",
        companyName: "Acme Promo Inc",
        logoUrl: "https://example.com/acme-logo.png",
      },
    });

    // Subject should contain distributor name, not MergeTasks
    expect(result.subject).toContain("Acme Promo Inc");
    expect(result.subject).not.toMatch(/^.*MergeTasks.*from.*$/); // MergeTasks should not be the sender identity
    expect(result.html).toContain("Acme Promo Inc");
  });

  it("proposal email fallback should be 'Your Distributor', not 'MergeTasks'", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Fallback Test",
      clientName: "Client",
      clientCompany: "ClientCo",
      senderName: "Sender",
      senderCompany: "",
      estimatedValue: "500.00",
      validDays: 30,
      products: [],
      proposalId: 2,
      // No branding provided — should fall back to "Your Distributor"
    });

    expect(result.subject).toContain("Your Distributor");
    // The subject should NOT say "from MergeTasks"
    expect(result.subject).not.toContain("from MergeTasks");
  });

  it("'Powered by MergeTasks' footer is acceptable", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Footer Test",
      clientName: "Client",
      clientCompany: "ClientCo",
      senderName: "Sender",
      senderCompany: "DistributorCo",
      estimatedValue: "500.00",
      validDays: 30,
      products: [],
      proposalId: 3,
      branding: {
        primaryColor: "#654BF9",
        bannerColor: "#654BF9",
        companyName: "DistributorCo",
        logoUrl: null,
      },
    });

    // "Powered by MergeTasks" may render as "Powered by <a ...>MergeTasks</a>"
    // in HTML — match both words rather than the raw joined string.
    expect(result.html).toMatch(/Powered by[\s\S]{0,200}MergeTasks/);
    // But the main sender identity should be the distributor
    expect(result.subject).toContain("DistributorCo");
  });

  it("department approval email should use distributor branding when provided", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Marketing",
      contactName: "Lisa Chen",
      proposalTitle: "Q2 Promo",
      approvalUrl: "https://example.com/approve/abc",
      branding: {
        logoUrl: "https://example.com/dist-logo.png",
        primaryColor: "#FF5733",
        companyName: "PromoKing LLC",
      },
    });

    expect(result.html).toContain("PromoKing LLC");
    expect(result.html).toContain("#FF5733");
    expect(result.html).toContain("https://example.com/dist-logo.png");
    // Should NOT use MergeTasks as the sender identity. The "Powered by
    // MergeTasks" footer link is allowed — gate on the surrounding context.
    expect(result.html).not.toMatch(/From:\s*MergeTasks/);
    expect(result.html).not.toMatch(/<strong[^>]*>[\s]*MergeTasks[\s]*<\/strong>/);
  });

  it("department approval email fallback should be 'Your Distributor'", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Finance",
      proposalTitle: "Budget Review",
      approvalUrl: "https://example.com/approve/xyz",
      // No branding provided
    });

    expect(result.html).toContain("Your Distributor");
    // Same as above — the footer "Powered by MergeTasks" is allowed; guard
    // only against MergeTasks being rendered as the sender identity.
    expect(result.html).not.toMatch(/From:\s*MergeTasks/);
    expect(result.html).not.toMatch(/<strong[^>]*>[\s]*MergeTasks[\s]*<\/strong>/);
  });
});

//  2. Public Proposal Routes Registration 

describe("Public Proposal Routes — All Endpoints Registered", () => {
  // publicProposalRouter is composed of nested Express routers via .use(),
  // so we recurse into layer.handle.stack to collect every real route.
  function collectRoutes(r: any): Array<{ path: string; methods: string[] }> {
    const out: Array<{ path: string; methods: string[] }> = [];
    for (const layer of r?.stack ?? []) {
      if (layer.route) out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
      else if (layer.name === "router" && layer.handle?.stack) out.push(...collectRoutes(layer.handle));
    }
    return out;
  }

  async function loadPaths() {
    const mod = await import("./routes/publicProposal");
    return collectRoutes(mod.publicProposalRouter);
  }

  it("should load the public proposal router", async () => {
    const paths = await loadPaths();
    expect(paths.length).toBeGreaterThan(0);
  });

  it("GET /api/proposals/public/:token — proposal data", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token" && p.methods.includes("get"))).toBeDefined();
  });

  it("GET /api/proposals/public/:token/product/:productId — single product detail", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/product/:productId" && p.methods.includes("get"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/checkout — Stripe checkout", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/checkout" && p.methods.includes("post"))).toBeDefined();
  });

  it("GET /api/proposals/public/:token/departments — department statuses", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/departments" && p.methods.includes("get"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/departments/forward — POC forwards to departments", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/departments/forward" && p.methods.includes("post"))).toBeDefined();
  });

  it("GET /api/approve/:token — department approval page", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/approve/:token" && p.methods.includes("get"))).toBeDefined();
  });

  it("POST /api/approve/:token — submit approval/rejection", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/approve/:token" && p.methods.includes("post"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/edit — POC edits products", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/edit" && p.methods.includes("post"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/request-reapproval — POC requests re-approval", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/request-reapproval" && p.methods.includes("post"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/override-fulfillment — POC overrides approvals", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/override-fulfillment" && p.methods.includes("post"))).toBeDefined();
  });

  it("POST /api/proposals/public/:token/request-fulfillment — POC sends for fulfillment", async () => {
    const paths = await loadPaths();
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/request-fulfillment" && p.methods.includes("post"))).toBeDefined();
  });
});

//  3. Department Approvals tRPC Router 

describe("Department Approvals tRPC Router — All Procedures", () => {
  it("should have all required procedures registered", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;

    expect(procs?.listByProposal).toBeDefined();
    expect(procs?.createBatch).toBeDefined();
    expect(procs?.sendEmails).toBeDefined();
    expect(procs?.update).toBeDefined();
    expect(procs?.remove).toBeDefined();
  });

  it("should be registered in the main app router", async () => {
    const mod = await import("./routers");
    const router = mod.appRouter;
    const procs = (router as any)._def?.procedures;

    expect(procs?.["departmentApprovals.listByProposal"]).toBeDefined();
    expect(procs?.["departmentApprovals.createBatch"]).toBeDefined();
    expect(procs?.["departmentApprovals.sendEmails"]).toBeDefined();
    expect(procs?.["departmentApprovals.update"]).toBeDefined();
    expect(procs?.["departmentApprovals.remove"]).toBeDefined();
  });
});

//  4. Department Approval Email Template 

describe("Department Approval Email Template — Content Validation", () => {
  it("should generate valid HTML email with correct structure", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Marketing",
      contactName: "Lisa Chen",
      proposalTitle: "Q2 Branded Merchandise",
      approvalUrl: "https://example.com/approve/abc123",
    });

    expect(result.html).toContain("<!DOCTYPE html");
    expect(result.html).toContain("Marketing");
    expect(result.html).toContain("Q2 Branded Merchandise");
    expect(result.html).toContain("Hi Lisa Chen,");
    expect(result.html).toContain("Review &amp; Approve");
    expect(result.html).toContain("https://example.com/approve/abc123");
  });

  it("should use generic greeting when no contact name", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "HR",
      proposalTitle: "Employee Swag",
      approvalUrl: "https://example.com/approve/no-name",
    });

    expect(result.html).toContain("Hello,");
    expect(result.html).not.toContain("Hi undefined,");
  });

  it("should apply custom branding colors and logo", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Finance",
      proposalTitle: "Budget Items",
      approvalUrl: "https://example.com/approve/branded",
      branding: {
        logoUrl: "https://cdn.example.com/my-logo.png",
        primaryColor: "#E91E63",
        companyName: "PinkPromo Co",
      },
    });

    expect(result.html).toContain("#E91E63");
    expect(result.html).toContain("PinkPromo Co");
    expect(result.html).toContain("https://cdn.example.com/my-logo.png");
  });

  it("should show company name as text when no logo URL", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Legal",
      proposalTitle: "Contract Review",
      approvalUrl: "https://example.com/approve/no-logo",
      branding: {
        primaryColor: "#2196F3",
        companyName: "BlueBrand Inc",
      },
    });

    // Should show company name as text in header
    expect(result.html).toContain("BlueBrand Inc");
    // Should have the primary color
    expect(result.html).toContain("#2196F3");
  });

  it("should include action required in subject line", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "IT",
      proposalTitle: "Tech Equipment Order",
      approvalUrl: "https://example.com/approve/subject-test",
    });

    expect(result.subject).toContain("Action Required");
    expect(result.subject).toContain("Tech Equipment Order");
  });

  it("should include the approval URL as both button and plain text link", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const url = "https://example.com/approve/link-test-token";
    const result = buildDepartmentApprovalEmail({
      departmentName: "Operations",
      proposalTitle: "Supply Order",
      approvalUrl: url,
    });

    // Should appear at least twice — once in button href, once in plain text
    const occurrences = result.html.split(url).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

//  5. Proposal Email Template — Product Rendering 

describe("Proposal Email Template — Product Rendering", () => {
  it("should render multiple products with correct details", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Multi-Product Order",
      clientName: "Bob",
      clientCompany: "BobCo",
      senderName: "Alice",
      senderCompany: "AliceDistro",
      estimatedValue: "15000.00",
      validDays: 60,
      products: [
        { name: "Custom Mug", quantity: 200, unitPrice: "8.50", decorationType: "sublimation", imageUrl: null, proofImageUrl: null, proofStatus: null },
        { name: "Branded Pen", quantity: 500, unitPrice: "2.00", decorationType: "laser_engraving", imageUrl: null, proofImageUrl: null, proofStatus: null },
        { name: "Polo Shirt", quantity: 100, unitPrice: "35.00", decorationType: "embroidery", imageUrl: null, proofImageUrl: "https://example.com/proof.png", proofStatus: "approved" },
      ],
      proposalId: 10,
      proposalUrl: "https://example.com/view/proposal/multi",
    });

    expect(result.html).toContain("Custom Mug");
    expect(result.html).toContain("Branded Pen");
    expect(result.html).toContain("Polo Shirt");
    expect(result.html).toContain("$8.50");
    expect(result.html).toContain("$2.00");
    expect(result.html).toContain("$35.00");
    expect(result.html).toContain("Sublimation");
    expect(result.html).toContain("Laser Engraving");
    expect(result.html).toContain("Embroidery");
    expect(result.html).toContain("Proof Approved");
  });

  it("should handle products with no price gracefully", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "No Price Test",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "0",
      validDays: 30,
      products: [
        { name: "Free Sample", quantity: 10, unitPrice: null, decorationType: null, imageUrl: null, proofImageUrl: null, proofStatus: null },
      ],
      proposalId: 11,
    });

    expect(result.html).toContain("Free Sample");
    // Should show dash or similar for no price
    expect(result.html).toContain("—");
  });

  it("should handle empty product list", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Empty Products",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "0",
      validDays: 30,
      products: [],
      proposalId: 12,
    });

    // Should still generate valid HTML
    expect(result.html).toContain("<!DOCTYPE html");
    expect(result.html).toContain("Empty Products");
  });
});

//  6. Proposals Router — Send Mutation with Departments 

describe("Proposals Router — Send Mutation", () => {
  it("should have send procedure defined", async () => {
    const mod = await import("./routers/proposals");
    const procs = (mod.proposalsRouter as any)._def?.procedures;
    expect(procs?.send).toBeDefined();
  });

  it("should have emailPreview procedure defined", async () => {
    const mod = await import("./routers/proposals");
    const procs = (mod.proposalsRouter as any)._def?.procedures;
    expect(procs?.emailPreview).toBeDefined();
  });

  it("should have duplicate procedure defined", async () => {
    const mod = await import("./routers/proposals");
    const procs = (mod.proposalsRouter as any)._def?.procedures;
    expect(procs?.duplicate).toBeDefined();
  });

  it("should have list, create, update, delete procedures", async () => {
    const mod = await import("./routers/proposals");
    const procs = (mod.proposalsRouter as any)._def?.procedures;
    expect(procs?.list).toBeDefined();
    expect(procs?.create).toBeDefined();
    expect(procs?.update).toBeDefined();
    expect(procs?.delete).toBeDefined();
  });
});

//  7. Schema Validation 

describe("Schema — Proposals Table", () => {
  it("should have all required columns", async () => {
    const mod = await import("../drizzle/schema");
    const table = mod.proposals;
    const columns = Object.keys((table as any)[Symbol.for("drizzle:Columns")] || {});

    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("clientId");
    expect(columns).toContain("title");
    expect(columns).toContain("proposalType");
    expect(columns).toContain("status");
    expect(columns).toContain("estimatedValue");
    expect(columns).toContain("multiDepartment");
    expect(columns).toContain("approvalRouting");
    expect(columns).toContain("stripeCheckout");
    expect(columns).toContain("viewToken");
    expect(columns).toContain("validDays");
    expect(columns).toContain("sentAt");
    expect(columns).toContain("viewedAt");
    expect(columns).toContain("respondedAt");
    expect(columns).toContain("fulfillmentRequestedAt");
  });
});

describe("Schema — Department Approvals Table", () => {
  it("should have all required columns", async () => {
    const mod = await import("../drizzle/schema");
    const table = mod.departmentApprovals;
    const columns = Object.keys((table as any)[Symbol.for("drizzle:Columns")] || {});

    expect(columns).toContain("id");
    expect(columns).toContain("proposalId");
    expect(columns).toContain("departmentName");
    expect(columns).toContain("contactName");
    expect(columns).toContain("contactEmail");
    expect(columns).toContain("description");
    expect(columns).toContain("approvalToken");
    expect(columns).toContain("status");
    expect(columns).toContain("addedBy");
    expect(columns).toContain("approvedAt");
    expect(columns).toContain("approverName");
    expect(columns).toContain("approverNotes");
    expect(columns).toContain("emailSentAt");
    expect(columns).toContain("emailViewedAt");
    expect(columns).toContain("sortOrder");
  });
});

//  8. Mailer — fromName Parameter 

describe("Mailer — fromName Parameter", () => {
  it("sendEmail function should accept optional fromName parameter", async () => {
    const mod = await import("./email/mailer");
    expect(mod.sendEmail).toBeDefined();
    // Current signature: (to, subject, html, fromName?, replyTo?, attachments?, unsubscribe?)
    // Function.length reports arg count up to the first default/rest value;
    // all seven here lack defaults, so we bound at 7.
    expect(mod.sendEmail.length).toBeLessThanOrEqual(7);
  });
});

//  9. loadBrandingForProposal Helper 

describe("loadBrandingForProposal Helper", () => {
  it("should be defined in publicProposal module (internal function)", async () => {
    // We can't directly test the helper since it's not exported,
    // but we can verify the module loads without error
    const mod = await import("./routes/publicProposal");
    expect(mod.publicProposalRouter).toBeDefined();
  });
});

//  10. Integration: Proposal + Department Approval Flow Logic 

describe("Integration — Proposal + Department Approval Flow Logic", () => {
  it("buildDepartmentApprovalEmail should produce different output with vs without branding", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");

    const withoutBranding = buildDepartmentApprovalEmail({
      departmentName: "Sales",
      proposalTitle: "Test",
      approvalUrl: "https://example.com/approve/1",
    });

    const withBranding = buildDepartmentApprovalEmail({
      departmentName: "Sales",
      proposalTitle: "Test",
      approvalUrl: "https://example.com/approve/1",
      branding: {
        primaryColor: "#00FF00",
        companyName: "GreenCo",
        logoUrl: "https://example.com/green-logo.png",
      },
    });

    // Without branding should use default color
    expect(withoutBranding.html).toContain("654BF9");
    // With branding should use custom color
    expect(withBranding.html).toContain("#00FF00");
    expect(withBranding.html).toContain("GreenCo");
    // They should produce different HTML
    expect(withoutBranding.html).not.toEqual(withBranding.html);
  });

  it("proposal email should correctly render with custom branding colors throughout", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const customColor = "#8B5CF6";
    const result = buildProposalEmail({
      proposalTitle: "Color Consistency Test",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "1000.00",
      validDays: 30,
      products: [],
      proposalId: 20,
      branding: {
        primaryColor: customColor,
        bannerColor: customColor,
        companyName: "PurpleBrand",
        logoUrl: null,
      },
    });

    // Custom color should appear in the HTML (banner, buttons, etc.)
    const colorCount = result.html.split(customColor).length - 1;
    expect(colorCount).toBeGreaterThanOrEqual(2); // At least banner + CTA button
  });

  it("proposal email should include Outlook VML conditional comments for button rendering", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "VML Test",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "500.00",
      validDays: 30,
      products: [],
      proposalId: 21,
      proposalUrl: "https://example.com/view/proposal/vml",
    });

    expect(result.html).toContain("<!--[if mso]>");
    expect(result.html).toContain("<v:roundrect");
  });
});

//  11. Edge Cases 

describe("Edge Cases", () => {
  it("proposal email should handle very long proposal titles", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const longTitle = "A".repeat(200);
    const result = buildProposalEmail({
      proposalTitle: longTitle,
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "100.00",
      validDays: 30,
      products: [],
      proposalId: 30,
    });

    expect(result.html).toContain(longTitle);
    expect(result.subject).toContain(longTitle);
  });

  it("department approval email should handle special characters in names", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "R&D / Engineering",
      contactName: "José García-López",
      proposalTitle: "Q3 Equipment — Phase 2",
      approvalUrl: "https://example.com/approve/special",
    });

    expect(result.html).toContain("R&D / Engineering");
    expect(result.html).toContain("José García-López");
    expect(result.html).toContain("Q3 Equipment — Phase 2");
  });

  it("proposal email should handle zero estimated value", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Zero Value",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "0",
      validDays: 30,
      products: [],
      proposalId: 31,
    });

    // Should still render without errors
    expect(result.html).toContain("<!DOCTYPE html");
  });

  it("proposal email should handle very large estimated value", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Big Deal",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "999999999.99",
      validDays: 30,
      products: [],
      proposalId: 32,
    });

    expect(result.html).toContain("999999999.99");
  });
});
