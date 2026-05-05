/**
 * ProposalProofingPanel
 * Right-side AI Virtual Proofing panel used inside ProposalEditor.
 */

import {
  Wand2, ChevronUp, ChevronDown, CheckCircle2, RefreshCw, Image,
  Palette, Sparkles, Download,
} from "lucide-react";
import { toast } from "sonner";

interface EditorProduct {
  name: string;
  sku: string;
  qty: number;
  price: number;
  decoration: string | string[];
  imageUrl?: string;
  proofUrl?: string;
  proofStatus?: "none" | "generating" | "ready";
  dbProductId?: number;
}

interface ProofEntry {
  productName?: string;
  decorationMethod?: string;
  status?: string;
}

interface Props {
  products: EditorProduct[];
  proofingOpen: boolean;
  selectedProofProduct: number;
  proofGenerating: boolean;
  proofHistory: { product: string; timestamp: string; status: string }[];
  dbProofs: ProofEntry[];
  onToggleOpen: () => void;
  onSelectProduct: (idx: number) => void;
  onOpenStudio: () => void;
}

export default function ProposalProofingPanel({
  products, proofingOpen, selectedProofProduct, proofGenerating, proofHistory, dbProofs,
  onToggleOpen, onSelectProduct, onOpenStudio,
}: Props) {
  const readyCount = products.filter(p => p.proofStatus === "ready").length;
  const current = products[selectedProofProduct];

  return (
    <div className="hidden lg:block w-[320px] lg:flex-shrink-0">
      <div className="bg-white border border-mt-border sticky top-4">
        {/* Header toggle */}
        <button onClick={onToggleOpen} className="w-full flex items-center justify-between p-4 border-b border-[#F0F0F0]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center" style={{ backgroundColor: "rgba(101,75,249,0.08)" }}>
              <Wand2 size={14} style={{ color: 'var(--mt-brand)' }} />
            </div>
            <div className="text-left">
              <p className="text-[13px] font-bold text-mt-ink">AI Virtual Proofing</p>
              <p className="text-[10px] text-[#A1A1AA]">{readyCount}/{products.length} proofs ready</p>
            </div>
          </div>
          {proofingOpen ? <ChevronUp size={14} className="text-[#A1A1AA]" /> : <ChevronDown size={14} className="text-[#A1A1AA]" />}
        </button>

        {proofingOpen && (
          <div className="p-4 space-y-4">
            {/* Product selector */}
            <div>
              <label className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase block mb-2">Select Product</label>
              <div className="space-y-1">
                {products.map((p, idx) => (
                  <button key={idx} onClick={() => onSelectProduct(idx)} className="w-full flex items-center justify-between p-2 text-left transition-colors" style={{ backgroundColor: selectedProofProduct === idx ? "rgba(101,75,249,0.04)" : "transparent", border: `1px solid ${selectedProofProduct === idx ? "rgba(101,75,249,0.2)" : "#F0F0F0"}` }}>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-mt-ink truncate">{p.name}</p>
                      <p className="text-[10px] text-[#A1A1AA]">{Array.isArray(p.decoration) ? p.decoration.join(", ") : p.decoration}</p>
                    </div>
                    {p.proofStatus === "ready"
                      ? <CheckCircle2 size={14} className="text-[#16A34A] flex-shrink-0" />
                      : <div className="w-3 h-3 border border-mt-border-2 flex-shrink-0" />
                    }
                  </button>
                ))}
                {products.length === 0 && (
                  <p className="text-[11px] text-[#D4D4D4] text-center py-3">Add products to generate proofs</p>
                )}
              </div>
            </div>

            {/* Proof canvas */}
            <div className="aspect-square bg-mt-surface border border-[#F0F0F0] flex items-center justify-center relative overflow-hidden">
              {proofGenerating ? (
                <div className="text-center">
                  <RefreshCw size={24} className="text-primary animate-spin mx-auto mb-2" />
                  <p className="text-[11px] font-semibold text-primary">Generating proof...</p>
                  <p className="text-[10px] text-[#A1A1AA] mt-1">AI rendering mockup</p>
                </div>
              ) : current?.proofStatus === "ready" ? (
                <div className="text-center">
                  {current.proofUrl ? (
                    <img src={current.proofUrl} alt="Proof" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-primary to-[#8B5CF6] flex items-center justify-center">
                      <Image size={28} className="text-white" />
                    </div>
                  )}
                  <p className="text-[12px] font-semibold text-mt-ink">{current.name}</p>
                  <p className="text-[10px] text-[#A1A1AA] mt-0.5">with {Array.isArray(current.decoration) ? current.decoration.join(", ") : current.decoration}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 mt-2">
                    <CheckCircle2 size={10} /> Proof Ready
                  </span>
                </div>
              ) : (
                <div className="text-center">
                  <Palette size={24} className="text-[#D4D4D4] mx-auto mb-2" />
                  <p className="text-[11px] text-[#A1A1AA]">No proof generated</p>
                  <p className="text-[10px] text-[#D4D4D4]">Open the Proofing Studio below</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button onClick={onOpenStudio} disabled={products.length === 0} className="w-full flex items-center justify-center gap-2 py-2.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50" style={{ backgroundColor: 'var(--mt-brand)' }}>
                <Sparkles size={13} /> Open Proofing Studio
              </button>
              <button onClick={() => toast.info("Exporting proofs... — Preparing proof package for download")} className="w-full flex items-center justify-center gap-2 py-2 text-[12px] font-semibold text-[#3F3F46] border border-mt-border hover:border-[#3F3F46] transition-all">
                <Download size={13} /> Export Proofs
              </button>
            </div>

            {/* Proof History */}
            <div>
              <h4 className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Proof History</h4>
              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {dbProofs.map((proof, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-mt-surface">
                    <div>
                      <p className="text-[11px] font-semibold text-mt-ink truncate">{proof.productName || "Product"}</p>
                      <p className="text-[10px] text-[#A1A1AA]">{proof.decorationMethod || "—"}</p>
                    </div>
                    <span className={`text-[10px] font-bold ${proof.status === "approved" ? "text-[#16A34A]" : proof.status === "pending" ? "text-[#F59E0B]" : "text-[#A1A1AA]"}`}>{proof.status || "—"}</span>
                  </div>
                ))}
                {dbProofs.length === 0 && proofHistory.length === 0 && (
                  <p className="text-[11px] text-[#D4D4D4] text-center py-3">No proofs generated yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
