/**
 * QuickBooksPanel.tsx
 * ──────────────────
 * QuickBooks Online integration card for the Settings → Integrations tab.
 * Two states: disconnected (connect CTA) and connected (status, sync, disconnect).
 *
 * Backend dependency: trpc.quickbooks.getStatus / .connect / .syncNow / .disconnect
 * These procedures do not exist yet — the UI renders gracefully when the query
 * returns undefined (shows the disconnected state).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CheckCircle2,
  RefreshCw,
  Unplug,
  ArrowUpRight,
  Loader2,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import IntegrationLogo from "./IntegrationLogo";

export default function QuickBooksPanel() {
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);

  // These queries/mutations will fail gracefully until the backend is built
  // `trpc.quickbooks` does not exist yet — cast to `any` is intentional until the backend router is implemented.
  const { data: status, refetch } = (trpc as any).quickbooks?.getStatus?.useQuery?.(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  }) ?? { data: undefined, refetch: () => {} };

  const isConnected = status?.connected === true;

  const handleConnect = async () => {
    // QuickBooks OAuth isn't wired to a backend router yet. Until it is, open
    // the QuickBooks marketing page as a placeholder destination and surface a
    // "coming soon" toast — so the button never does nothing.
    const connectMut = (trpc as unknown as {
      quickbooks?: { connect?: { mutate?: () => Promise<{ authUrl?: string }> } };
    }).quickbooks?.connect?.mutate;
    if (connectMut) {
      try {
        const result = await connectMut();
        if (result?.authUrl) {
          window.open(result.authUrl, "_blank", "noopener,noreferrer");
          return;
        }
      } catch {
        // fall through to placeholder
      }
    }
    window.open("https://quickbooks.intuit.com", "_blank", "noopener,noreferrer");
    toast.info("QuickBooks integration coming soon", {
      description: "We'll let you know the moment OAuth is live in MergeTasks.",
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // `trpc.quickbooks` does not exist yet — cast to `any` is intentional until the backend router is implemented.
      await (trpc as any).quickbooks.syncNow.mutate();
      toast.success("QuickBooks sync started");
      await refetch();
    } catch {
      toast.error("QuickBooks sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setShowDisconnect(false);
    setDisconnecting(true);
    try {
      // `trpc.quickbooks` does not exist yet — cast to `any` is intentional until the backend router is implemented.
      await (trpc as any).quickbooks.disconnect.mutate();
      toast.success("QuickBooks disconnected");
      await refetch();
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!isConnected) {
    // ── Disconnected state ──
    return (
      <div className="bg-white rounded-lg border border-mt-border p-6">
        <div className="flex items-start gap-4">
          <IntegrationLogo kind="quickbooks" />
          <div className="flex-1 min-w-0">
            <h4 className="text-[14px] font-semibold text-mt-ink">QuickBooks Online</h4>
            <p className="text-[12px] text-mt-ink-3 mt-0.5 leading-relaxed">
              Sync invoices, payments, and customer records. Automatically reconcile orders and generate financial reports.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleConnect}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white rounded-lg transition-colors"
                style={{ backgroundColor: "#2CA01C" }}
              >
                Connect QuickBooks
                <ArrowUpRight size={12} />
              </button>
              <a
                href="https://quickbooks.intuit.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-mt-ink-4 hover:text-mt-ink-3 underline"
              >
                Learn more
              </a>
            </div>
            <p className="text-[10px] text-mt-ink-4 mt-2">
              By connecting, you authorize MergeTasks to sync data per our{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected state ──
  return (
    <div className="bg-white rounded-lg border border-mt-border p-6">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
          <IntegrationLogo kind="quickbooks" />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-[14px] font-semibold text-mt-ink">QuickBooks Online</h4>
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] px-2 py-0.5 rounded">
                <CheckCircle2 size={9} /> Connected
              </span>
            </div>
            <p className="text-[11px] text-mt-ink-3 mt-0.5">
              Company: {status?.companyName ?? "—"} · Last sync: {status?.lastSync ?? "Never"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-primary bg-mt-brand-light rounded-md hover:bg-[#E8E0FF] transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Sync Now
          </button>
          <button
            onClick={() => setShowDisconnect(true)}
            disabled={disconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {disconnecting ? <Loader2 size={11} className="animate-spin" /> : <Unplug size={11} />}
            Disconnect
          </button>
        </div>
      </div>

      {/* Sync stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Invoices Synced", value: status?.invoicesSynced?.toLocaleString() ?? "0", icon: BarChart3, color: "#2CA01C" },
          { label: "Payments Matched", value: status?.paymentsMatched?.toLocaleString() ?? "0", icon: CheckCircle2, color: "#16A34A" },
          { label: "Customers Linked", value: status?.customersLinked?.toLocaleString() ?? "0", icon: CheckCircle2, color: "#0EA5E9" },
          { label: "Sync Errors", value: status?.syncErrors?.toString() ?? "0", icon: AlertTriangle, color: status?.syncErrors > 0 ? "#EF4444" : "#A3A3A3" },
        ].map((stat, i) => (
          <div key={i} className="p-3.5 bg-mt-surface rounded-lg border border-mt-border">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-semibold text-mt-ink-4 uppercase tracking-wider">{stat.label}</span>
              <stat.icon size={12} style={{ color: stat.color }} />
            </div>
            <p className="text-[18px] font-bold text-mt-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Sync health */}
      {status?.syncErrors > 0 && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} className="text-red-500" />
            <span className="text-[11px] text-red-700 font-medium">
              {status.syncErrors} sync error{status.syncErrors > 1 ? "s" : ""} detected. Check QuickBooks for mismatched records.
            </span>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showDisconnect}
        title="Disconnect QuickBooks?"
        description="Existing synced data will be preserved. You can reconnect any time."
        confirmLabel="Disconnect"
        loading={disconnecting}
        onCancel={() => setShowDisconnect(false)}
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
