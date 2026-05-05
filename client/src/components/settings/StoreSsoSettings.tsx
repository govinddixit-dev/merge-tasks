/**
 * StoreSsoSettings — Distributor admin UI for managing SSO IdP configurations.
 *
 * Allows distributors to:
 *   - View configured identity providers
 *   - Add new SAML or OIDC connections
 *   - Edit/delete existing connections
 *   - Toggle enabled/disabled per IdP
 *
 * Gated to enterprise plan stores only (enforced in StoreEditorPage).
 */
import { useState } from "react";
import {
  Shield, Plus, Trash2, Pencil, Globe, Check, X,
  Loader2, AlertCircle, ExternalLink, BookOpen,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface StoreSsoSettingsProps {
  storeId: number;
}

type Protocol = "saml" | "oidc";

interface IdpFormState {
  name: string;
  protocol: Protocol;
  domain: string;
  samlEntryPoint: string;
  samlCertificate: string;
  samlIssuer: string;
  oidcDiscoveryUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  targetStoreId: number | null;
  defaultDepartmentId: number | null;
}

interface IdpRecord {
  id: number;
  name: string;
  protocol: Protocol;
  domain: string;
  samlEntryPoint: string | null;
  samlCertificate: string | null;
  samlIssuer: string | null;
  oidcDiscoveryUrl: string | null;
  oidcClientId: string | null;
  oidcClientSecret: string | null;
  targetStoreId: number | null;
  defaultDepartmentId: number | null;
  enabled: boolean;
}

const emptyForm: IdpFormState = {
  name: "",
  protocol: "saml",
  domain: "",
  samlEntryPoint: "",
  samlCertificate: "",
  samlIssuer: "",
  oidcDiscoveryUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  targetStoreId: null,
  defaultDepartmentId: null,
};

export default function StoreSsoSettings({ storeId }: StoreSsoSettingsProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<IdpFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: idps, isLoading, refetch } = trpc.storeSso.list.useQuery({ storeId });
  const createMut = trpc.storeSso.create.useMutation();
  const updateMut = trpc.storeSso.update.useMutation();
  const deleteMut = trpc.storeSso.delete.useMutation();

  // Sibling stores (same client) for multi-division routing. We scope by the
  // current store's clientId so admins only see their own tenant's stores.
  const { data: currentStore } = trpc.stores.getById.useQuery({ id: storeId });
  const clientId = currentStore?.clientId ?? null;
  const { data: siblingStoresRaw } = trpc.stores.list.useQuery(
    { clientId: clientId ?? undefined },
    { enabled: clientId != null },
  );
  const siblingStoresList = Array.isArray(siblingStoresRaw)
    ? siblingStoresRaw
    : siblingStoresRaw?.items ?? [];
  const siblingStores = siblingStoresList.filter((s: { id: number }) => s.id !== storeId);
  const targetStoreIdForDepts = form.targetStoreId ?? null;
  const { data: targetDepartments } = trpc.storeDepartmentBudgets.list.useQuery(
    { storeId: targetStoreIdForDepts ?? 0 },
    { enabled: targetStoreIdForDepts != null },
  );

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const handleOpenEdit = (idp: IdpRecord) => {
    setEditingId(idp.id);
    setForm({
      name: idp.name,
      protocol: idp.protocol,
      domain: idp.domain,
      samlEntryPoint: idp.samlEntryPoint || "",
      samlCertificate: idp.samlCertificate || "",
      samlIssuer: idp.samlIssuer || "",
      oidcDiscoveryUrl: idp.oidcDiscoveryUrl || "",
      oidcClientId: idp.oidcClientId || "",
      oidcClientSecret: idp.oidcClientSecret || "",
      targetStoreId: idp.targetStoreId ?? null,
      defaultDepartmentId: idp.defaultDepartmentId ?? null,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.domain) {
      toast.error("Name and domain are required");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateMut.mutateAsync({
          id: editingId,
          ...form,
          oidcClientSecret: form.oidcClientSecret === "••••••••" ? undefined : form.oidcClientSecret || undefined,
        });
        toast.success("IdP configuration updated");
      } else {
        await createMut.mutateAsync({ storeId, ...form });
        toast.success("IdP configuration created");
      }
      setShowModal(false);
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save IdP configuration";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      toast.success("IdP deleted");
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete IdP";
      toast.error(message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggle = async (id: number, currentEnabled: boolean) => {
    try {
      await updateMut.mutateAsync({ id, enabled: !currentEnabled });
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to toggle IdP";
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-mt-ink-4">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading SSO settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-bold text-mt-ink flex items-center gap-2">
            <Shield size={16} /> Single Sign-On (SSO)
          </h3>
          <p className="text-[12px] text-mt-ink-4 mt-1">
            Configure SAML 2.0 or OpenID Connect identity providers for enterprise login.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/guides/MergeTasks_SSO_Setup_Guide.pdf"
            download="MergeTasks_SSO_Setup_Guide.pdf"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-primary text-primary rounded-lg text-[12px] font-semibold hover:bg-primary/5 transition-colors"
            title="Download SSO Setup Guide"
          >
            <BookOpen size={14} /> Setup Guide
          </a>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[12px] font-semibold hover:bg-[#5438d4] transition-colors"
          >
            <Plus size={14} /> Add Provider
          </button>
        </div>
      </div>

      {/* Provider list */}
      {(!idps || idps.length === 0) ? (
        <div className="text-center py-12 border border-dashed border-mt-border rounded-xl">
          <Shield size={32} className="mx-auto text-mt-ink-4 mb-3" />
          <p className="text-[13px] text-mt-ink-3 font-medium">No identity providers configured</p>
          <p className="text-[11px] text-mt-ink-4 mt-1">Add a SAML or OIDC provider to enable enterprise SSO for this store.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {idps.map((idp: IdpRecord) => (
            <div
              key={idp.id}
              className="flex items-center gap-4 p-4 border border-mt-border rounded-xl bg-white"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-[11px] font-bold ${idp.protocol === "saml" ? "bg-blue-600" : "bg-emerald-600"}`}>
                {idp.protocol.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-mt-ink truncate">{idp.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${idp.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {idp.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Globe size={10} className="text-mt-ink-4" />
                  <span className="text-[11px] text-mt-ink-4">{idp.domain}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(idp.id, idp.enabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${idp.enabled ? "bg-primary" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${idp.enabled ? "left-[18px]" : "left-0.5"}`} />
                </button>
                {/* Edit */}
                <button onClick={() => handleOpenEdit(idp)} className="p-1.5 rounded-lg hover:bg-mt-surface text-mt-ink-4 hover:text-mt-ink transition-colors">
                  <Pencil size={14} />
                </button>
                {/* Delete */}
                <button onClick={() => setDeleteTarget({ id: idp.id, name: idp.name })} className="p-1.5 rounded-lg hover:bg-red-50 text-mt-ink-4 hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SP Metadata link */}
      {idps && idps.length > 0 && (
        <div className="p-3 bg-mt-surface rounded-lg">
          <p className="text-[11px] text-mt-ink-3">
            <strong>SP Metadata URL:</strong>{" "}
            <a
              href={`${baseUrl}/api/sso/saml/metadata/${storeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {baseUrl}/api/sso/saml/metadata/{storeId} <ExternalLink size={10} />
            </a>
          </p>
          <p className="text-[10px] text-mt-ink-4 mt-1">
            Provide this URL to your client's IT admin when configuring their IdP.
          </p>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Identity Provider" : "Add Identity Provider"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Provider Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Acme Corp Okta"
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
            </div>

            {/* Protocol */}
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Protocol</label>
              <div className="flex rounded-lg overflow-hidden border border-mt-border">
                {(["saml", "oidc"] as const).map((p) => (
                  <button
                    key={p}
                    className={`flex-1 py-2 text-[12px] font-semibold transition-colors ${form.protocol === p ? "bg-primary text-white" : "bg-white text-mt-ink-3"}`}
                    onClick={() => setForm({ ...form, protocol: p })}
                  >
                    {p === "saml" ? "SAML 2.0" : "OpenID Connect"}
                  </button>
                ))}
              </div>
            </div>

            {/* Domain */}
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink mb-1">Email Domain</label>
              <input
                type="text"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="e.g., acmecorp.com"
                className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
              />
              <p className="text-[10px] text-mt-ink-4 mt-1">Users with this email domain will be redirected to SSO.</p>
            </div>

            {/* SAML fields */}
            {form.protocol === "saml" && (
              <>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">IdP SSO URL (Entry Point)</label>
                  <input
                    type="url"
                    value={form.samlEntryPoint}
                    onChange={(e) => setForm({ ...form, samlEntryPoint: e.target.value })}
                    placeholder="https://your-idp.okta.com/app/.../sso/saml"
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">IdP Certificate (X.509, PEM)</label>
                  <textarea
                    value={form.samlCertificate}
                    onChange={(e) => setForm({ ...form, samlCertificate: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDp...&#10;-----END CERTIFICATE-----"
                    rows={4}
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[12px] font-mono outline-none focus:border-primary resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">Issuer (Entity ID)</label>
                  <input
                    type="text"
                    value={form.samlIssuer}
                    onChange={(e) => setForm({ ...form, samlIssuer: e.target.value })}
                    placeholder="Optional — defaults to mergetasks-store-{storeId}"
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
                  />
                </div>
              </>
            )}

            {/* OIDC fields */}
            {form.protocol === "oidc" && (
              <>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">Discovery URL</label>
                  <input
                    type="url"
                    value={form.oidcDiscoveryUrl}
                    onChange={(e) => setForm({ ...form, oidcDiscoveryUrl: e.target.value })}
                    placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">Client ID</label>
                  <input
                    type="text"
                    value={form.oidcClientId}
                    onChange={(e) => setForm({ ...form, oidcClientId: e.target.value })}
                    placeholder="Application (client) ID"
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">Client Secret</label>
                  <input
                    type="password"
                    value={form.oidcClientSecret}
                    onChange={(e) => setForm({ ...form, oidcClientSecret: e.target.value })}
                    placeholder="Client secret value"
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary"
                  />
                  <p className="text-[10px] text-mt-ink-4 mt-1">Encrypted at rest. Leave unchanged to keep the existing secret.</p>
                </div>
              </>
            )}

            {/* Multi-division routing — only shown when sibling stores exist */}
            {siblingStores.length > 0 && (
              <div className="pt-3 mt-2 border-t border-mt-border space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-mt-ink mb-1">Division Store (optional)</label>
                  <select
                    value={form.targetStoreId ?? ""}
                    onChange={(e) => setForm({
                      ...form,
                      targetStoreId: e.target.value ? Number(e.target.value) : null,
                      defaultDepartmentId: null,
                    })}
                    className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary bg-white"
                  >
                    <option value="">Sign in to this store (default)</option>
                    {siblingStores.map((s: { id: number; name: string }) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-mt-ink-4 mt-1">After SSO, redirect the user to this division store instead of the parent.</p>
                </div>
                {form.targetStoreId != null && (
                  <div>
                    <label className="block text-[12px] font-semibold text-mt-ink mb-1">Auto-assign Department (optional)</label>
                    <select
                      value={form.defaultDepartmentId ?? ""}
                      onChange={(e) => setForm({ ...form, defaultDepartmentId: e.target.value ? Number(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] outline-none focus:border-primary bg-white"
                    >
                      <option value="">No automatic assignment</option>
                      {(targetDepartments ?? []).map((d: { id: number; name: string }) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-mt-ink-4 mt-1">New users created via this IdP will be placed in this department.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button className="px-4 py-2 border border-mt-border rounded-lg text-[12px] font-semibold text-mt-ink-3 hover:bg-mt-surface transition-colors">
                Cancel
              </button>
            </DialogClose>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white rounded-lg text-[12px] font-semibold hover:bg-[#5438d4] transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : editingId ? "Save Changes" : "Create Provider"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this identity provider?"
        description={
          deleteTarget
            ? <>Users linked to <strong>{deleteTarget.name}</strong> will revert to OTP/password login. This cannot be undone.</>
            : null
        }
        confirmLabel="Delete"
        loading={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget.id); }}
      />
    </div>
  );
}
