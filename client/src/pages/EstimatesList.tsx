/**
 * EstimatesList — distributor-wide list of estimates across all proposals.
 *
 * Row actions:
 *   - Download PDF (client-side via jsPDF)
 *   - Create PO   (only when status is sent or acknowledged — never draft)
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Calculator, Download, Search, ShieldCheck, Plus,
  MoreHorizontal, Edit3, Copy, Trash2, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { generateEstimatePdf } from "@/utils/estimatePdfGenerator";
import CreatePOModal, { type CreatePOSource } from "@/components/po/CreatePOModal";
import { statusTone, statusBadgeClass, type StatusTone } from "@/lib/statusPalette";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const STATUS_STYLES: Record<string, { tone: StatusTone; label: string }> = {
  draft:     { tone: "gray",   label: "Draft" },
  sent:      { tone: "blue",   label: "Sent" },
  accepted:  { tone: "purple", label: "Acknowledged" },
  declined:  { tone: "red",    label: "Declined" },
  converted: { tone: "green",  label: "Converted" },
};

/**
 * Skeleton row for the Estimates table — columns 1:1 with the render at
 * line ~255. Widths mirror the real content shape so the loading state
 * reads as a dim preview of the table, not a uniform bar grid.
 */
function EstimatesSkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}>
      <td className="px-4 py-3"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-24 animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-40 animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-32 animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-[#F0F0F0] rounded-full w-16 animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-[#F0F0F0] rounded-full w-20 animate-pulse" /></td>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <div className="h-6 w-14 rounded-md bg-[#F0F0F0] animate-pulse" />
          <div className="h-6 w-20 rounded-md bg-[#F0F0F0] animate-pulse" />
          <div className="h-6 w-6 rounded-md bg-[#F0F0F0] animate-pulse" />
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  const t = statusTone[s.tone];
  return (
    <span className={statusBadgeClass} style={{ backgroundColor: t.bg, color: t.text }}>
      {s.label}
    </span>
  );
}

// The "sent or acknowledged" rule from the spec — draft rows never expose
// Create PO. The estimates schema uses "accepted" as its acknowledged state.
const PO_ELIGIBLE_STATUSES = new Set(["sent", "accepted"]);

