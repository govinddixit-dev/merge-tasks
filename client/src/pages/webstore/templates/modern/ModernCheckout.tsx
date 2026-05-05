/**
 * ModernCheckout — wireframe-driven checkout for the Modern template.
 *
 * Behavior preserved verbatim from StoreCheckoutPage.legacy.tsx — this is a
 * pure re-skin. Every business rule from the regression checklist holds:
 *   - Role-gated payment methods (admin/manager/employee/intern)
 *   - Spending limit + dept budget + per-order-cap gating with banners
 *   - Promo code expandable form (validate / apply / remove / error)
 *   - PO branch allocation (must total 100%)
 *   - Print/promo split: submitPrintLines() runs first; print-only carts
 *     short-circuit (no Stripe redirect)
 *   - Stripe-hosted redirect for credit_card; direct order for PO/GL/points
 *   - Order confirmation screen
 *   - Login gate
 *
 * Visual changes:
 *   - Two-column: form (60%) + sticky paper-soft summary (40%)
 *   - Italic-led section labels ("Payment. Details.")
 *   - Hairline-rule fields, no card chrome
 *   - Brand-accent place-order CTA
 */
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle, Package, CreditCard, FileText, Star, Check, LogIn, Loader2,
  MapPin, Building2, Receipt, ChevronDown, Tag, X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../../StoreContext";
import { trpc } from "@/lib/trpc";
import { BudgetBanner } from "../../BudgetBanner";
import ModernShell from "./ModernShell";

type PaymentMethodKey = "credit_card" | "po_number" | "gl_code" | "company_points";

const rolePaymentMethods: Record<string, PaymentMethodKey[]> = {
  admin: ["credit_card", "po_number", "gl_code", "company_points"],
  manager: ["credit_card", "po_number", "gl_code"],
  employee: ["credit_card", "company_points"],
  intern: ["company_points"],
};

const paymentLabels: Record<PaymentMethodKey, { label: string; icon: typeof CreditCard; description: string }> = {
  credit_card: { label: "Credit Card", icon: CreditCard, description: "Pay securely via Stripe" },
  po_number: { label: "Purchase Order", icon: FileText, description: "Pay with a PO number" },
  gl_code: { label: "GL Code", icon: Receipt, description: "Charge to a GL account" },
  company_points: { label: "Company Points", icon: Star, description: "Redeem your point balance" },
};

