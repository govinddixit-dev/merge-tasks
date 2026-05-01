/**
 * ProposalStep5Preview
 * Step 5 of the Create Proposal wizard — End-User Preview
 */

import {
  Eye, Printer, ChevronLeft, ChevronRight, Minus, Plus, ShoppingCart,
  CreditCard, Lock, ArrowLeft, Send, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

const MT_LOGO_URL = "/logo_clean.png";

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  image: string;
  supplier: string;
  [key: string]: unknown;
}

interface Props {
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  proposalTitle: string;
  validDays: number;
  stripeCheckoutEnabled: boolean;
  selectedProductList: Product[];
  quantities: Record<number, number>;
  totalValue: number;
  previewProduct: number;
  setPreviewProduct: (v: number) => void;
  previewQty: number;
  setPreviewQty: (v: number) => void;
  previewCheckoutStep: number;
  setPreviewCheckoutStep: (v: number) => void;
  previewPriceTab: "price" | "size";
  setPreviewPriceTab: (v: "price" | "size") => void;
  getDisplayImage: (product: Product) => string | null;
  hasApprovedProof: (product: Product) => boolean;
  // Distributor branding
  brandLogoUrl?: string | null;
  brandCompanyName?: string | null;
  brandPrimaryColor?: string;
}

export default function ProposalStep5Preview({
  clientName, clientCompany, clientEmail, proposalTitle, validDays,
  stripeCheckoutEnabled, selectedProductList, quantities, totalValue,
  previewProduct, setPreviewProduct, previewQty, setPreviewQty,
  previewCheckoutStep, setPreviewCheckoutStep,
  previewPriceTab, setPreviewPriceTab,
  getDisplayImage, hasApprovedProof,
  brandLogoUrl, brandCompanyName, brandPrimaryColor = "var(--mt-brand)",
}: Props) {
  const logoUrl = brandLogoUrl || MT_LOGO_URL;
  const logoAlt = brandCompanyName || "MergeTasks";
  const currentPreviewProduct = selectedProductList[previewProduct] || selectedProductList[0];

  return (
    <div className="space-y-4">
      <div className="bg-[#FFF7ED] border border-[#FDBA74] rounded-lg px-4 py-3 flex items-center gap-3">
        <Eye size={16} className="text-[#D97706] flex-shrink-0" />
        <div>
          <p className="text-[13px] font-semibold text-[#92400E]">End-User Preview</p>
          <p className="text-[11px] text-[#B45309]">
            This is exactly what {clientName || "the client"} will see when they open the proposal.
            {stripeCheckoutEnabled && " Stripe checkout flow is shown below."}
          </p>
        </div>
      </div>

      {/* Simulated Client View */}
      <div className="bg-white rounded-xl border-2 border-dashed border-mt-border-2 overflow-hidden">
        {/* Proposal Header */}
        <div className="bg-mt-surface border-b border-mt-border p-6">
          <div className="flex items-center justify-center mb-4">
            <img src={logoUrl} alt={logoAlt} className="h-10 object-contain" />
          </div>
          <div className="bg-white rounded-lg border border-mt-border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[16px] font-bold text-mt-ink">{proposalTitle || "Untitled Proposal"}</h3>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#16A34A] text-white">
                {validDays === 0 ? "No Expiration" : `Valid ${validDays} Days`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-1 text-[12px]">
              <div className="flex gap-8"><span className="text-mt-ink-3 w-16">Name</span><span className="text-mt-ink font-medium">{clientName || "—"}</span></div>
              <div className="flex gap-8"><span className="text-mt-ink-3 w-16">Date</span><span className="text-mt-ink font-medium">{new Date().toLocaleDateString()}</span></div>
              <div className="flex gap-8"><span className="text-mt-ink-3 w-16">Company</span><span className="text-mt-ink font-medium">{clientCompany || "—"}</span></div>
              <div className="flex gap-8"><span className="text-mt-ink-3 w-16">Email</span><span className="text-mt-ink font-medium">{clientEmail || "—"}</span></div>
            </div>
          </div>
        </div>

        {/* Product Browsing View */}
        {previewCheckoutStep === 0 && (
          <div className="p-6">
            <div className="flex items-center justify-end mb-6">
              <button className="px-4 py-2 rounded-lg text-[11px] font-semibold text-white" style={{ backgroundColor: "#DC2626" }}>Add all to list</button>
            </div>

            {currentPreviewProduct && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="relative">
                    {(() => {
                      const displayImg = getDisplayImage(currentPreviewProduct);
                      const isProof = hasApprovedProof(currentPreviewProduct);
                      return displayImg ? (
                        <div className="w-full bg-[#F8F8FA] rounded-xl flex items-center justify-center p-4 relative" style={{ height: 280 }}>
                          <img src={displayImg} alt={currentPreviewProduct.name} className="max-h-full max-w-full object-contain" />
                          {isProof && (
                            <span className="absolute top-3 right-3 text-[9px] font-bold px-2 py-1 rounded-full bg-[#16A34A] text-white flex items-center gap-1">
                              <CheckCircle2 size={10} /> Virtual Proof
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="w-full bg-gradient-to-br from-[#F5F3FF] to-[#EEF2FF] rounded-xl flex items-center justify-center" style={{ height: 280 }}>
                          <Printer size={40} className="text-primary" />
                        </div>
                      );
                    })()}
                    {selectedProductList.length > 1 && (
                      <>
                        <button onClick={() => setPreviewProduct(previewProduct > 0 ? previewProduct - 1 : selectedProductList.length - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 border border-mt-border flex items-center justify-center hover:bg-white transition-all shadow-sm"><ChevronLeft size={14} className="text-mt-ink-2" /></button>
                        <button onClick={() => setPreviewProduct(previewProduct < selectedProductList.length - 1 ? previewProduct + 1 : 0)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 border border-mt-border flex items-center justify-center hover:bg-white transition-all shadow-sm"><ChevronRight size={14} className="text-mt-ink-2" /></button>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {selectedProductList.slice(0, 6).map((p, i) => (
                      <button key={p.id} onClick={() => setPreviewProduct(i)} className={`w-10 h-10 rounded-md border-2 flex items-center justify-center p-0.5 transition-all ${i === previewProduct ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}>
                        {getDisplayImage(p) ? <img src={getDisplayImage(p)!} alt="" className="h-full w-full object-contain" /> : <Printer size={10} className="text-mt-ink-4" />}
                      </button>
                    ))}
                    {selectedProductList.length > 6 && (
                      <span className="w-10 h-10 rounded-md border border-mt-border flex items-center justify-center text-[9px] font-semibold text-mt-ink-3">+{selectedProductList.length - 6}</span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-[18px] font-bold text-mt-ink">{currentPreviewProduct.name}</h3>
                  <p className="text-[16px] font-semibold text-mt-ink">$ {currentPreviewProduct.price.toFixed(2)}</p>

                  {/* Price Range / Size Chart Tabs */}
                  <div className="border border-mt-border rounded-lg overflow-hidden">
                    <div className="flex border-b border-mt-border">
                      <button onClick={() => setPreviewPriceTab("price")} className={`flex-1 py-2 text-[11px] font-semibold transition-colors ${previewPriceTab === "price" ? "text-white bg-[#1A1A1A]" : "text-mt-ink-3 bg-mt-surface hover:bg-[#F0F0F0]"}`}>Price Range</button>
                      <button onClick={() => setPreviewPriceTab("size")} className={`flex-1 py-2 text-[11px] font-semibold transition-colors ${previewPriceTab === "size" ? "text-white bg-[#1A1A1A]" : "text-mt-ink-3 bg-mt-surface hover:bg-[#F0F0F0]"}`}>Size Chart</button>
                    </div>
                    <div className="text-[11px]">
                      {previewPriceTab === "price" ? (
                        <>
                          <div className="grid grid-cols-3 gap-0 px-3 py-1.5 bg-mt-surface-2 font-semibold text-mt-ink-3"><span>QUANTITY</span><span>UNIT PRICE</span><span>SETUP FEE</span></div>
                          {[
                            { q: "1–49", p: currentPreviewProduct.price.toFixed(2), f: "$50.00" },
                            { q: "50–99", p: (currentPreviewProduct.price * 0.9).toFixed(2), f: "Waived" },
                            { q: "100–499", p: (currentPreviewProduct.price * 0.82).toFixed(2), f: "Waived" },
                            { q: "500+", p: (currentPreviewProduct.price * 0.75).toFixed(2), f: "Waived" },
                          ].map((r, i) => (
                            <div key={i} className="grid grid-cols-3 gap-0 px-3 py-1.5 border-t border-[#F5F5F5] text-mt-ink"><span>{r.q}</span><span>${r.p}</span><span>{r.f}</span></div>
                          ))}
                        </>
                      ) : (
                        <>
                          {currentPreviewProduct.category === "Apparel" ? (
                            <>
                              <div className="grid grid-cols-4 gap-0 px-3 py-1.5 bg-mt-surface-2 font-semibold text-mt-ink-3"><span>SIZE</span><span>CHEST</span><span>WAIST</span><span>LENGTH</span></div>
                              {[
                                { s: "S", c: '34–36"', w: '28–30"', l: '28"' },
                                { s: "M", c: '38–40"', w: '32–34"', l: '29"' },
                                { s: "L", c: '42–44"', w: '36–38"', l: '30"' },
                                { s: "XL", c: '46–48"', w: '40–42"', l: '31"' },
                                { s: "2XL", c: '50–52"', w: '44–46"', l: '32"' },
                              ].map((r, i) => (
                                <div key={i} className="grid grid-cols-4 gap-0 px-3 py-1.5 border-t border-[#F5F5F5] text-mt-ink"><span>{r.s}</span><span>{r.c}</span><span>{r.w}</span><span>{r.l}</span></div>
                              ))}
                            </>
                          ) : (
                            <div className="px-3 py-4 text-center text-mt-ink-3">One size — see product specifications for dimensions.</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Dropdowns */}
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-1">Color</p><select className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg bg-white"><option>Black</option><option>Navy</option><option>White</option></select></div>
                    <div><p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-1">Size</p><select className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg bg-white"><option>Medium</option><option>Small</option><option>Large</option><option>XL</option></select></div>
                  </div>
                  <div><p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-1">Logo Position</p><select className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg bg-white"><option>Front Cover</option><option>Back Cover</option><option>Left Chest</option></select></div>

                  {/* Quantity & Add */}
                  <div className="flex items-center gap-4">
                    <span className="text-[11px] text-[#16A34A] font-medium">450 in stock</span>
                    <div className="flex items-center border border-mt-border rounded-lg">
                      <button onClick={() => setPreviewQty(Math.max(1, previewQty - 1))} className="px-2.5 py-1.5 text-mt-ink-3 hover:text-mt-ink"><Minus size={12} /></button>
                      <span className="px-3 py-1.5 text-[12px] font-semibold border-x border-mt-border min-w-[40px] text-center">{previewQty}</span>
                      <button onClick={() => setPreviewQty(previewQty + 1)} className="px-2.5 py-1.5 text-mt-ink-3 hover:text-mt-ink"><Plus size={12} /></button>
                    </div>
                    <button onClick={() => toast.success("Added to order list")} className="px-5 py-2 rounded-lg text-[12px] font-semibold text-white bg-[#1A1A1A]">Add to list</button>
                  </div>

                  {/* Message */}
                  <div>
                    <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-1">Message</p>
                    <textarea className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg resize-none h-16" placeholder="Comment your special requirements here." readOnly />
                  </div>
                </div>
              </div>
            )}

            {/* All Products Carousel */}
            <div className="mt-6">
              <h4 className="text-[13px] font-bold text-mt-ink mb-2">All Products ({selectedProductList.length})</h4>
              <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                {selectedProductList.map((p, i) => (
                  <button key={p.id} onClick={() => setPreviewProduct(i)} className={`flex-shrink-0 w-20 p-1.5 rounded-lg border-2 text-center transition-all ${i === previewProduct ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}>
                    {getDisplayImage(p) ? <div className="w-full h-12 flex items-center justify-center mb-1"><img src={getDisplayImage(p)!} alt="" className="h-full object-contain" /></div> : <div className="w-full h-12 flex items-center justify-center mb-1 bg-mt-brand-light rounded"><Printer size={12} className="text-primary" /></div>}
                    <p className="text-[8px] font-semibold text-mt-ink truncate leading-tight">{p.name}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Checkout CTA */}
            <div className="mt-8 p-5 bg-mt-brand-light rounded-xl text-center">
              <h4 className="text-[15px] font-bold text-mt-ink mb-2">Ready to place your order?</h4>
              <p className="text-[12px] text-mt-ink-3 mb-4">{selectedProductList.length} items · Est. ${totalValue.toLocaleString()}</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => setPreviewCheckoutStep(1)} className="px-6 py-2.5 rounded-lg text-[12px] font-semibold text-white" style={{ backgroundColor: brandPrimaryColor }}>
                  <ShoppingCart size={14} className="inline mr-2" />View Order Summary
                </button>
                {stripeCheckoutEnabled && (
                  <button onClick={() => setPreviewCheckoutStep(2)} className="px-6 py-2.5 rounded-lg text-[12px] font-semibold text-white bg-[#635BFF]">
                    <CreditCard size={14} className="inline mr-2" />Checkout with Stripe
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Cart / Order Summary View */}
        {previewCheckoutStep === 1 && (
          <div className="p-6 space-y-4">
            <button onClick={() => setPreviewCheckoutStep(0)} className="flex items-center gap-2 text-[12px] text-primary font-semibold hover:underline"><ArrowLeft size={14} /> Back to Products</button>
            <h3 className="text-[16px] font-bold text-mt-ink">Order Summary</h3>
            <div className="space-y-3">
              {selectedProductList.map(p => (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-mt-surface rounded-lg">
                  {getDisplayImage(p) ? (
                    <div className="w-14 h-14 flex items-center justify-center bg-white rounded-lg p-1 relative">
                      <img src={getDisplayImage(p)!} alt="" className="h-full object-contain" />
                      {hasApprovedProof(p) && <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#16A34A] rounded-full flex items-center justify-center"><CheckCircle2 size={8} className="text-white" /></span>}
                    </div>
                  ) : (
                    <div className="w-14 h-14 flex items-center justify-center bg-mt-brand-light rounded-lg"><Printer size={16} className="text-primary" /></div>
                  )}
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-mt-ink">{p.name}</p>
                    <p className="text-[11px] text-mt-ink-3">Qty: {quantities[p.id] || 100} · ${p.price.toFixed(2)} each</p>
                  </div>
                  <p className="text-[13px] font-bold text-mt-ink">${((quantities[p.id] || 100) * p.price).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-mt-border pt-4 space-y-2">
              <div className="flex justify-between text-[12px]"><span className="text-mt-ink-3">Subtotal</span><span className="font-semibold text-mt-ink">${totalValue.toLocaleString()}</span></div>
              <div className="flex justify-between text-[12px]"><span className="text-mt-ink-3">Setup Fees</span><span className="font-semibold text-mt-ink">$50.00</span></div>
              <div className="flex justify-between text-[14px] font-bold border-t border-mt-border pt-2"><span>Total</span><span>${(totalValue + 50).toLocaleString()}</span></div>
            </div>
            {stripeCheckoutEnabled ? (
              <button onClick={() => setPreviewCheckoutStep(2)} className="w-full py-3 rounded-lg text-[13px] font-semibold text-white bg-[#635BFF] flex items-center justify-center gap-2">
                <CreditCard size={14} /> Proceed to Stripe Checkout
              </button>
            ) : (
              <button onClick={() => toast.success("Order submitted for approval")} className="w-full py-3 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--mt-brand)' }}>
                <Send size={14} /> Submit Order for Approval
              </button>
            )}
          </div>
        )}

        {/* Stripe Checkout Preview */}
        {previewCheckoutStep === 2 && stripeCheckoutEnabled && (
          <div className="p-6 space-y-4">
            <button onClick={() => setPreviewCheckoutStep(1)} className="flex items-center gap-2 text-[12px] text-primary font-semibold hover:underline"><ArrowLeft size={14} /> Back to Order Summary</button>
            <div className="max-w-lg mx-auto">
              <div className="bg-[#F7F8FA] rounded-xl border border-mt-border overflow-hidden">
                <div className="bg-[#635BFF] px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center"><Lock size={12} className="text-white" /></div>
                    <span className="text-[13px] font-semibold text-white">Secure Checkout</span>
                  </div>
                  <span className="text-[12px] text-white/80">Powered by Stripe</span>
                </div>
                <div className="p-6 space-y-5">
                  <div className="bg-white rounded-lg p-4 border border-mt-border">
                    <p className="text-[11px] font-semibold text-mt-ink-3 uppercase mb-2">Order Summary</p>
                    <div className="flex justify-between text-[13px] mb-1"><span className="text-mt-ink">{proposalTitle || "Proposal"}</span><span className="font-bold">${(totalValue + 50).toLocaleString()}</span></div>
                    <p className="text-[10px] text-mt-ink-4">{selectedProductList.length} items · {clientCompany || "Client"}</p>
                  </div>
                  <div className="space-y-3">
                    <div><label className="block text-[11px] font-semibold text-mt-ink-2 mb-1">Email</label><input className="w-full px-3 py-2.5 text-[12px] border border-mt-border rounded-lg bg-white" value={clientEmail} readOnly /></div>
                    <div>
                      <label className="block text-[11px] font-semibold text-mt-ink-2 mb-1">Card Number</label>
                      <div className="flex items-center px-3 py-2.5 border border-mt-border rounded-lg bg-white">
                        <span className="text-[12px] text-mt-ink-4">4242 4242 4242 4242</span>
                        <div className="ml-auto flex gap-1">
                          <div className="w-8 h-5 rounded bg-[#1A1F71] flex items-center justify-center"><span className="text-[7px] text-white font-bold">VISA</span></div>
                          <div className="w-8 h-5 rounded bg-[#EB001B] flex items-center justify-center"><span className="text-[7px] text-white font-bold">MC</span></div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-[11px] font-semibold text-mt-ink-2 mb-1">Expiry</label><input className="w-full px-3 py-2.5 text-[12px] border border-mt-border rounded-lg bg-white" value="12/28" readOnly /></div>
                      <div><label className="block text-[11px] font-semibold text-mt-ink-2 mb-1">CVC</label><input className="w-full px-3 py-2.5 text-[12px] border border-mt-border rounded-lg bg-white" value="•••" readOnly /></div>
                    </div>
                  </div>
                  <button onClick={() => toast.success("Payment preview — this is what the client will see")} className="w-full py-3 rounded-lg text-[13px] font-semibold text-white bg-[#635BFF] flex items-center justify-center gap-2">
                    <Lock size={12} /> Pay ${(totalValue + 50).toLocaleString()}
                  </button>
                  <p className="text-[10px] text-mt-ink-4 text-center">This is a preview of the Stripe checkout experience. No charges will be made.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
