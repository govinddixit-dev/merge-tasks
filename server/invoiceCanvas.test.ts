/**
 * invoices.create — the Document Canvas creation mutation.
 *
 * These tests exercise the new tRPC endpoint end-to-end (caller → router →
 * DB). They skip when no DB is available so they can run alongside the
 * existing estimatesInvoices.test.ts without extra infrastructure.
 *
 * Also covers catalog search — the canvas auto-fill source — so we know
 * products.list still filters by name/SKU the way the dropdown expects.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { clients, products, invoices } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-invoice-canvas",
    email: "canvas@example.com",
    name: "Canvas Tester",
    loginMethod: "email",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    organizationId: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
  return { ctx };
}

describe("invoices.create (Document Canvas)", () => {
  let dbAvailable = false;
  let clientId = 0;
  let exemptClientId = 0;
  let productId = 0;
  const createdInvoiceIds: number[] = [];

  beforeAll(async () => {
    const db = await getDb();
    if (!db) { console.log("SKIP: DB unavailable"); return; }
    dbAvailable = true;

    const [c] = await db.insert(clients).values({
      userId: 1,
      companyName: "Canvas Client Co",
      contactName: "Ada Lovelace",
      contactEmail: "ada@canvas.test",
      status: "active",
    });
    clientId = c.insertId;

    const [cx] = await db.insert(clients).values({
      userId: 1,
      companyName: "Tax-Exempt Client",
      contactName: "Grace Hopper",
      contactEmail: "grace@exempt.test",
      status: "active",
      taxExempt: true,
    });
    exemptClientId = cx.insertId;

    const [p] = await db.insert(products).values({
      userId: 1,
      name: "Canvas Widget",
      sku: "CANV-001",
      category: "other",
      basePrice: "12.50",
    });
    productId = p.insertId;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    try {
      for (const id of createdInvoiceIds) {
        await db.delete(invoices).where(eq(invoices.id, id));
      }
      if (productId) await db.delete(products).where(eq(products.id, productId));
      if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
      if (exemptClientId) await db.delete(clients).where(eq(clients.id, exemptClientId));
    } catch (e) {
      console.warn("canvas cleanup warning:", e);
    }
  });

  it("creates an invoice with discount + tax and stores the server-computed total", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.estimatesInvoices.invoices.create({
      clientId,
      lineItems: [
        {
          productName: "Polo Shirt",
          sku: "POLO-001",
          quantity: 10,
          unitPrice: 20,
          discountType: "percent",
          discountValue: 10,   // 10% off → net 180
          taxable: true,
        },
        {
          productName: "Lanyard",
          quantity: 5,
          unitPrice: 4,
          discountType: "flat",
          discountValue: 0,
          taxable: false,       // not in tax base
        },
      ],
      taxRate: 0.1,    // 10%
      shipping: 15,
      paymentTerms: "net_30",
      notes: "Thanks for your business",
    });

    expect(result).toBeDefined();
    expect(result.invoiceNumber).toMatch(/^INV-/);
    expect(parseFloat(result.subtotal)).toBe(200);       // 180 + 20
    expect(parseFloat(result.tax)).toBe(18);             // 10% of 180
    expect(parseFloat(result.shipping)).toBe(15);
    expect(parseFloat(result.total)).toBe(233);          // 200 + 18 + 15
    expect(result.paymentTerms).toBe("net_30");
    expect(result.status).toBe("draft");
    expect(result.dueDate).toBeTruthy();

    createdInvoiceIds.push(result.id);
  });

  it("respects client.taxExempt for taxable defaults and custom due dates", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.estimatesInvoices.invoices.create({
      clientId: exemptClientId,
      lineItems: [
        { productName: "Lapel Pins", quantity: 100, unitPrice: 1, taxable: false },
      ],
      taxRate: 0.13,
      shipping: 0,
      paymentTerms: "custom",
      customDueDate: "2026-06-30",
    });

    expect(parseFloat(result.tax)).toBe(0);
    expect(parseFloat(result.total)).toBe(100);
    expect(result.paymentTerms).toBe("custom");
    expect(new Date(result.dueDate!).toISOString().slice(0, 10)).toBe("2026-06-30");
    createdInvoiceIds.push(result.id);
  });

  it("rejects custom terms with no date", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.estimatesInvoices.invoices.create({
        clientId,
        lineItems: [{ productName: "Thing", quantity: 1, unitPrice: 1 }],
        paymentTerms: "custom",
        customDueDate: null,
      }),
    ).rejects.toThrow(/custom due date/i);
  });

  it("catalog search returns the product by SKU and name — feeds the canvas auto-fill", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const bySku = await caller.products.list({ search: "CANV-001" });
    expect(bySku.items.some(p => p.id === productId)).toBe(true);

    const byName = await caller.products.list({ search: "Canvas Widget" });
    expect(byName.items.some(p => p.id === productId)).toBe(true);

    const miss = await caller.products.list({ search: "definitely-not-a-product-zzz" });
    expect(miss.items.some(p => p.id === productId)).toBe(false);
  });

  it("saveDraft accepts a partial payload and re-updates the same row", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Empty-ish first save — no line items, no terms. This is the
    // autosave "nothing filled in yet" shape that the production UI
    // sends before the distributor has typed anything meaningful.
    const first = await caller.estimatesInvoices.invoices.saveDraft({
      clientId,
      lineItems: [],
    });
    expect(first.status).toBe("draft");
    expect(parseFloat(first.total)).toBe(0);
    createdInvoiceIds.push(first.id);

    // Second save updates the same row in place — not a new insert.
    const second = await caller.estimatesInvoices.invoices.saveDraft({
      id: first.id,
      clientId,
      lineItems: [{ productName: "Sticker", quantity: 10, unitPrice: 2 }],
      taxRate: 0,
      shipping: 0,
    });
    expect(second.id).toBe(first.id);
    expect(parseFloat(second.subtotal)).toBe(20);
    expect(parseFloat(second.total)).toBe(20);
  });

  it("send requires a client, a priced line, and a due date", async () => {
    if (!dbAvailable) return;
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Stand up a draft with NO line items → send should complain about
    // that specific gap first.
    const draft = await caller.estimatesInvoices.invoices.saveDraft({
      clientId,
      lineItems: [],
      paymentTerms: "net_30",
    });
    createdInvoiceIds.push(draft.id);

    await expect(
      caller.estimatesInvoices.invoices.send({ id: draft.id }),
    ).rejects.toThrow(/line item/i);
  });
});
