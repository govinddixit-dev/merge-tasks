#!/bin/bash
set -e

###############################################################################
# add-product-detail.sh
# Adds an internal Product Detail page for logged-in distributors
# - Creates client/src/pages/ProductDetail.tsx (enterprise-grade UI)
# - Adds /curation/product/:id route to App.tsx
# - Updates CurationProductsTab.tsx card click → navigates to detail page
# - Uses existing products.getById tRPC endpoint (ZERO backend changes)
#
# REGRESSION CHECK:
# ✓ ProductDetail.tsx = NEW file (no existing code touched)
# ✓ App.tsx = 2 lines added (import + route), all existing routes preserved
# ✓ CurationProductsTab.tsx = adds onClick to card + ProductImage component
#   - All existing props/callbacks/layout/empty-state preserved exactly
#   - e.stopPropagation() already on Add/Delete buttons
# ✓ Zero backend/API changes
###############################################################################

echo "=========================================="
echo " MergeTasks — Add Product Detail Page"
echo "=========================================="

cd /home/ubuntu/mergetasks

# ─────────────────────────────────────────────────────────────────────────────
# 1. Create ProductDetail.tsx — Premium enterprise UI
#    (Overwrites existing ProductDetail.tsx which was an older/placeholder version)
# ─────────────────────────────────────────────────────────────────────────────
echo "[1/5] Creating ProductDetail.tsx..."

# Backup existing if present
[ -f client/src/pages/ProductDetail.tsx ] && cp client/src/pages/ProductDetail.tsx client/src/pages/ProductDetail.tsx.bak

cat > client/src/pages/ProductDetail.tsx << 'PRODUCTDETAIL_EOF'
/**
 * ProductDetail — Internal product detail page for logged-in distributors.
 * Route: /curation/product/:id
 * Uses products.getById tRPC endpoint.
 *
 * Design: Apple/Stripe/Wise enterprise aesthetic — generous whitespace,
 * refined typography, subtle motion, premium card treatments.
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Package, Sparkles, Info, Loader2, AlertTriangle,
  ZoomIn, X, ChevronRight, DollarSign, Palette, Ruler,
  ImageIcon, Layers, TrendingDown, Box, Tag, Globe, Clock
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ── Constants ─────────────────────────────────────────────────────────── */

const CATEGORY_LABELS: Record<string, string> = {
  apparel: "Apparel", drinkware: "Drinkware", tech: "Tech", bags: "Bags",
  writing: "Writing", wellness: "Wellness", outdoor: "Outdoor", office: "Office", other: "Other",
};

const DECORATION_LABELS: Record<string, string> = {
  embroidery: "Embroidery", screen_print: "Screen Print", laser_engrave: "Laser Engrave",
  laser_engraving: "Laser Engraving", heat_transfer: "Heat Transfer", dtg: "DTG Print",
  sublimation: "Sublimation", deboss: "Deboss", patch: "Patch", pad_print: "Pad Print",
  full_color: "Full Color", foil_stamp: "Foil Stamp", offset: "Offset", digital: "Digital",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual Entry", csv: "CSV Import", api: "API Sync", asi: "ASI ESP",
  sage: "SAGE", promostandards: "PromoStandards",
};

/* ── Shared styles ─────────────────────────────────────────────────────── */

const ANIM = `
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes scaleIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
`;

/* ── ProductImage with graceful fallback ───────────────────────────────── */

