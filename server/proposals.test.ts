/**
 * Tests for proposal validity, email template, and public proposal route.
 */
import { describe, it, expect } from "vitest";
import { buildProposalEmail, type ProposalEmailData } from "./email/proposalEmail";

function makeTestData(overrides: Partial<ProposalEmailData> = {}): ProposalEmailData {
  return {
    proposalTitle: "Test Proposal",
    clientName: "John Doe",
    clientCompany: "Acme Corp",
    senderName: "Jane Smith",
    senderCompany: "DistributorCo",
    estimatedValue: "5000.00",
    validDays: 30,
    products: [
      {
        name: "Custom T-Shirt",
        quantity: 100,
        unitPrice: "12.50",
        decorationType: "screen_print",
        imageUrl: null,
        proofImageUrl: null,
        proofStatus: null,
      },
    ],
    notes: "Rush order",
    proposalId: 1,
    proposalUrl: "https://example.com/view/proposal/abc123",
    branding: {
      logoUrl: null,
      primaryColor: "#654BF9",
      secondaryColor: null,
      bannerColor: "#654BF9",
      companyName: "TestBrand",
    },
    ...overrides,
  };
}

describe("buildProposalEmail", () => {
  it("generates valid HTML with correct subject line", () => {
    const data = makeTestData();
    const { subject, html } = buildProposalEmail(data);

    expect(subject).toContain("Test Proposal");
    expect(subject).toContain("TestBrand");
    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain("Test Proposal");
    expect(html).toContain("John Doe");
    expect(html).toContain("Acme Corp");
  });

  it("shows validity days when validDays > 0", () => {
    const data = makeTestData({ validDays: 30 });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("30");
    expect(html).toContain("Days Valid");
    expect(html).toContain("valid for <strong>30 days</strong>");
  });

  it("shows no expiration when validDays is 0", () => {
    const data = makeTestData({ validDays: 0 });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("∞");
    expect(html).toContain("No Expiration");
    expect(html).toContain("no expiration date");
    expect(html).not.toContain("Days Valid");
  });

  it("includes product details in the email", () => {
    const data = makeTestData();
    const { html } = buildProposalEmail(data);

    expect(html).toContain("Custom T-Shirt");
    expect(html).toContain("$12.50");
    expect(html).toContain("Screen Print");
  });

  it("includes CTA button with proposal URL", () => {
    const data = makeTestData({ proposalUrl: "https://example.com/view/proposal/token123" });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("View Full Proposal");
    expect(html).toContain("https://example.com/view/proposal/token123");
  });

  it("shows reply CTA when no proposal URL", () => {
    const data = makeTestData({ proposalUrl: undefined });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("Reply to This Proposal");
  });

  it("includes notes section when notes provided", () => {
    const data = makeTestData({ notes: "Rush order needed" });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("Rush order needed");
    expect(html).toContain("Notes");
  });

  it("omits notes section when no notes", () => {
    const data = makeTestData({ notes: undefined });
    const { html } = buildProposalEmail(data);

    // The notes section should not appear
    expect(html).not.toContain("FFFBEB"); // notes section bg color
  });

  it("includes proof badges for approved proofs", () => {
    const data = makeTestData({
      products: [
        {
          name: "Proof Product",
          quantity: 50,
          unitPrice: "20.00",
          decorationType: "embroidery",
          imageUrl: null,
          proofImageUrl: "https://example.com/proof.png",
          proofStatus: "approved",
        },
      ],
    });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("Proof Approved");
    expect(html).toContain("AI-generated proof mockups");
  });

  it("uses custom branding colors", () => {
    const data = makeTestData({
      branding: {
        logoUrl: "https://example.com/logo.png",
        primaryColor: "#FF5733",
        secondaryColor: null,
        bannerColor: "#333333",
        companyName: "CustomBrand",
      },
    });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("#FF5733");
    expect(html).toContain("#333333");
    expect(html).toContain("CustomBrand");
    expect(html).toContain("https://example.com/logo.png");
  });

  it("includes Outlook VML conditional comments", () => {
    const data = makeTestData();
    const { html } = buildProposalEmail(data);

    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("<v:roundrect");
    expect(html).toContain("o:OfficeDocumentSettings");
  });

  it("handles multiple products correctly", () => {
    const data = makeTestData({
      products: [
        { name: "Product A", quantity: 10, unitPrice: "5.00", decorationType: null, imageUrl: null, proofImageUrl: null, proofStatus: null },
        { name: "Product B", quantity: 20, unitPrice: "10.00", decorationType: "dtg", imageUrl: null, proofImageUrl: null, proofStatus: null },
        { name: "Product C", quantity: 30, unitPrice: null, decorationType: null, imageUrl: null, proofImageUrl: null, proofStatus: null },
      ],
    });
    const { html } = buildProposalEmail(data);

    expect(html).toContain("Product A");
    expect(html).toContain("Product B");
    expect(html).toContain("Product C");
    expect(html).toContain("DTG Print");
    // Product C has null price, should show "—"
    expect(html).toContain("—");
  });
});
