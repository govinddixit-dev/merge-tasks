/**
 * TaxSettingsPanel — Set an org-wide default tax rate applied to newly
 * created stores. Existing stores keep their own store-level rate; the
 * authoritative value at checkout is always store.taxRate.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function TaxSettingsPanel() {
  const { data: orgs } = trpc.organizations.list.useQuery();
  const primaryOrgId = orgs?.[0]?.id ?? null;

  const { data: org, isLoading } = trpc.organizations.get.useQuery(
    { id: primaryOrgId ?? 0 },
    { enabled: primaryOrgId != null }
  );

  const utils = trpc.useUtils();
  const updateSettings = trpc.organizations.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Tax settings saved");
      if (primaryOrgId != null) {
        utils.organizations.get.invalidate({ id: primaryOrgId });
      }
    },
    onError: (err) => toast.error(err.message || "Could not save tax settings"),
  });

  const serverRate = org?.defaultTaxRate; // decimal string or null
  const [exempt, setExempt] = useState(false);
  const [ratePct, setRatePct] = useState<string>("");

  // Sync form with server value once loaded
  useEffect(() => {
    if (serverRate === undefined) return;
    if (serverRate === null) {
      setExempt(false);
      setRatePct("");
    } else {
      const pct = (parseFloat(serverRate) * 100).toFixed(2).replace(/\.00$/, "");
      setExempt(parseFloat(serverRate) === 0);
      setRatePct(parseFloat(serverRate) === 0 ? "" : pct);
    }
  }, [serverRate]);

  const handleSave = () => {
    if (primaryOrgId == null) return;
    let payload: number | null;
    if (exempt) payload = 0;
    else if (!ratePct.trim()) payload = null;
    else {
      const n = parseFloat(ratePct);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        toast.error("Enter a tax rate between 0 and 100.");
        return;
      }
      payload = +(n / 100).toFixed(4);
    }
    updateSettings.mutate({ organizationId: primaryOrgId, defaultTaxRate: payload });
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-6">
      <h3 className="text-[15px] font-semibold text-mt-ink mb-1">Default Tax Rate</h3>
      <p className="text-[12px] text-mt-ink-3 mb-5 leading-relaxed">
        Applied to new stores created under this organization. Existing stores keep their own rate and
        aren't changed by this setting. Leave blank to require manual per-store entry.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-mt-ink-4 py-4">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[13px] text-mt-ink-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={exempt}
              onChange={(e) => setExempt(e.target.checked)}
              style={{ accentColor: "var(--mt-brand)" }}
            />
            Tax-exempt (charge 0%)
          </label>

          <div className={`flex items-end gap-3 ${exempt ? "opacity-50 pointer-events-none" : ""}`}>
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-2 mb-1.5">
                Rate (%)
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={ratePct}
                  onChange={(e) => setRatePct(e.target.value)}
                  placeholder="e.g. 13"
                  className="w-32 px-3 py-2 border border-mt-border rounded-md text-[13px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <span className="ml-2 text-[13px] text-mt-ink-3">%</span>
              </div>
              <p className="text-[11px] text-mt-ink-4 mt-1.5">
                Common values: 13 (Ontario HST), 5 (GST only), 0 (exempt).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={handleSave}
              disabled={updateSettings.isPending || primaryOrgId == null}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold bg-primary text-white rounded-md hover:bg-[#5340d4] transition-colors disabled:opacity-50"
            >
              {updateSettings.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save
            </button>
            <p className="text-[11px] text-mt-ink-4">
              {serverRate === null || serverRate === undefined
                ? "Currently unset — new stores start with no tax rate configured."
                : `Currently: ${(parseFloat(serverRate) * 100).toFixed(2).replace(/\.00$/, "")}%`}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
