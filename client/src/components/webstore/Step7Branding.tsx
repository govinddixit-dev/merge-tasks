import { useRef, useState, useCallback } from "react";
import { Upload, Loader2, Trash2, Pipette, Move, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { getLogger } from "@/lib/logger";
import { useWebstore } from "./WebstoreContext";

const log = getLogger("Step7Branding");

// Expanded palette: 5 rows × 8 columns = 40 swatches
const PALETTE: string[][] = [
  // Row 1 — Purples / Violets
  ["var(--mt-brand)", "#7C3AED", "#8B5CF6", "#A78BFA", "#6D28D9", "#4C1D95", "#5B21B6", "#DDD6FE"],
  // Row 2 — Blues
  ["#2563EB", "#1D4ED8", "#3B82F6", "#60A5FA", "#0EA5E9", "#0891B2", "#0369A1", "#BFDBFE"],
  // Row 3 — Greens / Teals
  ["#059669", "#047857", "#10B981", "#34D399", "#14B8A6", "#0F766E", "#065F46", "#A7F3D0"],
  // Row 4 — Reds / Oranges / Yellows
  ["#DC2626", "#B91C1C", "#EF4444", "#F97316", "#D97706", "#B45309", "#F59E0B", "#FDE68A"],
  // Row 5 — Neutrals / Blacks
  ["#1A1A1A", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#F3F4F6", "#FFFFFF", "#111827"],
];

interface Props {
  companyName: string;
}

export default function Step7Branding({ companyName }: Props) {
  const { state, set } = useWebstore();
  const { brandColor, heroBannerUrl, heroBannerPreview, isUploadingBanner, heroBannerPosition } = state;
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const nativeColorRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const uploadBanner = trpc.stores.uploadBanner.useMutation();
  const uploadClientLogo = trpc.proofing.uploadClientLogo.useMutation();
  const [hexInput, setHexInput] = useState(brandColor);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  //  Drag state 
  const dragging = useRef(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyColor = (c: string) => {
    set("brandColor", c);
    setHexInput(c);
  };

  const handleHexChange = (val: string) => {
    setHexInput(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      set("brandColor", val);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) { toast.error("Unsupported format. Use JPEG, PNG, WebP, or GIF."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("File is too large. Maximum size is 10MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => set("heroBannerPreview", ev.target?.result as string);
    reader.readAsDataURL(file);
    set("isUploadingBanner", true);
    // Reset position when new image is uploaded
    set("heroBannerPosition", { x: 50, y: 50 });
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const result = await uploadBanner.mutateAsync({ fileName: file.name, mimeType: file.type, base64Data: base64 });
      set("heroBannerUrl", result.url);
      toast.success("Hero banner uploaded");
    } catch (err: unknown) {
      log.error("Banner upload failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't upload the banner — please try again");
      set("heroBannerPreview", null);
    } finally {
      set("isUploadingBanner", false);
      if (bannerInputRef.current) bannerInputRef.current.value = "";
    }
  };

  //  Drag handlers 
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: heroBannerPosition.x,
      posY: heroBannerPosition.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !dragStart.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = ev.clientX - dragStart.current.mouseX;
      const dy = ev.clientY - dragStart.current.mouseY;
      // Convert pixel delta to percentage of container
      const newX = Math.min(100, Math.max(0, dragStart.current.posX + (dx / rect.width) * 100));
      const newY = Math.min(100, Math.max(0, dragStart.current.posY + (dy / rect.height) * 100));
      set("heroBannerPosition", { x: Math.round(newX), y: Math.round(newY) });
    };

    const handleMouseUp = () => {
      dragging.current = false;
      setIsDragging(false);
      dragStart.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [heroBannerPosition, set]);

  const hasBanner = !!(heroBannerPreview || heroBannerUrl);
  const bannerSrc = heroBannerPreview || heroBannerUrl || "";
  const objectPosition = `${heroBannerPosition.x}% ${heroBannerPosition.y}%`;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) { toast.error("Use PNG, SVG, JPEG, or WebP for logos."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Logo must be under 5 MB."); return; }
    if (!state.selectedClientId) { toast.error("Select a client first (Step 1) before uploading a logo."); return; }
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
        clientId: state.selectedClientId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
        isPrimary: true,
      });
      setLogoUploaded(true);
      toast.success("Client logo uploaded — branded product previews are now active");
    } catch (err: unknown) {
      log.error("Logo upload failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't upload the logo — please try again");
      setLogoPreview(null);
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Branding</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Customize the look and feel to match your client's brand</p>
      <div className="space-y-6">

        {/*  Brand Color  */}
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Brand Color</label>

          {/* Palette grid */}
          <div className="p-3 bg-mt-surface rounded-xl border border-mt-border mb-3">
            <div className="space-y-1.5">
              {PALETTE.map((row, ri) => (
                <div key={ri} className="flex gap-1.5">
                  {row.map((c) => (
                    <button
                      key={c}
                      title={c}
                      className={`w-8 h-8 rounded-lg transition-all flex-shrink-0 ${
                        brandColor === c
                          ? "ring-2 ring-offset-1 ring-primary scale-110 shadow-md"
                          : "hover:scale-105 hover:shadow-sm"
                      }`}
                      style={{ backgroundColor: c, border: c === "#FFFFFF" ? "1px solid #E5E5E5" : undefined }}
                      onClick={() => applyColor(c)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Hex input + native color picker */}
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-lg border border-mt-border flex-shrink-0 cursor-pointer"
              style={{ backgroundColor: brandColor }}
              onClick={() => nativeColorRef.current?.click()}
              title="Open color picker"
            />
            <input
              ref={nativeColorRef}
              type="color"
              className="sr-only"
              value={brandColor}
              onChange={e => applyColor(e.target.value)}
            />
            <input
              type="text"
              className="w-28 px-3 py-2 text-[12px] border border-mt-border rounded-lg text-center font-mono focus:border-primary outline-none"
              value={hexInput}
              onChange={e => handleHexChange(e.target.value)}
              onBlur={() => setHexInput(brandColor)}
              placeholder="var(--mt-brand)"
            />
            <button
              onClick={() => nativeColorRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-primary border border-mt-border rounded-lg hover:border-primary transition-colors"
              title="Open full color picker"
            >
              <Pipette size={13} /> Custom
            </button>
          </div>
        </div>

        {/*  Hero Banner  */}
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Hero Banner</label>
          <input ref={bannerInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleBannerUpload} className="hidden" />

          {hasBanner ? (
            <>
              {/* Draggable positioning area */}
              <div
                ref={previewRef}
                className={`relative w-full h-40 rounded-xl border-2 border-[#16A34A] bg-[#F0FDF4] overflow-hidden select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                onMouseDown={handleMouseDown}
                title="Drag to reposition image"
              >
                <img
                  src={bannerSrc}
                  alt="Hero banner"
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ objectPosition }}
                  draggable={false}
                />
                {/* Drag hint overlay */}
                {!isDragging && (
                  <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded-full flex items-center gap-1 pointer-events-none">
                    <Move size={10} /> Drag to reposition
                  </div>
                )}
                {isUploadingBanner && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-primary" />
                  </div>
                )}
              </div>

              {/* Replace / Remove buttons */}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => bannerInputRef.current?.click()}
                  className="px-3 py-1.5 text-[12px] font-semibold text-mt-ink border border-mt-border rounded-lg hover:bg-mt-surface-2 transition-colors"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => { set("heroBannerUrl", null); set("heroBannerPreview", null); set("heroBannerPosition", { x: 50, y: 50 }); }}
                  className="px-3 py-1.5 text-[12px] font-semibold text-[#DC2626] border border-mt-border rounded-lg hover:bg-[#FEE2E2] transition-colors flex items-center gap-1"
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="w-full h-40 rounded-xl border-2 border-dashed border-mt-border hover:border-primary flex flex-col items-center justify-center gap-2 transition-all"
              onClick={() => bannerInputRef.current?.click()}
              disabled={isUploadingBanner}
            >
              {isUploadingBanner ? (
                <><Loader2 size={24} className="animate-spin text-primary" /><span className="text-[13px] text-primary font-medium">Uploading...</span></>
              ) : (
                <><Upload size={24} className="text-mt-ink-4" /><span className="text-[13px] text-mt-ink-4">Upload hero banner image (1440 × 400px recommended)</span></>
              )}
            </button>
          )}
        </div>

        {/*  Client Logo (optional)  */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[12px] font-semibold text-mt-ink-2">Client Logo</label>
            <span className="text-[11px] text-mt-ink-4">Optional — add later in store settings</span>
          </div>
          <p className="text-[12px] text-mt-ink-3 mb-3">Used to show branded product previews on the webstore. PNG or SVG with transparency recommended.</p>
          <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" />

          {logoPreview ? (
            <div className="flex items-center gap-4 p-4 rounded-xl border border-[#16A34A] bg-[#F0FDF4]">
              <img src={logoPreview} alt="Client logo" className="h-12 w-auto object-contain" />
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[#15803D]">{logoUploaded ? "Logo uploaded — branded previews active" : "Uploading..."}</p>
                <p className="text-[11px] text-mt-ink-4 mt-0.5">Buyers will see this logo on product images in the store</p>
              </div>
              <button
                type="button"
                onClick={() => { setLogoPreview(null); setLogoUploaded(false); }}
                className="p-1.5 rounded-lg hover:bg-[#DCFCE7] text-[#15803D] transition-colors"
                title="Remove logo"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full h-24 rounded-xl border-2 border-dashed border-mt-border hover:border-primary flex flex-col items-center justify-center gap-2 transition-all"
              onClick={() => logoInputRef.current?.click()}
              disabled={isUploadingLogo}
            >
              {isUploadingLogo ? (
                <><Loader2 size={20} className="animate-spin text-primary" /><span className="text-[12px] text-primary font-medium">Uploading logo...</span></>
              ) : (
                <><ImageIcon size={20} className="text-mt-ink-4" /><span className="text-[12px] text-mt-ink-4">Upload client logo (PNG or SVG with transparency)</span></>
              )}
            </button>
          )}
        </div>

        {/*  Live Preview  */}
        <div className="bg-mt-surface rounded-lg p-5">
          <p className="text-[11px] font-semibold text-mt-ink-4 uppercase tracking-wider mb-3">Preview</p>
          <div className="h-32 rounded-lg overflow-hidden relative" style={{ backgroundColor: brandColor }}>
            {hasBanner && (
              <img
                src={bannerSrc}
                alt="Banner preview"
                className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
                style={{ objectPosition }}
              />
            )}
            <div className="h-full flex items-end p-5 relative z-10">
              <div>
                <p className="text-white text-[18px] font-bold">Welcome to {companyName || "Your"} Store</p>
                <p className="text-white/70 text-[12px]">Browse curated merchandise for your team</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
