/**
 * SupplierIntegrationsPanel
 *
 * Generic per-org supplier credential cards backed by the
 * `supplierCredentials` tRPC router. Each card collects an Account ID /
 * username and a password/secret, encrypts both server-side, and stores a
 * single row per (organizationId, supplierCode).
 *
 * SanMar is special: if no DB credentials exist for the org, the card
 * falls back to checking whether the platform has env-var-managed
 * credentials (SANMAR_ACCOUNT_ID / SANMAR_PASSWORD) and labels the card
 * as connected via "System credentials".
 *
 * Saved credentials are NEVER returned by the API, so this panel never
 * pre-fills password fields — same convention as a password manager.
 *
 * NOTE: Sync execution and connection-test endpoints still live in the
 * existing externalProducts/supplierSync routers and are not touched in
 * this session — this panel writes credentials only.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, ExternalLink,
  Wifi, WifiOff, AlertTriangle, Save, ChevronDown, ChevronUp,
  RefreshCw, Download
} from "lucide-react";
import { toast } from "sonner";
import IntegrationLogo, { type IntegrationKind } from "./IntegrationLogo";

//  Types

/** Subset of supplier codes accepted by the supplierCredentials router. */
type SupplierCode = "sanmar" | "sscanada" | "asi" | "alphabroder";

interface CredentialField {
  key: "accountId" | "password";
  label: string;
  placeholder: string;
  type: "text" | "password";
  hint?: string;
}

interface SupplierConfig {
  /** Stable code persisted to supplierCredentials.supplierCode. */
  code: SupplierCode;
  logoKind: IntegrationKind;
  name: string;
  description: string;
  docsUrl: string;
  credentialsUrl: string;
  credentialsHelp: string;
  fields: [CredentialField, CredentialField];
}

//  Supplier definitions

const SUPPLIERS: SupplierConfig[] = [
  {
    code: "sanmar",
    logoKind: "sanmar",
    name: "SanMar",
    description: "Bulk catalog sync and live inventory from SanMar.",
    docsUrl: "https://www.sanmar.com/api",
    credentialsUrl: "https://www.sanmar.com/account",
    credentialsHelp:
      "Use the SanMar account number and password issued to your organization for the SanMar integration / web services.",
    fields: [
      { key: "accountId", label: "SanMar Account Number", placeholder: "e.g. 12345", type: "text" },
      { key: "password", label: "SanMar Password", placeholder: "Your SanMar integration password", type: "password" },
    ],
  },
  {
    code: "sscanada",
    logoKind: "ss",
    name: "S&S Canada",
    description: "Live inventory and pricing from S&S Canada.",
    docsUrl: "https://www.ssactivewear.ca/",
    credentialsUrl: "https://www.ssactivewear.ca/account",
    credentialsHelp: "Use your S&S Canada API account credentials.",
    fields: [
      { key: "accountId", label: "S&S Account ID", placeholder: "Your S&S account ID", type: "text" },
      { key: "password", label: "S&S Password", placeholder: "Your S&S account password", type: "password" },
    ],
  },
  {
    code: "asi",
    logoKind: "asi",
    name: "ASI ESP",
    description: "Search 3,400+ suppliers and 1M+ products via the ASI ESP product database.",
    docsUrl: "https://developers.asicentral.com",
    credentialsUrl: "https://www.asicentral.com/account/api",
    credentialsHelp: "Log in to asi.com → My Account → API Access to find your credentials.",
    fields: [
      { key: "accountId", label: "ASI Member ID", placeholder: "e.g. 123456", type: "text", hint: "Your 6-digit ASI membership number" },
      { key: "password", label: "ESP API Key", placeholder: "e.g. abc123xyz...", type: "password", hint: "Found in asi.com → My Account → API Access" },
    ],
  },
  {
    code: "alphabroder",
    logoKind: "alphabroder",
    name: "alphabroder",
    description: "Live inventory and pricing from alphabroder.",
    docsUrl: "https://www.alphabroder.com/api",
    credentialsUrl: "https://www.alphabroder.com/account",
    credentialsHelp: "Use your existing alphabroder account login credentials.",
    fields: [
      { key: "accountId", label: "alphabroder Username", placeholder: "Your alphabroder username", type: "text" },
      { key: "password", label: "alphabroder Password", placeholder: "Your alphabroder account password", type: "password" },
    ],
  },
];

