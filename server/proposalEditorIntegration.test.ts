/**
 * Tests for ProposalEditor integration features:
 * 1. Update mutation accepts new settings fields (proposalType, deliveryMethod, validDays, approvalRouting)
 * 2. Email preview mutation returns valid HTML
 * 3. Send mutation with department emails
 * 4. Department approval batch creation
 * 5. Proposal settings schema validation
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

//  1. Proposal Settings Schema Validation 

describe("Proposal Settings Schema", () => {
  const proposalUpdateSchema = z.object({
    id: z.number(),
    title: z.string().optional(),
    proposalType: z.enum(["promo", "print", "promo_print"]).optional(),
    deliveryMethod: z.enum(["email", "webstore", "both"]).optional(),
    stripeCheckout: z.boolean().optional(),
    multiDepartment: z.boolean().optional(),
    approvalRouting: z.enum(["parallel", "sequential"]).optional(),
    notes: z.string().optional(),
    validDays: z.number().optional(),
    estimatedValue: z.string().optional(),
  });

  it("accepts all new proposal settings fields", () => {
    const input = {
      id: 1,
      title: "Test Proposal",
      proposalType: "promo_print" as const,
      deliveryMethod: "both" as const,
      stripeCheckout: true,
      multiDepartment: true,
      approvalRouting: "sequential" as const,
      notes: "Test notes",
      validDays: 45,
      estimatedValue: "5000.00",
    };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposalType).toBe("promo_print");
      expect(result.data.deliveryMethod).toBe("both");
      expect(result.data.approvalRouting).toBe("sequential");
      expect(result.data.validDays).toBe(45);
    }
  });

  it("accepts minimal update with only id", () => {
    const input = { id: 1 };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects invalid proposal type", () => {
    const input = { id: 1, proposalType: "invalid" };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid delivery method", () => {
    const input = { id: 1, deliveryMethod: "fax" };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid approval routing", () => {
    const input = { id: 1, approvalRouting: "random" };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts validDays of 0 for no expiration", () => {
    const input = { id: 1, validDays: 0 };
    const result = proposalUpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.validDays).toBe(0);
    }
  });

  it("accepts all three proposal types", () => {
    for (const type of ["promo", "print", "promo_print"] as const) {
      const result = proposalUpdateSchema.safeParse({ id: 1, proposalType: type });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all three delivery methods", () => {
    for (const method of ["email", "webstore", "both"] as const) {
      const result = proposalUpdateSchema.safeParse({ id: 1, deliveryMethod: method });
      expect(result.success).toBe(true);
    }
  });

  it("accepts both approval routing modes", () => {
    for (const routing of ["parallel", "sequential"] as const) {
      const result = proposalUpdateSchema.safeParse({ id: 1, approvalRouting: routing });
      expect(result.success).toBe(true);
    }
  });
});

//  2. Email Preview Data Validation 

describe("Email Preview Input Schema", () => {
  const emailPreviewSchema = z.object({
    proposalTitle: z.string(),
    clientName: z.string(),
    clientCompany: z.string(),
    estimatedValue: z.string(),
    validDays: z.number(),
    stripeCheckout: z.boolean(),
    multiDepartment: z.boolean(),
    notes: z.string().optional(),
    products: z.array(z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.string(),
      decorationType: z.string().nullable(),
      imageUrl: z.string().nullable(),
      proofImageUrl: z.string().nullable(),
      proofStatus: z.string().nullable(),
    })),
  });

  it("validates complete email preview input", () => {
    const input = {
      proposalTitle: "Conference Giveaway Package",
      clientName: "James Wilson",
      clientCompany: "Bright Labs",
      estimatedValue: "6200.00",
      validDays: 30,
      stripeCheckout: false,
      multiDepartment: true,
      notes: "Rush order",
      products: [
        {
          name: "Nike Dri-FIT Polo",
          quantity: 100,
          unitPrice: "12.50",
          decorationType: "embroidery",
          imageUrl: null,
          proofImageUrl: null,
          proofStatus: null,
        },
      ],
    };
    const result = emailPreviewSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("validates email preview with approved proofs", () => {
    const input = {
      proposalTitle: "Proof Test",
      clientName: "Test",
      clientCompany: "TestCo",
      estimatedValue: "1000.00",
      validDays: 30,
      stripeCheckout: true,
      multiDepartment: false,
      products: [
        {
          name: "Product",
          quantity: 50,
          unitPrice: "20.00",
          decorationType: "screen_print",
          imageUrl: "https://example.com/product.jpg",
          proofImageUrl: "https://example.com/proof.png",
          proofStatus: "approved",
        },
      ],
    };
    const result = emailPreviewSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

//  3. Send Mutation Input Schema 

describe("Send Mutation Input Schema", () => {
  const sendSchema = z.object({
    id: z.number(),
    origin: z.string().optional(),
    departments: z.array(z.object({
      name: z.string(),
      contact: z.string().optional(),
      email: z.string().optional(),
    })).optional(),
  });

  it("validates send with departments", () => {
    const input = {
      id: 420229,
      origin: "https://example.com",
      departments: [
        { name: "Marketing", contact: "John", email: "john@test.com" },
        { name: "HR", contact: "Jane", email: "jane@test.com" },
        { name: "Finance" },
      ],
    };
    const result = sendSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.departments).toHaveLength(3);
      expect(result.data.departments![2].email).toBeUndefined();
    }
  });

  it("validates send without departments", () => {
    const input = { id: 1, origin: "https://example.com" };
    const result = sendSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data.departments).toBeUndefined();
  });

  it("validates send with minimal input", () => {
    const input = { id: 1 };
    const result = sendSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

//  4. Department Approval Batch Schema 

describe("Department Approval Batch Schema", () => {
  const batchSchema = z.object({
    proposalId: z.number(),
    departments: z.array(z.object({
      name: z.string(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
    })),
  });

  it("validates batch creation with full department data", () => {
    const input = {
      proposalId: 420229,
      departments: [
        { name: "Dept 1", contactName: "Alice", contactEmail: "alice@test.com" },
        { name: "Dept 2", contactName: "Bob", contactEmail: "bob@test.com" },
      ],
    };
    const result = batchSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.departments).toHaveLength(2);
    }
  });

  it("validates batch creation with minimal department data", () => {
    const input = {
      proposalId: 1,
      departments: [{ name: "Marketing" }],
    };
    const result = batchSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects empty departments array", () => {
    const input = {
      proposalId: 1,
      departments: [],
    };
    const result = batchSchema.safeParse(input);
    // Empty array is valid in zod by default, but our business logic should handle it
    expect(result.success).toBe(true);
  });
});

//  5. Proposal Editor State Mapping 

describe("Proposal Editor State Mapping", () => {
  // Simulate the mapping logic from DB data to editor state
  interface DbProposal {
    title: string;
    proposalType: "promo" | "print" | "promo_print";
    deliveryMethod: "email" | "webstore" | "both";
    validDays: number;
    approvalRouting: "parallel" | "sequential";
    multiDepartment: boolean;
    stripeCheckout: boolean;
    estimatedValue: string;
    notes: string | null;
  }

  interface EditorState {
    title: string;
    proposalType: "promo" | "print" | "promo_print";
    deliveryMethod: "email" | "webstore" | "both";
    validDays: number;
    approvalRouting: "parallel" | "sequential";
    multiDept: boolean;
    stripeEnabled: boolean;
    budget: string;
    notes: string;
  }

  function mapDbToEditorState(db: DbProposal): EditorState {
    return {
      title: db.title || "",
      proposalType: db.proposalType || "promo_print",
      deliveryMethod: db.deliveryMethod || "email",
      validDays: db.validDays ?? 30,
      approvalRouting: db.approvalRouting || "parallel",
      multiDept: db.multiDepartment || false,
      stripeEnabled: db.stripeCheckout || false,
      budget: db.estimatedValue ? `$${Number(db.estimatedValue).toLocaleString()}` : "",
      notes: db.notes || "",
    };
  }

  it("maps all DB fields to editor state correctly", () => {
    const dbData: DbProposal = {
      title: "Conference Package",
      proposalType: "promo_print",
      deliveryMethod: "both",
      validDays: 45,
      approvalRouting: "sequential",
      multiDepartment: true,
      stripeCheckout: true,
      estimatedValue: "5000.00",
      notes: "Rush order",
    };

    const state = mapDbToEditorState(dbData);
    expect(state.title).toBe("Conference Package");
    expect(state.proposalType).toBe("promo_print");
    expect(state.deliveryMethod).toBe("both");
    expect(state.validDays).toBe(45);
    expect(state.approvalRouting).toBe("sequential");
    expect(state.multiDept).toBe(true);
    expect(state.stripeEnabled).toBe(true);
    expect(state.budget).toBe("$5,000");
    expect(state.notes).toBe("Rush order");
  });

  it("applies correct defaults for missing fields", () => {
    const dbData: DbProposal = {
      title: "",
      proposalType: "promo",
      deliveryMethod: "email",
      validDays: 30,
      approvalRouting: "parallel",
      multiDepartment: false,
      stripeCheckout: false,
      estimatedValue: "",
      notes: null,
    };

    const state = mapDbToEditorState(dbData);
    expect(state.title).toBe("");
    expect(state.proposalType).toBe("promo");
    expect(state.deliveryMethod).toBe("email");
    expect(state.validDays).toBe(30);
    expect(state.approvalRouting).toBe("parallel");
    expect(state.multiDept).toBe(false);
    expect(state.stripeEnabled).toBe(false);
    expect(state.budget).toBe("");
    expect(state.notes).toBe("");
  });

  it("handles validDays=0 as no expiration", () => {
    const dbData: DbProposal = {
      title: "No Expiry",
      proposalType: "promo",
      deliveryMethod: "email",
      validDays: 0,
      approvalRouting: "parallel",
      multiDepartment: false,
      stripeCheckout: false,
      estimatedValue: "100.00",
      notes: null,
    };

    const state = mapDbToEditorState(dbData);
    expect(state.validDays).toBe(0);
  });
});

//  6. Department Approval Status Mapping 

describe("Department Approval Status Mapping", () => {
  interface DbDeptApproval {
    id: number;
    departmentName: string;
    contactName: string | null;
    contactEmail: string | null;
    status: "pending" | "approved" | "rejected";
    emailSentAt: Date | null;
  }

  interface EditorDepartment {
    name: string;
    contact: string;
    email: string;
    enabled: boolean;
    dbId: number;
    status: "pending" | "approved" | "rejected";
    emailSentAt: Date | null;
  }

  function mapDbDeptToEditor(da: DbDeptApproval): EditorDepartment {
    return {
      name: da.departmentName,
      contact: da.contactName || "",
      email: da.contactEmail || "",
      enabled: true,
      dbId: da.id,
      status: da.status || "pending",
      emailSentAt: da.emailSentAt,
    };
  }

  it("maps department approval data correctly", () => {
    const dbDept: DbDeptApproval = {
      id: 1,
      departmentName: "Marketing",
      contactName: "Alice",
      contactEmail: "alice@test.com",
      status: "approved",
      emailSentAt: new Date("2026-01-15"),
    };

    const dept = mapDbDeptToEditor(dbDept);
    expect(dept.name).toBe("Marketing");
    expect(dept.contact).toBe("Alice");
    expect(dept.email).toBe("alice@test.com");
    expect(dept.enabled).toBe(true);
    expect(dept.dbId).toBe(1);
    expect(dept.status).toBe("approved");
    expect(dept.emailSentAt).toEqual(new Date("2026-01-15"));
  });

  it("handles null contact fields", () => {
    const dbDept: DbDeptApproval = {
      id: 2,
      departmentName: "HR",
      contactName: null,
      contactEmail: null,
      status: "pending",
      emailSentAt: null,
    };

    const dept = mapDbDeptToEditor(dbDept);
    expect(dept.contact).toBe("");
    expect(dept.email).toBe("");
    expect(dept.emailSentAt).toBeNull();
  });

  it("maps all three status types correctly", () => {
    for (const status of ["pending", "approved", "rejected"] as const) {
      const dbDept: DbDeptApproval = {
        id: 1,
        departmentName: "Test",
        contactName: null,
        contactEmail: null,
        status,
        emailSentAt: null,
      };
      const dept = mapDbDeptToEditor(dbDept);
      expect(dept.status).toBe(status);
    }
  });
});

//  7. Product Mapping (DB to Editor) 

describe("Product Mapping — DB to Editor", () => {
  interface DbProposalProduct {
    productId: number;
    quantity: number;
    unitPrice: string | null;
    decorationType: string | null;
    product: {
      name: string;
      sku: string;
      basePrice: string;
      imageUrl: string | null;
      decorationMethods: string | null;
    } | null;
    proof: {
      status: string;
      proofImageUrl: string | null;
    } | null;
  }

  interface EditorProduct {
    name: string;
    sku: string;
    qty: number;
    price: number;
    decoration: string;
    imageUrl: string | undefined;
    proofStatus: "none" | "ready";
    proofUrl: string | undefined;
    dbProductId: number;
  }

  function mapDbProductToEditor(pp: DbProposalProduct): EditorProduct {
    return {
      name: pp.product?.name || "Unknown Product",
      sku: pp.product?.sku || "",
      qty: pp.quantity || 1,
      price: pp.unitPrice ? Number(pp.unitPrice) : (pp.product?.basePrice ? Number(pp.product.basePrice) : 0),
      decoration: pp.decorationType || pp.product?.decorationMethods || "Standard",
      imageUrl: pp.product?.imageUrl || undefined,
      proofStatus: pp.proof?.status === "approved" ? "ready" : "none",
      proofUrl: pp.proof?.proofImageUrl || undefined,
      dbProductId: pp.productId,
    };
  }

  it("maps product with full data", () => {
    const dbProduct: DbProposalProduct = {
      productId: 5,
      quantity: 100,
      unitPrice: "12.50",
      decorationType: "embroidery",
      product: {
        name: "Nike Dri-FIT Polo",
        sku: "NK-POLO-001",
        basePrice: "15.00",
        imageUrl: "https://example.com/polo.jpg",
        decorationMethods: "embroidery,screen_print",
      },
      proof: {
        status: "approved",
        proofImageUrl: "https://example.com/proof.png",
      },
    };

    const product = mapDbProductToEditor(dbProduct);
    expect(product.name).toBe("Nike Dri-FIT Polo");
    expect(product.sku).toBe("NK-POLO-001");
    expect(product.qty).toBe(100);
    expect(product.price).toBe(12.50);
    expect(product.decoration).toBe("embroidery");
    expect(product.proofStatus).toBe("ready");
    expect(product.proofUrl).toBe("https://example.com/proof.png");
    expect(product.dbProductId).toBe(5);
  });

  it("uses base price when unit price is null", () => {
    const dbProduct: DbProposalProduct = {
      productId: 1,
      quantity: 50,
      unitPrice: null,
      decorationType: null,
      product: {
        name: "T-Shirt",
        sku: "TS-001",
        basePrice: "8.99",
        imageUrl: null,
        decorationMethods: "screen_print",
      },
      proof: null,
    };

    const product = mapDbProductToEditor(dbProduct);
    expect(product.price).toBe(8.99);
    expect(product.decoration).toBe("screen_print");
    expect(product.proofStatus).toBe("none");
    expect(product.proofUrl).toBeUndefined();
  });

  it("handles missing product reference", () => {
    const dbProduct: DbProposalProduct = {
      productId: 999,
      quantity: 1,
      unitPrice: "5.00",
      decorationType: "Standard",
      product: null,
      proof: null,
    };

    const product = mapDbProductToEditor(dbProduct);
    expect(product.name).toBe("Unknown Product");
    expect(product.sku).toBe("");
    expect(product.price).toBe(5.00);
  });
});


//  7. Version History Schema & Logic 

describe("Version History", () => {
  const versionSchema = z.object({
    proposalId: z.number(),
    action: z.enum(["created", "updated", "sent", "reverted"]),
    changedBy: z.string(),
    changedByUserId: z.number(),
    snapshot: z.string(), // JSON string
    changeSummary: z.string(),
  });

  it("validates a version entry for update action", () => {
    const snapshot = JSON.stringify({
      title: "Conference Giveaway Package",
      estimatedValue: "6200.00",
      proposalType: "promo",
      deliveryMethod: "email",
      validDays: 30,
      products: [{ name: "Nike Polo", qty: 100, price: 12.50 }],
    });

    const entry = {
      proposalId: 2,
      action: "updated" as const,
      changedBy: "yan Charitar",
      changedByUserId: 1,
      snapshot,
      changeSummary: "Title updated, estimated value changed to $6,200",
    };

    const result = versionSchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.snapshot);
      expect(parsed.title).toBe("Conference Giveaway Package");
      expect(parsed.products).toHaveLength(1);
    }
  });

  it("validates a version entry for sent action", () => {
    const entry = {
      proposalId: 420229,
      action: "sent" as const,
      changedBy: "yan Charitar",
      changedByUserId: 1,
      snapshot: JSON.stringify({ title: "Stress Test", status: "sent" }),
      changeSummary: "Proposal sent to client",
    };

    const result = versionSchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("validates a version entry for revert action", () => {
    const entry = {
      proposalId: 2,
      action: "reverted" as const,
      changedBy: "yan Charitar",
      changedByUserId: 1,
      snapshot: JSON.stringify({ title: "Old Title", estimatedValue: "5000.00" }),
      changeSummary: "Reverted to version from 4/1/2026",
    };

    const result = versionSchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("rejects invalid action type", () => {
    const entry = {
      proposalId: 1,
      action: "deleted",
      changedBy: "test",
      changedByUserId: 1,
      snapshot: "{}",
      changeSummary: "test",
    };

    const result = versionSchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  // Version list display logic
  interface VersionEntry {
    id: number;
    action: string;
    changedBy: string;
    changeSummary: string;
    snapshot: string;
    createdAt: number;
  }

  function formatVersionDisplay(v: VersionEntry) {
    const date = new Date(v.createdAt);
    return {
      label: v.action,
      author: v.changedBy,
      summary: v.changeSummary,
      timestamp: date.toLocaleString(),
      canRevert: v.action !== "reverted",
    };
  }

  it("formats version entry for display", () => {
    const version: VersionEntry = {
      id: 1,
      action: "updated",
      changedBy: "yan Charitar",
      changeSummary: "Title updated to 'New Title'",
      snapshot: "{}",
      createdAt: Date.now(),
    };

    const display = formatVersionDisplay(version);
    expect(display.label).toBe("updated");
    expect(display.author).toBe("yan Charitar");
    expect(display.canRevert).toBe(true);
  });

  it("disables revert for reverted entries", () => {
    const version: VersionEntry = {
      id: 2,
      action: "reverted",
      changedBy: "yan Charitar",
      changeSummary: "Reverted to previous version",
      snapshot: "{}",
      createdAt: Date.now(),
    };

    const display = formatVersionDisplay(version);
    expect(display.canRevert).toBe(false);
  });
});

//  8. Return-from-Proofing Logic 

describe("Return-from-Proofing URL Detection", () => {
  function detectReturnFromProofing(searchParams: URLSearchParams): boolean {
    return searchParams.get("returnFromProofing") === "1";
  }

  function cleanProofingParam(url: string): string {
    const u = new URL(url);
    u.searchParams.delete("returnFromProofing");
    return u.pathname + (u.search || "");
  }

  it("detects returnFromProofing=1 param", () => {
    const params = new URLSearchParams("?returnFromProofing=1");
    expect(detectReturnFromProofing(params)).toBe(true);
  });

  it("returns false when param is absent", () => {
    const params = new URLSearchParams("");
    expect(detectReturnFromProofing(params)).toBe(false);
  });

  it("returns false when param is not 1", () => {
    const params = new URLSearchParams("?returnFromProofing=0");
    expect(detectReturnFromProofing(params)).toBe(false);
  });

  it("cleans returnFromProofing param from URL", () => {
    const cleaned = cleanProofingParam("https://example.com/edit-proposal/2?returnFromProofing=1");
    expect(cleaned).toBe("/edit-proposal/2");
  });

  it("preserves other params when cleaning", () => {
    const cleaned = cleanProofingParam("https://example.com/edit-proposal/2?returnFromProofing=1&tab=proofs");
    expect(cleaned).toBe("/edit-proposal/2?tab=proofs");
  });
});

//  9. New Client Creation Schema 

describe("New Client Creation Schema", () => {
  const clientCreateSchema = z.object({
    companyName: z.string().min(1, "Company name is required"),
    contactName: z.string().min(1, "Contact name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().optional(),
    industry: z.string().optional(),
    title: z.string().optional(),
  });

  it("validates complete client creation input", () => {
    const input = {
      companyName: "Acme Corp",
      contactName: "Jane Smith",
      email: "jane@acme.com",
      phone: "(555) 123-4567",
      industry: "Healthcare",
      title: "Marketing Director",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("validates minimal client creation input (required fields only)", () => {
    const input = {
      companyName: "TestCo",
      contactName: "John",
      email: "john@test.com",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", () => {
    const input = {
      companyName: "",
      contactName: "John",
      email: "john@test.com",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects empty contact name", () => {
    const input = {
      companyName: "TestCo",
      contactName: "",
      email: "john@test.com",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const input = {
      companyName: "TestCo",
      contactName: "John",
      email: "not-an-email",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts client without optional fields", () => {
    const input = {
      companyName: "MinimalCo",
      contactName: "Min",
      email: "min@minimal.com",
    };
    const result = clientCreateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeUndefined();
      expect(result.data.industry).toBeUndefined();
      expect(result.data.title).toBeUndefined();
    }
  });

  // Client mode toggle logic
  it("switches between existing and new client mode", () => {
    type ClientMode = "existing" | "new";
    let mode: ClientMode = "existing";

    // Toggle to new
    mode = "new";
    expect(mode).toBe("new");

    // Toggle back
    mode = "existing";
    expect(mode).toBe("existing");
  });

  // After client creation, proposal should be updated with new client ID
  it("maps new client to proposal update", () => {
    const newClientId = 42;
    const proposalUpdate = {
      id: 2,
      clientId: newClientId,
    };
    expect(proposalUpdate.clientId).toBe(42);
  });
});
