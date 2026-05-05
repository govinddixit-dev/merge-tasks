/**
 * InvoicesList — distributor-wide list of invoices across all proposals.
 *
 * Row actions:
 *   - Download PDF (client-side via jsPDF)
 *   - Resend (re-emails the invoice to the client)
 *   - Create PO (always available — invoices are a commitment, cost-pricing
 *     POs can be generated at any time)
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Receipt, Download, Send as SendIcon, Search, ShieldCheck, ChevronRight, Loader2, Plus, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { generateInvoicePdf } from "@/utils/invoicePdfGenerator";
import CreatePOModal, { type CreatePOSource } from "@/components/po/CreatePOModal";
import { statusTone, statusBadgeClass, type StatusTone } from "@/lib/statusPalette";

const STATUS_STYLES: Record<string, { tone: StatusTone; label: string }> = {
  draft:               { tone: "gray",   label: "Draft" },
  sent:                { tone: "blue",   label: "Sent" },
  paid:                { tone: "green",  label: "Paid" },
  overdue:             { tone: "amber",  label: "Overdue" },
  cancelled:           { tone: "red",    label: "Cancelled" },
  void:                { tone: "gray",   label: "Void" },
  refunded:            { tone: "red",    label: "Refunded" },
  partially_refunded:  { tone: "amber",  label: "Partially Refunded" },
  credit_issued:       { tone: "gray",   label: "Credit Issued" },
};

/**
 * Skeletons mirroring the Invoices list shapes: a table row for the main
 * grid, and a card for the draft grid. Widths are tuned to match common
 * content lengths so the skeletons read as a dim preview rather than a
 * uniform bar grid.
 */
function InvoicesSkeletonRow() {
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
          <div className="h-6 w-16 rounded-md bg-[#F0F0F0] animate-pulse" />
          <div className="h-6 w-20 rounded-md bg-[#F0F0F0] animate-pulse" />
        </div>
      </td>
    </tr>
  );
}

