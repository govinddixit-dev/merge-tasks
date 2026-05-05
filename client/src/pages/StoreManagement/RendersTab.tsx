/**
 * RendersTab — Phase 7 distributor render approval gate.
 *
 * Shows every storeProducts binding for the active store with status,
 * the original product photo, and (when available) the AI render or
 * manual override side-by-side. Each card exposes the four actions
 * from the spec — Approve / Re-render / Upload Override / Remove
 * Override — gated by the binding's current state.
 *
 * Design intent: Apple-for-enterprise — restrained surface, clear
 * status hierarchy, primary purple (#654BF9) only on the affirmative
 * action. Albert Sans inherits from the global stylesheet.
 *
 * Customer impact: nothing here is visible to shoppers. The customer
 * webstore reads a different projection (storesCrud.getBySlug) that
 * gates display behind renderApproved. This tab is the gate operator.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle2, Clock, Loader2, AlertTriangle, ImageOff,
  Upload, RefreshCw, Trash2, Check, X, Search, Move,
} from "lucide-react";
import { PlacementEditor } from "./PlacementEditor";
import { colorNameToHex } from "@/lib/colorMap";

interface RendersTabProps {
  storeId: number;
}

/** Status filter values mirror the server enum on renderManager.listByStore. */
type StatusFilter = "all" | "pending_review" | "approved" | "rendering" | "failed" | "no_render";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "pending_review", label: "Pending Review" },
  { id: "approved",       label: "Approved" },
  { id: "failed",         label: "Failed" },
  { id: "rendering",      label: "Rendering" },
  { id: "no_render",      label: "No Render" },
  { id: "all",            label: "All" },
];

/** Strip the data: URL prefix from a FileReader result so the server gets pure base64. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type Row = {
  storeProductId: number;
  productId: number;
  productName: string | null;
  productSku: string | null;
  productImageUrl: string | null;
  renderUrl: string | null;
  renderStatus: "pending" | "rendering" | "complete" | "failed" | null;
  renderedAt: Date | string | null;
  renderApproved: boolean;
  renderApprovedAt: Date | string | null;
  renderApprovedBy: number | null;
  renderOverrideUrl: string | null;
  renderPromptAdjustment: string | null;
  // Phase 7+ visual placement editor — decimals come back as strings from
  // drizzle/mysql2; PlacementEditor coerces to numbers.
  renderPlacementX: string | null;
  renderPlacementY: string | null;
  renderPlacementWidth: string | null;
  renderPlacementHeight: string | null;
  renderPlacementRotation: string | null;
  storeLogoUrl: string | null;
};

/** Derive the operator-facing status from the row's column state. */
function deriveStatus(r: Row):
  | "approved"
  | "pending_review"
  | "rendering"
  | "failed"
  | "no_render"
{
  if (r.renderApproved) return "approved";
  if (r.renderStatus === "rendering") return "rendering";
  if (r.renderStatus === "failed") return "failed";
  if (r.renderStatus === "complete") return "pending_review";
  return "no_render";
}

function StatusBadge({ status }: { status: ReturnType<typeof deriveStatus> }) {
  const map = {
    approved:       { label: "Approved",       icon: CheckCircle2, bg: "#F0FDF4", fg: "#16A34A" },
    pending_review: { label: "Pending Review", icon: Clock,        bg: "#FEF3C7", fg: "#D97706" },
    rendering:      { label: "Rendering",      icon: Loader2,      bg: "#EFF6FF", fg: "#2563EB" },
    failed:         { label: "Failed",         icon: AlertTriangle,bg: "#FEF2F2", fg: "#DC2626" },
    no_render:      { label: "No Render",      icon: ImageOff,     bg: "#F5F5F5", fg: "#737373" },
  } as const;
  const v = map[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0"
      style={{ backgroundColor: v.bg, color: v.fg }}
    >
      <v.icon size={11} className={status === "rendering" ? "animate-spin" : ""} />
      {v.label}
    </span>
  );
}

