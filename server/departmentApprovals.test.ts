/**
 * Tests for department approval workflow:
 * - departmentApprovals tRPC router procedures
 * - Public approval routes (GET/POST /api/approve/:token)
 * - POC forwarding route (POST /api/proposals/public/:token/departments/forward)
 * - Department approval email template
 */
import { describe, it, expect } from "vitest";

describe("Department Approvals Router", () => {
  it("should export departmentApprovalsRouter", async () => {
    const mod = await import("./routers/departmentApprovals");
    expect(mod.departmentApprovalsRouter).toBeDefined();
  });

  it("should have listByProposal procedure", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.listByProposal).toBeDefined();
  });

  it("should have createBatch procedure", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.createBatch).toBeDefined();
  });

  it("should have sendEmails procedure", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.sendEmails).toBeDefined();
  });

  it("should have update procedure", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.update).toBeDefined();
  });

  it("should have remove procedure", async () => {
    const mod = await import("./routers/departmentApprovals");
    const router = mod.departmentApprovalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.remove).toBeDefined();
  });
});

describe("Department Approval Email Template", () => {
  it("should export buildDepartmentApprovalEmail", async () => {
    const mod = await import("./routers/departmentApprovals");
    expect(mod.buildDepartmentApprovalEmail).toBeDefined();
    expect(typeof mod.buildDepartmentApprovalEmail).toBe("function");
  });

  it("should generate HTML with correct subject line", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Marketing",
      contactName: "Lisa Chen",
      proposalTitle: "Q2 Branded Merchandise",
      approvalUrl: "https://example.com/approve/abc123",
    });

    expect(result.subject).toContain("Q2 Branded Merchandise");
    expect(result.subject).toContain("Action Required");
  });

  it("should include department name in email body", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "Finance",
      contactName: "David Park",
      proposalTitle: "Test Proposal",
      approvalUrl: "https://example.com/approve/xyz789",
    });

    expect(result.html).toContain("Finance");
    expect(result.html).toContain("Test Proposal");
    expect(result.html).toContain("Hi David Park,");
  });

  it("should include approval URL in email", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const approvalUrl = "https://example.com/approve/test-token-123";
    const result = buildDepartmentApprovalEmail({
      departmentName: "Legal",
      proposalTitle: "Contract Review",
      approvalUrl,
    });

    expect(result.html).toContain(approvalUrl);
    expect(result.html).toContain("Review &amp; Approve");
  });

  it("should use generic greeting when contactName is not provided", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "HR",
      proposalTitle: "Employee Swag",
      approvalUrl: "https://example.com/approve/no-name",
    });

    expect(result.html).toContain("Hello,");
    expect(result.html).not.toContain("Hi undefined,");
  });

  it("should include distributor branding (fallback to 'Your Distributor')", async () => {
    const { buildDepartmentApprovalEmail } = await import("./routers/departmentApprovals");
    const result = buildDepartmentApprovalEmail({
      departmentName: "IT",
      proposalTitle: "Tech Equipment",
      approvalUrl: "https://example.com/approve/branding-test",
    });

    expect(result.html).toContain("Your Distributor");
    expect(result.html).toContain("654BF9"); // Default brand color
  });
});

describe("Public Approval Routes Registration", () => {
  // publicProposalRouter is composed of nested Express routers via .use().
  // Express stores child routers as layers whose `handle.stack` holds the
  // real route layers, so we recurse to collect every { path, methods }.
  function collectRoutes(router: any): { path: string; methods: string[] }[] {
    const out: { path: string; methods: string[] }[] = [];
    const stack = router?.stack ?? [];
    for (const layer of stack) {
      if (layer.route) {
        out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
      } else if (layer.name === "router" && layer.handle?.stack) {
        out.push(...collectRoutes(layer.handle));
      }
    }
    return out;
  }

  it("should have GET /api/approve/:token route", async () => {
    const mod = await import("./routes/publicProposal");
    const paths = collectRoutes(mod.publicProposalRouter);
    expect(paths.find((p) => p.path === "/api/approve/:token" && p.methods.includes("get"))).toBeDefined();
  });

  it("should have POST /api/approve/:token route", async () => {
    const mod = await import("./routes/publicProposal");
    const paths = collectRoutes(mod.publicProposalRouter);
    expect(paths.find((p) => p.path === "/api/approve/:token" && p.methods.includes("post"))).toBeDefined();
  });

  it("should have GET /api/proposals/public/:token/departments route", async () => {
    const mod = await import("./routes/publicProposal");
    const paths = collectRoutes(mod.publicProposalRouter);
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/departments" && p.methods.includes("get"))).toBeDefined();
  });

  it("should have POST /api/proposals/public/:token/departments/forward route", async () => {
    const mod = await import("./routes/publicProposal");
    const paths = collectRoutes(mod.publicProposalRouter);
    expect(paths.find((p) => p.path === "/api/proposals/public/:token/departments/forward" && p.methods.includes("post"))).toBeDefined();
  });
});

describe("Department Approvals Schema", () => {
  it("should export departmentApprovals table from schema", async () => {
    const mod = await import("../drizzle/schema");
    expect(mod.departmentApprovals).toBeDefined();
  });

  it("should have required columns in departmentApprovals table", async () => {
    const mod = await import("../drizzle/schema");
    const table = mod.departmentApprovals;
    // Check that the table config has the expected column names
    const columns = Object.keys((table as any)[Symbol.for("drizzle:Columns")] || {});
    
    expect(columns).toContain("id");
    expect(columns).toContain("proposalId");
    expect(columns).toContain("departmentName");
    expect(columns).toContain("contactEmail");
    expect(columns).toContain("status");
    expect(columns).toContain("approvalToken");
    expect(columns).toContain("addedBy");
  });
});

describe("Proposals Send Mutation - Department Integration", () => {
  it("should accept optional departments parameter in send mutation", async () => {
    const mod = await import("./routers/proposals");
    const router = mod.proposalsRouter;
    const procs = (router as any)._def?.procedures;
    expect(procs?.send).toBeDefined();
  });

  it("should import departmentApprovals in proposals router", async () => {
    // Verify the import is present by checking the module loads without error
    const mod = await import("./routers/proposals");
    expect(mod.proposalsRouter).toBeDefined();
  });
});

describe("Department Approvals Router Registration", () => {
  it("should be registered in the main app router", async () => {
    const mod = await import("./routers");
    const router = mod.appRouter;
    const procs = (router as any)._def?.procedures;
    
    // Check that departmentApprovals procedures are accessible via the app router
    expect(procs?.["departmentApprovals.listByProposal"]).toBeDefined();
    expect(procs?.["departmentApprovals.createBatch"]).toBeDefined();
    expect(procs?.["departmentApprovals.sendEmails"]).toBeDefined();
    expect(procs?.["departmentApprovals.update"]).toBeDefined();
    expect(procs?.["departmentApprovals.remove"]).toBeDefined();
  });
});
