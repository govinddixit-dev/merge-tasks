import { Check, Shield, Users, CreditCard, FileText } from "lucide-react";
import { CHECKOUT_METHODS, RBAC_TIERS } from "./types";
import { useWebstore } from "./WebstoreContext";

const CHECKOUT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  cc: CreditCard,
  gl: FileText,
  points: Shield,
  hybrid: Users,
};

interface Props {
  toggleCheckout: (id: string) => void;
}


export default function Step8Checkout({ toggleCheckout }: Props) {
  const { state, set } = useWebstore();
  const { enabledCheckout, budgetEnabled, approvalEnabled, rbacEnabled } = state;
  const rbacTiers = RBAC_TIERS;

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Checkout Configuration</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Select which payment methods to enable for this client</p>

      <div className="space-y-3 mb-7">
        {CHECKOUT_METHODS.map((m) => {
          const Icon = CHECKOUT_ICONS[m.id] || CreditCard;
          const enabled = enabledCheckout.includes(m.id);
          return (
            <button key={m.id}
              className={`w-full text-left p-5 rounded-lg border-2 transition-all ${enabled ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
              onClick={() => toggleCheckout(m.id)}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${enabled ? "bg-primary" : "bg-mt-surface-2"}`}>
                  <Icon size={18} className={enabled ? "text-white" : "text-mt-ink-4"} />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-mt-ink">{m.name}</p>
                  <p className="text-[11px] text-mt-ink-3">{m.desc}</p>
                </div>
                {enabled && <Check size={16} className="text-primary" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 p-4 bg-mt-surface rounded-lg">
          <input type="checkbox" checked={budgetEnabled} onChange={() => set("budgetEnabled", !budgetEnabled)} style={{ accentColor: "var(--mt-brand)" }} />
          <div>
            <p className="text-[13px] font-semibold text-mt-ink">Enable Department Budgets</p>
            <p className="text-[11px] text-mt-ink-3">Set spending limits per department per quarter</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 bg-mt-surface rounded-lg">
          <input type="checkbox" checked={approvalEnabled} onChange={() => set("approvalEnabled", !approvalEnabled)} style={{ accentColor: "var(--mt-brand)" }} />
          <div>
            <p className="text-[13px] font-semibold text-mt-ink">Enable Manager Approval Workflow</p>
            <p className="text-[11px] text-mt-ink-3">Orders above threshold require manager sign-off</p>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-6" style={{ borderTop: "1px solid #F0F0F0" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-primary" />
              <p className="text-[13px] font-bold text-mt-ink">Advanced Checkout RBAC</p>
            </div>
            <p className="text-[11px] text-mt-ink-3">Role-based payment method assignment per employee tier. Configured by client's IT team.</p>
          </div>
          <button onClick={() => set("rbacEnabled", !rbacEnabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${rbacEnabled ? "bg-primary" : "bg-mt-border-2"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${rbacEnabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
        {rbacEnabled && (
          <div className="bg-mt-surface rounded-lg p-5">
            <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-4">Default Tier Configuration (IT team can customize)</p>
            <div className="space-y-3">
              {RBAC_TIERS.map((tier, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg border border-mt-border">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${idx === 0 ? "bg-mt-brand-light" : idx === 1 ? "bg-[#F0FDF4]" : idx === 2 ? "bg-[#FEF3C7]" : "bg-mt-surface-2"}`}>
                      <Users size={14} className={`${idx === 0 ? "text-primary" : idx === 1 ? "text-[#16A34A]" : idx === 2 ? "text-[#D97706]" : "text-mt-ink-3"}`} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-mt-ink">{tier.name}</p>
                      <p className="text-[11px] text-mt-ink-3">{tier.methods.map(m => CHECKOUT_METHODS.find(cm => cm.id === m)?.name).join(", ")}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-mt-ink-2 bg-mt-surface-2 px-2.5 py-1 rounded">{tier.limit}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-mt-ink-4 mt-3">These defaults will be included in the IT Readiness Packet. The client's IT admin can modify tiers, methods, and limits from the Admin Portal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
