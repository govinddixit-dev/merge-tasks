/**
 * CreateInvoice — Document Canvas (split-view) invoice builder.
 *
 * Layout (edit mode)
 * ──────────────────
 *   ┌───────────────────────────────────────────┬──────────────────────────┐
 *   │   LEFT: Live Canvas (lg:col-span-8, 65%)  │   RIGHT: Settings (35%)  │
 *   │   · Client header                         │   · Payment terms        │
 *   │   · Invoice meta                          │   · Send options         │
 *   │   · Line item grid (inline editing)       │   · Reminders            │
 *   │   · Totals block (real time)              │   · Shipping             │
 *   └───────────────────────────────────────────┴──────────────────────────┘
 *
 * Below lg breakpoint the sidebar becomes a bottom sheet (fixed, slides up).
 *
 * Preview mode
 * ────────────
 * Header flips to "Client View", the sidebar slides out to the right, and
 * the canvas is replaced by the shared <InvoicePreviewDocument>. A single
 * "Exit Preview" button returns to edit mode. Read-only — no edits fire.
 *
 * Drafts + autosave
 * ─────────────────
 *   - Save Draft button         → trpc.estimatesInvoices.invoices.saveDraft
 *   - 60 s autosave after dirty → same mutation, silent (no toast)
 *   - Inline "Saved ✓" flash    → text-sm text-gray-400, 2 s, no toast
 *   - Unsaved-change guard      → ConfirmDialog on Back/Cancel
 *   - /invoices/new?draft=:id   → pre-loads the existing draft in place
 *
 * Send
 * ────
 * trpc.estimatesInvoices.invoices.send persists the draft (if new or
 * dirty) and then flips it → "sent", mints a publicToken, and optionally
 * creates a Stripe Checkout Session. The server re-runs the same
 * `computeTotals` helper as the UI, so stored totals match what the
 * distributor saw on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Search, Plus, X, Percent, DollarSign, Loader2,
  Mail, CreditCard, Info, Calendar, Truck, Bell, Check, Eye, Send as SendIcon,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InvoicePreviewDocument } from "@/components/invoice/InvoicePreviewDocument";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  computeTotals,
  resolveDueDate,
  PAYMENT_TERMS_LABELS,
  type DiscountType,
  type PaymentTerms,
} from "../../../shared/invoiceMath";

const CANVAS_BG = "#F9FAFB";
const CUBIC = [0.4, 0, 0.2, 1] as const;

// Each bezier array is a 4-number tuple so Framer's `Easing` type accepts it.
const LINE_ENTER = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6 },
  transition: { duration: 0.15, ease: CUBIC },
} as const;

const SECTION_EXPAND = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.15, ease: CUBIC },
} as const;

// Preview-mode slide timing — 250 ms, material-standard decelerated easing
// (matches the rest of the app's motion language). Keeping the same CUBIC
// keeps the transition feeling native to the builder, not pasted-on.
const PREVIEW_SLIDE_MS = 0.25;
const AUTOSAVE_INTERVAL_MS = 60_000;
const SAVED_FLASH_MS = 2_000;

interface DraftLine {
  uid: string;
  productId: number | null;
  sku: string;
  productName: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  taxable: boolean;
  imageUrl: string | null;
}

interface CatalogProduct {
  id: number;
  name: string;
  sku: string | null;
  basePrice: string | null;
  imageUrl: string | null;
}

/**
 * Narrow the raw typed query (all product columns) to the fields the
 * catalog dropdown actually cares about — SKU, name, base price, image —
 * and a case-insensitive filter that matches either SKU or name prefix or
 * substring. Kept small and pure so it can be reused by both the SKU cell
 * and the description cell without a second query.
 */
