/**
 * Tests for public proposal routes and email preview functionality.
 */
import { describe, it, expect, vi } from "vitest";

// Test the email template builder
describe("Email Template Builder", () => {
  it("should export buildProposalEmail function", async () => {
    const mod = await import("./email/proposalEmail");
    expect(mod.buildProposalEmail).toBeDefined();
    expect(typeof mod.buildProposalEmail).toBe("function");
  });

  it("should generate HTML with subject for a standard proposal", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Test Proposal",
      clientName: "John Doe",
      clientCompany: "Acme Corp",
      senderName: "Jane Smith",
      senderCompany: "MergeTasks",
      estimatedValue: "5000.00",
      validDays: 30,
      products: [
        {
          name: "Custom T-Shirt",
          quantity: 50,
          unitPrice: "25.00",
          decorationType: "screen_print",
          imageUrl: "https://example.com/tshirt.png",
          proofImageUrl: null,
          proofStatus: null,
        },
      ],
      proposalId: 1,
      proposalUrl: "https://example.com/view/proposal/abc123",
    });

    expect(result.subject).toContain("Test Proposal");
    expect(result.html).toContain("Test Proposal");
    expect(result.html).toContain("John Doe");
    expect(result.html).toContain("Acme Corp");
    expect(result.html).toContain("Custom T-Shirt");
    expect(result.html).toContain("$5000.00");
    expect(result.html).toContain("30 days");
    expect(result.html).toContain("View Full Proposal");
  });

  it("should handle validDays=0 (no expiration) correctly", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Permanent Proposal",
      clientName: "Bob",
      clientCompany: "TestCo",
      senderName: "Alice",
      senderCompany: "MergeTasks",
      estimatedValue: "1000.00",
      validDays: 0,
      products: [],
      proposalId: 2,
    });

    expect(result.html).toContain("No Expiration");
    expect(result.html).not.toContain("0 days");
  });

  it("should include branding colors when provided", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Branded Proposal",
      clientName: "Client",
      clientCompany: "ClientCo",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "2000.00",
      validDays: 60,
      products: [],
      proposalId: 3,
      branding: {
        primaryColor: "#FF5733",
        bannerColor: "#FF5733",
        companyName: "CustomBrand",
        logoUrl: "https://example.com/logo.png",
      },
    });

    expect(result.html).toContain("#FF5733");
    expect(result.html).toContain("CustomBrand");
  });
});

describe("Public Proposal Route Module", () => {
  it("should export publicProposalRouter", async () => {
    const mod = await import("./routes/publicProposal");
    expect(mod.publicProposalRouter).toBeDefined();
  });

  it("should have GET and POST routes registered", async () => {
    const mod = await import("./routes/publicProposal");
    const router = mod.publicProposalRouter;
    // publicProposalRouter composes several sub-routers via .use(), so the
    // actual route layers live on those nested stacks — walk them.
    function collectRoutes(r: any): { path: string; methods: string[] }[] {
      const out: { path: string; methods: string[] }[] = [];
      for (const layer of r?.stack ?? []) {
        if (layer.route) out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
        else if (layer.name === "router" && layer.handle?.stack) out.push(...collectRoutes(layer.handle));
      }
      return out;
    }
    const paths = collectRoutes(router);

    const getRoute = paths.find((p) => p.path === "/api/proposals/public/:token" && p.methods.includes("get"));
    expect(getRoute).toBeDefined();

    const productRoute = paths.find((p) => p.path === "/api/proposals/public/:token/product/:productId" && p.methods.includes("get"));
    expect(productRoute).toBeDefined();

    const postRoute = paths.find((p) => p.path === "/api/proposals/public/:token/checkout" && p.methods.includes("post"));
    expect(postRoute).toBeDefined();
  });
});

describe("Proposal Email Preview Endpoint", () => {
  it("should be registered in the proposals router", async () => {
    const mod = await import("./routers/proposals");
    const router = mod.proposalsRouter;
    // Check that emailPreview procedure exists
    expect((router as any)._def?.procedures?.emailPreview || (router as any).emailPreview).toBeDefined();
  });
});

describe("Proposal Duplicate Mutation", () => {
  it("should be registered in the proposals router", async () => {
    const mod = await import("./routers/proposals");
    const router = mod.proposalsRouter;
    // Check that duplicate procedure exists
    expect((router as any)._def?.procedures?.duplicate || (router as any).duplicate).toBeDefined();
  });
});

describe("Email Logo Rendering", () => {
  it("should not set a fixed height on the logo image", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Logo Test",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "100.00",
      validDays: 30,
      products: [],
      proposalId: 99,
      branding: {
        primaryColor: "#333",
        bannerColor: "#333",
        companyName: "TestBrand",
        logoUrl: "https://example.com/logo.png",
      },
    });

    // Logo should have width attribute
    expect(result.html).toContain('width="200"');
    // height:auto should be in the inline style (not as a fixed HTML attribute)
    expect(result.html).toContain('height:auto');
    // Should have MSO DPI fix
    expect(result.html).toContain('-ms-interpolation-mode');
    // Should NOT have a fixed pixel height HTML attribute on the logo img
    // Find the logo img tag by alt text
    const logoImgMatch = result.html.match(/<img[^>]*alt="TestBrand"[^>]*>/i);
    expect(logoImgMatch).not.toBeNull();
    if (logoImgMatch) {
      // Ensure no fixed height like height="60" or height="80" (height="auto" is not a number)
      expect(logoImgMatch[0]).not.toMatch(/height="\d+"/);
    }
  });

  it("should include border=0 on all images for email client compatibility", async () => {
    const { buildProposalEmail } = await import("./email/proposalEmail");
    const result = buildProposalEmail({
      proposalTitle: "Border Test",
      clientName: "Client",
      clientCompany: "Co",
      senderName: "Sender",
      senderCompany: "SenderCo",
      estimatedValue: "100.00",
      validDays: 30,
      products: [
        {
          name: "Product",
          quantity: 10,
          unitPrice: "10.00",
          decorationType: "embroidery",
          imageUrl: "https://example.com/product.png",
          proofImageUrl: null,
          proofStatus: null,
        },
      ],
      proposalId: 100,
    });

    // All img tags should have border="0"
    const imgTags = result.html.match(/<img[^>]+>/g) || [];
    expect(imgTags.length).toBeGreaterThan(0);
    for (const tag of imgTags) {
      expect(tag).toContain('border="0"');
    }
  });
});
