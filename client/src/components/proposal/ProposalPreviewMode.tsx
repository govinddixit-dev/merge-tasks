/**
 * ProposalPreviewMode
 * Client-facing storefront preview rendered inside ProposalEditor when previewMode=true.
 * Mirrors the PDF-template layout the client sees.
 */

import { EyeOff, ShoppingCart, X, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

const LOGO_URL = "/logo_clean.png";

export interface PreviewProduct {
  id: number; name: string; price: number; category: string; image: string;
  colors: string[]; sizes: string[]; logoPositions: string[];
  stock: number; sku: string; tags: string[];
  description: string; shippingInfo: string; decoration: string;
}

export interface OrderItem {
  product: PreviewProduct;
  qty: number;
  color: string;
  size: string;
  logoPos: string;
}

interface Props {
  title: string;
  clientContact: string;
  clientEmail: string;
  validDays: number;
  pvProducts: PreviewProduct[];
  pvSelected: PreviewProduct | null;
  pvActiveTab: "price" | "size";
  pvInfoTab: "product" | "additional";
  pvColor: string;
  pvSize: string;
  pvLogo: string;
  pvQty: number;
  pvOrderItems: OrderItem[];
  pvShowSummary: boolean;
  pvMessage: string;
  selectCls: string;
  onExitPreview: () => void;
  onSelectProduct: (p: PreviewProduct) => void;
  onAddToList: () => void;
  onAddAllToList: () => void;
  onRemoveItem: (idx: number) => void;
  onSetPvActiveTab: (t: "price" | "size") => void;
  onSetPvInfoTab: (t: "product" | "additional") => void;
  onSetPvColor: (v: string) => void;
  onSetPvSize: (v: string) => void;
  onSetPvLogo: (v: string) => void;
  onSetPvQty: (v: number) => void;
  onSetPvShowSummary: (v: boolean) => void;
  onSetPvMessage: (v: string) => void;
}

export default function ProposalPreviewMode({
  title, clientContact, clientEmail, validDays,
  pvProducts, pvSelected, pvActiveTab, pvInfoTab,
  pvColor, pvSize, pvLogo, pvQty,
  pvOrderItems, pvShowSummary, pvMessage,
  selectCls,
  onExitPreview, onSelectProduct, onAddToList, onAddAllToList, onRemoveItem,
  onSetPvActiveTab, onSetPvInfoTab, onSetPvColor, onSetPvSize, onSetPvLogo,
  onSetPvQty, onSetPvShowSummary, onSetPvMessage,
}: Props) {
  const pvSubtotal = pvOrderItems.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const sp = pvSelected;

  return (
    <div className="min-h-screen bg-mt-surface">
      {/* Preview Banner */}
      <div className="sticky top-0 z-50 px-6 py-2.5 bg-[#FEF3C7] border-b border-[#FDE68A] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[#92400E]">Preview Mode — This is how the client will see your proposal</span>
        </div>
        <button onClick={onExitPreview} className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold text-primary bg-white border border-mt-border hover:border-primary transition-all rounded-md">
          <EyeOff size={12} /> Exit Preview
        </button>
      </div>

      <div className="max-w-[960px] mx-auto px-6 py-8">
        {/* Logo */}
        <div className="text-center mb-4">
          <img src={LOGO_URL} alt="MergeTasks" className="h-7 mx-auto object-contain" />
        </div>

        {/* Proposal Header Card */}
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
          <div className="px-5 py-3 bg-[#F8F8FA] flex items-center justify-between" style={{ borderBottom: "1px solid #E5E5E5" }}>
            <h2 className="text-[14px] font-bold text-mt-ink">{title}</h2>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: validDays === 0 ? "var(--mt-brand)" : "#16A34A" }}>
              {validDays === 0 ? "No Expiration" : `Valid ${validDays} Days`}
            </span>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
            <div className="space-y-1.5">
              {[["Name", clientContact || "—"], ["Company", "—"], ["Address", "Contact for address"]].map(([label, val]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-[11px] font-semibold text-mt-ink w-[70px] flex-shrink-0">{label}</span>
                  <span className="text-[11px] text-mt-ink-2">{val}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {[["Date", new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })], ["Phone", "(—) —"], ["Email", clientEmail || "—"]].map(([label, val]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-[11px] font-semibold text-mt-ink w-[50px] flex-shrink-0">{label}</span>
                  <span className="text-[11px] text-mt-ink-2">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add All Button */}
        <div className="flex items-center justify-end mb-5">
          <button className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold text-white rounded-md" style={{ backgroundColor: 'var(--mt-brand)' }} onClick={onAddAllToList}>
            Add all to list
          </button>
        </div>

        {/* Product Detail */}
        {sp && (
          <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-5">
            <div className="p-5">
              <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 mb-3 border border-mt-border text-mt-ink-3">{sp.category}</span>
              <div className="flex gap-6">
                {/* Image */}
                <div className="w-[42%] flex-shrink-0">
                  <div className="w-full aspect-square bg-[#F8F8FA] rounded-lg flex items-center justify-center p-8">
                    <img src={sp.image} alt={sp.name} className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {[0, 1, 2].map(n => (
                      <div key={n} className={`w-14 h-14 rounded flex items-center justify-center p-1.5 cursor-pointer transition-all ${n === 0 ? "border-2 border-primary bg-[#F8F8FA]" : "border border-mt-border bg-mt-surface"}`}>
                        <img src={sp.image} alt="" className="max-h-full max-w-full object-contain opacity-80" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-[18px] font-bold text-mt-ink mb-0.5">{sp.name}</h2>
                  <p className="text-[18px] font-bold text-mt-ink mb-4">$ {sp.price.toFixed(2)}</p>

                  {/* Price / Size Tabs */}
                  <div className="flex gap-0 mb-2">
                    {(["price", "size"] as const).map(tab => (
                      <button key={tab} className={`px-3.5 py-1.5 text-[11px] font-semibold transition-all ${pvActiveTab === tab ? "bg-[#1A1A1A] text-white" : "bg-mt-surface-2 text-mt-ink-3"}`} onClick={() => onSetPvActiveTab(tab)}>
                        {tab === "price" ? "Price Range" : "Size Chart"}
                      </button>
                    ))}
                  </div>

                  <div className="bg-[#F8F8FA] rounded-md p-3 mb-4 text-[11px] text-mt-ink-2">
                    {pvActiveTab === "price" ? (
                      <table className="w-full">
                        <thead><tr className="text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"><th className="pb-1.5">Quantity</th><th className="pb-1.5">Unit Price</th><th className="pb-1.5">Setup Fee</th></tr></thead>
                        <tbody className="text-[11px] text-mt-ink-2">
                          <tr><td className="py-0.5">1–49</td><td>${sp.price.toFixed(2)}</td><td>$50.00</td></tr>
                          <tr><td className="py-0.5">50–99</td><td>${(sp.price * 0.9).toFixed(2)}</td><td>Waived</td></tr>
                          <tr><td className="py-0.5">100–499</td><td>${(sp.price * 0.82).toFixed(2)}</td><td>Waived</td></tr>
                          <tr><td className="py-0.5">500+</td><td>${(sp.price * 0.75).toFixed(2)}</td><td>Waived</td></tr>
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full">
                        <thead><tr className="text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"><th className="pb-1.5">Size</th><th className="pb-1.5">Chest</th><th className="pb-1.5">Waist</th><th className="pb-1.5">Length</th></tr></thead>
                        <tbody className="text-[11px] text-mt-ink-2">
                          <tr><td className="py-0.5">S</td><td>34–36"</td><td>28–30"</td><td>28"</td></tr>
                          <tr><td className="py-0.5">M</td><td>38–40"</td><td>32–34"</td><td>29"</td></tr>
                          <tr><td className="py-0.5">L</td><td>42–44"</td><td>36–38"</td><td>30"</td></tr>
                          <tr><td className="py-0.5">XL</td><td>46–48"</td><td>40–42"</td><td>31"</td></tr>
                          <tr><td className="py-0.5">2XL</td><td>50–52"</td><td>44–46"</td><td>32"</td></tr>
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Selects */}
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 mb-4">
                    <div><label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Color</label><select className={selectCls} value={pvColor} onChange={(e) => onSetPvColor(e.target.value)}>{sp.colors.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div><label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Size</label><select className={selectCls} value={pvSize} onChange={(e) => onSetPvSize(e.target.value)}>{sp.sizes.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div><label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Logo Position</label><select className={selectCls} value={pvLogo} onChange={(e) => onSetPvLogo(e.target.value)}>{sp.logoPositions.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                  </div>

                  {/* Qty & Add */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-[11px] font-semibold text-[#16A34A]">{sp.stock} in stock</span>
                    <div className="flex items-center border border-mt-border rounded-md overflow-hidden h-9">
                      <button className="px-2.5 h-full text-mt-ink-3 hover:text-mt-ink border-r border-mt-border" onClick={() => onSetPvQty(Math.max(1, pvQty - 1))}><Minus size={12} /></button>
                      <span className="px-3 text-[12px] font-semibold">{pvQty}</span>
                      <button className="px-2.5 h-full text-mt-ink-3 hover:text-mt-ink border-l border-mt-border" onClick={() => onSetPvQty(pvQty + 1)}><Plus size={12} /></button>
                    </div>
                    <button onClick={onAddToList} className="px-5 py-2 text-[12px] font-bold text-white rounded-md" style={{ backgroundColor: "#1A1A1A" }}>Add to list</button>
                  </div>

                  {/* Info Tabs */}
                  <div className="flex gap-0 mb-2">
                    {(["product", "additional"] as const).map(tab => (
                      <button key={tab} className={`px-3.5 py-1.5 text-[11px] font-semibold transition-all ${pvInfoTab === tab ? "bg-[#1A1A1A] text-white" : "bg-mt-surface-2 text-mt-ink-3"}`} onClick={() => onSetPvInfoTab(tab)}>
                        {tab === "product" ? "Product Info" : "Additional Info"}
                      </button>
                    ))}
                  </div>
                  <div className="bg-[#F8F8FA] rounded-md p-3 text-[11px] text-mt-ink-2 leading-relaxed">
                    {pvInfoTab === "product" ? sp.description : sp.shippingInfo}
                  </div>

                  {/* Message */}
                  <div className="mt-4">
                    <label className="text-[10px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-1 block">Message</label>
                    <textarea className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-md resize-none h-16 focus:border-primary focus:outline-none" placeholder="Comment your special requirements here." value={pvMessage} onChange={(e) => onSetPvMessage(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Product Thumbnails */}
        {pvProducts.length > 1 && (
          <div className="bg-white rounded-lg border border-mt-border p-4 mb-5">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {pvProducts.map(p => (
                <button key={p.id} onClick={() => onSelectProduct(p)} className={`flex-shrink-0 w-20 p-1.5 rounded-lg border-2 text-center transition-all ${pvSelected?.id === p.id ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}>
                  <div className="w-full h-12 flex items-center justify-center mb-1">
                    <img src={p.image} alt="" className="h-full object-contain" />
                  </div>
                  <p className="text-[8px] font-semibold text-mt-ink truncate leading-tight">{p.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="text-center py-8">
          <h2 className="text-[24px] font-bold text-mt-ink mb-1">Ready to <span className="font-black">PLACE ORDER?</span></h2>
          <button className="mt-3 px-7 py-2.5 border-2 border-[#1A1A1A] text-[12px] font-bold text-mt-ink rounded-full hover:bg-[#1A1A1A] hover:text-white transition-all inline-flex items-center gap-2" onClick={() => toast.success("Order submitted")}>Submit <span className="text-base">→</span></button>
        </div>
        <div className="text-center pb-6 pt-4 border-t border-mt-border">
          <p className="text-[10px] text-mt-ink-4">Terms & Conditions · Privacy Policy</p>
          <p className="text-[10px] text-mt-ink-4 mt-1">Prepared by MergeTasks · Confidential</p>
        </div>
      </div>

      {/* Floating Cart Tab */}
      {pvOrderItems.length > 0 && !pvShowSummary && (
        <button className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-primary text-white px-2 py-5 rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }} onClick={() => onSetPvShowSummary(true)}>
          <span className="text-[10px] font-bold tracking-wider flex items-center gap-1.5"><ShoppingCart size={11} /> Show Order Summary ({pvOrderItems.length})</span>
        </button>
      )}

      {/* Order Summary Drawer */}
      {pvShowSummary && (
        <div className="fixed inset-0 z-[10002] flex justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)" }} onClick={() => onSetPvShowSummary(false)}>
          <div className="w-full sm:w-[380px] h-full bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #E5E5E5" }}>
              <h3 className="text-[14px] font-bold text-mt-ink">Order List Summary</h3>
              <button className="p-1 hover:bg-mt-surface-2 rounded-lg transition-colors" onClick={() => onSetPvShowSummary(false)}><X size={14} className="text-mt-ink-4" /></button>
            </div>
            <div className="px-5 py-3">
              {pvOrderItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid #F5F5F5" }}>
                  <div className="w-12 h-12 bg-[#F8F8FA] rounded flex items-center justify-center p-1.5 flex-shrink-0"><img src={item.product.image} alt="" className="max-h-full max-w-full object-contain" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-mt-ink truncate">{item.product.name} <span className="text-mt-ink-4 font-normal">× {item.qty}</span></p>
                    <p className="text-[10px] text-mt-ink-4">{item.color} · {item.size}</p>
                  </div>
                  <span className="text-[12px] font-bold text-mt-ink flex-shrink-0">${(item.product.price * item.qty).toFixed(2)}</span>
                  <button onClick={() => onRemoveItem(idx)} className="p-1 text-[#D4D4D4] hover:text-[#EF4444] transition-colors"><X size={12} /></button>
                </div>
              ))}
            </div>
            <div className="px-5 py-4" style={{ borderTop: "1px solid #E5E5E5" }}>
              <div className="flex items-center justify-between mb-4"><span className="text-[13px] font-bold text-mt-ink">Sub Total</span><span className="text-[18px] font-bold text-mt-ink">$ {pvSubtotal.toFixed(2)}</span></div>
              <button className="w-full py-2.5 bg-[#1A1A1A] text-white text-[12px] font-bold rounded-lg hover:bg-[#333] transition-colors flex items-center justify-center gap-2" onClick={() => { onSetPvShowSummary(false); toast.success("Order submitted"); }}>Submit Order →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
