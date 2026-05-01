/**
 * ImprintZoneEditor — visual drag-and-drop editor for product imprint zones.
 *
 * Distributors use this on the master product detail page to define the
 * rectangles where client logos can be imprinted — e.g. "Left Chest",
 * "Full Front", "Cap Visor". Each zone stores its position as percentages
 * (0–100) of the product image so the layout scales at any render size.
 *
 * Interaction:
 *   - Click a zone to select → shows corner handles
 *   - Drag the zone body to move
 *   - Drag the bottom-right handle to resize
 *   - Hover a zone to preview the client logo at that position
 *   - Add zones from preset catalog or create a blank one
 *   - Right pane: per-zone label, slug (auto), decoration methods, default
 *   - "Save All" batch-writes the current zone set
 *
 * All mouse math is local — no drag libraries, coordinates are derived from
 * pointer deltas relative to the image container's bounding rect.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Save, Loader2, Move, Maximize2, Check,
  Image as ImageIcon, ChevronDown, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import LogoOverlay from "../../pages/webstore/LogoOverlay";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface EditorZone {
  /** Server id — undefined for unsaved zones. */
  id?: number;
  /** Client-only id — stable across renders until saved. */
  localId: string;
  label: string;
  slug: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
  decorationMethodIds: number[];
  isDefault: boolean;
}

interface DragState {
  localId: string;
  mode: "move" | "resize";
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}