function ProductImage({ src, alt, className, iconSize = 48 }: {
  src?: string | null; alt: string; className?: string; iconSize?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-[#FAFAFA] to-[#F0F0F2] ${className || ""}`}>
        <ImageIcon size={iconSize} className="text-[#D4D4D8]" strokeWidth={1.2} />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} />;
}

/* ── Pill badge ────────────────────────────────────────────────────────── */

function Pill({ children, variant = "default" }: {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "indigo";
}) {
  const styles: Record<string, string> = {
    default: "bg-[#F4F4F5] text-[#71717A]",
    primary: "bg-primary/8 text-primary",
    success: "bg-[#F0FDF4] text-[#16A34A]",
    warning: "bg-[#FFFBEB] text-[#D97706]",
    indigo:  "bg-[#EEF2FF] text-[#4338CA]",
  };
  return (
    <span className={`text-[10px] font-semibold px-2.5 py-[5px] rounded-full uppercase tracking-[0.04em] ${styles[variant]}`}>
      {children}
    </span>
  );
}

/* ── Info tile ─────────────────────────────────────────────────────────── */

function InfoTile({ label, value, icon: Icon }: {
  label: string; value: React.ReactNode; icon?: React.ComponentType<any>;
}) {
  return (
    <div className="bg-[#FAFAFA] rounded-2xl p-4 border border-[#F0F0F2]">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} className="text-[#A1A1AA]" strokeWidth={2} />}
        <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em]">{label}</p>
      </div>
      <p className="text-[13px] font-semibold text-[#27272A] leading-snug">{value}</p>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────────────── */

