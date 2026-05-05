import { Sparkles, Check, Bot, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

interface CurationMockupModalProps {
  mockupStep: number;
  onClose: () => void;
}

export default function CurationMockupModal({ mockupStep, onClose }: CurationMockupModalProps) {
  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
    >
      <div className="w-full max-w-2xl bg-white rounded-xl p-8 shadow-lg">
        <div className="flex items-center gap-2.5 mb-1">
          <Sparkles size={18} className="text-primary" />
          <h2 className="text-xl font-bold text-mt-ink">AI Mockup Engine</h2>
        </div>
        <p className="text-[13px] text-mt-ink-3 mb-7">Generating branded product mockups</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            {["Analyzing brand assets...", "Applying logo placement...", "Rendering 3D mockup...", "Generating variations..."].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i <= mockupStep ? (
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${i < mockupStep ? "bg-[#16A34A]" : "bg-primary"}`}>
                    {i < mockupStep ? <Check size={12} color="#FFF" /> : <Bot size={12} color="#FFF" className="animate-pulse" />}
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border border-mt-border flex items-center justify-center">
                    <span className="text-[10px] text-mt-ink-4">{i + 1}</span>
                  </div>
                )}
                <span className={`text-[13px] ${i <= mockupStep ? "text-mt-ink font-medium" : "text-mt-ink-4"}`}>{step}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className={`h-28 flex items-center justify-center rounded-lg border transition-all duration-300 ${
                mockupStep >= 3 ? "border-primary bg-mt-brand-light" : "border-mt-border bg-mt-surface"
              }`}>
                {mockupStep >= 3 ? (
                  <div className="text-center">
                    <div className="w-10 h-10 mx-auto mb-1 rounded-lg flex items-center justify-center bg-primary/10">
                      <span className="text-[11px] font-bold text-primary">V{n}</span>
                    </div>
                    <p className="text-[10px] font-medium text-primary">Variation {n}</p>
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded bg-[#E5E5E5]" />
                )}
              </div>
            ))}
          </div>
        </div>

        {mockupStep >= 3 && (
          <div className="flex gap-3 mt-7">
            <button
              className="sq-action-btn primary flex-1 justify-center py-3 flex items-center gap-2"
              onClick={() => { onClose(); toast.success("Mockups added to proposal"); }}
            >
              <ShoppingCart size={13} /> Add to Proposal
            </button>
            <button className="sq-action-btn px-5 py-3" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
