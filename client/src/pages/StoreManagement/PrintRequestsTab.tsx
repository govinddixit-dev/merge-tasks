/**
 * PrintRequestsTab — GAP 2 FIX
 *
 * Distributor-side view of print requests submitted by POC users through the
 * client portal. Allows the distributor to review, quote, and update status.
 *
 * Design: matches the existing StoreManagement tab aesthetic — clean table,
 * status badges, slide-in detail panel. No new design language introduced.
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Printer, Clock, CheckCircle, XCircle, ChevronRight,
  Package, FileText, DollarSign, Calendar, User, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintStatus = "submitted" | "reviewed" | "quoted" | "approved" | "in_production" | "completed" | "rejected";

interface PrintRequest {
  id: number;
  storeId: number;
  requestedBy: string;
  requestedByName: string | null;
  category: string;
  title: string;
  description: string | null;
  quantity: number;
  attachments: string[];
  status: PrintStatus;
  quotedPrice: string | null;
  distributorNotes: string | null;
  estimatedDelivery: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PrintStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  submitted:     { label: "Submitted",     variant: "secondary",    icon: <Clock size={12} /> },
  reviewed:      { label: "Reviewed",      variant: "outline",      icon: <FileText size={12} /> },
  quoted:        { label: "Quoted",        variant: "default",      icon: <DollarSign size={12} /> },
  approved:      { label: "Approved",      variant: "default",      icon: <CheckCircle size={12} /> },
  in_production: { label: "In Production", variant: "default",      icon: <Package size={12} /> },
  completed:     { label: "Completed",     variant: "default",      icon: <CheckCircle size={12} /> },
  rejected:      { label: "Rejected",      variant: "destructive",  icon: <XCircle size={12} /> },
};

const CATEGORY_LABELS: Record<string, string> = {
  business_cards: "Business Cards",
  envelopes:      "Envelopes",
  letterhead:     "Letterhead",
  brochures:      "Brochures",
  flyers:         "Flyers",
  banners:        "Banners",
  signage:        "Signage",
  promotional:    "Promotional",
  packaging:      "Packaging",
  other:          "Other",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PrintRequestsTabProps {
  storeId: number;
}

export function PrintRequestsTab({ storeId }: PrintRequestsTabProps) {
  const [selectedRequest, setSelectedRequest] = useState<PrintRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Form state for the detail sheet
  const [editStatus, setEditStatus] = useState<PrintStatus>("submitted");
  const [editQuote, setEditQuote] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDelivery, setEditDelivery] = useState("");

  const utils = trpc.useUtils();

  const { data: requests, isLoading, refetch } = trpc.printRequests.list.useQuery(
    { storeId },
    { refetchOnWindowFocus: false },
  );

  const updateStatus = trpc.printRequests.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Print request updated");
      setSheetOpen(false);
      utils.printRequests.list.invalidate({ storeId });
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  function openRequest(req: PrintRequest) {
    setSelectedRequest(req);
    setEditStatus(req.status);
    setEditQuote(req.quotedPrice || "");
    setEditNotes(req.distributorNotes || "");
    setEditDelivery(req.estimatedDelivery ? req.estimatedDelivery.split("T")[0] : "");
    setSheetOpen(true);
  }

  function handleSave() {
    if (!selectedRequest) return;
    updateStatus.mutate({
      id: selectedRequest.id,
      storeId,
      status: editStatus,
      quotedPrice: editQuote || undefined,
      distributorNotes: editNotes || undefined,
      estimatedDelivery: editDelivery || undefined,
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading print requests…
      </div>
    );
  }

  const empty = !requests || requests.length === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Print Requests</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Requests submitted by portal users for printed materials
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} className="mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Empty state */}
      {empty ? (
        <div className="flex flex-col items-center justify-center h-48 border border-dashed rounded-lg text-muted-foreground gap-2">
          <Printer size={28} className="opacity-40" />
          <p className="text-sm font-medium">No print requests yet</p>
          <p className="text-xs">When portal users submit print requests, they'll appear here.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Request</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Category</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Submitted By</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Qty</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Date</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(requests as PrintRequest[]).map((req, i) => {
                const cfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.submitted;
                return (
                  <tr
                    key={req.id}
                    className={`border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    onClick={() => openRequest(req)}
                  >
                    <td className="px-4 py-3 font-medium max-w-[200px] truncate">{req.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{CATEGORY_LABELS[req.category] ?? req.category}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <User size={12} className="text-muted-foreground" />
                        <span className="truncate max-w-[140px]">{req.requestedByName || req.requestedBy}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{req.quantity.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Badge variant={cfg.variant} className="gap-1 text-xs">
                        {cfg.icon}
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(req.createdAt)}</td>
                    <td className="px-4 py-3">
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selectedRequest && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="flex items-center gap-2">
                  <Printer size={18} />
                  {selectedRequest.title}
                </SheetTitle>
                <SheetDescription>
                  {CATEGORY_LABELS[selectedRequest.category] ?? selectedRequest.category} · Qty {selectedRequest.quantity}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5">
                {/* Requester info */}
                <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User size={13} />
                    <span>{selectedRequest.requestedByName || selectedRequest.requestedBy}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar size={13} />
                    <span>Submitted {formatDate(selectedRequest.createdAt)}</span>
                  </div>
                </div>

                {/* Description */}
                {selectedRequest.description && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                    <p className="text-sm">{selectedRequest.description}</p>
                  </div>
                )}

                {/* Attachments */}
                {selectedRequest.attachments.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Attachments</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedRequest.attachments.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 underline"
                        >
                          File {i + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <hr />

                {/* Status update */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Status</p>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as PrintStatus)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_CONFIG) as PrintStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Quote */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Quoted Price</p>
                  <div className="relative">
                    <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="0.00"
                      value={editQuote}
                      onChange={(e) => setEditQuote(e.target.value)}
                    />
                  </div>
                </div>

                {/* Estimated delivery */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Estimated Delivery</p>
                  <Input
                    type="date"
                    value={editDelivery}
                    onChange={(e) => setEditDelivery(e.target.value)}
                  />
                </div>

                {/* Notes */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Notes to Client</p>
                  <Textarea
                    placeholder="Add notes visible to the portal user…"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Save */}
                <Button
                  className="w-full"
                  onClick={handleSave}
                  disabled={updateStatus.isPending}
                >
                  {updateStatus.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
