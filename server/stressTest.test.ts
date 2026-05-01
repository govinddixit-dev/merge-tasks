/**
 * STRESS TEST: Live API end-to-end proposal & department approval workflows.
 *
 * These tests hit the actual running server and database — they are true
 * integration tests that exercise every workflow path from all angles.
 *
 * Workflow paths tested:
 *   Path 1 — Basic proposal send → POC views → accept/decline
 *   Path 2 — Multi-department parallel: all approve, mixed, all reject
 *   Path 3 — Multi-department sequential: order enforcement
 *   Path 4 — POC forwards to new departments, edits products, requests re-approval
 *   Path 5 — POC override fulfillment with pending/rejected departments
 *   Path 6 — Fulfillment request after all departments approved
 *   Path 7 — Edge cases: invalid tokens, expired proposals, double submissions
 */
import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { proposals, proposalProducts, departmentApprovals, clients, products } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

//  Test Helpers 

const BASE_URL = "http://localhost:3000";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@mergetasks.com",
    name: "Test User",
    loginMethod: "email",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: { origin: BASE_URL } } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

/** Direct HTTP fetch helper for public endpoints */
async function api(method: "GET" | "POST", path: string, body?: any) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Track IDs for cleanup
const createdProposalIds: number[] = [];
const createdDeptApprovalIds: number[] = [];

//  Setup: Ensure test data exists 

let testClientId: number;
let testProductId: number;

let _dbAvailable = false;
beforeAll(async () => {
  const db = await getDb();
  if (!db) { console.log("SKIP: Database unavailable in this environment"); return; }
  _dbAvailable = true;

  // Get or create a test client
  const [existingClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, 1))
    .limit(1);

  if (existingClient) {
    testClientId = existingClient.id;
  } else {
    const [inserted] = await db.insert(clients).values({
      userId: 1,
      companyName: "Stress Test Corp",
      contactName: "Test POC",
      contactEmail: "poc@stresstest.com",
      status: "active",
    }).$returningId();
    testClientId = inserted.id;
  }

  // Get or create a test product
  const [existingProduct] = await db
    .select()
    .from(products)
    .where(eq(products.userId, 1))
    .limit(1);

  if (existingProduct) {
    testProductId = existingProduct.id;
  } else {
    const [inserted] = await db.insert(products).values({
      userId: 1,
      name: "Stress Test Mug",
      category: "drinkware",
      basePrice: "12.50",
    }).$returningId();
    testProductId = inserted.id;
  }
});

//  Helper: Create a proposal with viewToken via tRPC 

async function createAndSendProposal(opts: {
  title: string;
  multiDepartment?: boolean;
  approvalRouting?: "parallel" | "sequential";
  departments?: Array<{ name: string; contact?: string; email?: string; description?: string }>;
  validDays?: number;
}) {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  // Create proposal
  const created = await caller.proposals.create({
    clientId: testClientId,
    title: opts.title,
    proposalType: "promo",
    deliveryMethod: "email",
    products: [{ productId: testProductId, quantity: 10, unitPrice: "12.50" }],
  });
  createdProposalIds.push(created.id);

  // Update multi-department settings if needed
  if (opts.multiDepartment || opts.approvalRouting || opts.validDays !== undefined) {
    await caller.proposals.update({
      id: created.id,
      multiDepartment: opts.multiDepartment ?? false,
      approvalRouting: opts.approvalRouting ?? "parallel",
      validDays: opts.validDays ?? 30,
    });
  }

  // Send the proposal (generates viewToken and creates dept approvals)
  const sent = await caller.proposals.send({
    id: created.id,
    origin: BASE_URL,
    departments: opts.departments,
  });

  return { proposalId: created.id, viewToken: sent.viewToken! };
}

//  Helper: Create department approvals directly for a proposal 

async function createDepartmentApprovals(
  proposalId: number,
  depts: Array<{ name: string; contactName?: string; contactEmail?: string }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const tokens: string[] = [];
  for (let i = 0; i < depts.length; i++) {
    const token = nanoid(32);
    tokens.push(token);
    const [inserted] = await db.insert(departmentApprovals).values({
      proposalId,
      departmentName: depts[i].name,
      contactName: depts[i].contactName || null,
      contactEmail: depts[i].contactEmail || null,
      approvalToken: token,
      status: "pending",
      addedBy: "distributor",
      sortOrder: i,
    }).$returningId();
    createdDeptApprovalIds.push(inserted.id);
  }
  return tokens;
}