function InvoicesDraftSkeletonCard() {
  return (
    <li
      className="bg-white rounded-lg border p-4"
      style={{ borderColor: "var(--mt-border, #E5E5E5)", borderLeft: "2px solid rgba(245, 158, 11, 0.6)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5 flex-1">
          <div className="h-3.5 bg-[#F0F0F0] rounded-full w-40 animate-pulse" />
          <div className="h-3 bg-[#F0F0F0] rounded-full w-24 animate-pulse" />
        </div>
        <div className="h-4 bg-[#F0F0F0] rounded-full w-16 animate-pulse" />
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F0F0F0]">
        <div className="h-3 bg-[#F0F0F0] rounded-full w-28 animate-pulse" />
        <div className="h-3 bg-[#F0F0F0] rounded-full w-24 animate-pulse" />
      </div>
    </li>
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

type InvoicesTab = "all" | "sent" | "paid" | "overdue" | "draft";

export default function InvoicesList() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<InvoicesTab>("all");
  const [poSource, setPoSource] = useState<CreatePOSource | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);

  const { data, isLoading } = trpc.estimatesInvoices.invoices.list.useQuery();
  const { data: proposalsData } = trpc.proposals.list.useQuery();
  const { data: branding } = trpc.branding.get.useQuery();
  const { data: logoData } = trpc.branding.getLogoDataUrl.useQuery();

  const resendMut = trpc.estimatesInvoices.invoices.sendToClient.useMutation({
    onSuccess: (res) => {
      toast.success(`Resent to ${res.sentTo}`);
      setResendingId(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setResendingId(null);
    },
  });

  const proposalMap = useMemo(() => {
    const m = new Map<number, { id: number; title: string }>();
    (proposalsData?.items ?? []).forEach((p) =>
      m.set(p.id, { id: p.id, title: p.title }),
    );
    return m;
  }, [proposalsData]);

  const draftCount = useMemo(
    () => (data ?? []).filter((i) => i.status === "draft").length,
    [data],
  );

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((i) => {
      if (activeTab !== "all" && i.status !== activeTab) return false;
      if (!q) return true;
      const prop = i.proposalId ? proposalMap.get(i.proposalId) : null;
      const haystack = [
        i.invoiceNumber,
        prop?.title,
        i.client?.companyName,
        i.client?.contactName,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query, activeTab, proposalMap]);

  // Drafts list — always rendered as cards regardless of the search query.
  // The Drafts tab intentionally skips the table render path below.
  const drafts = useMemo(() => {
    const rows = (data ?? []).filter((i) => i.status === "draft");
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((i) => {
      const haystack = [
        i.invoiceNumber,
        i.client?.companyName,
        i.client?.contactName,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query]);

  const handleDownload = async (i: (typeof filtered)[number]) => {
    try {
      await generateInvoicePdf(
        {
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          clientName: i.client?.contactName ?? i.client?.companyName ?? null,
          clientCompany: i.client?.companyName ?? null,
          clientEmail: i.client?.contactEmail ?? null,
          proposalId: i.proposalId ?? null,
          lineItems: (i.lineItems ?? []).map((li) => ({
            productName: li.productName,
            sku: li.sku,
            color: li.color,
            size: li.size,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            totalPrice: li.totalPrice,
            imageUrl: li.imageUrl,
          })),
          subtotal: i.subtotal,
          shipping: i.shipping,
          tax: i.tax,
          total: i.total,
          notes: i.notes ?? null,
          dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
          createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
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
    <DashboardLayout title="Invoices" subtitle="All invoices across your proposals">
      {/* Top strip: search input + primary Create Invoice action pinned
         right. Tab row lives just below as an understated underline nav. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--mt-ink-3, #9CA3AF)" }} />
          <input
            type="text"
            placeholder="Search invoice #, proposal, client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border text-sm outline-none transition-all focus:ring-2 focus:ring-[#654BF9]/20 focus:border-[#654BF9]"
            style={{ borderColor: "var(--mt-border, #E5E5E5)" }}
          />
        </div>
        <div className="sm:ml-auto">
          <button
            type="button"
            onClick={() => navigate("/invoices/new")}
            className="sq-action-btn primary flex items-center gap-2 active:scale-[0.97]"
          >
            <Plus size={14} /> Create Invoice
          </button>
        </div>
      </div>

      {/* ── Status tabs — understated underline, matches the Clients page.
          Drafts sits alongside the workflow statuses; its count badge is
          only rendered when there's at least one draft so the label stays
          quiet in the common case. ────────────────────────────────── */}
      <div className="flex flex-nowrap border-b border-[#F0F0F0] mb-5 overflow-x-auto">
        {([
          { key: "all",     label: "All" },
          { key: "sent",    label: "Sent" },
          { key: "paid",    label: "Paid" },
          { key: "overdue", label: "Overdue" },
          { key: "draft",   label: "Drafts" },
        ] as Array<{ key: InvoicesTab; label: string }>).map((tab) => {
          const isActive = activeTab === tab.key;
          const showBadge = tab.key === "draft" && draftCount > 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-4 py-3 text-[12px] font-semibold transition-colors whitespace-nowrap ${
                isActive ? "text-primary" : "text-mt-ink-4 hover:text-mt-ink-2"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {showBadge && (
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold"
                    style={{
                      backgroundColor: isActive ? "#EEF2FF" : "var(--mt-surface-2, #F9FAFB)",
                      color: isActive ? "#4338CA" : "var(--mt-ink-3, #9CA3AF)",
                    }}
                  >
                    {draftCount}
                  </span>
                )}
              </span>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "draft" ? (
        isLoading ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <InvoicesDraftSkeletonCard key={i} />)}
          </ul>
        ) : drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <PencilLine size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">
              {(data?.length ?? 0) > 0 && query ? "No matching drafts" : "No drafts yet"}
            </h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[320px] mb-4">
              Drafts let you save an invoice half-finished and pick it back up later.
            </p>
            <button
              type="button"
              onClick={() => navigate("/invoices/new")}
              className="sq-action-btn primary inline-flex items-center gap-2 active:scale-[0.97]"
            >
              <Plus size={14} /> Start an invoice
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {drafts.map((i, idx) => {
              const lastEdited = i.updatedAt ?? i.createdAt;
              const edited = lastEdited
                ? new Date(lastEdited).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—";
              const total = parseFloat(i.total || "0");
              return (
                <motion.li
                  key={i.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(idx, 15) * 0.03 }}
                  className="bg-white rounded-lg border transition-colors duration-150 hover:bg-mt-surface cursor-pointer"
                  style={{
                    borderColor: "var(--mt-border, #E5E5E5)",
                    // 2 px amber left border, muted per the spec — #F59E0B at 60%
                    // alpha. Kept quiet so drafts read as "work in progress"
                    // rather than alarming.
                    borderLeft: "2px solid rgba(245, 158, 11, 0.6)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/invoices/new?draft=${i.id}`)}
                    className="w-full text-left p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-mt-ink truncate">
                          {i.client?.companyName || i.client?.contactName || "Untitled draft"}
                        </p>
                        <p className="font-mono text-[11.5px] text-mt-ink-3 mt-0.5">
                          {i.invoiceNumber}
                        </p>
                      </div>
                      <span
                        className="font-mono text-[13px] tabular-nums text-mt-ink shrink-0"
                      >
                        ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F0F0F0]">
                      <span className="text-[11px] text-mt-ink-3">Edited {edited}</span>
                      <span
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                      >
                        Continue editing <ChevronRight size={12} />
                      </span>
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )
      ) : isLoading ? (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--mt-border, #E5E5E5)" }}>
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--mt-surface-2, #F9FAFB)" }}>
                {["Invoice #", "Proposal", "Client / Store", "Total", "Status", "Created", ""].map((h, idx) => (
                  <th
                    key={idx}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <InvoicesSkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        (data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Receipt size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No invoices yet</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[320px] mb-4">
              Build an invoice from scratch or generate one from a proposal.
            </p>
            <button
              type="button"
              onClick={() => navigate("/invoices/new")}
              className="sq-action-btn primary inline-flex items-center gap-2 active:scale-[0.97]"
            >
              <Plus size={14} /> Create Invoice
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] flex items-center justify-center mb-4">
              <Receipt size={24} className="text-primary" />
            </div>
            <h3 className="text-[15px] font-semibold text-mt-ink mb-1">No invoices match your filters</h3>
            <p className="text-[13px] text-mt-ink-3 max-w-[320px] mb-3">
              Try adjusting your search or status filter.
            </p>
            <button
              type="button"
              onClick={() => { setQuery(""); setActiveTab("all"); }}
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
                {["Invoice #", "Proposal", "Client / Store", "Total", "Status", "Created", ""].map((h, idx) => (
                  <th
                    key={idx}
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "var(--mt-ink-3, #9CA3AF)", borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((i, idx) => {
                const prop = i.proposalId ? proposalMap.get(i.proposalId) : null;
                const resending = resendingId === i.id && resendMut.isPending;
                return (
                  <motion.tr
                    key={i.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(idx, 15) * 0.03 }}
                    className="transition-colors duration-150 cursor-pointer hover:bg-mt-surface"
                    style={{ borderBottom: "1px solid var(--mt-border, #E5E5E5)" }}
                    onClick={() => navigate(`/invoices/${i.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-sm font-medium" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      {i.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-2, #6B7280)" }}>
                      {prop?.title ?? (i.proposalId ? `#${i.proposalId}` : "—")}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      {i.client?.companyName || i.client?.contactName || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums" style={{ color: "var(--mt-ink, #1A1A1A)" }}>
                      ${parseFloat(i.total || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--mt-ink-3, #9CA3AF)" }}>
                      {i.createdAt ? new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownload(i)}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold border hover:bg-mt-surface-2 inline-flex items-center gap-1"
                          style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink-2, #6B7280)" }}
                          title="Download PDF"
                        >
                          <Download size={12} /> PDF
                        </button>
                        <button
                          onClick={() => {
                            setResendingId(i.id);
                            resendMut.mutate({ id: i.id });
                          }}
                          disabled={resending}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold border hover:bg-mt-surface-2 inline-flex items-center gap-1 disabled:opacity-50"
                          style={{ borderColor: "var(--mt-border, #E5E5E5)", color: "var(--mt-ink-2, #6B7280)" }}
                          title="Resend to client"
                        >
                          {resending ? <Loader2 size={12} className="animate-spin" /> : <SendIcon size={12} />}
                          Resend
                        </button>
                        <button
                          onClick={() =>
                            setPoSource({
                              kind: "invoice",
                              invoiceIds: [i.id],
                              label: `Invoice ${i.invoiceNumber}`,
                            })
                          }
                          className="px-2 py-1 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1 transition-transform duration-75 active:scale-[0.97]"
                          style={{ backgroundColor: "var(--mt-brand, #654BF9)" }}
                          title="Create Purchase Order"
                        >
                          <ShieldCheck size={12} /> Create PO
                        </button>
                        <ChevronRight size={14} className="text-mt-ink-4" />
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
