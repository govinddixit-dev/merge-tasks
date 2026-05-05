import React, { useState } from "react";
import { MapPin, Loader2, Edit3, Save, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PortalLocationsTabProps {
  isDark: boolean;
  fg: string;
  mutedFg: string;
  borderColor: string;
  cardBg: string;
  storeSlug?: string;
  canManage: boolean;
}

interface BrandingForm {
  logoUrl: string;
  primaryColor: string;
  bannerUrl: string;
  bannerText: string;
  welcomeMessage: string;
  aiTagline: string;
}

const EMPTY_FORM: BrandingForm = {
  logoUrl: "",
  primaryColor: "#6C2BD9",
  bannerUrl: "",
  bannerText: "",
  welcomeMessage: "",
  aiTagline: "",
};

export function PortalLocationsTab({
  isDark, fg, mutedFg, borderColor, cardBg, storeSlug, canManage,
}: PortalLocationsTabProps) {
  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.storePortal.locations.list.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug },
  );
  const { data: ssoHealth } = trpc.storePortal.locations.unmappedGroups.useQuery(
    { storeSlug: storeSlug || "" },
    { enabled: !!storeSlug && canManage },
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BrandingForm>(EMPTY_FORM);

  const upsertMut = trpc.storePortal.locations.upsertBranding.useMutation({
    onSuccess: () => {
      toast.success("Location branding saved");
      utils.storePortal.locations.list.invalidate({ storeSlug: storeSlug || "" });
      setEditingId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  type BrandingRow = {
    logoUrl: string | null;
    primaryColor: string | null;
    bannerUrl: string | null;
    bannerText: string | null;
    welcomeMessage: string | null;
    aiTagline: string | null;
  };
  const startEdit = (locId: number, branding: BrandingRow | null) => {
    setEditingId(locId);
    setForm(branding ? {
      logoUrl: branding.logoUrl || "",
      primaryColor: branding.primaryColor || "#6C2BD9",
      bannerUrl: branding.bannerUrl || "",
      bannerText: branding.bannerText || "",
      welcomeMessage: branding.welcomeMessage || "",
      aiTagline: branding.aiTagline || "",
    } : EMPTY_FORM);
  };

  const save = (locId: number) => {
    upsertMut.mutate({
      storeSlug: storeSlug || "",
      locationId: locId,
      logoUrl: form.logoUrl || null,
      primaryColor: form.primaryColor || null,
      bannerUrl: form.bannerUrl || null,
      bannerText: form.bannerText || null,
      welcomeMessage: form.welcomeMessage || null,
      aiTagline: form.aiTagline || null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: mutedFg }} />
        <span className="ml-3 text-[13px]" style={{ color: mutedFg }}>Loading locations…</span>
      </div>
    );
  }

  const locs = locations ?? [];

  if (locs.length === 0) {
    return (
      <div className="text-center py-20">
        <MapPin size={32} className="mx-auto mb-3" style={{ color: mutedFg }} />
        <p className="text-[14px] font-semibold" style={{ color: fg }}>No locations configured</p>
        <p className="text-[12px] mt-1" style={{ color: mutedFg }}>
          Ask your distributor to enable multi-location for this store.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-[16px] font-bold" style={{ color: fg }}>Locations</h3>
        <p className="text-[12px] mt-1" style={{ color: mutedFg }}>
          Per-location branding overrides — each location can have its own logo, colors, and welcome message.
        </p>
      </div>

      <SsoHealthIndicator health={ssoHealth} isDark={isDark} fg={fg} mutedFg={mutedFg} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {locs.map((loc) => {
          const branding = loc.branding;
          const isEditing = editingId === loc.id;
          const swatch = branding?.primaryColor || "#6C2BD9";
          return (
            <div
              key={loc.id}
              className="p-5 rounded-xl"
              style={{ border: `1px solid ${borderColor}`, backgroundColor: cardBg }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="min-w-0">
                  <h4 className="text-[15px] font-bold truncate" style={{ color: fg }}>{loc.name}</h4>
                  <p className="text-[11px] mt-0.5" style={{ color: mutedFg }}>/{loc.slug}</p>
                </div>
                {canManage && !isEditing && (
                  <button
                    onClick={() => startEdit(loc.id, branding)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold"
                    style={{
                      backgroundColor: isDark ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.1)",
                      color: "var(--mt-brand)",
                    }}
                  >
                    <Edit3 size={11} /> Edit Branding
                  </button>
                )}
              </div>

              {!isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {branding?.logoUrl ? (
                      <img src={branding.logoUrl} alt="" className="w-10 h-10 rounded object-contain bg-white border" style={{ borderColor }} />
                    ) : (
                      <div className="w-10 h-10 rounded flex items-center justify-center text-[10px]" style={{ backgroundColor: isDark ? "#16161A" : "#F0F0F0", color: mutedFg }}>
                        No logo
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full border" style={{ backgroundColor: swatch, borderColor }} />
                      <span className="text-[11px] font-mono" style={{ color: mutedFg }}>{swatch}</span>
                    </div>
                  </div>
                  {branding?.bannerUrl && (
                    <div className="rounded overflow-hidden h-20 bg-cover bg-center" style={{ backgroundImage: `url(${branding.bannerUrl})`, border: `1px solid ${borderColor}` }} />
                  )}
                  {branding?.bannerText && (
                    <p className="text-[12px]" style={{ color: fg }}>{branding.bannerText}</p>
                  )}
                  {branding?.aiTagline && (
                    <p className="text-[11px] italic" style={{ color: mutedFg }}>"{branding.aiTagline}"</p>
                  )}
                  {branding?.welcomeMessage && (
                    <p className="text-[11px]" style={{ color: mutedFg }}>{branding.welcomeMessage}</p>
                  )}
                  {!branding && (
                    <p className="text-[11px]" style={{ color: mutedFg }}>No branding overrides — inherits store defaults.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Logo URL" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <input
                      type="text"
                      value={form.logoUrl}
                      onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                      placeholder="https://…"
                      className="w-full px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none focus:ring-1 focus:ring-[var(--mt-brand)]"
                      style={{ color: fg, borderColor }}
                    />
                  </Field>
                  <Field label="Primary Color" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={form.primaryColor}
                        onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                        className="w-10 h-8 rounded border cursor-pointer bg-transparent"
                        style={{ borderColor }}
                      />
                      <input
                        type="text"
                        value={form.primaryColor}
                        onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none font-mono focus:ring-1 focus:ring-[var(--mt-brand)]"
                        style={{ color: fg, borderColor }}
                      />
                    </div>
                  </Field>
                  <Field label="Banner URL" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <input
                      type="text"
                      value={form.bannerUrl}
                      onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })}
                      placeholder="https://…"
                      className="w-full px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none focus:ring-1 focus:ring-[var(--mt-brand)]"
                      style={{ color: fg, borderColor }}
                    />
                  </Field>
                  <Field label="Banner Text" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <input
                      type="text"
                      value={form.bannerText}
                      onChange={(e) => setForm({ ...form, bannerText: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none focus:ring-1 focus:ring-[var(--mt-brand)]"
                      style={{ color: fg, borderColor }}
                    />
                  </Field>
                  <Field label="Tagline" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <input
                      type="text"
                      value={form.aiTagline}
                      onChange={(e) => setForm({ ...form, aiTagline: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none focus:ring-1 focus:ring-[var(--mt-brand)]"
                      style={{ color: fg, borderColor }}
                    />
                  </Field>
                  <Field label="Welcome Message" mutedFg={mutedFg} fg={fg} borderColor={borderColor} cardBg={cardBg}>
                    <textarea
                      value={form.welcomeMessage}
                      onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                      rows={3}
                      className="w-full px-2.5 py-1.5 rounded text-[12px] bg-transparent border outline-none resize-y focus:ring-1 focus:ring-[var(--mt-brand)]"
                      style={{ color: fg, borderColor }}
                    />
                  </Field>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => save(loc.id)}
                      disabled={upsertMut.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold text-white transition-all disabled:opacity-50"
                      style={{ backgroundColor: "var(--mt-brand)" }}
                    >
                      {upsertMut.isPending && upsertMut.variables?.locationId === loc.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Save size={11} />
                      )}
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={upsertMut.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all disabled:opacity-50"
                      style={{ backgroundColor: isDark ? "#2A2A32" : "#F0F0F0", color: fg }}
                    >
                      <X size={11} /> Cancel
                    </button>
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

function Field({
  label, children, mutedFg,
}: {
  label: string;
  children: React.ReactNode;
  mutedFg: string;
  fg: string;
  borderColor: string;
  cardBg: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: mutedFg }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SsoHealthIndicator({
  health, isDark, fg, mutedFg,
}: {
  health: { unmapped: { group: string; userCount: number }[]; totalMapped: number } | undefined;
  isDark: boolean;
  fg: string;
  mutedFg: string;
}) {
  if (!health) return null;
  const { unmapped, totalMapped } = health;
  if (unmapped.length === 0 && totalMapped === 0) return null;

  if (unmapped.length === 0) {
    const bg = isDark ? "rgba(34,197,94,0.08)" : "rgba(22,163,74,0.06)";
    const border = isDark ? "rgba(34,197,94,0.25)" : "rgba(22,163,74,0.3)";
    const accent = isDark ? "#22C55E" : "#15803D";
    return (
      <div
        className="mb-4 px-4 py-3 rounded-xl flex items-center gap-2.5"
        style={{ backgroundColor: bg, border: `1px solid ${border}` }}
      >
        <CheckCircle2 size={16} style={{ color: accent }} />
        <span className="text-[13px] font-semibold" style={{ color: fg }}>
          All SSO groups mapped
        </span>
        <span className="text-[12px]" style={{ color: mutedFg }}>
          · {totalMapped} group{totalMapped === 1 ? "" : "s"} routing users to locations
        </span>
      </div>
    );
  }

  const bg = isDark ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.06)";
  const border = isDark ? "rgba(245,158,11,0.25)" : "rgba(245,158,11,0.3)";
  const accent = isDark ? "#F59E0B" : "#B45309";
  const chipBg = isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.1)";
  return (
    <div
      className="mb-4 px-4 py-3.5 rounded-xl"
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} style={{ color: accent, marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: fg }}>
            {unmapped.length} unmapped SSO group{unmapped.length === 1 ? "" : "s"} detected
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: mutedFg }}>
            These groups have no location mapping. Users in these groups land with no location assigned.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {unmapped.map((u) => (
              <span
                key={u.group}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono"
                style={{ backgroundColor: chipBg, color: fg }}
              >
                <span className="font-semibold">{u.group}</span>
                <span style={{ color: mutedFg }}>
                  · {u.userCount} user{u.userCount === 1 ? "" : "s"}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
