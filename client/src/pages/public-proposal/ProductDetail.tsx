/**
 * ProductDetail.tsx — Single product detail view: image carousel,
 * variant selectors (color/size/logo), price tiers, size chart,
 * quantity picker, and "Add to list" action.
 */
import { useState, useMemo } from "react";
import {
  Package, ChevronLeft, ChevronRight, Minus, Plus,
} from "lucide-react";
import type { ProposalProduct, OrderItem } from "./publicProposalTypes";
import { CATEGORY_LABELS } from "./publicProposalTypes";

interface Props {
  product: ProposalProduct;
  selectedIndex: number;
  totalProducts: number;
  primaryColor: string;
  expired: boolean;
  onSelectProduct: (idx: number) => void;
  onAddToList: (item: Omit<OrderItem, "id">) => void;
}

export function ProductDetail({
  product: sp, selectedIndex, totalProducts,
  primaryColor, expired, onSelectProduct, onAddToList,
}: Props) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"price" | "size">("price");
  const [infoTab, setInfoTab] = useState<"product" | "additional">("product");
  const [selectedColor, setSelectedColor] = useState(sp.colors[0] || "");
  const [selectedSize, setSelectedSize] = useState(sp.sizes[0] || "");
  const [selectedLogoPosition, setSelectedLogoPosition] = useState(sp.logoPositions[0] || "");
  const [quantity, setQuantity] = useState(sp.quantity || 1);
  const [message, setMessage] = useState("");

  const productImages = useMemo(() => {
    const imgs: string[] = [];
    // Approved proof leads — the client sees the branded mockup first
    if (sp.proofImageUrl && sp.proofStatus === "approved")
      imgs.push(sp.proofImageUrl);
    if (sp.imageUrl) imgs.push(sp.imageUrl);
    if (sp.proposalImages?.length) imgs.push(...sp.proposalImages);
    if (sp.additionalImages?.length)
      imgs.push(...sp.additionalImages.filter(i => !imgs.includes(i)));
    return imgs;
  }, [sp]);

  const currentUnitPrice = useMemo(() => {
    if (sp.priceTiers.length > 0) {
      const tier = sp.priceTiers.find(t => {
        const min = t.minQty || 0;
        const max = t.maxQty || Infinity;
        return quantity >= min && quantity <= max;
      });
      if (tier) return parseFloat(tier.price);
    }
    return parseFloat(sp.unitPrice || "0");
  }, [sp, quantity]);

  const selectCls = "h-9 px-3 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white text-mt-ink-2 font-medium w-full appearance-none cursor-pointer";

  const handleAdd = () => {
    onAddToList({
      proposalProductId: sp.id,
      productId: sp.productId,
      color: selectedColor || null,
      size: selectedSize || null,
      logoPosition: selectedLogoPosition || null,
      quantity,
      unitPrice: currentUnitPrice.toFixed(2),
      comment: message.trim() || null,
      productName: sp.name,
      productImage: sp.imageUrl,
    });
    setMessage("");
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6 relative">
      {/* Product navigation */}
      {totalProducts > 1 && (
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <span className="text-[11px] font-semibold text-mt-ink-4 tracking-wider uppercase">
            {selectedIndex + 1} / {totalProducts}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all border"
              style={{ borderColor: selectedIndex > 0 ? "#D4D4D4" : "#EDEDED", opacity: selectedIndex > 0 ? 1 : 0.4 }}
              onClick={() => selectedIndex > 0 && onSelectProduct(selectedIndex - 1)}
              disabled={selectedIndex === 0}
            >
              <ChevronLeft size={14} className="text-mt-ink-3" />
            </button>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ backgroundColor: selectedIndex < totalProducts - 1 ? primaryColor : "#F0F0F0", opacity: selectedIndex < totalProducts - 1 ? 1 : 0.4 }}
              onClick={() => selectedIndex < totalProducts - 1 && onSelectProduct(selectedIndex + 1)}
              disabled={selectedIndex >= totalProducts - 1}
            >
              <ChevronRight size={14} className={selectedIndex < totalProducts - 1 ? "text-white" : "text-mt-ink-3"} />
            </button>
          </div>
        </div>
      )}

      <div className="p-6">
        {/* Category badge */}
        <span className="inline-block text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 mb-4 border border-mt-border text-mt-ink-3">
          {CATEGORY_LABELS[sp.category] || sp.category.toUpperCase()}
        </span>

        {/* 2-column: image left | details right */}
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
          {/* Left: Product image + thumbnails */}
          <div className="w-full sm:w-[42%] flex-shrink-0">
            <div className="w-full aspect-square bg-[#F8F8FA] rounded-lg flex items-center justify-center p-6 relative overflow-hidden">
              {productImages.length > 0 ? (
                <img src={productImages[activeImageIndex] || productImages[0]} alt={sp.name} className="max-h-full max-w-full object-contain" />
              ) : (
                <Package size={48} className="text-[#D4D4D4]" />
              )}
              {productImages.length > 1 && (
                <>
                  <button className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-white transition-colors shadow-sm" onClick={() => setActiveImageIndex(prev => prev > 0 ? prev - 1 : productImages.length - 1)}>
                    <ChevronLeft size={14} className="text-mt-ink-2" />
                  </button>
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-white transition-colors shadow-sm" onClick={() => setActiveImageIndex(prev => prev < productImages.length - 1 ? prev + 1 : 0)}>
                    <ChevronRight size={14} className="text-mt-ink-2" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnails row */}
            {productImages.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {productImages.map((img, idx) => (
                  <button
                    key={idx}
                    className={`w-16 h-16 rounded flex-shrink-0 flex items-center justify-center p-1.5 cursor-pointer transition-all ${idx === activeImageIndex ? "border-2 bg-[#F8F8FA]" : "border border-mt-border bg-mt-surface hover:border-[#A3A3A3]"}`}
                    style={idx === activeImageIndex ? { borderColor: primaryColor } : {}}
                    onClick={() => setActiveImageIndex(idx)}
                  >
                    <img src={img} alt="" className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {/* SKU + Decoration type tags */}
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {sp.sku && <span className="text-[11px] text-mt-ink-4">SKU: <span className="font-medium text-mt-ink-2">{sp.sku}</span></span>}
              {sp.decorationType && <span className="text-[10px] px-2 py-0.5 border border-mt-border rounded-full text-mt-ink-3">{sp.decorationType}</span>}
              {sp.decorationZone && <span className="text-[10px] px-2 py-0.5 border border-mt-border rounded-full text-mt-ink-3">{sp.decorationZone}</span>}
            </div>
          </div>

          {/* Right: Product details */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[22px] font-bold text-mt-ink mb-1">{sp.name}</h2>
            <p className="text-[22px] font-bold text-mt-ink mb-5">
              $ {currentUnitPrice > 0 ? currentUnitPrice.toFixed(2) : parseFloat(sp.unitPrice || "0").toFixed(2)}
            </p>

            {/* Price Range / Size Chart tabs */}
            {(sp.priceTiers.length > 0 || sp.sizeChart) && (
              <>
                <div className="flex gap-0 mb-2">
                  {sp.priceTiers.length > 0 && (
                    <button className="px-4 py-1.5 text-[12px] font-semibold transition-all" style={activeTab === "price" ? { backgroundColor: primaryColor, color: "#FFF" } : { backgroundColor: "#F5F5F5", color: "#737373" }} onClick={() => setActiveTab("price")}>
                      Price Range
                    </button>
                  )}
                  {sp.sizeChart && (
                    <button className="px-4 py-1.5 text-[12px] font-semibold transition-all" style={activeTab === "size" ? { backgroundColor: primaryColor, color: "#FFF" } : { backgroundColor: "#F5F5F5", color: "#737373" }} onClick={() => setActiveTab("size")}>
                      Size Chart
                    </button>
                  )}
                </div>
                <div className="bg-[#F8F8FA] rounded-md p-3 mb-5 text-[12px] text-mt-ink-2">
                  {activeTab === "price" && sp.priceTiers.length > 0 ? (
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">
                          <th className="pb-1.5">{sp.priceTiers[0]?.tierType === "quantity" ? "Quantity" : "Size Range"}</th>
                          <th className="pb-1.5 text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sp.priceTiers.map(tier => (
                          <tr key={tier.id} className="border-t border-[#E5E5E5]">
                            <td className="py-1.5">{tier.label || `${tier.minQty ?? 0} – ${tier.maxQty ?? "+"}`}</td>
                            <td className="py-1.5 text-right font-semibold">${parseFloat(tier.price).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : sp.sizeChart ? (
                    sp.sizeChart.imageUrl ? (
                      <img src={sp.sizeChart.imageUrl} alt="Size Chart" className="max-w-full object-contain" />
                    ) : sp.sizeChart.chartData?.length > 0 ? (
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">
                            {Object.keys(sp.sizeChart.chartData[0]).map(k => <th key={k} className="pb-1.5 pr-3">{k}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {sp.sizeChart.chartData.map((row, i) => (
                            <tr key={i} className="border-t border-[#E5E5E5]">
                              {Object.values(row).map((v, j) => <td key={j} className="py-1.5 pr-3">{v}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="text-mt-ink-4">No size chart data available.</p>
                  ) : null}
                </div>
              </>
            )}

            {/* Variant selectors */}
            {!expired && (
              <div className="space-y-3 mb-5">
                {sp.colors.length > 0 && (
                  <div>
                    <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Color</label>
                    <select className={selectCls} value={selectedColor} onChange={e => setSelectedColor(e.target.value)}>
                      {sp.colors.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                {sp.sizes.length > 0 && (
                  <div>
                    <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Size</label>
                    <select className={selectCls} value={selectedSize} onChange={e => setSelectedSize(e.target.value)}>
                      {sp.sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {sp.logoPositions.length > 0 && (
                  <div>
                    <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Logo Position</label>
                    <select className={selectCls} value={selectedLogoPosition} onChange={e => setSelectedLogoPosition(e.target.value)}>
                      {sp.logoPositions.map(lp => <option key={lp} value={lp}>{lp}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Quantity + Add to list */}
            {!expired && (
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center border border-mt-border rounded-md overflow-hidden">
                  <button className="w-9 h-9 flex items-center justify-center hover:bg-mt-surface-2" onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus size={14} /></button>
                  <span className="w-10 text-center text-[13px] font-semibold">{quantity}</span>
                  <button className="w-9 h-9 flex items-center justify-center hover:bg-mt-surface-2" onClick={() => setQuantity(q => q + 1)}><Plus size={14} /></button>
                </div>
                <button
                  className="h-10 px-6 bg-[#1A1A1A] text-white text-[12px] font-bold rounded-md hover:bg-[#333] transition-colors active:scale-[0.97]"
                  onClick={handleAdd}
                >
                  Add to list
                </button>
              </div>
            )}

            {/* Message / Comment */}
            {!expired && (
              <div className="mb-3">
                <label className="text-[12px] font-semibold text-mt-ink mb-1.5 block">Message</label>
                <textarea
                  className="w-full h-16 px-3 py-2 text-[13px] border border-mt-border rounded-md outline-none focus:border-[#999] resize-none bg-white text-mt-ink-2"
                  placeholder="Comment your special requirements here."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Product Info / Additional Info tabs */}
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid #F0F0F0" }}>
          <div className="flex gap-0 mb-2">
            {(["product", "additional"] as const).map(tab => (
              <button key={tab}
                className={`px-4 py-1.5 text-[12px] font-semibold transition-all ${infoTab === tab ? "bg-white border border-mt-border border-b-white text-mt-ink -mb-px relative z-10" : "bg-mt-surface-2 text-mt-ink-3 border border-transparent"}`}
                onClick={() => setInfoTab(tab)}
              >
                {tab === "product" ? "Product Info" : "Additional Info"}
              </button>
            ))}
          </div>
          <div className="p-4 bg-[#F8F8FA] rounded-md text-[12px] text-mt-ink-2 leading-relaxed">
            {infoTab === "product"
              ? (sp.description || "No product description available.")
              : (sp.decorationNotes || "Contact your distributor for additional information about production and shipping.")
            }
          </div>
        </div>
      </div>
    </div>
  );
}
