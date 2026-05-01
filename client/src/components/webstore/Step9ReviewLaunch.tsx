import { Check, Loader2, Shield } from "lucide-react";
import { SSO_PROVIDERS, CHECKOUT_METHODS, TEMPLATES, RBAC_TIERS, PermanentStore } from "./types";
import { useWebstore } from "./WebstoreContext";

function ReviewRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid #F5F5F5" }}>
      <span className="text-[12px] font-medium text-mt-ink-4">{label}</span>
      <div className="flex items-center gap-2">
        {color && <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />}
        <span className={`text-[13px] font-semibold ${highlight ? "text-primary" : "text-mt-ink"}`}>{value}</span>
      </div>
    </div>
  );
}

interface Props {
  companyName: string;
  displayDomain: string;
  tierLabel: string;
  permanentStores?: PermanentStore[];
  deploying: boolean;
  deployStep: number;
  deploySteps: string[];
}

export default function Step9ReviewLaunch({ companyName, displayDomain, tierLabel, permanentStores, deploying, deployStep, deploySteps }: Props) {
  const { state } = useWebstore();
  const {
    pocEnabled, pocs, industry, employeeCount, ssoProvider, selectedTemplate,
    enablePromo, enablePrint, addedProductIds, selectedCategories, enabledCheckout,
    rbacEnabled, brandColor, storeDuration, popupStartDate, popupEndDate,
    linkToPermanent, linkedStoreId,
  } = state;

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Review & Launch</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Confirm your settings before deploying the store</p>

      {!deploying && deployStep < 0 ? (
        <div className="space-y-4">
          <ReviewRow label="Client" value={companyName || "—"} />
          <ReviewRow label="POC" value={pocEnabled ? pocs.map(p => p.name || "—").join(", ") : "Not assigned"} />
          <ReviewRow label="Industry" value={industry || "—"} />
          <ReviewRow label="Employees" value={employeeCount || "—"} />
          <ReviewRow label="Domain" value={displayDomain} highlight />
          <ReviewRow label="Auth" value={SSO_PROVIDERS.find(p => p.id === ssoProvider)?.name || "—"} />
          <ReviewRow label="Tier" value={tierLabel} />
          <ReviewRow label="Template" value={TEMPLATES.find(t => t.id === selectedTemplate)?.name || "—"} />
          <ReviewRow label="Store Type" value={[enablePromo && "Promotional", enablePrint && "Print"].filter(Boolean).join(" + ") || "—"} />
          <ReviewRow label="Products" value={`${addedProductIds.length} products in ${selectedCategories.length} categories`} />
          <ReviewRow label="Checkout" value={enabledCheckout.map(id => CHECKOUT_METHODS.find(m => m.id === id)?.name).join(", ") || "—"} />
          <ReviewRow label="RBAC" value={rbacEnabled ? `Enabled — ${RBAC_TIERS.length} tiers` : "Disabled"} />
          <ReviewRow label="Brand Color" value={brandColor} color={brandColor} />
          <ReviewRow label="Duration" value={storeDuration === "permanent" ? "Permanent" : `Pop-Up (${popupStartDate || "—"} to ${popupEndDate || "—"})`} />
          {storeDuration === "popup" && linkToPermanent && linkedStoreId && (
            <ReviewRow label="Linked Store" value={(permanentStores ?? []).find(s => s.id === linkedStoreId)?.name || "—"} highlight />
          )}
          {ssoProvider !== "none" && ssoProvider !== "" && (
            <div className="mt-6 p-4 bg-mt-brand-light rounded-lg border border-primary/20">
              <div className="flex items-center gap-2 mb-1">
                <Shield size={14} className="text-primary" />
                <span className="text-[12px] font-semibold text-primary">SSO{rbacEnabled ? " + RBAC" : ""} Enabled</span>
              </div>
              <p className="text-[12px] text-mt-ink-3">
                An IT Readiness Packet will be generated and emailed to the POC after launch.
                The POC forwards it to their IT department for SSO, SCIM{rbacEnabled ? ", and RBAC checkout" : ""} setup (~27 min).
              </p>
            </div>
          )}
          {rbacEnabled && (ssoProvider === "none" || ssoProvider === "") && (
            <div className="mt-6 p-4 bg-[#FEF3C7] rounded-lg border border-[#D97706]/20">
              <div className="flex items-center gap-2 mb-1">
                <Shield size={14} className="text-[#D97706]" />
                <span className="text-[12px] font-semibold text-[#D97706]">RBAC Enabled (No SSO)</span>
              </div>
              <p className="text-[12px] text-mt-ink-3">
                RBAC checkout configuration will be included in the onboarding email. The POC can configure employee tiers from the Admin Portal.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {deploySteps.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              {i < deployStep ? (
                <div className="w-7 h-7 rounded-full bg-[#16A34A] flex items-center justify-center"><Check size={14} color="#FFF" /></div>
              ) : i === deployStep ? (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"><Loader2 size={14} color="#FFF" className="animate-spin" /></div>
              ) : (
                <div className="w-7 h-7 rounded-full border border-mt-border flex items-center justify-center"><span className="text-[10px] text-mt-ink-4">{i + 1}</span></div>
              )}
              <span className={`text-[13px] ${i <= deployStep ? "text-mt-ink font-medium" : "text-mt-ink-4"}`}>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
