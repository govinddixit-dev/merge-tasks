/**
 * PortalProposalsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Proposals tab for WebstorePortal: proposal list with filter/search and
 * inline multi-department approval tracker.
 *
 * Detail view and checkout flow are delegated to:
 *  - PortalProposalDetail.tsx   (proposal detail + edit mode)
 *  - PortalProposalCheckout.tsx (3-step Stripe checkout + PDF receipt)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo } from "react";
import {
  FileText, GitBranch, Clock, Search, Filter, ChevronRight, ChevronDown,
  ArrowUpRight, Check, X, CheckCircle2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PortalProposalDetail, type PortalProposal, type DeptApproval } from "./PortalProposalDetail";

interface PortalProposalsTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  getStatusStyle: (status: string) => { bg: string; color: string };
  taxRate: number | null;
  storeSlug?: string;
}

export function PortalProposalsTab({
  isDark, fg, mutedFg, borderColor, cardBg, getStatusStyle, taxRate, storeSlug,
}: PortalProposalsTabProps) {
  const [proposalFilter, setProposalFilter] = useState<"all" | "multi">("all");
  const [showOutstandingOnly, setShowOutstandingOnly] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [proposalSearch, setProposalSearch] = useState("");
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [viewingProposal, setViewingProposal] = useState<PortalProposal | null>(null);

  // Fetch proposals from backend
  const { data: proposalsData } = trpc.storePortal.proposals.list.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug, retry: false },
  );

  // Map server data to PortalProposal shape
  const portalProposals: PortalProposal[] = useMemo(() => {
    if (!proposalsData) return [];
    return proposalsData.map((p) => ({
      id: String(p.id),
      title: p.title,
      distributor: p.proposalType || "Distributor",
      items: p.productCount,
      total: `$${parseFloat(p.estimatedValue || "0").toLocaleString()}`,
      date: p.sentAt ? new Date(p.sentAt).toLocaleDateString() : p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "",
      status: p.status === "sent" ? "New" : p.status === "viewed" ? "Under Review" : p.status === "accepted" ? "Approved" : p.status === "declined" ? "Rejected" : p.status,
      urgent: false,
      type: p.multiDepartment ? "multi-department" as const : "regular" as const,
      viewToken: p.viewToken ?? undefined,
    }));
  }, [proposalsData]);

  const multiCount = portalProposals.filter((p) => p.type === "multi-department").length;
  const outstandingCount = portalProposals.filter(
    (p) => p.status === "New" || p.status === "Under Review"
  ).length;

  let filteredProposals =
    proposalFilter === "all"
      ? portalProposals
      : portalProposals.filter((p) => p.type === "multi-department");
  if (showOutstandingOnly)
    filteredProposals = filteredProposals.filter(
      (p) => p.status === "New" || p.status === "Under Review"
    );
  if (proposalSearch.trim()) {
    const q = proposalSearch.toLowerCase();
    filteredProposals = filteredProposals.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
    );
  }

  const getDeptStatusStyle = (status: DeptApproval["status"]) => {
    switch (status) {
      case "approved": return { bg: "rgba(34,197,94,0.1)", color: "#22C55E", label: "Approved" };
      case "pending": return { bg: "rgba(251,191,36,0.1)", color: "#F59E0B", label: "Pending" };
      case "rejected": return { bg: "rgba(239,68,68,0.1)", color: "#EF4444", label: "Rejected" };
      case "not_started":
      default:
        return {
          bg: isDark ? "rgba(107,107,118,0.1)" : "rgba(115,115,115,0.06)",
          color: mutedFg,
          label: "Waiting",
        };
    }
  };

  // ─── Detail view ─────────────────────────────────────────────────────────────
  if (viewingProposal) {
    return (
      <PortalProposalDetail
        proposal={viewingProposal}
        onBack={() => setViewingProposal(null)}
        getStatusStyle={getStatusStyle}
        isDark={isDark}
        fg={fg}
        mutedFg={mutedFg}
        borderColor={borderColor}
        cardBg={cardBg}
        taxRate={taxRate}
        storeSlug={storeSlug}
      />
    );
  }

  // ─── Proposal list ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Proposals", value: String(portalProposals.length), icon: FileText, accent: false },
          { label: "Multi-Department", value: String(multiCount), icon: GitBranch, accent: true },
          { label: "Outstanding", value: String(outstandingCount), icon: Clock, accent: false },
        ].map((stat) => {
          const StatIcon = stat.icon;
          return (
            <div
              key={stat.label}
              className="p-4 rounded-lg flex items-center gap-3"
              style={{
                backgroundColor: stat.accent
                  ? isDark ? "rgba(101,75,249,0.08)" : "rgba(101,75,249,0.04)"
                  : cardBg,
                border: `1px solid ${stat.accent ? "rgba(101,75,249,0.2)" : borderColor}`,
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{
                  backgroundColor: isDark ? "rgba(101,75,249,0.12)" : "rgba(101,75,249,0.06)",
                }}
              >
                <StatIcon size={16} style={{ color: "var(--mt-brand)" }} />
              </div>
              <div>
                <div className="text-[22px] font-bold tracking-tight" style={{ color: fg }}>
                  {stat.value}
                </div>
                <div className="text-[10px] font-medium" style={{ color: mutedFg }}>
                  {stat.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { key: "all" as const, label: "All Proposals", count: portalProposals.length },
          { key: "multi" as const, label: "Multi-Department", count: multiCount },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setProposalFilter(f.key)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all"
            style={{
              backgroundColor:
                proposalFilter === f.key
                  ? "var(--mt-brand)"
                  : isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              color: proposalFilter === f.key ? "#FFFFFF" : mutedFg,
              border: `1px solid ${proposalFilter === f.key ? "transparent" : borderColor}`,
            }}
          >
            {f.label}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor:
                  proposalFilter === f.key ? "rgba(255,255,255,0.2)" : borderColor,
                color: proposalFilter === f.key ? "#FFFFFF" : mutedFg,
              }}
            >
              {f.count}
            </span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
          >
            <Search size={13} style={{ color: mutedFg }} />
            <input
              className="text-[12px] bg-transparent outline-none w-36"
              placeholder="Search proposals..."
              value={proposalSearch}
              onChange={(e) => setProposalSearch(e.target.value)}
              style={{ color: fg }}
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg, backgroundColor: cardBg }}
            >
              <Filter size={13} /> Filter
            </button>
            {showFilterMenu && (
              <div
                className="absolute right-0 top-9 z-20 rounded-lg shadow-lg py-2 min-w-[180px]"
                style={{ backgroundColor: isDark ? "#1F1F27" : "#FFFFFF", border: `1px solid ${borderColor}` }}
              >
                <label className="flex items-center gap-2 px-4 py-2 text-[12px] cursor-pointer hover:opacity-80">
                  <input
                    type="checkbox"
                    checked={showOutstandingOnly}
                    onChange={(e) => { setShowOutstandingOnly(e.target.checked); setShowFilterMenu(false); }}
                  />
                  <span style={{ color: fg }}>Outstanding only</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Proposal Rows */}
      <div className="space-y-3">
        {filteredProposals.map((proposal) => {
          const isMulti = proposal.type === "multi-department";
          const isExpanded = expandedProposal === proposal.id;
          const depts = proposal.departments || [];
          const approvedCount = depts.filter((d) => d.status === "approved").length;
          const statusStyle = getStatusStyle(proposal.status);

          return (
            <div
              key={proposal.id}
              className="rounded-xl overflow-hidden"
              style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
            >
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer"
                onClick={() => isMulti && setExpandedProposal(isExpanded ? null : proposal.id)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-semibold" style={{ color: fg }}>
                        {proposal.title}
                      </span>
                      {proposal.urgent && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#EF4444" }}
                        >
                          URGENT
                        </span>
                      )}
                      {isMulti && (
                        <span
                          className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: isDark ? "rgba(101,75,249,0.1)" : "rgba(101,75,249,0.06)",
                            color: "var(--mt-brand)",
                          }}
                        >
                          <GitBranch size={8} /> MULTI-DEPT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px]" style={{ color: mutedFg }}>
                      <span>{proposal.id}</span>
                      <span>·</span>
                      <span>{proposal.distributor}</span>
                      <span>·</span>
                      <span>{proposal.date}</span>
                      {isMulti && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={10} style={{ color: "#22C55E" }} />
                            {approvedCount}/{depts.length} depts
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-semibold" style={{ color: fg }}>{proposal.total}</span>
                  <span
                    className="text-[10px] font-semibold tracking-wide uppercase px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                  >
                    {proposal.status}
                  </span>
                  {isMulti && (
                    isExpanded
                      ? <ChevronDown size={14} style={{ color: mutedFg }} />
                      : <ChevronRight size={14} style={{ color: mutedFg }} />
                  )}
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--mt-brand)", color: "#FFFFFF" }}
                    onClick={(e) => { e.stopPropagation(); setViewingProposal(proposal); }}
                  >
                    View <ArrowUpRight size={10} />
                  </button>
                </div>
              </div>

              {/* Expanded dept tracker */}
              {isMulti && isExpanded && depts.length > 0 && (
                <div className="px-5 pb-5 pt-1">
                  <div
                    className="rounded-lg p-4"
                    style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <GitBranch size={13} style={{ color: "var(--mt-brand)" }} />
                        <span className="text-[12px] font-semibold" style={{ color: fg }}>
                          Department Approval Progress
                        </span>
                      </div>
                      <span className="text-[10px] font-medium" style={{ color: mutedFg }}>
                        {approvedCount} of {depts.length} departments
                      </span>
                    </div>
                    <div
                      className="w-full h-2 rounded-full mb-4"
                      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(approvedCount / depts.length) * 100}%`,
                          backgroundColor: depts.some((d) => d.status === "rejected") ? "#EF4444" : "#22C55E",
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      {depts.map((dept, dIdx) => {
                        const dStyle = getDeptStatusStyle(dept.status);
                        return (
                          <div
                            key={dIdx}
                            className="flex items-center justify-between py-2 px-3 rounded-md"
                            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)" }}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: dStyle.bg }}
                              >
                                {dept.status === "approved" && <Check size={11} style={{ color: dStyle.color }} />}
                                {dept.status === "pending" && <Clock size={11} style={{ color: dStyle.color }} />}
                                {dept.status === "rejected" && <X size={11} style={{ color: dStyle.color }} />}
                                {dept.status === "not_started" && (
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: mutedFg }} />
                                )}
                              </div>
                              <div>
                                <span className="text-[12px] font-semibold" style={{ color: fg }}>{dept.name}</span>
                                {dept.approver && (
                                  <span className="text-[10px] ml-2" style={{ color: mutedFg }}>{dept.approver}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {dept.date && (
                                <span className="text-[10px]" style={{ color: mutedFg }}>{dept.date}</span>
                              )}
                              <span
                                className="text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: dStyle.bg, color: dStyle.color }}
                              >
                                {dStyle.label}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