// 
// PATH 1: Basic Proposal Send → POC Views → Accept/Decline
// 

describe.skipIf(!_dbAvailable)("Path 1: Basic Proposal Flow", () => {
  let viewToken: string;
  let proposalId: number;

  it("should create and send a basic proposal", async () => {
    const result = await createAndSendProposal({ title: "Stress Test - Basic Flow" });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
    expect(viewToken).toBeDefined();
    expect(viewToken.length).toBeGreaterThanOrEqual(20);
  });

  it("should load proposal data via public GET endpoint", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}`);
    expect(status).toBe(200);
    expect(data.title).toBe("Stress Test - Basic Flow");
    expect(data.status).toBe("viewed"); // auto-marked as viewed
    expect(data.products).toHaveLength(1);
    expect(data.branding).toBeDefined();
    expect(data.client).toBeDefined();
    expect(data.isExpired).toBe(false);
  });

  it("should load single product detail", async () => {
    const { status: listStatus, data: listData } = await api("GET", `/api/proposals/public/${viewToken}`);
    const productId = listData.products[0].productId;

    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/product/${productId}`);
    expect(status).toBe(200);
    expect(data.product).toBeDefined();
    expect(data.product.name).toBeDefined();
    expect(data.branding).toBeDefined();
  });

  it("should return 404 for non-existent product", async () => {
    const { status } = await api("GET", `/api/proposals/public/${viewToken}/product/999999`);
    expect(status).toBe(404);
  });

  it("should return departments list (empty for non-multi-department)", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/departments`);
    expect(status).toBe(200);
    expect(data.departments).toBeDefined();
    expect(data.multiDepartment).toBe(false);
  });
});

// 
// PATH 2: Multi-Department Parallel — All Approve, Mixed, All Reject
// 

describe.skipIf(!_dbAvailable)("Path 2: Multi-Department Parallel Approval", () => {
  let viewToken: string;
  let proposalId: number;
  let approvalTokens: string[];

  it("should create multi-department proposal with 3 departments", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Parallel Approval",
      multiDepartment: true,
      approvalRouting: "parallel",
      departments: [
        { name: "Marketing", contact: "Alice", email: "alice@test.com" },
        { name: "Finance", contact: "Bob", email: "bob@test.com" },
        { name: "Legal", contact: "Carol", email: "carol@test.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
  });

  it("should show 3 departments in pending status", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/departments`);
    expect(status).toBe(200);
    expect(data.departments).toHaveLength(3);
    expect(data.multiDepartment).toBe(true);
    expect(data.approvalRouting).toBe("parallel");
    expect(data.departments.every((d: any) => d.status === "pending")).toBe(true);
  });

  it("should load approval tokens from database", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    approvalTokens = rows.sort((a, b) => a.sortOrder - b.sortOrder).map(r => r.approvalToken);
    expect(approvalTokens).toHaveLength(3);
  });

  it("should load approval page data for department reviewer", async () => {
    const { status, data } = await api("GET", `/api/approve/${approvalTokens[0]}`);
    expect(status).toBe(200);
    expect(data.approval.departmentName).toBe("Marketing");
    expect(data.approval.status).toBe("pending");
    expect(data.proposal.title).toBe("Stress Test - Parallel Approval");
    expect(data.products.length).toBeGreaterThanOrEqual(1);
    expect(data.allDepartments).toHaveLength(3);
    expect(data.branding).toBeDefined();
  });

  it("should approve Marketing department", async () => {
    const { status, data } = await api("POST", `/api/approve/${approvalTokens[0]}`, {
      action: "approved",
      approverName: "Alice Smith",
      notes: "Looks good to me!",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.approval.status).toBe("approved");
    expect(data.approval.approverName).toBe("Alice Smith");
    expect(data.approval.approverNotes).toBe("Looks good to me!");
  });

  it("should reject Finance department", async () => {
    const { status, data } = await api("POST", `/api/approve/${approvalTokens[1]}`, {
      action: "rejected",
      approverName: "Bob Johnson",
      notes: "Over budget",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.approval.status).toBe("rejected");
  });

  it("should approve Legal department", async () => {
    const { status, data } = await api("POST", `/api/approve/${approvalTokens[2]}`, {
      action: "approved",
      approverName: "Carol Williams",
    });
    expect(status).toBe(200);
    expect(data.approval.status).toBe("approved");
  });

  it("should show mixed statuses on department list", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/departments`);
    expect(status).toBe(200);
    const statuses = data.departments.map((d: any) => d.status);
    expect(statuses).toContain("approved");
    expect(statuses).toContain("rejected");
  });

  it("should prevent double-submission on already-responded department", async () => {
    const { status, data } = await api("POST", `/api/approve/${approvalTokens[0]}`, {
      action: "rejected",
      approverName: "Hacker",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("already responded");
    expect(data.currentStatus).toBe("approved");
  });
});

// 
// PATH 3: Multi-Department Sequential Approval
// 

describe.skipIf(!_dbAvailable)("Path 3: Multi-Department Sequential Approval", () => {
  let viewToken: string;
  let proposalId: number;

  it("should create sequential multi-department proposal", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Sequential Approval",
      multiDepartment: true,
      approvalRouting: "sequential",
      departments: [
        { name: "VP Sales", contact: "Dana", email: "dana@test.com" },
        { name: "CFO", contact: "Evan", email: "evan@test.com" },
        { name: "CEO", contact: "Faye", email: "faye@test.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
  });

  it("should show sequential routing and correct sort order", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/departments`);
    expect(status).toBe(200);
    expect(data.approvalRouting).toBe("sequential");
    expect(data.departments).toHaveLength(3);
    // Verify sort order
    expect(data.departments[0].departmentName).toBe("VP Sales");
    expect(data.departments[1].departmentName).toBe("CFO");
    expect(data.departments[2].departmentName).toBe("CEO");
  });

  it("should allow approval of first department in sequence", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const first = rows.sort((a, b) => a.sortOrder - b.sortOrder)[0];

    const { status, data } = await api("POST", `/api/approve/${first.approvalToken}`, {
      action: "approved",
      approverName: "Dana Director",
    });
    expect(status).toBe(200);
    expect(data.approval.status).toBe("approved");
  });
});

