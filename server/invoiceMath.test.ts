/**
 * invoiceMath — calculation helpers shared between the Document Canvas UI
 * and the invoices.create server mutation. These tests lock the math down
 * so the number the distributor sees while building is the number the
 * server stores.
 *
 * The helpers live in shared/invoiceMath.ts so a regression here flags both
 * the UI totals and the server-side authoritative total in one place.
 */
import { describe, expect, it } from "vitest";
import {
  computeLine,
  computeTotals,
  resolveDueDate,
  round2,
} from "../shared/invoiceMath";

describe("invoiceMath.round2", () => {
  it("rounds half away from zero across float-pair edge cases", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("invoiceMath.computeLine — discounts", () => {
  it("computes net with no discount", () => {
    const r = computeLine({ quantity: 5, unitPrice: 10 });
    expect(r.gross).toBe(50);
    expect(r.discount).toBe(0);
    expect(r.net).toBe(50);
  });

  it("applies a percent discount", () => {
    const r = computeLine({
      quantity: 4,
      unitPrice: 25,
      discountType: "percent",
      discountValue: 10,
    });
    // 100 gross, 10% off = 10 discount, 90 net
    expect(r.gross).toBe(100);
    expect(r.discount).toBe(10);
    expect(r.net).toBe(90);
  });

  it("applies a flat-dollar discount", () => {
    const r = computeLine({
      quantity: 2,
      unitPrice: 50,
      discountType: "flat",
      discountValue: 15,
    });
    expect(r.gross).toBe(100);
    expect(r.discount).toBe(15);
    expect(r.net).toBe(85);
  });

  it("clamps a percent discount at 100% — net never goes negative", () => {
    const r = computeLine({
      quantity: 1,
      unitPrice: 100,
      discountType: "percent",
      discountValue: 150,
    });
    expect(r.discount).toBe(100);
    expect(r.net).toBe(0);
  });

  it("clamps a flat discount at the line's gross", () => {
    const r = computeLine({
      quantity: 1,
      unitPrice: 40,
      discountType: "flat",
      discountValue: 999,
    });
    expect(r.discount).toBe(40);
    expect(r.net).toBe(0);
  });

  it("ignores negative discount values", () => {
    const r = computeLine({
      quantity: 1,
      unitPrice: 40,
      discountType: "flat",
      discountValue: -10,
    });
    expect(r.discount).toBe(0);
    expect(r.net).toBe(40);
  });

  it("handles fractional percents without floating-point leaks", () => {
    const r = computeLine({
      quantity: 3,
      unitPrice: 9.99,
      discountType: "percent",
      discountValue: 7.5,
    });
    // 29.97 gross, 7.5% = 2.24775 → rounds to 2.25, net 27.72
    expect(r.gross).toBe(29.97);
    expect(r.discount).toBe(2.25);
    expect(r.net).toBe(27.72);
  });
});

describe("invoiceMath.computeTotals — tax exempt vs non-exempt", () => {
  it("only taxable lines contribute to the tax base", () => {
    const totals = computeTotals(
      [
        { quantity: 2, unitPrice: 50, taxable: true },   // 100 taxable
        { quantity: 1, unitPrice: 80, taxable: false },  // 80 not taxed
      ],
      { taxRate: 0.1 }, // 10%
    );
    expect(totals.subtotal).toBe(180);
    expect(totals.taxableBase).toBe(100);
    expect(totals.tax).toBe(10);       // 10% of 100
    expect(totals.grandTotal).toBe(190);
  });

  it("a fully-exempt invoice charges zero tax even with a tax rate", () => {
    const totals = computeTotals(
      [
        { quantity: 3, unitPrice: 20, taxable: false },
        { quantity: 1, unitPrice: 5,  taxable: false },
      ],
      { taxRate: 0.13 },
    );
    expect(totals.tax).toBe(0);
    expect(totals.grandTotal).toBe(65);
  });

  it("applies tax on the post-discount net, not the gross", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPrice: 100, discountType: "percent", discountValue: 20, taxable: true },
      ],
      { taxRate: 0.1 },
    );
    // Net 80, tax 8
    expect(totals.subtotal).toBe(80);
    expect(totals.tax).toBe(8);
    expect(totals.grandTotal).toBe(88);
  });

  it("adds shipping last — shipping isn't taxed here", () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 100, taxable: true }],
      { taxRate: 0.1, shipping: 15 },
    );
    expect(totals.tax).toBe(10);
    expect(totals.shipping).toBe(15);
    expect(totals.grandTotal).toBe(125);
  });

  it("sums the total discount across multiple lines", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPrice: 100, discountType: "flat", discountValue: 10 },
        { quantity: 2, unitPrice: 50,  discountType: "percent", discountValue: 10 },
      ],
    );
    // line 1 discount 10, line 2 discount 10
    expect(totals.totalDiscount).toBe(20);
    // line 1 net 90, line 2 net 90
    expect(totals.subtotal).toBe(180);
  });
});

describe("invoiceMath.computeTotals — real-time line totals", () => {
  it("reflects every keystroke by recomputing per-line totals independently", () => {
    // Simulate the distributor typing: start at qty 1, then 2, then 3.
    const base = [
      { quantity: 1, unitPrice: 50, taxable: true },
      { quantity: 4, unitPrice: 10, taxable: true },
    ];
    const t1 = computeTotals(base, { taxRate: 0 });
    expect(t1.lines[0].net).toBe(50);
    expect(t1.subtotal).toBe(90);

    const t2 = computeTotals(
      [{ ...base[0], quantity: 2 }, base[1]],
      { taxRate: 0 },
    );
    expect(t2.lines[0].net).toBe(100);
    expect(t2.subtotal).toBe(140);

    const t3 = computeTotals(
      [{ ...base[0], quantity: 3 }, base[1]],
      { taxRate: 0 },
    );
    expect(t3.lines[0].net).toBe(150);
    expect(t3.subtotal).toBe(190);
  });

  it("recomputes when only a discount mode flips", () => {
    const percent = computeTotals(
      [{ quantity: 2, unitPrice: 100, discountType: "percent", discountValue: 25 }],
    );
    const flat = computeTotals(
      [{ quantity: 2, unitPrice: 100, discountType: "flat", discountValue: 25 }],
    );
    // percent: 25% of 200 = 50 discount, net 150
    expect(percent.subtotal).toBe(150);
    // flat: 25 discount, net 175
    expect(flat.subtotal).toBe(175);
  });
});

describe("invoiceMath.resolveDueDate", () => {
  const issuedAt = new Date("2026-04-17T12:00:00Z");

  it("returns the same day for due on receipt", () => {
    const due = resolveDueDate("due_on_receipt", null, issuedAt);
    expect(due?.toISOString().slice(0, 10)).toBe("2026-04-17");
  });

  it("adds the right day count for net terms", () => {
    expect(resolveDueDate("net_15", null, issuedAt)?.toISOString().slice(0, 10)).toBe("2026-05-02");
    expect(resolveDueDate("net_30", null, issuedAt)?.toISOString().slice(0, 10)).toBe("2026-05-17");
    expect(resolveDueDate("net_60", null, issuedAt)?.toISOString().slice(0, 10)).toBe("2026-06-16");
  });

  it("uses the custom date when terms are custom", () => {
    const due = resolveDueDate("custom", "2026-09-01", issuedAt);
    expect(due?.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("returns null for custom terms with no date", () => {
    expect(resolveDueDate("custom", null, issuedAt)).toBeNull();
  });
});
