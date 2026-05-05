/**
 * ProposalStep6ReviewSend
 * Step 6 of the Create Proposal wizard — Review & Send
 */

import {
  Users, Package, Send, Mail, Store, Settings, CreditCard, AlertCircle,
  Lock, Loader2, CheckCircle2,
} from "lucide-react";

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  image: string;
  [key: string]: unknown;
}

interface Props {
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  proposalTitle: string;
  proposalType: "promo" | "print" | "both";
  budget: string;
  validDays: number;
  totalValue: number;
  selectedProductList: Product[];
  quantities: Record<number, number>;
  deliverEmail: boolean;
  deliverWebstore: boolean;
  clientHasWebstore: boolean;
  clientWebstoreName: string;
  stripeCheckoutEnabled: boolean;
  multiDeptEnabled: boolean;
  enabledDepts: Set<string>;
  requireSequential: boolean;
  deptOrder: string[];
  departments: Array<{ id: string; name: string }>;
  proofingStarted: boolean;
  proofingStep: number;
  sending: boolean;
  savingDraft: boolean;
  getDisplayImage: (product: Product) => string | null;
  hasApprovedProof: (product: Product) => boolean;
  onSend: () => void;
  onSaveDraft: () => void;
}

export default function ProposalStep6ReviewSend({
  clientName, clientCompany, clientEmail, proposalTitle, proposalType, budget, validDays,
  totalValue, selectedProductList, quantities,
  deliverEmail, deliverWebstore, clientHasWebstore, clientWebstoreName,
  stripeCheckoutEnabled, multiDeptEnabled, enabledDepts, requireSequential, deptOrder, departments,
  proofingStarted, proofingStep,
  sending, savingDraft,
  getDisplayImage, hasApprovedProof,
  onSend, onSaveDraft,
}: Props) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-mt-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-mt-ink mb-0.5">Review &amp; Send</h2>
            <p className="text-[13px] text-mt-ink-3">Confirm all details before sending to {clientName || "client"}</p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold text-mt-ink">${totalValue.toLocaleString()}</p>
            <p className="text-[11px] text-mt-ink-3">Estimated Value</p>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-5 gap-5">
        {/* Left: Details */}
        <div className="col-span-3 space-y-5">
          {/* Client & Proposal Info */}
          <div className="bg-white rounded-xl border border-mt-border p-5">
            <h3 className="text-[13px] font-bold text-mt-ink mb-3 flex items-center gap-2"><Users size={14} className="text-primary" /> Client &amp; Proposal</h3>
            <div className="space-y-2.5">
              {[
                ["Client", `${clientName || "—"} (${clientCompany || "—"})`],
                ["Email", clientEmail || "—"],
                ["Proposal Title", proposalTitle || "—"],
                ["Type", proposalType === "both" ? "Promo + Print" : proposalType === "promo" ? "Promotional" : "Print"],
                ["Budget", budget || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid #F8F8F8' }}>
                  <span className="text-[12px] text-mt-ink-3">{label}</span>
                  <span className="text-[12px] font-semibold text-mt-ink text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Products with thumbnails */}
          <div className="bg-white rounded-xl border border-mt-border p-5">
            <h3 className="text-[13px] font-bold text-mt-ink mb-3 flex items-center gap-2"><Package size={14} className="text-primary" /> Products ({selectedProductList.length})</h3>
            <div className="space-y-2">
              {selectedProductList.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid #F8F8F8' }}>
                  {getDisplayImage(p) ? (
                    <div className="relative">
                      <img src={getDisplayImage(p)!} alt={p.name} className="w-10 h-10 rounded-lg object-contain border border-mt-border bg-mt-surface" />
                      {hasApprovedProof(p) && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#16A34A] rounded-full flex items-center justify-center"><CheckCircle2 size={7} className="text-white" /></span>}
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-mt-surface-2 flex items-center justify-center text-mt-ink-4"><Package size={14} /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-mt-ink truncate">{p.name}</p>
                    <p className="text-[10px] text-mt-ink-4">{p.category} · Qty: {quantities[p.id] || 100}</p>
                  </div>
                  <span className="text-[12px] font-bold text-mt-ink">${((quantities[p.id] || 100) * p.price).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid #E5E5E5' }}>
              <div className="flex justify-between text-[12px] mb-1"><span className="text-mt-ink-3">Subtotal</span><span className="font-semibold text-mt-ink">${totalValue.toLocaleString()}</span></div>
              <div className="flex justify-between text-[12px] mb-1"><span className="text-mt-ink-3">Setup Fees</span><span className="font-semibold text-mt-ink">$50.00</span></div>
              <div className="flex justify-between text-[13px] font-bold mt-2 pt-2" style={{ borderTop: '1px solid #F0F0F0' }}><span>Total</span><span className="text-primary">${(totalValue + 50).toLocaleString()}</span></div>
            </div>
          </div>

          {/* Checkout Flow Preview */}
          {stripeCheckoutEnabled && (
            <div className="bg-white rounded-xl border border-mt-border p-5">
              <h3 className="text-[13px] font-bold text-mt-ink mb-3 flex items-center gap-2"><CreditCard size={14} className="text-[#635BFF]" /> Checkout Preview</h3>
              <div className="bg-[#F7F8FA] rounded-lg border border-mt-border overflow-hidden">
                <div className="bg-[#635BFF] px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock size={10} className="text-white" />
                    <span className="text-[11px] font-semibold text-white">Secure Checkout</span>
                  </div>
                  <span className="text-[10px] text-white/70">Powered by Stripe</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="bg-white rounded-md p-3 border border-mt-border">
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="text-mt-ink font-medium">{proposalTitle || "Proposal"}</span>
                      <span className="font-bold">${(totalValue + 50).toLocaleString()}</span>
                    </div>
                    <p className="text-[9px] text-mt-ink-4">{selectedProductList.length} items · {clientCompany || "Client"}</p>
                  </div>
                  <div className="space-y-2">
                    <div><label className="block text-[9px] font-semibold text-mt-ink-2 mb-0.5">Email</label><div className="px-2.5 py-1.5 text-[11px] border border-mt-border rounded-md bg-white text-mt-ink-4">{clientEmail || "client@email.com"}</div></div>
                    <div><label className="block text-[9px] font-semibold text-mt-ink-2 mb-0.5">Card Number</label>
                      <div className="flex items-center px-2.5 py-1.5 border border-mt-border rounded-md bg-white">
                        <span className="text-[11px] text-mt-ink-4">4242 4242 4242 4242</span>
                        <div className="ml-auto flex gap-1">
                          <div className="w-6 h-4 rounded bg-[#1A1F71] flex items-center justify-center"><span className="text-[5px] text-white font-bold">VISA</span></div>
                          <div className="w-6 h-4 rounded bg-[#EB001B] flex items-center justify-center"><span className="text-[5px] text-white font-bold">MC</span></div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[9px] font-semibold text-mt-ink-2 mb-0.5">Expiry</label><div className="px-2.5 py-1.5 text-[11px] border border-mt-border rounded-md bg-white text-mt-ink-4">12/28</div></div>
                      <div><label className="block text-[9px] font-semibold text-mt-ink-2 mb-0.5">CVC</label><div className="px-2.5 py-1.5 text-[11px] border border-mt-border rounded-md bg-white text-mt-ink-4">•••</div></div>
                    </div>
                  </div>
                  <div className="py-2 rounded-md text-[11px] font-semibold text-white bg-[#635BFF] text-center flex items-center justify-center gap-1.5">
                    <Lock size={10} /> Pay ${(totalValue + 50).toLocaleString()}
                  </div>
                  <p className="text-[8px] text-mt-ink-4 text-center">Preview only — no charges will be made</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Delivery & Features */}
        <div className="col-span-2 space-y-5">
          {/* Delivery Method */}
          <div className="bg-white rounded-xl border border-mt-border p-5">
            <h3 className="text-[13px] font-bold text-mt-ink mb-3 flex items-center gap-2"><Send size={14} className="text-primary" /> Delivery</h3>
            <div className="space-y-2">
              {deliverEmail && (
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-mt-brand-light">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Mail size={14} className="text-primary" /></div>
                  <div>
                    <p className="text-[11px] font-semibold text-primary">Email</p>
                    <p className="text-[10px] text-mt-ink-3">{clientEmail}</p>
                  </div>
                </div>
              )}
              {deliverWebstore && clientHasWebstore && (
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#F0FDF4]">
                  <div className="w-8 h-8 rounded-lg bg-[#16A34A]/10 flex items-center justify-center"><Store size={14} className="text-[#16A34A]" /></div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#16A34A]">Webstore</p>
                    <p className="text-[10px] text-mt-ink-3">{clientWebstoreName}</p>
                  </div>
                </div>
              )}
              {!deliverEmail && !deliverWebstore && (
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#FEF2F2]">
                  <AlertCircle size={14} className="text-[#DC2626]" />
                  <p className="text-[11px] text-[#DC2626] font-medium">No delivery method selected</p>
                </div>
              )}
            </div>
          </div>

          {/* Feature Toggles */}
          <div className="bg-white rounded-xl border border-mt-border p-5">
            <h3 className="text-[13px] font-bold text-mt-ink mb-3 flex items-center gap-2"><Settings size={14} className="text-primary" /> Features</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-mt-ink-3">Stripe Checkout</span>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${stripeCheckoutEnabled ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-mt-surface-2 text-mt-ink-4"}`}>{stripeCheckoutEnabled ? "Enabled" : "Off"}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-mt-ink-3">Multi-Department</span>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${multiDeptEnabled ? "bg-mt-brand-light text-primary" : "bg-mt-surface-2 text-mt-ink-4"}`}>{multiDeptEnabled ? `${enabledDepts.size} Depts` : "Off"}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-mt-ink-3">Virtual Proofs</span>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${proofingStarted && proofingStep >= 4 ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-mt-surface-2 text-mt-ink-4"}`}>{proofingStarted && proofingStep >= 4 ? "Generated" : "Skipped"}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-mt-ink-3">Validity</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">
                  {validDays === 0 ? "No Expiration" : `${validDays} Days`}
                </span>
              </div>
              {multiDeptEnabled && (
                <div className="pt-2 mt-1" style={{ borderTop: '1px solid #F0F0F0' }}>
                  <p className="text-[11px] text-mt-ink-3 mb-1.5">Routing: <span className="font-semibold text-mt-ink">{requireSequential ? "Sequential" : "Parallel"}</span></p>
                  <div className="flex flex-wrap gap-1">
                    {deptOrder.map((id, i) => {
                      const d = departments.find(dep => dep.id === id);
                      return d ? (
                        <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-mt-brand-light text-primary font-medium">
                          {requireSequential && i > 0 ? "→ " : ""}{d.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5">
            <button
              onClick={onSend}
              disabled={sending || (!deliverEmail && !deliverWebstore)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-50 transition-all"
              style={{ backgroundColor: 'var(--mt-brand)' }}
            >
              {sending ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : <><Send size={14} /> Send Proposal</>}
            </button>
            <button
              className="w-full px-6 py-3 rounded-xl text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface transition-all"
              disabled={savingDraft}
              onClick={onSaveDraft}
            >
              {savingDraft ? "Saving..." : "Save as Draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