export default function EstimatesList() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [poSource, setPoSource] = useState<CreatePOSource | null>(null);

  const { data, isLoading } = trpc.estimatesInvoices.estimates.list.useQuery();
  const { data: proposalsData } = trpc.proposals.list.useQuery();
  const { data: branding } = trpc.branding.get.useQuery();
  const { data: logoData } = trpc.branding.getLogoDataUrl.useQuery();
  const utils = trpc.useUtils();

  const duplicateMutation = trpc.estimatesInvoices.estimates.duplicate.useMutation({
    onSuccess: (res) => {
      toast.success(`Duplicated as ${res.estimateNumber}`);
      utils.estimatesInvoices.estimates.list.invalidate();
      navigate(`/estimates/new?draft=${res.newId}`);
    },
    onError: (err) => toast.error(err.message || "Failed to duplicate estimate"),
  });

  const convertMutation = trpc.estimatesInvoices.estimates.convertToInvoice.useMutation({
    onSuccess: () => {
      toast.success("Converted to invoice");
      utils.estimatesInvoices.estimates.list.invalidate();
      utils.estimatesInvoices.invoices.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to convert"),
  });

  const deleteMutation = trpc.estimatesInvoices.estimates.delete.useMutation({
    onSuccess: () => {
      toast.success("Estimate deleted");
      utils.estimatesInvoices.estimates.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  });

  const proposalMap = useMemo(() => {
    const m = new Map<number, { id: number; title: string; clientId?: number | null }>();
    (proposalsData?.items ?? []).forEach((p) =>
      m.set(p.id, { id: p.id, title: p.title, clientId: p.clientId ?? null }),
    );
    return m;
  }, [proposalsData]);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!q) return true;
      const prop = e.proposalId != null ? proposalMap.get(e.proposalId) : undefined;
      const haystack = [
        e.estimateNumber,
        prop?.title,
        e.client?.companyName,
        e.client?.contactName,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query, statusFilter, proposalMap]);

  // Design B — drafts open in the builder for editing, non-drafts open in the
  // read-only detail page. Used by the row onClick and the kebab's View/Edit.
  const openEstimate = (e: (typeof filtered)[number]) => {
    if (e.status === "draft") navigate(`/estimates/new?draft=${e.id}`);
    else navigate(`/estimates/${e.id}`);
  };

  const handleDownload = async (e: (typeof filtered)[number]) => {
    try {
      // Line items live in the relational tables post-0089 — fetch the
      // full estimate via getById so resolvedLineItems is populated.
      const full = await utils.estimatesInvoices.estimates.getById.fetch({ id: e.id });
      await generateEstimatePdf(
        {
          estimateNumber: full.estimateNumber,
          status: full.status,
          clientName: full.client?.contactName ?? full.client?.companyName ?? null,
          clientCompany: full.client?.companyName ?? null,
          clientEmail: full.client?.contactEmail ?? null,
          proposalId: full.proposalId ?? null,
          lineItems: full.resolvedLineItems,
          subtotal: full.subtotal,
          shipping: full.shipping,
          tax: full.tax,
          total: full.total,
          notes: full.notes ?? null,
          validDays: full.validDays,
          createdAt: full.createdAt ? new Date(full.createdAt).toISOString() : new Date().toISOString(),
        },
        branding
          ? {
              brandLogoUrl: branding.brandLogoUrl,
              brandLogoDataUrl: logoData?.dataUrl ?? null,
              brandPrimaryColor: branding.brandPrimaryColor,
              brandCompanyName: branding.brandCompanyName,
              companyAddress: branding.companyAddress,
              companyPhone: branding.companyPhone,
              companyEmail: branding.companyEmail,
              companyWebsite: branding.companyWebsite,
            }
          : undefined,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    }
  };

  return (
    <DashboardLayout
      title="Estimates"
      subtitle="All estimates across your proposals"
    >
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
          <input
            type="text"
            placeholder="Search estimate #, proposal, client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border text-sm outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-md border text-sm outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
          style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Acknowledged</option>
          <option value="declined">Declined</option>
          <option value="converted">Converted</option>
        </select>
        <div className="sm:ml-auto">
          <button
            type="button"
            onClick={() => navigate("/estimates/new")}
            className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]"
          >
            <Plus size={14} /> New estimate
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--mt-border, #E5E5E5)" }}>
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                {["Estimate #", "Proposal", "Client / Store", "Total", "Status", "Created", ""].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <EstimatesSkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        (data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Calculator size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No estimates yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[320px]">
              Estimates you generate from accepted proposals will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Calculator size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No estimates match your filters</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[320px] mb-3">
              Try adjusting your search or status filter.
            </p>
            <button
              type="button"
              onClick={() => { setQuery(""); setStatusFilter("all"); }}
              className="text-[12px] font-semibold text-primary hover:underline transition-colors duration-150"
            >
              Clear filters
            </button>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--mt-border, #E5E5E5)" }}>
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                {["Estimate #", "Proposal", "Client / Store", "Total", "Status", "Created", ""].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const prop = e.proposalId != null ? proposalMap.get(e.proposalId) : undefined;
                const canCreatePO = PO_ELIGIBLE_STATUSES.has(e.status);
                return (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(idx, 15) * 0.03 }}
                    className="transition-colors duration-150 cursor-pointer hover:bg-mt-surface"
                    style={{ borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                    onClick={() => openEstimate(e)}
                  >
                    <td className="px-4 py-3 font-mono text-sm font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      {e.estimateNumber}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
                      {prop?.title ?? (e.proposalId != null ? `#${e.proposalId}` : "—")}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      {e.client?.companyName || e.client?.contactName || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      ${parseFloat(e.total || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
                      {e.createdAt ? new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownload(e)}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold border hover:bg-mt-surface-2 inline-flex items-center gap-1"
                          style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink-2, #6B7280)" }}
                          title="Download PDF"
                        >
                          <Download size={12} /> PDF
                        </button>
                        {canCreatePO && (
                          <button
                            onClick={() =>
                              setPoSource({
                                kind: "estimate",
                                estimateIds: [e.id],
                                label: `Estimate ${e.estimateNumber}`,
                              })
                            }
                            className="px-2 py-1 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1 transition-transform duration-75 active:scale-[0.97]"
                            style={{ backgroundColor: "var(--mt-brand, #654BF9)" }}
                            title="Create Purchase Order"
                          >
                            <ShieldCheck size={12} /> Create PO
                          </button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1.5 rounded-md hover:bg-[#F0F0F0] transition-colors"
                              onClick={(ev) => ev.stopPropagation()}
                              aria-label="Row actions"
                            >
                              <MoreHorizontal size={16} className="text-mt-ink-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-[180px]"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <DropdownMenuItem icon={<Edit3 />} onSelect={() => openEstimate(e)}>
                              {e.status === "draft" ? "Edit" : "View"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<Copy />}
                              onSelect={() => duplicateMutation.mutate({ id: e.id })}
                            >
                              Duplicate
                            </DropdownMenuItem>
                            {e.status !== "converted" && (
                              <DropdownMenuItem
                                icon={<Receipt />}
                                onSelect={() => convertMutation.mutate({ estimateId: e.id })}
                              >
                                Convert to Invoice
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              icon={<Trash2 />}
                              onSelect={() => {
                                if (window.confirm("Delete this estimate?")) {
                                  deleteMutation.mutate({ id: e.id });
                                }
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreatePOModal
        open={poSource !== null}
        onClose={() => setPoSource(null)}
        source={poSource}
      />
    </DashboardLayout>
  );
}
