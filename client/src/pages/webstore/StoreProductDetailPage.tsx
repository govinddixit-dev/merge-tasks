/**
 * StoreProductDetailPage — Full product detail with variant selection,
 * artwork upload (print products), pricing tiers, and related products.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Package, Minus, Plus, ShoppingCart,
  Truck, Shield, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useStore, capitalize, getDefaultPlacement } from "./StoreContext";
import type { PlacementZone } from "./StoreContext";
import { getStoreTheme } from "./storeThemeUtils";
import WebstoreLogoOverlay, { extractWebstorePlacement } from "./WebstoreLogoOverlay";
import ProductCard from "./ProductCard";
import { trpc } from "@/lib/trpc";

export default function StoreProductDetailPage({ productId }: { productId: string }) {
  const { store, addToCart, isDark } = useStore();
  const [, navigate] = useLocation();
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const cardBg = isDark ? "#252525" : "#FAFAFA";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const pc = store.primaryColor;

  const product = store.products.find(p => p.id === parseInt(productId));
  const isPrint = product?.type === "print";

  const [qty, setQty] = useState(product?.minOrderQty || 1);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedPrintArea, setSelectedPrintArea] = useState("");
  const [selectedPrintMethod, setSelectedPrintMethod] = useState("");
  const [message, setMessage] = useState("");
  const [infoTab, setInfoTab] = useState<"product" | "additional" | "pricing">("product");
  const [mainImage, setMainImage] = useState(product?.imageUrl || "");
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);

  // Imprint zones — pulled from the distributor's configuration to drive
  // the LogoOverlay placement preview. The customer-facing page no longer
  // exposes the zone/decoration selector chips (those are a distributor-
  // only configuration surface), but the preview still snaps to the
  // product's default zone so the logo renders in the right spot.
  const { data: imprintZones } = trpc.imprintZones.listForProductPublic.useQuery(
    { productId: product?.id ?? 0 },
    { enabled: !!product?.id },
  );
  const [selectedPlacement, setSelectedPlacement] = useState<PlacementZone>(
    getDefaultPlacement(product?.category ?? null)
  );
  const [selectedDecorationMethod, setSelectedDecorationMethod] = useState<string>("");

  // When real zones arrive, snap selectedPlacement to the product's default
  // zone (or the first zone) — but only if the current selection isn't
  // already one of the real zones.
  useEffect(() => {
    if (!imprintZones || imprintZones.length === 0) return;
    const match = imprintZones.find(z => z.slug === selectedPlacement.id);
    if (match) return;
    const def = imprintZones.find(z => z.isDefault) ?? imprintZones[0];
    setSelectedPlacement({
      id: def.slug,
      label: def.label,
      x: Number(def.x),
      y: Number(def.y),
      w: Number(def.w),
      opacity: 0.9,
    });
  }, [imprintZones]);

  // When the selected zone changes, auto-pick that zone's default
  // decoration method. User can still manually override afterwards.
  useEffect(() => {
    if (!imprintZones) return;
    const zone = imprintZones.find(z => z.slug === selectedPlacement.id);
    const defaultDec = zone?.decorations.find(d => d.isDefault);
    if (defaultDec?.slug) setSelectedDecorationMethod(defaultDec.slug);
  }, [selectedPlacement, imprintZones]);

  const colorOptions = product?.colors ? product.colors.split(",").map(c => c.trim()).filter(Boolean) : [];
  const sizeOptions = product?.sizes ? product.sizes.split(",").map(s => s.trim()).filter(Boolean) : [];
  const printAreaOptions = product?.printAreas || [];
  const printMethodOptions = product?.printMethods || [];

  useEffect(() => {
    if (colorOptions.length > 0 && !selectedColor) setSelectedColor(colorOptions[0]);
    if (sizeOptions.length > 0 && !selectedSize) setSelectedSize(sizeOptions[0]);
    if (printAreaOptions.length > 0 && !selectedPrintArea) setSelectedPrintArea(printAreaOptions[0]);
    if (printMethodOptions.length > 0 && !selectedPrintMethod) setSelectedPrintMethod(printMethodOptions[0]);
    if (product?.imageUrl) setMainImage(product.imageUrl);
  }, [product]);

  const handleArtworkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setArtworkFile(file);
      const reader = new FileReader();
      reader.onload = () => setArtworkPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const getPrice = () => {
    if (product?.pricingTiers && product.pricingTiers.length > 0) {
      const tier = product.pricingTiers.find(t => qty >= t.minQty && qty <= t.maxQty);
      if (tier) return tier.price;
      const lastTier = product.pricingTiers[product.pricingTiers.length - 1];
      if (qty > lastTier.maxQty) return lastTier.price;
    }
    return parseFloat(product?.customPrice || product?.basePrice || "0");
  };

  const relatedProducts = store.products.filter(p => p.id !== product?.id && p.category === product?.category).slice(0, 4);

  if (!product) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-20 text-center">
        <p className="text-[16px] font-semibold" style={{ color: fg }}>Product not found</p>
        <button onClick={() => navigate(`~/s/${store.slug}/products`)} className="mt-4 text-[13px] font-semibold" style={{ color: pc }}>
          Back to Products
        </button>
      </div>
    );
  }

  const price = getPrice();
  const selectCls = `h-9 px-3 text-[13px] border rounded-md outline-none bg-transparent font-medium w-full appearance-none cursor-pointer`;
  const allImages = [product.imageUrl, ...(product.additionalImages || [])].filter(Boolean) as string[];

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10 pb-24 lg:pb-0">
      <button
        onClick={() => navigate(`~/s/${store.slug}/products`)}
        className="flex items-center gap-1.5 text-[13px] font-semibold mb-8"
        style={{ color: pc }}
      >
        <ChevronLeft size={16} /> Back to Products
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Image + Thumbnails — sticky on desktop */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="relative aspect-square rounded-xl overflow-hidden" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
            {/*
              Phase 6 — Revised Option B (intentional two-layer divergence):
                • VISUAL render reads from products.webstoreImprintPlacement*
                  (AI vision, image-relative coords) via WebstoreLogoOverlay.
                  This is the OGIO Crunch fix.
                • CART payload (selectedPlacement, the imprintZones query, the
                  useEffects, and addToCart's imprintZoneSlug below) is
                  UNCHANGED. It continues to feed the cart with the legacy
                  productImprintZones-derived value, which today resolves to
                  null for ~every product (table is 0.0% populated). Phase 7's
                  override UI will close the gap by populating
                  productImprintZones from AI suggestions.
                See docs/tier1-phase6-architecture-finding.md.
            */}
            <WebstoreLogoOverlay
              productId={product.id}
              productImageUrl={mainImage || null}
              logoUrl={store.client?.logoUrl ?? null}
              placement={extractWebstorePlacement(product)}
              renderedImageUrl={product.webstoreRenderedImageUrl}
              alt={product.name}
              showToggle
              primaryColor={pc}
            />
          </div>

          {allImages.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
              {allImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setMainImage(img)}
                  className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 transition-all"
                  style={{
                    border: mainImage === img ? `2px solid ${pc}` : `1px solid ${borderColor}`,
                    opacity: mainImage === img ? 1 : 0.6,
                  }}
                >
                  <img src={img} alt="" className="w-full h-full object-contain p-1" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details — fade-in animation */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: pc }}>
            {capitalize(product.category || "Product")}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold mb-3" style={{ color: fg }}>{product.name}</h1>
          {product.sku && (
            <p className="text-[12px] mb-4" style={{ color: mutedFg }}>SKU: {product.sku}</p>
          )}
          <p className="text-3xl font-bold mb-6" style={{ color: fg }}>${price.toFixed(2)}</p>

          {/* Variant dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {colorOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: mutedFg }}>Color</label>
                <select className={selectCls} style={{ borderColor, color: fg }} value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)}>
                  {colorOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {sizeOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: mutedFg }}>Size</label>
                <select className={selectCls} style={{ borderColor, color: fg }} value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)}>
                  {sizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {isPrint && printAreaOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: mutedFg }}>Print Area</label>
                <select className={selectCls} style={{ borderColor, color: fg }} value={selectedPrintArea} onChange={(e) => setSelectedPrintArea(e.target.value)}>
                  {printAreaOptions.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
            {isPrint && printMethodOptions.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: mutedFg }}>Print Method</label>
                <select className={selectCls} style={{ borderColor, color: fg }} value={selectedPrintMethod} onChange={(e) => setSelectedPrintMethod(e.target.value)}>
                  {printMethodOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Print specs */}
          {isPrint && (
            <div className="mb-5 p-4 rounded-lg" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: pc }}>Print Specifications</p>
              {product.fileSpecs && <p className="text-[12px] mb-1" style={{ color: mutedFg }}>File Specs: {product.fileSpecs}</p>}
              {product.printColors && product.printColors.length > 0 && (
                <p className="text-[12px] mb-1" style={{ color: mutedFg }}>Color Options: {product.printColors.join(", ")}</p>
              )}
              {product.minOrderQty && <p className="text-[12px]" style={{ color: mutedFg }}>Minimum Order: {product.minOrderQty} units</p>}
            </div>
          )}

          {/* Artwork upload */}
          {isPrint && (
            <div className="mb-5">
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style={{ color: mutedFg }}>Upload Artwork</label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors"
                style={{ borderColor: artworkPreview ? pc : borderColor }}
                onClick={() => document.getElementById(`artwork-upload-${productId}`)?.click()}
              >
                {artworkPreview ? (
                  <div className="flex items-center gap-3">
                    <img src={artworkPreview} alt="Artwork" className="w-16 h-16 object-contain rounded" />
                    <div className="text-left">
                      <p className="text-[13px] font-semibold" style={{ color: fg }}>{artworkFile?.name}</p>
                      <p className="text-[11px]" style={{ color: mutedFg }}>{((artworkFile?.size ?? 0) / 1024).toFixed(1)} KB</p>
                      <button
                        className="text-[11px] font-semibold mt-1"
                        style={{ color: pc }}
                        onClick={(e) => { e.stopPropagation(); setArtworkFile(null); setArtworkPreview(null); }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload size={24} className="mx-auto mb-2" style={{ color: mutedFg }} />
                    <p className="text-[13px] font-semibold" style={{ color: fg }}>Click to upload your artwork</p>
                    <p className="text-[11px] mt-1" style={{ color: mutedFg }}>{product.fileSpecs || "PDF, AI, EPS, PNG, or JPG"}</p>
                  </>
                )}
                <input
                  id={`artwork-upload-${productId}`}
                  type="file"
                  accept=".pdf,.ai,.eps,.png,.jpg,.jpeg,.svg"
                  className="hidden"
                  onChange={handleArtworkUpload}
                />
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="flex items-center gap-4 mb-5">
            <span className="text-[13px] font-semibold" style={{ color: fg }}>Quantity</span>
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity" className="w-10 h-10 flex items-center justify-center text-white transition-colors" style={{ backgroundColor: pc }}>
                <Minus size={14} />
              </button>
              <span className="w-14 text-center text-[14px] font-semibold" style={{ color: fg }}>{qty}</span>
              <button onClick={() => setQty(qty + 1)} aria-label="Increase quantity" className="w-10 h-10 flex items-center justify-center text-white transition-colors" style={{ backgroundColor: pc }}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Add to Cart */}
          <button
            onClick={() => {
              const opts = store.client?.logoUrl
                ? { imprintZoneSlug: selectedPlacement.id, decorationMethod: selectedDecorationMethod || undefined }
                : undefined;
              for (let i = 0; i < qty; i++) addToCart(product, opts);
              toast.success(`${qty}x ${product.name} added to cart`);
            }}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg text-[14px] font-semibold text-white transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: pc }}
          >
            <ShoppingCart size={16} /> Add to Cart — ${(price * qty).toFixed(2)}
          </button>

          {/* Message */}
          <div className="mt-5">
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: mutedFg }}>Message</label>
            <textarea
              placeholder="Comment your special requirements here."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full h-20 px-3 py-2 text-[13px] rounded-md outline-none resize-none"
              style={{ border: `1px solid ${borderColor}`, color: fg, backgroundColor: "transparent" }}
            />
          </div>

          {/* Trust badges */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[{ icon: Truck, text: "Free Shipping" }, { icon: Shield, text: "Quality Guaranteed" }].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: cardBg }}>
                <Icon size={14} style={{ color: pc }} />
                <span className="text-[12px] font-semibold" style={{ color: mutedFg }}>{text}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Mobile fixed bottom CTA bar */}
      <div
        className="fixed bottom-0 left-0 right-0 lg:hidden flex items-center justify-between px-5 py-3 border-t backdrop-blur-md z-50"
        style={{
          backgroundColor: isDark ? "rgba(26,26,26,0.95)" : "rgba(255,255,255,0.95)",
          borderColor,
        }}
      >
        <div>
          <p className="text-[14px] font-bold" style={{ color: fg }}>
            ${price.toFixed(2)}
          </p>
          <p className="text-[11px]" style={{ color: mutedFg }}>{product.name}</p>
        </div>
        <button
          onClick={() => {
            const opts = store.client?.logoUrl
              ? { imprintZoneSlug: selectedPlacement.id, decorationMethod: selectedDecorationMethod || undefined }
              : undefined;
            for (let i = 0; i < qty; i++) addToCart(product, opts);
            toast.success(`${qty}x ${product.name} added to cart`);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white"
          style={{ backgroundColor: pc }}
        >
          <ShoppingCart size={15} />
          {getStoreTheme(store).ctaLabel}
        </button>
      </div>

      {/* Info Tabs */}
      <div className="mt-10 mb-8">
        <div className="flex gap-0 mb-0">
          {(["product", "additional", ...(isPrint && product.pricingTiers && product.pricingTiers.length > 0 ? ["pricing" as const] : [])] as const).map(tab => (
            <button
              key={tab}
              className={`px-5 py-2 text-[13px] font-semibold transition-all ${infoTab === tab ? "border-b-2" : "text-opacity-60"}`}
              style={{ color: infoTab === tab ? pc : mutedFg, borderColor: infoTab === tab ? pc : "transparent" }}
              onClick={() => setInfoTab(tab as "product" | "additional" | "pricing")}
            >
              {tab === "product" ? "Product Info" : tab === "additional" ? "Additional Info" : "Pricing"}
            </button>
          ))}
        </div>
        <div className="p-5 rounded-b-lg text-[13px] leading-relaxed" style={{ color: mutedFg, border: `1px solid ${borderColor}`, borderTop: "none" }}>
          {infoTab === "product"
            ? (product.description || "No product description available.")
            : infoTab === "pricing" && product.pricingTiers && product.pricingTiers.length > 0
            ? (
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderColor}` }}>
                    <th className="py-2 text-[11px] font-bold uppercase" style={{ color: mutedFg }}>Quantity</th>
                    <th className="py-2 text-[11px] font-bold uppercase text-right" style={{ color: mutedFg }}>Price per Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {product.pricingTiers.map((tier, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${borderColor}` }}>
                      <td className="py-2" style={{ color: fg }}>{tier.minQty} – {tier.maxQty}</td>
                      <td className="py-2 text-right font-semibold" style={{ color: fg }}>${tier.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
            : (product.material ? `Material: ${product.material}` : "Contact your distributor for additional information about production and shipping.")
          }
        </div>
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <div className="mb-8">
          <h3 className="text-[18px] font-bold mb-5" style={{ color: fg }}>Related Products</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {relatedProducts.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
