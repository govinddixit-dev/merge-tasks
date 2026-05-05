/**
 * StoreCheckoutPage — Role-based payment method selection and order placement.
 *
 * Two distinct form experiences:
 *   1. Credit Card → Stripe hosted checkout (existing createSession flow)
 *   2. PO / GL Code / Company Points → direct order creation (createDirectOrder)
 *
 * Budget awareness: If the logged-in user belongs to a department with a
 * budget, a progress bar shows remaining budget before they place the order.
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle, Package, CreditCard, FileText, Star, Check, LogIn, Loader2,
  MapPin, Building2, Receipt, ChevronDown, Tag, X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "./StoreContext";
import { trpc } from "../../lib/trpc";
import { BudgetBanner } from "./BudgetBanner";

// ── Types ────────────────────────────────────────────────────────────────────

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

export default function StoreCheckoutPage() {
  const { store, cart, cartTotal, clearCart, isDark, storeUser, isLoggedIn } = useStore();
  const [, navigate] = useLocation();

  const storeToken = document.cookie.split('; ')
    .find(c => c.startsWith('store_token='))?.split('=')[1] ?? '';

  // ── Theme tokens ──────────────────────────────────────────────────────
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const cardBg = isDark ? "#252525" : "#FAFAFA";
  const borderColor = isDark ? "#333" : "#E5E5E5";

  // ── Local state ───────────────────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKey>("credit_card");

  // PO form fields
  const [poNumber, setPoNumber] = useState("");
  const [glCode, setGlCode] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingBranchId, setShippingBranchId] = useState("");
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [branchAllocations, setBranchAllocations] = useState<Array<{ branchId: string; percentage: number }>>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Promo code state
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

  // Set default branch on load
  useEffect(() => {
    if (hasBranches) {
      const defaultBranch = branches.find((b) => b.isDefault) || branches[0];
      if (defaultBranch) setShippingBranchId(defaultBranch.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Payment method filtering ──────────────────────────────────────────
  const userRole = storeUser?.role || "employee";
  const allowedMethods = useMemo(() => {
    const roleMethods = rolePaymentMethods[userRole] || ["credit_card"];
    if (!store.allowedPaymentMethods) return roleMethods;
    return roleMethods.filter((m) => store.allowedPaymentMethods!.includes(m));
  }, [userRole, store.allowedPaymentMethods]);

  // Auto-select first available method if current is not allowed
  useEffect(() => {
    if (allowedMethods.length > 0 && !allowedMethods.includes(paymentMethod)) {
      setPaymentMethod(allowedMethods[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMethods]);

  // ── Spending limit check ──────────────────────────────────────────────
  const spendingLimit = storeUser?.spendingLimit ? parseFloat(storeUser.spendingLimit) : null;
  const overLimit = spendingLimit !== null && cartTotal > spendingLimit;

  // ── Department budget check ───────────────────────────────────────────
  const overBudget = deptBudget?.department
    ? cartTotal * 100 > (deptBudget.department.budgetCents - deptBudget.department.spentCents)
    : false;
  const overPerOrderCap = deptBudget?.department?.maxPerOrderCents
    ? cartTotal * 100 > deptBudget.department.maxPerOrderCents
    : false;

  // ── Points check ──────────────────────────────────────────────────────
  const pointsBalance = storeUser?.pointsBalance ?? 0;
  const pointsCostCents = Math.round(cartTotal * 100);
  const notEnoughPoints = paymentMethod === "company_points" && pointsBalance < pointsCostCents;

  // ── tRPC mutations ────────────────────────────────────────────────────
  const checkoutMut = trpc.storeCheckout.createSession.useMutation();
  const directOrderMut = trpc.storeCheckout.createDirectOrder.useMutation();
  const validatePromoMut = trpc.storeCheckout.validatePromoCode.useMutation();
  const printSubmitMut = trpc.storePortal.print.submit.useMutation();

  /**
   * Submit each print line as a printRequest. Called *before* promotional
   * items are sent through Stripe/GL/PO so the print side exists in the
   * distributor's queue regardless of payment step. Failures short-circuit
   * promo submission so we never charge a card without the matching print
   * request landing on the other side.
   *
   * printProducts.productType ("business_cards" | "flyers" | "banners" |
   * "posters") is a narrower set than printRequests.category — posters
   * rides on the existing "other" slot until the category enum is
   * extended. Everything else maps 1:1.
   */
  async function submitPrintLines(): Promise<void> {
    const printLines = cart.filter((i) => i.kind === "print");
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

  // ── Form validation ───────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (paymentMethod === "po_number" && !poNumber.trim()) {
      errors.poNumber = "PO number is required";
    }
    if (paymentMethod === "gl_code" && !glCode.trim()) {
      errors.glCode = "GL code is required";
    }

    // Branch allocation validation
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
    if (overLimit) {
      toast.error(`Order exceeds your spending limit of $${spendingLimit?.toFixed(2)}.`);
      return;
    }
    if (overBudget) {
      toast.error("Order exceeds your department's remaining budget.");
      return;
    }
    if (notEnoughPoints) {
      toast.error("You don't have enough points for this order.");
      return;
    }

    if (paymentMethod !== "credit_card" && !validateForm()) return;

    setProcessing(true);

    try {
      // Split promo vs print items. Promotional items go through the
      // existing Stripe/GL/PO checkout; print items are submitted as
      // printRequests because the orders table does not carry variant/
      // tier metadata. Budget is enforced against cartTotal (which
      // already sums both kinds) before we get here.
      const promoItems = cart.filter((i) => i.kind === "promotional");
      const printItems = cart.filter((i) => i.kind === "print");
      const cartItems = promoItems.map((item) => ({
        storeProductId: item.storeProductId ?? 0,
        productId: item.id,
        quantity: item.quantity,
        imprintZoneSlug: item.imprintZoneSlug,
        decorationMethod: item.decorationMethod,
      }));

      // Submit print requests first so the distributor sees them even if
      // the promo-side payment flow is aborted or redirects to Stripe.
      if (printItems.length > 0) {
        await submitPrintLines();
      }

      // If the cart was print-only, there is nothing to send through the
      // orders pipeline — confirm and clear.
      if (promoItems.length === 0 && printItems.length > 0) {
        setOrderNumber(null);
        setComplete(true);
        clearCart();
        toast.success("Print request submitted to your distributor.");
        setProcessing(false);
        return;
      }

      if (paymentMethod === "credit_card") {
        // ── Credit card → Stripe hosted checkout ──────────────────────
        const result = await checkoutMut.mutateAsync({
          storeSlug: store.slug,
          storeToken,
          items: cartItems,
          shippingName: hasBranches && shippingBranchId
            ? branches.find((b) => b.id === shippingBranchId)?.name
            : shippingName || undefined,
          shippingAddress: hasBranches && shippingBranchId
            ? branches.find((b) => b.id === shippingBranchId)?.address
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
        // ── PO / GL / Points → direct order ───────────────────────────
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

  // ── Order confirmation screen ─────────────────────────────────────────
  if (complete) {
    return (
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${store.primaryColor}20` }}
        >
          <Check size={32} style={{ color: store.primaryColor }} />
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: fg }}>Order Confirmed!</h2>
        <p className="text-[13px] mb-1" style={{ color: mutedFg }}>
          Thank you, {storeUser?.name || "Guest"}. Your order has been placed.
        </p>
        {orderNumber && (
          <p className="text-[12px] font-mono mb-2" style={{ color: fg }}>
            Order #{orderNumber}
          </p>
        )}
        <p className="text-[12px] mb-8" style={{ color: mutedFg }}>
          A confirmation email has been sent to {storeUser?.email || "your email"}.
        </p>
        <button
          onClick={() => navigate(`~/s/${store.slug}`)}
          className="px-8 py-3 rounded-lg text-[13px] font-semibold text-white"
          style={{ backgroundColor: store.primaryColor }}
        >
          Continue Shopping
        </button>
      </div>
    );
  }

  // ── Login gate ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${store.primaryColor}20` }}
        >
          <LogIn size={28} style={{ color: store.primaryColor }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>Sign in to Checkout</h2>
        <p className="text-[13px] mb-6" style={{ color: mutedFg }}>
          You need to be signed in to place an order.
        </p>
        <button
          onClick={() => navigate(`~/s/${store.slug}/login`)}
          className="px-8 py-3 rounded-lg text-[13px] font-semibold text-white"
          style={{ backgroundColor: store.primaryColor }}
        >
          Sign In
        </button>
      </div>
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  const canPlace = !processing && !overLimit && !overBudget && !overPerOrderCap && !notEnoughPoints;
  const isDirectOrder = paymentMethod !== "credit_card";

  const inputClass = (field: string) =>
    `w-full px-3 py-2.5 rounded-lg text-[13px] outline-none transition-colors ${
      formErrors[field]
        ? "border-2 border-red-400 focus:border-red-500"
        : `border focus:border-[${store.primaryColor}]`
    }`;

  const inputStyle = (field: string) => ({
    backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
    borderColor: formErrors[field] ? "#F87171" : borderColor,
    color: fg,
  });

  // ── Render: Ship-to Section ───────────────────────────────────────────
  const renderShipTo = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={15} style={{ color: store.primaryColor }} />
        <h4 className="text-[13px] font-bold" style={{ color: fg }}>Ship To</h4>
      </div>
      {hasBranches ? (
        <div className="relative">
          <select
            value={shippingBranchId}
            onChange={(e) => setShippingBranchId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none appearance-none border transition-colors"
            style={{
              backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
              borderColor,
              color: fg,
            }}
          >
            <option value="">Select a shipping location...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.address}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: mutedFg }} />
        </div>
      ) : (
        <div className="space-y-2">
          <input
            placeholder="Recipient name"
            value={shippingName}
            onChange={(e) => setShippingName(e.target.value)}
            className={inputClass("shippingName")}
            style={inputStyle("shippingName")}
          />
          <input
            placeholder="Shipping address"
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            className={inputClass("shippingAddress")}
            style={inputStyle("shippingAddress")}
          />
        </div>
      )}
    </div>
  );

  // ── Render: Bill-to Section ───────────────────────────────────────────
  const renderBillTo = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={15} style={{ color: store.primaryColor }} />
        <h4 className="text-[13px] font-bold" style={{ color: fg }}>Bill To</h4>
      </div>
      <textarea
        placeholder="Billing name and address"
        rows={2}
        value={billingAddress}
        onChange={(e) => setBillingAddress(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none resize-none border transition-colors"
        style={{
          backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
          borderColor,
          color: fg,
        }}
      />
    </div>
  );

  // ── Render: PO Form ───────────────────────────────────────────────────
  const renderPOForm = () => (
    <div className="space-y-5">
      {/* PO Number */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
          PO Number <span className="text-red-400">*</span>
        </label>
        <input
          placeholder="Enter purchase order number"
          value={poNumber}
          onChange={(e) => { setPoNumber(e.target.value); setFormErrors((p) => ({ ...p, poNumber: "" })); }}
          className={inputClass("poNumber")}
          style={inputStyle("poNumber")}
        />
        {formErrors.poNumber && <p className="text-[11px] text-red-400 mt-1">{formErrors.poNumber}</p>}
      </div>

      {/* GL Code (optional for PO) */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
          GL Code <span className="text-[10px] font-normal">(optional)</span>
        </label>
        <input
          placeholder="Internal tracking code"
          value={glCode}
          onChange={(e) => setGlCode(e.target.value)}
          className={inputClass("glCode")}
          style={inputStyle("glCode")}
        />
      </div>

      {/* Branch Allocation */}
      {hasBranches && branches.length > 1 && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
            Branch Allocation
          </label>
          <p className="text-[11px] mb-2" style={{ color: mutedFg }}>
            Allocate costs across branches (must total 100%)
          </p>
          <div className="space-y-2">
            {branches.map((b) => {
              const alloc = branchAllocations.find((a) => a.branchId === b.id);
              return (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="text-[12px] flex-1 truncate" style={{ color: fg }}>{b.name}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={alloc?.percentage ?? ""}
                      placeholder="0"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setBranchAllocations((prev) => {
                          const filtered = prev.filter((a) => a.branchId !== b.id);
                          if (val > 0) filtered.push({ branchId: b.id, percentage: val });
                          return filtered;
                        });
                        setFormErrors((p) => ({ ...p, branchAllocation: "" }));
                      }}
                      className="w-20 px-2 py-1.5 rounded-lg text-[13px] text-right outline-none border"
                      style={{
                        backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
                        borderColor,
                        color: fg,
                      }}
                    />
                    <span className="text-[12px]" style={{ color: mutedFg }}>%</span>
                  </div>
                </div>
              );
            })}
          </div>
          {formErrors.branchAllocation && (
            <p className="text-[11px] text-red-400 mt-1">{formErrors.branchAllocation}</p>
          )}
        </div>
      )}

      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  // ── Render: GL Code Form ──────────────────────────────────────────────
  const renderGLForm = () => (
    <div className="space-y-5">
      {/* GL Code */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
          GL Code <span className="text-red-400">*</span>
        </label>
        <input
          placeholder="Enter GL account code"
          value={glCode}
          onChange={(e) => { setGlCode(e.target.value); setFormErrors((p) => ({ ...p, glCode: "" })); }}
          className={inputClass("glCode")}
          style={inputStyle("glCode")}
        />
        {formErrors.glCode && <p className="text-[11px] text-red-400 mt-1">{formErrors.glCode}</p>}
      </div>

      {/* Department (auto-filled) */}
      {storeUser?.department && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: mutedFg }}>
            Cost Center / Department
          </label>
          <input
            value={storeUser.department}
            disabled
            className="w-full px-3 py-2.5 rounded-lg text-[13px] border opacity-60"
            style={{
              backgroundColor: isDark ? "#1A1A1A" : "#F5F5F5",
              borderColor,
              color: fg,
            }}
          />
        </div>
      )}

      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  // ── Render: Points Form ───────────────────────────────────────────────
  const renderPointsForm = () => (
    <div className="space-y-5">
      {/* Points balance */}
      <div
        className="p-4 rounded-xl"
        style={{
          backgroundColor: isDark ? "#1A2332" : "#EFF6FF",
          border: `1px solid ${isDark ? "#1E3A5F" : "#BFDBFE"}`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold" style={{ color: fg }}>Your Points Balance</span>
          <span className="text-[16px] font-bold" style={{ color: store.primaryColor }}>
            {pointsBalance.toLocaleString()} pts
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? "#1A1A1A" : "#E5E5E5" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min((pointsCostCents / Math.max(pointsBalance, 1)) * 100, 100)}%`,
              backgroundColor: notEnoughPoints ? "#DC2626" : store.primaryColor,
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[11px]" style={{ color: mutedFg }}>
            {pointsCostCents.toLocaleString()} pts will be deducted
          </span>
          <span className="text-[11px]" style={{ color: notEnoughPoints ? "#DC2626" : mutedFg }}>
            {(pointsBalance - pointsCostCents).toLocaleString()} pts remaining
          </span>
        </div>
      </div>

      {renderShipTo()}
    </div>
  );

  // ── Render: CC Form ───────────────────────────────────────────────────
  const renderCCForm = () => (
    <div className="space-y-5">
      <div
        className="p-4 rounded-xl"
        style={{
          backgroundColor: isDark ? "#1A2332" : "#F0F9FF",
          border: `1px solid ${isDark ? "#1E3A5F" : "#BAE6FD"}`,
        }}
      >
        <div className="flex items-center gap-2">
          <CreditCard size={16} style={{ color: store.primaryColor }} />
          <p className="text-[12px]" style={{ color: fg }}>
            You'll be redirected to Stripe's secure checkout to complete payment.
          </p>
        </div>
      </div>

      {renderShipTo()}
      {renderBillTo()}
    </div>
  );

  // ── Main checkout layout ──────────────────────────────────────────────
  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-8" style={{ color: fg }}>Checkout</h1>

      <BudgetBanner storeId={store.id} isDark={isDark} cartTotalCents={Math.round(cartTotal * 100)} />

      {/* ── Warning banners ───────────────────────────────────────────── */}
      {overLimit && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl mb-6"
          style={{
            backgroundColor: isDark ? "#2D1B1B" : "#FEF2F2",
            border: `1px solid ${isDark ? "#5C2020" : "#FECACA"}`,
          }}
        >
          <AlertTriangle size={18} className="text-[#DC2626] flex-shrink-0" />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "#DC2626" }}>
              Order exceeds spending limit
            </p>
            <p className="text-[11px]" style={{ color: mutedFg }}>
              Your limit is ${spendingLimit?.toFixed(2)} per order. Contact your manager for
              approval or reduce your cart.
            </p>
          </div>
        </div>
      )}

      {overBudget && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl mb-6"
          style={{
            backgroundColor: isDark ? "#2D1B1B" : "#FFF7ED",
            border: `1px solid ${isDark ? "#5C3A20" : "#FED7AA"}`,
          }}
        >
          <AlertTriangle size={18} className="text-[#EA580C] flex-shrink-0" />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "#EA580C" }}>
              Exceeds department budget
            </p>
            <p className="text-[11px]" style={{ color: mutedFg }}>
              Your department has ${((deptBudget!.department!.budgetCents - deptBudget!.department!.spentCents) / 100).toFixed(2)} remaining
              this period.
            </p>
          </div>
        </div>
      )}

      {overPerOrderCap && !overBudget && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl mb-6"
          style={{
            backgroundColor: isDark ? "#2D1B1B" : "#FEF2F2",
            border: `1px solid ${isDark ? "#5C2020" : "#FECACA"}`,
          }}
        >
          <AlertTriangle size={18} className="text-red-600 flex-shrink-0" />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "#DC2626" }}>
              Exceeds per-order limit
            </p>
            <p className="text-[11px]" style={{ color: mutedFg }}>
              Your department's per-order cap is ${(deptBudget!.department!.maxPerOrderCents! / 100).toFixed(2)}.
              Reduce your cart to proceed.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* ── Left column: Payment method + Form ─────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Payment method selector */}
          <div className="p-5 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
            <h3 className="text-[14px] font-bold mb-1" style={{ color: fg }}>Payment Method</h3>
            <p className="text-[11px] mb-4" style={{ color: mutedFg }}>
              Available based on your role: {userRole.charAt(0).toUpperCase()}{userRole.slice(1)}
            </p>
            <div className="space-y-2">
              {allowedMethods.map((method) => {
                const info = paymentLabels[method];
                const Icon = info.icon;
                const selected = paymentMethod === method;
                return (
                  <button
                    key={method}
                    onClick={() => { setPaymentMethod(method); setFormErrors({}); }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all"
                    style={{
                      backgroundColor: selected ? `${store.primaryColor}10` : "transparent",
                      border: `1.5px solid ${selected ? store.primaryColor : borderColor}`,
                    }}
                  >
                    <Icon size={16} style={{ color: selected ? store.primaryColor : mutedFg }} />
                    <div className="flex-1">
                      <span
                        className="text-[13px] font-semibold block"
                        style={{ color: selected ? store.primaryColor : fg }}
                      >
                        {info.label}
                      </span>
                      <span className="text-[11px]" style={{ color: mutedFg }}>
                        {info.description}
                      </span>
                    </div>
                    {selected && (
                      <Check size={14} className="flex-shrink-0" style={{ color: store.primaryColor }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment form — switches based on selected method */}
          <div
            className="p-5 rounded-xl transition-all"
            style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
          >
            <h3 className="text-[14px] font-bold mb-4" style={{ color: fg }}>
              {paymentMethod === "credit_card" ? "Payment Details" :
               paymentMethod === "po_number" ? "Purchase Order Details" :
               paymentMethod === "gl_code" ? "GL Code Details" :
               "Points Redemption"}
            </h3>
            {paymentMethod === "credit_card" && renderCCForm()}
            {paymentMethod === "po_number" && renderPOForm()}
            {paymentMethod === "gl_code" && renderGLForm()}
            {paymentMethod === "company_points" && renderPointsForm()}
          </div>

          {/* Promo Code */}
          <div
            className="p-5 rounded-xl transition-all"
            style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
          >
            {appliedPromo ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag size={14} style={{ color: "#16A34A" }} />
                  <span className="text-[13px] font-semibold" style={{ color: "#16A34A" }}>
                    {appliedPromo.code}
                  </span>
                  <span className="text-[11px]" style={{ color: mutedFg }}>
                    – {appliedPromo.description}
                  </span>
                </div>
                <button
                  onClick={handleRemovePromo}
                  className="p-1 rounded hover:bg-red-50 transition-colors"
                >
                  <X size={14} className="text-red-400" />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setPromoExpanded(!promoExpanded)}
                  className="flex items-center gap-2 text-[13px] font-semibold w-full"
                  style={{ color: store.primaryColor }}
                >
                  <Tag size={14} />
                  Have a promo code?
                  <ChevronDown
                    size={13}
                    className="ml-auto transition-transform"
                    style={{ transform: promoExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
                {promoExpanded && (
                  <div className="mt-3 flex gap-2">
                    <input
                      placeholder="Enter code"
                      value={promoInput}
                      onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleApplyPromo(); }}
                      className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none border uppercase tracking-wider font-mono"
                      style={{
                        backgroundColor: isDark ? "#1A1A1A" : "#FFFFFF",
                        borderColor: promoError ? "#F87171" : borderColor,
                        color: fg,
                      }}
                    />
                    <button
                      onClick={handleApplyPromo}
                      disabled={validatingPromo || !promoInput.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60 flex items-center gap-1.5"
                      style={{ backgroundColor: store.primaryColor }}
                    >
                      {validatingPromo ? <Loader2 size={13} className="animate-spin" /> : null}
                      Apply
                    </button>
                  </div>
                )}
                {promoError && (
                  <p className="text-[11px] text-red-400 mt-1.5">{promoError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right column: Order summary sidebar ────────────────────── */}
        <div className="lg:col-span-2">
          <div
            className="p-5 rounded-xl sticky top-[90px]"
            style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
          >
            <h3 className="text-[14px] font-bold mb-4" style={{ color: fg }}>Order Summary</h3>

            {/* User info badge */}
            {storeUser && (
              <div
                className="flex items-center gap-3 mb-4 pb-4"
                style={{ borderBottom: `1px solid ${borderColor}` }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
                  style={{ backgroundColor: store.primaryColor }}
                >
                  {(storeUser.name || "U").charAt(0)}
                </div>
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: fg }}>
                    {storeUser.name || "User"}
                  </p>
                  <p className="text-[10px]" style={{ color: mutedFg }}>
                    {userRole.charAt(0).toUpperCase()}{userRole.slice(1)}
                    {storeUser.department ? ` · ${storeUser.department}` : ""}
                  </p>
                </div>
              </div>
            )}

            {/* Department budget bar */}
            {deptBudget?.department && (
              <div className="mb-4 pb-4" style={{ borderBottom: `1px solid ${borderColor}` }}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span style={{ color: mutedFg }}>Dept Budget</span>
                  <span style={{ color: fg }}>
                    ${(deptBudget.department.spentCents / 100).toFixed(0)} / ${(deptBudget.department.budgetCents / 100).toFixed(0)}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: borderColor }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((deptBudget.department.spentCents / deptBudget.department.budgetCents) * 100, 100)}%`,
                      backgroundColor: overBudget ? "#DC2626" : store.primaryColor,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Cart items */}
            <div className="mb-4 pb-4" style={{ borderBottom: `1px solid ${borderColor}` }}>
              {cart.map((item) => (
                <div
                  key={item.lineKey}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="w-9 h-9 rounded-lg overflow-hidden bg-white flex-shrink-0">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                    ) : (
                      <Package size={14} className="m-auto text-[#D4D4D4]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate" style={{ color: fg }}>{item.name}</p>
                    {item.kind === "print" && item.variantLabel && (
                      <p className="text-[10px] truncate" style={{ color: mutedFg }}>{item.variantLabel}</p>
                    )}
                    <p className="text-[10px]" style={{ color: mutedFg }}>Qty: {item.quantity}</p>
                  </div>
                  <p className="text-[12px] font-semibold" style={{ color: fg }}>
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            {/* Line items */}
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-[13px]">
                <span style={{ color: mutedFg }}>Subtotal</span>
                <span style={{ color: fg }}>${cartTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span style={{ color: mutedFg }}>Shipping</span>
                <span className="text-[#16A34A] font-semibold">Free</span>
              </div>
              {appliedPromo && (
                <div className="flex justify-between text-[13px]">
                  <span className="flex items-center gap-1" style={{ color: "#16A34A" }}>
                    <Tag size={12} /> Discount ({appliedPromo.code})
                  </span>
                  <span className="font-semibold" style={{ color: "#16A34A" }}>
                    -${(appliedPromo.discountCents / 100).toFixed(2)}
                  </span>
                </div>
              )}
              {spendingLimit !== null && (
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: mutedFg }}>Spending Limit</span>
                  <span style={{ color: overLimit ? "#DC2626" : fg }}>
                    ${spendingLimit.toFixed(2)}
                  </span>
                </div>
              )}
              {paymentMethod === "company_points" && (
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: mutedFg }}>Points Balance</span>
                  <span style={{ color: notEnoughPoints ? "#DC2626" : fg }}>
                    {pointsBalance.toLocaleString()} pts
                  </span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between" style={{ borderColor }}>
                <span className="text-[14px] font-bold" style={{ color: fg }}>Total</span>
                <span
                  className="text-[18px] font-bold"
                  style={{ color: !canPlace ? "#DC2626" : fg }}
                >
                  ${(cartTotal - (appliedPromo ? appliedPromo.discountCents / 100 : 0)).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Place order button */}
            <button
              onClick={handlePlaceOrder}
              disabled={!canPlace}
              className="w-full py-3.5 rounded-lg text-[14px] font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: !canPlace ? "#9CA3AF" : store.primaryColor }}
            >
              {processing && <Loader2 size={16} className="animate-spin" />}
              {processing
                ? "Processing..."
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
            <p className="text-center text-[10px] mt-3" style={{ color: mutedFg }}>
              Secure checkout powered by MergeTasks
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