export function RendersTab({ storeId }: RendersTabProps) {
  const [filter, setFilter] = useState<StatusFilter>("pending_review");
  const [search, setSearch] = useState("");
  // Per-card mutation in flight, keyed by storeProductId. Used to disable
  // duplicate clicks and show inline spinners on the right action button.
  const [busyId, setBusyId] = useState<number | null>(null);
  // Re-render modal state — a single modal that targets one storeProductId
  // at a time, with an optional prompt adjustment text field.
  const [reRenderTarget, setReRenderTarget] = useState<Row | null>(null);
  const [reRenderPrompt, setReRenderPrompt] = useState("");
  // Visual Placement Editor target — separate state from the re-render modal
  // since it's a different surface and the user might be reviewing different
  // products in each.
  const [placementTarget, setPlacementTarget] = useState<Row | null>(null);
  // Card-click detail preview modal target. Side-by-side images + the same
  // action buttons as the card, in a larger surface for full-quality review.
  const [detailTarget, setDetailTarget] = useState<Row | null>(null);
  // Hidden file input shared across all cards; the active upload card's
  // id lives in uploadTargetRef so onChange knows which row to write to.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<number | null>(null);

  const utils = trpc.useUtils();
  // Phase 8 — switched to the grouped feed. Each entry is a styleGroup
  // with a `variants` array of full Row objects; the UI flattens to the
  // active variant per group for card rendering.
  const groupedQuery = trpc.renderManager.listByStoreGrouped.useQuery(
    { storeId, status: filter },
    {
      refetchInterval: (query) => {
        const data = (query.state.data ?? []) as Array<{ variants: Row[] }>;
        return data.some(g => g.variants.some(v => v.renderStatus === "rendering")) ? 10_000 : false;
      },
    },
  );
  const groups = useMemo(
    () => (groupedQuery.data ?? []) as Array<{
      styleGroup: string;
      primary: Row & { isVariantPrimary: boolean; styleGroup: string | null; colorName: string | null; colorHex: string | null; swatchUrl: string | null };
      variants: Array<Row & { isVariantPrimary: boolean; styleGroup: string | null; colorName: string | null; colorHex: string | null; swatchUrl: string | null }>;
      matchedCount: number;
      variantCount: number;
    }>,
    [groupedQuery.data],
  );

  // Per-group active-variant state. Keyed by styleGroup; value is the
  // storeProductId of the variant the operator has clicked. Defaults to
  // the primary's storeProductId when unset.
  const [activeByGroup, setActiveByGroup] = useState<Record<string, number>>({});

  // Flatten groups → one Row per group (the active variant). Used by the
  // legacy busy/handler code below; the card body adds the swatch toggle.
  const rows: Row[] = useMemo(() => groups.map(g => {
    const active = activeByGroup[g.styleGroup];
    return (g.variants.find(v => v.storeProductId === active) ?? g.primary) as unknown as Row;
  }), [groups, activeByGroup]);

  const isLoading = groupedQuery.isLoading;
  void isLoading;

  // Track which rows were rendering on the previous tick so we can fire
  // a toast exactly once when each transitions to complete or failed.
  // Keyed by storeProductId, value is the last-seen renderStatus.
  const prevStatusRef = useRef<Map<number, Row["renderStatus"]>>(new Map());
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = new Map<number, Row["renderStatus"]>();
    for (const r of rows) {
      const before = prev.get(r.storeProductId);
      const after = r.renderStatus;
      if (before === "rendering" && after === "complete") {
        toast.success("Render complete — ready for review", {
          description: r.productName ?? undefined,
        });
      } else if (before === "rendering" && after === "failed") {
        toast.error("Render failed — try again or upload an override", {
          description: r.productName ?? undefined,
        });
      }
      next.set(r.storeProductId, after);
    }
    prevStatusRef.current = next;
  }, [rows]);

  const approveMut = trpc.renderManager.approve.useMutation();
  const bulkApproveMut = trpc.renderManager.bulkApprove.useMutation();
  const reRenderMut = trpc.renderManager.reRender.useMutation();
  const bulkReRenderFailedMut = trpc.renderManager.bulkReRenderFailed.useMutation();
  const uploadOverrideMut = trpc.renderManager.uploadOverride.useMutation();
  const removeOverrideMut = trpc.renderManager.removeOverride.useMutation();

  // Esc closes whichever modal is open. Detail modal is the most likely
  // to be dismissed quickly, so it goes first; never close the re-render
  // modal while its mutation is mid-flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailTarget) setDetailTarget(null);
      else if (reRenderTarget && !reRenderMut.isPending) setReRenderTarget(null);
      else if (placementTarget) setPlacementTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailTarget, reRenderTarget, placementTarget, reRenderMut.isPending]);

  function refetch() {
    return utils.renderManager.listByStoreGrouped.invalidate({ storeId });
  }

  // Search-filter against name/sku in JS — server already handled status.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.productName ?? "").toLowerCase().includes(q) ||
      (r.productSku ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Map activeRow.storeProductId → its group, for swatch-toggle rendering
  // inside the card body.
  const groupByActiveStoreProductId = useMemo(() => {
    const m = new Map<number, typeof groups[number]>();
    for (const g of groups) {
      const active = activeByGroup[g.styleGroup];
      const activeRow = g.variants.find(v => v.storeProductId === active) ?? g.primary;
      m.set(activeRow.storeProductId, g);
    }
    return m;
  }, [groups, activeByGroup]);

  // Counts driving the filter pill labels — pulled from the unfiltered
  // grid query result so they're always accurate regardless of search.
  const counts = useMemo(() => {
    const out = { all: rows.length, pending_review: 0, approved: 0, rendering: 0, failed: 0, no_render: 0 };
    for (const r of rows) out[deriveStatus(r)] += 1;
    return out;
  }, [rows]);

  // ─── Action handlers ────────────────────────────────────────────────────────

  async function handleApprove(row: Row) {
    setBusyId(row.storeProductId);
    try {
      await approveMut.mutateAsync({ storeProductId: row.storeProductId });
      await refetch();
      toast.success("Render approved", { description: "Now live on webstore." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve render");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkApprove() {
    try {
      const result = await bulkApproveMut.mutateAsync({ storeId });
      await refetch();
      toast.success(
        result.approved === 0
          ? "Nothing to approve"
          : `${result.approved} ${result.approved === 1 ? "render" : "renders"} approved`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't bulk-approve");
    }
  }

  function openReRender(row: Row) {
    setReRenderTarget(row);
    setReRenderPrompt(row.renderPromptAdjustment ?? "");
  }

  async function handleReRenderSubmit() {
    if (!reRenderTarget) return;
    const target = reRenderTarget;
    setBusyId(target.storeProductId);
    try {
      await reRenderMut.mutateAsync({
        storeProductId: target.storeProductId,
        promptAdjustment: reRenderPrompt,
      });
      setReRenderTarget(null);
      setReRenderPrompt("");
      await refetch();
      toast.success("Re-render queued", {
        description: "Typically completes in 30-60 seconds. The card will update automatically.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue re-render");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkReRenderFailed() {
    try {
      const result = await bulkReRenderFailedMut.mutateAsync({ storeId });
      await refetch();
      toast.success(
        result.enqueued === 0
          ? "No failed renders to retry"
          : `${result.enqueued} ${result.enqueued === 1 ? "render" : "renders"} re-queued`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't re-render failed batch");
    }
  }

  function openUploadPicker(row: Row) {
    uploadTargetRef.current = row.storeProductId;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = uploadTargetRef.current;
    // Reset the input so selecting the same file twice in a row still fires onChange.
    e.target.value = "";
    if (!file || !target) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Override image must be 5MB or smaller");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use a JPG, PNG, or WebP image");
      return;
    }
    setBusyId(target);
    try {
      const base64 = await fileToBase64(file);
      await uploadOverrideMut.mutateAsync({
        storeProductId: target,
        imageBase64: base64,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        fileName: file.name,
      });
      await refetch();
      toast.success("Manual override uploaded and approved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload override");
    } finally {
      setBusyId(null);
      uploadTargetRef.current = null;
    }
  }

  async function handleRemoveOverride(row: Row) {
    setBusyId(row.storeProductId);
    try {
      const result = await removeOverrideMut.mutateAsync({ storeProductId: row.storeProductId });
      await refetch();
      toast.success(
        result.fallbackHasAiRender
          ? "Override removed — showing AI render"
          : "Override removed",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove override");
    } finally {
      setBusyId(null);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (groupedQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-primary mb-3" />
        <p className="text-[13px] text-mt-ink-3">Loading renders…</p>
      </div>
    );
  }

  return (
    <div>
      {/* ─── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map(f => {
            const active = filter === f.id;
            const count = counts[f.id];
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "bg-mt-surface-2 text-mt-ink-3 hover:bg-mt-surface-3"
                }`}
              >
                {f.label}
                <span className={`ml-1.5 text-[11px] ${active ? "opacity-80" : "opacity-60"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mt-ink-4" />
            <input
              type="text"
              placeholder="Search products"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-[12px] border border-mt-border rounded-lg w-56 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
          </div>
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproveMut.isPending || counts.pending_review === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-primary text-white hover:bg-[#4F3BC7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulkApproveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Approve All Pending
          </button>
          <button
            onClick={handleBulkReRenderFailed}
            disabled={bulkReRenderFailedMut.isPending || counts.failed === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulkReRenderFailedMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Re-render All Failed
          </button>
        </div>
      </div>

      {/* ─── Empty state ─────────────────────────────────────────────────── */}
      {filteredRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-lg border border-mt-border">
          <ImageOff size={32} className="text-mt-ink-4 mb-3" />
          <p className="text-[14px] font-semibold text-mt-ink-2 mb-1">
            {search ? "No matches" : "Nothing here"}
          </p>
          <p className="text-[12px] text-mt-ink-4">
            {search
              ? "Try a different product name or SKU."
              : filter === "pending_review"
                ? "All renders for this store have been reviewed."
                : "No products in this bucket."}
          </p>
        </div>
      )}

      {/* ─── Card grid ───────────────────────────────────────────────────── */}
      {filteredRows.length > 0 && (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map(row => {
            const status = deriveStatus(row);
            const isBusy = busyId === row.storeProductId;
            const isRendering = status === "rendering";
            // While rendering, fall back to the previous render (or the
            // original product photo) so the distributor keeps a visual
            // reference rather than seeing an empty pane.
            const previousRender = row.renderOverrideUrl ?? row.renderUrl;
            const displayRender = isRendering
              ? (previousRender ?? row.productImageUrl)
              : previousRender;
            const isOverride = !isRendering && !!row.renderOverrideUrl;
            const showingFallbackOriginal =
              isRendering && !previousRender && !!row.productImageUrl;

            return (
              <div
                key={row.storeProductId}
                onClick={() => setDetailTarget(row)}
                className="bg-white rounded-xl border border-mt-border overflow-hidden flex flex-col cursor-pointer hover:shadow-lg hover:border-mt-border-2 transition-all"
              >
                {/* Image comparison strip — original on left, render/override on right */}
                <div className="grid grid-cols-2 bg-mt-surface-2">
                  <div className="aspect-square relative bg-white flex items-center justify-center border-r border-mt-border">
                    {row.productImageUrl ? (
                      <img
                        src={row.productImageUrl}
                        alt={row.productName ?? ""}
                        className="w-full h-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <ImageOff size={20} className="text-mt-ink-4" />
                    )}
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/90 text-mt-ink-3">
                      Original
                    </span>
                  </div>
                  <div className="aspect-square relative bg-white flex items-center justify-center">
                    {displayRender ? (
                      <img
                        src={displayRender}
                        alt=""
                        className={`w-full h-full object-contain ${isRendering ? "opacity-70" : ""}`}
                        draggable={false}
                      />
                    ) : (
                      <span className="text-[11px] text-mt-ink-4">No render yet</span>
                    )}
                    <span
                      className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: isOverride ? "#654BF9" : "rgba(255,255,255,0.92)",
                        color: isOverride ? "#fff" : "#737373",
                      }}
                    >
                      {isOverride ? "Manual Override" : "AI Render"}
                    </span>
                    {isRendering && (
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#2563EB] text-white">
                        <Loader2 size={9} className="animate-spin" />
                        {previousRender ? "Rendering new version…" : "Rendering…"}
                      </span>
                    )}
                    {showingFallbackOriginal && (
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/90 text-mt-ink-3">
                        Original (preview)
                      </span>
                    )}
                  </div>
                </div>

                {/* Body — product info + status + actions */}
                <div className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-mt-ink truncate">
                        {row.productName ?? "Untitled"}
                      </p>
                      <p className="text-[11px] text-mt-ink-4 truncate">
                        {(() => {
                          const g = groupByActiveStoreProductId.get(row.storeProductId);
                          if (g && g.variantCount > 1) {
                            const active = g.variants.find(v => v.storeProductId === row.storeProductId);
                            return active?.colorName ?? row.productSku ?? "—";
                          }
                          return row.productSku ?? "—";
                        })()}
                      </p>
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  {/* Phase 8 — color toggle. Only shown when the group has
                      more than one variant. Clicking a swatch flips the
                      whole card to that variant — image, status, render
                      override, all of it — without remounting. */}
                  {(() => {
                    const g = groupByActiveStoreProductId.get(row.storeProductId);
                    if (!g || g.variantCount <= 1) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {g.variants.map(v => {
                          const hex = v.colorHex ?? colorNameToHex(v.colorName);
                          const isActive = v.storeProductId === row.storeProductId;
                          return (
                            <button
                              key={v.storeProductId}
                              onClick={() => setActiveByGroup(prev => ({ ...prev, [g.styleGroup]: v.storeProductId }))}
                              title={v.colorName ?? "Variant"}
                              aria-label={v.colorName ?? "Variant"}
                              style={
                                hex
                                  ? { backgroundColor: hex }
                                  : v.swatchUrl
                                    ? { backgroundImage: `url(${v.swatchUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                                    : { backgroundColor: "#D4D4D4" }
                              }
                              className={`h-4 w-4 rounded-full transition-all ${
                                isActive
                                  ? "ring-2 ring-offset-1 ring-primary"
                                  : "ring-1 ring-mt-border hover:ring-mt-ink-3"
                              }`}
                            />
                          );
                        })}
                        <span className="text-[10px] text-mt-ink-4 ml-1">
                          {g.matchedCount} of {g.variantCount} match filter
                        </span>
                      </div>
                    );
                  })()}

                  {row.renderPromptAdjustment && (
                    <p className="text-[11px] text-mt-ink-3 italic bg-mt-surface-2 rounded px-2 py-1">
                      “{row.renderPromptAdjustment}”
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
                    {status === "pending_review" && (
                      <button
                        onClick={() => handleApprove(row)}
                        disabled={isBusy}
                        className="flex-1 min-w-[88px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-primary text-white hover:bg-[#4F3BC7] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Approve
                      </button>
                    )}
                    {status !== "rendering" && (
                      <button
                        onClick={() => openReRender(row)}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={12} /> Re-render
                      </button>
                    )}
                    <button
                      onClick={() => openUploadPicker(row)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                    >
                      <Upload size={12} /> Upload Override
                    </button>
                    <button
                      onClick={() => setPlacementTarget(row)}
                      disabled={isBusy || !row.productImageUrl}
                      title={!row.productImageUrl ? "Product has no image" : !row.storeLogoUrl ? "Store has no logo configured — placement coords can still be saved" : "Open visual placement editor"}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                    >
                      <Move size={12} /> Edit Placement
                    </button>
                    {row.renderOverrideUrl && (
                      <button
                        onClick={() => handleRemoveOverride(row)}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                        title="Remove manual override"
                      >
                        <Trash2 size={12} /> Remove Override
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Detail preview modal ────────────────────────────────────────── */}
      {detailTarget && (() => {
        const row = detailTarget;
        const status = deriveStatus(row);
        const isBusy = busyId === row.storeProductId;
        const renderSrc = row.renderOverrideUrl ?? row.renderUrl;
        const isOverride = !!row.renderOverrideUrl;
        const grp = groupByActiveStoreProductId.get(row.storeProductId);
        const variant = grp?.variants.find(v => v.storeProductId === row.storeProductId);
        const closeDetail = () => setDetailTarget(null);
        return (
          <div
            className="fixed inset-0 bg-black/50 z-[10002] flex items-center justify-center p-4 overflow-auto animate-in fade-in duration-200"
            onClick={closeDetail}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-3xl max-h-[95vh] overflow-auto shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-mt-border">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16px] font-bold text-mt-ink truncate">
                    {row.productName ?? "Untitled"}
                  </h3>
                  <p className="text-[12px] text-mt-ink-4 truncate">
                    {[
                      variant?.colorName,
                      row.productSku,
                    ].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <StatusBadge status={status} />
                <button
                  onClick={closeDetail}
                  aria-label="Close"
                  className="text-mt-ink-4 hover:text-mt-ink-2 shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Side-by-side image comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-6">
                <div className="relative aspect-square bg-mt-surface-2 rounded-xl flex items-center justify-center overflow-hidden">
                  {row.productImageUrl ? (
                    <img
                      src={row.productImageUrl}
                      alt={row.productName ?? ""}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <ImageOff size={28} className="text-mt-ink-4" />
                  )}
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/90 text-mt-ink-3">
                    Original
                  </span>
                </div>
                <div className="relative aspect-square bg-mt-surface-2 rounded-xl flex items-center justify-center overflow-hidden">
                  {renderSrc ? (
                    <img
                      src={renderSrc}
                      alt=""
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-[12px] text-mt-ink-4">No render yet</span>
                  )}
                  {renderSrc && (
                    <span
                      className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: isOverride ? "#654BF9" : "rgba(255,255,255,0.92)",
                        color: isOverride ? "#fff" : "#737373",
                      }}
                    >
                      {isOverride ? "Manual Override" : "AI Render"}
                    </span>
                  )}
                </div>
              </div>

              {/* Prompt adjustment */}
              {row.renderPromptAdjustment && (
                <div className="px-6 pb-2">
                  <p className="text-[12px] text-mt-ink-3 italic bg-mt-surface-2 rounded-lg px-3 py-2 border-l-2 border-primary/40">
                    “{row.renderPromptAdjustment}”
                  </p>
                </div>
              )}

              {/* Action buttons — same handlers as the inline card row */}
              <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-mt-border">
                {status === "pending_review" && (
                  <button
                    onClick={() => { closeDetail(); void handleApprove(row); }}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg bg-primary text-white hover:bg-[#4F3BC7] transition-colors disabled:opacity-50"
                  >
                    <Check size={13} /> Approve
                  </button>
                )}
                {status !== "rendering" && (
                  <button
                    onClick={() => { closeDetail(); openReRender(row); }}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={13} /> Re-render
                  </button>
                )}
                <button
                  onClick={() => { closeDetail(); openUploadPicker(row); }}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                >
                  <Upload size={13} /> Upload Override
                </button>
                <button
                  onClick={() => { closeDetail(); setPlacementTarget(row); }}
                  disabled={isBusy || !row.productImageUrl}
                  title={!row.productImageUrl ? "Product has no image" : !row.storeLogoUrl ? "Store has no logo configured — placement coords can still be saved" : "Open visual placement editor"}
                  className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
                >
                  <Move size={13} /> Edit Placement
                </button>
                {row.renderOverrideUrl && (
                  <button
                    onClick={() => { closeDetail(); void handleRemoveOverride(row); }}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50 ml-auto"
                  >
                    <Trash2 size={13} /> Remove Override
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Visual Placement Editor ─────────────────────────────────────── */}
      {placementTarget && placementTarget.productImageUrl && (
        <PlacementEditor
          storeProductId={placementTarget.storeProductId}
          productImageUrl={placementTarget.productImageUrl}
          logoUrl={placementTarget.storeLogoUrl}
          productName={placementTarget.productName ?? "Product"}
          initialPlacement={{
            x:        placementTarget.renderPlacementX        != null ? Number(placementTarget.renderPlacementX)        : null,
            y:        placementTarget.renderPlacementY        != null ? Number(placementTarget.renderPlacementY)        : null,
            width:    placementTarget.renderPlacementWidth    != null ? Number(placementTarget.renderPlacementWidth)    : null,
            height:   placementTarget.renderPlacementHeight   != null ? Number(placementTarget.renderPlacementHeight)   : null,
            rotation: placementTarget.renderPlacementRotation != null ? Number(placementTarget.renderPlacementRotation) : null,
          }}
          onClose={() => setPlacementTarget(null)}
          onSaved={() => { void refetch(); }}
        />
      )}

      {/* ─── Hidden file input for override uploads ─────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* ─── Re-render modal ─────────────────────────────────────────────── */}
      {reRenderTarget && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => !reRenderMut.isPending && setReRenderTarget(null)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-bold text-mt-ink">Re-render product</h3>
              <button
                onClick={() => setReRenderTarget(null)}
                disabled={reRenderMut.isPending}
                className="text-mt-ink-4 hover:text-mt-ink-2 disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-[12px] text-mt-ink-4 mb-4 truncate">
              <span className="font-semibold text-mt-ink-2">{reRenderTarget.productName ?? "Product"}</span>
              {reRenderTarget.productSku && <> · {reRenderTarget.productSku}</>}
            </p>
            <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">
              Prompt adjustment <span className="text-mt-ink-4 font-normal">(optional)</span>
            </label>
            <textarea
              value={reRenderPrompt}
              onChange={e => setReRenderPrompt(e.target.value)}
              placeholder="e.g., Make logo 30% smaller on this product"
              maxLength={500}
              rows={3}
              className="w-full p-3 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none"
            />
            <p className="text-[11px] text-mt-ink-4 mt-1.5">
              Saved with this product, so future re-renders remember your preference.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setReRenderTarget(null)}
                disabled={reRenderMut.isPending}
                className="flex-1 py-2.5 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReRenderSubmit}
                disabled={reRenderMut.isPending}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {reRenderMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {reRenderMut.isPending ? "Queueing…" : "Queue re-render"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
