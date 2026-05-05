/**
 * StoreProductDetailPage — Per-store, per-product management surface.
 *
 * Route: /store-management/:storeId/product/:styleGroup
 *
 * One product family in the context of one store. Lets the distributor
 * tune pricing, inventory, render, and store-level settings for each
 * color variant without leaving the page. Mirrors the Render Manager
 * actions (Approve / Re-render / Upload Override / Edit Placement) so
 * the operator can finish render review on a single PDP without
 * jumping back to the full Renders tab grid.
 *
 * Photo-thumbnail swatch row uses the same dedupeAndSortVariants helper
 * that powers ProductDetail.tsx and the customer-facing StoreProductDetailPage,
 * so swatches render identically across the platform. Variants not yet
 * bound to this store are dimmed + dashed; a CTA replaces the editing
 * sections when one is selected.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc, type RouterOutput } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft, Check, RefreshCw, Upload, Move, Trash2, X,
  Loader2, ImageOff, Package, Star, Hash, AlertTriangle,
  CheckCircle2, Clock, ChevronDown, ChevronUp, Search, Plus,
  Sparkles,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { dedupeAndSortVariants, type SwatchVariant } from "@/lib/variantUtils";
import { PlacementEditor } from "./PlacementEditor";

type RouterVariant = {
  productId: number;
  storeProductId: number | null;
  sku: string | null;
  colorName: string | null;
  colorHex: string | null;
  swatchUrl: string | null;
  imageUrl: string | null;
  basePrice: string | null;
  sizes: string[] | null;
  isPrimary: boolean;
  customPrice: string | null;
  featured: boolean;
  sortOrder: number;
  trackInventory: boolean;
  stockQuantity: number | null;
  divisionIds: number[] | null;
  webstoreRenderedImageUrl: string | null;
  webstoreRenderStatus: "pending" | "rendering" | "complete" | "failed" | null;
  webstoreRenderedAt: Date | string | null;
  renderApproved: boolean;
  renderApprovedAt: Date | string | null;
  renderOverrideUrl: string | null;
  renderPromptAdjustment: string | null;
  renderPlacementX: string | null;
  renderPlacementY: string | null;
  renderPlacementWidth: string | null;
  renderPlacementHeight: string | null;
  renderPlacementRotation: string | null;
  effectiveRenderStatus:
    | "pending" | "rendering" | "complete" | "failed" | "awaiting_analysis" | null;
};

const SWATCH_LIMIT = 8;

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

function deriveRenderStatus(v: RouterVariant): "approved" | "pending_review" | "rendering" | "failed" | "no_render" | "awaiting_analysis" {
  if (v.renderApproved) return "approved";
  if (v.webstoreRenderStatus === "rendering") return "rendering";
  if (v.webstoreRenderStatus === "failed") return "failed";
  if (v.webstoreRenderStatus === "complete") return "pending_review";
  if (v.effectiveRenderStatus === "awaiting_analysis") return "awaiting_analysis";
  return "no_render";
}

function StatusBadge({ status, compact = false }: { status: ReturnType<typeof deriveRenderStatus>; compact?: boolean }) {
  const map = {
    approved:           { label: "Approved",         icon: CheckCircle2,  bg: "#F0FDF4", fg: "#16A34A" },
    pending_review:     { label: "Pending Review",   icon: Clock,         bg: "#FEF3C7", fg: "#D97706" },
    rendering:          { label: "Rendering",        icon: Loader2,       bg: "#EFF6FF", fg: "#2563EB" },
    failed:             { label: "Render Failed",    icon: AlertTriangle, bg: "#FEF2F2", fg: "#DC2626" },
    awaiting_analysis:  { label: "Awaiting Analysis",icon: Clock,         bg: "#F5F5F5", fg: "#737373" },
    no_render:          { label: "No Render Yet",    icon: ImageOff,      bg: "#F5F5F5", fg: "#737373" },
  } as const;
  const v = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
      style={{ backgroundColor: v.bg, color: v.fg }}
    >
      <v.icon size={compact ? 10 : 12} className={status === "rendering" ? "animate-spin" : ""} />
      {v.label}
    </span>
  );
}

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-mt-border p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-mt-ink">{title}</h2>
          {description && (
            <p className="text-[12px] text-mt-ink-3 mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Photo-thumbnail swatch — w-12 h-12 rounded-lg image preview, mirroring
 * ProductDetail.tsx and the customer webstore PDP. The "in store" overlay
 * is a 4px green check badge in the bottom-right; "not in store" dims the
 * swatch to 40% opacity and swaps the solid border for a dashed border.
 */
