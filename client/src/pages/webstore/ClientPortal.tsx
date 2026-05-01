/**
 * ClientPortal — POC Dashboard with real backend data.
 *
 * This file is now a thin shell that:
 *   1. Fetches the dashboard aggregate via trpc.storePortal.dashboard
 *   2. Renders the portal header
 *   3. Delegates each tab to a focused component in ./portal/
 *
 * Tab components:
 *   PortalOverviewTab   — stats, recent proposals/orders, quick actions
 *   PortalProposalsTab  — proposal list with expandable ProposalCard
 *   PortalOrdersTab     — order list with expandable OrderRow
 *   PortalPrintTab      — print request list + submission form
 *   PortalTeamTab       — team member management grouped by department
 */
import React, { useState, useRef, useLayoutEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart3, FileText, ShoppingCart, Users, Printer, AlertCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";

import {
  PortalOverviewTab,
  PortalProposalsTab,
  PortalOrdersTab,
  PortalPrintTab,
  PortalTeamTab,
} from "./portal";

// ── Types ──────────────────────────────────────────────────────────────

interface ClientPortalProps {
  storeSlug: string;
  primaryColor: string;
  storeName: string;
  onNavigateToProposal?: (viewToken: string) => void;
}

// ── Main Component ─────────────────────────────────────────────────────

export default function ClientPortal({ storeSlug, primaryColor, storeName, onNavigateToProposal }: ClientPortalProps) {
  const pc = primaryColor;
  const [activeTab, setActiveTab] = useState("overview");

  // Sliding-pill indicator — measures the active trigger after every render
  // and animates a single absolutely-positioned element to its position/width.
  // Using querySelector off a wrapper ref avoids needing forwarded refs on
  // each shadcn TabsTrigger (the shadcn wrapper does not forward refs).
  const tabsWrapRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; width: number; ready: boolean }>(
    { x: 0, width: 0, ready: false },
  );
  useLayoutEffect(() => {
    const wrap = tabsWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const active = wrap.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      if (!active) return;
      setPill({ x: active.offsetLeft, width: active.offsetWidth, ready: true });
    };
    measure();
    // Recalc on container resize (mobile rotation, font load, sidebar toggles)
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeTab]);

  // Data Fetching
  const { data: dashboard, isLoading: dashLoading } = trpc.storePortal.dashboard.useQuery(
    { storeSlug },
    { retry: false }
  );

  if (dashLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <MergeTasksLoader variant="inline" message="Loading your portal..." />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <AlertCircle size={40} className="mx-auto mb-3 text-[#DC2626]" />
          <h2 className="text-lg font-bold text-mt-ink mb-1">Unable to load portal</h2>
          <p className="text-[13px] text-mt-ink-3">Please make sure you are logged in and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      {/* Portal Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[15px]" style={{ backgroundColor: pc }}>
            {dashboard.user.name?.charAt(0) || "P"}
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-mt-ink">
              Welcome back, {dashboard.user.name?.split(" ")[0] || "there"}
            </h1>
            <p className="text-[13px] text-mt-ink-3">
              {dashboard.client?.companyName || storeName} &middot; {dashboard.user.role === "admin" ? "Administrator" : dashboard.user.role === "manager" ? "Manager" : "Team Member"}
              {dashboard.user.department ? ` · ${dashboard.user.department}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/*
       * Tabs — a single absolutely-positioned pill slides between triggers.
       * The pill uses the store's primaryColor at low opacity with a backdrop
       * blur so trigger text reads through rather than being painted over.
       * The solid active-bg state has been removed from triggers; only the
       * pill and a subtle font-weight bump signal which tab is active.
       */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div ref={tabsWrapRef}>
          <TabsList className="relative bg-mt-surface-2 p-1 rounded-lg mb-4 w-full sm:w-auto flex overflow-x-auto">
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-0 rounded-md pointer-events-none"
              style={{
                transform: `translateX(${pill.x}px)`,
                width: pill.width,
                backgroundColor: `${pc}33`, // ~20% alpha
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: `1px solid ${pc}40`,
                transition: pill.ready
                  ? "transform 200ms ease-in-out, width 200ms ease-in-out"
                  : "none",
                opacity: pill.ready ? 1 : 0,
              }}
            />
            <TabsTrigger value="overview" className="relative z-10 text-[12px] gap-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-bold font-semibold">
              <BarChart3 size={14} /> Overview
            </TabsTrigger>
            <TabsTrigger value="proposals" className="relative z-10 text-[12px] gap-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-bold font-semibold">
              <FileText size={14} /> Proposals
            </TabsTrigger>
            <TabsTrigger value="orders" className="relative z-10 text-[12px] gap-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-bold font-semibold">
              <ShoppingCart size={14} /> Orders
            </TabsTrigger>
            <TabsTrigger value="print" className="relative z-10 text-[12px] gap-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-bold font-semibold">
              <Printer size={14} /> Print
            </TabsTrigger>
            <TabsTrigger value="team" className="relative z-10 text-[12px] gap-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-bold font-semibold">
              <Users size={14} /> Team
            </TabsTrigger>
          </TabsList>
        </div>

        {/* GAP 5 FIX: forceMount keeps all tab content in the DOM so there is
            no unmount/remount flash when switching tabs. Inactive panels are
            hidden with display:none via data-[state=inactive]:hidden so they
            don't contribute to layout while invisible. */}
        <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden">
          <PortalOverviewTab dashboard={dashboard} pc={pc} storeSlug={storeSlug} onNavigateToProposal={onNavigateToProposal} onTabChange={setActiveTab} />
        </TabsContent>
        <TabsContent value="proposals" forceMount className="data-[state=inactive]:hidden">
          <PortalProposalsTab storeSlug={storeSlug} pc={pc} onNavigateToProposal={onNavigateToProposal} />
        </TabsContent>
        <TabsContent value="orders" forceMount className="data-[state=inactive]:hidden">
          <PortalOrdersTab storeSlug={storeSlug} pc={pc} />
        </TabsContent>
        <TabsContent value="print" forceMount className="data-[state=inactive]:hidden">
          <PortalPrintTab storeSlug={storeSlug} pc={pc} />
        </TabsContent>
        <TabsContent value="team" forceMount className="data-[state=inactive]:hidden">
          <PortalTeamTab storeSlug={storeSlug} pc={pc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
