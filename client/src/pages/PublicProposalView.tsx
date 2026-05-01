/**
 * PublicProposalView.tsx — Thin shell for the public proposal view.
 *
 * All visual sections are extracted into the `public-proposal/` feature
 * folder. This file owns:
 *   - Route params + URL parsing
 *   - Core data fetching (proposal, departments)
 *   - Shared state (order items, edit mode, fulfillment)
 *   - Handler wiring between sub-components
 *
 * Sub-components:
 *   ProposalHeader       — logo, banners, client info, summary card
 *   ProductDetail        — single product image carousel + selectors
 *   ProductCarousel      — horizontal product thumbnail strip
 *   OrderDrawer/Inline   — bottom drawer + inline order list
 *   DepartmentApprovals  — dept list, progress bar, add form
 *   EditModeControls     — edit/save/cancel buttons
 *   EditModeBanner       — qty editor + notes
 *   AfterEditPanel       — re-approval + override options
 *   StripeCheckout       — product selection + pay CTA
 *   FulfillmentSection   — approved banner + dialog
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useSearch } from "wouter";
import { ArrowUp, Loader2, AlertTriangle, Linkedin, FileText } from "lucide-react";
import { toast } from "sonner";
import { getLogger } from "@/lib/logger";

import {
  type ProposalData, type ProposalProduct, type OrderItem, type DeptStatus,
  getExpirationInfo,
  ProposalHeader,
  ProductDetail,
  ProductCarousel,
  OrderDrawer, InlineOrderSummary, FloatingOrderButton,
  DepartmentApprovals,
  EditModeControls, EditModeBanner, AfterEditPanel,
  StripeCheckout,
  FulfillmentSection,
} from "./public-proposal";

const log = getLogger("PublicProposalView");

// ── Component ─────────────────────────────────────────────────────────

export default function PublicProposalView() {
  const params = useParams<{ token: string }>();
  const searchString = useSearch();

  // ── Core state ────────────────────────────────────────────────────
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<"success" | "canceled" | null>(null);

  // Product navigation
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Order list
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const orderSummaryRef = useRef<HTMLDivElement>(null);

  // Stripe checkout selection
  const [selectedForCheckout, setSelectedForCheckout] = useState<Set<number>>(new Set());

  // Departments
  const [departments, setDepartments] = useState<DeptStatus[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editedQuantities, setEditedQuantities] = useState<Record<number, number>>({});
  const [removedProducts, setRemovedProducts] = useState<Set<number>>(new Set());
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [showAfterEditPanel, setShowAfterEditPanel] = useState(false);

  // Fulfillment
  const [fulfillmentRequested, setFulfillmentRequested] = useState(false);

  // ── URL parsing ───────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams(searchString);
    const cs = sp.get("checkout");
    if (cs === "success") setCheckoutStatus("success");
    else if (cs === "canceled") setCheckoutStatus("canceled");
  }, [searchString]);

  // ── Fetch proposal ────────────────────────────────────────────────
  useEffect(() => {
    async function fetchProposal() {
      try {
        const res = await fetch(`/api/proposals/public/${params.token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Proposal not found");
        }
        const data: ProposalData = await res.json();
        setProposal(data);
        if (data.orderItems?.length > 0) {
          const enriched = data.orderItems.map(oi => {
            const prod = data.products.find(p => p.productId === oi.productId);
            return { ...oi, productName: prod?.name || "Product", productImage: prod?.imageUrl ?? null };
          });
          setOrderItems(enriched as OrderItem[]);
        }
        setSelectedForCheckout(new Set(data.products.map(p => p.productId)));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load proposal");
      } finally { setLoading(false); }
    }
    if (params.token) fetchProposal();
  }, [params.token]);

  // ── Fetch departments ─────────────────────────────────────────────
  const fetchDepartments = useCallback(async () => {
    if (!params.token) return;
    setDeptLoading(true);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/departments`);
      if (res.ok) { const data = await res.json(); setDepartments(data.departments || []); }
    } catch {} finally { setDeptLoading(false); }
  }, [params.token]);

  useEffect(() => { if (proposal?.multiDepartment) fetchDepartments(); }, [proposal?.multiDepartment, fetchDepartments]);
  useEffect(() => { if (proposal?.fulfillmentRequestedAt) setFulfillmentRequested(true); }, [proposal?.fulfillmentRequestedAt]);

  // ── Derived values ────────────────────────────────────────────────
  const selectedProduct = proposal?.products[selectedIndex] || null;

  const subtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => sum + parseFloat(item.unitPrice || "0") * item.quantity, 0);
  }, [orderItems]);

  const approvedCount = departments.filter(d => d.status === "approved").length;
  const allApproved = departments.length > 0 && approvedCount === departments.length;
  const approvedProofs = proposal ? proposal.products.filter(p => p.proofStatus === "approved").length : 0;

  // ── Product selection ─────────────────────────────────────────────
  const selectProduct = useCallback((index: number) => {
    if (!proposal) return;
    setSelectedIndex(index);
  }, [proposal]);

  // ── Order item handlers ───────────────────────────────────────────
  const addToList = useCallback(async (item: Omit<OrderItem, "id">) => {
    if (!params.token) return;
    const tempId = Date.now();
    setOrderItems(prev => [...prev, { ...item, id: tempId }]);
    toast.success(`${item.productName} added to order list`);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/order-items`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
      if (res.ok) {
        const created = await res.json();
        setOrderItems(prev => prev.map(i => i.id === tempId ? { ...item, id: created.id } : i));
      }
    } catch (e) { log.error("Failed to save order item:", e); }
  }, [params.token]);

  const quickAdd = useCallback(async (p: ProposalProduct) => {
    const newItem: Omit<OrderItem, "id"> = {
      proposalProductId: p.id, productId: p.productId,
      color: p.colors[0] || null, size: p.sizes[0] || null,
      logoPosition: null, quantity: 1, unitPrice: p.unitPrice || "0",
      comment: null, productName: p.name, productImage: p.imageUrl,
    };
    await addToList(newItem);
  }, [addToList]);

  const addAllToList = useCallback(async () => {
    if (!proposal || !params.token) return;
    const items = proposal.products.map(p => ({
      proposalProductId: p.id, productId: p.productId,
      color: p.colors[0] || null, size: p.sizes[0] || null,
      quantity: 1, unitPrice: p.unitPrice || "0", comment: null,
      productName: p.name, productImage: p.imageUrl,
    }));
    const tempItems = items.map((item, idx) => ({ ...item, id: Date.now() + idx }));
    setOrderItems(tempItems as OrderItem[]);
    toast.success(`All ${proposal.products.length} products added to order list`);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/order-items/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const serverItems = await res.json();
        const enriched = serverItems.map((oi: Record<string, unknown>) => {
          const prod = proposal.products.find(p => p.productId === oi.productId);
          return { ...oi, productName: prod?.name || "Product", productImage: prod?.imageUrl || null };
        });
        setOrderItems(enriched);
      }
    } catch (e) { log.error("Failed to bulk add:", e); }
  }, [proposal, params.token]);

  const removeOrderItem = useCallback(async (itemId: number | undefined, index: number) => {
    setOrderItems(prev => prev.filter((_, i) => i !== index));
    if (itemId && params.token) {
      try { await fetch(`/api/proposals/public/${params.token}/order-items/${itemId}`, { method: "DELETE" }); } catch {}
    }
  }, [params.token]);

  const clearOrderItems = useCallback(async () => {
    setOrderItems([]);
    if (params.token) {
      try { await fetch(`/api/proposals/public/${params.token}/order-items`, { method: "DELETE" }); } catch {}
    }
  }, [params.token]);

  const handleSubmitOrder = useCallback(async () => {
    if (!params.token || orderItems.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/submit-order`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit order");
      if (data.requiresCheckout && proposal?.stripeCheckout) {
        const checkoutRes = await fetch(`/api/proposals/public/${params.token}/checkout`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin: window.location.origin, selectedProductIds: orderItems.map(i => i.productId) }),
        });
        const checkoutData = await checkoutRes.json();
        if (checkoutData.url) { window.location.href = checkoutData.url; return; }
      }
      toast.success("Order submitted");
      setOrderItems([]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Couldn't submit the order"); }
    finally { setSubmitting(false); }
  }, [params.token, orderItems, proposal?.stripeCheckout]);

  // ── Edit mode handlers ────────────────────────────────────────────
  const enterEditMode = useCallback(() => {
    if (!proposal) return;
    const qtyMap: Record<number, number> = {};
    proposal.products.forEach(p => { qtyMap[p.id] = p.quantity; });
    setEditedQuantities(qtyMap);
    setRemovedProducts(new Set());
    setEditNotes("");
    setEditMode(true);
    setEditSuccess(false);
  }, [proposal]);

  const cancelEditMode = useCallback(() => {
    setEditMode(false);
    setEditedQuantities({});
    setRemovedProducts(new Set());
    setEditNotes("");
  }, []);

  const handleSaveEdits = useCallback(async () => {
    if (!proposal || !params.token) return;
    const edits: Array<{ proposalProductId: number; quantity?: number; removed?: boolean }> = [];
    for (const product of proposal.products) {
      if (removedProducts.has(product.id)) edits.push({ proposalProductId: product.id, removed: true });
      else if (editedQuantities[product.id] !== undefined && editedQuantities[product.id] !== product.quantity)
        edits.push({ proposalProductId: product.id, quantity: editedQuantities[product.id] });
    }
    if (edits.length === 0) { cancelEditMode(); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/edit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits, editNotes: editNotes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save edits");
      const refreshRes = await fetch(`/api/proposals/public/${params.token}`);
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setProposal(refreshed);
        setSelectedForCheckout(new Set(refreshed.products.map((p: ProposalProduct) => p.productId)));
      }
      setEditMode(false);
      setEditSuccess(true);
      setShowAfterEditPanel(true);
      toast.success("Changes saved");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed to save edits"); }
    finally { setSaving(false); }
  }, [proposal, params.token, removedProducts, editedQuantities, editNotes, cancelEditMode]);

  // ── Stripe checkout ───────────────────────────────────────────────
  const toggleProductCheckout = useCallback((productId: number) => {
    setSelectedForCheckout(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }, []);

  const handleCheckout = useCallback(async () => {
    if (!params.token || selectedForCheckout.size === 0) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch(`/api/proposals/public/${params.token}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin, selectedProductIds: Array.from(selectedForCheckout) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkout session");
      if (data.url) window.location.href = data.url;
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed to start checkout"); }
    finally { setCheckoutLoading(false); }
  }, [params.token, selectedForCheckout]);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // ── Loading / Error states ────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-mt-surface flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[14px] text-mt-ink-3 font-medium">Loading proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-mt-surface flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-10 text-center max-w-md w-full border border-mt-border">
          <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-[#FEF2F2] flex items-center justify-center">
            <AlertTriangle size={32} className="text-[#DC2626]" />
          </div>
          <h1 className="text-[20px] font-bold text-mt-ink mb-2">Proposal Not Found</h1>
          <p className="text-[14px] text-mt-ink-3">{error || "This proposal link may have expired or is invalid."}</p>
        </div>
      </div>
    );
  }

  // ── Derived branding ──────────────────────────────────────────────
  const primaryColor = proposal.branding.primaryColor || "var(--mt-brand)";
  const brandName = proposal.branding.companyName || "MergeTasks";
  const brandLogo = proposal.branding.logoUrl;
  const expiration = getExpirationInfo(proposal.validDays, proposal.sentAt);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-mt-surface relative">
      {/* Toaster is mounted globally in App.tsx — no need for a second one here. */}

      {/* Bottom drawer */}
      <OrderDrawer
        orderItems={orderItems}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        subtotal={subtotal}
        primaryColor={primaryColor}
        submitting={submitting}
        onRemoveItem={removeOrderItem}
        onClear={clearOrderItems}
        onSubmit={handleSubmitOrder}
      />

      {/* Main content */}
      <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-8">

        <ProposalHeader
          proposal={proposal}
          primaryColor={primaryColor}
          brandName={brandName}
          brandLogo={brandLogo}
          checkoutStatus={checkoutStatus}
          setCheckoutStatus={setCheckoutStatus}
          editSuccess={editSuccess}
          setEditSuccess={setEditSuccess}
          approvedProofs={approvedProofs}
        />

        {/* Edit / Add all controls */}
        <EditModeControls
          editMode={editMode}
          expired={expiration.expired}
          saving={saving}
          onEnter={enterEditMode}
          onSave={handleSaveEdits}
          onCancel={cancelEditMode}
          onAddAll={addAllToList}
          primaryColor={primaryColor}
        />

        {/* Edit mode banner + product editor */}
        <EditModeBanner
          editMode={editMode}
          products={proposal.products}
          editNotes={editNotes}
          setEditNotes={setEditNotes}
          editedQuantities={editedQuantities}
          setEditedQuantities={setEditedQuantities}
          removedProducts={removedProducts}
          setRemovedProducts={setRemovedProducts}
        />

        {/* Product detail */}
        {selectedProduct && (
          <ProductDetail
            product={selectedProduct}
            selectedIndex={selectedIndex}
            totalProducts={proposal.products.length}
            primaryColor={primaryColor}
            expired={expiration.expired}
            onSelectProduct={selectProduct}
            onAddToList={addToList}
          />
        )}

        {/* All products carousel */}
        <ProductCarousel
          products={proposal.products}
          selectedIndex={selectedIndex}
          primaryColor={primaryColor}
          expired={expiration.expired}
          orderItems={orderItems}
          onSelectProduct={selectProduct}
          onQuickAdd={quickAdd}
        />

        {/* Inline order summary */}
        <InlineOrderSummary
          orderItems={orderItems}
          subtotal={subtotal}
          summaryRef={orderSummaryRef}
        />

        {/* Department approvals */}
        {proposal.multiDepartment && (
          <DepartmentApprovals
            departments={departments}
            deptLoading={deptLoading}
            primaryColor={primaryColor}
            approvalRouting={proposal.approvalRouting}
            token={params.token!}
            onDepartmentsUpdated={setDepartments}
          />
        )}

        {/* After-edit panel */}
        <AfterEditPanel
          show={showAfterEditPanel}
          multiDepartment={proposal.multiDepartment}
          departments={departments}
          primaryColor={primaryColor}
          token={params.token!}
          onReapprovalSent={() => setShowAfterEditPanel(false)}
          onOverrideSent={() => { setFulfillmentRequested(true); setShowAfterEditPanel(false); }}
          fetchDepartments={fetchDepartments}
        />

        {/* Fulfillment section */}
        <FulfillmentSection
          allApproved={allApproved}
          deptCount={departments.length}
          multiDepartment={proposal.multiDepartment}
          fulfillmentRequested={fulfillmentRequested}
          setFulfillmentRequested={setFulfillmentRequested}
          token={params.token!}
        />

        {/* Stripe checkout */}
        {proposal.stripeCheckout && !expiration.expired && proposal.products.length > 0 && (
          <StripeCheckout
            products={proposal.products}
            selectedForCheckout={selectedForCheckout}
            toggleProductCheckout={toggleProductCheckout}
            primaryColor={primaryColor}
            checkoutLoading={checkoutLoading}
            onCheckout={handleCheckout}
          />
        )}

        {/* Notes section */}
        {proposal.notes && (
          <div className="bg-white rounded-lg border border-mt-border p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={15} className="text-mt-ink-2" />
              <h3 className="text-[14px] font-bold text-mt-ink">Notes</h3>
            </div>
            <p className="text-[12px] text-mt-ink-2 leading-relaxed whitespace-pre-wrap">{proposal.notes}</p>
          </div>
        )}

        {/* Ready to place order CTA */}
        <div className="bg-[#F0F0F0] py-12 -mx-6 px-6 mb-8">
          <div className="text-center">
            <h2 className="text-[28px] sm:text-[36px] font-bold text-mt-ink leading-tight">
              Ready to <span className="font-black">PLACE<br />ORDER?</span>
            </h2>
            <button
              className="mt-5 px-8 py-3 border-2 border-[#1A1A1A] text-[13px] font-bold text-mt-ink rounded-full hover:bg-[#1A1A1A] hover:text-white transition-all inline-flex items-center gap-2 disabled:opacity-50 active:scale-[0.97]"
              onClick={handleSubmitOrder}
              disabled={submitting || orderItems.length === 0}
            >
              {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting...</> : <>Submit &rarr;</>}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pb-8">
          <div className="w-16 h-px bg-mt-border-2 mx-auto mb-5" />
          <a href="#" className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-mt-border-2 text-mt-ink-4 hover:text-mt-ink-2 hover:border-[#A3A3A3] transition-colors mb-4">
            <Linkedin size={14} />
          </a>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[12px] text-mt-ink-4 hover:text-mt-ink-2 transition-colors">Terms & Conditions</a>
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[12px] text-mt-ink-4 hover:text-mt-ink-2 transition-colors">Privacy Policy</a>
          </div>
          <p className="text-[10px] text-[#D4D4D4] mt-3">Prepared by {brandName} &middot; Confidential</p>
        </div>
      </div>

      {/* Floating order button */}
      <FloatingOrderButton
        orderItems={orderItems}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
        subtotal={subtotal}
        primaryColor={primaryColor}
      />

      {/* Scroll to top button */}
      <button
        className="fixed bottom-5 right-5 z-20 w-10 h-10 rounded-full bg-white border border-mt-border shadow-md flex items-center justify-center hover:shadow-lg transition-all active:scale-95"
        onClick={scrollToTop}
      >
        <ArrowUp size={16} className="text-mt-ink-3" />
      </button>
    </div>
  );
}
