/**
 * ProposalStep3Proofing
 * Step 3 of the Create Proposal wizard — Virtual Proofing
 */

import {
  Sparkles, Upload, X, Loader2, Check, Eye, Edit3, Printer,
} from "lucide-react";

interface Props {
  selectedProductsCount: number;
  proofingStarted: boolean;
  proofingStep: number;
  proofingLogo: string | null;
  proofingLogoName: string | null;
  uploadingLogo: boolean;
  selectedProductIds: number[];
  selectedClientDbId?: string | number;
  mergedProducts: Array<{ id: number; name: string; image: string; [key: string]: unknown }>;
  onStartProofing: () => void;
  onSkip: () => void;
  onReset: () => void;
  onApprove: () => void;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearLogo: () => void;
  onOpenStudio: () => void;
}

const PROOFING_STEPS = [
  "Analyzing client brand assets...",
  "Placing logos on product templates...",
  "Rendering 3D mockup variations...",
  "Generating print-ready previews...",
  "All proofs ready for review",
];

export default function ProposalStep3Proofing({
  selectedProductsCount, proofingStarted, proofingStep,
  proofingLogo, proofingLogoName, uploadingLogo,
  selectedProductIds, mergedProducts,
  onStartProofing, onSkip, onReset, onApprove,
  onLogoUpload, onClearLogo, onOpenStudio,
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-mt-border p-8 space-y-6">
      <div>
        <h2 className="text-[18px] font-bold text-mt-ink mb-1">Virtual Proofing</h2>
        <p className="text-[13px] text-mt-ink-3">Generate AI-powered branded mockups for selected products</p>
      </div>

      {!proofingStarted ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-mt-brand-light flex items-center justify-center">
            <Sparkles size={28} className="text-primary" />
          </div>
          <h3 className="text-[16px] font-bold text-mt-ink mb-2">Ready to Generate Proofs</h3>
          <p className="text-[13px] text-mt-ink-3 mb-4 max-w-md mx-auto">
            Our AI will generate branded mockups for {selectedProductsCount} selected products with your client's logo and colors.
          </p>

          {/* Logo Upload */}
          <div className="max-w-sm mx-auto mb-6">
            <p className="text-[12px] font-semibold text-mt-ink-2 mb-2">Client Logo</p>
            {proofingLogo ? (
              <div className="flex items-center gap-3 p-3 bg-mt-brand-light rounded-lg border border-primary/20">
                <img src={proofingLogo} alt="Logo" className="w-10 h-10 object-contain rounded" />
                <div className="flex-1 text-left">
                  <p className="text-[12px] font-medium text-mt-ink truncate">{proofingLogoName}</p>
                  <p className="text-[10px] text-[#16A34A]">Ready for proofing</p>
                </div>
                <button onClick={onClearLogo} className="text-mt-ink-4 hover:text-[#EF4444] transition-colors"><X size={14} /></button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-mt-border rounded-lg cursor-pointer hover:border-primary hover:bg-mt-brand-light/50 transition-all">
                <input type="file" accept="image/*" onChange={onLogoUpload} className="hidden" />
                {uploadingLogo ? <Loader2 size={14} className="animate-spin text-primary" /> : <Upload size={14} className="text-mt-ink-4" />}
                <span className="text-[12px] text-mt-ink-3">{uploadingLogo ? "Uploading..." : "Upload client logo (PNG, SVG, JPG)"}</span>
              </label>
            )}
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className="flex justify-center gap-3">
              <button onClick={onStartProofing} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: 'var(--mt-brand)' }}>
                <Sparkles size={14} /> Generate Virtual Proofs
              </button>
              <button onClick={onSkip} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-[13px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface">
                Skip for Now
              </button>
            </div>
            <button onClick={onOpenStudio} className="inline-flex items-center gap-2 text-[12px] font-medium text-primary hover:text-[#4C35C7] transition-colors">
              <Eye size={12} /> Open Full Virtual Proofing Studio
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {PROOFING_STEPS.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                {i < proofingStep
                  ? <div className="w-6 h-6 rounded-full bg-[#16A34A] flex items-center justify-center"><Check size={12} className="text-white" /></div>
                  : i === proofingStep
                  ? <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center"><Loader2 size={12} className="text-white animate-spin" /></div>
                  : <div className="w-6 h-6 rounded-full border border-mt-border flex items-center justify-center"><span className="text-[10px] text-mt-ink-4">{i + 1}</span></div>
                }
                <span className={`text-[13px] ${i <= proofingStep ? "text-mt-ink font-medium" : "text-mt-ink-4"}`}>{s}</span>
              </div>
            ))}
          </div>

          {proofingStep >= 4 && (
            <div className="flex justify-center gap-3 mb-4">
              <button onClick={onReset} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface transition-all">
                <Edit3 size={12} /> Edit & Re-generate
              </button>
              <button onClick={onApprove} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style={{ backgroundColor: 'var(--mt-brand)' }}>
                <Check size={12} /> Approve & Continue
              </button>
            </div>
          )}

          {proofingStep >= 4 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {selectedProductIds.slice(0, 8).map((id) => {
                const p = mergedProducts.find(pr => pr.id === id);
                if (!p) return null;
                return (
                  <div key={id} className="border border-primary/30 rounded-xl bg-mt-brand-light/30 p-3 text-center">
                    {p.image ? (
                      <div className="w-full h-24 mb-2 flex items-center justify-center bg-white rounded-lg p-2">
                        <img src={p.image} alt={p.name} className="h-full object-contain" />
                      </div>
                    ) : (
                      <div className="w-full h-24 mb-2 flex items-center justify-center bg-gradient-to-br from-[#F5F3FF] to-[#EEF2FF] rounded-lg">
                        <Printer size={20} className="text-primary" />
                      </div>
                    )}
                    <p className="text-[11px] font-semibold text-mt-ink truncate">{p.name}</p>
                    <p className="text-[10px] text-[#16A34A] flex items-center justify-center gap-1 mt-1"><Check size={10} /> Proof Ready</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
