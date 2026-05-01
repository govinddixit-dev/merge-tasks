import { Store, Zap, Check, Clock, CalendarDays, AlertTriangle, Link2 } from "lucide-react";
import { PermanentStore } from "./types";
import { useWebstore } from "./WebstoreContext";

interface Props {
  companyName: string;
  permanentStores: PermanentStore[];
}

export default function Step4Duration({ companyName, permanentStores }: Props) {
  const { state, set } = useWebstore();
  const { storeDuration, popupStartDate, popupEndDate, linkToPermanent, linkedStoreId } = state;

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Store Duration</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Choose whether this is a permanent store or a time-limited pop-up shop</p>

      <div className="space-y-4 mb-8">
        <button
          className={`w-full text-left p-6 rounded-xl border-2 transition-all ${storeDuration === "permanent" ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
          onClick={() => { set("storeDuration", "permanent"); set("linkToPermanent", false); set("linkedStoreId", ""); }}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${storeDuration === "permanent" ? "bg-primary" : "bg-mt-surface-2"}`}>
              <Store size={22} className={storeDuration === "permanent" ? "text-white" : "text-mt-ink-4"} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[16px] font-bold text-mt-ink">Permanent Store</h3>
                {storeDuration === "permanent" && <Check size={16} className="text-primary" />}
              </div>
              <p className="text-[13px] text-mt-ink-3">
                Always-on company store with no expiration date. Ideal for ongoing branded merchandise programs,
                employee onboarding kits, and recurring company swag needs.
              </p>
            </div>
          </div>
        </button>

        <button
          className={`w-full text-left p-6 rounded-xl border-2 transition-all ${storeDuration === "popup" ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
          onClick={() => set("storeDuration", "popup")}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${storeDuration === "popup" ? "bg-primary" : "bg-mt-surface-2"}`}>
              <Zap size={22} className={storeDuration === "popup" ? "text-white" : "text-mt-ink-4"} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[16px] font-bold text-mt-ink">Pop-Up Shop</h3>
                {storeDuration === "popup" && <Check size={16} className="text-primary" />}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706]">Time-Limited</span>
              </div>
              <p className="text-[13px] text-mt-ink-3">
                Temporary store with a set start and end date. Perfect for seasonal campaigns, holiday gift shops,
                company events, product launches, or limited-time promotions.
              </p>
            </div>
          </div>
        </button>
      </div>

      {storeDuration === "popup" && (
        <div className="space-y-6">
          <div>
            <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3 flex items-center gap-2">
              <CalendarDays size={14} className="text-primary" /> Campaign Window
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-mt-ink-4 mb-1.5">Start Date</label>
                <input type="date"
                  className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  value={popupStartDate} onChange={(e) => set("popupStartDate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] text-mt-ink-4 mb-1.5">End Date</label>
                <input type="date"
                  className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  value={popupEndDate} onChange={(e) => set("popupEndDate", e.target.value)}
                />
              </div>
            </div>
            {popupStartDate && popupEndDate && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-mt-ink-3">
                <Clock size={12} className="text-primary" />
                <span>Duration: {Math.max(1, Math.ceil((new Date(popupEndDate).getTime() - new Date(popupStartDate).getTime()) / (1000 * 60 * 60 * 24)))} days</span>
              </div>
            )}
          </div>

          <div className="bg-mt-surface rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-[#D97706] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-mt-ink mb-1">When the pop-up expires</p>
                <p className="text-[11px] text-mt-ink-3">
                  The store will automatically close and display a "This campaign has ended" message.
                  All order history and data will be preserved. You can reactivate or extend the dates at any time from the Stores dashboard.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4" style={{ borderTop: "1px solid #F0F0F0" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Link2 size={14} className="text-primary" />
                  <p className="text-[13px] font-bold text-mt-ink">Link to Permanent Store</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3">Optional</span>
                </div>
                <p className="text-[11px] text-mt-ink-3">
                  Add this pop-up as a temporary tab inside an existing permanent store.
                </p>
              </div>
              <button
                onClick={() => { set("linkToPermanent", !linkToPermanent); if (linkToPermanent) set("linkedStoreId", ""); }}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${linkToPermanent ? "bg-primary" : "bg-mt-border-2"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${linkToPermanent ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {linkToPermanent && (
              <div className="space-y-3">
                <select
                  className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  value={linkedStoreId} onChange={(e) => set("linkedStoreId", e.target.value)}
                >
                  <option value="">Select a permanent store...</option>
                  {permanentStores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {s.domain}</option>
                  ))}
                </select>
                {linkedStoreId && (
                  <div className="bg-mt-brand-light rounded-lg p-4">
                    <p className="text-[12px] font-semibold text-primary mb-2">How it works</p>
                    <div className="space-y-2">
                      {[
                        { num: "1", text: <>A new tab labeled <span className="font-semibold">"{companyName || "Campaign"} Pop-Up"</span> will appear in the permanent store's navigation</> },
                        { num: "2", text: <>Employees browsing <span className="font-semibold">{permanentStores.find(s => s.id === linkedStoreId)?.domain}</span> will see the pop-up products alongside their regular catalog</> },
                        { num: "3", text: <>The tab automatically disappears on <span className="font-semibold">{popupEndDate || "the end date"}</span> — no manual cleanup needed</> },
                      ].map((item) => (
                        <div key={item.num} className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-[9px] font-bold text-white">{item.num}</span>
                          </div>
                          <p className="text-[11px] text-mt-ink-2">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