//  PSRESTful sync panel (unchanged — this remains backed by supplierSync)

function PSRestfulSupplierRow({ supplier }: {
  supplier: { id: number; name: string; psRestfulCode: string };
}) {
  const utils = trpc.useContext();
  const { data: jobs } = trpc.supplierSync.listJobs.useQuery({ supplierId: supplier.id, limit: 1 });
  const lastJob = jobs?.[0];

  const triggerSync = trpc.supplierSync.triggerSync.useMutation({
    onSuccess: (result) => {
      if (result.status === "completed") {
        toast.success(
          `${supplier.name}: ${result.productsScanned} scanned, ${result.priceChanges} price change${result.priceChanges !== 1 ? "s" : ""}`
        );
      } else {
        toast.error(`${supplier.name} sync failed: ${result.error ?? "unknown error"}`);
      }
      utils.supplierSync.listJobs.invalidate();
      utils.supplierSync.listCostChanges.invalidate();
    },
    onError: (err) => toast.error(`Sync failed: ${err.message}`),
  });

  const importCatalog = trpc.supplierSync.importCatalog.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.supplierSync.listJobs.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusDotClass = !lastJob
    ? "bg-gray-300"
    : lastJob.status === "completed"
      ? "bg-green-500"
      : lastJob.status === "failed"
        ? "bg-red-500"
        : "bg-amber-500";

  const lastSyncLabel = lastJob
    ? new Date(lastJob.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never synced";

  return (
    <div className="flex items-center gap-3 p-3 border border-mt-border rounded-lg bg-white hover:border-mt-border-strong transition-colors">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDotClass}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="text-[13px] font-bold text-mt-ink truncate">{supplier.name}</h4>
          <span className="inline-flex items-center text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            {supplier.psRestfulCode}
          </span>
        </div>
        <p className="text-[11px] text-mt-ink-3">
          Last sync: {lastSyncLabel}
          {lastJob?.status === "failed" && <span className="text-red-600 ml-1">— failed</span>}
          {lastJob?.status === "running" && <span className="text-amber-600 ml-1">— in progress</span>}
        </p>
      </div>
      <button
        onClick={() => importCatalog.mutate({ supplierId: supplier.id })}
        disabled={importCatalog.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#F0FDF4] text-[#16A34A] hover:bg-[#DCFCE7] transition-colors disabled:opacity-50"
      >
        {importCatalog.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        Import Catalog
      </button>
      <button
        onClick={() => triggerSync.mutate({ supplierId: supplier.id })}
        disabled={triggerSync.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-white rounded-lg hover:bg-[#5340d4] transition-all disabled:opacity-40"
      >
        {triggerSync.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Sync Now
      </button>
    </div>
  );
}

function PSRestfulCodeEditor({ supplier }: {
  supplier: { id: number; name: string; psRestfulCode: string | null };
}) {
  const utils = trpc.useContext();
  const [value, setValue] = useState(supplier.psRestfulCode ?? "");
  const initial = supplier.psRestfulCode ?? "";
  const dirty = value.trim() !== initial.trim();

  const updateCode = trpc.supplierSync.updatePsRestfulCode.useMutation({
    onSuccess: () => {
      toast.success(`${supplier.name} PSRESTful code saved`);
      utils.purchaseOrders.listSuppliers.invalidate();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const handleSave = () => {
    const trimmed = value.trim();
    updateCode.mutate({
      supplierId: supplier.id,
      psRestfulCode: trimmed === "" ? null : trimmed,
    });
  };

  return (
    <div className="flex items-center gap-3 p-3 border border-mt-border rounded-lg bg-white">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-mt-ink truncate">{supplier.name}</p>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="PSRESTful code"
        className="w-40 px-3 py-1.5 border border-mt-border rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
      <button
        onClick={handleSave}
        disabled={!dirty || updateCode.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-white rounded-lg hover:bg-[#5340d4] transition-all disabled:opacity-40"
      >
        {updateCode.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        Save
      </button>
    </div>
  );
}

function PSRestfulPriceChangeRows({ supplierId, supplierName }: { supplierId: number; supplierName: string }) {
  const { data: changes } = trpc.supplierSync.listCostChanges.useQuery({ supplierId, limit: 10 });
  if (!changes || changes.length === 0) return null;
  return (
    <>
      {changes.map((c) => {
        const hasPrevious = c.previousCostCents !== null;
        const delta = hasPrevious ? c.newCostCents - c.previousCostCents! : 0;
        const isUp = delta > 0;
        return (
          <tr key={c.id} className="border-t border-mt-border">
            <td className="px-3 py-2 text-[11px] text-mt-ink-2">{supplierName}</td>
            <td className="px-3 py-2 text-[11px] text-mt-ink-2">#{c.productId}</td>
            <td className="px-3 py-2 text-[11px] text-mt-ink-3 tabular-nums">
              {hasPrevious ? `${c.currency} ${(c.previousCostCents! / 100).toFixed(2)}` : "—"}
            </td>
            <td className="px-3 py-2 text-[11px] font-semibold text-mt-ink tabular-nums">
              {c.currency} {(c.newCostCents / 100).toFixed(2)}
              {hasPrevious && (
                <span className={`ml-2 text-[10px] font-normal ${isUp ? "text-red-600" : "text-green-600"}`}>
                  {isUp ? "▲" : "▼"} {(Math.abs(delta) / 100).toFixed(2)}
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-[11px] text-mt-ink-4 whitespace-nowrap">
              {new Date(c.createdAt).toLocaleDateString()}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function PSRestfulSyncPanel() {
  const { data } = trpc.purchaseOrders.listSuppliers.useQuery({});
  const allSuppliers = (data?.suppliers ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    psRestfulCode: s.psRestfulCode ?? null,
  }));
  const syncedSuppliers = allSuppliers
    .filter((s): s is typeof s & { psRestfulCode: string } => !!s.psRestfulCode);

  return (
    <div className="mb-6 p-5 bg-white border border-mt-border rounded-xl">
      <div className="mb-4">
        <h3 className="text-[13px] font-bold text-mt-ink mb-1">PSRESTful Catalog Sync</h3>
        <p className="text-[11px] text-mt-ink-3 leading-relaxed">
          Sync product pricing and decoration zones from the PSRESTful supplier network.
          MergeTasks connects on your behalf using a platform API key.
        </p>
      </div>

      {syncedSuppliers.length === 0 ? (
        <div className="p-4 bg-mt-surface border border-dashed border-mt-border rounded-lg text-[11px] text-mt-ink-3 text-center">
          No suppliers have PSRESTful sync configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {syncedSuppliers.map((s) => (
            <PSRestfulSupplierRow key={s.id} supplier={s} />
          ))}
        </div>
      )}

      {allSuppliers.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[12px] font-bold text-mt-ink mb-1">Supplier PSRESTful Codes</h4>
          <p className="text-[11px] text-mt-ink-3 mb-3">
            Set the PSRESTful supplier code for each supplier you want to sync. Clear the field to disable sync.
          </p>
          <div className="space-y-2">
            {allSuppliers.map((s) => (
              <PSRestfulCodeEditor key={s.id} supplier={s} />
            ))}
          </div>
        </div>
      )}

      {syncedSuppliers.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[12px] font-bold text-mt-ink mb-2">Recent Price Changes</h4>
          <div className="overflow-hidden border border-mt-border rounded-lg">
            <table className="w-full">
              <thead className="bg-mt-surface">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">Supplier</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">Product</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">Previous</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">New</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {syncedSuppliers.map((s) => (
                  <PSRestfulPriceChangeRows key={s.id} supplierId={s.id} supplierName={s.name} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

//  Supplier card (generic, backed by supplierCredentials router)

function SupplierCard({ supplier }: { supplier: SupplierConfig }) {
  const [expanded, setExpanded] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const utils = trpc.useContext();

  // DB-backed connection status (per-org saved credentials).
  const dbStatusQuery = trpc.supplierCredentials.getConnectionStatus.useQuery({
    supplierCode: supplier.code,
  });

  // SanMar-only: check whether the platform has env-var credentials when no
  // DB credentials are saved. This keeps Otentik Brand connected during
  // migration even before the seed script runs.
  const envFallbackQuery = trpc.externalProducts.connectionStatus.useQuery(undefined, {
    enabled: supplier.code === "sanmar",
  });

  const dbConnected = !!dbStatusQuery.data?.connected;
  const envConnected =
    supplier.code === "sanmar" && !dbConnected && !!envFallbackQuery.data?.sanmar.connected;
  const isConnected = dbConnected || envConnected;
  const lastUpdatedAt = dbStatusQuery.data?.lastUpdatedAt ?? null;

  const saveCredentials = trpc.supplierCredentials.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success(`${supplier.name} credentials saved`);
      utils.supplierCredentials.getConnectionStatus.invalidate({ supplierCode: supplier.code });
      utils.externalProducts.connectionStatus.invalidate();
      // Never echo saved values back; clear inputs immediately.
      setAccountId("");
      setPassword("");
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const deleteCredentials = trpc.supplierCredentials.deleteCredentials.useMutation({
    onSuccess: () => {
      toast.success(`${supplier.name} disconnected`);
      utils.supplierCredentials.getConnectionStatus.invalidate({ supplierCode: supplier.code });
      utils.externalProducts.connectionStatus.invalidate();
    },
    onError: (err) => toast.error(`Disconnect failed: ${err.message}`),
  });

  const allFieldsFilled = accountId.trim().length > 0 && password.trim().length > 0;

  const handleSave = () => {
    saveCredentials.mutate({
      supplierCode: supplier.code,
      accountId: accountId.trim(),
      password: password.trim(),
    });
  };

  const handleDisconnect = () => {
    deleteCredentials.mutate({ supplierCode: supplier.code });
  };

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  const sourceLabel: string | null =
    dbConnected ? (lastUpdatedLabel ? `Saved ${lastUpdatedLabel}` : "Connected")
    : envConnected ? "System credentials"
    : null;

  return (
    <div className={`bg-white border rounded-xl transition-all duration-200 ${expanded ? "border-primary" : "border-mt-border"}`}>
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-mt-surface rounded-xl transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <IntegrationLogo kind={supplier.logoKind} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="text-[13px] font-bold text-mt-ink">{supplier.name}</h4>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                isConnected
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-gray-100 text-gray-500 border border-gray-200"
              }`}
            >
              {isConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              {isConnected ? "Connected" : "Not connected"}
            </span>
            {envConnected && (
              <span className="inline-flex items-center text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                System
              </span>
            )}
          </div>
          <p className="text-[11px] text-mt-ink-3 truncate">{supplier.description}</p>
          {sourceLabel && (
            <p className="text-[10px] text-mt-ink-4 mt-0.5">{sourceLabel}</p>
          )}
        </div>

        {expanded ? (
          <ChevronUp className="w-4 h-4 text-mt-ink-4 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-mt-ink-4 flex-shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[#F0F0F0]">
          <div className="pt-4 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] text-blue-800">{supplier.credentialsHelp}</p>
                <a
                  href={supplier.credentialsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium mt-1 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Get credentials <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>

            {dbConnected && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Credentials are saved. Submit new values below to replace them.
              </div>
            )}

            {envConnected && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Using platform-managed system credentials. Save your own below to override.
              </div>
            )}

            {/* Account ID */}
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-2 mb-1.5">
                {supplier.fields[0].label}
                {supplier.fields[0].hint && (
                  <span className="ml-1.5 font-normal text-mt-ink-4">— {supplier.fields[0].hint}</span>
                )}
              </label>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={supplier.fields[0].placeholder}
                autoComplete="off"
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-2 mb-1.5">
                {supplier.fields[1].label}
                {supplier.fields[1].hint && (
                  <span className="ml-1.5 font-normal text-mt-ink-4">— {supplier.fields[1].hint}</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={supplier.fields[1].placeholder}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 pr-9 border border-mt-border rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mt-ink-4 hover:text-mt-ink-2"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={!allFieldsFilled || saveCredentials.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-white rounded-lg hover:bg-[#5340d4] transition-all disabled:opacity-40"
              >
                {saveCredentials.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {dbConnected ? "Update credentials" : "Save & connect"}
              </button>
              {dbConnected && (
                <button
                  onClick={handleDisconnect}
                  disabled={deleteCredentials.isPending}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-all disabled:opacity-40"
                >
                  {deleteCredentials.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                  Disconnect
                </button>
              )}
            </div>

            <a
              href={supplier.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-mt-ink-4 hover:text-primary transition-colors"
            >
              <ExternalLink className="w-2.5 h-2.5" /> View API documentation
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

//  Header summary helper

function useConnectedCount(): number {
  // Each card has its own getConnectionStatus query; aggregate by reading the
  // cache via a single query per supplier. For Session 1 this is fine — the
  // panel only renders four supplier cards.
  const sanmar = trpc.supplierCredentials.getConnectionStatus.useQuery({ supplierCode: "sanmar" });
  const sscanada = trpc.supplierCredentials.getConnectionStatus.useQuery({ supplierCode: "sscanada" });
  const asi = trpc.supplierCredentials.getConnectionStatus.useQuery({ supplierCode: "asi" });
  const alphabroder = trpc.supplierCredentials.getConnectionStatus.useQuery({ supplierCode: "alphabroder" });
  const env = trpc.externalProducts.connectionStatus.useQuery();
  let count = 0;
  if (sanmar.data?.connected || env.data?.sanmar.connected) count++;
  if (sscanada.data?.connected) count++;
  if (asi.data?.connected) count++;
  if (alphabroder.data?.connected) count++;
  return count;
}

//  Main panel

export default function SupplierIntegrationsPanel() {
  const connectedCount = useConnectedCount();

  return (
    <div>
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 bg-white border border-mt-border rounded-lg">
          <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Sources Connected</p>
          <p className="text-[22px] font-bold text-mt-ink">{connectedCount}<span className="text-[14px] text-mt-ink-4 font-normal"> / {SUPPLIERS.length}</span></p>
        </div>
        <div className="p-4 bg-white border border-mt-border rounded-lg">
          <p className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-1">Live Catalog</p>
          <p className="text-[13px] font-semibold text-mt-ink mt-1">
            {connectedCount > 0 ? (
              <span className="text-green-600 flex items-center gap-1.5">
                <Wifi className="w-4 h-4" /> Active — search ready
              </span>
            ) : (
              <span className="text-mt-ink-4 flex items-center gap-1.5">
                <WifiOff className="w-4 h-4" /> Connect a source to enable
              </span>
            )}
          </p>
        </div>
      </div>

      {/* How it works callout */}
      <div className="p-4 bg-primary/5 border border-primary/15 rounded-xl mb-5">
        <h4 className="text-[12px] font-bold text-primary mb-1">How Live Catalog Works</h4>
        <p className="text-[11px] text-mt-ink-2 leading-relaxed">
          Connect your supplier accounts below. Once connected, go to <strong>Catalog → Live Catalog</strong> to search
          products in real time, see live inventory, and import directly into your catalog with one click.
          Each distributor connects their own accounts — your credentials are encrypted and stored securely.
        </p>
      </div>

      {/* PSRESTful catalog sync — platform-managed supplier sync */}
      <PSRestfulSyncPanel />

      {/* Supplier cards */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold text-mt-ink mb-3">Supplier Connections</h3>
        {SUPPLIERS.map((supplier) => (
          <SupplierCard key={supplier.code} supplier={supplier} />
        ))}
      </div>
    </div>
  );
}