function PhotoSwatch({
  variant,
  selected,
  inStore,
  onClick,
}: {
  variant: SwatchVariant;
  selected: boolean;
  inStore: boolean;
  onClick: () => void;
}) {
  const thumb = variant.imageUrl;
  const hex = variant.colorHex;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${variant.colorName ?? "Variant"}${inStore ? "" : " (not in store)"}`}
      aria-label={variant.colorName ?? "Variant"}
      className={`group relative w-12 h-12 rounded-lg overflow-hidden cursor-pointer transition-transform duration-150 hover:scale-105 ${
        inStore
          ? "border border-mt-border"
          : "border-2 border-dashed border-mt-border-2 opacity-40 hover:opacity-80"
      } ${
        selected
          ? "ring-2 ring-offset-2 ring-primary"
          : "hover:ring-1 hover:ring-offset-1 hover:ring-mt-ink-3"
      }`}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={variant.colorName ?? "Variant"}
          draggable={false}
          className="w-full h-full object-cover"
        />
      ) : hex ? (
        <div className="w-full h-full" style={{ backgroundColor: hex }} />
      ) : (
        <div className="w-full h-full bg-mt-surface-2 text-mt-ink-3 text-xs font-semibold flex items-center justify-center">
          ?
        </div>
      )}
      {inStore && (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-[#16A34A] border-2 border-white flex items-center justify-center shadow-sm"
        >
          <Check size={7} className="text-white" strokeWidth={4} />
        </span>
      )}
    </button>
  );
}

export default function StoreProductDetailPage() {
  const [, params] = useRoute("/store-management/:id/product/:styleGroup");
  const [, navigate] = useLocation();
  const storeIdRaw = params?.id || "";
  const styleGroup = decodeURIComponent(params?.styleGroup || "");
  const storeId = parseInt(storeIdRaw, 10);
  const isNumeric = Number.isFinite(storeId) && storeId > 0;

  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.stores.getStoreProductGroup.useQuery(
    { storeId, styleGroup },
    { enabled: isNumeric && styleGroup.length > 0 },
  );

  const refetch = async () =>
    utils.stores.getStoreProductGroup.invalidate({ storeId, styleGroup });

  const [activeProductId, setActiveProductId] = useState<number | null>(null);
  useEffect(() => {
    if (data && activeProductId == null) {
      // Default to the primary if it's in store; otherwise the first
      // in-store variant; otherwise the primary.
      const inStorePrimary = data.variants.find(v => v.isPrimary && v.storeProductId != null);
      const firstInStore = data.variants.find(v => v.storeProductId != null);
      const primary = data.variants.find(v => v.isPrimary) ?? data.variants[0];
      const pick = inStorePrimary ?? firstInStore ?? primary;
      if (pick) setActiveProductId(pick.productId);
    }
  }, [data, activeProductId]);

  const activeVariant = useMemo<RouterVariant | null>(
    () => (data?.variants.find(v => v.productId === activeProductId) ?? null) as RouterVariant | null,
    [data, activeProductId],
  );
  const activeInStore = activeVariant?.storeProductId != null;

  // Photo-thumbnail swatch list — dedupe/sort via the shared util so
  // visually identical color variants collapse and sort by hue. We
  // override the dedup key to (imageUrl OR storeProductId) so an
  // in-store and not-in-store variant with the same photo don't fully
  // collapse — the user needs to see both states.
  const dedupedSwatches = useMemo(() => {
    if (!data) return [];
    const list: SwatchVariant[] = data.variants.map(v => ({
      productId: v.productId,
      colorName: v.colorName,
      colorHex: v.colorHex,
      swatchUrl: v.swatchUrl,
      imageUrl: v.imageUrl,
    }));
    return dedupeAndSortVariants(
      list,
      activeProductId ?? -1,
      v => {
        const meta = data.variants.find(x => x.productId === v.productId);
        const inStore = meta?.storeProductId != null;
        return v.imageUrl ? `${inStore ? "in" : "out"}::${v.imageUrl}` : null;
      },
    );
  }, [data, activeProductId]);

  const [swatchExpanded, setSwatchExpanded] = useState(false);
  const visibleSwatches = swatchExpanded
    ? dedupedSwatches
    : dedupedSwatches.slice(0, SWATCH_LIMIT);
  const hiddenSwatchCount = Math.max(0, dedupedSwatches.length - SWATCH_LIMIT);

  // ─── Pricing edit state ──────────────────────────────────────────────────
  const [priceDraft, setPriceDraft] = useState("");
  const [priceDirty, setPriceDirty] = useState(false);
  useEffect(() => {
    if (activeVariant) {
      setPriceDraft(activeVariant.customPrice ?? activeVariant.basePrice ?? "");
      setPriceDirty(false);
    }
  }, [activeVariant?.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stockDraft, setStockDraft] = useState("");
  const [stockDirty, setStockDirty] = useState(false);
  useEffect(() => {
    if (activeVariant) {
      setStockDraft(
        activeVariant.stockQuantity != null ? String(activeVariant.stockQuantity) : "",
      );
      setStockDirty(false);
    }
  }, [activeVariant?.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Mutations ───────────────────────────────────────────────────────────
  const updateMut = trpc.stores.updateStoreProduct.useMutation({
    onSuccess: () => {
      void refetch();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const approveMut = trpc.renderManager.approve.useMutation();
  const reRenderMut = trpc.renderManager.reRender.useMutation();
  const uploadOverrideMut = trpc.renderManager.uploadOverride.useMutation();
  const removeOverrideMut = trpc.renderManager.removeOverride.useMutation();
  const retryRenderMut = trpc.stores.retryRender.useMutation();
  const addVariantsMut = trpc.stores.addStoreProductVariants.useMutation();

  const [reRenderOpen, setReRenderOpen] = useState(false);
  const [reRenderPrompt, setReRenderPrompt] = useState("");
  const [placementOpen, setPlacementOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Action handlers ─────────────────────────────────────────────────────
  async function savePrice(value: string | null) {
    if (!activeVariant) return;
    await updateMut.mutateAsync({
      storeId,
      productId: activeVariant.productId,
      customPrice: value,
    });
    setPriceDirty(false);
  }

  async function saveStock() {
    if (!activeVariant) return;
    const parsed = stockDraft.trim().length > 0 ? parseInt(stockDraft, 10) : null;
    await updateMut.mutateAsync({
      storeId,
      productId: activeVariant.productId,
      stockQuantity: Number.isFinite(parsed as number) ? (parsed as number) : null,
    });
    setStockDirty(false);
  }

  async function toggleTrackInventory(next: boolean) {
    if (!activeVariant) return;
    await updateMut.mutateAsync({
      storeId,
      productId: activeVariant.productId,
      trackInventory: next,
    });
  }

  async function toggleFeatured(next: boolean) {
    if (!activeVariant) return;
    await updateMut.mutateAsync({
      storeId,
      productId: activeVariant.productId,
      featured: next,
    });
  }

  async function saveSortOrder(value: number) {
    if (!activeVariant) return;
    await updateMut.mutateAsync({
      storeId,
      productId: activeVariant.productId,
      sortOrder: value,
    });
  }

  async function approveRender() {
    if (!activeVariant?.storeProductId) return;
    try {
      await approveMut.mutateAsync({ storeProductId: activeVariant.storeProductId });
      await refetch();
      toast.success("Render approved — now live on webstore");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve");
    }
  }

  async function generateRender() {
    if (!activeVariant) return;
    try {
      const res = await retryRenderMut.mutateAsync({ storeId, productId: activeVariant.productId });
      await refetch();
      toast.success(
        res.action === "analyzing"
          ? "Analyzing first — render will queue automatically"
          : "Render queued",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate render");
    }
  }

  async function submitReRender() {
    if (!activeVariant?.storeProductId) return;
    try {
      await reRenderMut.mutateAsync({
        storeProductId: activeVariant.storeProductId,
        promptAdjustment: reRenderPrompt,
      });
      setReRenderOpen(false);
      setReRenderPrompt("");
      await refetch();
      toast.success("Re-render queued", {
        description: "Typically completes in 30-60 seconds.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue re-render");
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeVariant?.storeProductId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Override image must be 5MB or smaller");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use a JPG, PNG, or WebP image");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      await uploadOverrideMut.mutateAsync({
        storeProductId: activeVariant.storeProductId,
        imageBase64: base64,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        fileName: file.name,
      });
      await refetch();
      toast.success("Override uploaded and approved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload override");
    }
  }

  async function handleRemoveOverride() {
    if (!activeVariant?.storeProductId) return;
    try {
      const result = await removeOverrideMut.mutateAsync({
        storeProductId: activeVariant.storeProductId,
      });
      await refetch();
      toast.success(
        result.fallbackHasAiRender
          ? "Override removed — showing AI render"
          : "Override removed",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove override");
    }
  }

  // Add the active not-in-store variant to this store. The optional
  // `withRender` flag triggers analysis + render fan-out (lazy
  // analysis fires automatically for un-analyzed products either way).
  async function addVariantToStore(withRender: boolean) {
    if (!activeVariant) return;
    try {
      const result = await addVariantsMut.mutateAsync({
        storeId,
        productIds: [activeVariant.productId],
        enqueueRender: withRender,
      });
      await refetch();
      if (result.added > 0) {
        toast.success(
          withRender
            ? "Added to store · render queued"
            : "Added to store",
        );
      } else {
        toast.info("Already in this store");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add to store");
    }
  }

  // ─── Loading / error / not-found ─────────────────────────────────────────
  if (!isNumeric) {
    return (
      <DashboardLayout title="Invalid store" subtitle="">
        <div className="bg-white rounded-xl border border-mt-border p-12 text-center">
          <AlertTriangle size={28} className="mx-auto text-mt-ink-4 mb-3" />
          <p className="text-[14px] text-mt-ink-2">Invalid store identifier.</p>
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout title="" subtitle="">
        <DetailSkeleton onBack={() => navigate(`/store-management/${storeId}`)} />
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout title="Product not found" subtitle="">
        <div className="bg-white rounded-xl border border-mt-border p-12 text-center">
          <Package size={28} className="mx-auto text-mt-ink-4 mb-3" />
          <p className="text-[14px] text-mt-ink-2 mb-4">
            We couldn’t find this product in this store.
          </p>
          <button
            onClick={() => navigate(`/store-management/${storeId}`)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150"
          >
            <ArrowLeft size={13} /> Back to store
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const status = activeVariant ? deriveRenderStatus(activeVariant) : "no_render";
  const renderSrc =
    activeVariant?.renderOverrideUrl ?? activeVariant?.webstoreRenderedImageUrl ?? null;
  const isOverride = !!activeVariant?.renderOverrideUrl;
  const heroImage = (activeInStore ? renderSrc : null) ?? activeVariant?.imageUrl ?? data.primary.imageUrl;

  const customPriceVaries =
    activeVariant?.customPrice != null &&
    activeVariant.customPrice !== activeVariant.basePrice;

  const inStoreCount = data.variants.filter(v => v.storeProductId != null).length;

  return (
    <DashboardLayout title="" subtitle="">
      {/* Hidden file input shared by override upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <button
          onClick={() => navigate(`/store-management/${storeId}`)}
          className="inline-flex items-center gap-1.5 text-[12px] text-mt-ink-4 hover:text-mt-ink-2 transition-colors duration-150 mb-4"
        >
          <ArrowLeft size={14} /> Back to {data.storeName}
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
          {/* Hero image */}
          <div className="bg-white rounded-2xl border border-mt-border overflow-hidden">
            <div className="aspect-square w-full bg-mt-surface-2 flex items-center justify-center relative">
              {heroImage ? (
                <img
                  src={heroImage}
                  alt={data.primary.name}
                  draggable={false}
                  className="w-full h-full object-contain"
                />
              ) : (
                <ImageOff size={32} className="text-mt-ink-4" />
              )}
              {activeInStore && isOverride && (
                <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary text-white">
                  Manual Override
                </span>
              )}
              {activeInStore && !isOverride && renderSrc && (
                <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/95 text-mt-ink-3">
                  AI Render
                </span>
              )}
              {!activeInStore && (
                <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/95 text-mt-ink-3 inline-flex items-center gap-1">
                  <Plus size={10} /> Not in this store
                </span>
              )}
            </div>
          </div>

          {/* Product meta */}
          <div className="flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                {data.primary.supplier && (
                  <p className="text-[11px] uppercase tracking-wider text-mt-ink-4 mb-1.5">
                    {data.primary.supplier}
                  </p>
                )}
                <h1 className="text-[24px] font-semibold text-mt-ink leading-tight">
                  {data.primary.name}
                </h1>
                <div className="flex items-center gap-2 mt-2.5">
                  {data.primary.category && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mt-surface-2 text-mt-ink-3 uppercase tracking-wider">
                      {data.primary.category}
                    </span>
                  )}
                  <span className="text-[11px] text-mt-ink-4">
                    {inStoreCount} of {data.variantCount} colors in store
                  </span>
                </div>
              </div>
              {activeInStore ? <StatusBadge status={status} /> : null}
            </div>

            {/* Photo-thumbnail swatch row */}
            {dedupedSwatches.length > 0 && (
              <div className="mt-4 mb-2 bg-white rounded-2xl border border-mt-border p-4">
                <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-[0.05em] mb-3">
                  Color · {dedupedSwatches.length}
                </p>
                <div
                  className="flex flex-wrap gap-2 p-1 overflow-hidden transition-[max-height] duration-300 ease-out"
                  style={{ maxHeight: swatchExpanded ? 2000 : 240 }}
                >
                  {visibleSwatches.map(v => {
                    const meta = data.variants.find(x => x.productId === v.productId);
                    const inStore = meta?.storeProductId != null;
                    return (
                      <PhotoSwatch
                        key={v.productId}
                        variant={v}
                        selected={v.productId === activeProductId}
                        inStore={inStore}
                        onClick={() => setActiveProductId(v.productId)}
                      />
                    );
                  })}
                  {!swatchExpanded && hiddenSwatchCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSwatchExpanded(true)}
                      aria-label={`Show ${hiddenSwatchCount} more colors`}
                      className="w-12 h-12 rounded-lg bg-mt-surface-2 border border-mt-border text-[11px] font-semibold text-mt-ink-3 flex items-center justify-center cursor-pointer hover:border-mt-ink-3 transition-colors duration-150"
                    >
                      +{hiddenSwatchCount}
                    </button>
                  )}
                </div>
                {activeVariant?.colorName && (
                  <p className="text-[13px] font-medium text-mt-ink-2 mt-3">
                    Color:{" "}
                    <span className="text-mt-ink">{activeVariant.colorName}</span>
                    {activeVariant.sku && (
                      <span className="text-mt-ink-4 font-mono ml-2">
                        · {activeVariant.sku}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      {!activeInStore && activeVariant ? (
        // Not-in-store CTA — replaces the editing sections.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="lg:col-span-2 bg-white rounded-2xl border border-mt-border p-6 sm:p-10">
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-center">
              <div className="aspect-square rounded-xl bg-mt-surface-2 overflow-hidden flex items-center justify-center border border-mt-border">
                {activeVariant.imageUrl ? (
                  <img
                    src={activeVariant.imageUrl}
                    alt={activeVariant.colorName ?? "Variant"}
                    draggable={false}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageOff size={28} className="text-mt-ink-4" />
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-mt-ink-4 mb-1.5">
                  {activeVariant.colorName ?? "Variant"}
                  {activeVariant.sku && (
                    <span className="font-mono ml-2 normal-case tracking-normal">
                      · {activeVariant.sku}
                    </span>
                  )}
                </p>
                <h3 className="text-[20px] font-semibold text-mt-ink leading-tight mb-2">
                  This color is not in this store yet
                </h3>
                <p className="text-[13px] text-mt-ink-3 leading-relaxed mb-5 max-w-md">
                  Add it now to make it available on the storefront. Generating a
                  render also pre-fills the customer-facing product image with
                  your client’s logo applied.
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => addVariantToStore(true)}
                    disabled={addVariantsMut.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-60"
                  >
                    {addVariantsMut.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    Add to Store & Generate Render
                  </button>
                  <button
                    type="button"
                    onClick={() => addVariantToStore(false)}
                    disabled={addVariantsMut.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-mt-border text-mt-ink-2 text-[13px] font-semibold hover:bg-mt-surface-2 transition-colors duration-150 disabled:opacity-60"
                  >
                    <Plus size={14} /> Add to Store
                  </button>
                </div>
              </div>
            </div>
          </section>
          <AllVariantsList
            data={data}
            activeProductId={activeProductId}
            onSelect={setActiveProductId}
          />
        </div>
      ) : (
        // In-store editing sections.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pricing */}
          <Section
            title="Pricing"
            description="Override the catalog price for this product in this store. Reset clears the override."
          >
            {activeVariant ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1.5">
                    Custom Price
                  </label>
                  <div className="flex items-stretch gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-mt-ink-4">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={priceDraft}
                        onChange={(e) => {
                          setPriceDraft(e.target.value);
                          setPriceDirty(true);
                        }}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 text-[13px] font-mono rounded-lg border border-mt-border bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150"
                      />
                    </div>
                    <button
                      onClick={() => savePrice(priceDraft || null)}
                      disabled={!priceDirty || updateMut.isPending}
                      className="px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {updateMut.isPending ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-[11px] text-mt-ink-4">
                      Catalog: ${activeVariant.basePrice ?? "0.00"}
                    </p>
                    {customPriceVaries && (
                      <button
                        type="button"
                        onClick={() => savePrice(null)}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-mt-ink-4">Select a color to edit pricing.</p>
            )}
          </Section>

          {/* Inventory */}
          <Section
            title="Inventory"
            description="Track stock for this variant. Disable to keep unlimited supply."
          >
            {activeVariant ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeVariant.trackInventory}
                    onChange={(e) => toggleTrackInventory(e.target.checked)}
                    className="mt-0.5 rounded border-mt-border accent-primary"
                  />
                  <span>
                    <span className="block text-[13px] font-semibold text-mt-ink">
                      Track inventory
                    </span>
                    <span className="block text-[11px] text-mt-ink-3 mt-0.5">
                      When on, low stock surfaces a warning to the operator and the storefront.
                    </span>
                  </span>
                </label>
                {activeVariant.trackInventory && (
                  <div>
                    <label className="block text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1.5">
                      Stock Quantity
                    </label>
                    <div className="flex items-stretch gap-2">
                      <input
                        type="number"
                        min={0}
                        value={stockDraft}
                        onChange={(e) => {
                          setStockDraft(e.target.value);
                          setStockDirty(true);
                        }}
                        placeholder="0"
                        className="flex-1 px-3 py-2 text-[13px] font-mono rounded-lg border border-mt-border bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150"
                      />
                      <button
                        onClick={saveStock}
                        disabled={!stockDirty || updateMut.isPending}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                    </div>
                    {activeVariant.stockQuantity != null &&
                      activeVariant.stockQuantity < 10 && (
                        <p className="mt-2 text-[11px] font-semibold text-[#D97706] flex items-center gap-1">
                          <AlertTriangle size={11} /> Low stock
                        </p>
                      )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-mt-ink-4">Select a color to manage inventory.</p>
            )}
          </Section>

          {/* Render section */}
          <div className="lg:col-span-2">
            <Section
              title="Render"
              description="The photorealistic render shown on this storefront for this color. Compare against the original and approve to push live."
              action={<StatusBadge status={status} />}
            >
              {!activeVariant ? (
                <p className="text-[12px] text-mt-ink-4">Select a color to manage its render.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative aspect-square bg-mt-surface-2 rounded-xl overflow-hidden flex items-center justify-center">
                      {activeVariant.imageUrl ? (
                        <img
                          src={activeVariant.imageUrl}
                          alt="Original"
                          draggable={false}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <ImageOff size={28} className="text-mt-ink-4" />
                      )}
                      <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/95 text-mt-ink-3">
                        Original
                      </span>
                    </div>
                    <div className="relative aspect-square bg-mt-surface-2 rounded-xl overflow-hidden flex items-center justify-center">
                      {renderSrc ? (
                        <img
                          src={renderSrc}
                          alt="Render"
                          draggable={false}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-[12px] text-mt-ink-4">No render yet</span>
                      )}
                      {renderSrc && (
                        <span
                          className="absolute bottom-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: isOverride ? "#654BF9" : "rgba(255,255,255,0.95)",
                            color: isOverride ? "#fff" : "#737373",
                          }}
                        >
                          {isOverride ? "Manual Override" : "AI Render"}
                        </span>
                      )}
                    </div>
                  </div>

                  {activeVariant.renderPromptAdjustment && (
                    <p className="mt-4 text-[12px] text-mt-ink-3 italic bg-mt-surface-2 rounded-lg px-3 py-2 border-l-2 border-primary/40">
                      “{activeVariant.renderPromptAdjustment}”
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-5">
                    {status === "no_render" && (
                      <button
                        onClick={generateRender}
                        disabled={retryRenderMut.isPending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-50"
                      >
                        {retryRenderMut.isPending ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                        Generate Render
                      </button>
                    )}
                    {status === "pending_review" && (
                      <button
                        onClick={approveRender}
                        disabled={approveMut.isPending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-50"
                      >
                        {approveMut.isPending ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                        Approve
                      </button>
                    )}
                    {status !== "rendering" && status !== "no_render" && (
                      <button
                        onClick={() => {
                          setReRenderPrompt(activeVariant.renderPromptAdjustment ?? "");
                          setReRenderOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-mt-border text-mt-ink-2 text-[12px] font-semibold hover:bg-mt-surface-2 transition-colors duration-150"
                      >
                        <RefreshCw size={13} /> Re-render
                      </button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!activeVariant.storeProductId || uploadOverrideMut.isPending}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-mt-border text-mt-ink-2 text-[12px] font-semibold hover:bg-mt-surface-2 transition-colors duration-150 disabled:opacity-40"
                    >
                      {uploadOverrideMut.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Upload size={13} />
                      )}
                      Upload Override
                    </button>
                    <button
                      onClick={() => setPlacementOpen(true)}
                      disabled={!activeVariant.imageUrl}
                      title={
                        activeVariant.imageUrl
                          ? "Open visual placement editor"
                          : "Product has no image"
                      }
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-mt-border text-mt-ink-2 text-[12px] font-semibold hover:bg-mt-surface-2 transition-colors duration-150 disabled:opacity-40"
                    >
                      <Move size={13} /> Edit Placement
                    </button>
                    {activeVariant.renderOverrideUrl && (
                      <button
                        onClick={handleRemoveOverride}
                        disabled={removeOverrideMut.isPending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[#DC2626] text-[12px] font-semibold hover:bg-[#FEF2F2] transition-colors duration-150 disabled:opacity-50 ml-auto"
                      >
                        <Trash2 size={13} /> Remove Override
                      </button>
                    )}
                  </div>
                </>
              )}
            </Section>
          </div>

          {/* Storefront Settings */}
          <Section
            title="Storefront Settings"
            description="Promote this product to a featured position and tune its sort order."
          >
            {activeVariant ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeVariant.featured}
                    onChange={(e) => toggleFeatured(e.target.checked)}
                    className="mt-0.5 rounded border-mt-border accent-primary"
                  />
                  <span>
                    <span className="text-[13px] font-semibold text-mt-ink flex items-center gap-1.5">
                      <Star size={13} className={activeVariant.featured ? "text-primary fill-primary" : "text-mt-ink-4"} />
                      Featured
                    </span>
                    <span className="block text-[11px] text-mt-ink-3 mt-0.5">
                      Featured products appear at the top of the storefront grid.
                    </span>
                  </span>
                </label>
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Hash size={11} /> Sort Order
                  </label>
                  <input
                    type="number"
                    defaultValue={activeVariant.sortOrder}
                    onBlur={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n) && n !== activeVariant.sortOrder) {
                        void saveSortOrder(n);
                      }
                    }}
                    className="w-32 px-3 py-2 text-[13px] font-mono rounded-lg border border-mt-border bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150"
                  />
                  <p className="text-[11px] text-mt-ink-4 mt-1.5">
                    Lower numbers appear first.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-mt-ink-4">Select a color to edit settings.</p>
            )}
          </Section>

          {/* All Variants list (collapsible + searchable) */}
          <AllVariantsList
            data={data}
            activeProductId={activeProductId}
            onSelect={setActiveProductId}
          />
        </div>
      )}

      {/* ─── Re-render modal ─────────────────────────────────────────────── */}
      {reRenderOpen && activeVariant && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => !reRenderMut.isPending && setReRenderOpen(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-bold text-mt-ink">Re-render product</h3>
              <button
                onClick={() => setReRenderOpen(false)}
                disabled={reRenderMut.isPending}
                className="text-mt-ink-4 hover:text-mt-ink-2 disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-[12px] text-mt-ink-4 mb-4 truncate">
              <span className="font-semibold text-mt-ink-2">{data.primary.name}</span>
              {activeVariant.colorName && <> · {activeVariant.colorName}</>}
            </p>
            <label className="text-[12px] font-semibold text-mt-ink-2 mb-1.5 block">
              Prompt adjustment{" "}
              <span className="text-mt-ink-4 font-normal">(optional)</span>
            </label>
            <textarea
              value={reRenderPrompt}
              onChange={(e) => setReRenderPrompt(e.target.value)}
              placeholder="e.g., Make logo 30% smaller on this product"
              maxLength={500}
              rows={3}
              className="w-full p-3 text-[13px] border border-mt-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150 resize-none"
            />
            <p className="text-[11px] text-mt-ink-4 mt-1.5">
              Saved with this product, so future re-renders remember your preference.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setReRenderOpen(false)}
                disabled={reRenderMut.isPending}
                className="flex-1 py-2.5 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2 transition-colors duration-150 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReRender}
                disabled={reRenderMut.isPending}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {reRenderMut.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {reRenderMut.isPending ? "Queueing…" : "Queue re-render"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Placement editor ────────────────────────────────────────────── */}
      {placementOpen && activeVariant?.imageUrl && activeVariant.storeProductId && (
        <PlacementEditor
          storeProductId={activeVariant.storeProductId}
          productImageUrl={activeVariant.imageUrl}
          logoUrl={data.storeLogoUrl ?? null}
          productName={data.primary.name}
          initialPlacement={{
            x: activeVariant.renderPlacementX != null ? Number(activeVariant.renderPlacementX) : null,
            y: activeVariant.renderPlacementY != null ? Number(activeVariant.renderPlacementY) : null,
            width: activeVariant.renderPlacementWidth != null ? Number(activeVariant.renderPlacementWidth) : null,
            height: activeVariant.renderPlacementHeight != null ? Number(activeVariant.renderPlacementHeight) : null,
            rotation: activeVariant.renderPlacementRotation != null ? Number(activeVariant.renderPlacementRotation) : null,
          }}
          onClose={() => setPlacementOpen(false)}
          onSaved={() => { void refetch(); }}
        />
      )}
    </DashboardLayout>
  );
}

/**
 * Collapsible, searchable list of every variant in the styleGroup. Each
 * row shows a 32px swatch (photo or hex), color/SKU, render status, and
 * an in-store/not-in-store dot. Defaults to collapsed; max-height 400px
 * with overflow scroll keeps it from dominating the page on 80-variant
 * products.
 */
type StoreProductGroupData = RouterOutput["stores"]["getStoreProductGroup"];

function AllVariantsList({
  data,
  activeProductId,
  onSelect,
}: {
  data: StoreProductGroupData;
  activeProductId: number | null;
  onSelect: (productId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.variants;
    return data.variants.filter(v =>
      (v.colorName ?? "").toLowerCase().includes(q) ||
      (v.sku ?? "").toLowerCase().includes(q),
    );
  }, [data.variants, query]);

  return (
    <section className="lg:col-span-2 bg-white rounded-xl border border-mt-border">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 text-left hover:bg-mt-surface-1 transition-colors duration-150 rounded-t-xl"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-mt-ink">
            All Variants{" "}
            <span className="text-mt-ink-4 font-normal">· {data.variantCount}</span>
          </h2>
          <p className="text-[12px] text-mt-ink-3 mt-0.5">
            Every color binding tracks its own render and pricing state.
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-mt-ink-4" />
        ) : (
          <ChevronDown size={16} className="text-mt-ink-4" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-mt-border">
          <div className="px-5 sm:px-6 py-3 border-b border-mt-border">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mt-ink-4" />
              <input
                type="text"
                placeholder="Search by color or SKU..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-150 placeholder:text-[#C4C4C4]"
              />
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-5 sm:px-6 py-8 text-center">
                <p className="text-[12px] text-mt-ink-4">No matches</p>
              </div>
            ) : (
              <ul>
                {filtered.map((v, i) => {
                  const inStore = v.storeProductId != null;
                  const vstat = deriveRenderStatus(v as RouterVariant);
                  const selected = v.productId === activeProductId;
                  return (
                    <li key={v.productId}>
                      <button
                        type="button"
                        onClick={() => onSelect(v.productId)}
                        className={`w-full flex items-center gap-3 px-5 sm:px-6 py-2.5 text-left transition-colors duration-150 ${
                          selected
                            ? "bg-mt-brand-light"
                            : "hover:bg-mt-surface-1"
                        } ${i < filtered.length - 1 ? "border-b border-mt-border" : ""}`}
                      >
                        <span
                          className={`relative h-8 w-8 rounded-lg overflow-hidden flex-shrink-0 ${
                            inStore ? "border border-mt-border" : "border-2 border-dashed border-mt-border-2 opacity-50"
                          }`}
                        >
                          {v.imageUrl ? (
                            <img
                              src={v.imageUrl}
                              alt={v.colorName ?? "Variant"}
                              draggable={false}
                              className="w-full h-full object-cover"
                            />
                          ) : v.colorHex ? (
                            <span
                              className="block w-full h-full"
                              style={{ backgroundColor: v.colorHex }}
                            />
                          ) : (
                            <span className="block w-full h-full bg-mt-surface-2" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-mt-ink truncate">
                            {v.colorName ?? "Variant"}
                          </p>
                          <p className="text-[11px] text-mt-ink-4 font-mono truncate">
                            {v.sku ?? "—"}
                          </p>
                        </div>
                        {inStore ? (
                          <StatusBadge status={vstat} compact />
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-mt-surface-2 text-mt-ink-3">
                            Not in store
                          </span>
                        )}
                        <span
                          aria-label={inStore ? "In store" : "Not in store"}
                          title={inStore ? "In store" : "Not in store"}
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            inStore ? "bg-[#16A34A]" : "bg-[#D4D4D4]"
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[12px] text-mt-ink-4 hover:text-mt-ink-2 transition-colors duration-150 mb-4"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 mb-6">
        <div className="aspect-square rounded-2xl bg-mt-surface-2 animate-pulse" />
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-mt-surface-2 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-mt-surface-2 animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-mt-surface-2 animate-pulse" />
          <div className="flex gap-2 mt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 w-12 rounded-lg bg-mt-surface-2 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-mt-border p-5 sm:p-6 space-y-3">
            <div className="h-4 w-32 rounded bg-mt-surface-2 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-mt-surface-2 animate-pulse" />
            <div className="h-9 w-full rounded bg-mt-surface-2 animate-pulse" />
          </div>
        ))}
      </div>
    </>
  );
}
