/**
 * StoreFooter — Minimal branded footer with store logo and MergeTasks attribution.
 */

import { useStore } from "./StoreContext";

export default function StoreFooter() {
  const { store, isDark } = useStore();
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#6B6B76" : "#A3A3A3";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const pc = store.primaryColor;

  return (
    <footer className="py-12 mt-16" style={{ borderTop: `1px solid ${borderColor}`, backgroundColor: isDark ? "#111" : "#FAFAFA" }}>
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            {(store.logoUrl || store.client?.logoUrl) ? (
              <img src={store.logoUrl || store.client?.logoUrl || ""} alt="" className="h-6 object-contain opacity-60" />
            ) : (
              <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[12px] font-bold" style={{ backgroundColor: pc }}>
                {(store.client?.companyName || store.name).charAt(0)}
              </div>
            )}
            <span className="text-[13px] font-semibold" style={{ color: fg }}>
              {store.client?.companyName || store.name}
            </span>
          </div>
          <div className="text-center sm:text-right">
            <p className="text-[11px]" style={{ color: mutedFg }}>
              Powered by MergeTasks Enterprise Platform
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: mutedFg }}>
              support@mergetasks.com
            </p>
            {/* Legal links — Tier 1 + Tier 2 compliance touchpoint */}
            <div className="flex items-center justify-center sm:justify-end gap-2 mt-1.5">
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[10px] hover:underline" style={{ color: mutedFg }}>Terms</a>
              <span className="text-[10px]" style={{ color: mutedFg }}>·</span>
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[10px] hover:underline" style={{ color: mutedFg }}>Privacy</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
