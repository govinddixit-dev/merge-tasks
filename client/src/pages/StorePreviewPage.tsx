/**
 * StorePreviewPage — Pre-launch store preview.
 * Loads the store by ID (draft or active), renders the full store portal
 * inside an iframe-like wrapper, and shows a sticky top banner with
 * "Edit Store", "Send for Approval", and "Launch Store" actions.
 */
import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  Pencil, Rocket, ArrowLeft, Loader2, Check, AlertCircle,
  Send, Copy, CheckCircle2, X, Mail, Clock, PenLine,
  Palette, ChevronDown,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { toast } from "sonner";

// Re-use the live store components
import { StoreContext } from "./webstore/StoreContext";
import type { StoreData, CartItem, StoreProduct, StoreUserData, AddPrintToCartInput } from "./webstore/StoreContext";
import StoreHeader from "./webstore/StoreHeader";
import StoreFooter from "./webstore/StoreFooter";
import StoreHomePage from "./webstore/StoreHomePage";
import StoreProductsPage from "./webstore/StoreProductsPage";

// Deterministic demo colors for the brand switcher — module-level so they are
// never recreated on render.
const BRAND_SWITCHER_DEMO_COLORS = [
  "#6C2BD9", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#3B82F6",
] as const;

export default function StorePreviewPage() {
  const params = useParams<{ id: string }>();
  const storeId = parseInt(params.id || "0");
  const [, navigate] = useLocation();

  const [previewTab, setPreviewTab] = useState<"home" | "products">("home");
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  //  Send for Approval state 
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalEmail, setApprovalEmail] = useState("");
  const [approvalName, setApprovalName] = useState("");
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalLink, setApprovalLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // ── Phase 3 Option D: Brand Switcher demo mode ──────────────────────────────
  const [showBrandSwitcher, setShowBrandSwitcher] = useState(false);
  const [brandOverride, setBrandOverride] = useState<{
    primaryColor: string;
    logoUrl: string | null;
    label: string;
  } | null>(null);
  // Only fire the query when the switcher panel is open to avoid unnecessary requests.
  const { data: clientsData } = trpc.clients.list.useQuery(
    { limit: 20 },
    { enabled: showBrandSwitcher }
  );
  // ────────────────────────────────────────────────────────────────────────────

  const { data: store, isLoading, error } = trpc.stores.getById.useQuery(
    { id: storeId },
    { enabled: !!storeId }
  );

  const launchMut = trpc.stores.launch.useMutation();
  const sendForApprovalMut = trpc.stores.sendForApproval.useMutation();

  //  Cart state (read-only in preview) 
  const [cart] = useState<CartItem[]>([]);
  const addToCart = (_: StoreProduct) => toast("Preview mode — cart is disabled");
  const addPrintToCart = (_: AddPrintToCartInput) => toast("Preview mode — cart is disabled");
  const removeFromCart = (_: string) => {};
  const updateQty = (_: string, __: number) => {};
  const clearCart = () => {};

  const handleLaunch = async () => {
    if (!store) return;
    setLaunching(true);
    try {
      await launchMut.mutateAsync({ id: storeId });
      setLaunched(true);
      toast.success("Store is now live!");
      setTimeout(() => navigate(`/store-management/${storeId}`), 2000);
    } catch (err: unknown) {
      toast.error("Couldn't launch the store: " + (err instanceof Error ? err.message : "please try again"));
    } finally {
      setLaunching(false);
    }
  };

  const handleSendForApproval = async () => {
    if (!approvalEmail.trim()) { toast.error("Please enter the client's email address"); return; }
    setSendingApproval(true);
    try {
      const result = await sendForApprovalMut.mutateAsync({
        storeId,
        clientEmail: approvalEmail.trim(),
        clientName: approvalName.trim() || undefined,
        origin: window.location.origin,
      });
      setApprovalLink(result.approvalUrl);
      setApprovalSent(true);
      if (result.emailDelivered) {
        toast.success("Approval email sent to " + approvalEmail);
      } else {
        toast("Approval link generated — copy it below to share manually");
      }
    } catch (err: unknown) {
      toast.error("Couldn't send the approval: " + (err instanceof Error ? err.message : "please try again"));
    } finally {
      setSendingApproval(false);
    }
  };

  const copyApprovalLink = () => {
    if (!approvalLink) return;
    navigator.clipboard.writeText(approvalLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast.success("Link copied to clipboard");
    });
  };

  const closeApprovalModal = () => {
    setShowApprovalModal(false);
    // Reset if not sent yet; keep state if sent so user can copy link
    if (!approvalSent) {
      setApprovalEmail("");
      setApprovalName("");
    }
  };

  // ── Phase 3 Option D: Build storeData + apply brand override ───────────────────
  // Both useMemo calls are placed here — above all early returns — so that
  // hooks are always called unconditionally (Rules of Hooks).
  //
  // storeData: builds a StoreData-compatible object, preferring editor overrides.
  // The server's getById returns all editor* and approval* fields; we cast to
  // StoreData since StoreData is a subset of the full store row.
  const storeData = useMemo<StoreData>(() => {
    if (!store) return {} as StoreData; // guarded below before use
    return {
      ...(store as unknown as StoreData),
      welcomeMessage: store.editorWelcomeMessage || store.welcomeMessage,
      aiTagline: store.editorTagline || store.aiTagline,
      aiHeroHeadline: store.editorHeroHeadline || store.aiHeroHeadline,
      aiHeroSubtitle: store.editorHeroSubtitle || store.aiHeroSubtitle,
      primaryColor: store.primaryColor || "var(--mt-brand)",
      template: (store.template as StoreData["template"]) || "modern",
    };
  }, [store]);

  // effectiveStoreData: applies brandOverride on top of storeData.
  // When brandOverride is null this is a pure identity — no allocation overhead.
  const effectiveStoreData = useMemo<StoreData>(() => {
    if (!brandOverride) return storeData;
    return {
      ...storeData,
      primaryColor: brandOverride.primaryColor,
      client: storeData.client
        ? { ...storeData.client, logoUrl: brandOverride.logoUrl }
        : storeData.client,
    };
  }, [storeData, brandOverride]);
  // ───────────────────────────────────────────────────────────────────────────

  if (isLoading) return <MergeTasksLoader variant="page" />;

  if (error || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mt-surface">
        <div className="text-center max-w-md px-6">
          <AlertCircle size={40} className="text-[#EF4444] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-mt-ink mb-2">Store Not Found</h1>
          <p className="text-[13px] text-mt-ink-3 mb-6">This store doesn't exist or you don't have access.</p>
          <button onClick={() => navigate("/webstores")} className="px-5 py-2.5 bg-primary text-white rounded-lg text-[13px] font-semibold">
            Back to Stores
          </button>
        </div>
      </div>
    );
  }

  const isPendingApproval = store.status === "pending_approval";
  const isRevisionRequested = store.status === "revision_requested";
  const isApproved = !!store.approvalApprovedAt;

  return (
    <div className="min-h-screen bg-mt-surface-2 flex flex-col">

      {/*  Send for Approval Modal  */}
      {showApprovalModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeApprovalModal} />

          <div className="relative bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#EDE9FE] flex items-center justify-center">
                  <Send size={15} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-[#111827]">Send for Approval</h2>
                  <p className="text-[11px] text-[#9CA3AF]">Client reviews and approves before launch</p>
                </div>
              </div>
              <button onClick={closeApprovalModal} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#9CA3AF]">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {!approvalSent ? (
                <>
                  {/* Info banner */}
                  <div className="bg-mt-brand-light rounded-xl p-3 border border-[#DDD6FE] flex items-start gap-2.5">
                    <Clock size={14} className="text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-[12px] text-[#5B21B6] leading-relaxed">
                      The client will receive a branded email with a secure link to preview and approve the store. The store stays in draft until <strong>you</strong> launch it.
                    </p>
                  </div>

                  {/* Store name display */}
                  <div className="bg-[#F9FAFB] rounded-xl p-3 border border-[#E5E7EB]">
                    <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-0.5">Store</p>
                    <p className="text-[14px] font-bold text-[#111827]">{store.name}</p>
                  </div>

                  {/* Client email */}
                  <div>
                    <label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
                      Client email <span className="text-[#EF4444]">*</span>
                    </label>
                    <div className="flex items-center gap-2 px-3 py-2.5 border border-[#E5E7EB] rounded-xl focus-within:border-primary transition-colors bg-white">
                      <Mail size={14} className="text-[#9CA3AF] flex-shrink-0" />
                      <input
                        type="email"
                        value={approvalEmail}
                        onChange={e => setApprovalEmail(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSendForApproval()}
                        placeholder="client@company.com"
                        className="flex-1 text-[13px] bg-transparent outline-none text-[#111827] placeholder:text-[#D1D5DB]"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Client name (optional) */}
                  <div>
                    <label className="block text-[12px] font-semibold text-[#374151] mb-1.5">
                      Client name <span className="text-[#9CA3AF] font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={approvalName}
                      onChange={e => setApprovalName(e.target.value)}
                      placeholder="e.g. Jane Smith"
                      className="w-full px-3 py-2.5 border border-[#E5E7EB] rounded-xl text-[13px] text-[#111827] placeholder:text-[#D1D5DB] focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={closeApprovalModal}
                      className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendForApproval}
                      disabled={sendingApproval || !approvalEmail.trim()}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold hover:bg-[#5438d4] transition-colors disabled:opacity-60"
                    >
                      {sendingApproval ? (
                        <><Loader2 size={14} className="animate-spin" /> Sending…</>
                      ) : (
                        <><Send size={14} /> Send Approval Email</>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                /*  Sent success state  */
                <div className="space-y-4">
                  <div className="flex flex-col items-center text-center py-2">
                    <div className="w-14 h-14 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-3">
                      <CheckCircle2 size={28} className="text-[#16A34A]" />
                    </div>
                    <h3 className="text-[16px] font-bold text-[#111827] mb-1">Approval request sent!</h3>
                    <p className="text-[13px] text-[#6B7280]">
                      An email was sent to <strong>{approvalEmail}</strong>. The store will stay in draft until you launch it after approval.
                    </p>
                  </div>

                  {/* Copy link */}
                  {approvalLink && (
                    <div className="bg-[#F9FAFB] rounded-xl p-3 border border-[#E5E7EB]">
                      <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">Approval link</p>
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-[11px] text-[#374151] font-mono truncate">{approvalLink}</p>
                        <button
                          onClick={copyApprovalLink}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[11px] font-semibold text-[#374151] hover:bg-[#F3F4F6] transition-colors flex-shrink-0"
                        >
                          {linkCopied ? <><Check size={11} className="text-[#16A34A]" /> Copied</> : <><Copy size={11} /> Copy</>}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={closeApprovalModal}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold hover:bg-[#5438d4] transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/*  Preview Banner  */}
      <div className="sticky top-0 z-[60] bg-[#1A1A1A] text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Back */}
          <button
            onClick={() => navigate("/webstores")}
            className="flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white transition-colors flex-shrink-0"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back to Stores</span>
          </button>

          <div className="h-4 w-px bg-white/20" />

          {/* Status badge */}
          <div className="flex items-center gap-2 flex-shrink-0">
          {isApproved ? (
            <>
              <div className="w-2 h-2 rounded-full bg-[#16A34A]" />
              <span className="text-[12px] font-semibold text-[#4ADE80]">Approved ✓</span>
            </>
          ) : isRevisionRequested ? (
            <>
              <div className="w-2 h-2 rounded-full bg-[#F97316] animate-pulse" />
              <span className="text-[12px] font-semibold text-[#F97316]">Changes Requested</span>
            </>
          ) : isPendingApproval ? (
            <>
              <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="text-[12px] font-semibold text-[#F59E0B]">Awaiting Approval</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="text-[12px] font-semibold text-[#F59E0B]">Preview Mode</span>
              <span className="text-[11px] text-white/50 hidden sm:inline">— not live yet</span>
            </>
          )}
          </div>

          {/* Store name */}
          <div className="hidden md:block text-[13px] font-semibold text-white ml-1 truncate max-w-[160px]">
            {store.name}
          </div>

          {/* Preview tabs */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setPreviewTab("home")}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${previewTab === "home" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"}`}
            >
              Home
            </button>
            <button
              onClick={() => setPreviewTab("products")}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${previewTab === "products" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"}`}
            >
              Products
            </button>
          </div>

          <div className="h-4 w-px bg-white/20" />

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Edit */}
            <button
              onClick={() => navigate(`/store-editor/${storeId}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-[12px] font-semibold transition-colors border border-white/20"
            >
              <Pencil size={13} />
              <span className="hidden sm:inline">Edit</span>
            </button>

            {/* Send for Approval */}
            {!launched && (
              <button
                onClick={() => setShowApprovalModal(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors border ${
                  isRevisionRequested
                    ? "bg-[#F97316]/20 border-[#F97316]/40 text-[#F97316]"
                    : isPendingApproval && !isApproved
                    ? "bg-[#F59E0B]/20 border-[#F59E0B]/40 text-[#F59E0B]"
                    : isApproved
                    ? "bg-[#16A34A]/20 border-[#16A34A]/40 text-[#4ADE80]"
                    : "bg-white/10 hover:bg-white/20 text-white border-white/20"
                }`}
                title={isApproved ? "Client approved — ready to launch" : isRevisionRequested ? "Client requested changes — resend after editing" : isPendingApproval ? "Awaiting client approval" : "Send to client for approval"}
              >
                {isApproved ? <CheckCircle2 size={13} /> : isRevisionRequested ? <PenLine size={13} /> : <Send size={13} />}
                <span className="hidden sm:inline">
                  {isApproved ? "Approved" : isRevisionRequested ? "Changes Requested" : isPendingApproval ? "Pending…" : "Send for Approval"}
                </span>
              </button>
            )}

            {/* Launch */}
            {launched ? (
              <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[#16A34A] text-white rounded-lg text-[12px] font-semibold">
                <Check size={13} />
                Launched!
              </div>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-[#5438d4] text-white rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-70"
                title={isApproved ? "Client approved — launch now!" : "Launch store (skip approval)"}
              >
                {launching ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                {launching ? "Launching…" : "Launch Store"}
              </button>
            )}
          </div>
        </div>

        {/* Approved banner strip */}
        {isApproved && !launched && (
          <div className="bg-[#16A34A] px-4 py-1.5 text-center">
            <p className="text-[12px] text-white font-semibold">
              ✓ Client approved this store
              {store.approvalApprovedAt && ` on ${new Date(store.approvalApprovedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              {store.approvalNotes && ` — "${store.approvalNotes}"`}
              {" · "}
              <button onClick={handleLaunch} className="underline hover:no-underline">Launch now</button>
            </p>
          </div>
        )}

        {/* Revision requested banner strip */}
        {isRevisionRequested && !launched && (
          <div className="bg-[#F97316] px-4 py-1.5 text-center">
            <p className="text-[12px] text-white font-semibold">
              ✏ {store.approvalClientName || store.approvalClientEmail || "Client"} requested changes
              {store.approvalNotes && ` — "${store.approvalNotes.slice(0, 80)}${store.approvalNotes.length > 80 ? "…" : ""}"`}
              {" · "}
              <button onClick={() => setShowApprovalModal(true)} className="underline hover:no-underline">Resend after editing</button>
            </p>
          </div>
        )}

        {/* Pending approval strip */}
        {isPendingApproval && !isApproved && !launched && (
          <div className="bg-[#F59E0B] px-4 py-1.5 text-center">
            <p className="text-[12px] text-mt-ink font-semibold">
              Approval email sent to {store.approvalClientEmail || "client"} — waiting for their response
              {" · "}
              <button onClick={() => setShowApprovalModal(true)} className="underline hover:no-underline">Resend</button>
            </p>
          </div>
        )}
      </div>

      {/*  Store Preview  */}
      <div className="flex-1 relative">
        <StoreContext.Provider value={{
          store: effectiveStoreData,
          cart,
          addToCart,
          addPrintToCart,
          removeFromCart,
          updateQty,
          clearCart,
          cartTotal: 0,
          cartCount: 0,
          isDark: false,
          toggleTheme: () => {},
          isLoggedIn: true,
          storeUser: null,
          loginUser: (_: StoreUserData) => {},
          logoutUser: () => {},
          activeLocationId: null,
          setActiveLocationId: () => {},
        }}>
          <div className="min-h-screen bg-white">
            <StoreHeader />
            <main className="pt-[72px]">
              {previewTab === "home" && <StoreHomePage />}
              {previewTab === "products" && <StoreProductsPage />}
            </main>
            <StoreFooter />
          </div>
        </StoreContext.Provider>

        {/* ── Phase 3 Option D: Brand Switcher floating pill ───────────────────── */}
        {/* Fixed bottom-right, z-50 so it sits above store content but below the
            approval modal (z-[100]) and the preview banner (z-[60]).
            On mobile it sits above the bottom action bar (sticky, not fixed). */}
        <div className="fixed bottom-20 right-4 sm:bottom-6 z-50">
          {/* Expanded panel */}
          {showBrandSwitcher && (
            <div className="mb-2 w-64 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] overflow-hidden">
              {/* Panel header */}
              <div className="px-4 py-3 border-b border-[#F3F4F6] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette size={14} className="text-primary" />
                  <span className="text-[12px] font-bold text-[#111827]">Brand Demo</span>
                </div>
                <button
                  onClick={() => setShowBrandSwitcher(false)}
                  className="p-1 rounded-md hover:bg-[#F3F4F6] text-[#9CA3AF] transition-colors"
                  aria-label="Close brand switcher"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Client list */}
              <div className="max-h-72 overflow-y-auto py-1">
                {/* Reset / current store option */}
                <button
                  onClick={() => setBrandOverride(null)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F9FAFB] ${!brandOverride ? "bg-[#F5F3FF]" : ""}`}
                >
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-white shadow-sm ring-1 ring-[#E5E7EB]"
                    style={{ backgroundColor: storeData.primaryColor || "#6C2BD9" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#111827] truncate">
                      {storeData.client
                        ? (storeData.client as { companyName?: string }).companyName || "Current Store"
                        : "Current Store"}
                    </p>
                    <p className="text-[10px] text-[#9CA3AF]">Original brand</p>
                  </div>
                  {!brandOverride && (
                    <Check size={13} className="text-primary flex-shrink-0" />
                  )}
                </button>

                {/* Divider */}
                <div className="mx-4 my-1 border-t border-[#F3F4F6]" />

                {/* Loading state */}
                {!clientsData && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={16} className="animate-spin text-[#9CA3AF]" />
                  </div>
                )}

                {/* Client rows */}
                {clientsData?.items.map((client) => {
                  // GAP 4 FIX: Use the real primaryColor from the client's most recent store.
                  // clients.list returns stores[] for each client (full store rows incl. primaryColor).
                  // Fall back to deterministic demo color only if the client has no stores yet.
                  const label = client.companyName || `Client ${client.id}`;
                  const clientStores = (client as { stores?: { primaryColor?: string | null }[] }).stores;
                  const realColor = clientStores?.[0]?.primaryColor || null;
                  const hash = label.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
                  const color = realColor || BRAND_SWITCHER_DEMO_COLORS[hash % BRAND_SWITCHER_DEMO_COLORS.length];
                  const isActive = brandOverride?.label === label;
                  return (
                    <button
                      key={client.id}
                      onClick={() => setBrandOverride({ primaryColor: color, logoUrl: null, label })}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F9FAFB] ${isActive ? "bg-[#F5F3FF]" : ""}`}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-white shadow-sm ring-1 ring-[#E5E7EB]"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 text-[12px] font-medium text-[#374151] truncate">{label}</span>
                      {isActive && <Check size={13} className="text-primary flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Footer note */}
              <div className="px-4 py-2.5 bg-[#F9FAFB] border-t border-[#F3F4F6]">
                <p className="text-[10px] text-[#9CA3AF] leading-relaxed">
                  Demo only — overrides are not saved.
                </p>
              </div>
            </div>
          )}

          {/* Pill trigger button */}
          <button
            onClick={() => setShowBrandSwitcher(v => !v)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full shadow-lg border transition-all text-[12px] font-semibold ${
              brandOverride
                ? "bg-white border-[#E5E7EB] text-[#111827]"
                : "bg-[#1A1A1A] border-transparent text-white hover:bg-[#2D2D2D]"
            }`}
            title="Brand Switcher — demo mode"
          >
            {/* Active brand color dot */}
            <div
              className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-white/30"
              style={{ backgroundColor: effectiveStoreData.primaryColor || "#6C2BD9" }}
            />
            <span>{brandOverride ? brandOverride.label : "Brand"}</span>
            <ChevronDown
              size={12}
              className={`transition-transform ${showBrandSwitcher ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {/* ─────────────────────────────────────────────────────────────────────────── */}
      </div>

      {/*  Bottom action bar (mobile)  */}
      <div className="sm:hidden sticky bottom-0 bg-[#1A1A1A] border-t border-white/10 px-4 py-3 flex gap-2">
        <button
          onClick={() => navigate(`/store-editor/${storeId}`)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/10 text-white rounded-lg text-[13px] font-semibold"
        >
          <Pencil size={14} /> Edit
        </button>
        <button
          onClick={() => setShowApprovalModal(true)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/10 text-white rounded-lg text-[13px] font-semibold"
        >
          <Send size={14} /> Approval
        </button>
        <button
          onClick={handleLaunch}
          disabled={launching || launched}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-70"
        >
          {launching ? <Loader2 size={14} className="animate-spin" /> : launched ? <Check size={14} /> : <Rocket size={14} />}
          {launching ? "…" : launched ? "Live!" : "Launch"}
        </button>
      </div>
    </div>
  );
}
