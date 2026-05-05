/**
 * WebstorePortal.tsx  — thin shell
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the five portal tabs. All heavy JSX lives in the sub-components
 * below; this file owns only: tab state, shared theme helpers, and the header /
 * tab-nav chrome.
 *
 * Sub-components:
 *   ./WebstorePortal/PortalReportsTab
 *   ./WebstorePortal/PortalMediaTab
 *   ./WebstorePortal/PortalProposalsTab
 *   ./WebstorePortal/PortalDepartmentsTab
 *   ./WebstorePortal/PortalAdminTab
 *
 * Data:
 *   @/components/webstore/portal/portalData
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import {
  BarChart3, Image, FileText, Settings, Layers, ShieldCheck, FileImage,
  FileVideo, File, ClipboardList, MapPin,
} from "lucide-react";
import { useParams } from "wouter";
import { useWebstoreTheme } from "@/contexts/WebstoreThemeContext";
import { trpc } from "@/lib/trpc";
import { PortalReportsTab } from "./WebstorePortal/PortalReportsTab";
import { PortalMediaTab } from "./WebstorePortal/PortalMediaTab";
import { PortalProposalsTab } from "./WebstorePortal/PortalProposalsTab";
import { PortalDepartmentsTab } from "./WebstorePortal/PortalDepartmentsTab";
import { PortalAdminTab } from "./WebstorePortal/PortalAdminTab";
import { PortalRequestsTab } from "./WebstorePortal/PortalRequestsTab";
import { PortalLocationsTab } from "./WebstorePortal/PortalLocationsTab";

// ─── Types ────────────────────────────────────────────────────────────────────
type PortalTab = "reports" | "media" | "proposals" | "departments" | "admin" | "requests" | "locations";

// ─── Component ────────────────────────────────────────────────────────────────
export default function WebstorePortal() {
  const params = useParams<{ slug?: string }>();
  const storeSlug = params.slug || "";
  const { isDark } = useWebstoreTheme();

  // Load pending requests count for badge
  const { data: pendingRequestsData } = trpc.storePortal.customRequests.pendingCount.useQuery(
    { storeSlug },
    { enabled: !!storeSlug },
  );
  const pendingRequestsCount = pendingRequestsData?.count ?? 0;

  // Load store dashboard data to get server-driven taxRate
  const { data: dashboardData } = trpc.storePortal.dashboard.useQuery(
    { storeSlug },
    { enabled: !!storeSlug },
  );
  const storeTaxRate = dashboardData?.store?.taxRate ?? null;

  // ── Shared theme tokens ──────────────────────────────────────────────────
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#6B6B76" : "#737373";
  const borderColor = isDark ? "#2A2A32" : "#E5E5E5";
  const cardBg = isDark ? "#1F1F27" : "#FAFAFA";

  // ── Tab state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PortalTab>("reports");

  // ── Media state (kept here so search persists across tab switches) ───────
  const [mediaSearch, setMediaSearch] = useState("");

  // ── Admin modal state ────────────────────────────────────────────────────
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  // ── Shared helpers ───────────────────────────────────────────────────────
  const getStatusStyle = (status: string) => {
    switch (status) {
      case "Delivered":
      case "Approved":
        return {
          bg: isDark ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.08)",
          color: "#22C55E",
        };
      case "Shipped":
      case "Under Review":
        return {
          bg: isDark ? "rgba(101,75,249,0.1)" : "rgba(101,75,249,0.06)",
          color: "var(--mt-brand)",
        };
      case "Processing":
        return {
          bg: isDark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.08)",
          color: "#F59E0B",
        };
      case "New":
        return {
          bg: isDark ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.08)",
          color: "#3B82F6",
        };
      default:
        return { bg: "transparent", color: mutedFg };
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case "image": return FileImage;
      case "video": return FileVideo;
      default: return File;
    }
  };

  // ── Tab config ───────────────────────────────────────────────────────────
  const tabs: { key: PortalTab; label: string; icon: typeof BarChart3; badge?: number }[] = [
    { key: "reports",     label: "Reports",     icon: BarChart3 },
    { key: "media",       label: "Media",       icon: Image },
    { key: "proposals",   label: "Proposals",   icon: FileText },
    { key: "departments", label: "Departments", icon: Layers },
    { key: "requests",    label: "Requests",    icon: ClipboardList, badge: pendingRequestsCount || undefined },
    ...(dashboardData?.store?.multiLocationEnabled ? [{ key: "locations" as PortalTab, label: "Locations", icon: MapPin }] : []),
    ...(dashboardData?.user?.role === "admin" ? [{ key: "admin" as PortalTab, label: "Admin", icon: Settings }] : []),
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-start sm:items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={14} style={{ color: "var(--mt-brand)" }} />
            <span
              className="text-[11px] font-semibold tracking-[0.12em] uppercase"
              style={{ color: "var(--mt-brand)" }}
            >
              Client Portal
            </span>
          </div>
          <h1
            className="text-[28px] font-bold tracking-tight"
            style={{ color: fg, letterSpacing: "-0.5px" }}
          >
            {dashboardData?.store?.name ?? "Client"} Portal
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {dashboardData?.user?.role === "admin" && (
            <button
              onClick={() => setShowOverrideModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
            >
              <Settings size={13} /> Admin Actions
            </button>
          )}
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              backgroundColor: isDark ? "rgba(101,75,249,0.1)" : "rgba(101,75,249,0.05)",
              border: `1px solid ${isDark ? "rgba(101,75,249,0.2)" : "rgba(101,75,249,0.12)"}`,
            }}
          >
            <ShieldCheck size={14} style={{ color: "var(--mt-brand)" }} />
            <span className="text-[12px] font-medium" style={{ color: "var(--mt-brand)" }}>
              POC Access
            </span>
          </div>
        </div>
      </div>

      {/* ── Tab Navigation ─────────────────────────────────────────────── */}
      <div
        className="flex items-center flex-nowrap overflow-x-auto gap-1 mb-8 p-1 rounded-lg"
        style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md text-[12px] font-semibold tracking-wide transition-all duration-200 sm:flex-1 justify-center relative flex-shrink-0"
              style={{
                backgroundColor: isActive ? "var(--mt-brand)" : "transparent",
                color: isActive ? "#FFFFFF" : mutedFg,
              }}
            >
              <Icon size={14} />
              {tab.label}
              {tab.badge && (
                <span
                  className="ml-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{
                    backgroundColor: isActive ? "rgba(255,255,255,0.25)" : "#EF4444",
                    color: "#FFF",
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────── */}
      {activeTab === "reports" && (
        <PortalReportsTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          getStatusStyle={getStatusStyle}
          storeSlug={storeSlug}
        />
      )}

      {activeTab === "media" && (
        <PortalMediaTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          mediaSearch={mediaSearch}
          setMediaSearch={setMediaSearch}
          getFileIcon={getFileIcon}
          storeSlug={storeSlug}
        />
      )}

      {activeTab === "proposals" && (
        <PortalProposalsTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          getStatusStyle={getStatusStyle}
          taxRate={storeTaxRate}
          storeSlug={storeSlug}
        />
      )}

      {activeTab === "departments" && (
        <PortalDepartmentsTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          storeSlug={storeSlug}
          canManage={dashboardData?.user?.role === "poc" || dashboardData?.user?.role === "admin"}
        />
      )}

      {activeTab === "requests" && (
        <PortalRequestsTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          storeSlug={storeSlug}
        />
      )}

      {activeTab === "locations" && (
        <PortalLocationsTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          storeSlug={storeSlug}
          canManage={dashboardData?.user?.role === "poc" || dashboardData?.user?.role === "admin"}
        />
      )}

      {activeTab === "admin" && (
        <PortalAdminTab
          isDark={isDark}
          fg={fg}
          mutedFg={mutedFg}
          borderColor={borderColor}
          cardBg={cardBg}
          storeSlug={storeSlug}
          showOverrideModal={showOverrideModal}
          setShowOverrideModal={setShowOverrideModal}
        />
      )}
    </div>
  );
}