interface ImprintZoneEditorProps {
  productId: number;
  productImageUrl: string | null;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const MIN_ZONE_SIZE = 3; // % — prevents zero-width/height zones

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function makeLocalId(): string {
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Deterministic border color per zone localId — gives each zone a distinct hue.
 *  Palette intentionally restricted to cool/enterprise tones (blues, purples,
 *  teals, greens) — no bright magenta/pink/orange — so labels read as
 *  brand-coherent against the product image. */
function zoneColor(localId: string): string {
  const hues = [262, 210, 175, 145, 230, 250, 195, 165];
  let h = 0;
  for (let i = 0; i < localId.length; i++) h = (h * 31 + localId.charCodeAt(i)) >>> 0;
  return `hsl(${hues[h % hues.length]}, 65%, 52%)`;
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function ImprintZoneEditor({ productId, productImageUrl }: ImprintZoneEditorProps) {
  /* ── Data ─────────────────────────────────────────────────────────── */
  const utils = trpc.useUtils();
  const { data: serverZones, isLoading: zonesLoading } =
    trpc.imprintZones.listForProduct.useQuery({ productId });
  const { data: presetGroups, isLoading: presetsLoading } =
    trpc.imprintZones.listPresets.useQuery();
  const { data: decorationMethods, isLoading: methodsLoading } =
    trpc.clientPricing.listDecorationMethods.useQuery();
  const { data: brandingData } = trpc.branding.get.useQuery();

  const upsertMut = trpc.imprintZones.upsert.useMutation({
    onSuccess: async () => {
      await utils.imprintZones.listForProduct.invalidate({ productId });
      toast.success("Imprint zones saved");
    },
    onError: (err) => toast.error(err.message || "Failed to save zones"),
  });

  const deleteMut = trpc.imprintZones.delete.useMutation({
    onSuccess: async () => {
      await utils.imprintZones.listForProduct.invalidate({ productId });
    },
    onError: (err) => toast.error(err.message || "Failed to delete zone"),
  });

  /* ── Local state ─────────────────────────────────────────────────── */
  const [zones, setZones] = useState<EditorZone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  // Hydrate from server → local on first load and after invalidate.
  useEffect(() => {
    if (!serverZones) return;
    setZones(serverZones.map((z) => ({
      id: z.id,
      localId: `srv-${z.id}`,
      label: z.label,
      slug: z.slug,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h,
      sortOrder: z.sortOrder,
      decorationMethodIds: z.decorationMethodIds,
      isDefault: z.isDefault,
    })));
  }, [serverZones]);

  /* ── Drag & resize ───────────────────────────────────────────────── */
  const imageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      const container = imageRef.current;
      if (!drag || !container) return;

      const rect = container.getBoundingClientRect();
      const dxPct = ((e.clientX - drag.startMouseX) / rect.width) * 100;
      const dyPct = ((e.clientY - drag.startMouseY) / rect.height) * 100;

      setZones(prev => prev.map(z => {
        if (z.localId !== drag.localId) return z;
        if (drag.mode === "move") {
          return {
            ...z,
            x: clamp(drag.startX + dxPct, 0, 100 - z.w),
            y: clamp(drag.startY + dyPct, 0, 100 - z.h),
          };
        }
        // resize
        return {
          ...z,
          w: clamp(drag.startW + dxPct, MIN_ZONE_SIZE, 100 - z.x),
          h: clamp(drag.startH + dyPct, MIN_ZONE_SIZE, 100 - z.y),
        };
      }));
    }
    function onMouseUp() {
      dragRef.current = null;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent, zone: EditorZone, mode: "move" | "resize") {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(zone.localId);
    dragRef.current = {
      localId: zone.localId,
      mode,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: zone.x,
      startY: zone.y,
      startW: zone.w,
      startH: zone.h,
    };
  }

  /* ── Zone operations ─────────────────────────────────────────────── */

  function addFromPreset(preset: { label: string; slug: string; x: number; y: number; w: number; h: number }) {
    setPresetPickerOpen(false);
    const localId = makeLocalId();
    setZones(prev => [
      ...prev,
      {
        localId,
        label: preset.label,
        slug: ensureUniqueSlug(preset.slug, prev),
        x: preset.x,
        y: preset.y,
        w: preset.w,
        h: preset.h,
        sortOrder: prev.length,
        decorationMethodIds: [],
        isDefault: prev.length === 0,
      },
    ]);
    setSelectedId(localId);
  }

  function addCustomZone() {
    const localId = makeLocalId();
    setZones(prev => [
      ...prev,
      {
        localId,
        label: "New Zone",
        slug: ensureUniqueSlug("new-zone", prev),
        x: 30,
        y: 30,
        w: 40,
        h: 40,
        sortOrder: prev.length,
        decorationMethodIds: [],
        isDefault: prev.length === 0,
      },
    ]);
    setSelectedId(localId);
  }

  function ensureUniqueSlug(base: string, existing: EditorZone[]): string {
    let slug = base || "zone";
    let n = 1;
    while (existing.some(z => z.slug === slug)) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }

  function updateZone(localId: string, patch: Partial<EditorZone>) {
    setZones(prev => prev.map(z => (z.localId === localId ? { ...z, ...patch } : z)));
  }

  function onLabelBlur(localId: string, label: string) {
    setZones(prev => {
      const zone = prev.find(z => z.localId === localId);
      if (!zone) return prev;
      // Only regenerate slug if the user hasn't customized it (still matches
      // the previous label's slug).
      const prevSlug = slugify(zone.label);
      const shouldRegen = zone.slug === prevSlug || zone.slug.startsWith(`${prevSlug}-`);
      const nextSlug = shouldRegen
        ? ensureUniqueSlug(slugify(label), prev.filter(z => z.localId !== localId))
        : zone.slug;
      return prev.map(z => z.localId === localId ? { ...z, label, slug: nextSlug } : z);
    });
  }

  function toggleDecoration(localId: string, methodId: number) {
    setZones(prev => prev.map(z => {
      if (z.localId !== localId) return z;
      const has = z.decorationMethodIds.includes(methodId);
      return {
        ...z,
        decorationMethodIds: has
          ? z.decorationMethodIds.filter(id => id !== methodId)
          : [...z.decorationMethodIds, methodId],
      };
    }));
  }

  function setDefault(localId: string) {
    setZones(prev => prev.map(z => ({ ...z, isDefault: z.localId === localId })));
  }

  async function deleteZone(zone: EditorZone) {
    if (zone.id != null) {
      await deleteMut.mutateAsync({ zoneId: zone.id });
    }
    setZones(prev => prev.filter(z => z.localId !== zone.localId));
    if (selectedId === zone.localId) setSelectedId(null);
  }

  async function saveAll() {
    await upsertMut.mutateAsync({
      productId,
      zones: zones.map((z, i) => ({
        id: z.id,
        label: z.label,
        slug: z.slug,
        x: Number(z.x.toFixed(2)),
        y: Number(z.y.toFixed(2)),
        w: Number(z.w.toFixed(2)),
        h: Number(z.h.toFixed(2)),
        sortOrder: i,
        decorationMethodIds: z.decorationMethodIds,
        isDefault: z.isDefault,
      })),
    });
  }

  /* ── Derived ─────────────────────────────────────────────────────── */
  const previewZone = useMemo(() => {
    const id = hoverId ?? selectedId;
    return zones.find(z => z.localId === id) ?? null;
  }, [hoverId, selectedId, zones]);

  const selectedZone = zones.find(z => z.localId === selectedId) ?? null;
  const isLoading = zonesLoading || presetsLoading || methodsLoading;

  /* ── Render ──────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[11fr_9fr] gap-6 min-h-[600px]">

      {/* ── Left: image + draggable zones ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-[#F0F0F2] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div
            ref={imageRef}
            className="relative aspect-square bg-[#FAFAFA] select-none"
            onClick={() => setSelectedId(null)}
          >
            {/* Base image or placeholder */}
            {productImageUrl ? (
              <img
                src={productImageUrl}
                alt="Product"
                className="absolute inset-0 w-full h-full object-contain p-6"
                draggable={false}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon size={48} className="text-[#D4D4D8]" strokeWidth={1.2} />
              </div>
            )}

            {/* Hover/selected logo preview — renders a ghost LogoOverlay */}
            {previewZone && brandingData?.brandLogoUrl && (
              <div className="absolute inset-0 p-6 pointer-events-none">
                <LogoOverlay
                  productImageUrl={null}
                  logoUrl={brandingData.brandLogoUrl}
                  placement={{
                    id: previewZone.localId,
                    label: previewZone.label,
                    x: previewZone.x,
                    y: previewZone.y,
                    w: previewZone.w,
                    opacity: 0.88,
                  }}
                />
              </div>
            )}

            {/* Zone rectangles */}
            {zones.map(zone => {
              const isSelected = zone.localId === selectedId;
              const color = zoneColor(zone.localId);
              return (
                <div
                  key={zone.localId}
                  className="absolute cursor-move transition-shadow"
                  style={{
                    left: `${zone.x}%`,
                    top: `${zone.y}%`,
                    width: `${zone.w}%`,
                    height: `${zone.h}%`,
                    border: `${isSelected ? 2.5 : 1.5}px solid ${isSelected ? "#3B82F6" : color}`,
                    backgroundColor: isSelected ? "rgba(59,130,246,0.08)" : `${color}14`,
                    borderRadius: 6,
                    boxShadow: isSelected ? "0 0 0 3px rgba(59,130,246,0.18)" : "none",
                  }}
                  onMouseDown={(e) => startDrag(e, zone, "move")}
                  onMouseEnter={() => setHoverId(zone.localId)}
                  onMouseLeave={() => setHoverId(null)}
                >
                  {/* Label tab */}
                  <div
                    className="absolute -top-[1px] left-0 px-2 py-[3px] text-[10px] font-semibold text-white uppercase tracking-[0.04em] rounded-tl-[4px] rounded-br-[4px] pointer-events-none whitespace-nowrap"
                    style={{ backgroundColor: isSelected ? "#3B82F6" : color }}
                  >
                    <span className="flex items-center gap-1">
                      <Move size={9} strokeWidth={2.5} />
                      {zone.label}
                    </span>
                  </div>

                  {/* Resize handle — bottom-right */}
                  {isSelected && (
                    <div
                      onMouseDown={(e) => startDrag(e, zone, "resize")}
                      className="absolute -bottom-[6px] -right-[6px] w-[14px] h-[14px] rounded-sm bg-white cursor-nwse-resize flex items-center justify-center shadow-[0_0_0_1.5px_#3B82F6]"
                    >
                      <Maximize2 size={8} className="text-[#3B82F6]" strokeWidth={3} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Image hint */}
        <p className="text-[11px] text-[#A1A1AA] px-1">
          Drag a zone to reposition · Click to select · Drag the bottom-right handle to resize
        </p>
      </div>

      {/* ── Right: zone list + toolbar ────────────────────────────────── */}
      <div className="space-y-4">

        {/* Toolbar */}
        <div className="flex flex-wrap gap-2">
          {/* Preset dropdown */}
          <div className="relative flex-1 min-w-[180px]">
            <button
              onClick={() => setPresetPickerOpen(o => !o)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl bg-white border border-[#E4E4E7] text-[12px] font-semibold text-[#3F3F46] hover:border-[#A1A1AA] transition-colors whitespace-nowrap"
            >
              <span className="flex items-center gap-1.5">
                <Plus size={13} strokeWidth={2.2} />
                Add from Preset
              </span>
              <ChevronDown size={13} className={`transition-transform ${presetPickerOpen ? "rotate-180" : ""}`} />
            </button>
            {presetPickerOpen && presetGroups && (
              <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white rounded-2xl border border-[#E4E4E7] shadow-lg max-h-[360px] overflow-y-auto">
                {Object.entries(presetGroups).map(([category, items]) => (
                  <div key={category} className="py-2">
                    <div className="px-3 py-1 text-[9px] font-bold text-[#A1A1AA] uppercase tracking-[0.08em]">
                      {category}
                    </div>
                    {items.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addFromPreset(p)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] text-[#3F3F46] hover:bg-[#F4F4F5] transition-colors"
                      >
                        <span className="font-medium">{p.label}</span>
                        <span className="text-[10px] text-[#A1A1AA] font-mono">
                          {p.w.toFixed(0)}×{p.h.toFixed(0)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom zone button */}
          <button
            onClick={addCustomZone}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-[#E4E4E7] text-[12px] font-semibold text-[#3F3F46] hover:border-[#A1A1AA] transition-colors whitespace-nowrap"
            title="Add a blank zone at the center"
          >
            <Sparkles size={13} strokeWidth={2.2} />
            Custom
          </button>

          {/* Save */}
          <button
            onClick={saveAll}
            disabled={upsertMut.isPending}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#18181B] text-white text-[12px] font-semibold hover:bg-[#27272A] transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {upsertMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} strokeWidth={2.2} />}
            Save All
          </button>
        </div>

        {/* Zone list */}
        <div className="space-y-2.5">
          {zones.length === 0 && (
            <div className="text-center py-10 px-4 bg-[#FAFAFA] rounded-2xl border border-dashed border-[#E4E4E7]">
              <p className="text-[13px] font-medium text-[#71717A]">No imprint zones yet</p>
              <p className="text-[11px] text-[#A1A1AA] mt-1">Add one from a preset or create a custom zone.</p>
            </div>
          )}

          {zones.map(zone => {
            const isSelected = zone.localId === selectedId;
            const color = zoneColor(zone.localId);
            return (
              <div
                key={zone.localId}
                onClick={() => setSelectedId(zone.localId)}
                onMouseEnter={() => setHoverId(zone.localId)}
                onMouseLeave={() => setHoverId(null)}
                className={`bg-white rounded-2xl border transition-all cursor-pointer ${
                  isSelected ? "border-[#3B82F6] shadow-[0_0_0_3px_rgba(59,130,246,0.10)]" : "border-[#F0F0F2] hover:border-[#D4D4D8]"
                }`}
              >
                <div className="p-5">
                  {/* Header: color swatch + label input + delete */}
                  <div className="flex items-start gap-3 mb-3">
                    <span
                      className="mt-[9px] w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={zone.label}
                        onChange={(e) => updateZone(zone.localId, { label: e.target.value })}
                        onBlur={(e) => onLabelBlur(zone.localId, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-[13px] font-semibold text-[#18181B] bg-transparent border-0 focus:outline-none focus:ring-0 p-0"
                        placeholder="Zone label"
                      />
                      <p className="text-[10px] font-mono text-[#A1A1AA] mt-0.5">
                        {zone.slug} · {zone.w.toFixed(0)}×{zone.h.toFixed(0)} at {zone.x.toFixed(0)},{zone.y.toFixed(0)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteZone(zone); }}
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[#A1A1AA] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                      title="Delete zone"
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>

                  {/* Decoration methods */}
                  {decorationMethods && decorationMethods.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[9px] font-bold text-[#A1A1AA] uppercase tracking-[0.06em] mb-1.5">
                        Allowed Decoration Methods
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {decorationMethods.map(m => {
                          const active = zone.decorationMethodIds.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              onClick={(e) => { e.stopPropagation(); toggleDecoration(zone.localId, m.id); }}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border whitespace-nowrap ${
                                active
                                  ? "bg-[#EEF2FF] border-[#C7D2FE] text-[#4338CA]"
                                  : "bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#A1A1AA]"
                              }`}
                            >
                              {active && <Check size={10} strokeWidth={3} />}
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Default radio */}
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 text-[11px] font-medium text-[#52525B] cursor-pointer select-none"
                  >
                    <input
                      type="radio"
                      name="default-zone"
                      checked={zone.isDefault}
                      onChange={() => setDefault(zone.localId)}
                      className="w-3.5 h-3.5 accent-[#18181B]"
                    />
                    Default zone
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected zone mini-info (when nothing else shown) */}
        {selectedZone && (
          <p className="text-[10px] text-[#A1A1AA] px-1">
            Editing <span className="font-semibold text-[#52525B]">{selectedZone.label}</span> — changes save when you click Save All.
          </p>
        )}
      </div>
    </div>
  );
}
