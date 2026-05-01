import { ShoppingBag, Printer, Check } from "lucide-react";
import { useWebstore } from "./WebstoreContext";

export default function Step3StoreType() {
  const { state, dispatch } = useWebstore();
  const { enablePromo, enablePrint } = state;

  // Read-current-value in the reducer so click handlers never see a stale
  // closure. This matters when a user double-clicks fast or when React
  // batches two clicks in the same tick — the toggle always flips whatever
  // the committed state is, not what was rendered one frame ago.
  const togglePromo = () => dispatch({ type: "TOGGLE_ENABLE_PROMO" });
  const togglePrint = () => dispatch({ type: "TOGGLE_ENABLE_PRINT" });

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Store Type</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Select which store modules to enable for this client</p>

      <div className="space-y-4">
        <button
          type="button"
          aria-pressed={enablePromo}
          className={`w-full text-left p-6 rounded-xl border-2 transition-all ${
            enablePromo ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"
          }`}
          onClick={togglePromo}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${enablePromo ? "bg-primary" : "bg-mt-surface-2"}`}>
              <ShoppingBag size={22} className={enablePromo ? "text-white" : "text-mt-ink-4"} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[16px] font-bold text-mt-ink">Promotional Store</h3>
                {enablePromo && <Check size={16} className="text-primary" />}
              </div>
              <p className="text-[13px] text-mt-ink-3">
                Branded merchandise — apparel, drinkware, tech accessories, bags, and more.
                All employees can browse and order from their department budget.
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          aria-pressed={enablePrint}
          className={`w-full text-left p-6 rounded-xl border-2 transition-all ${
            enablePrint ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"
          }`}
          onClick={togglePrint}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${enablePrint ? "bg-primary" : "bg-mt-surface-2"}`}>
              <Printer size={22} className={enablePrint ? "text-white" : "text-mt-ink-4"} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[16px] font-bold text-mt-ink">Print Store</h3>
                {enablePrint && <Check size={16} className="text-primary" />}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-mt-brand-light text-primary">POC Only</span>
              </div>
              <p className="text-[13px] text-mt-ink-3">
                Business cards, envelopes, letterhead, brochures, and operational print materials.
                Only visible to the Point of Contact — not regular employees.
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
