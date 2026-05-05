/**
 * SettingsTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Settings tab for StoreManagement: general store settings (name, welcome
 * message, primary color, email sender), SSO/authentication info, POC
 * management, and the danger zone (deactivate/delete).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Building2, Shield, Mail, AlertTriangle, Edit, RefreshCw,
  Lock, Eye, Globe, MapPin, CreditCard, Plus, Trash2, Pencil, X, Star, Tag, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EffectiveStore } from "./StoreManagementTypes";
import type { RouterOutput } from "@/lib/trpc";

type DbStore = RouterOutput["stores"]["getById"];
type SettingsFormState = { name: string; welcomeMessage: string; primaryColor: string; senderName: string; senderEmail: string };
type PocFormState = { name: string; email: string };

interface SettingsTabProps {
  effectiveStore: EffectiveStore;
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
  editingSettings: boolean;
  setEditingSettings: (v: boolean) => void;
  settingsForm: SettingsFormState;
  setSettingsForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
  savingSettings: boolean;
  setSavingSettings: (v: boolean) => void;
  editingPoc: boolean;
  setEditingPoc: (v: boolean) => void;
  pocForm: PocFormState;
  setPocForm: React.Dispatch<React.SetStateAction<PocFormState>>;
  onStoreDeleted: () => void;
}

export function SettingsTab({
  effectiveStore,
  isNumeric,
  numericId,
  dbStore,
  editingSettings,
  setEditingSettings,
  settingsForm,
  setSettingsForm,
  savingSettings,
  setSavingSettings,
  editingPoc,
  setEditingPoc,
  pocForm,
  setPocForm,
  onStoreDeleted,
}: SettingsTabProps) {
  const utils = trpc.useUtils();
  // Danger-zone dialogs — kept local because they don't need to outlive
  // the tab and one-per-action is clearer than a shared discriminated union.
  const [showDeactivateStore, setShowDeactivateStore] = React.useState(false);
  const [showDeleteStore, setShowDeleteStore] = React.useState(false);

  const updateStoreMut = trpc.stores.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      toast.success("Store settings saved");
      setSavingSettings(false);
      setEditingSettings(false);
    },
    onError: (e) => {
      toast.error(e.message);
      setSavingSettings(false);
    },
  });

  // ── Store Access Control state ─────────────────────────────────────────────
  // Derive initial mode from requireAuth: true = "private", false = "open_browsing"
  const [currentAccessMode, setCurrentAccessMode] = React.useState<string>(
    effectiveStore.requireAuth === false ? "open_browsing" : "private"
  );

  const accessOptions: Array<{
    value: string;
    label: string;
    description: string;
    icon: React.ElementType;
    badge?: string;
    comingSoon?: boolean;
    requireAuth: boolean;
  }> = [
    {
      value: "private",
      label: "Private",
      description: "Employees must log in before they can see the store.",
      icon: Lock,
      requireAuth: true,
    },
    {
      value: "open_browsing",
      label: "Open Browsing",
      description: "Anyone can browse. Login required to order.",
      icon: Eye,
      badge: "Most Common",
      requireAuth: false,
    },
    {
      value: "public",
      label: "Public",
      description: "Anyone can browse and order. No login required.",
      icon: Globe,
      requireAuth: false,
      comingSoon: true,
    },
  ];

  const handleAccessModeChange = async (option: (typeof accessOptions)[number]) => {
    if (!isNumeric) return;
    const prev = currentAccessMode;
    setCurrentAccessMode(option.value);
    try {
      await updateStoreMut.mutateAsync({
        id: numericId,
        requireAuth: option.requireAuth,
      });
      toast.success(`Store access updated to ${option.label}`);
    } catch {
      setCurrentAccessMode(prev);
      toast.error("Failed to update store access");
    }
  };
  // ─────────────────────────────────────────────────────────────────────────────

  const deleteStoreMut = trpc.stores.delete.useMutation({
    onSuccess: () => {
      toast.success("Store deleted");
      onStoreDeleted();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateClientMut = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      setEditingPoc(false);
      toast.success("Point of contact updated");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* General Settings */}
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-bold text-mt-ink flex items-center gap-2">
            <Building2 size={16} className="text-primary" /> General
          </h3>
          {isNumeric && !editingSettings && (
            <button
              className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
              onClick={() => {
                setSettingsForm({
                  name: dbStore?.name || "",
                  welcomeMessage: dbStore?.welcomeMessage || "",
                  primaryColor: dbStore?.primaryColor || "var(--mt-brand)",
                  senderName: dbStore?.senderName || "",
                  senderEmail: dbStore?.senderEmail || "",
                });
                setEditingSettings(true);
              }}
            >
              <Edit size={12} /> Edit
            </button>
          )}
        </div>
        {editingSettings ? (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                Store Name
              </label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                value={settingsForm.name}
                onChange={(e) => setSettingsForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                Welcome Message
              </label>
              <textarea
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary resize-none"
                rows={2}
                value={settingsForm.welcomeMessage}
                onChange={(e) =>
                  setSettingsForm((f) => ({ ...f, welcomeMessage: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-8 h-8 rounded cursor-pointer border border-mt-border"
                  value={settingsForm.primaryColor}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, primaryColor: e.target.value }))
                  }
                />
                <input
                  className="flex-1 px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                  value={settingsForm.primaryColor}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, primaryColor: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="pt-2 border-t border-[#F5F5F5]">
              <p className="text-[11px] font-bold text-primary mb-2 uppercase tracking-wide">
                Email Sender
              </p>
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                    Sender Display Name
                  </label>
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                    placeholder="e.g. Acme Company Store"
                    value={settingsForm.senderName}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, senderName: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                    Reply-To Email
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                    placeholder="orders@yourcompany.com"
                    value={settingsForm.senderEmail}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, senderEmail: e.target.value }))
                    }
                  />
                  <p className="text-[10px] text-mt-ink-4 mt-1">
                    Replies from clients will go to this address. Defaults to your distributor
                    email if left blank.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 py-2 text-[12px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2"
                onClick={() => setEditingSettings(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2 text-[12px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
                disabled={savingSettings}
                onClick={() => {
                  if (!isNumeric) return;
                  setSavingSettings(true);
                  updateStoreMut.mutate({
                    id: numericId,
                    name: settingsForm.name || undefined,
                    welcomeMessage: settingsForm.welcomeMessage || undefined,
                    primaryColor: settingsForm.primaryColor || undefined,
                    senderName: settingsForm.senderName || undefined,
                    senderEmail: settingsForm.senderEmail || undefined,
                  });
                }}
              >
                {savingSettings ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {[
              { label: "Store Name", value: effectiveStore.name },
              { label: "Domain", value: effectiveStore.domain },
              {
                label: "Store Type",
                value:
                  effectiveStore.storeType === "Both"
                    ? "Promotional + Print"
                    : effectiveStore.storeType,
              },
              { label: "Status", value: effectiveStore.status },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-2"
                style={{ borderBottom: "1px solid #F5F5F5" }}
              >
                <span className="text-[12px] text-mt-ink-3">{item.label}</span>
                <span className="text-[13px] font-semibold text-mt-ink">{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Store Access Control ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={14} className="text-primary" />
          <h3 className="text-[14px] font-bold text-mt-ink">Store Access</h3>
        </div>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          Control who can view your store and its products.
        </p>
        <div className="space-y-2.5">
          {accessOptions.map((option) => {
            const isSelected = currentAccessMode === option.value;
            const isDisabled = !!option.comingSoon;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                onClick={() => !isDisabled && handleAccessModeChange(option)}
                disabled={isDisabled || updateStoreMut.isPending}
                className={[
                  "w-full text-left flex items-start gap-3.5 p-4 rounded-lg border-2",
                  "transition-all duration-200",
                  isSelected
                    ? "border-primary bg-[#F8F7FF]"
                    : isDisabled
                    ? "border-transparent bg-mt-surface opacity-50 cursor-not-allowed"
                    : "border-transparent bg-mt-surface hover:border-primary/30",
                ].join(" ")}
              >
                {/* Icon box */}
                <div
                  className={[
                    "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    isSelected ? "bg-[#F0EEFF]" : "bg-white",
                  ].join(" ")}
                >
                  <Icon
                    size={16}
                    className={isSelected ? "text-primary" : "text-mt-ink-4"}
                  />
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-[13px] font-semibold ${
                        isSelected ? "text-mt-ink" : "text-mt-ink-3"
                      }`}
                    >
                      {option.label}
                    </p>
                    {option.badge && (
                      <span className="text-[9px] font-bold uppercase text-primary bg-[#F0EEFF] px-2 py-0.5 rounded">
                        {option.badge}
                      </span>
                    )}
                    {option.comingSoon && (
                      <span className="text-[9px] font-bold uppercase text-mt-ink-4 bg-mt-surface-2 px-2 py-0.5 rounded">
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-mt-ink-3 mt-0.5">
                    {option.description}
                  </p>
                </div>
                {/* Radio dot */}
                <div
                  className={[
                    "mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                    isSelected ? "border-primary" : "border-mt-border",
                  ].join(" ")}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* SSO & Authentication */}
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <h3 className="text-[14px] font-bold text-mt-ink mb-4 flex items-center gap-2">
          <Shield size={16} className="text-primary" /> Authentication
        </h3>
        <div className="space-y-4">
          {[
            { label: "SSO Provider", value: effectiveStore.sso },
            { label: "Status", value: "Connected", color: "text-[#16A34A]" },
            { label: "Last Sync", value: "2 hours ago" },
            {
              label: "Active Users",
              value: `${Math.floor(effectiveStore.employees * 0.72).toLocaleString()} / ${effectiveStore.employees.toLocaleString()}`,
            },
          ].map((item: { label: string; value: string; color?: string }) => (
            <div
              key={item.label}
              className="flex items-center justify-between py-2"
              style={{ borderBottom: "1px solid #F5F5F5" }}
            >
              <span className="text-[12px] text-mt-ink-3">{item.label}</span>
              <span className={`text-[13px] font-semibold ${item.color || "text-mt-ink"}`}>
                {item.value}
              </span>
            </div>
          ))}
          <button
            className="sq-action-btn flex items-center gap-1.5 text-[12px] w-full justify-center mt-2 opacity-50 cursor-not-allowed"
            disabled
            title="Requires SSO provider integration"
          >
            <RefreshCw size={13} /> Force Sync
          </button>
        </div>
      </div>

      {/* POC Management */}
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <h3 className="text-[14px] font-bold text-mt-ink mb-4 flex items-center gap-2">
          <Mail size={16} className="text-primary" /> Point of Contact
        </h3>
        {editingPoc ? (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider">
                Name
              </label>
              <input
                className="w-full mt-1 px-3 py-2 text-[13px] border border-mt-border rounded-lg"
                value={pocForm.name}
                onChange={(e) => setPocForm({ ...pocForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider">
                Email
              </label>
              <input
                className="w-full mt-1 px-3 py-2 text-[13px] border border-mt-border rounded-lg"
                type="email"
                value={pocForm.email}
                onChange={(e) => setPocForm({ ...pocForm, email: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="sq-action-btn primary flex-1 text-[12px]"
                disabled={updateClientMut.isPending}
                onClick={() => {
                  if (!dbStore?.clientId) {
                    toast.error("No linked client");
                    return;
                  }
                  updateClientMut.mutate({
                    id: dbStore.clientId,
                    contactName: pocForm.name,
                    contactEmail: pocForm.email,
                  });
                }}
              >
                {updateClientMut.isPending ? "Saving..." : "Save"}
              </button>
              <button
                className="sq-action-btn flex-1 text-[12px]"
                onClick={() => setEditingPoc(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="flex items-center justify-between py-2"
              style={{ borderBottom: "1px solid #F5F5F5" }}
            >
              <span className="text-[12px] text-mt-ink-3">Primary POC</span>
              <div className="text-right">
                <span className="text-[13px] font-semibold text-mt-ink">
                  {effectiveStore.pocName}
                </span>
                <div className="text-[11px] text-mt-ink-4">{effectiveStore.pocEmail}</div>
              </div>
            </div>
            <div
              className="flex items-center justify-between py-2"
              style={{ borderBottom: "1px solid #F5F5F5" }}
            >
              <span className="text-[12px] text-mt-ink-3">Role</span>
              <span className="text-[13px] font-semibold text-mt-ink">Store Admin</span>
            </div>
            <button
              className="sq-action-btn flex items-center gap-1.5 text-[12px] w-full justify-center mt-2"
              onClick={() => {
                if (!isNumeric) {
                  toast("Demo store — cannot edit POC");
                  return;
                }
                setPocForm({
                  name: effectiveStore.pocName || "",
                  email: effectiveStore.pocEmail || "",
                });
                setEditingPoc(true);
              }}
            >
              <Edit size={13} /> Manage POC
            </button>
          </div>
        )}
      </div>

      {/* ── Divisions (multi-division stores, SSO + Enterprise gated) ─ */}
      <DivisionsCard
        isNumeric={isNumeric}
        numericId={numericId}
        dbStore={dbStore}
        effectiveStore={effectiveStore}
      />

      {/* ── Shipping Locations ──────────────────────────────────────── */}
      <ShippingLocationsCard
        isNumeric={isNumeric}
        numericId={numericId}
        dbStore={dbStore}
      />

      {/* ── Payment Methods ──────────────────────────────────────────── */}
      <PaymentMethodsCard
        isNumeric={isNumeric}
        numericId={numericId}
        dbStore={dbStore}
      />

      {/* ── Checkout Currency ────────────────────────────────────────── */}
      <CurrencyCard
        isNumeric={isNumeric}
        numericId={numericId}
        dbStore={dbStore}
      />

      {/* ── Promo Codes ──────────────────────────────────────────────── */}
      <PromoCodesCard
        isNumeric={isNumeric}
        numericId={numericId}
      />

      {/* Danger Zone */}
      <div className="bg-white rounded-lg border border-[#EF4444]/20 p-5">
        <h3 className="text-[14px] font-bold text-[#EF4444] mb-4 flex items-center gap-2">
          <AlertTriangle size={16} /> Danger Zone
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#FEF2F2]">
            <div>
              <span className="text-[13px] font-semibold text-mt-ink">Deactivate Store</span>
              <p className="text-[11px] text-mt-ink-3 mt-0.5">
                Temporarily hide the store from employees. Can be reactivated.
              </p>
            </div>
            <button
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md border border-[#EF4444] text-[#EF4444] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
              disabled={updateStoreMut.isPending}
              onClick={() => {
                if (!isNumeric) {
                  toast("Demo store — cannot deactivate");
                  return;
                }
                setShowDeactivateStore(true);
              }}
            >
              Deactivate
            </button>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#FEF2F2]">
            <div>
              <span className="text-[13px] font-semibold text-mt-ink">Delete Store</span>
              <p className="text-[11px] text-mt-ink-3 mt-0.5">
                Permanently remove this store and all associated data.
              </p>
              <p className="text-[10px] text-mt-ink-4 mt-1">
                This action is permanent and subject to our{" "}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">data retention policy</a>.
              </p>
            </div>
            <button
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors disabled:opacity-50"
              disabled={deleteStoreMut.isPending}
              onClick={() => {
                if (!isNumeric) {
                  toast("Demo store — cannot delete");
                  return;
                }
                setShowDeleteStore(true);
              }}
            >
              {deleteStoreMut.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shipping Locations Card ───────────────────────────────────────────────

type BranchLocation = { id: string; name: string; address: string; isDefault?: boolean };

function ShippingLocationsCard({
  isNumeric,
  numericId,
  dbStore,
}: {
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
}) {
  const utils = trpc.useUtils();
  const [locations, setLocations] = React.useState<BranchLocation[]>([]);
  const [editing, setEditing] = React.useState(false);
  const [editIdx, setEditIdx] = React.useState<number | null>(null);
  const [formName, setFormName] = React.useState("");
  const [formAddress, setFormAddress] = React.useState("");
  const [formDefault, setFormDefault] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (dbStore?.branchLocations) {
      setLocations(dbStore.branchLocations as BranchLocation[]);
    }
  }, [dbStore?.branchLocations]);

  const updateMut = trpc.stores.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      toast.success("Shipping locations saved");
      setSaving(false);
    },
    onError: (e) => { toast.error(e.message); setSaving(false); },
  });

  const resetForm = () => {
    setFormName("");
    setFormAddress("");
    setFormDefault(false);
    setEditIdx(null);
    setEditing(false);
  };

  const handleSave = () => {
    if (!formName.trim() || !formAddress.trim()) {
      toast.error("Name and address are required");
      return;
    }

    const updated = [...locations];
    const entry: BranchLocation = {
      id: editIdx !== null ? updated[editIdx].id : globalThis.crypto.randomUUID().slice(0, 8),
      name: formName.trim(),
      address: formAddress.trim(),
      isDefault: formDefault,
    };

    // If marking as default, clear other defaults
    if (formDefault) {
      updated.forEach((l) => { l.isDefault = false; });
    }

    if (editIdx !== null) {
      updated[editIdx] = entry;
    } else {
      updated.push(entry);
    }

    setLocations(updated);
    resetForm();
  };

  const handleRemove = (idx: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePersist = () => {
    if (!isNumeric) return;
    setSaving(true);
    updateMut.mutate({ id: numericId, branchLocations: locations });
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-bold text-mt-ink flex items-center gap-2">
          <MapPin size={16} className="text-primary" /> Shipping Locations
        </h3>
        {locations.length > 0 && !editing && (
          <button
            className="text-[11px] font-semibold text-primary hover:underline"
            onClick={handlePersist}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>
      <p className="text-[12px] text-mt-ink-3 mb-4">
        Configure the branch addresses available at checkout
      </p>

      {/* Location list */}
      {locations.length > 0 && (
        <div className="space-y-2 mb-3">
          {locations.map((loc, idx) => (
            <div
              key={loc.id}
              className="flex items-start gap-2 p-2.5 rounded-lg bg-mt-surface"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-mt-ink">{loc.name}</span>
                  {loc.isDefault && (
                    <span className="text-[9px] font-bold uppercase text-primary bg-[#F0EEFF] px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-mt-ink-3 truncate">{loc.address}</p>
              </div>
              <button
                className="p-1 hover:bg-mt-surface-2 rounded"
                onClick={() => {
                  setFormName(loc.name);
                  setFormAddress(loc.address);
                  setFormDefault(loc.isDefault ?? false);
                  setEditIdx(idx);
                  setEditing(true);
                }}
              >
                <Pencil size={12} className="text-mt-ink-4" />
              </button>
              <button
                className="p-1 hover:bg-red-50 rounded"
                onClick={() => handleRemove(idx)}
              >
                <Trash2 size={12} className="text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {editing ? (
        <div className="space-y-2 p-3 rounded-lg border border-mt-border bg-mt-surface">
          <input
            className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
            placeholder="Location name (e.g. HQ, Warehouse A)"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <input
            className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
            placeholder="Full address"
            value={formAddress}
            onChange={(e) => setFormAddress(e.target.value)}
          />
          <label className="flex items-center gap-2 text-[12px] text-mt-ink-3">
            <input
              type="checkbox"
              checked={formDefault}
              onChange={(e) => setFormDefault(e.target.checked)}
              className="rounded border-mt-border"
            />
            Set as default location
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 py-2 text-[12px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2"
              onClick={resetForm}
            >
              Cancel
            </button>
            <button
              className="flex-1 py-2 text-[12px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7]"
              onClick={handleSave}
            >
              {editIdx !== null ? "Update" : "Add"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="w-full py-2 text-[12px] font-semibold text-primary rounded-lg border border-dashed border-primary/30 hover:bg-[#F8F7FF] flex items-center justify-center gap-1.5 transition-colors"
          onClick={() => setEditing(true)}
        >
          <Plus size={13} /> Add Location
        </button>
      )}

      {/* Persist button when there are unsaved changes */}
      {locations.length > 0 && !editing && (
        <button
          className="w-full mt-3 py-2 text-[12px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
          disabled={saving}
          onClick={handlePersist}
        >
          {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving...</> : "Save Locations"}
        </button>
      )}
    </div>
  );
}

// ─── Payment Methods Card ──────────────────────────────────────────────────

const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string; icon: React.ElementType }> = [
  { value: "credit_card", label: "Credit Card", icon: CreditCard },
  { value: "po_number", label: "Purchase Order", icon: Mail },
  { value: "gl_code", label: "GL Code", icon: Building2 },
  { value: "company_points", label: "Company Points", icon: Star },
];

function PaymentMethodsCard({
  isNumeric,
  numericId,
  dbStore,
}: {
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
}) {
  const utils = trpc.useUtils();
  const [methods, setMethods] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (dbStore?.allowedPaymentMethods) {
      setMethods(dbStore.allowedPaymentMethods as string[]);
    } else {
      // Default: all methods allowed
      setMethods(["credit_card", "po_number", "gl_code", "company_points"]);
    }
  }, [dbStore?.allowedPaymentMethods]);

  const updateMut = trpc.stores.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      toast.success("Payment methods saved");
      setSaving(false);
    },
    onError: (e) => { toast.error(e.message); setSaving(false); },
  });

  const toggle = (method: string) => {
    setMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSave = () => {
    if (!isNumeric) return;
    if (methods.length === 0) {
      toast.error("At least one payment method must be enabled");
      return;
    }
    setSaving(true);
    updateMut.mutate({
      id: numericId,
      allowedPaymentMethods: methods as ("credit_card" | "po_number" | "gl_code" | "company_points")[],
    });
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard size={16} className="text-primary" />
        <h3 className="text-[14px] font-bold text-mt-ink">Payment Methods</h3>
      </div>
      <p className="text-[12px] text-mt-ink-3 mb-4">
        Control which payment methods are available to store users
      </p>

      <div className="space-y-2">
        {PAYMENT_METHOD_OPTIONS.map((opt) => {
          const checked = methods.includes(opt.value);
          const Icon = opt.icon;
          return (
            <label
              key={opt.value}
              className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:bg-mt-surface"
              style={{
                borderColor: checked ? "var(--mt-brand, #6C2BD9)" : "var(--mt-border, #E5E5E5)",
                backgroundColor: checked ? "#F8F7FF" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.value)}
                className="rounded border-mt-border"
              />
              <Icon size={14} className={checked ? "text-primary" : "text-mt-ink-4"} />
              <span className={`text-[13px] font-semibold ${checked ? "text-mt-ink" : "text-mt-ink-3"}`}>
                {opt.label}
              </span>
            </label>
          );
        })}
      </div>

      <button
        className="w-full mt-4 py-2 text-[12px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
        disabled={saving}
        onClick={handleSave}
      >
        {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving...</> : "Save Payment Methods"}
      </button>
    </div>
  );
}

// ─── Currency Card ─────────────────────────────────────────────────────────

function CurrencyCard({
  isNumeric,
  numericId,
  dbStore,
}: {
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
}) {
  const utils = trpc.useUtils();
  const [currency, setCurrency] = React.useState<"usd" | "cad">("usd");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const c = (dbStore as { currency?: string } | null | undefined)?.currency;
    if (c === "cad" || c === "usd") setCurrency(c);
  }, [dbStore]);

  const updateMut = trpc.stores.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
      toast.success("Currency saved");
      setSaving(false);
    },
    onError: (e) => { toast.error(e.message); setSaving(false); },
  });

  const handleSave = () => {
    if (!isNumeric) return;
    setSaving(true);
    updateMut.mutate({ id: numericId, currency });
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard size={16} className="text-primary" />
        <h3 className="text-[14px] font-bold text-mt-ink">Checkout Currency</h3>
      </div>
      <p className="text-[12px] text-mt-ink-3 mb-4">
        Currency used on Stripe checkout for this store
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {(["usd", "cad"] as const).map((opt) => {
          const active = currency === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setCurrency(opt)}
              className="p-3 rounded-lg border text-[13px] font-semibold transition-all"
              style={{
                borderColor: active ? "var(--mt-brand, #6C2BD9)" : "var(--mt-border, #E5E5E5)",
                backgroundColor: active ? "#F8F7FF" : "transparent",
                color: active ? "var(--mt-brand, #6C2BD9)" : "var(--mt-ink-3, #525252)",
              }}
            >
              {opt.toUpperCase()}
            </button>
          );
        })}
      </div>
      <button
        className="w-full py-2 text-[12px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
        disabled={saving}
        onClick={handleSave}
      >
        {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving...</> : "Save Currency"}
      </button>
    </div>
  );
}

// ─── Promo Codes Card ──────────────────────────────────────────────────────

type PromoCode = {
  id: number;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: string;
  minOrderAmount: string | null;
  maxDiscountAmount: string | null;
  maxUses: number | null;
  usedCount: number | null;
  maxUsesPerUser: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean | null;
};

function PromoCodesCard({
  isNumeric,
  numericId,
}: {
  isNumeric: boolean;
  numericId: number;
}) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [promoDeactivateTarget, setPromoDeactivateTarget] = React.useState<{ id: number; code: string } | null>(null);

  // Form state
  const [formCode, setFormCode] = React.useState("");
  const [formDescription, setFormDescription] = React.useState("");
  const [formDiscountType, setFormDiscountType] = React.useState<"percentage" | "fixed_amount">("percentage");
  const [formDiscountValue, setFormDiscountValue] = React.useState("");
  const [formMinOrder, setFormMinOrder] = React.useState("");
  const [formMaxDiscount, setFormMaxDiscount] = React.useState("");
  const [formMaxUses, setFormMaxUses] = React.useState("");
  const [formExpiresAt, setFormExpiresAt] = React.useState("");

  const { data: codes, isLoading } = trpc.promoCodes.list.useQuery(
    { storeId: numericId },
    { enabled: isNumeric },
  );

  const createMut = trpc.promoCodes.create.useMutation({
    onSuccess: () => {
      utils.promoCodes.list.invalidate({ storeId: numericId });
      toast.success("Promo code created");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.promoCodes.update.useMutation({
    onSuccess: () => {
      utils.promoCodes.list.invalidate({ storeId: numericId });
      toast.success("Promo code updated");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.promoCodes.delete.useMutation({
    onSuccess: () => {
      utils.promoCodes.list.invalidate({ storeId: numericId });
      toast.success("Promo code deactivated");
      setPromoDeactivateTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    setCreating(false);
    setEditingId(null);
    setFormCode("");
    setFormDescription("");
    setFormDiscountType("percentage");
    setFormDiscountValue("");
    setFormMinOrder("");
    setFormMaxDiscount("");
    setFormMaxUses("");
    setFormExpiresAt("");
  };

  const openEdit = (promo: PromoCode) => {
    setEditingId(promo.id);
    setCreating(true);
    setFormCode(promo.code);
    setFormDescription(promo.description ?? "");
    setFormDiscountType(promo.discountType as "percentage" | "fixed_amount");
    setFormDiscountValue(promo.discountValue);
    setFormMinOrder(promo.minOrderAmount ?? "");
    setFormMaxDiscount(promo.maxDiscountAmount ?? "");
    setFormMaxUses(promo.maxUses?.toString() ?? "");
    setFormExpiresAt(promo.expiresAt ? promo.expiresAt.slice(0, 10) : "");
  };

  const handleSave = () => {
    if (!formCode.trim() || !formDiscountValue.trim()) {
      toast.error("Code and discount value are required");
      return;
    }

    if (editingId) {
      updateMut.mutate({
        id: editingId,
        storeId: numericId,
        description: formDescription || undefined,
        discountValue: formDiscountValue,
        minOrderAmount: formMinOrder || null,
        maxDiscountAmount: formMaxDiscount || null,
        maxUses: formMaxUses ? parseInt(formMaxUses, 10) : null,
        expiresAt: formExpiresAt || null,
      });
    } else {
      createMut.mutate({
        storeId: numericId,
        code: formCode.trim(),
        description: formDescription || undefined,
        discountType: formDiscountType,
        discountValue: formDiscountValue,
        minOrderAmount: formMinOrder || undefined,
        maxDiscountAmount: formMaxDiscount || undefined,
        maxUses: formMaxUses ? parseInt(formMaxUses, 10) : undefined,
        expiresAt: formExpiresAt || undefined,
      });
    }
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-bold text-mt-ink flex items-center gap-2">
          <Tag size={16} className="text-primary" /> Promo Codes
        </h3>
        {!creating && (
          <button
            className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
            onClick={() => { resetForm(); setCreating(true); }}
          >
            <Plus size={12} /> New Code
          </button>
        )}
      </div>
      <p className="text-[12px] text-mt-ink-3 mb-4">
        Create discount codes for store users
      </p>

      {/* Create / Edit Form */}
      {creating && (
        <div className="space-y-2 p-3 rounded-lg border border-mt-border bg-mt-surface mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Code</label>
              <input
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary uppercase font-mono"
                placeholder="SUMMER20"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                disabled={!!editingId}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Type</label>
              <select
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                value={formDiscountType}
                onChange={(e) => setFormDiscountType(e.target.value as "percentage" | "fixed_amount")}
                disabled={!!editingId}
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed_amount">Fixed Amount ($)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">
                Value {formDiscountType === "percentage" ? "(%)" : "($)"}
              </label>
              <input
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                placeholder={formDiscountType === "percentage" ? "20" : "10.00"}
                value={formDiscountValue}
                onChange={(e) => setFormDiscountValue(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Max Uses</label>
              <input
                type="number"
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                placeholder="Unlimited"
                value={formMaxUses}
                onChange={(e) => setFormMaxUses(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Description</label>
            <input
              className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
              placeholder="Optional description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Min Order ($)</label>
              <input
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                placeholder="0.00"
                value={formMinOrder}
                onChange={(e) => setFormMinOrder(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Max Disc ($)</label>
              <input
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                placeholder="No cap"
                value={formMaxDiscount}
                onChange={(e) => setFormMaxDiscount(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Expires</label>
              <input
                type="date"
                className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
                value={formExpiresAt}
                onChange={(e) => setFormExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 py-1.5 text-[11px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2"
              onClick={resetForm}
            >
              Cancel
            </button>
            <button
              className="flex-1 py-1.5 text-[11px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
              disabled={createMut.isPending || updateMut.isPending}
              onClick={handleSave}
            >
              {(createMut.isPending || updateMut.isPending) ? (
                <><Loader2 size={11} className="animate-spin" /> Saving...</>
              ) : editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Promo code list */}
      {isLoading ? (
        <div className="py-6 text-center">
          <Loader2 size={16} className="animate-spin mx-auto text-mt-ink-4" />
        </div>
      ) : !codes || codes.length === 0 ? (
        <div className="py-6 text-center">
          <Tag size={20} className="mx-auto mb-2 text-mt-ink-4" />
          <p className="text-[12px] text-mt-ink-3">No promo codes yet</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {codes.map((promo) => (
            <div
              key={promo.id}
              className={`flex items-start gap-2 p-2.5 rounded-lg ${promo.isActive ? "bg-mt-surface" : "bg-mt-surface opacity-50"}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold font-mono text-mt-ink">{promo.code}</span>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{
                    backgroundColor: promo.isActive ? "#DCFCE7" : "#FEE2E2",
                    color: promo.isActive ? "#16A34A" : "#DC2626",
                  }}>
                    {promo.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="text-[10px] text-mt-ink-4">
                    {promo.discountType === "percentage" ? `${promo.discountValue}%` : `$${promo.discountValue}`} off
                  </span>
                </div>
                {promo.description && (
                  <p className="text-[11px] text-mt-ink-3 truncate">{promo.description}</p>
                )}
                <p className="text-[10px] text-mt-ink-4">
                  Used: {promo.usedCount ?? 0}{promo.maxUses ? ` / ${promo.maxUses}` : ""}
                  {promo.expiresAt && ` · Expires: ${new Date(promo.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                className="p-1 hover:bg-mt-surface-2 rounded"
                onClick={() => openEdit(promo)}
                title="Edit"
              >
                <Pencil size={11} className="text-mt-ink-4" />
              </button>
              {promo.isActive && (
                <button
                  className="p-1 hover:bg-red-50 rounded"
                  onClick={() => setPromoDeactivateTarget({ id: promo.id, code: promo.code })}
                  title="Deactivate"
                >
                  <Trash2 size={11} className="text-red-400" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={promoDeactivateTarget !== null}
        title="Deactivate this promo code?"
        description={
          promoDeactivateTarget
            ? <>Code <strong className="font-mono">{promoDeactivateTarget.code}</strong> will stop working immediately. Existing redemptions stay on past orders.</>
            : null
        }
        confirmLabel="Deactivate"
        loading={deleteMut.isPending}
        onCancel={() => setPromoDeactivateTarget(null)}
        onConfirm={() => {
          if (!promoDeactivateTarget) return;
          deleteMut.mutate({ id: promoDeactivateTarget.id, storeId: numericId });
        }}
      />
    </div>
  );
}

// ─── Divisions Card ────────────────────────────────────────────────────────
// Post-launch division management scoped to one store. Writes to
// stores.divisions JSON via stores.update. Soft-delete only (isActive=false).
// Visible only when the store has SSO configured AND the caller is on the
// enterprise tier — mirrors the gating on the Create Webstore Step 4.

type StoreDivision = {
  id: string;
  name: string;
  departments: string[];
  pocEmail?: string;
  isActive?: boolean;
};

function newDivisionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

function DivisionsCard({
  isNumeric,
  numericId,
  dbStore,
  effectiveStore,
}: {
  isNumeric: boolean;
  numericId: number;
  dbStore: DbStore | null | undefined;
  effectiveStore: EffectiveStore;
}) {
  const utils = trpc.useUtils();
  const subQuery = trpc.billing.getSubscription.useQuery();
  const tier = subQuery.data?.tier;
  const isEnterprise = tier === "enterprise";

  const ssoProvider = dbStore?.ssoProvider ?? (effectiveStore.sso && effectiveStore.sso.toLowerCase() !== "none" ? "unknown" : "none");
  const hasSSO = ssoProvider !== "none";

  // TODO(phase-1.5): rehydrate divisions from the new location hierarchy.
  // The `stores.divisions` JSON field was removed when the divisions table
  // was dropped in migration 0082.
  const rawDivisions: StoreDivision[] = React.useMemo(() => [], []);

  const activeDivisions = React.useMemo(
    () => rawDivisions.filter((d) => d.isActive !== false),
    [rawDivisions],
  );

  const updateStoreMut = trpc.stores.update.useMutation({
    onSuccess: () => {
      utils.stores.getById.invalidate({ id: numericId });
    },
    onError: (e) => toast.error(e.message),
  });

  const resendItPacketMut = trpc.onboarding.resendItPacket.useMutation({
    onSuccess: () => toast.success("IT onboarding packet sent to your email"),
    onError: (e) => toast.error(e.message),
  });

  const persist = async (_next: StoreDivision[]) => {
    if (!isNumeric) {
      toast("Demo store — cannot edit divisions");
      return;
    }
    // TODO(phase-1.5): persist against the new locations endpoint. The
    // `divisions` field was removed from the stores.update mutation input
    // when the divisions table was dropped in migration 0082.
    toast("Division editing is temporarily disabled — pending location model.");
  };

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newPoc, setNewPoc] = React.useState("");
  const [newDepts, setNewDepts] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [divisionToDeactivate, setDivisionToDeactivate] = React.useState<{ id: string; name: string } | null>(null);

  // Hide entirely if the store has no SSO — matches wizard's SSO gate.
  if (!hasSSO) return null;

  // Non-enterprise: show a read-only upgrade prompt, same pattern as other
  // tier-gated surfaces in the app.
  if (!isEnterprise) {
    return (
      <div className="bg-white rounded-lg border border-mt-border p-5">
        <h3 className="text-[14px] font-bold text-mt-ink mb-2 flex items-center gap-2">
          <Building2 size={16} className="text-primary" /> Divisions
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-mt-surface-2 text-mt-ink-3">
            <Lock size={10} /> Enterprise
          </span>
        </h3>
        <p className="text-[12px] text-mt-ink-3">
          Multi-division management requires the Enterprise plan. Upgrade to organize this
          store by division, assign POCs, and roll up budgets per team.
        </p>
      </div>
    );
  }

  const saveRename = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    setBusyId(id);
    const next = rawDivisions.map((d) => (d.id === id ? { ...d, name } : d));
    try {
      await persist(next);
      toast.success("Division renamed");
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const requestDeactivate = (id: string) => {
    const target = rawDivisions.find((d) => d.id === id);
    if (!target) return;
    setDivisionToDeactivate({ id: target.id, name: target.name });
  };

  const confirmDeactivate = async () => {
    if (!divisionToDeactivate) return;
    const id = divisionToDeactivate.id;
    setBusyId(id);
    const next = rawDivisions.map((d) => (d.id === id ? { ...d, isActive: false } : d));
    try {
      await persist(next);
      toast.success("Division deactivated");
      setDivisionToDeactivate(null);
    } finally {
      setBusyId(null);
    }
  };

  const addDivision = async () => {
    const name = newName.trim();
    const poc = newPoc.trim();
    if (!name) { toast.error("Name is required"); return; }
    if (!poc || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(poc)) {
      toast.error("A valid POC email is required");
      return;
    }
    const departments = newDepts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const entry: StoreDivision = {
      id: newDivisionId(),
      name,
      pocEmail: poc,
      departments,
      isActive: true,
    };
    const hadDivisionsBefore = activeDivisions.length > 0;
    setBusyId(entry.id);
    try {
      await persist([...rawDivisions, entry]);
      setAdding(false);
      setNewName("");
      setNewPoc("");
      setNewDepts("");
      // When this is the 2nd+ division, offer to resend the IT packet so
      // their IdP team gets the updated slugs / ACS URLs. One tap — no
      // friction, and it's skippable (just dismiss the toast).
      if (hadDivisionsBefore) {
        toast.success("Division added", {
          description: "Your IT team may need the updated onboarding packet with this division's SSO details.",
          action: {
            label: "Resend IT packet",
            onClick: () => resendItPacketMut.mutate(),
          },
        });
      } else {
        toast.success("Division added");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border p-5">
      <h3 className="text-[14px] font-bold text-mt-ink mb-4 flex items-center gap-2">
        <Building2 size={16} className="text-primary" /> Divisions
      </h3>

      {activeDivisions.length === 0 && !adding && (() => {
        // Store was provisioned with multiDepartment=true (multi-division
        // enabled during wizard setup) but nobody has actually configured
        // any divisions yet. Show a gentle first-run prompt with a single
        // direct CTA — this lives inside the existing card so the layout
        // rhythm of the Settings tab is preserved.
        const isMulti = dbStore?.multiDepartment === true;
        if (isMulti) {
          return (
            <div className="rounded-md border border-dashed border-primary/40 bg-mt-brand-light/40 p-5 text-center">
              <Building2 size={20} className="mx-auto mb-2 text-primary" />
              <p className="text-[13px] font-semibold text-mt-ink mb-1">
                You haven&rsquo;t set up your divisions yet.
              </p>
              <p className="text-[12px] text-mt-ink-3 mb-3">
                Divisions let each team see their own products, budgets, and approvals.
              </p>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-primary rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity"
              >
                <Plus size={12} /> Add your first division
              </button>
            </div>
          );
        }
        return (
          <div className="py-6 text-center">
            <Building2 size={20} className="mx-auto mb-2 text-mt-ink-4" />
            <p className="text-[12px] text-mt-ink-3">No active divisions</p>
          </div>
        );
      })()}

      {activeDivisions.length > 0 && (
        <div className="space-y-2 mb-3">
          {activeDivisions.map((d) => {
            const isEditing = editingId === d.id;
            const isBusy = busyId === d.id;
            return (
              <div
                key={d.id}
                className="flex items-start gap-2 p-2.5 rounded-lg bg-mt-surface"
              >
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveRename(d.id); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => saveRename(d.id)}
                      className="w-full text-[13px] font-semibold text-mt-ink border-b border-primary bg-transparent outline-none"
                    />
                  ) : (
                    <div className="text-[13px] font-semibold text-mt-ink">{d.name}</div>
                  )}
                  <div className="text-[11px] text-mt-ink-4">
                    {d.pocEmail ? d.pocEmail : "No POC email"}
                    {d.departments.length > 0 && ` · ${d.departments.length} dept${d.departments.length === 1 ? "" : "s"}`}
                  </div>
                  {d.departments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.departments.map((dept) => (
                        <span
                          key={dept}
                          className="text-[10px] font-medium px-1.5 py-0.5 bg-mt-surface-2 text-mt-ink-3 rounded"
                        >
                          {dept}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {isBusy ? (
                  <Loader2 size={12} className="animate-spin text-mt-ink-4 mt-1" />
                ) : (
                  <>
                    <button
                      className="p-1 hover:bg-mt-surface-2 rounded"
                      title="Rename"
                      onClick={() => { setEditingId(d.id); setEditName(d.name); }}
                    >
                      <Pencil size={11} className="text-mt-ink-4" />
                    </button>
                    <button
                      className="p-1 hover:bg-red-50 rounded"
                      title="Deactivate"
                      onClick={() => requestDeactivate(d.id)}
                    >
                      <Trash2 size={11} className="text-red-400" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-2 p-3 rounded-lg border border-primary/30 bg-mt-brand-light/20">
          <div>
            <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Name *</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. North America"
              className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">POC Email *</label>
            <input
              type="email"
              value={newPoc}
              onChange={(e) => setNewPoc(e.target.value)}
              placeholder="poc@client.com"
              className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Departments (comma-separated)</label>
            <input
              value={newDepts}
              onChange={(e) => setNewDepts(e.target.value)}
              placeholder="Marketing, Operations, HR"
              className="w-full px-2.5 py-1.5 rounded-lg border border-mt-border text-[12px] outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 py-1.5 text-[11px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2"
              onClick={() => { setAdding(false); setNewName(""); setNewPoc(""); setNewDepts(""); }}
              disabled={updateStoreMut.isPending}
            >
              Cancel
            </button>
            <button
              className="flex-1 py-1.5 text-[11px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
              onClick={addDivision}
              disabled={updateStoreMut.isPending}
            >
              {updateStoreMut.isPending ? (
                <><Loader2 size={11} className="animate-spin" /> Adding...</>
              ) : "Add Division"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="w-full flex items-center justify-center gap-1.5 border border-dashed border-primary/40 text-primary text-[12px] font-semibold rounded-lg py-2 hover:bg-mt-brand-light transition-colors"
          onClick={() => setAdding(true)}
        >
          <Plus size={12} /> Add Division
        </button>
      )}

      <ConfirmDialog
        open={divisionToDeactivate !== null}
        title="Deactivate this division?"
        description={
          divisionToDeactivate
            ? <><strong>{divisionToDeactivate.name}</strong> will be hidden from the active list. Departments stay linked for historical records.</>
            : null
        }
        confirmLabel="Deactivate"
        loading={busyId === divisionToDeactivate?.id}
        onCancel={() => setDivisionToDeactivate(null)}
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