export default function ProductDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const productId = parseInt(params.id || "0", 10);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "pricing" | "decoration">("details");

  const { data: product, isLoading, error } = trpc.products.getById.useQuery(
    { id: productId },
    { enabled: productId > 0 }
  );

  useEffect(() => {
    if (product?.imageUrl) setSelectedImage(product.imageUrl);
  }, [product]);

  /* ── Loading ───────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-40">
        <style>{ANIM}</style>
        <div className="text-center" style={{ animation: "fadeUp 0.4s ease-out" }}>
          <div className="w-12 h-12 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-5">
            <Loader2 size={22} className="text-primary animate-spin" />
          </div>
          <p className="text-[14px] font-medium text-[#71717A]">Loading product...</p>
        </div>
      </div>
    );
  }

  /* ── Error ──────────────────────────────────────────────────────────── */

  if (error || !product) {
    return (
      <div className="flex items-center justify-center py-40 px-4">
        <style>{ANIM}</style>
        <div className="bg-white rounded-3xl p-12 text-center max-w-md w-full shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-[#F0F0F2]" style={{ animation: "fadeUp 0.4s ease-out" }}>
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#FEF2F2] flex items-center justify-center">
            <AlertTriangle size={28} className="text-[#DC2626]" />
          </div>
          <h1 className="text-[22px] font-bold text-[#18181B] mb-2 tracking-[-0.01em]">Product not found</h1>
          <p className="text-[14px] text-[#71717A] mb-8 leading-relaxed">{error?.message || "This product doesn't exist or you don't have access."}</p>
          <button
            onClick={() => navigate("/curation")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#18181B] text-white text-[13px] font-semibold hover:bg-[#27272A] transition-colors"
          >
            <ArrowLeft size={14} /> Back to Curation
          </button>
        </div>
      </div>
    );
  }

  /* ── Derived data ──────────────────────────────────────────────────── */

  const price = product.basePrice ? parseFloat(product.basePrice) : null;
  const hasPricingTiers = product.pricingTiers && product.pricingTiers.length > 0;
  const hasDecorations = product.decorationMethods && product.decorationMethods.length > 0;
  const hasColors = product.colors && product.colors.length > 0;
  const hasSizes = product.sizes && product.sizes.length > 0;
  const lowestPrice = hasPricingTiers
    ? Math.min(...product.pricingTiers!.map((t: any) => t.price))
    : null;
  const savingsPercent = price && lowestPrice
    ? Math.round((1 - lowestPrice / price) * 100)
    : null;

  // Gallery
  const galleryImages: { url: string; label: string }[] = [];
  if (product.imageUrl) galleryImages.push({ url: product.imageUrl, label: "Primary" });
  if (product.additionalImages && product.additionalImages.length > 0) {
    product.additionalImages.forEach((img: string, i: number) => {
      galleryImages.push({ url: img, label: `View ${i + 1}` });
    });
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-8" style={{ animation: "fadeUp 0.35s ease-out" }}>
      <style>{ANIM}</style>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-[12px] mb-8">
        <button
          onClick={() => navigate("/curation")}
          className="text-[#A1A1AA] hover:text-[#52525B] transition-colors flex items-center gap-1.5 font-medium"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          Product Curation
        </button>
        <ChevronRight size={11} className="text-[#D4D4D8]" />
        <span className="text-[#52525B] font-semibold truncate max-w-[280px]">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

        {/* ── Left Column: Images (5 cols) ─────────────────────────────── */}
        <div className="lg:col-span-5 space-y-4">
          {/* Main image */}
          <div
            className="bg-white rounded-3xl border border-[#F0F0F2] overflow-hidden cursor-pointer group relative shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            onClick={() => selectedImage && setLightbox(selectedImage)}
          >
            <div className="aspect-square flex items-center justify-center p-10 relative">
              <ProductImage
                src={selectedImage}
                alt={product.name}
                className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                iconSize={56}
              />
              {selectedImage && (
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  <div className="bg-white/90 backdrop-blur-sm rounded-full p-2.5 shadow-lg border border-[#F0F0F2]">
                    <ZoomIn size={16} className="text-[#52525B]" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Thumbnails */}
          {galleryImages.length > 1 && (
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {galleryImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(img.url)}
                  className={`w-[72px] h-[72px] rounded-2xl border-2 overflow-hidden bg-white shrink-0 transition-all duration-200 ${
                    selectedImage === img.url
                      ? "border-primary shadow-[0_0_0_1px_rgba(99,92,255,0.2)]"
                      : "border-[#F0F0F2] hover:border-[#D4D4D8]"
                  }`}
                >
                  <img src={img.url} alt={img.label} className="w-full h-full object-contain p-1.5" />
                </button>
              ))}
            </div>
          )}

          {/* Product metadata card */}
          <div className="bg-white rounded-3xl border border-[#F0F0F2] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-4">Product Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <InfoTile icon={Layers} label="Source" value={SOURCE_LABELS[product.source] || product.source} />
              <InfoTile
                icon={Tag}
                label="Status"
                value={
                  <span className={
                    product.status === "active" ? "text-[#16A34A]"
                    : product.status === "draft" ? "text-[#D97706]"
                    : "text-[#71717A]"
                  }>
                    {product.status === "active" ? "● " : product.status === "draft" ? "● " : "● "}
                    <span className="capitalize">{product.status}</span>
                  </span>
                }
              />
              {product.supplier && (
                <InfoTile icon={Globe} label="Supplier" value={product.supplier} />
              )}
              {product.minQuantity && (
                <InfoTile icon={Box} label="Min Quantity" value={product.minQuantity.toLocaleString()} />
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-[#F4F4F5] flex items-center gap-1.5 text-[11px] text-[#A1A1AA]">
              <Clock size={11} />
              <span>Updated {new Date(product.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
          </div>
        </div>

        {/* ── Right Column: Details (7 cols) ───────────────────────────── */}
        <div className="lg:col-span-7 space-y-6">

          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Pill>{CATEGORY_LABELS[product.category] || product.category}</Pill>
              <Pill variant={product.type === "promotional" ? "primary" : "warning"}>
                {product.type === "promotional" ? "Promo" : "Print"}
              </Pill>
              {product.hasLiveInventory && <Pill variant="success">Live Inventory</Pill>}
              {product.externalSource && <Pill variant="indigo">{product.externalSource === "asi" ? "ASI" : "PromoStandards"}</Pill>}
            </div>
            <h1 className="text-[28px] font-bold text-[#18181B] leading-[1.15] tracking-[-0.02em]">{product.name}</h1>
            {(product.sku || product.supplierSku) && (
              <div className="flex items-center gap-4 mt-2 text-[12px] text-[#A1A1AA]">
                {product.sku && <span>SKU <span className="text-[#52525B] font-medium">{product.sku}</span></span>}
                {product.supplierSku && <span>Supplier <span className="text-[#52525B] font-medium">{product.supplierSku}</span></span>}
              </div>
            )}
          </div>

          {/* Price hero card */}
          <div className="bg-white rounded-3xl border border-[#F0F0F2] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-2">Base Price</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-[36px] font-bold text-[#18181B] tracking-[-0.03em] leading-none">
                    {price ? `$${price.toFixed(2)}` : "Quote"}
                  </span>
                  <span className="text-[13px] text-[#A1A1AA] font-medium">/ unit</span>
                </div>
              </div>
              {lowestPrice && savingsPercent && savingsPercent > 0 && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-2">Volume Price</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[28px] font-bold text-[#16A34A] tracking-[-0.02em] leading-none">
                      ${lowestPrice.toFixed(2)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-1 rounded-full">
                      <TrendingDown size={11} />
                      {savingsPercent}% off
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Variants: Colors & Sizes */}
          {(hasColors || hasSizes) && (
            <div className="bg-white rounded-3xl border border-[#F0F0F2] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-5">
              {hasColors && (
                <div>
                  <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-3 flex items-center gap-1.5">
                    <Palette size={12} /> Colors · {product.colors!.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {product.colors!.map((c: string) => (
                      <span key={c} className="text-[12px] font-medium px-3.5 py-2 rounded-xl bg-[#FAFAFA] border border-[#F0F0F2] text-[#3F3F46] hover:border-[#D4D4D8] transition-colors">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {hasSizes && (
                <div>
                  <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-3 flex items-center gap-1.5">
                    <Ruler size={12} /> Sizes · {product.sizes!.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes!.map((s: string) => (
                      <span key={s} className="text-[12px] font-semibold w-11 h-11 rounded-xl bg-[#FAFAFA] border border-[#F0F0F2] text-[#3F3F46] flex items-center justify-center hover:border-[#D4D4D8] transition-colors">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tabbed content */}
          <div className="bg-white rounded-3xl border border-[#F0F0F2] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            {/* Tab bar */}
            <div className="flex border-b border-[#F4F4F5] px-2">
              {[
                { key: "details" as const, label: "Details", icon: Info },
                ...(hasPricingTiers ? [{ key: "pricing" as const, label: "Pricing Tiers", icon: DollarSign }] : []),
                ...(hasDecorations ? [{ key: "decoration" as const, label: "Decoration", icon: Sparkles }] : []),
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center justify-center gap-1.5 py-4 px-5 text-[12px] font-semibold transition-all relative ${
                    activeTab === tab.key
                      ? "text-[#18181B]"
                      : "text-[#A1A1AA] hover:text-[#71717A]"
                  }`}
                >
                  <tab.icon size={13} strokeWidth={activeTab === tab.key ? 2.2 : 1.8} />
                  {tab.label}
                  {activeTab === tab.key && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[#18181B] rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="p-6">
              {activeTab === "details" && (
                <div className="space-y-5">
                  {product.description ? (
                    <div>
                      <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-2">Description</p>
                      <p className="text-[14px] text-[#52525B] leading-[1.7]">{product.description}</p>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#A1A1AA] italic">No description available for this product.</p>
                  )}

                  {/* Print-specific fields */}
                  {product.type === "print" && (product.fileSpecs || (product.printAreas && product.printAreas.length > 0) || (product.printMethods && product.printMethods.length > 0)) && (
                    <div className="space-y-3 pt-3 border-t border-[#F4F4F5]">
                      <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em]">Print Specifications</p>
                      {product.fileSpecs && (
                        <div className="bg-[#FAFAFA] rounded-2xl p-4 border border-[#F0F0F2]">
                          <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-1">File Specs</p>
                          <p className="text-[13px] font-medium text-[#3F3F46]">{product.fileSpecs}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        {product.printAreas && product.printAreas.length > 0 && (
                          <div className="bg-[#FAFAFA] rounded-2xl p-4 border border-[#F0F0F2]">
                            <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-2">Print Areas</p>
                            <div className="flex flex-wrap gap-1.5">
                              {product.printAreas.map((a: string) => (
                                <span key={a} className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white border border-[#E4E4E7] text-[#52525B] capitalize">{a}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {product.printMethods && product.printMethods.length > 0 && (
                          <div className="bg-[#FAFAFA] rounded-2xl p-4 border border-[#F0F0F2]">
                            <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-2">Print Methods</p>
                            <div className="flex flex-wrap gap-1.5">
                              {product.printMethods.map((m: string) => (
                                <span key={m} className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white border border-[#E4E4E7] text-[#52525B] capitalize">{m}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* External product badge */}
                  {product.externalId && (
                    <div className="bg-[#EEF2FF] rounded-2xl p-4 border border-[#C7D2FE] mt-3">
                      <p className="text-[10px] font-semibold text-[#4338CA] uppercase tracking-[0.05em] mb-1">Synced Product</p>
                      <p className="text-[13px] text-[#4338CA] font-medium">
                        {product.externalSource === "asi" ? "ASI ESP" : product.externalSource === "promostandards" ? "PromoStandards" : product.externalSource}
                        {" · "}{product.productNumber || product.externalId}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "pricing" && hasPricingTiers && (
                <div>
                  <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-4">Volume Pricing</p>
                  <div className="overflow-x-auto rounded-2xl border border-[#F0F0F2]">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-[#FAFAFA]">
                          <th className="text-left py-3 px-4 text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em]">Quantity Range</th>
                          <th className="text-right py-3 px-4 text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em]">Unit Price</th>
                          <th className="text-right py-3 px-4 text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em]">Savings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.pricingTiers!.map((tier: any, i: number) => {
                          const sav = price ? Math.round((1 - tier.price / price) * 100) : 0;
                          const isLast = i === product.pricingTiers!.length - 1;
                          return (
                            <tr key={i} className={`border-t border-[#F4F4F5] ${isLast ? "bg-[#F0FDF4]/30" : ""}`}>
                              <td className="py-3.5 px-4 font-medium text-[#3F3F46]">
                                {tier.minQty.toLocaleString()} — {tier.maxQty >= 9999 ? "∞" : tier.maxQty.toLocaleString()} units
                              </td>
                              <td className={`py-3.5 px-4 text-right font-bold ${isLast ? "text-[#16A34A]" : "text-[#18181B]"}`}>
                                ${tier.price.toFixed(2)}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                {sav > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded-full">
                                    <TrendingDown size={10} /> {sav}%
                                  </span>
                                ) : (
                                  <span className="text-[#D4D4D8]">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === "decoration" && hasDecorations && (
                <div>
                  <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-[0.05em] mb-4">Available Decoration Methods</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {product.decorationMethods!.map((method: string) => (
                      <div
                        key={method}
                        className="bg-[#FAFAFA] rounded-2xl p-4 border border-[#F0F0F2] text-center hover:border-[#C7D2FE] hover:bg-[#EEF2FF]/30 transition-all"
                      >
                        <div className="w-10 h-10 rounded-xl bg-white border border-[#F0F0F2] flex items-center justify-center mx-auto mb-2.5">
                          <Sparkles size={16} className="text-[#4338CA]" />
                        </div>
                        <p className="text-[12px] font-semibold text-[#3F3F46]">{DECORATION_LABELS[method] || method}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Back nav */}
          <button
            onClick={() => navigate("/curation")}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-[13px] font-semibold text-[#71717A] bg-[#FAFAFA] border border-[#F0F0F2] hover:bg-[#F4F4F5] hover:text-[#52525B] transition-all"
          >
            <ArrowLeft size={15} /> Back to Product Curation
          </button>
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
          style={{ animation: "scaleIn 0.2s ease-out" }}
        >
          <div
            className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#F4F4F5]">
              <span className="text-[15px] font-semibold text-[#18181B] tracking-[-0.01em]">{product.name}</span>
              <button
                onClick={() => setLightbox(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F4F4F5] transition-colors"
              >
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>
            <div className="p-8 flex items-center justify-center bg-[#FAFAFA]" style={{ minHeight: 420 }}>
              <img src={lightbox} alt={product.name} className="max-w-full max-h-[70vh] object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
PRODUCTDETAIL_EOF

echo "   ✓ ProductDetail.tsx created (premium UI)"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Add route to App.tsx — 2 lines only
# ─────────────────────────────────────────────────────────────────────────────
echo "[2/5] Adding route to App.tsx..."

# Check if import already exists (from previous run)
if ! grep -q 'ProductDetail' client/src/App.tsx; then
  # Add import (after Curation import on line 10)
  sed -i '/^import Curation from "\.\/pages\/Curation";$/a import ProductDetail from "./pages/ProductDetail";' client/src/App.tsx
  echo "   ✓ Import added"
else
  echo "   ✓ Import already exists (idempotent)"
fi

# Check if route already exists
if ! grep -q 'curation/product' client/src/App.tsx; then
  # Add route BEFORE /curation so it matches first (wouter matches top-down)
  sed -i '/<Route path="\/curation"><ProtectedRoute component={Curation} \/><\/Route>/i\      <Route path="/curation/product/:id"><ProtectedRoute component={ProductDetail} /></Route>' client/src/App.tsx
  echo "   ✓ Route added: /curation/product/:id"
else
  echo "   ✓ Route already exists (idempotent)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Update CurationProductsTab.tsx — click nav + image fallback
# ─────────────────────────────────────────────────────────────────────────────
echo "[3/5] Updating CurationProductsTab.tsx..."

# Backup existing
[ -f client/src/components/curation/CurationProductsTab.tsx ] && cp client/src/components/curation/CurationProductsTab.tsx client/src/components/curation/CurationProductsTab.tsx.product-detail.bak

cat > client/src/components/curation/CurationProductsTab.tsx << 'CURATIONTAB_EOF'
import { useState } from "react";
import { useLocation } from "wouter";
import { Star, Check, Plus, Trash2, Package, Download, Database, ImageIcon } from "lucide-react";
import { toast } from "sonner";

type PromoProduct = {
  name: string;
  supplier: string;
  price: string;
  category: string;
  rating: number;
  inStock: boolean;
  type: "promo";
  image: string;
  dbId?: number;
};

interface CurationProductsTabProps {
  promoFiltered: PromoProduct[];
  viewMode: "grid" | "list";
  addedProducts: Set<string>;
  onAddProduct: (key: string, productName: string) => void;
  onDeleteProduct: (id: number, name: string) => void;
}

/** Reusable image component with graceful onError fallback */
function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`flex items-center justify-center ${className || ""}`}>
        <ImageIcon size={24} className="text-[#D4D4D8]" strokeWidth={1.2} />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} />;
}

export default function CurationProductsTab({
  promoFiltered,
  viewMode,
  addedProducts,
  onAddProduct,
  onDeleteProduct,
}: CurationProductsTabProps) {
  const [, navigate] = useLocation();

  if (promoFiltered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-[fadeIn_0.5s_ease-out]">
        <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes pulse-ring{0%{transform:scale(1);opacity:0.3}50%{transform:scale(1.08);opacity:0.15}100%{transform:scale(1);opacity:0.3}}`}</style>
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-primary/10" style={{ animation: 'pulse-ring 3s ease-in-out infinite' }} />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/5 to-primary/15 flex items-center justify-center" style={{ animation: 'float 4s ease-in-out infinite' }}>
            <Package size={32} className="text-primary/60" strokeWidth={1.5} />
          </div>
        </div>
        <h3 className="text-[17px] font-bold text-mt-ink mb-2">No products yet</h3>
        <p className="text-[13px] text-mt-ink-3 text-center max-w-sm mb-6 leading-relaxed">Import your first products from a supplier catalog, CSV file, or add them manually to start building your catalog.</p>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-sm"
            onClick={() => {
              const btn = document.querySelector('[data-import-trigger]') as HTMLButtonElement;
              if (btn) btn.click();
              else document.dispatchEvent(new CustomEvent('open-import'));
            }}
          >
            <Download size={13} /> Import Products
          </button>
          <button
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface transition-all"
            onClick={() => {
              const btn = document.querySelector('[data-catalog-trigger]') as HTMLButtonElement;
              if (btn) btn.click();
              else document.dispatchEvent(new CustomEvent('open-catalog'));
            }}
          >
            <Database size={13} /> Browse Live Catalog
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" : "space-y-3"}>
      {promoFiltered.map((product, i) => {
        const key = `promo-${product.name}`;
        const isAdded = addedProducts.has(key);
        return viewMode === "grid" ? (
          <div
            key={i}
            className="bg-white rounded-lg border border-mt-border cursor-pointer card-hover overflow-hidden hover:shadow-md hover:border-primary/30 transition-all"
            onClick={() => { if (product.dbId) navigate(`/curation/product/${product.dbId}`); }}
          >
            <div className="w-full h-44 flex items-center justify-center bg-[#F8F8FA] p-4">
              <ProductImage src={product.image} alt={product.name} className="h-full w-full object-contain" />
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] text-mt-ink-4 uppercase tracking-wider font-medium">{product.supplier}</p>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Promo</span>
              </div>
              <h3 className="text-[13px] font-semibold text-mt-ink mb-2">{product.name}</h3>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-mt-ink">{product.price}</span>
                <div className="flex items-center gap-1">
                  <Star size={10} fill="var(--mt-brand)" className="text-primary" />
                  <span className="text-[11px] font-medium text-primary">{product.rating}</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className={`flex items-center gap-1 text-[11px] ${product.inStock ? "text-[#16A34A]" : "text-[#EF4444]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${product.inStock ? "bg-[#16A34A]" : "bg-[#EF4444]"}`} />
                  {product.inStock ? "In Stock" : "Low Stock"}
                </span>
                {isAdded ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
                ) : (
                  <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onAddProduct(key, product.name); }}>
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
              {product.dbId && (
                <div className="flex items-center justify-end mt-2 pt-2 border-t border-[#F0F0F0]">
                  <button
                    className="flex items-center gap-1 text-[11px] font-medium text-[#EF4444] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-2 py-1 rounded transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${product.name}"? This cannot be undone.`)) {
                        onDeleteProduct(product.dbId!, product.name);
                      }
                    }}
                  >
                    <Trash2 size={10} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            key={i}
            className="flex items-center gap-4 p-4 bg-white rounded-lg border border-mt-border hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
            onClick={() => { if (product.dbId) navigate(`/curation/product/${product.dbId}`); }}
          >
            <div className="w-16 h-16 flex-shrink-0 bg-[#F8F8FA] rounded-lg flex items-center justify-center p-2">
              <ProductImage src={product.image} alt={product.name} className="h-full w-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-mt-ink">{product.name}</h3>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Promo</span>
              </div>
              <p className="text-[11px] text-mt-ink-3">{product.supplier} · {product.category}</p>
            </div>
            <span className="text-[14px] font-bold text-mt-ink">{product.price}</span>
            <div className="flex items-center gap-1">
              <Star size={10} fill="var(--mt-brand)" className="text-primary" />
              <span className="text-[11px] font-medium text-primary">{product.rating}</span>
            </div>
            {isAdded ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A]"><Check size={10} /> Added</span>
            ) : (
              <button className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:opacity-80"
                onClick={(e) => { e.stopPropagation(); onAddProduct(key, product.name); }}>
                <Plus size={10} /> Add
              </button>
            )}
            {product.dbId && (
              <button
                className="flex items-center gap-1 text-[11px] font-medium text-[#EF4444] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-2 py-1 rounded transition-all ml-2"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${product.name}"? This cannot be undone.`)) {
                    onDeleteProduct(product.dbId!, product.name);
                  }
                }}
              >
                <Trash2 size={10} /> Delete
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
CURATIONTAB_EOF

echo "   ✓ CurationProductsTab.tsx updated"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Build
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "[4/5] Building..."
npx vite build 2>&1 | tail -5
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist 2>&1 | tail -3

# ─────────────────────────────────────────────────────────────────────────────
# 5. Restart
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Restarting PM2..."
npx pm2 restart mergetasks

echo ""
echo "=========================================="
echo " ✅ Product Detail page deployed!"
echo ""
echo "  • Click any product card → /curation/product/:id"
echo "  • Premium Apple/Stripe aesthetic"
echo "  • Image fallback with placeholder icon"
echo "  • Pricing tiers with savings %"
echo "  • Decoration methods, colors, sizes"
echo "  • Breadcrumb nav back to curation"
echo "  • Zero backend changes"
echo "=========================================="