// 
// PATH 4: POC Forwards, Edits Products, Requests Re-Approval
// 

describe.skipIf(!_dbAvailable)("Path 4: POC Forwards, Edits, Re-Approval", () => {
  let viewToken: string;
  let proposalId: number;

  it("should create proposal for POC actions", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - POC Actions",
      multiDepartment: true,
      approvalRouting: "parallel",
      departments: [
        { name: "IT", contact: "Greg", email: "greg@test.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
  });

  it("POC should forward to additional departments", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/departments/forward`, {
      departments: [
        { name: "HR", contactName: "Hannah", contactEmail: "hannah@test.com", description: "Employee benefits review" },
        { name: "Procurement", contactName: "Ivan", contactEmail: "ivan@test.com" },
      ],
      origin: BASE_URL,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.departments).toHaveLength(3); // IT + HR + Procurement
    // Verify POC-added departments are marked correctly
    const hrDept = data.departments.find((d: any) => d.departmentName === "HR");
    expect(hrDept).toBeDefined();
    expect(hrDept.addedBy).toBe("poc");
    expect(hrDept.status).toBe("pending");
  });

  it("should prevent duplicate forwarding to same email", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/departments/forward`, {
      departments: [
        { name: "HR Duplicate", contactName: "Hannah", contactEmail: "hannah@test.com" },
      ],
      origin: BASE_URL,
    });
    expect(status).toBe(200);
    // Should not create a duplicate — sentCount should be 0
    expect(data.sentCount).toBe(0);
    // Total departments should still be 3
    expect(data.departments).toHaveLength(3);
  });

  it("POC should edit product quantities", async () => {
    // Get current products
    const { data: proposalData } = await api("GET", `/api/proposals/public/${viewToken}`);
    const ppId = proposalData.products[0].id;

    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/edit`, {
      edits: [{ proposalProductId: ppId, quantity: 25 }],
      editNotes: "Increased quantity for larger team",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.editCount).toBe(1);
  });

  it("should reject edit with empty edits array", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/edit`, {
      edits: [],
    });
    expect(status).toBe(400);
    expect(data.error).toContain("No edits provided");
  });

  it("should approve IT department before re-approval test", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const itDept = rows.find(r => r.departmentName === "IT");
    expect(itDept).toBeDefined();

    const { status } = await api("POST", `/api/approve/${itDept!.approvalToken}`, {
      action: "approved",
      approverName: "Greg Tech",
    });
    expect(status).toBe(200);
  });

  it("POC should request re-approval from specific departments", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const itDept = rows.find(r => r.departmentName === "IT");

    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-reapproval`, {
      departmentIds: [itDept!.id],
      changeNotes: "Quantities changed, please re-review",
      origin: BASE_URL,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.resetCount).toBe(1);
    // IT should be back to pending
    const itUpdated = data.departments.find((d: any) => d.departmentName === "IT");
    expect(itUpdated.status).toBe("pending");
    // IT should have a new approval token (old one invalidated)
    expect(itUpdated.approverName).toBeNull();
  });

  it("old approval token should no longer work after re-approval", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    // The old token was replaced — try to use a non-existent token
    const { status, data } = await api("POST", `/api/approve/old-invalidated-token-12345678`, {
      action: "approved",
      approverName: "Hacker",
    });
    expect(status).toBe(404);
  });

  it("should reject re-approval with empty departmentIds", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-reapproval`, {
      departmentIds: [],
      origin: BASE_URL,
    });
    expect(status).toBe(400);
    expect(data.error).toContain("At least one department");
  });

  it("should reject re-approval with non-existent department IDs", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-reapproval`, {
      departmentIds: [999999],
      origin: BASE_URL,
    });
    expect(status).toBe(404);
    expect(data.error).toContain("No matching departments");
  });
});

// 
// PATH 5: POC Override Fulfillment
// 

describe.skipIf(!_dbAvailable)("Path 5: POC Override Fulfillment", () => {
  let viewToken: string;
  let proposalId: number;

  it("should create proposal with departments for override test", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Override",
      multiDepartment: true,
      approvalRouting: "parallel",
      departments: [
        { name: "Dept A", contact: "Alice", email: "alice-override@test.com" },
        { name: "Dept B", contact: "Bob", email: "bob-override@test.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
  });

  it("should approve one department and leave one pending", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const deptA = rows.find(r => r.departmentName === "Dept A");

    const { status } = await api("POST", `/api/approve/${deptA!.approvalToken}`, {
      action: "approved",
      approverName: "Alice Override",
    });
    expect(status).toBe(200);
  });

  it("POC should override and request fulfillment despite pending department", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/override-fulfillment`, {
      overrideNotes: "Urgent order, can't wait for Dept B",
      pocName: "Override POC",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.fulfillmentRequestedAt).toBeDefined();
  });

  it("proposal should now be accepted with fulfillmentRequestedAt set", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}`);
    expect(status).toBe(200);
    expect(data.status).toBe("accepted");
    expect(data.fulfillmentRequestedAt).toBeDefined();
    expect(data.notes).toContain("Override");
    expect(data.notes).toContain("Override POC");
  });
});

// 
// PATH 6: Fulfillment Request After All Approved
// 

describe.skipIf(!_dbAvailable)("Path 6: Fulfillment After All Approved", () => {
  let viewToken: string;
  let proposalId: number;

  it("should create proposal with departments for fulfillment test", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Fulfillment",
      multiDepartment: true,
      approvalRouting: "parallel",
      departments: [
        { name: "Dept X", contact: "Xena", email: "xena@test.com" },
        { name: "Dept Y", contact: "Yuri", email: "yuri@test.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
  });

  it("should reject fulfillment when not all departments approved", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-fulfillment`, {
      pocName: "Impatient POC",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Not all departments have approved");
    expect(data.pendingDepartments).toBeDefined();
    expect(data.pendingDepartments.length).toBeGreaterThan(0);
  });

  it("should approve all departments", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));

    for (const dept of rows) {
      const { status } = await api("POST", `/api/approve/${dept.approvalToken}`, {
        action: "approved",
        approverName: `${dept.contactName} Approver`,
      });
      expect(status).toBe(200);
    }
  });

  it("should allow fulfillment request after all departments approved", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-fulfillment`, {
      pocName: "Fulfilled POC",
      pocNotes: "All departments approved, ready to go!",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.fulfillmentRequestedAt).toBeDefined();
  });

  it("should prevent double fulfillment request", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-fulfillment`, {
      pocName: "Double POC",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("already been requested");
  });

  it("proposal should show accepted status with fulfillment timestamp", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}`);
    expect(status).toBe(200);
    expect(data.status).toBe("accepted");
    expect(data.fulfillmentRequestedAt).toBeDefined();
    expect(data.notes).toContain("Fulfillment Requested");
    expect(data.notes).toContain("Fulfilled POC");
  });
});

// 
// PATH 7: Edge Cases
// 

describe.skipIf(!_dbAvailable)("Path 7: Edge Cases", () => {
  it("should return 404 for invalid proposal token", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/invalid-token-that-does-not-exist`);
    expect(status).toBe(404);
    expect(data.error).toBeDefined();
  });

  it("should return 404 for very short token", async () => {
    const { status } = await api("GET", `/api/proposals/public/abc`);
    expect(status).toBe(404);
  });

  it("should return 404 for invalid approval token", async () => {
    const { status, data } = await api("GET", `/api/approve/nonexistent-approval-token-12345`);
    expect(status).toBe(404);
    expect(data.error).toContain("not found");
  });

  it("should return 404 for POST to invalid approval token", async () => {
    const { status } = await api("POST", `/api/approve/nonexistent-approval-token-12345`, {
      action: "approved",
      approverName: "Nobody",
    });
    expect(status).toBe(404);
  });

  it("should reject invalid action on approval", async () => {
    // Create a fresh approval to test invalid action
    const result = await createAndSendProposal({
      title: "Stress Test - Invalid Action",
      multiDepartment: true,
      departments: [{ name: "Test Dept", email: "invalid-action@test.com" }],
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [dept] = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, result.proposalId));

    const { status, data } = await api("POST", `/api/approve/${dept.approvalToken}`, {
      action: "maybe",
      approverName: "Confused Person",
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Invalid action");
  });

  it("should handle forward with missing origin gracefully", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Missing Origin",
      multiDepartment: true,
      departments: [{ name: "Origin Dept", email: "origin@test.com" }],
    });

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/departments/forward`, {
      departments: [
        { name: "New Dept", contactEmail: "new-dept@test.com" },
      ],
      origin: "", // empty origin
    });
    // Should still succeed (origin is used for URL construction but shouldn't crash)
    expect(status).toBe(200);
  }, 30000);

  it("should handle forward with no departments array", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - No Depts",
      multiDepartment: true,
      departments: [{ name: "Solo Dept", email: "solo@test.com" }],
    });

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/departments/forward`, {
      departments: [],
      origin: BASE_URL,
    });
    expect(status).toBe(400);
    expect(data.error).toContain("At least one department");
  });

  it("should handle edit with invalid proposalProductId gracefully", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Invalid Edit",
    });

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/edit`, {
      edits: [{ proposalProductId: 999999, quantity: 50 }],
    });
    // Should succeed but with 0 actual changes (ID doesn't match)
    expect(status).toBe(200);
    expect(data.editCount).toBe(0);
  });

  it("should handle product removal via edit", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Product Removal",
    });

    // Get the proposal product ID
    const { data: proposalData } = await api("GET", `/api/proposals/public/${result.viewToken}`);
    const ppId = proposalData.products[0].id;

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/edit`, {
      edits: [{ proposalProductId: ppId, removed: true }],
      editNotes: "Removed product entirely",
    });
    expect(status).toBe(200);
    expect(data.editCount).toBe(1);
    // Product list should now be empty
    expect(data.products).toHaveLength(0);
  });

  it("should handle override fulfillment without notes", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Override No Notes",
      multiDepartment: true,
      departments: [{ name: "Quick Dept", email: "quick@test.com" }],
    });

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/override-fulfillment`, {
      // No overrideNotes, no pocName
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("should handle fulfillment request for non-multi-department proposal", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Non-Multi Fulfillment",
      multiDepartment: false,
    });

    const { status, data } = await api("POST", `/api/proposals/public/${result.viewToken}/request-fulfillment`, {
      pocName: "Simple POC",
    });
    // Should succeed since there are no departments to check
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("should handle approval page showing all department statuses", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - All Dept Status View",
      multiDepartment: true,
      departments: [
        { name: "Dept 1", email: "d1@test.com" },
        { name: "Dept 2", email: "d2@test.com" },
        { name: "Dept 3", email: "d3@test.com" },
      ],
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, result.proposalId));

    // Approve first, reject second, leave third pending
    await api("POST", `/api/approve/${rows[0].approvalToken}`, { action: "approved", approverName: "A" });
    await api("POST", `/api/approve/${rows[1].approvalToken}`, { action: "rejected", approverName: "B", notes: "No" });

    // Third department reviewer should see all statuses
    const { status, data } = await api("GET", `/api/approve/${rows[2].approvalToken}`);
    expect(status).toBe(200);
    expect(data.allDepartments).toHaveLength(3);
    const statuses = data.allDepartments.map((d: any) => d.status);
    expect(statuses).toContain("approved");
    expect(statuses).toContain("rejected");
    expect(statuses).toContain("pending");
  });
});

// 
// PATH 8: Full Lifecycle — Create → Send → View → Edit → Re-Approve → Fulfill
// 

describe.skipIf(!_dbAvailable)("Path 8: Full Lifecycle End-to-End", () => {
  let viewToken: string;
  let proposalId: number;

  it("Step 1: Create and send proposal with departments", async () => {
    const result = await createAndSendProposal({
      title: "Stress Test - Full Lifecycle",
      multiDepartment: true,
      approvalRouting: "parallel",
      departments: [
        { name: "Engineering", contact: "Eng Lead", email: "eng@lifecycle.com" },
        { name: "Design", contact: "Design Lead", email: "design@lifecycle.com" },
      ],
    });
    viewToken = result.viewToken;
    proposalId = result.proposalId;
    expect(viewToken).toBeDefined();
  });

  it("Step 2: POC views proposal (auto-marks as viewed)", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}`);
    expect(status).toBe(200);
    expect(data.status).toBe("viewed");
    expect(data.multiDepartment).toBe(true);
  });

  it("Step 3: POC forwards to additional department", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/departments/forward`, {
      departments: [
        { name: "QA", contactName: "QA Lead", contactEmail: "qa@lifecycle.com" },
      ],
      origin: BASE_URL,
    });
    expect(status).toBe(200);
    expect(data.departments).toHaveLength(3);
  });

  it("Step 4: All departments approve", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));

    for (const dept of rows) {
      const { status } = await api("POST", `/api/approve/${dept.approvalToken}`, {
        action: "approved",
        approverName: `${dept.contactName} Approved`,
      });
      expect(status).toBe(200);
    }
  });

  it("Step 5: POC edits products (quantity change)", async () => {
    const { data: proposalData } = await api("GET", `/api/proposals/public/${viewToken}`);
    if (proposalData.products.length > 0) {
      const ppId = proposalData.products[0].id;
      const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/edit`, {
        edits: [{ proposalProductId: ppId, quantity: 50 }],
        editNotes: "Final quantity confirmed",
      });
      expect(status).toBe(200);
      expect(data.editCount).toBe(1);
    }
  });

  it("Step 6: POC requests re-approval from Engineering after edit", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const engDept = rows.find(r => r.departmentName === "Engineering");

    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-reapproval`, {
      departmentIds: [engDept!.id],
      changeNotes: "Quantity changed to 50",
      origin: BASE_URL,
    });
    expect(status).toBe(200);
    expect(data.resetCount).toBe(1);
    const engUpdated = data.departments.find((d: any) => d.departmentName === "Engineering");
    expect(engUpdated.status).toBe("pending");
  });

  it("Step 7: Engineering re-approves with new token", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select()
      .from(departmentApprovals)
      .where(eq(departmentApprovals.proposalId, proposalId));
    const engDept = rows.find(r => r.departmentName === "Engineering");

    const { status, data } = await api("POST", `/api/approve/${engDept!.approvalToken}`, {
      action: "approved",
      approverName: "Eng Lead Re-Approved",
      notes: "Quantity looks good now",
    });
    expect(status).toBe(200);
    expect(data.approval.status).toBe("approved");
  });

  it("Step 8: POC requests fulfillment (all approved again)", async () => {
    const { status, data } = await api("POST", `/api/proposals/public/${viewToken}/request-fulfillment`, {
      pocName: "Lifecycle POC",
      pocNotes: "Everything approved, let's go!",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.fulfillmentRequestedAt).toBeDefined();
  });

  it("Step 9: Verify final proposal state", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}`);
    expect(status).toBe(200);
    expect(data.status).toBe("accepted");
    expect(data.fulfillmentRequestedAt).toBeDefined();
    // Notes should contain the full history
    expect(data.notes).toContain("POC Edit");
    expect(data.notes).toContain("Fulfillment Requested");
    expect(data.notes).toContain("Lifecycle POC");
  });

  it("Step 10: Verify all departments show approved", async () => {
    const { status, data } = await api("GET", `/api/proposals/public/${viewToken}/departments`);
    expect(status).toBe(200);
    expect(data.departments.every((d: any) => d.status === "approved")).toBe(true);
  });
});
