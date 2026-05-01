/**
 * StoreEditorPage — Pre-launch store content editor.
 * Allows the distributor to edit all AI-generated and manual content
 * before going live:
 *   - Hero headline, subtitle, tagline (inline text editing)
 *   - Welcome message
 *   - Brand color (40-color picker + custom hex)
 *   - Category order (drag-to-reorder)
 *   - Category display names (inline rename)
 *   - Sub-category names (inline rename)
 *   - Product display names and descriptions
 * All changes auto-save to the DB via saveEditorChanges mutation.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Eye, Rocket, Save, Check, Loader2, Pencil, X,
  GripVertical, ChevronDown, ChevronRight, Package, Palette,
  Type, Image, Users, Tag, AlertCircle, Sparkles, Shield, ImageIcon, Trash2,
} from "lucide-react";
import StoreSsoSettings from "@/components/settings/StoreSsoSettings";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { toast } from "sonner";

//  Color palette (same as Step7Branding) 

const EXTENDED_COLORS = [
  // Row 1: Purples & Violets
  "var(--mt-brand)", "#7C3AED", "#8B5CF6", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE", "#F5F3FF",
  // Row 2: Blues
  "#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#1E3A8A", "#172554",
  // Row 3: Greens & Teals
  "#065F46", "#059669", "#10B981", "#34D399", "#6EE7B7", "#0F766E", "#0D9488", "#14B8A6",
  // Row 4: Reds, Oranges & Pinks
  "#991B1B", "#DC2626", "#EF4444", "#F97316", "#FB923C", "#FBBF24", "#EC4899", "#F43F5E",
  // Row 5: Neutrals & Blacks
  "#1A1A1A", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#F3F4F6", "#111827", "#030712",
];

//  Inline editable text field 

interface InlineEditProps {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  label?: string;
}

function InlineEdit({ value, onSave, placeholder, multiline, className, label }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    return (
      <div className="relative">
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") cancel(); }}
            rows={3}
            className={`w-full border border-primary rounded-lg px-3 py-2 text-[13px] outline-none resize-none ${className || ""}`}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className={`w-full border border-primary rounded-lg px-3 py-2 text-[13px] outline-none ${className || ""}`}
          />
        )}
        <div className="flex gap-2 mt-1.5">
          <button onClick={commit} className="flex items-center gap-1 px-3 py-1 bg-primary text-white rounded text-[11px] font-semibold">
            <Check size={11} /> Save
          </button>
          <button onClick={cancel} className="flex items-center gap-1 px-3 py-1 border border-mt-border rounded text-[11px] text-mt-ink-2">
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-2 cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <div className="flex-1">
        {label && <div className="text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wide mb-0.5">{label}</div>}
        <div className={`${className || "text-[13px] text-[#374151]"} ${!value ? "text-mt-ink-4 italic" : ""}`}>
          {value || placeholder || "Click to edit…"}
        </div>
      </div>
      <Pencil size={12} className="text-mt-ink-4 group-hover:text-primary flex-shrink-0 mt-0.5 transition-colors" />
    </div>
  );
}

//  Sortable category row 

interface SortableCatRowProps {
  id: string;
  name: string;
  productCount: number;
  subCategories: { id: string; name: string; productIds: number[] }[];
  onRename: (name: string) => void;
  onRenameSubCat: (subId: string, name: string) => void;
}

function SortableCatRow({ id, name, productCount, subCategories, onRename, onRenameSubCat }: SortableCatRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [expanded, setExpanded] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="border border-mt-border rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button {...attributes} {...listeners} className="text-mt-ink-4 hover:text-mt-ink-2 cursor-grab active:cursor-grabbing touch-none">
          <GripVertical size={15} />
        </button>
        <div className="flex-1">
          <InlineEdit
            value={name}
            onSave={onRename}
            placeholder="Category name"
            className="text-[13px] font-semibold text-mt-ink"
          />
        </div>
        <span className="text-[11px] text-mt-ink-4">{productCount} products</span>
        {subCategories.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="text-mt-ink-4 hover:text-mt-ink-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {expanded && subCategories.length > 0 && (
        <div className="border-t border-[#F3F4F6] px-4 py-2 space-y-2 bg-mt-surface">
          {subCategories.map(sub => (
            <div key={sub.id} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#C4B5FD] flex-shrink-0" />
              <div className="flex-1">
                <InlineEdit
                  value={sub.name}
                  onSave={(n) => onRenameSubCat(sub.id, n)}
                  placeholder="Sub-category name"
                  className="text-[12px] text-[#374151]"
                />
              </div>
              <span className="text-[10px] text-mt-ink-4">{sub.productIds.length}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

//  Main Editor 

export default function StoreEditorPage() {
  const params = useParams<{ id: string }>();
  const storeId = parseInt(params.id || "0");
  const [, navigate] = useLocation();

  const { data: store, isLoading, error, refetch } = trpc.stores.getById.useQuery(
    { id: storeId },
    { enabled: !!storeId }
  );

  const saveChanges = trpc.stores.saveEditorChanges.useMutation();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  //  Local editor state 
  const [heroHeadline, setHeroHeadline] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [brandColor, setBrandColor] = useState("var(--mt-brand)");
  const [showCustomColor, setShowCustomColor] = useState(false);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, { id: string; name: string; productIds: number[] }[]>>({});
  const [activeSection, setActiveSection] = useState<"hero" | "categories" | "products" | "branding" | "sso">("hero");
  const [initialized, setInitialized] = useState(false);
  // Logo upload state
  const logoInputRef = useRef<HTMLInputElement>(null);
  const uploadClientLogo = trpc.proofing.uploadClientLogo.useMutation();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Initialize state from store data
  useEffect(() => {
    if (store && !initialized) {
      const s = store;
      setHeroHeadline(s.editorHeroHeadline || s.aiHeroHeadline || "");
      setHeroSubtitle(s.editorHeroSubtitle || s.aiHeroSubtitle || "");
      setTagline(s.editorTagline || s.aiTagline || "");
      setWelcomeMessage(s.editorWelcomeMessage || s.welcomeMessage || "");
      setBrandColor(s.primaryColor || "var(--mt-brand)");

      // Build category order from editorSubCategories or products
      if (s.editorSubCategories) {
        const subs = typeof s.editorSubCategories === "string" ? JSON.parse(s.editorSubCategories) : s.editorSubCategories;
        setSubCategories(subs);
        const names = typeof s.editorCategoryNames === "string" ? JSON.parse(s.editorCategoryNames) : (s.editorCategoryNames || {});
        setCategoryNames(names);
        const order = typeof s.editorCategoryOrder === "string" ? JSON.parse(s.editorCategoryOrder) : (s.editorCategoryOrder || Object.keys(subs));
        setCategoryOrder(order);
      } else {
        // Build from products' categories
        const cats = new Set<string>();
        (s.products || []).forEach((p: { category?: string }) => { if (p.category) cats.add(p.category); });
        const catArr = Array.from(cats);
        setCategoryOrder(catArr);
        const subsMap: Record<string, { id: string; name: string; productIds: number[] }[]> = {};
        catArr.forEach(cat => {
          subsMap[cat] = [{
            id: `sub_${cat}_general`,
            name: "General",
            productIds: (s.products || []).filter((p: { category?: string }) => p.category === cat).map((p: { id: number }) => p.id),
          }];
        });
        setSubCategories(subsMap);
      }
      setInitialized(true);
    }
  }, [store, initialized]);

  //  Auto-save with debounce 
  const triggerSave = useCallback((overrides?: Partial<{
    heroHeadline: string; heroSubtitle: string; tagline: string;
    welcomeMessage: string; brandColor: string; categoryOrder: string[];
    categoryNames: Record<string, string>; subCategories: Record<string, { id: string; name: string; productIds: number[] }[]>;
  }>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveChanges.mutateAsync({
          id: storeId,
          editorHeroHeadline: overrides?.heroHeadline ?? heroHeadline,
          editorHeroSubtitle: overrides?.heroSubtitle ?? heroSubtitle,
          editorTagline: overrides?.tagline ?? tagline,
          editorWelcomeMessage: overrides?.welcomeMessage ?? welcomeMessage,
          primaryColor: overrides?.brandColor ?? brandColor,
          editorCategoryOrder: overrides?.categoryOrder ?? categoryOrder,
          editorCategoryNames: overrides?.categoryNames ?? categoryNames,
          editorSubCategories: (overrides?.subCategories ?? subCategories) as unknown as Record<string, { id: string; name: string; productIds: number[] }[]>,
          aiProductPageCTA: store?.aiProductPageCTA ?? null,
          aiProductGridHeading: store?.aiProductGridHeading ?? null,
          aiProductBadgeStyle: store?.aiProductBadgeStyle ?? null,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err: unknown) {
        toast.error("Couldn't save: " + (err instanceof Error ? err.message : "please try again"));
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [heroHeadline, heroSubtitle, tagline, welcomeMessage, brandColor, categoryOrder, categoryNames, subCategories, storeId]);

  //  Field update helpers 
  const updateHeroHeadline = (v: string) => { setHeroHeadline(v); triggerSave({ heroHeadline: v }); };
  const updateHeroSubtitle = (v: string) => { setHeroSubtitle(v); triggerSave({ heroSubtitle: v }); };
  const updateTagline = (v: string) => { setTagline(v); triggerSave({ tagline: v }); };
  const updateWelcomeMessage = (v: string) => { setWelcomeMessage(v); triggerSave({ welcomeMessage: v }); };
  const updateBrandColor = (v: string) => { setBrandColor(v); triggerSave({ brandColor: v }); };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) { toast.error("Use PNG, SVG, JPEG, or WebP for logos."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Logo must be under 5 MB."); return; }
    const clientId = store?.clientId;
    if (!clientId) { toast.error("Store has no associated client."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setIsUploadingLogo(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await uploadClientLogo.mutateAsync({
        clientId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
        isPrimary: true,
      });
      setLogoUploaded(true);
      toast.success("Client logo updated \u2014 branded product previews are now active");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the logo \u2014 please try again");
      setLogoPreview(null);
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const renameCat = (catId: string, name: string) => {
    const updated = { ...categoryNames, [catId]: name };
    setCategoryNames(updated);
    triggerSave({ categoryNames: updated });
  };

  const renameSubCat = (catId: string, subId: string, name: string) => {
    const updated = {
      ...subCategories,
      [catId]: (subCategories[catId] || []).map(s => s.id === subId ? { ...s, name } : s),
    };
    setSubCategories(updated);
    triggerSave({ subCategories: updated });
  };

  //  Drag end for categories 
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = categoryOrder.indexOf(active.id as string);
      const newIndex = categoryOrder.indexOf(over.id as string);
      const updated = arrayMove(categoryOrder, oldIndex, newIndex);
      setCategoryOrder(updated);
      triggerSave({ categoryOrder: updated });
    }
  };

  if (isLoading) return <MergeTasksLoader variant="page" />;

  if (error || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mt-surface">
        <div className="text-center max-w-md px-6">
          <AlertCircle size={40} className="text-[#EF4444] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-mt-ink mb-2">Store Not Found</h1>
          <button onClick={() => navigate("/webstores")} className="px-5 py-2.5 bg-primary text-white rounded-lg text-[13px] font-semibold">
            Back to Stores
          </button>
        </div>
      </div>
    );
  }

  const s = store;
  const products = s.products || [];

  const sections = [
    { id: "hero", label: "Hero & Copy", icon: Type },
    { id: "branding", label: "Branding", icon: Palette },
    { id: "categories", label: "Categories", icon: Tag },
    { id: "products", label: "Products", icon: Package },
    { id: "sso", label: "SSO", icon: Shield },
  ] as const;

  return (
    <div className="min-h-screen bg-mt-surface-2">
      {/*  Top bar  */}
      <div className="sticky top-0 z-40 bg-white border-b border-mt-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate(`/store-preview/${storeId}`)}
            className="flex items-center gap-1.5 text-[12px] text-mt-ink-3 hover:text-mt-ink transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Preview
          </button>

          <div className="h-4 w-px bg-[#E5E5E5]" />

          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            <span className="text-[13px] font-semibold text-mt-ink">{s.name}</span>
            <span className="text-[11px] text-mt-ink-4">— Store Editor</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {/* Save status */}
            <div className="flex items-center gap-1.5 text-[12px]">
              {saving && <><Loader2 size={12} className="animate-spin text-primary" /><span className="text-primary">Saving…</span></>}
              {saved && !saving && <><Check size={12} className="text-[#16A34A]" /><span className="text-[#16A34A]">Saved</span></>}
              {!saving && !saved && <span className="text-mt-ink-4">All changes saved</span>}
            </div>

            <button
              onClick={() => navigate(`/store-preview/${storeId}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-mt-border rounded-lg text-[12px] font-semibold text-[#374151] hover:border-primary hover:text-primary transition-colors"
            >
              <Eye size={13} />
              Preview
            </button>

            <button
              onClick={() => navigate(`/store-preview/${storeId}`)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-lg text-[12px] font-semibold hover:bg-[#5438d4] transition-colors"
            >
              <Rocket size={13} />
              Go to Launch
            </button>
          </div>
        </div>
      </div>

      {/*  Main layout  */}
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar nav */}
        <div className="space-y-1">
          {sections.map(sec => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id as "hero" | "categories" | "products" | "branding" | "sso")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left ${
                  activeSection === sec.id
                    ? "bg-[#F0EDFF] text-primary"
                    : "text-[#374151] hover:bg-[#F9F9F9]"
                }`}
              >
                <Icon size={15} />
                {sec.label}
              </button>
            );
          })}
        </div>

        {/* Editor panel */}
        <div className="bg-white border border-mt-border rounded-xl p-6 space-y-6">

          {/*  Hero & Copy  */}
          {activeSection === "hero" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-mt-ink mb-1">Hero & Copy</h2>
                <p className="text-[13px] text-mt-ink-3">Edit the AI-generated copy. Click any field to edit inline.</p>
              </div>

              <div className="space-y-5">
                <div className="p-4 bg-mt-surface rounded-xl border border-mt-border">
                  <div className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wide mb-2">Hero Headline</div>
                  <InlineEdit
                    value={heroHeadline}
                    onSave={updateHeroHeadline}
                    placeholder="Your store headline…"
                    className="text-[18px] font-bold text-mt-ink"
                  />
                </div>

                <div className="p-4 bg-mt-surface rounded-xl border border-mt-border">
                  <div className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wide mb-2">Hero Subtitle</div>
                  <InlineEdit
                    value={heroSubtitle}
                    onSave={updateHeroSubtitle}
                    placeholder="Supporting text below the headline…"
                    className="text-[15px] text-[#374151]"
                  />
                </div>

                <div className="p-4 bg-mt-surface rounded-xl border border-mt-border">
                  <div className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wide mb-2">Store Tagline</div>
                  <InlineEdit
                    value={tagline}
                    onSave={updateTagline}
                    placeholder="Short tagline shown in the header…"
                    className="text-[13px] text-[#374151] italic"
                  />
                </div>

                <div className="p-4 bg-mt-surface rounded-xl border border-mt-border">
                  <div className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wide mb-2">Welcome Message</div>
                  <InlineEdit
                    value={welcomeMessage}
                    onSave={updateWelcomeMessage}
                    placeholder="Message shown to employees when they first visit…"
                    multiline
                    className="text-[13px] text-[#374151]"
                  />
                </div>
              </div>

              {(s.aiHeroHeadline || s.aiTagline) && (
                <div className="flex items-start gap-2 p-3 bg-mt-brand-light rounded-lg border border-[#C4B5FD]">
                  <Sparkles size={14} className="text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-[#374151]">
                    These fields were pre-filled by the MergeTasks AI based on {s.client?.companyName || "your client"}'s industry and brand. Edit freely — your changes are saved automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          {/*  Branding  */}
          {activeSection === "branding" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-mt-ink mb-1">Branding</h2>
                <p className="text-[13px] text-mt-ink-3">Adjust the store's brand color and client logo for branded product previews.</p>
              </div>

              {/* Client Logo Upload */}
              <div>
                <div className="text-[12px] font-semibold text-mt-ink-2 mb-3">Client Logo <span className="font-normal text-mt-ink-4">(optional)</span></div>
                <p className="text-[12px] text-mt-ink-3 mb-3">Used to show branded product previews across the store. PNG, SVG, JPEG, or WebP, max 5 MB.</p>
                {(logoPreview || store?.client?.logoUrl) ? (
                  <div className="flex items-center gap-4 p-4 border border-mt-border rounded-xl bg-mt-surface">
                    <img
                      src={logoPreview || store?.client?.logoUrl || ""}
                      alt="Client logo"
                      className="h-14 w-auto max-w-[120px] object-contain rounded"
                    />
                    <div className="flex-1">
                      {logoUploaded ? (
                        <div className="flex items-center gap-1.5 text-[12px] text-[#16A34A] font-semibold">
                          <Check size={13} /> Logo updated
                        </div>
                      ) : (
                        <div className="text-[12px] text-mt-ink-3">Current client logo</div>
                      )}
                      <div className="text-[11px] text-mt-ink-4 mt-0.5">Branded product previews are active</div>
                    </div>
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-mt-border rounded-lg text-[12px] text-[#374151] hover:border-primary hover:text-primary transition-colors"
                    >
                      <ImageIcon size={13} /> Replace
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-mt-border rounded-xl hover:border-primary hover:bg-mt-brand-light transition-all text-mt-ink-3 hover:text-primary"
                  >
                    {isUploadingLogo ? (
                      <Loader2 size={24} className="animate-spin" />
                    ) : (
                      <ImageIcon size={24} />
                    )}
                    <span className="text-[13px] font-medium">{isUploadingLogo ? "Uploading…" : "Upload client logo"}</span>
                    <span className="text-[11px]">or drag and drop</span>
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <p className="text-[11px] text-mt-ink-4 mt-2">
                  No logo yet? <button className="underline hover:text-primary" onClick={() => logoInputRef.current?.click()}>Skip for now</button> \u2014 you can add it later.
                </p>
              </div>

              <div className="border-t border-mt-border" />

              <div>
                <div className="text-[12px] font-semibold text-mt-ink-2 mb-3">Brand Color</div>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-xl border-2 border-white shadow-md flex-shrink-0"
                    style={{ backgroundColor: brandColor }}
                  />
                  <div>
                    <div className="text-[13px] font-semibold text-mt-ink">{brandColor.toUpperCase()}</div>
                    <div className="text-[11px] text-mt-ink-4">Current brand color</div>
                  </div>
                </div>

                {/* 40-color grid */}
                <div className="grid grid-cols-8 gap-1.5 mb-3">
                  {EXTENDED_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => updateBrandColor(color)}
                      className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                        brandColor === color ? "border-[#1A1A1A] scale-110 shadow-md" : "border-transparent hover:border-[#D1D5DB]"
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>

                {/* Custom color */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCustomColor(!showCustomColor)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-mt-border rounded-lg text-[12px] text-[#374151] hover:border-primary hover:text-primary transition-colors"
                  >
                    <Palette size={13} />
                    Custom color
                  </button>
                  {showCustomColor && (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandColor}
                        onChange={e => updateBrandColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0"
                      />
                      <input
                        type="text"
                        value={brandColor}
                        onChange={e => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) updateBrandColor(e.target.value); }}
                        className="w-24 px-2 py-1 text-[12px] border border-mt-border rounded-lg outline-none focus:border-primary font-mono"
                        placeholder="var(--mt-brand)"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/*  Categories  */}
          {activeSection === "categories" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-mt-ink mb-1">Categories</h2>
                <p className="text-[13px] text-mt-ink-3">Drag to reorder. Click a name to rename it.</p>
              </div>

              {categoryOrder.length === 0 ? (
                <div className="text-center py-10 text-mt-ink-4">
                  <Tag size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-[13px]">No categories set. Use the Build Catalog step to organise your products.</p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={categoryOrder} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {categoryOrder.map(catId => {
                        const subs = subCategories[catId] || [];
                        const productCount = subs.reduce((a, s) => a + s.productIds.length, 0);
                        const displayName = categoryNames[catId] || catId;
                        return (
                          <SortableCatRow
                            key={catId}
                            id={catId}
                            name={displayName}
                            productCount={productCount}
                            subCategories={subs}
                            onRename={(name) => renameCat(catId, name)}
                            onRenameSubCat={(subId, name) => renameSubCat(catId, subId, name)}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          )}

          {/*  Products  */}
          {activeSection === "products" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-mt-ink mb-1">Products</h2>
                <p className="text-[13px] text-mt-ink-3">Edit display names and descriptions for individual products.</p>
              </div>

              {products.length === 0 ? (
                <div className="text-center py-10 text-mt-ink-4">
                  <Package size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-[13px]">No products assigned to this store yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {products.map((p: { id: number; name: string; imageUrl: string | null; sku: string | null; basePrice: string | null; description: string | null }) => {
                    const editorNames = (s.editorProductNames as Record<string, string>) || {};
                    const editorDescs = (s.editorProductDescriptions as Record<string, string>) || {};
                    return (
                      <div key={p.id} className="border border-mt-border rounded-xl p-4 flex gap-4">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
                            <Package size={20} className="text-mt-ink-4" />
                          </div>
                        )}
                        <div className="flex-1 space-y-2">
                          <InlineEdit
                            value={editorNames[p.id] || p.name}
                            onSave={(v) => {
                              const updated = { ...editorNames, [p.id]: v };
                              saveChanges.mutate({ id: storeId, editorProductNames: updated });
                            }}
                            placeholder="Product display name"
                            className="text-[13px] font-semibold text-mt-ink"
                          />
                          <InlineEdit
                            value={editorDescs[p.id] || p.description || ""}
                            onSave={(v) => {
                              const updated = { ...editorDescs, [p.id]: v };
                              saveChanges.mutate({ id: storeId, editorProductDescriptions: updated });
                            }}
                            placeholder="Add a product description…"
                            multiline
                            className="text-[12px] text-mt-ink-3"
                          />
                          <div className="text-[11px] text-mt-ink-4">SKU: {p.sku || "—"} · ${p.basePrice || "0.00"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/*  SSO Settings  */}
          {activeSection === "sso" && (
            <StoreSsoSettings storeId={storeId} />
          )}
        </div>
      </div>
    </div>
  );
}