function filterCatalog(items: CatalogProduct[], query: string, limit = 8): CatalogProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: CatalogProduct[] = [];
  for (const p of items) {
    const skuMatch = p.sku ? p.sku.toLowerCase().includes(q) : false;
    const nameMatch = p.name.toLowerCase().includes(q);
    if (skuMatch || nameMatch) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

function makeLine(defaults: Partial<DraftLine> = {}, taxableDefault = true): DraftLine {
  return {
    uid: `line-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`,
    productId: null,
    sku: "",
    productName: "",
    description: "",
    quantity: 1,
    unitPrice: 0,
    discountType: "percent",
    discountValue: 0,
    taxable: taxableDefault,
    imageUrl: null,
    ...defaults,
  };
}

const fmtCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CreateInvoice() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const utils = trpc.useUtils();

  // ── Draft bootstrap — the URL is the source of truth for "which draft
  //    are we editing?". /invoices/new            → fresh builder (no id)
  //                      /invoices/new?draft=42   → edit draft #42 in place
  //    `draftId` gets set once after the first saveDraft on a fresh form so
  //    subsequent autosaves UPDATE the same row instead of creating more.
  const initialDraftId = useMemo(() => {
    const p = new URLSearchParams(searchString);
    const raw = p.get("draft");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchString]);
  const [draftId, setDraftId] = useState<number | null>(initialDraftId);

  // ── Catalog — one pull, one in-memory filter per keystroke. This is the
  //    pattern already used by CreateProposal, ProposalEditor,
  //    VirtualProofing, and Curation, so the dropdown behaves the same way
  //    across the app and we avoid the server-side search quirk where
  //    products.list filters after its pagination window (which can make
  //    terms that aren't in the most-recently-updated page return zero).
  const { data: catalogPage } = trpc.products.list.useQuery(
    { limit: 200 },
    { staleTime: 60 * 1000 },
  );
  const catalogItems = useMemo<CatalogProduct[]>(() => {
    const rows = catalogPage?.items ?? [];
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      basePrice: p.basePrice ?? null,
      imageUrl: p.imageUrl ?? null,
    }));
  }, [catalogPage]);

  // ── Client selection ───────────────────────────────────────────────────
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebouncedClientSearch(clientSearch.trim()), 200);
    return () => clearTimeout(h);
  }, [clientSearch]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const { data: clientsPage } = trpc.clients.list.useQuery(
    { search: debouncedClientSearch || undefined, limit: 20 },
    { placeholderData: (prev) => prev },
  );
  const clientItems = (clientsPage && "items" in clientsPage ? clientsPage.items : []) ?? [];

  const { data: activeClient } = trpc.clients.getById.useQuery(
    { id: selectedClientId ?? 0 },
    { enabled: selectedClientId != null && selectedClientId > 0 },
  );
  const clientTaxExempt = Boolean(activeClient?.taxExempt);

  // ── Line items ─────────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>(() => [makeLine()]);
  const [pendingDeleteUid, setPendingDeleteUid] = useState<string | null>(null);

  // Keep the per-line Taxable default in sync with the client's tax-exempt
  // flag for rows the distributor hasn't explicitly toggled yet. Only lines
  // whose `taxable` field still matches the previous default get flipped —
  // once the distributor toggles a specific line, that choice sticks.
  const prevExempt = useRef(clientTaxExempt);
  useEffect(() => {
    if (prevExempt.current === clientTaxExempt) return;
    setLines(prev => prev.map(l =>
      l.taxable === !prevExempt.current ? { ...l, taxable: !clientTaxExempt } : l,
    ));
    prevExempt.current = clientTaxExempt;
  }, [clientTaxExempt]);

  // ── Sidebar state ──────────────────────────────────────────────────────
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>("net_30");
  const [customDueDate, setCustomDueDate] = useState<string>("");
  const [shipping, setShipping] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [sendEmailFlag, setSendEmailFlag] = useState(true);
  const [acceptCard, setAcceptCard] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(true);

  // ── Branding — shown in the preview document so the distributor sees
  //    the client-facing look with their own logo/color applied.
  const { data: branding } = trpc.branding.get.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  // ── Stripe status ──────────────────────────────────────────────────────
  const { data: stripeStatus } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const cardEligible = Boolean(stripeStatus?.hasConnectedAccount && stripeStatus?.canAcceptPayments);
  // If Stripe isn't connected and the card toggle is on, switch it off so
  // the computed payload never lies about how the invoice will be paid.
  useEffect(() => {
    if (!cardEligible && acceptCard) setAcceptCard(false);
  }, [cardEligible, acceptCard]);

  // ── Tax rate — a distributor-set fraction (e.g. 0.0875 for 8.75%) used
  //    only for lines whose Taxable toggle is on. Defaults to zero so
  //    the invoice total never inflates by surprise; the distributor
  //    sets a rate explicitly via the sidebar input.
  const [taxRate, setTaxRate] = useState<number>(0);

  // ── Totals ────────────────────────────────────────────────────────────
  const totals = useMemo(
    () => computeTotals(
      lines.map(l => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountType: l.discountType,
        discountValue: l.discountValue,
        taxable: l.taxable,
      })),
      { taxRate, shipping },
    ),
    [lines, taxRate, shipping],
  );

  // ── Draft pre-load ──────────────────────────────────────────────────
  // When landing on /invoices/new?draft=:id, fetch the existing draft and
  // hydrate every field once. `hydratedDraftRef` guards against a re-run
  // if the query re-emits (e.g. focus-refetch) and against clobbering
  // the distributor's newer edits.
  const hydratedDraftRef = useRef<number | null>(null);
  const { data: loadedDraft, isLoading: loadingDraft } =
    trpc.estimatesInvoices.invoices.getById.useQuery(
      { id: initialDraftId ?? 0 },
      { enabled: initialDraftId != null && initialDraftId > 0 },
    );

  useEffect(() => {
    if (!loadedDraft) return;
    if (hydratedDraftRef.current === loadedDraft.id) return;
    // Only drafts can be edited in place; sent/paid invoices are immutable
    // through this flow. Bail to the read-only detail page.
    if (loadedDraft.status !== "draft") {
      toast.error("This invoice has already been sent — redirecting to detail view.");
      navigate(`/invoices/${loadedDraft.id}`);
      return;
    }
    hydratedDraftRef.current = loadedDraft.id;

    setSelectedClientId(loadedDraft.clientId);
    setNotes(loadedDraft.notes ?? "");
    setPaymentTerms((loadedDraft.paymentTerms as PaymentTerms) ?? "net_30");
    if (loadedDraft.paymentTerms === "custom" && loadedDraft.dueDate) {
      const d = new Date(loadedDraft.dueDate);
      setCustomDueDate(d.toISOString().slice(0, 10));
    }
    setShipping(parseFloat(loadedDraft.shipping ?? "0") || 0);
    const sub = parseFloat(loadedDraft.subtotal ?? "0") || 0;
    const taxAmt = parseFloat(loadedDraft.tax ?? "0") || 0;
    // Recover tax rate from stored subtotal/tax. This is an approximation —
    // the server re-runs computeTotals on save so drift here self-heals.
    if (sub > 0 && taxAmt > 0) {
      setTaxRate(Math.min(1, Math.max(0, taxAmt / sub)));
    }
    const storedLines = loadedDraft.lineItems ?? [];
    if (storedLines.length > 0) {
      setLines(storedLines.map((li) => makeLine({
        productName: li.productName ?? "",
        description: li.description ?? "",
        sku: li.sku ?? "",
        quantity: Number(li.quantity) || 0,
        unitPrice: Number(li.unitPrice) || 0,
        discountType: (li.discountType as DiscountType | undefined) ?? "percent",
        discountValue: Number(li.discountValue) || 0,
        taxable: li.taxable ?? true,
        imageUrl: li.imageUrl ?? null,
      })));
    }
    // Suppress the next dirty-effect run — the setters above will flip all
    // tracked slices on the upcoming render and we don't want that to mark
    // the freshly loaded draft as unsaved.
    skipNextDirtyRef.current = true;
    setDirty(false);
  }, [loadedDraft, navigate]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const saveDraftMut = trpc.estimatesInvoices.invoices.saveDraft.useMutation();
  const sendMut = trpc.estimatesInvoices.invoices.send.useMutation({
    onSuccess: (res, vars) => {
      utils.estimatesInvoices.invoices.list.invalidate();
      toast.success(`Invoice sent to ${res.sentTo}`);
      navigate(`/invoices/${vars.id}`);
    },
    onError: (err) => toast.error(err.message || "Couldn't send invoice"),
  });

  // ── Dirty tracking — any input change flips to true; autosave clears
  //    to false. Separate from the query loading state so draft hydration
  //    doesn't immediately fire autosave.
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Serialize the inputs — any change triggers the dirty flag. We skip:
  //   (a) the initial mount (nothing has changed yet), and
  //   (b) the very next re-run after a draft hydrates, because hydration
  //       itself touches every watched state slice and would otherwise
  //       mark the freshly loaded draft as dirty and autosave it in a
  //       loop. `skipNextDirtyRef` is bumped by the hydration effect.
  const firstDirtyPass = useRef(true);
  const skipNextDirtyRef = useRef(false);
  useEffect(() => {
    if (firstDirtyPass.current) {
      firstDirtyPass.current = false;
      return;
    }
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    setDirty(true);
  }, [
    selectedClientId, notes, paymentTerms, customDueDate, shipping, taxRate,
    acceptCard, sendEmailFlag, remindersEnabled, lines,
  ]);

  // Build the saveDraft payload from current state. Used by manual Save
  // Draft clicks and by the 60 s autosave loop.
  const buildSavePayload = useCallback(() => ({
    id: draftId ?? undefined,
    clientId: selectedClientId,
    lineItems: lines.map(l => ({
      productName: l.productName.trim() || "",
      description: l.description.trim() || null,
      sku: l.sku.trim() || null,
      color: null,
      size: null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountType: l.discountType,
      discountValue: l.discountValue,
      taxable: l.taxable,
      imageUrl: l.imageUrl,
    })),
    taxRate,
    shipping,
    notes: notes.trim() || null,
    paymentTerms,
    customDueDate: paymentTerms === "custom" ? (customDueDate || null) : null,
  }), [draftId, selectedClientId, lines, taxRate, shipping, notes, paymentTerms, customDueDate]);

  const doSaveDraft = useCallback(
    async (opts: { silent?: boolean } = {}): Promise<{ id: number } | null> => {
      if (!selectedClientId) {
        if (!opts.silent) toast.error("Pick a client before saving the draft.");
        return null;
      }
      try {
        const saved = await saveDraftMut.mutateAsync(buildSavePayload());
        if (saved?.id && draftId == null) setDraftId(saved.id);
        setDirty(false);
        setLastSavedAt(Date.now());
        setShowSaved(true);
        utils.estimatesInvoices.invoices.list.invalidate();
        window.setTimeout(() => setShowSaved(false), SAVED_FLASH_MS);
        return saved ? { id: saved.id } : null;
      } catch (err) {
        if (!opts.silent) {
          toast.error(err instanceof Error ? err.message : "Couldn't save draft");
        }
        return null;
      }
    },
    [selectedClientId, saveDraftMut, buildSavePayload, draftId, utils],
  );

  // ── 60 s autosave ─────────────────────────────────────────────────────
  // Effect restarts its timer every time `dirty` flips to true; clears on
  // unmount or when another change arrives. We only fire when we can
  // actually save (a client has been chosen) — the server rejects
  // clientless inserts, so there's no point autosaving a form with no
  // client yet.
  useEffect(() => {
    if (!dirty) return;
    if (selectedClientId == null) return;
    const t = window.setTimeout(() => {
      doSaveDraft({ silent: true });
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [dirty, selectedClientId, doSaveDraft]);

  // ── Preview mode ──────────────────────────────────────────────────────
  const [previewMode, setPreviewMode] = useState(false);

  // ── Send — save-then-send so the server always has a persisted row.
  const canSend =
    selectedClientId != null &&
    lines.length > 0 &&
    lines.every(l => l.productName.trim().length > 0 && l.quantity > 0);

  const handleSend = async () => {
    if (!selectedClientId) {
      toast.error("Select a client first");
      return;
    }
    if (!canSend) {
      toast.error("Every line needs a description and a quantity greater than zero");
      return;
    }
    if (paymentTerms === "custom" && !customDueDate) {
      toast.error("Pick a custom due date");
      return;
    }
    // Ensure we have a persisted draft row the server can attach the
    // Checkout Session + publicToken to.
    let id = draftId;
    if (id == null) {
      const saved = await doSaveDraft({ silent: true });
      if (!saved) return;
      id = saved.id;
    } else if (dirty) {
      const saved = await doSaveDraft({ silent: true });
      if (!saved) return;
    }
    sendMut.mutate({
      id,
      acceptCard: cardEligible && acceptCard,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    });
  };

  // ── Navigation guard ──────────────────────────────────────────────────
  // Confirm-before-leave only fires when there are actual unsaved edits.
  // Wraps Back, Cancel and beforeunload (tab close / reload).
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const guardedNavigate = (target: string) => {
    if (dirty && selectedClientId != null) {
      setPendingNav(target);
      return;
    }
    navigate(target);
  };
  const confirmLeaveSave = async () => {
    const target = pendingNav;
    setPendingNav(null);
    if (!target) return;
    const saved = await doSaveDraft({ silent: true });
    if (saved) navigate(target);
  };
  const confirmLeaveDiscard = () => {
    const target = pendingNav;
    setPendingNav(null);
    if (target) navigate(target);
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Line actions ──────────────────────────────────────────────────────
  const addLine = () => setLines(prev => [...prev, makeLine({}, !clientTaxExempt)]);
  const updateLine = (uid: string, patch: Partial<DraftLine>) => {
    setLines(prev => prev.map(l => (l.uid === uid ? { ...l, ...patch } : l)));
  };
  const requestRemoveLine = (uid: string) => {
    if (lines.length === 1) {
      setPendingDeleteUid(uid);
      return;
    }
    setLines(prev => prev.filter(l => l.uid !== uid));
  };
  const confirmRemoveLastLine = () => {
    setLines([makeLine({}, !clientTaxExempt)]);
    setPendingDeleteUid(null);
  };

  // Resolve the due date for the preview (same logic the server will use).
  const previewDueDate = useMemo(() => {
    return resolveDueDate(paymentTerms, customDueDate || null);
  }, [paymentTerms, customDueDate]);

  const pageTitle = initialDraftId ? "Edit Invoice Draft" : "New Invoice";
  const pageSubtitle = previewMode
    ? "Client View — exactly what your client will see when they open this invoice."
    : "Build and send an invoice to a client";
  const isPersisting = saveDraftMut.isPending;
  const isSending = sendMut.isPending;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title={pageTitle} subtitle={pageSubtitle}>
      {/* ── Header strip — two layouts: edit vs preview ───────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3 sm:gap-0 min-h-[36px]">
        {previewMode ? (
          <>
            <div className="inline-flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: "#EEF2FF", color: "#4338CA" }}
              >
                Client View
              </span>
              <span className="text-[12px] text-mt-ink-3">Preview mode — read only</span>
            </div>
            <button
              type="button"
              onClick={() => setPreviewMode(false)}
              className="sq-action-btn flex items-center gap-1.5"
            >
              <Eye size={13} /> Exit Preview
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => guardedNavigate("/documents/invoices")}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mt-ink-3 hover:text-mt-ink transition-colors"
            >
              <ArrowLeft size={14} /> Back to Invoices
            </button>
            <div className="flex items-center gap-2">
              {/* Inline "Saved ✓" — quiet, unobtrusive, no toast. */}
              <AnimatePresence>
                {showSaved && !isPersisting && (
                  <motion.span
                    key="saved-flash"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: CUBIC }}
                    className="text-sm text-gray-400"
                    aria-live="polite"
                  >
                    Saved ✓
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                type="button"
                onClick={() => guardedNavigate("/documents/invoices")}
                className="sq-action-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => doSaveDraft()}
                disabled={isPersisting || isSending}
                className="sq-action-btn flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                aria-label="Save draft"
              >
                {isPersisting
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Check size={13} />}
                Save Draft
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode(true)}
                disabled={isPersisting || isSending}
                className="sq-action-btn flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Eye size={13} /> Preview
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend || isSending || isPersisting}
                className="sq-action-btn primary flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <SendIcon size={13} />}
                Send
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Body — preview takes over the whole area; edit uses the
          split-view shell. AnimatePresence lets the sidebar slide away
          when toggling into preview. ───────────────────────────────── */}
      {previewMode ? (
        loadingDraft ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-mt-ink-3" />
          </div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: PREVIEW_SLIDE_MS, ease: CUBIC }}
            className="rounded-lg"
            style={{ backgroundColor: CANVAS_BG }}
          >
            <InvoicePreviewDocument
              data={{
                invoiceNumber: loadedDraft?.invoiceNumber ?? "DRAFT",
                status: "preview",
                createdAt: loadedDraft?.createdAt ?? new Date(),
                dueDate: previewDueDate ?? null,
                lineItems: lines
                  .filter(l => l.productName.trim().length > 0 || l.quantity > 0)
                  .map((l, i) => ({
                    productName: l.productName.trim() || `Item ${i + 1}`,
                    description: l.description,
                    sku: l.sku,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    totalPrice: totals.lines[i]?.net ?? 0,
                    imageUrl: l.imageUrl,
                  })),
                subtotal: totals.subtotal,
                totalDiscount: totals.totalDiscount,
                tax: totals.tax,
                shipping: totals.shipping,
                total: totals.grandTotal,
                paymentTermsLabel: PAYMENT_TERMS_LABELS[paymentTerms],
                notes,
                client: activeClient
                  ? {
                      companyName: activeClient.companyName ?? null,
                      contactName: activeClient.contactName ?? null,
                      contactEmail: activeClient.contactEmail ?? null,
                      address: activeClient.address ?? null,
                    }
                  : null,
                distributor: {
                  companyName: branding?.brandCompanyName || "Your Company",
                  primaryColor: branding?.brandPrimaryColor || "#654BF9",
                  logoUrl: branding?.brandLogoUrl || null,
                  address: branding?.companyAddress || null,
                  phone: branding?.companyPhone || null,
                  email: branding?.companyEmail || null,
                  website: branding?.companyWebsite || null,
                },
              }}
              pay={{
                visible: cardEligible && acceptCard,
                // No handler in preview → the button renders as a visual
                // approximation of the live page (cursor-default, no POST).
                onPayNow: undefined,
              }}
            />
          </motion.div>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          {/* ─────── LEFT: Live Canvas ─────── */}
          <section
            className="lg:col-span-8 rounded-lg"
            style={{ backgroundColor: CANVAS_BG }}
          >
            <div className="bg-white rounded-lg p-6 sm:p-10">
              {/* Client header */}
              <div className="mb-8">
                <p className="text-sm uppercase tracking-wider text-gray-400 font-medium mb-2">
                  Bill To
                </p>
                <ClientPicker
                  open={clientPickerOpen}
                  onOpenChange={setClientPickerOpen}
                  search={clientSearch}
                  onSearch={setClientSearch}
                  items={clientItems}
                  selectedClientId={selectedClientId}
                  selectedClient={activeClient ?? null}
                  onSelect={(id) => {
                    setSelectedClientId(id);
                    setClientPickerOpen(false);
                  }}
                />
              </div>

              {/* Line item grid */}
              <LineItemGrid
                lines={lines}
                taxRate={taxRate}
                catalog={catalogItems}
                updateLine={updateLine}
                requestRemoveLine={requestRemoveLine}
                addLine={addLine}
              />

              {/* Totals block */}
              <div className="mt-10 flex justify-end">
                <div className="w-full sm:w-80 space-y-3">
                  <TotalsRow label="Subtotal" value={fmtCurrency(totals.subtotal)} />
                  {totals.totalDiscount > 0 && (
                    <TotalsRow
                      label="Total discount"
                      value={`−${fmtCurrency(totals.totalDiscount)}`}
                    />
                  )}
                  {totals.tax > 0 && <TotalsRow label="Tax" value={fmtCurrency(totals.tax)} />}
                  {totals.shipping > 0 && (
                    <TotalsRow label="Shipping" value={fmtCurrency(totals.shipping)} />
                  )}
                  <div
                    className="flex items-center justify-between pt-3"
                    style={{ borderTop: "1px solid #E5E7EB" }}
                  >
                    <span className="text-sm text-gray-500">Grand Total</span>
                    <span className="text-2xl font-semibold text-mt-ink tabular-nums">
                      {fmtCurrency(totals.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="mt-10 pt-6" style={{ borderTop: "1px solid #F0F0F0" }}>
                <label className="block text-sm uppercase tracking-wider text-gray-400 font-medium mb-2">
                  Notes to client
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Thank-you note, PO reference, payment instructions…"
                  className="w-full resize-y rounded-md border border-mt-border px-3 py-2 text-[13px] text-mt-ink outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
                />
              </div>
            </div>
          </section>

          {/* ─────── RIGHT: Settings Sidebar (slides away in preview) ─── */}
          <AnimatePresence initial={false}>
            <motion.aside
              key="settings-sidebar"
              initial={false}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 48, opacity: 0 }}
              transition={{ duration: PREVIEW_SLIDE_MS, ease: CUBIC }}
              className="lg:col-span-4"
            >
              <div className="lg:sticky lg:top-6">
                <SettingsSidebar
                  paymentTerms={paymentTerms}
                  onPaymentTermsChange={setPaymentTerms}
                  customDueDate={customDueDate}
                  onCustomDueDateChange={setCustomDueDate}
                  sendEmail={sendEmailFlag}
                  onSendEmailChange={setSendEmailFlag}
                  acceptCard={acceptCard}
                  onAcceptCardChange={setAcceptCard}
                  cardEligible={cardEligible}
                  remindersEnabled={remindersEnabled}
                  onRemindersEnabledChange={setRemindersEnabled}
                  shipping={shipping}
                  onShippingChange={setShipping}
                  taxRate={taxRate}
                  onTaxRateChange={setTaxRate}
                />
              </div>
            </motion.aside>
          </AnimatePresence>
        </div>
      )}

      {/* Confirm before wiping the only remaining line (destructive action) */}
      <ConfirmDialog
        open={pendingDeleteUid !== null}
        title="Remove the last line item?"
        description="An invoice has to have at least one line. Removing this one will reset it to a fresh empty row."
        cancelLabel="Keep line"
        confirmLabel="Reset line"
        confirmVariant="destructive"
        onCancel={() => setPendingDeleteUid(null)}
        onConfirm={confirmRemoveLastLine}
      />

      {/* Unsaved-changes prompt for Back/Cancel. ConfirmDialog has two
          buttons, so we use an extra Discard button rendered as its
          own ConfirmDialog chained via the description. To keep the
          three-way choice readable (Save / Discard / Cancel) without
          inventing a new primitive, the primary button saves, the X
          cancels, and the description includes a Discard link. */}
      <ConfirmDialog
        open={pendingNav !== null}
        title="Save as draft before leaving?"
        description={
          <span>
            You have unsaved changes. Save them as a draft so you can
            pick back up later, or{" "}
            <button
              type="button"
              onClick={confirmLeaveDiscard}
              className="underline font-medium text-mt-ink-2 hover:text-mt-ink"
            >
              discard
            </button>{" "}
            and leave.
          </span>
        }
        cancelLabel="Keep editing"
        confirmLabel="Save draft & leave"
        confirmVariant="primary"
        loading={isPersisting}
        onCancel={() => setPendingNav(null)}
        onConfirm={confirmLeaveSave}
      />
    </DashboardLayout>
  );
}

