/**
 * PreviewTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Live Preview tab for StoreManagement: device switcher (mobile/tablet/desktop),
 * page selector, refresh/open-full controls, and an iframe with realistic
 * device chrome (notch, status bar, browser chrome, URL bar).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Smartphone, Tablet, Monitor, RotateCw, Maximize2, Globe,
} from "lucide-react";
import { PreviewDevice } from "./StoreManagementTypes";

interface PreviewTabProps {
  effectiveStore: { domain: string };
  previewDevice: PreviewDevice;
  setPreviewDevice: (d: PreviewDevice) => void;
  previewPage: string;
  setPreviewPage: (p: string) => void;
  previewKey: number;
  setPreviewKey: (fn: (k: number) => number) => void;
}

export function PreviewTab({
  effectiveStore,
  previewDevice,
  setPreviewDevice,
  previewPage,
  setPreviewPage,
  previewKey,
  setPreviewKey,
}: PreviewTabProps) {
  const devices: { id: PreviewDevice; icon: React.ReactNode; label: string }[] = [
    { id: "mobile", icon: <Smartphone size={14} />, label: "375px" },
    { id: "tablet", icon: <Tablet size={14} />, label: "768px" },
    { id: "desktop", icon: <Monitor size={14} />, label: "1280px" },
  ];

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {/* Device Switcher */}
          <div className="flex items-center bg-mt-surface-2 rounded-lg p-0.5">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setPreviewDevice(d.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  previewDevice === d.id
                    ? "bg-white text-mt-ink shadow-sm"
                    : "text-mt-ink-4 hover:text-mt-ink-2"
                }`}
              >
                {d.icon}
                <span className="hidden sm:inline">
                  {d.id.charAt(0).toUpperCase() + d.id.slice(1)}
                </span>
              </button>
            ))}
          </div>

          {/* Page Selector */}
          <select
            value={previewPage}
            onChange={(e) => setPreviewPage(e.target.value)}
            className="text-[12px] font-semibold text-mt-ink-2 bg-white border border-mt-border rounded-lg px-3 py-1.5 outline-none focus:border-primary transition-colors"
          >
            <option value="/store/home">Home</option>
            <option value="/store/products">Products</option>
            <option value="/store/categories">Categories</option>
            <option value="/store/portal">Client Portal</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPreviewKey((k) => k + 1)}
            className="sq-action-btn flex items-center gap-1.5 text-[12px]"
          >
            <RotateCw size={13} /> Refresh
          </button>
          <a
            href={`${window.location.origin}${previewPage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sq-action-btn flex items-center gap-1.5 text-[12px]"
          >
            <Maximize2 size={13} /> Open Full
          </a>
        </div>
      </div>

      {/* Preview Frame */}
      <div className="flex justify-center">
        <div
          className="relative transition-all duration-300 ease-out"
          style={{
            width:
              previewDevice === "mobile" ? 375 : previewDevice === "tablet" ? 768 : "100%",
            maxWidth: "100%",
          }}
        >
          {/* Device Frame */}
          <div
            className={`relative bg-[#1A1A1A] overflow-hidden ${
              previewDevice === "mobile"
                ? "rounded-[2.5rem] p-2 pt-3 pb-3"
                : previewDevice === "tablet"
                ? "rounded-[1.5rem] p-2"
                : "rounded-xl p-0"
            }`}
          >
            {/* Mobile Notch */}
            {previewDevice === "mobile" && (
              <div className="flex justify-center mb-1.5">
                <div className="w-[100px] h-[22px] bg-[#1A1A1A] rounded-full relative z-10" />
              </div>
            )}

            {/* Status Bar (mobile) */}
            {previewDevice === "mobile" && (
              <div className="flex items-center justify-between px-6 py-1 text-white text-[10px] font-semibold">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="white">
                    <rect x="0" y="6" width="2" height="4" rx="0.5" />
                    <rect x="3" y="4" width="2" height="6" rx="0.5" />
                    <rect x="6" y="2" width="2" height="8" rx="0.5" />
                    <rect x="9" y="0" width="2" height="10" rx="0.5" />
                  </svg>
                  <svg width="16" height="10" viewBox="0 0 16 10" fill="white">
                    <rect x="0" y="0" width="14" height="10" rx="2" stroke="white" strokeWidth="1" fill="none" />
                    <rect x="14" y="3" width="2" height="4" rx="0.5" />
                    <rect x="1.5" y="1.5" width="10" height="7" rx="1" />
                  </svg>
                </div>
              </div>
            )}

            {/* Browser Chrome (desktop) */}
            {previewDevice === "desktop" && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-mt-surface-2 border-b border-mt-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#EF4444]" />
                  <span className="w-3 h-3 rounded-full bg-[#F59E0B]" />
                  <span className="w-3 h-3 rounded-full bg-[#22C55E]" />
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex items-center gap-2 bg-white rounded-md px-3 py-1 text-[11px] text-mt-ink-3 border border-mt-border min-w-[280px]">
                    <Globe size={11} />
                    <span>{effectiveStore.domain}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tablet URL Bar */}
            {previewDevice === "tablet" && (
              <div className="flex items-center gap-2 px-3 py-2 bg-mt-surface-2 rounded-t-lg">
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex items-center gap-1.5 bg-white rounded px-2.5 py-0.5 text-[10px] text-mt-ink-3 border border-mt-border">
                    <Globe size={10} />
                    <span>{effectiveStore.domain}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Iframe */}
            <div
              className="bg-white overflow-hidden"
              style={{
                height:
                  previewDevice === "mobile"
                    ? 680
                    : previewDevice === "tablet"
                    ? 600
                    : 560,
              }}
            >
              <iframe
                key={previewKey}
                src={previewPage}
                title="Webstore Preview"
                className="w-full h-full border-0"
                style={{ pointerEvents: "auto" }}
              />
            </div>

            {/* Mobile Home Indicator */}
            {previewDevice === "mobile" && (
              <div className="flex justify-center py-2">
                <div className="w-[120px] h-[4px] bg-white/40 rounded-full" />
              </div>
            )}
          </div>

          {/* Device Label */}
          <div className="text-center mt-3">
            <span className="text-[11px] text-mt-ink-4">
              {previewDevice === "mobile"
                ? "375 × 812"
                : previewDevice === "tablet"
                ? "768 × 1024"
                : "1280 × 800"}{" "}
              &mdash; {effectiveStore.domain}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
