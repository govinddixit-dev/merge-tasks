/**
 * Invoice Detail Page
 * - View invoice details
 * - Download as PDF
 * - Update status (mark as paid, void, etc.)
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Download, Loader2, FileText, Calendar, CheckCircle2, XCircle, Clock, Send, DollarSign, Mail, PackageCheck } from "lucide-react";
import RefundDialog from "@/components/proposal/RefundDialog";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { getLogger } from "@/lib/logger";
import { generateInvoicePdf } from "@/utils/invoicePdfGenerator";

const log = getLogger("InvoiceDetail");

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const invoiceId = parseInt(id || "0");
  const utils = trpc.useUtils();

  const { data: invoice, isLoading, error } = trpc.estimatesInvoices.invoices.getById.useQuery(
    { id: invoiceId },
    { enabled: invoiceId > 0 }
  );

  // Live distributor branding — pulled at render time, same pattern as proposals.
  const { data: branding } = trpc.branding.get.useQuery();
  // Server-side proxy of the brand logo as a base64 data URL so jsPDF can
  // embed it directly without tripping over S3 CORS restrictions.
  const { data: logoData } = trpc.branding.getLogoDataUrl.useQuery();

  const updateStatus = trpc.estimatesInvoices.invoices.updateStatus.useMutation({
    onSuccess: () => {
      utils.estimatesInvoices.invoices.getById.invalidate({ id: invoiceId });
      toast.success("Invoice status updated");
    },
    onError: (err: unknown) => toast.error("Couldn't update the invoice: " + (err instanceof Error ? err.message : "please try again")),
  });

  const sendInvoice = trpc.estimatesInvoices.invoices.sendToClient.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice emailed to ${data.sentTo}`);
      utils.estimatesInvoices.invoices.getById.invalidate({ id: invoiceId });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to send"),
  });

  const fulfillInvoiceMut = trpc.fulfillment.markInvoiceFulfilled.useMutation({
    onSuccess: () => {
      utils.estimatesInvoices.invoices.getById.invalidate({ id: invoiceId });
      toast.success("Invoice marked as fulfilled — confirmation email sent");
    },
    onError: (err) => toast.error(err.message),
  });

  const [downloading, setDownloading] = useState(false);
  const [showRefund, setShowRefund] = useState(false);

  const handleDownloadPDF = async () => {
    if (!invoice) return;
    setDownloading(true);
    try {
      const items = (invoice.lineItems || []) as Array<{
        productName: string; sku: string | null; color: string | null;
        size: string | null; quantity: number; unitPrice: number; totalPrice: number; imageUrl: string | null;
      }>;
      await generateInvoicePdf(
        {
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          clientName: invoice.client?.contactName || invoice.client?.companyName || null,
          clientCompany: invoice.client?.companyName || null,
          clientEmail: invoice.client?.contactEmail || null,
          proposalId: invoice.proposalId ?? null,
          lineItems: items,
          subtotal: invoice.subtotal || "0",
          tax: invoice.tax || "0",
          shipping: invoice.shipping || "0",
          total: invoice.total || "0",
          notes: invoice.notes,
          dueDate: invoice.dueDate ? (typeof invoice.dueDate === "string" ? invoice.dueDate : new Date(invoice.dueDate).toISOString()) : null,
          createdAt: typeof invoice.createdAt === "string" ? invoice.createdAt : new Date(invoice.createdAt ?? Date.now()).toISOString(),
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

  if (isLoading) return <DashboardLayout title="Invoice"><MergeTasksLoader /></DashboardLayout>;
  if (error || !invoice) {
    return (
      <DashboardLayout title="Invoice">
        <div className="p-8 text-center">
          <FileText size={48} className="text-[#D4D4D4] mx-auto mb-4" />
          <h2 className="text-[18px] font-bold text-mt-ink mb-2">Invoice Not Found</h2>
          <p className="text-[13px] text-[#A1A1AA] mb-4">This invoice may have been deleted or doesn't exist.</p>
          <button onClick={() => navigate("/proposals")} className="px-4 py-2 text-[13px] font-semibold text-primary border border-primary hover:bg-primary hover:text-white transition-all">
            Back to Proposals
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const lineItems = (invoice.lineItems || []) as Array<{
    productName: string; sku: string | null; color: string | null;
    size: string | null; quantity: number; unitPrice: number; totalPrice: number;
  }>;

  const statusColors: Record<string, string> = {
    draft:              "bg-gray-100 text-gray-600",
    sent:               "bg-blue-50 text-blue-700",
    paid:               "bg-green-50 text-green-700",
    overdue:            "bg-amber-50 text-amber-700",
    cancelled:          "bg-gray-100 text-gray-600",
    void:               "bg-gray-100 text-gray-600",
    refunded:           "bg-red-50 text-red-700",
    partially_refunded: "bg-amber-50 text-amber-700",
    refund_pending:     "bg-amber-50 text-amber-700",
    fulfilled:          "bg-green-50 text-green-700",
  };

  const statusActions: Record<string, Array<{ label: string; status: string; icon: React.ElementType }>> = {
    draft: [
      { label: "Mark as Sent", status: "sent", icon: Send },
    ],
    sent: [
      { label: "Mark as Paid", status: "paid", icon: CheckCircle2 },
      { label: "Mark as Overdue", status: "overdue", icon: Clock },
    ],
    overdue: [
      { label: "Mark as Paid", status: "paid", icon: CheckCircle2 },
      { label: "Void Invoice", status: "void", icon: XCircle },
    ],
  };

  const actions = statusActions[invoice.status] || [];

  return (
    <DashboardLayout title="Invoice">
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/proposals")} className="p-1.5 hover:bg-[#F0F0F0] transition-colors">
              <ArrowLeft size={18} className="text-mt-ink-3" />
            </button>
            <div>
              <h1 className="text-[22px] font-bold text-mt-ink">Invoice #{invoice.invoiceNumber}</h1>
              <p className="text-[12px] text-[#A1A1AA]">Created {new Date(invoice.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
            <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusColors[invoice.status] || statusColors.draft}`}>
              {invoice.status}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-mt-ink-2 border border-mt-border hover:bg-mt-surface-2 transition-colors"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download PDF
            </button>
            {(invoice.status === "draft" || invoice.status === "sent" || invoice.status === "overdue") && (
              <button
                onClick={() => {
                  if (!invoice.client?.contactEmail) {
                    toast.error("Add a contact email on the client record first");
                    return;
                  }
                  sendInvoice.mutate({ id: invoice.id });
                }}
                disabled={sendInvoice.isPending}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white transition-colors"
                style={{ backgroundColor: branding?.brandPrimaryColor || "#654BF9" }}
              >
                {sendInvoice.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                {invoice.status === "draft" ? "Send to Client" : "Resend to Client"}
              </button>
            )}
            {(invoice.status === "paid" || invoice.status === "sent") && parseFloat(invoice.total || "0") > 0 && (
              <button
                onClick={() => setShowRefund(true)}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-amber-700 border border-amber-300 hover:bg-amber-50 transition-colors"
              >
                <DollarSign size={14} /> Issue Refund
              </button>
            )}
            {(invoice.status === "paid" || invoice.status === "sent") && (
              <button
                onClick={() => {
                  if (!window.confirm("Mark this invoice as fulfilled? A confirmation email will be sent to the client.")) return;
                  fulfillInvoiceMut.mutate({ invoiceId: invoice.id });
                }}
                disabled={fulfillInvoiceMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white bg-[#059669] hover:bg-[#047857] transition-colors"
              >
                {fulfillInvoiceMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                Mark as Fulfilled
              </button>
            )}
            {actions.map((action) => (
              <button
                key={action.status}
                onClick={async () => {
                  try { await updateStatus.mutateAsync({ id: invoice.id, status: action.status as "draft" | "sent" | "paid" | "overdue" | "cancelled" | "void" }); } catch {}
                }}
                disabled={updateStatus.isPending}
                className={`flex items-center gap-2 px-4 py-2 text-[12px] font-semibold transition-colors ${
                  action.status === "paid"
                    ? "text-white bg-[#16A34A] hover:bg-[#15803D]"
                    : action.status === "void"
                    ? "text-[#EF4444] border border-[#EF4444] hover:bg-[#FEF2F2]"
                    : "text-white bg-primary hover:bg-[#5840D9]"
                }`}
              >
                {updateStatus.isPending ? <Loader2 size={14} className="animate-spin" /> : <action.icon size={14} />}
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Payment info banner */}
        {invoice.status === "paid" && invoice.paidAt && (
          <div className="bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 mb-4 flex items-center gap-3">
            <CheckCircle2 size={16} className="text-[#16A34A]" />
            <div>
              <p className="text-[12px] font-semibold text-[#16A34A]">Paid on {new Date(invoice.paidAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
              {invoice.paymentMethod && <p className="text-[11px] text-[#15803D]">via {invoice.paymentMethod}{invoice.paymentReference ? ` (${invoice.paymentReference})` : ""}</p>}
            </div>
          </div>
        )}

        {/* Invoice document — distributor-branded header */}
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
                <h2 className="text-[28px] font-bold tracking-tight" style={{ color: branding?.brandPrimaryColor || "#654BF9" }}>INVOICE</h2>
                <p className="text-[13px] text-[#A1A1AA] mt-1">
                  #{invoice.invoiceNumber}
                  {branding?.brandCompanyName ? ` · ${branding.brandCompanyName}` : ""}
                </p>
              </div>
            </div>
            <div className="text-right text-[12px] text-mt-ink-3">
              <div className="flex items-center gap-2 justify-end mb-1">
                <Calendar size={12} />
                <span>Date: {new Date(invoice.createdAt).toLocaleDateString()}</span>
              </div>
              {invoice.dueDate && (
                <div className="flex items-center gap-2 justify-end">
                  <Clock size={12} />
                  <span>Due: {new Date(invoice.dueDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-8">
            <div>
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Bill To</p>
              <p className="text-[14px] font-semibold text-mt-ink">{invoice.client?.contactName || "—"}</p>
              <p className="text-[12px] text-mt-ink-3">{invoice.client?.companyName || ""}</p>
              <p className="text-[12px] text-mt-ink-3">{invoice.client?.contactEmail || ""}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Reference</p>
              {invoice.proposalId && <p className="text-[12px] text-mt-ink-3">Proposal #{invoice.proposalId}</p>}
              {invoice.estimateId && <p className="text-[12px] text-mt-ink-3">Estimate #{invoice.estimateId}</p>}
              {invoice.orderId && <p className="text-[12px] text-mt-ink-3">Order #{invoice.orderId}</p>}
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
              {lineItems.map((item, i) => (
                <tr key={i} className="border-b border-[#F0F0F0]">
                  <td className="px-3 py-3 text-[13px] text-mt-ink font-medium">{item.productName || "Product"}</td>
                  <td className="px-3 py-3 text-[12px] text-mt-ink-3">{item.color || "—"}</td>
                  <td className="px-3 py-3 text-[12px] text-mt-ink-3">{item.size || "—"}</td>
                  <td className="px-3 py-3 text-[12px] text-mt-ink text-center">{item.quantity}</td>
                  <td className="px-3 py-3 text-[12px] text-mt-ink text-right">${(item.unitPrice || 0).toFixed(2)}</td>
                  <td className="px-3 py-3 text-[13px] font-semibold text-mt-ink text-right">${(item.totalPrice || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-64 space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-[#A1A1AA]">Subtotal</span>
                <span className="text-mt-ink">${parseFloat(invoice.subtotal || "0").toFixed(2)}</span>
              </div>
              {parseFloat(invoice.tax || "0") > 0 && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#A1A1AA]">Tax</span>
                  <span className="text-mt-ink">${parseFloat(invoice.tax || "0").toFixed(2)}</span>
                </div>
              )}
              {parseFloat(invoice.shipping || "0") > 0 && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#A1A1AA]">Shipping</span>
                  <span className="text-mt-ink">${parseFloat(invoice.shipping || "0").toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-mt-border">
                <span className="text-[14px] font-bold text-mt-ink">Total</span>
                <span className="text-[18px] font-bold" style={{ color: branding?.brandPrimaryColor || "#654BF9" }}>${parseFloat(invoice.total || "0").toFixed(2)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-8 pt-6 border-t border-[#F0F0F0]">
              <p className="text-[10px] font-bold text-[#A1A1AA] tracking-wider uppercase mb-2">Notes</p>
              <p className="text-[12px] text-mt-ink-3 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Refund Dialog */}
      {showRefund && (
        <RefundDialog
          entityType="invoice"
          entityId={invoice.id}
          entityTitle={`Invoice #${invoice.invoiceNumber}`}
          maxAmount={parseFloat(invoice.total || "0")}
          onClose={() => setShowRefund(false)}
          onSuccess={() => {
            setShowRefund(false);
            utils.estimatesInvoices.invoices.getById.invalidate({ id: invoiceId });
          }}
        />
      )}
    </DashboardLayout>
  );
}