/* ========================================================================== *
 * Client picker — uses the existing trpc.clients.list query for search.
 * Renders as an inline dropdown that collapses back to a summary once a
 * client is selected, matching the Bill-To header pattern on InvoiceDetail.
 * ========================================================================== */
interface ClientPickerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  search: string;
  onSearch: (v: string) => void;
  items: Array<{ id: number; companyName: string; contactName: string; contactEmail: string; taxExempt?: boolean }>;
  selectedClientId: number | null;
  selectedClient: { id: number; companyName: string; contactName: string; contactEmail: string; taxExempt?: boolean } | null;
  onSelect: (id: number) => void;
}

function ClientPicker(props: ClientPickerProps) {
  const {
    open, onOpenChange, search, onSearch, items,
    selectedClient, onSelect,
  } = props;

  if (selectedClient && !open) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xl font-medium text-mt-ink">
            {selectedClient.companyName}
          </p>
          <p className="text-[13px] text-mt-ink-3 mt-0.5">
            {selectedClient.contactName}
            {selectedClient.contactEmail ? ` · ${selectedClient.contactEmail}` : ""}
          </p>
          {selectedClient.taxExempt && (
            <p className="text-[11px] uppercase tracking-wider text-amber-600 font-semibold mt-1">
              Tax-exempt
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="text-[12px] font-medium text-primary hover:underline"
        >
          Change client
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search clients by name, company, or email…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onFocus={() => onOpenChange(true)}
          className="w-full h-10 pl-9 pr-3 rounded-md border text-[13px] outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
          style={{ borderColor: "#E5E7EB" }}
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div {...SECTION_EXPAND} className="overflow-hidden">
            <div className="mt-2 max-w-md rounded-md border border-mt-border bg-white shadow-sm">
              {items.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-mt-ink-3">
                  No matching clients — add one from the Clients page first.
                </p>
              ) : (
                <ul>
                  {items.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-mt-surface-2 transition-colors"
                      >
                        <span className="font-medium text-mt-ink">{c.companyName}</span>
                        <span className="text-mt-ink-3 ml-2">
                          {c.contactName}
                          {c.contactEmail ? ` · ${c.contactEmail}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================== *
 * Line item grid
 * ========================================================================== */
interface LineItemGridProps {
  lines: DraftLine[];
  taxRate: number;
  catalog: CatalogProduct[];
  updateLine: (uid: string, patch: Partial<DraftLine>) => void;
  requestRemoveLine: (uid: string) => void;
  addLine: () => void;
}

function LineItemGrid(props: LineItemGridProps) {
  const { lines, updateLine, requestRemoveLine, addLine, taxRate, catalog } = props;
  return (
    <div>
      {/* Column headers — borderless editorial style */}
      <div className="hidden sm:grid grid-cols-[1.3fr_2.4fr_0.7fr_1fr_1.1fr_0.6fr_1fr_auto] gap-3 px-2 pb-2 border-b border-gray-100">
        <HeaderCell>SKU</HeaderCell>
        <HeaderCell>Description</HeaderCell>
        <HeaderCell align="right">Qty</HeaderCell>
        <HeaderCell align="right">Unit Price</HeaderCell>
        <HeaderCell align="right">Discount</HeaderCell>
        <HeaderCell align="center">Tax</HeaderCell>
        <HeaderCell align="right">Total</HeaderCell>
        <span />
      </div>
      <ul className="overflow-x-auto sm:overflow-visible">
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.li
              key={line.uid}
              layout
              {...LINE_ENTER}
              className="min-w-[720px] sm:min-w-0"
            >
              <LineItemRow
                line={line}
                taxRate={taxRate}
                catalog={catalog}
                updateLine={updateLine}
                requestRemoveLine={requestRemoveLine}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="mt-3">
        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-primary hover:text-[#5840D9] transition-colors"
        >
          <Plus size={14} /> Add line item
        </button>
      </div>
    </div>
  );
}

function HeaderCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <span
      className="text-sm uppercase tracking-wider text-gray-400 font-medium"
      style={{ textAlign: align }}
    >
      {children}
    </span>
  );
}

/* ========================================================================== *
 * Line item row — SKU auto-populates via catalog search; all six editable
 * cells recompute their line-total on every keystroke via computeLine().
 * ========================================================================== */
interface LineItemRowProps {
  line: DraftLine;
  taxRate: number;
  catalog: CatalogProduct[];
  updateLine: (uid: string, patch: Partial<DraftLine>) => void;
  requestRemoveLine: (uid: string) => void;
}

function LineItemRow({ line, taxRate, catalog, updateLine, requestRemoveLine }: LineItemRowProps) {
  // Per-line total is computed the same way the server will compute it.
  const gross = Math.max(0, line.quantity) * Math.max(0, line.unitPrice);
  const discount = line.discountValue > 0
    ? line.discountType === "percent"
      ? Math.min(100, Math.max(0, line.discountValue)) * gross / 100
      : Math.min(gross, Math.max(0, line.discountValue))
    : 0;
  const lineTotal = Math.max(0, gross - discount);

  return (
    <div className="group grid grid-cols-[1.3fr_2.4fr_0.7fr_1fr_1.1fr_0.6fr_1fr_auto] gap-3 items-center py-3 border-b border-gray-100 px-2">
      {/* SKU with catalog search */}
      <SkuWithCatalog
        value={line.sku}
        catalog={catalog}
        onValueChange={(v) => updateLine(line.uid, { sku: v })}
        onPick={(product) =>
          updateLine(line.uid, {
            productId: product.id,
            sku: product.sku ?? "",
            productName: product.name,
            unitPrice: product.basePrice ? parseFloat(product.basePrice) : line.unitPrice,
            imageUrl: product.imageUrl ?? null,
          })
        }
      />

      {/* Description — combines product name + description */}
      <DescriptionWithCatalog
        productName={line.productName}
        description={line.description}
        catalog={catalog}
        onNameChange={(v) => updateLine(line.uid, { productName: v })}
        onDescriptionChange={(v) => updateLine(line.uid, { description: v })}
        onPick={(product) =>
          updateLine(line.uid, {
            productId: product.id,
            sku: product.sku ?? line.sku,
            productName: product.name,
            unitPrice: product.basePrice ? parseFloat(product.basePrice) : line.unitPrice,
            imageUrl: product.imageUrl ?? null,
          })
        }
      />

      {/* Qty */}
      <QtyInput
        value={line.quantity}
        onChange={(v) => updateLine(line.uid, { quantity: v })}
      />

      {/* Unit price */}
      <CurrencyInput
        value={line.unitPrice}
        onChange={(v) => updateLine(line.uid, { unitPrice: v })}
      />

      {/* Discount — mode toggle + value */}
      <DiscountInput
        mode={line.discountType}
        value={line.discountValue}
        onModeChange={(m) => updateLine(line.uid, { discountType: m })}
        onValueChange={(v) => updateLine(line.uid, { discountValue: v })}
      />

      {/* Tax toggle */}
      <div className="flex justify-center">
        <TaxToggle
          enabled={line.taxable}
          onChange={(v) => updateLine(line.uid, { taxable: v })}
          taxRate={taxRate}
        />
      </div>

      {/* Total */}
      <div className="text-right text-[13px] font-medium text-mt-ink tabular-nums">
        {fmtCurrency(lineTotal)}
      </div>

      {/* Remove — only reveals on hover */}
      <button
        type="button"
        onClick={() => requestRemoveLine(line.uid)}
        aria-label="Remove line"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ========================================================================== *
 * Small field primitives — kept in this file since they're purpose-built
 * for the canvas. No reusable value outside this page right now.
 * ========================================================================== */

const DROPDOWN_ANIM = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.12, ease: CUBIC },
} as const;

function SkuWithCatalog({
  value,
  catalog,
  onValueChange,
  onPick,
}: {
  value: string;
  catalog: CatalogProduct[];
  onValueChange: (v: string) => void;
  onPick: (p: CatalogProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const results = useMemo(() => filterCatalog(catalog, value), [catalog, value]);

  useEffect(() => { if (cursor >= results.length) setCursor(0); }, [results.length, cursor]);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onValueChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor(c => Math.min(results.length - 1, c + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
          else if (e.key === "Enter" && results[cursor]) { e.preventDefault(); onPick(results[cursor]); setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="SKU"
        className="w-full h-9 px-2 rounded-md border text-[12px] font-mono text-mt-ink outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
        style={{ borderColor: "#E5E7EB" }}
      />
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            {...DROPDOWN_ANIM}
            className="absolute left-0 z-30 mt-1 rounded-md border border-mt-border bg-white shadow-md"
            style={{ width: 320 }}
          >
            <CatalogResultList results={results} cursor={cursor} onPick={(p) => { onPick(p); setOpen(false); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DescriptionWithCatalog({
  productName,
  description,
  catalog,
  onNameChange,
  onDescriptionChange,
  onPick,
}: {
  productName: string;
  description: string;
  catalog: CatalogProduct[];
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onPick: (p: CatalogProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const results = useMemo(() => filterCatalog(catalog, productName), [catalog, productName]);
  useEffect(() => { if (cursor >= results.length) setCursor(0); }, [results.length, cursor]);

  return (
    <div className="relative">
      <input
        type="text"
        value={productName}
        onChange={(e) => { onNameChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor(c => Math.min(results.length - 1, c + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
          else if (e.key === "Enter" && results[cursor]) { e.preventDefault(); onPick(results[cursor]); setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Item name or description"
        className="w-full h-9 px-2 rounded-md border text-[13px] text-mt-ink outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
        style={{ borderColor: "#E5E7EB" }}
      />
      {description.length > 0 || open ? (
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Detail (optional)"
          className="mt-1 w-full h-8 px-2 rounded-md border text-[12px] text-mt-ink-3 outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
          style={{ borderColor: "#F0F0F0" }}
        />
      ) : null}
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            {...DROPDOWN_ANIM}
            className="absolute left-0 z-30 mt-1 rounded-md border border-mt-border bg-white shadow-md"
            style={{ width: 360 }}
          >
            <CatalogResultList results={results} cursor={cursor} onPick={(p) => { onPick(p); setOpen(false); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CatalogResultList({
  results,
  cursor,
  onPick,
}: {
  results: CatalogProduct[];
  cursor: number;
  onPick: (p: CatalogProduct) => void;
}) {
  return (
    <ul className="py-1 max-h-72 overflow-y-auto">
      {results.map((p, i) => (
        <li key={p.id}>
          <button
            type="button"
            // Use onMouseDown so the parent input's onBlur doesn't close the
            // list before this handler fires.
            onMouseDown={(e) => { e.preventDefault(); onPick(p); }}
            className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${i === cursor ? "bg-mt-surface-2" : "hover:bg-mt-surface-2"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-mt-ink truncate">{p.name}</span>
              {p.basePrice && (
                <span className="text-mt-ink-3 tabular-nums shrink-0">${parseFloat(p.basePrice).toFixed(2)}</span>
              )}
            </div>
            {p.sku && <p className="text-[11px] font-mono text-mt-ink-4 mt-0.5">{p.sku}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function QtyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex h-9 rounded-md border items-stretch" style={{ borderColor: "#E5E7EB" }}>
      <button
        type="button"
        aria-label="Decrement quantity"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="px-2 text-mt-ink-3 hover:text-mt-ink"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const next = parseInt(e.target.value, 10);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="w-full h-full text-center text-[13px] tabular-nums outline-none bg-transparent"
      />
      <button
        type="button"
        aria-label="Increment quantity"
        onClick={() => onChange(value + 1)}
        className="px-2 text-mt-ink-3 hover:text-mt-ink"
      >
        +
      </button>
    </div>
  );
}

function CurrencyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string>(value > 0 ? value.toFixed(2) : "");
  // Keep local buffer in sync when the authoritative value changes from outside
  // (e.g. catalog auto-fill). Skip while the user is mid-edit to avoid clobbering.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setRaw(value > 0 ? value.toFixed(2) : "");
  }, [value]);

  return (
    <div className="relative h-9">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-mt-ink-3">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, "");
          setRaw(next);
          const parsed = parseFloat(next);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setRaw(value > 0 ? value.toFixed(2) : "");
        }}
        placeholder="0.00"
        className="w-full h-full pl-5 pr-2 rounded-md border text-[13px] text-mt-ink tabular-nums outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9] text-right"
        style={{ borderColor: "#E5E7EB" }}
      />
    </div>
  );
}

function DiscountInput({
  mode,
  value,
  onModeChange,
  onValueChange,
}: {
  mode: DiscountType;
  value: number;
  onModeChange: (m: DiscountType) => void;
  onValueChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex h-9 rounded-md border items-stretch" style={{ borderColor: "#E5E7EB" }}>
      <button
        type="button"
        onClick={() => onModeChange(mode === "percent" ? "flat" : "percent")}
        className="px-2 text-mt-ink-3 hover:text-mt-ink border-r"
        style={{ borderColor: "#F0F0F0" }}
        aria-label={`Toggle discount mode. Currently ${mode === "percent" ? "percent" : "flat"}`}
      >
        {mode === "percent" ? <Percent size={12} /> : <DollarSign size={12} />}
      </button>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value === 0 ? "" : value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          onValueChange(Number.isFinite(n) ? n : 0);
        }}
        placeholder="0"
        className="w-full h-full px-2 text-right text-[13px] tabular-nums outline-none bg-transparent"
      />
    </div>
  );
}

function TaxToggle({
  enabled,
  onChange,
  taxRate,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  taxRate: number;
}) {
  const pct = taxRate > 0 ? `${(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "tax";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onChange(!enabled)}
            className={`inline-flex items-center h-6 w-10 rounded-full transition-colors ${enabled ? "bg-[#654BF9]" : "bg-gray-200"}`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {enabled ? `Taxed at ${pct}` : "Tax-exempt line"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ========================================================================== *
 * Totals row
 * ========================================================================== */
function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-[13px] text-mt-ink tabular-nums">{value}</span>
    </div>
  );
}

/* ========================================================================== *
 * Settings sidebar
 * ========================================================================== */
interface SettingsSidebarProps {
  paymentTerms: PaymentTerms;
  onPaymentTermsChange: (t: PaymentTerms) => void;
  customDueDate: string;
  onCustomDueDateChange: (v: string) => void;
  sendEmail: boolean;
  onSendEmailChange: (v: boolean) => void;
  acceptCard: boolean;
  onAcceptCardChange: (v: boolean) => void;
  cardEligible: boolean;
  remindersEnabled: boolean;
  onRemindersEnabledChange: (v: boolean) => void;
  shipping: number;
  onShippingChange: (v: number) => void;
  taxRate: number;
  onTaxRateChange: (v: number) => void;
}

function SettingsSidebar(props: SettingsSidebarProps) {
  const [, navigate] = useLocation();
  return (
    <div className="divide-y divide-mt-border border-y border-mt-border bg-white rounded-lg">
      {/* Payment terms */}
      <section className="p-5">
        <SidebarSectionHeader icon={Calendar}>Payment terms</SidebarSectionHeader>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["due_on_receipt", "net_15", "net_30", "net_60"] as PaymentTerms[]).map((t) => (
            <PaymentTermsChip
              key={t}
              selected={props.paymentTerms === t}
              onClick={() => props.onPaymentTermsChange(t)}
              label={PAYMENT_TERMS_LABELS[t]}
            />
          ))}
          <PaymentTermsChip
            selected={props.paymentTerms === "custom"}
            onClick={() => props.onPaymentTermsChange("custom")}
            label="Custom"
            full
          />
        </div>
        <AnimatePresence>
          {props.paymentTerms === "custom" && (
            <motion.div {...SECTION_EXPAND} className="overflow-hidden">
              <label className="block mt-3 text-[11px] uppercase tracking-wider text-gray-400 font-medium">
                Custom due date
              </label>
              <input
                type="date"
                value={props.customDueDate}
                onChange={(e) => props.onCustomDueDateChange(e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-md border text-[13px] outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
                style={{ borderColor: "#E5E7EB" }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Send options */}
      <section className="p-5">
        <SidebarSectionHeader icon={Mail}>Send options</SidebarSectionHeader>
        <div className="mt-3 space-y-3">
          <SidebarToggle
            label="Send via email"
            description="Email the invoice to the client as soon as you save."
            enabled={props.sendEmail}
            onChange={props.onSendEmailChange}
          />
          {props.cardEligible ? (
            <SidebarToggle
              label="Accept credit card"
              description="Includes a Pay Now button routed through your connected Stripe account."
              enabled={props.acceptCard}
              onChange={props.onAcceptCardChange}
              iconLeft={CreditCard}
            />
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => navigate("/settings?tab=integrations")}
                    className="w-full text-left"
                  >
                    <SidebarToggle
                      label="Accept credit card"
                      description="Connect Stripe to accept card payments"
                      enabled={false}
                      onChange={() => navigate("/settings?tab=integrations")}
                      iconLeft={CreditCard}
                      disabled
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>
                  Connect Stripe to accept card payments
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </section>

      {/* Reminders */}
      <section className="p-5">
        <SidebarSectionHeader icon={Bell}>Reminders</SidebarSectionHeader>
        <div className="mt-3">
          <SidebarToggle
            label="Automated reminders"
            description="Send a friendly nudge before the due date and again if it slips."
            enabled={props.remindersEnabled}
            onChange={props.onRemindersEnabledChange}
          />
        </div>
      </section>

      {/* Tax rate */}
      <section className="p-5">
        <SidebarSectionHeader icon={Percent}>Tax rate</SidebarSectionHeader>
        <div className="mt-3">
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-medium">
            Rate applied to taxable lines
          </label>
          <div className="relative mt-1">
            <input
              type="number"
              min={0}
              step="0.01"
              value={props.taxRate === 0 ? "" : (props.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                props.onTaxRateChange(Number.isFinite(n) ? Math.max(0, n) / 100 : 0);
              }}
              placeholder="0"
              className="w-full h-9 pl-3 pr-8 rounded-md border text-[13px] outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
              style={{ borderColor: "#E5E7EB" }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-mt-ink-3">%</span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-mt-ink-3">
            <Info size={11} className="mt-0.5 shrink-0" />
            Only lines with the Tax toggle on contribute.
          </p>
        </div>
      </section>

      {/* Shipping */}
      <section className="p-5">
        <SidebarSectionHeader icon={Truck}>Shipping</SidebarSectionHeader>
        <div className="mt-3">
          <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-medium">
            Shipping amount
          </label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-mt-ink-3">$</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={props.shipping === 0 ? "" : props.shipping}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                props.onShippingChange(Number.isFinite(n) ? Math.max(0, n) : 0);
              }}
              placeholder="0.00"
              className="w-full h-9 pl-6 pr-2 rounded-md border text-[13px] outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
              style={{ borderColor: "#E5E7EB" }}
            />
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-mt-ink-3">
            <Info size={11} className="mt-0.5 shrink-0" />
            Added to the grand total after tax.
          </p>
        </div>
      </section>
    </div>
  );
}

function SidebarSectionHeader({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-mt-ink-3" />
      <h3 className="text-sm uppercase tracking-wider text-gray-400 font-medium">{children}</h3>
    </div>
  );
}

function PaymentTermsChip({
  selected,
  onClick,
  label,
  full,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3 rounded-md text-[12px] font-medium transition-all ${full ? "col-span-2" : ""} ${
        selected
          ? "bg-[#654BF9] text-white"
          : "bg-white text-mt-ink-2 border border-mt-border hover:bg-mt-surface-2"
      }`}
    >
      {label}
    </button>
  );
}

function SidebarToggle({
  label,
  description,
  enabled,
  onChange,
  iconLeft: IconLeft,
  disabled,
}: {
  label: string;
  description?: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  iconLeft?: React.ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${disabled ? "opacity-50" : ""}`}>
      {IconLeft && <IconLeft size={14} className="text-mt-ink-3 mt-1" />}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-mt-ink">{label}</p>
        {description && (
          <p className="text-[11.5px] text-mt-ink-3 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => !disabled && onChange(!enabled)}
        className={`inline-flex items-center h-6 w-10 rounded-full transition-colors ${enabled ? "bg-[#654BF9]" : "bg-gray-200"} ${disabled ? "cursor-not-allowed" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