export default function ModernCheckout() {
  const { store, cart, cartTotal, clearCart, isDark, storeUser, isLoggedIn } = useStore();
  const [, navigate] = useLocation();

  const storeToken = document.cookie.split("; ")
    .find(c => c.startsWith("store_token="))?.split("=")[1] ?? "";

  // ── Local state ───────────────────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKey>("credit_card");

  const [poNumber, setPoNumber] = useState("");
  const [glCode, setGlCode] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingBranchId, setShippingBranchId] = useState("");
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [branchAllocations, setBranchAllocations] = useState<Array<{ branchId: string; percentage: number }>>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountCents: number; description: string } | null>(null);
  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [validatingPromo, setValidatingPromo] = useState(false);

  // ── Department budget query ───────────────────────────────────────────
  const budgetQuery = trpc.storeDepartmentBudgets.getMyBudget.useQuery(
    { storeId: store.id },
    { enabled: isLoggedIn && !!storeUser?.departmentId },
  );
  const deptBudget = budgetQuery.data ?? null;

  // ── Branch locations ──────────────────────────────────────────────────
  const branches = store.branchLocations ?? [];
  const hasBranches = branches.length > 0;

  useEffect(() => {
    if (hasBranches) {
      const def = branches.find(b => b.isDefault) || branches[0];
      if (def) setShippingBranchId(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Payment method filtering ──────────────────────────────────────────
  const userRole = storeUser?.role || "employee";
  const allowedMethods = useMemo(() => {
    const roleMethods = rolePaymentMethods[userRole] || ["credit_card"];
    if (!store.allowedPaymentMethods) return roleMethods;
    return roleMethods.filter(m => store.allowedPaymentMethods!.includes(m));
  }, [userRole, store.allowedPaymentMethods]);

  useEffect(() => {
    if (allowedMethods.length > 0 && !allowedMethods.includes(paymentMethod)) {
      setPaymentMethod(allowedMethods[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMethods]);

  // ── Spending / budget / points checks ─────────────────────────────────
  const spendingLimit = storeUser?.spendingLimit ? parseFloat(storeUser.spendingLimit) : null;
  const overLimit = spendingLimit !== null && cartTotal > spendingLimit;
  const overBudget = deptBudget?.department
    ? cartTotal * 100 > (deptBudget.department.budgetCents - deptBudget.department.spentCents)
    : false;
  const overPerOrderCap = deptBudget?.department?.maxPerOrderCents
    ? cartTotal * 100 > deptBudget.department.maxPerOrderCents
    : false;
  const pointsBalance = storeUser?.pointsBalance ?? 0;
  const pointsCostCents = Math.round(cartTotal * 100);
  const notEnoughPoints = paymentMethod === "company_points" && pointsBalance < pointsCostCents;

  // ── tRPC mutations ────────────────────────────────────────────────────
  const checkoutMut = trpc.storeCheckout.createSession.useMutation();
  const directOrderMut = trpc.storeCheckout.createDirectOrder.useMutation();
  const validatePromoMut = trpc.storeCheckout.validatePromoCode.useMutation();
  const printSubmitMut = trpc.storePortal.print.submit.useMutation();

  // Submit each print line as a printRequest BEFORE promo items are sent
  // through Stripe/GL/PO so the print side exists in the distributor's
  // queue regardless of payment step. Failures short-circuit promo
  // submission so we never charge a card without the matching print
  // request landing on the other side.
  async function submitPrintLines(): Promise<void> {
    const printLines = cart.filter(i => i.kind === "print");
    for (const item of printLines) {
      const category: "business_cards" | "flyers" | "banners" | "other" =
        item.printProductType === "posters" ? "other" : (item.printProductType ?? "other");
      await printSubmitMut.mutateAsync({
        storeSlug: store.slug,
        category,
        title: item.variantLabel ? `${item.name} — ${item.variantLabel}` : item.name,
        description: `Cart-submitted print order at $${item.price.toFixed(2)}/unit, total $${(item.price * item.quantity).toFixed(2)}.`,
        quantity: item.quantity,
      });
    }
  }

  // ── Promo code handler ────────────────────────────────────────────────
  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) { setPromoError("Enter a promo code"); return; }
    setPromoError("");
    setValidatingPromo(true);
    try {
      const result = await validatePromoMut.mutateAsync({
        storeSlug: store.slug,
        code,
        subtotal: cartTotal,
      });
      if (result.valid) {
        setAppliedPromo({
          code,
          discountCents: Math.round(parseFloat(result.discountAmount!) * 100),
          description: result.description || `${code} discount`,
        });
        setPromoError("");
      } else {
        setPromoError(result.reason || "Invalid promo code");
      }
    } catch (err: unknown) {
      setPromoError(err instanceof Error ? err.message : "Failed to validate promo code");
    } finally {
      setValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError("");
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (paymentMethod === "po_number" && !poNumber.trim()) {
      errors.poNumber = "PO number is required";
    }
    if (paymentMethod === "gl_code" && !glCode.trim()) {
      errors.glCode = "GL code is required";
    }
    if (paymentMethod === "po_number" && branchAllocations.length > 0) {
      const total = branchAllocations.reduce((sum, a) => sum + a.percentage, 0);
      if (Math.abs(total - 100) > 0.01) {
        errors.branchAllocation = "Branch allocations must total 100%";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Place order handler ───────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (overLimit) { toast.error(`Order exceeds your spending limit of $${spendingLimit?.toFixed(2)}.`); return; }
    if (overBudget) { toast.error("Order exceeds your department's remaining budget."); return; }
    if (notEnoughPoints) { toast.error("You don't have enough points for this order."); return; }
    if (paymentMethod !== "credit_card" && !validateForm()) return;

    setProcessing(true);
    try {
      const promoItems = cart.filter(i => i.kind === "promotional");
      const printItems = cart.filter(i => i.kind === "print");
      const cartItems = promoItems.map(item => ({
        storeProductId: item.storeProductId ?? 0,
        productId: item.id,
        quantity: item.quantity,
        imprintZoneSlug: item.imprintZoneSlug,
        decorationMethod: item.decorationMethod,
      }));

      if (printItems.length > 0) {
        await submitPrintLines();
      }

      // Print-only cart: confirm & clear, no payment flow.
      if (promoItems.length === 0 && printItems.length > 0) {
        setOrderNumber(null);
        setComplete(true);
        clearCart();
        toast.success("Print request submitted to your distributor.");
        setProcessing(false);
        return;
      }

      if (paymentMethod === "credit_card") {
        const result = await checkoutMut.mutateAsync({
          storeSlug: store.slug,
          storeToken,
          items: cartItems,
          shippingName: hasBranches && shippingBranchId
            ? branches.find(b => b.id === shippingBranchId)?.name
            : shippingName || undefined,
          shippingAddress: hasBranches && shippingBranchId
            ? branches.find(b => b.id === shippingBranchId)?.address
            : shippingAddress || undefined,
          origin: window.location.origin,
          buyerEmail: storeUser?.email ?? undefined,
          promoCode: appliedPromo?.code ?? undefined,
        });
        if (result.url) {
          window.location.href = result.url;
          return;
        }
        setOrderNumber(result.orderNumber);
        setComplete(true);
        clearCart();
        toast.success("Order placed");
      } else {
        const result = await directOrderMut.mutateAsync({
          storeSlug: store.slug,
          storeToken,
          items: cartItems,
          paymentMethod,
          poNumber: paymentMethod === "po_number" ? poNumber.trim() : undefined,
          glCode: (paymentMethod === "gl_code" || paymentMethod === "po_number") && glCode.trim()
            ? glCode.trim()
            : undefined,
          branchAllocation: paymentMethod === "po_number" && branchAllocations.length > 0
            ? branchAllocations
            : undefined,
          billingAddress: billingAddress.trim() || undefined,
          shippingBranchId: hasBranches && shippingBranchId ? shippingBranchId : undefined,
          shippingName: !hasBranches ? shippingName || undefined : undefined,
          shippingAddress: !hasBranches ? shippingAddress || undefined : undefined,
          buyerEmail: storeUser?.email ?? undefined,
          promoCode: appliedPromo?.code ?? undefined,
        });
        setOrderNumber(result.orderNumber);
        setComplete(true);
        clearCart();
        toast.success("Order placed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to place order. Please try again.";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  // ── Order confirmation ────────────────────────────────────────────────
  if (complete) {
    return (
      <ModernShell footer="compact">
        <section className="max-w-md mx-auto px-4 sm:px-6 py-24 text-center">
          <Check size={40} className="mx-auto mb-6 text-brand" />
          <h1 className="font-serif-display italic text-[44px] sm:text-[56px] text-ink leading-[1.05] mb-3">
            Order confirmed.
          </h1>
          <p className="text-[14px] text-ws-muted mb-1">
            Thank you, {storeUser?.name || "Guest"}. Your order has been placed.
          </p>
          {orderNumber && (
            <p className="text-[12px] font-mono text-ink mb-2">Order #{orderNumber}</p>
          )}
          <p className="text-[12px] text-ws-muted mb-8">
            A confirmation email has been sent to {storeUser?.email || "your email"}.
          </p>
          <button
            type="button"
            onClick={() => navigate(`~/s/${store.slug}`)}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            Continue Shopping
          </button>
        </section>
      </ModernShell>
    );
  }

  // ── Login gate ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <ModernShell footer="compact">
        <section className="max-w-md mx-auto px-4 sm:px-6 py-24 text-center">
          <LogIn size={36} className="mx-auto mb-6 text-brand" />
          <h1 className="font-serif-display italic text-[40px] text-ink leading-[1.05] mb-3">
            Sign in to checkout.
          </h1>
          <p className="text-[14px] text-ws-muted mb-8">
            You need to be signed in to place an order.
          </p>
          <button
            type="button"
            onClick={() => navigate(`~/s/${store.slug}/login`)}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            Sign In
          </button>
        </section>
      </ModernShell>
    );
  }

  const canPlace = !processing && !overLimit && !overBudget && !overPerOrderCap && !notEnoughPoints;
  const isDirectOrder = paymentMethod !== "credit_card";

  // Hairline-rule input — same shape as Modern Custom Request.
  const hairlineInput = (field: string) =>
    `w-full bg-transparent text-[14px] text-ink py-2 border-0 border-b outline-none transition-colors placeholder:text-ws-muted-soft ${
      formErrors[field] ? "border-red-500" : "border-rule focus:border-ink"
    }`;
  const labelClass = "block text-[10px] font-bold tracking-[0.16em] uppercase text-ws-muted mb-2";
  const sectionLabel = (kicker: string, italicWord: string) => (
    <h3 className="text-[24px] font-bold tracking-tight text-ink mb-5">
      {kicker} <em className="font-serif-display font-normal italic text-ink">{italicWord}.</em>
    </h3>
  );

  // ── Sub-renderers ─────────────────────────────────────────────────────
  const renderShipTo = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={14} className="text-brand" />
        <h4 className={labelClass.replace("mb-2", "mb-0")}>Ship to</h4>
      </div>
      {hasBranches ? (
        <div className="relative">
          <select
            value={shippingBranchId}
            onChange={e => setShippingBranchId(e.target.value)}
            className="w-full bg-transparent text-[14px] text-ink py-2 border-0 border-b border-rule focus:border-ink outline-none appearance-none"
          >
            <option value="">Select a shipping location…</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name} — {b.address}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-ws-muted" />
        </div>
      ) : (
        <div className="space-y-3">
          <input
            placeholder="Recipient name"
            value={shippingName}
            onChange={e => setShippingName(e.target.value)}
            className={hairlineInput("shippingName")}
          />
          <input
            placeholder="Shipping address"
            value={shippingAddress}
            onChange={e => setShippingAddress(e.target.value)}
            className={hairlineInput("shippingAddress")}
          />
        </div>
      )}
    </div>
  );

  const renderBillTo = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={14} className="text-brand" />
        <h4 className={labelClass.replace("mb-2", "mb-0")}>Bill to</h4>
      </div>
      <textarea
        placeholder="Billing name and address"
        rows={2}
        value={billingAddress}
        onChange={e => setBillingAddress(e.target.value)}
        className={`${hairlineInput("billingAddress")} resize-none`}
      />
    </div>
  );

  const renderPOForm = () => (
    <div className="space-y-6">
      <div>
        <label className={labelClass}>
          PO number <span className="text-red-500">*</span>
        </label>
        <input
          placeholder="Enter purchase order number"
          value={poNumber}
          onChange={e => { setPoNumber(e.target.value); setFormErrors(p => ({ ...p, poNumber: "" })); }}
          className={hairlineInput("poNumber")}
        />
        {formErrors.poNumber && <p className="text-[11px] text-red-500 mt-1">{formErrors.poNumber}</p>}
      </div>
      <div>
        <label className={labelClass}>GL code (optional)</label>
        <input
          placeholder="Internal tracking code"
          value={glCode}
          onChange={e => setGlCode(e.target.value)}
          className={hairlineInput("glCode")}
        />
      </div>
      {hasBranches && branches.length > 1 && (
        <div>
          <label className={labelClass}>Branch allocation</label>
          <p className="text-[11px] text-ws-muted mb-2">
            Allocate costs across branches (must total 100%).
          </p>
          <div className="space-y-2">
            {branches.map(b => {
              const alloc = branchAllocations.find(a => a.branchId === b.id);
              return (
                <div key={b.id} className="flex items-center gap-3 py-1">
                  <span className="text-[13px] text-ink flex-1 truncate">{b.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={alloc?.percentage ?? ""}
                    placeholder="0"
                    onChange={e => {
                      const val = parseFloat(e.target.value) || 0;
                      setBranchAllocations(prev => {
                        const filtered = prev.filter(a => a.branchId !== b.id);
                        if (val > 0) filtered.push({ branchId: b.id, percentage: val });
                        return filtered;
                      });
                      setFormErrors(p => ({ ...p, branchAllocation: "" }));
                    }}
                    className="w-20 bg-transparent text-[13px] text-right text-ink py-1 border-0 border-b border-rule focus:border-ink outline-none"
                  />
                  <span className="text-[12px] text-ws-muted w-3">%</span>
                </div>
              );
            })}
          </div>
          {formErrors.branchAllocation && (
            <p className="text-[11px] text-red-500 mt-1">{formErrors.branchAllocation}</p>
          )}
        </div>
      )}
      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  const renderGLForm = () => (
    <div className="space-y-6">
      <div>
        <label className={labelClass}>
          GL code <span className="text-red-500">*</span>
        </label>
        <input
          placeholder="Enter GL account code"
          value={glCode}
          onChange={e => { setGlCode(e.target.value); setFormErrors(p => ({ ...p, glCode: "" })); }}
          className={hairlineInput("glCode")}
        />
        {formErrors.glCode && <p className="text-[11px] text-red-500 mt-1">{formErrors.glCode}</p>}
      </div>
      {storeUser?.department && (
        <div>
          <label className={labelClass}>Cost center / department</label>
          <input
            value={storeUser.department}
            disabled
            className="w-full bg-transparent text-[14px] text-ws-muted py-2 border-0 border-b border-rule outline-none"
          />
        </div>
      )}
      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  const renderPointsForm = () => (
    <div className="space-y-6">
      <div className="bg-paper-soft p-5 border border-rule">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-ink">Your Points Balance</span>
          <span className="text-[16px] font-bold text-brand">
            {pointsBalance.toLocaleString()} pts
          </span>
        </div>
        <div className="w-full h-1.5 bg-rule overflow-hidden">
          <div
            className="h-full transition-all"
            style={{
              width: `${Math.min((pointsCostCents / Math.max(pointsBalance, 1)) * 100, 100)}%`,
              backgroundColor: notEnoughPoints ? "#DC2626" : "var(--color-brand)",
            }}
          />
        </div>
        <div className="flex justify-between mt-2 text-[11px]">
          <span className="text-ws-muted">{pointsCostCents.toLocaleString()} pts will be deducted</span>
          <span className={notEnoughPoints ? "text-red-500" : "text-ws-muted"}>
            {(pointsBalance - pointsCostCents).toLocaleString()} pts remaining
          </span>
        </div>
      </div>
      {renderShipTo()}
    </div>
  );

  const renderCCForm = () => (
    <div className="space-y-6">
      <div className="bg-paper-soft p-5 border border-rule flex items-center gap-2">
        <CreditCard size={16} className="text-brand" />
        <p className="text-[12px] text-ink">
          You'll be redirected to Stripe's secure checkout to complete payment.
        </p>
      </div>
      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  // ── Main layout ───────────────────────────────────────────────────────
  return (
    <ModernShell footer="compact">
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-12 pt-12 pb-20">
        <h1 className="text-[48px] sm:text-[64px] font-bold tracking-tight leading-[1] text-ink mb-3">
          Checkout<span className="font-serif-display italic font-normal">.</span>
        </h1>
        <p className="text-[13px] text-ws-muted mb-10">
          Available payment methods are based on your role: <span className="font-semibold text-ink">{userRole.charAt(0).toUpperCase()}{userRole.slice(1)}</span>
        </p>

        <BudgetBanner storeId={store.id} isDark={isDark} cartTotalCents={Math.round(cartTotal * 100)} />

        {/* Warning banners */}
        {overLimit && (
          <div className="flex items-start gap-3 p-4 mb-6 bg-red-50 border border-red-200">
            <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-red-700">Order exceeds spending limit</p>
              <p className="text-[11px] text-red-600/80">
                Your limit is ${spendingLimit?.toFixed(2)} per order. Contact your manager for approval or reduce your cart.
              </p>
            </div>
          </div>
        )}
        {overBudget && (
          <div className="flex items-start gap-3 p-4 mb-6 bg-orange-50 border border-orange-200">
            <AlertTriangle size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-orange-700">Exceeds department budget</p>
              <p className="text-[11px] text-orange-600/80">
                Your department has ${((deptBudget!.department!.budgetCents - deptBudget!.department!.spentCents) / 100).toFixed(2)} remaining this period.
              </p>
            </div>
          </div>
        )}
        {overPerOrderCap && !overBudget && (
          <div className="flex items-start gap-3 p-4 mb-6 bg-red-50 border border-red-200">
            <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-red-700">Exceeds per-order limit</p>
              <p className="text-[11px] text-red-600/80">
                Your department's per-order cap is ${(deptBudget!.department!.maxPerOrderCents! / 100).toFixed(2)}. Reduce your cart to proceed.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12">
          {/* Form column */}
          <div className="space-y-12">
            {/* Payment method picker */}
            <div>
              {sectionLabel("Payment", "method")}
              <div className="space-y-2">
                {allowedMethods.map(method => {
                  const info = paymentLabels[method];
                  const Icon = info.icon;
                  const selected = paymentMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => { setPaymentMethod(method); setFormErrors({}); }}
                      className="w-full flex items-center gap-3 p-4 text-left transition-colors"
                      style={{
                        backgroundColor: selected ? "color-mix(in srgb, var(--color-brand) 8%, transparent)" : "transparent",
                        border: `1.5px solid ${selected ? "var(--color-brand)" : "var(--color-rule)"}`,
                      }}
                    >
                      <Icon
                        size={16}
                        style={{ color: selected ? "var(--color-brand)" : "var(--color-ws-muted)" }}
                      />
                      <div className="flex-1">
                        <span
                          className="text-[14px] font-semibold block"
                          style={{ color: selected ? "var(--color-brand)" : "var(--color-ink)" }}
                        >
                          {info.label}
                        </span>
                        <span className="text-[11px] text-ws-muted">{info.description}</span>
                      </div>
                      {selected && <Check size={14} className="text-brand flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment form */}
            <div>
              {sectionLabel(
                paymentMethod === "credit_card" ? "Payment" :
                paymentMethod === "po_number" ? "Purchase order" :
                paymentMethod === "gl_code" ? "GL code" : "Points",
                "details",
              )}
              {paymentMethod === "credit_card" && renderCCForm()}
              {paymentMethod === "po_number" && renderPOForm()}
              {paymentMethod === "gl_code" && renderGLForm()}
              {paymentMethod === "company_points" && renderPointsForm()}
            </div>

            {/* Promo code */}
            <div>
              {appliedPromo ? (
                <div className="flex items-center justify-between p-4 border border-green-300 bg-green-50">
                  <div className="flex items-center gap-2">
                    <Tag size={14} className="text-green-700" />
                    <span className="text-[13px] font-semibold text-green-700">{appliedPromo.code}</span>
                    <span className="text-[11px] text-ws-muted">– {appliedPromo.description}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="p-1 text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPromoExpanded(!promoExpanded)}
                    className="flex items-center gap-2 text-[13px] font-bold tracking-[0.06em] uppercase text-brand"
                  >
                    <Tag size={13} /> Have a promo code?
                    <ChevronDown
                      size={13}
                      className="transition-transform"
                      style={{ transform: promoExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                  </button>
                  {promoExpanded && (
                    <div className="mt-3 flex gap-2">
                      <input
                        placeholder="Enter code"
                        value={promoInput}
                        onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(""); }}
                        onKeyDown={e => { if (e.key === "Enter") handleApplyPromo(); }}
                        className={`flex-1 bg-transparent text-[13px] text-ink py-2 border-0 border-b outline-none uppercase tracking-wider font-mono ${promoError ? "border-red-500" : "border-rule focus:border-ink"}`}
                      />
                      <button
                        type="button"
                        onClick={handleApplyPromo}
                        disabled={validatingPromo || !promoInput.trim()}
                        className="px-5 py-2 text-[11px] font-bold tracking-[0.12em] uppercase text-paper disabled:opacity-60 flex items-center gap-1.5"
                        style={{ backgroundColor: "var(--color-brand)" }}
                      >
                        {validatingPromo && <Loader2 size={12} className="animate-spin" />}
                        Apply
                      </button>
                    </div>
                  )}
                  {promoError && <p className="text-[11px] text-red-500 mt-1.5">{promoError}</p>}
                </>
              )}
            </div>
          </div>

          {/* Summary sidebar */}
          <aside className="bg-paper-soft p-6 lg:sticky lg:top-[104px] self-start">
            <h2 className="text-[20px] font-bold text-ink mb-4">Order summary</h2>

            {storeUser && (
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-rule">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold"
                  style={{ backgroundColor: "var(--color-brand)" }}
                >
                  {(storeUser.name || "U").charAt(0)}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-ink">{storeUser.name || "User"}</p>
                  <p className="text-[11px] text-ws-muted">
                    {userRole.charAt(0).toUpperCase()}{userRole.slice(1)}
                    {storeUser.department ? ` · ${storeUser.department}` : ""}
                  </p>
                </div>
              </div>
            )}

            {deptBudget?.department && (
              <div className="mb-4 pb-4 border-b border-rule">
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-ws-muted">Dept budget</span>
                  <span className="text-ink">
                    ${(deptBudget.department.spentCents / 100).toFixed(0)} / ${(deptBudget.department.budgetCents / 100).toFixed(0)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-rule overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min((deptBudget.department.spentCents / deptBudget.department.budgetCents) * 100, 100)}%`,
                      backgroundColor: overBudget ? "#DC2626" : "var(--color-brand)",
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mb-4 pb-4 border-b border-rule space-y-2">
              {cart.map(item => (
                <div key={item.lineKey} className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-paper border border-rule overflow-hidden flex-shrink-0">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Package size={14} className="text-ws-muted-soft" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-ink truncate">{item.name}</p>
                    {item.kind === "print" && item.variantLabel && (
                      <p className="text-[10px] text-ws-muted truncate">{item.variantLabel}</p>
                    )}
                    <p className="text-[10px] text-ws-muted">Qty: {item.quantity}</p>
                  </div>
                  <p className="text-[12px] font-semibold text-ink">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-ws-muted">Subtotal</span>
                <span className="text-ink">${cartTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ws-muted">Shipping</span>
                <span className="text-green-700 font-semibold">Free</span>
              </div>
              {appliedPromo && (
                <div className="flex justify-between text-green-700">
                  <span className="flex items-center gap-1"><Tag size={12} /> Discount ({appliedPromo.code})</span>
                  <span className="font-semibold">-${(appliedPromo.discountCents / 100).toFixed(2)}</span>
                </div>
              )}
              {spendingLimit !== null && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-ws-muted">Spending limit</span>
                  <span className={overLimit ? "text-red-500" : "text-ink"}>${spendingLimit.toFixed(2)}</span>
                </div>
              )}
              {paymentMethod === "company_points" && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-ws-muted">Points balance</span>
                  <span className={notEnoughPoints ? "text-red-500" : "text-ink"}>
                    {pointsBalance.toLocaleString()} pts
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4 pt-3 border-t border-rule flex justify-between items-baseline">
              <span className="text-[14px] font-bold text-ink">Total</span>
              <span
                className="text-[24px] font-bold"
                style={{ color: !canPlace ? "#DC2626" : "var(--color-ink)" }}
              >
                ${(cartTotal - (appliedPromo ? appliedPromo.discountCents / 100 : 0)).toFixed(2)}
              </span>
            </div>

            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={!canPlace}
              className="w-full mt-5 py-3.5 text-[12px] font-bold tracking-[0.12em] uppercase text-paper flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ backgroundColor: !canPlace ? "#9CA3AF" : "var(--color-brand)" }}
            >
              {processing && <Loader2 size={14} className="animate-spin" />}
              {processing
                ? "Processing…"
                : overLimit
                  ? "Exceeds Limit"
                  : overBudget
                    ? "Exceeds Budget"
                    : notEnoughPoints
                      ? "Insufficient Points"
                      : isDirectOrder
                        ? "Place Order"
                        : "Continue to Payment"}
            </button>
            <p className="text-center text-[10px] mt-3 text-ws-muted">
              Secure checkout powered by MergeTasks
            </p>
          </aside>
        </div>
      </section>
    </ModernShell>
  );
}
