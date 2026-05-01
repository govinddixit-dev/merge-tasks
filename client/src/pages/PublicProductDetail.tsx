/**
 * Public Product Detail Page — standalone product view within a proposal context.
 * Accessed from the public proposal view when a client clicks on a product.
 * Route: /view/proposal/:token/product/:productId
 * No authentication required — uses viewToken for access.
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Package, Sparkles, CheckCircle2, AlertTriangle,
  ZoomIn, X, Eye, Tag, Ruler, ShoppingCart, CreditCard,
  ChevronLeft, ChevronRight, Info, Loader2, ExternalLink
} from "lucide-react";

const LOGO_URL = "/logo_clean.png";

interface ProductData {
  id: number;
  productId: number;
  name: string;
  description: string | null;
  category: string;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  decorationType: string | null;
  decorationNotes: string | null;
  imageUrl: string | null;
  additionalImages: string[];
  proofImageUrl: string | null;
  proofStatus: string | null;
  decorationZone: string | null;
  colors: string[];
  sizes: string[];
  logoPositions: string[];
  priceTiers: { tierType: string; label: string; minQty: number | null; maxQty: number | null; price: string }[];
  sizeChart: { chartData: Record<string, string>[]; imageUrl: string | null } | null;
  relatedProducts: {
    productId: number;
    name: string;
    category: string;
    imageUrl: string | null;
    unitPrice: string | null;
    quantity: number;
  }[];
}

interface PageData {
  proposalTitle: string;
  proposalType: string;
  isExpired: boolean;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    bannerColor: string;
    companyName: string;
  };
  product: ProductData;
}

const DECORATION_LABELS: Record<string, string> = {
  embroidery: "Embroidery",
  screen_print: "Screen Print",
  laser_engraving: "Laser Engraving",
  heat_transfer: "Heat Transfer",
  dtg: "DTG Print",
  sublimation: "Sublimation",
  deboss: "Deboss",
  patch: "Patch",
};

const CATEGORY_LABELS: Record<string, string> = {
  apparel: "Apparel",
  drinkware: "Drinkware",
  tech: "Tech",
  bags: "Bags",
  writing: "Writing",
  wellness: "Wellness",
  outdoor: "Outdoor",
  office: "Office",
  other: "Other",
};

// Apparel size chart data
const SIZE_CHART = {
  headers: ["Size", "Chest (in)", "Waist (in)", "Length (in)"],
  rows: [
    ["S", "34–36", "28–30", "28"],
    ["M", "38–40", "32–34", "29"],
    ["L", "42–44", "36–38", "30"],
    ["XL", "46–48", "40–42", "31"],
    ["2XL", "50–52", "44–46", "32"],
  ],
};

export default function PublicProductDetail() {
  const params = useParams<{ token: string; productId: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "sizing" | "decoration">("details");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedLogoPosition, setSelectedLogoPosition] = useState("");

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await fetch(`/api/proposals/public/${params.token}/product/${params.productId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Product not found");
        }
        const result = await res.json();
        setData(result);
        // Set initial selected image
        const prod = result.product;
        const mainImage = (showProof && prod.proofImageUrl) ? prod.proofImageUrl : prod.imageUrl;
        setSelectedImage(mainImage || null);
        // Initialize variant selections
        setSelectedColor(prod.colors?.[0] || "");
        setSelectedSize(prod.sizes?.[0] || "");
        setSelectedLogoPosition(prod.logoPositions?.[0] || "");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load product");
      } finally {
        setLoading(false);
      }
    }
    if (params.token && params.productId) fetchProduct();
  }, [params.token, params.productId]);

  // Update selected image when toggling proof/original
  useEffect(() => {
    if (!data) return;
    const prod = data.product;
    if (showProof && prod.proofImageUrl) {
      setSelectedImage(prod.proofImageUrl);
    } else if (prod.imageUrl) {
      setSelectedImage(prod.imageUrl);
    }
  }, [showProof, data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="text-primary animate-spin mx-auto mb-4" />
          <p className="text-[14px] text-mt-ink-3">Loading product details...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-mt-surface-2 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-10 text-center max-w-md w-full shadow-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#FEF2F2] flex items-center justify-center">
            <AlertTriangle size={32} className="text-[#DC2626]" />
          </div>
          <h1 className="text-[20px] font-bold text-mt-ink mb-2">Product Not Found</h1>
          <p className="text-[14px] text-mt-ink-3 mb-6">{error || "This product could not be found in the proposal."}</p>
          <button
            onClick={() => navigate(`/view/proposal/${params.token}`)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-[#5338E0] transition-colors"
          >
            <ArrowLeft size={14} /> Back to Proposal
          </button>
        </div>
      </div>
    );
  }

  const { product, branding, proposalTitle, isExpired } = data;
  const primaryColor = branding.primaryColor || "var(--mt-brand)";
  const bannerColor = branding.bannerColor || primaryColor;
  const brandName = branding.companyName || "MergeTasks";
  const brandLogo = branding.logoUrl;
  const lineTotal = parseFloat(product.unitPrice || "0") * product.quantity;
  const isApparel = product.category === "apparel";
  const hasProof = !!product.proofImageUrl;
  const hasAdditionalImages = product.additionalImages && product.additionalImages.length > 0;

  // Build gallery images
  const galleryImages: { url: string; label: string }[] = [];
  if (product.proofImageUrl) {
    galleryImages.push({ url: product.proofImageUrl, label: "AI Proof" });
  }
  if (product.imageUrl) {
    galleryImages.push({ url: product.imageUrl, label: "Product" });
  }
  if (hasAdditionalImages) {
    product.additionalImages.forEach((img, i) => {
      galleryImages.push({ url: img, label: `View ${i + 1}` });
    });
  }

  return (
    <div className="min-h-screen bg-mt-surface-2">
      {/* Header Banner */}
      <div style={{ backgroundColor: bannerColor }} className="py-4 px-4 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/view/proposal/${params.token}`)}
              className="flex items-center gap-1.5 text-white/80 hover:text-white text-[13px] font-medium transition-colors"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back to Proposal</span>
            </button>
            <span className="text-white/30 hidden sm:inline">|</span>
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} className="h-6 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
            ) : (
              <img src={LOGO_URL} alt="MergeTasks" className="h-6 object-contain" />
            )}
          </div>
          <div className="flex items-center gap-2 text-white/60 text-[11px]">
            <span className="hidden sm:inline">{proposalTitle}</span>
          </div>
        </div>
      </div>

      {/* Expiration Banner */}
      {isExpired && (
        <div className="max-w-5xl mx-auto px-4 pt-6">
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle size={20} className="text-[#DC2626] shrink-0" />
            <div>
              <p className="text-[14px] font-semibold text-[#DC2626]">This proposal has expired</p>
              <p className="text-[12px] text-[#991B1B]">Pricing and availability may have changed. Contact your account manager for an updated proposal.</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-mt-ink-4 mb-6">
          <button
            onClick={() => navigate(`/view/proposal/${params.token}`)}
            className="hover:text-mt-ink-2 transition-colors"
          >
            {proposalTitle}
          </button>
          <ChevronRight size={12} />
          <span className="text-mt-ink-2 font-medium">{product.name}</span>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column — Images */}
          <div className="space-y-4">
            {/* Main Image */}
            <div
              className="bg-white rounded-2xl border border-mt-border overflow-hidden cursor-pointer group relative"
              onClick={() => selectedImage && setLightbox(selectedImage)}
            >
              <div className="aspect-square flex items-center justify-center p-8 relative">
                {selectedImage ? (
                  <img
                    src={selectedImage}
                    alt={product.name}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <Package size={64} className="text-[#D4D4D4]" />
                )}
                {/* Zoom overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3 shadow-md">
                    <ZoomIn size={20} className="text-mt-ink-2" />
                  </div>
                </div>
                {/* Proof badge */}
                {hasProof && showProof && selectedImage === product.proofImageUrl && (
                  <div className="absolute top-4 left-4 bg-[#16A34A] text-white text-[11px] font-bold px-3 py-1 rounded-lg flex items-center gap-1.5">
                    <Sparkles size={12} /> AI Virtual Proof
                  </div>
                )}
                {product.proofStatus === "approved" && (
                  <div className="absolute top-4 right-4 bg-[#16A34A] text-white text-[11px] font-bold px-3 py-1 rounded-lg flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> Approved
                  </div>
                )}
              </div>
            </div>

            {/* Thumbnail Gallery */}
            {galleryImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {galleryImages.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(img.url)}
                    className={`w-20 h-20 rounded-xl border-2 overflow-hidden bg-white shrink-0 transition-all ${
                      selectedImage === img.url
                        ? "border-primary shadow-sm"
                        : "border-mt-border hover:border-[#A3A3A3]"
                    }`}
                  >
                    <img src={img.url} alt={img.label} className="w-full h-full object-contain p-1.5" />
                  </button>
                ))}
              </div>
            )}

            {/* Proof / Original Toggle */}
            {hasProof && product.imageUrl && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowProof(true); setSelectedImage(product.proofImageUrl!); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all ${
                    showProof
                      ? "text-white shadow-sm"
                      : "bg-white border border-mt-border text-mt-ink-3 hover:bg-mt-surface-2"
                  }`}
                  style={showProof ? { backgroundColor: primaryColor } : undefined}
                >
                  <Sparkles size={14} /> Virtual Proof
                </button>
                <button
                  onClick={() => { setShowProof(false); setSelectedImage(product.imageUrl!); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all ${
                    !showProof
                      ? "text-white shadow-sm"
                      : "bg-white border border-mt-border text-mt-ink-3 hover:bg-mt-surface-2"
                  }`}
                  style={!showProof ? { backgroundColor: primaryColor } : undefined}
                >
                  <Eye size={14} /> Original Product
                </button>
              </div>
            )}
          </div>

          {/* Right Column — Product Info */}
          <div className="space-y-5">
            {/* Category & Name */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-mt-surface-2 text-mt-ink-3 uppercase tracking-wider">
                  {CATEGORY_LABELS[product.category] || product.category}
                </span>
                {product.decorationType && (
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#EEF2FF] text-[#4338CA] uppercase tracking-wider">
                    {DECORATION_LABELS[product.decorationType] || product.decorationType}
                  </span>
                )}
                {product.proofStatus === "approved" && (
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#166534] uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 size={10} /> Proof Approved
                  </span>
                )}
              </div>
              <h1 className="text-[28px] font-bold text-mt-ink leading-tight">{product.name}</h1>
              {product.sku && (
                <p className="text-[12px] text-mt-ink-4 mt-1">SKU: {product.sku}</p>
              )}
            </div>

            {/* Pricing Card */}
            <div className="bg-white rounded-2xl border border-mt-border p-5">
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-1">Unit Price</p>
                  <p className="text-[32px] font-bold leading-none" style={{ color: primaryColor }}>
                    {product.unitPrice ? `$${parseFloat(product.unitPrice).toFixed(2)}` : "Quote"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-1">Quantity</p>
                  <p className="text-[24px] font-bold text-mt-ink leading-none">{product.quantity}</p>
                </div>
              </div>
              <div className="border-t border-[#F0F0F0] pt-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-mt-ink-3">Line Total</span>
                <span className="text-[20px] font-bold text-mt-ink">${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Variant Dropdowns: Color, Size, Logo Position */}
            {(product.colors?.length > 0 || product.sizes?.length > 0 || product.logoPositions?.length > 0) && (
              <div className="bg-white rounded-2xl border border-mt-border p-5 space-y-3">
                {product.colors?.length > 0 && (
                  <div className="flex items-center gap-4">
                    <label className="text-[12px] font-semibold text-mt-ink w-[120px] flex-shrink-0">Color:</label>
                    <select
                      className="flex-1 h-9 px-3 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white text-mt-ink-2 font-medium appearance-none cursor-pointer"
                      value={selectedColor}
                      onChange={(e) => setSelectedColor(e.target.value)}
                    >
                      {product.colors.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                {product.sizes?.length > 0 && (
                  <div className="flex items-center gap-4">
                    <label className="text-[12px] font-semibold text-mt-ink w-[120px] flex-shrink-0">Size:</label>
                    <select
                      className="flex-1 h-9 px-3 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white text-mt-ink-2 font-medium appearance-none cursor-pointer"
                      value={selectedSize}
                      onChange={(e) => setSelectedSize(e.target.value)}
                    >
                      {product.sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {product.logoPositions?.length > 0 && (
                  <div className="flex items-center gap-4">
                    <label className="text-[12px] font-semibold text-mt-ink w-[120px] flex-shrink-0">Logo Position:</label>
                    <select
                      className="flex-1 h-9 px-3 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white text-mt-ink-2 font-medium appearance-none cursor-pointer"
                      value={selectedLogoPosition}
                      onChange={(e) => setSelectedLogoPosition(e.target.value)}
                    >
                      {product.logoPositions.map(lp => <option key={lp} value={lp}>{lp}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="bg-white rounded-2xl border border-mt-border overflow-hidden">
              <div className="flex border-b border-[#F0F0F0]">
                {[
                  { key: "details" as const, label: "Product Details", icon: Info },
                  ...(isApparel ? [{ key: "sizing" as const, label: "Size Chart", icon: Ruler }] : []),
                  ...(product.decorationType ? [{ key: "decoration" as const, label: "Decoration", icon: Sparkles }] : []),
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-semibold transition-colors border-b-2 ${
                      activeTab === tab.key
                        ? "border-current text-mt-ink"
                        : "border-transparent text-mt-ink-4 hover:text-mt-ink-3"
                    }`}
                    style={activeTab === tab.key ? { color: primaryColor, borderColor: primaryColor } : undefined}
                  >
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {activeTab === "details" && (
                  <div className="space-y-4">
                    {product.description ? (
                      <div>
                        <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-2">Description</p>
                        <p className="text-[14px] text-mt-ink-2 leading-relaxed">{product.description}</p>
                      </div>
                    ) : (
                      <p className="text-[13px] text-mt-ink-4 italic">No description available for this product.</p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#F9FAFB] rounded-xl p-3">
                        <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-0.5">Category</p>
                        <p className="text-[13px] font-semibold text-mt-ink">{CATEGORY_LABELS[product.category] || product.category}</p>
                      </div>
                      {product.sku && (
                        <div className="bg-[#F9FAFB] rounded-xl p-3">
                          <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-0.5">SKU</p>
                          <p className="text-[13px] font-semibold text-mt-ink">{product.sku}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "sizing" && isApparel && (
                  <div>
                    <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-3">Standard Size Chart</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-mt-border">
                            {SIZE_CHART.headers.map(h => (
                              <th key={h} className="text-left py-2 px-3 text-[11px] font-bold text-mt-ink-4 uppercase tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {SIZE_CHART.rows.map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? "bg-[#F9FAFB]" : ""}>
                              {row.map((cell, j) => (
                                <td key={j} className={`py-2.5 px-3 ${j === 0 ? "font-bold text-mt-ink" : "text-mt-ink-2"}`}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-mt-ink-4 mt-3 italic">
                      Measurements are approximate. Actual sizing may vary by manufacturer.
                    </p>
                  </div>
                )}

                {activeTab === "decoration" && product.decorationType && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-2">Decoration Method</p>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white"
                          style={{ backgroundColor: primaryColor }}
                        >
                          <Sparkles size={14} />
                          {DECORATION_LABELS[product.decorationType] || product.decorationType}
                        </span>
                      </div>
                    </div>

                    {product.decorationZone && (
                      <div>
                        <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-1">Placement Zone</p>
                        <p className="text-[14px] font-medium text-mt-ink capitalize">{product.decorationZone}</p>
                      </div>
                    )}

                    {product.decorationNotes && (
                      <div>
                        <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-1">Decoration Notes</p>
                        <p className="text-[13px] text-mt-ink-2 leading-relaxed">{product.decorationNotes}</p>
                      </div>
                    )}

                    {product.proofStatus && (
                      <div className={`rounded-xl p-4 ${
                        product.proofStatus === "approved"
                          ? "bg-[#F0FDF4] border border-[#BBF7D0]"
                          : "bg-mt-surface-2 border border-mt-border"
                      }`}>
                        <p className="text-[10px] font-bold text-mt-ink-4 uppercase tracking-wider mb-1">Virtual Proof Status</p>
                        <p className={`text-[14px] font-semibold flex items-center gap-1.5 ${
                          product.proofStatus === "approved" ? "text-[#166534]" : "text-mt-ink-2"
                        }`}>
                          {product.proofStatus === "approved" && <CheckCircle2 size={16} />}
                          {product.proofStatus === "approved" ? "Approved — Ready for Production" : product.proofStatus === "ready" ? "Ready for Review" : product.proofStatus}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Back to Proposal CTA */}
            <button
              onClick={() => navigate(`/view/proposal/${params.token}`)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[13px] font-bold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              <ArrowLeft size={16} /> Back to Full Proposal
            </button>
          </div>
        </div>

        {/* Related Products */}
        {product.relatedProducts && product.relatedProducts.length > 0 && (
          <div className="mt-10">
            <h2 className="text-[18px] font-bold text-mt-ink mb-4 flex items-center gap-2">
              <Package size={18} style={{ color: primaryColor }} /> More from this Proposal
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {product.relatedProducts.map(rp => {
                const rpTotal = parseFloat(rp.unitPrice || "0") * rp.quantity;
                return (
                  <button
                    key={rp.productId}
                    onClick={() => navigate(`/view/proposal/${params.token}/product/${rp.productId}`)}
                    className="bg-white rounded-2xl border border-mt-border overflow-hidden text-left hover:shadow-md hover:border-mt-border-2 transition-all group"
                  >
                    <div className="aspect-square flex items-center justify-center p-4 bg-[#F9FAFB]">
                      {rp.imageUrl ? (
                        <img src={rp.imageUrl} alt={rp.name} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" />
                      ) : (
                        <Package size={32} className="text-[#D4D4D4]" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-[12px] font-semibold text-mt-ink truncate">{rp.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mt-surface-2 text-mt-ink-3">
                          {CATEGORY_LABELS[rp.category] || rp.category}
                        </span>
                        <span className="text-[12px] font-bold" style={{ color: primaryColor }}>
                          ${rpTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-8 mt-6">
          <p className="text-[12px] text-mt-ink-4">
            &copy; {new Date().getFullYear()} {brandName}
          </p>
          <p className="text-[11px] text-[#D4D4D4] mt-1">
            Powered by MergeTasks — Enterprise Branded Merchandise Platform
          </p>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-mt-border">
              <span className="text-[14px] font-semibold text-mt-ink">{product.name}</span>
              <button onClick={() => setLightbox(null)} className="p-1.5 hover:bg-mt-surface-2 rounded-lg transition-colors">
                <X size={16} className="text-mt-ink-3" />
              </button>
            </div>
            <div className="p-6 flex items-center justify-center bg-[#F9FAFB]" style={{ minHeight: 400 }}>
              <img src={lightbox} alt={product.name} className="max-w-full max-h-[70vh] object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
