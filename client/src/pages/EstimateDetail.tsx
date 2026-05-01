/**
 * Estimate Detail Page
 * - View estimate details generated from accepted proposals
 * - Download as PDF
 * - Convert to Invoice
 */

import { Fragment, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Download, Receipt, Loader2, FileText, Calendar, Send, PenSquare, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { getLogger } from "@/lib/logger";
import { generateEstimatePdf } from "@/utils/estimatePdfGenerator";

const log = getLogger("EstimateDetail");

export default function EstimateDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const estimateId = parseInt(id || "0");

  const { data: estimate, isLoading, error } = trpc.estimatesInvoices.estimates.getById.useQuery(
    { id: estimateId },
    { enabled: estimateId > 0 }
  );

  // Live distributor branding — same pattern as proposals. Pulled at render
  // time so edits in Settings → Branding show up immediately everywhere.
  const { data: branding } = trpc.branding.get.useQuery();
  // Server-side proxy of the brand logo as a base64 data URL so jsPDF can
  // embed it directly without tripping over S3 CORS restrictions.
  const { data: logoData } = trpc.branding.getLogoDataUrl.useQuery();

  const utils = trpc.useUtils();

  const convertToInvoice = trpc.estimatesInvoices.estimates.convertToInvoice.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice #${data.invoiceNumber} created`);
      navigate(`/invoices/${data.id}`);
    },
    onError: (err: unknown) => toast.error("Couldn't convert to invoice: " + (err instanceof Error ? err.message : "please try again")),
  });

  const sendEstimate = trpc.estimatesInvoices.estimates.sendToClient.useMutation({
    onSuccess: (data) => {
      toast.success(`Estimate emailed to ${data.sentTo}`);
      utils.estimatesInvoices.estimates.getById.invalidate({ id: estimateId });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to send"),
  });

  const fulfillEstimateMut = trpc.fulfillment.markEstimateFulfilled.useMutation({
    onSuccess: () => {
      utils.estimatesInvoices.estimates.getById.invalidate({ id: estimateId });
      toast.success("Estimate marked as fulfilled — confirmation email sent");
    },
    onError: (err) => toast.error(err.message),
  });

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    if (!estimate) return;
    setDownloading(true);
    try {
      await generateEstimatePdf(
        {
          estimateNumber: estimate.estimateNumber,
          status: estimate.status,
          clientName: estimate.client?.contactName || estimate.client?.companyName || null,
          clientCompany: estimate.client?.companyName || null,
          clientEmail: estimate.client?.contactEmail || null,
          proposalId: estimate.proposalId ?? null,
          lineItems: estimate.resolvedLineItems,
          subtotal: estimate.subtotal || "0",
          tax: estimate.tax || "0",
          shipping: estimate.shipping || "0",
          total: estimate.total || "0",
          notes: estimate.notes,
          validDays: estimate.validDays,
          createdAt: typeof estimate.createdAt === "string" ? estimate.createdAt : new Date(estimate.createdAt ?? Date.now()).toISOString(),
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
      toast.success("PDF downloaded");
    } catch (err) {
      log.error("PDF generation failed:", err);
      toast.error("Couldn't generate the PDF — please try again");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <DashboardLayout title="Estimate"><MergeTasksLoader /></DashboardLayout>;
  if (error || !estimate) {
    return (
      <DashboardLayout title="Estimate">
        <div className="p-8 text-center">
          <FileText size={48} className="text-[#D4D4D4] mx-auto mb-4" />
          <h2 className="text-[18px] font-bold text-mt-ink mb-2">Estimate Not Found</h2>
          <p className="text-[13px] text-[#A1A1AA] mb-4">This estimate may have been deleted or doesn't exist.</p>
          <button onClick={() => navigate("/proposals")} className="px-4 py-2 text-[13px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all">
            Back to Proposals
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const lineItems = estimate.resolvedLineItems;
  const showBackToEdit = estimate.status === "draft" && estimate.isBuilderCreated;

  const statusColors: Record<string, string> = {
    draft:     "bg-gray-100 text-gray-600",
    sent:      "bg-blue-50 text-blue-700",
    accepted:  "bg-purple-50 text-purple-700",
    declined:  "bg-red-50 text-red-700",
    converted: "bg-green-50 text-green-700",
    fulfilled: "bg-green-50 text-green-700",
  };

  return (
    <DashboardLayout title="Estimate">
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/proposals")} className="p-1.5 hover:bg-[#F0F0F0] transition-colors">
              <ArrowLeft size={18} className="text-mt-ink-3" />
            </button>
            <div>
              <h1 className="text-[22px] font-bold text-mt-ink">Estimate #{estimate.estimateNumber}</h1>
              <p className="text-[12px] text-[#A1A1AA]">Created {new Date(estimate.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
            <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusColors[estimate.status] || statusColors.draft}`}>
              {estimate.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {showBackToEdit && (
              <button
                onClick={() => navigate(`/estimates/new?draft=${estimate.id}`)}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-mt-ink-2 border border-mt-border hover:bg-mt-surface-2 transition-colors"
              >
                <PenSquare size={14} />
                Back to Edit
              </button>
            )}
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-mt-ink-2 border border-mt-border hover:bg-mt-surface-2 transition-colors"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download PDF
            </button>
            {estimate.status !== "converted" && estimate.status !== "declined" && (
              <button
                onClick={() => {
                  if (!estimate.client?.contactEmail) {
                    toast.error("Add a contact email on the client record first");
                    return;
                  }
                  sendEstimate.mutate({ id: estimate.id });
                }}
                disabled={sendEstimate.isPending}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white transition-colors"
                style={{ backgroundColor: branding?.brandPrimaryColor || "#654BF9" }}
              >
                {sendEstimate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send to Client
              </button>
            )}
            {estimate.status !== "converted" && (
              <button
                onClick={async () => {
                  try { await convertToInvoice.mutateAsync({ estimateId: estimate.id }); } catch {}
                }}
                disabled={convertToInvoice.isPending}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white bg-primary hover:bg-[#5840D9] transition-colors"
              >
                {convertToInvoice.isPending ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
                Convert to Invoice
              </button>
            )}
            {estimate.status === "accepted" && (
              <button
                onClick={() => {
                  if (!window.confirm("Mark this estimate as fulfilled? A confirmation email will be sent to the client.")) return;
                  fulfillEstimateMut.mutate({ estimateId: estimate.id });
                }}
                disabled={fulfillEstimateMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white bg-[#059669] hover:bg-[#047857] transition-colors"
              >
                {fulfillEstimateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                Mark as Fulfilled
              </button>
            )}
          </div>
        </div>

        {/* Estimate document — distributor-branded header */}
        <div className="bg-white border border-mt-border p-8">
          <div className="flex flex-col sm:flex-row gap-6 items-start justify-between mb-8 pb-6 border-b border-[#F0F0F0]">
            <div className="flex items-center gap-4">
              {branding?.brandLogoUrl && (
                <img
                  src={branding.brandLogoUrl}
                  alt={branding.brandCompanyName || "Distributor logo"}
                  className="h-10 w-auto object-contain"
                />
              )}
              <div>
                <h2 className="text-[28px] font-bold tracking-tight" style={{ color: branding?.brandPrimaryColor || "#654BF9" }}>ESTIMATE</h2>
                <p className="text-[13px] text-[#A1A1AA] mt-1">
                  #{estimate.estimateNumber}
                  {branding?.brandCompanyName ? ` · ${branding.brandCompanyName}` : ""}
                </p>
              </div>
            </div>
            <div className="text-right text-[12px] text-mt-ink-3">
              <div className="flex items-center gap-2 justify-end mb-1">
                <Calendar size={12} />
                <span>Date: {new Date(estimate.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-8">
            <div>
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Bill To</p>
              <p className="text-[14px] font-semibold text-mt-ink">{estimate.client?.contactName || "—"}</p>
              <p className="text-[12px] text-mt-ink-3">{estimate.client?.companyName || ""}</p>
              <p className="text-[12px] text-mt-ink-3">{estimate.client?.contactEmail || ""}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Proposal Reference</p>
              <p className="text-[12px] text-mt-ink-3">
                {estimate.proposalId != null ? `Proposal #${estimate.proposalId}` : "—"}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] mb-6">
            <thead>
              <tr className="bg-mt-brand-light">
                <th className="text-left text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Item</th>
                <th className="text-left text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Color</th>
                <th className="text-left text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Size</th>
                <th className="text-center text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Qty</th>
                <th className="text-right text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Unit Price</th>
                <th className="text-right text-[10px] font-bold text-primary tracking-wider uppercase px-3 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => {
                const prev = i > 0 ? lineItems[i - 1] : null;
                const showPackageHeader = item.packageName != null && item.packageName !== prev?.packageName;
                return (
                  <Fragment key={i}>
                    {showPackageHeader && (
                      <tr className="bg-mt-surface-2">
                        <td colSpan={6} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mt-ink-3">
                          {item.packageName}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-[#F0F0F0]">
                      <td className="px-3 py-3 text-[13px] text-mt-ink font-medium">{item.productName || "Product"}</td>
                      <td className="px-3 py-3 text-[12px] text-mt-ink-3">{item.color || "—"}</td>
                      <td className="px-3 py-3 text-[12px] text-mt-ink-3">{item.size || "—"}</td>
                      <td className="px-3 py-3 text-[12px] text-mt-ink text-center">{item.quantity}</td>
                      <td className="px-3 py-3 text-[12px] text-mt-ink text-right">${(item.unitPrice || 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-[13px] font-semibold text-mt-ink text-right">${(item.totalPrice || 0).toFixed(2)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-64 space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-[#A1A1AA]">Subtotal</span>
                <span className="text-mt-ink">${parseFloat(estimate.subtotal || "0").toFixed(2)}</span>
              </div>
              {parseFloat(estimate.tax || "0") > 0 && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#A1A1AA]">Tax</span>
                  <span className="text-mt-ink">${parseFloat(estimate.tax || "0").toFixed(2)}</span>
                </div>
              )}
              {parseFloat(estimate.shipping || "0") > 0 && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#A1A1AA]">Shipping</span>
                  <span className="text-mt-ink">${parseFloat(estimate.shipping || "0").toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-mt-border">
                <span className="text-[14px] font-bold text-mt-ink">Total</span>
                <span className="text-[18px] font-bold" style={{ color: branding?.brandPrimaryColor || "#654BF9" }}>${parseFloat(estimate.total || "0").toFixed(2)}</span>
              </div>
            </div>
          </div>

          {estimate.notes && (
            <div className="mt-8 pt-6 border-t border-[#F0F0F0]">
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Notes</p>
              <p className="text-[12px] text-mt-ink-3 whitespace-pre-wrap">{estimate.notes}</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
