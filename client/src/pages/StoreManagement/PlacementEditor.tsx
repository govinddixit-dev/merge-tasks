/**
 * PlacementEditor — Phase 7+ visual logo placement editor.
 *
 * Modal that opens from a Renders-tab card. The distributor drags, resizes,
 * and rotates the store logo over the product image. Two save paths:
 *
 *   1. Save as Photorealistic Render (PRIMARY)
 *      - Saves coordinates to storeProducts.renderPlacement* (5 columns)
 *      - Triggers renderManager.reRender({ autoApprove: true }) — the
 *        orchestrator carries the coords through as the ABSOLUTE
 *        POSITIONING OVERRIDE block, and on render success the worker
 *        auto-approves so the customer-facing image flips immediately.
 *      - Trade-off: image-gen models treat coordinates as a hint, so
 *        positioning is approximate; the texture/lighting/drape are
 *        photorealistic.
 *
 *   2. Save as Flat Overlay (SECONDARY)
 *      - Flattens product image + logo on an offscreen <canvas>
 *      - Uploads the JPEG composite via renderManager.uploadOverride
 *      - Auto-approves (uploadOverride does that server-side).
 *      - Trade-off: pixel-perfect positioning, but no decoration physics
 *        — the result looks like a flat sticker, not a finished garment.
 *
 * Coordinates are percentages of the product image so they're resolution-
 * independent. The on-screen canvas is bounded by EDITOR_MAX_WIDTH; mouse
 * deltas in pixels are converted to percentages via the displayed image's
 * actual rendered size.
 *
 * No external drag library — plain pointer events. Aspect ratio locks
 * by default on corner drag; hold Shift to free-resize.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, RotateCw, X, Eraser } from "lucide-react";

const EDITOR_MAX_WIDTH = 600;
const HANDLE_SIZE = 12;
const ROTATION_HANDLE_OFFSET = 28;

/** Default placement when no saved coords exist: 20% wide, centered. */
const DEFAULT_PLACEMENT = { x: 40, y: 40, width: 20, height: 20, rotation: 0 };

export interface PlacementEditorProps {
  storeProductId: number;
  productImageUrl: string;
  /**
   * Store logo. When null, the editor still opens — the operator can lay
   * out placement coords for a future render — but the override-composite
   * path is disabled (no logo to flatten) and the canvas shows a dashed
   * placeholder rectangle in place of the logo image.
   */
  logoUrl: string | null;
  productName: string;
  /** Pre-fill from saved placement; null/undefined → default placement. */
  initialPlacement?: {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    rotation: number | null;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

type DragMode =
  | { kind: "none" }
  | { kind: "move"; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: "resize";
      corner: "nw" | "ne" | "sw" | "se";
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      shiftKey: boolean;
    }
  | {
      kind: "rotate";
      centerX: number;
      centerY: number;
      startAngle: number;
      origRotation: number;
    };

export function PlacementEditor({
  storeProductId,
  productImageUrl,
  logoUrl,
  productName,
  initialPlacement,
  onClose,
  onSaved,
}: PlacementEditorProps) {
  // Canvas pixel dimensions of the displayed product image, measured after
  // it loads. We need both for mouse-px → percentage math.
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const productImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  // Placement state in percentages (resolution-independent).
  const [placement, setPlacement] = useState(() => ({
    x:        initialPlacement?.x        ?? DEFAULT_PLACEMENT.x,
    y:        initialPlacement?.y        ?? DEFAULT_PLACEMENT.y,
    width:    initialPlacement?.width    ?? DEFAULT_PLACEMENT.width,
    height:   initialPlacement?.height   ?? DEFAULT_PLACEMENT.height,
    rotation: initialPlacement?.rotation ?? DEFAULT_PLACEMENT.rotation,
  }));

  // Active logo image src. Starts as the original logoUrl; "Remove
  // Background" swaps in a processed version. May be null when the store
  // has no logo configured — the canvas falls back to a placeholder box.
  const [activeLogoUrl, setActiveLogoUrl] = useState<string | null>(logoUrl);
  const [removingBg, setRemovingBg] = useState(false);
  const [savingPlacement, setSavingPlacement] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);

  const dragRef = useRef<DragMode>({ kind: "none" });
  // Mirror of canvasSize for use inside window-attached pointer handlers,
  // which capture refs (stable identity) instead of state (stale closure).
  const canvasSizeRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);

  const savePlacementMut = trpc.renderManager.savePlacement.useMutation();
  const reRenderMut = trpc.renderManager.reRender.useMutation();
  const uploadOverrideMut = trpc.renderManager.uploadOverride.useMutation();

  // Measure the displayed product image once it loads. Falls back to natural
  // dimensions scaled to EDITOR_MAX_WIDTH.
  const onProductImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    productImgRef.current = el;
    const naturalAspect = el.naturalHeight / Math.max(1, el.naturalWidth);
    const w = Math.min(EDITOR_MAX_WIDTH, el.naturalWidth);
    const h = w * naturalAspect;
    setCanvasSize({ w, h });
  }, []);

  // ─── Drag / resize / rotate ───────────────────────────────────────────
  //
  // Window-attached pointer listeners (vs React's onPointerMove on the
  // canvas div) so the handlers fire reliably regardless of where the
  // pointer travels — including outside the modal, over the corner
  // handles, or off-screen during a fast drag. The previous setPointer
  // Capture-on-child + onPointerMove-on-parent pattern was fragile: the
  // resize handles sit inside the logo div whose parent has the move
  // handler, and pointer capture on the inner-most element interfered
  // with React's synthetic event delivery to the canvas.

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    const cs = canvasSizeRef.current;
    if (drag.kind === "none" || !cs) return;
    e.preventDefault();
    if (drag.kind === "move") {
      const dxPct = ((e.clientX - drag.startX) / cs.w) * 100;
      const dyPct = ((e.clientY - drag.startY) / cs.h) * 100;
      setPlacement(p => ({
        ...p,
        x: clamp(drag.origX + dxPct, 0, 100 - p.width),
        y: clamp(drag.origY + dyPct, 0, 100 - p.height),
      }));
    } else if (drag.kind === "resize") {
      const dxPct = ((e.clientX - drag.startX) / cs.w) * 100;
      const dyPct = ((e.clientY - drag.startY) / cs.h) * 100;
      const lockAspect = !drag.shiftKey && !e.shiftKey;
      let newX = drag.origX;
      let newY = drag.origY;
      let newW = drag.origW;
      let newH = drag.origH;
      switch (drag.corner) {
        case "se":
          newW = clamp(drag.origW + dxPct, 4, 100 - drag.origX);
          newH = clamp(drag.origH + dyPct, 4, 100 - drag.origY);
          if (lockAspect) {
            const ratio = drag.origH / drag.origW;
            newH = newW * ratio;
          }
          break;
        case "sw":
          newW = clamp(drag.origW - dxPct, 4, drag.origX + drag.origW);
          newH = clamp(drag.origH + dyPct, 4, 100 - drag.origY);
          newX = drag.origX + drag.origW - newW;
          if (lockAspect) {
            const ratio = drag.origH / drag.origW;
            newH = newW * ratio;
          }
          break;
        case "ne":
          newW = clamp(drag.origW + dxPct, 4, 100 - drag.origX);
          newH = clamp(drag.origH - dyPct, 4, drag.origY + drag.origH);
          newY = drag.origY + drag.origH - newH;
          if (lockAspect) {
            const ratio = drag.origH / drag.origW;
            newH = newW * ratio;
            newY = drag.origY + drag.origH - newH;
          }
          break;
        case "nw":
          newW = clamp(drag.origW - dxPct, 4, drag.origX + drag.origW);
          newH = clamp(drag.origH - dyPct, 4, drag.origY + drag.origH);
          newX = drag.origX + drag.origW - newW;
          newY = drag.origY + drag.origH - newH;
          if (lockAspect) {
            const ratio = drag.origH / drag.origW;
            newH = newW * ratio;
            newY = drag.origY + drag.origH - newH;
            newX = drag.origX + drag.origW - newW;
          }
          break;
      }
      setPlacement(p => ({ ...p, x: newX, y: newY, width: newW, height: newH }));
    } else if (drag.kind === "rotate") {
      const angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * (180 / Math.PI);
      const delta = angle - drag.startAngle;
      setPlacement(p => ({ ...p, rotation: drag.origRotation + delta }));
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = { kind: "none" };
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  }, [handlePointerMove]);

  function attachPointerListeners() {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  // Safety: clean up window listeners if the editor unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  function startMove(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!canvasSize) return;
    dragRef.current = {
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      origX: placement.x,
      origY: placement.y,
    };
    attachPointerListeners();
  }

  function startResize(corner: "nw" | "ne" | "sw" | "se") {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canvasSize) return;
      dragRef.current = {
        kind: "resize",
        corner,
        startX: e.clientX,
        startY: e.clientY,
        origX: placement.x,
        origY: placement.y,
        origW: placement.width,
        origH: placement.height,
        shiftKey: e.shiftKey,
      };
      attachPointerListeners();
    };
  }

  function startRotate(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!canvasRef.current || !canvasSize) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const centerX = rect.left + (canvasSize.w * (placement.x + placement.width / 2)) / 100;
    const centerY = rect.top + (canvasSize.h * (placement.y + placement.height / 2)) / 100;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    dragRef.current = {
      kind: "rotate",
      centerX,
      centerY,
      startAngle,
      origRotation: placement.rotation,
    };
    attachPointerListeners();
  }

  function onWheel(e: React.WheelEvent) {
    if (!canvasSize) return;
    const delta = e.deltaY > 0 ? -1.5 : 1.5;
    setPlacement(p => {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const ratio = p.height / p.width;
      const newW = clamp(p.width + delta, 4, 100);
      const newH = newW * ratio;
      return {
        ...p,
        width: newW,
        height: newH,
        x: clamp(cx - newW / 2, 0, 100 - newW),
        y: clamp(cy - newH / 2, 0, 100 - newH),
      };
    });
  }

  function reset() {
    setPlacement({ ...DEFAULT_PLACEMENT });
  }

  // ─── Background removal ───────────────────────────────────────────────

  async function handleRemoveBackground() {
    if (!activeLogoUrl) return;
    setRemovingBg(true);
    try {
      // The browser does this client-side via canvas + simple white-pixel
      // alpha. The server-side Sharp pipeline (logo-background-removal.ts)
      // is for renders only — we don't ship it through tRPC just for the
      // editor preview. This keeps the action snappy and avoids a round-trip.
      const cleaned = await removeBackgroundClientSide(activeLogoUrl);
      setActiveLogoUrl(cleaned);
      toast.success("Background removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove background");
    } finally {
      setRemovingBg(false);
    }
  }

  // ─── Save paths ───────────────────────────────────────────────────────

  async function handleSaveAsPhotorealistic() {
    setSavingPlacement(true);
    try {
      // Server validates rotation in [-360, 360]. Multiple full spins
      // can push the raw value beyond that, so normalise here.
      const normalisedRotation = ((placement.rotation % 360) + 360) % 360;
      await savePlacementMut.mutateAsync({
        storeProductId,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: normalisedRotation > 180 ? normalisedRotation - 360 : normalisedRotation,
      });
      // Trigger a re-render with auto-approve. We don't pass
      // promptAdjustment so the existing value is preserved — the
      // orchestrator combines coords + manual text. autoApprove tells
      // the worker to flip renderApproved=true on success so the
      // customer-facing image swaps without an extra approve click.
      await reRenderMut.mutateAsync({ storeProductId, autoApprove: true });
      toast.success("Rendering photorealistic version — approves automatically when ready", {
        description: "Typically completes in 30-60 seconds.",
      });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save placement");
    } finally {
      setSavingPlacement(false);
    }
  }

  async function handleSaveAsOverride() {
    if (!productImgRef.current || !logoImgRef.current) {
      toast.error("Images still loading — try again in a moment");
      return;
    }
    setSavingOverride(true);
    try {
      const blob = await renderComposite(
        productImgRef.current,
        logoImgRef.current,
        placement,
      );
      const base64 = await blobToBase64(blob);
      await uploadOverrideMut.mutateAsync({
        storeProductId,
        imageBase64: base64,
        mimeType: "image/jpeg",
        fileName: "placement-composite.jpg",
      });
      toast.success("Flat overlay saved — exact positioning, no texture effects");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save override");
    } finally {
      setSavingOverride(false);
    }
  }

  // ─── Layout ───────────────────────────────────────────────────────────

  const logoStyle = useMemo<React.CSSProperties>(() => {
    if (!canvasSize) return { display: "none" };
    return {
      position: "absolute",
      left:   `${(placement.x / 100) * canvasSize.w}px`,
      top:    `${(placement.y / 100) * canvasSize.h}px`,
      width:  `${(placement.width / 100) * canvasSize.w}px`,
      height: `${(placement.height / 100) * canvasSize.h}px`,
      transform: `rotate(${placement.rotation}deg)`,
      transformOrigin: "center center",
      filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))",
      cursor: "move",
      touchAction: "none",
      userSelect: "none",
    };
  }, [canvasSize, placement]);

  const isBusy = savingPlacement || savingOverride || removingBg;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[10003] flex items-center justify-center p-4 overflow-auto"
      onClick={() => !isBusy && onClose()}
    >
      <div
        className="bg-white rounded-xl w-full max-w-3xl max-h-[95vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-mt-border">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-mt-ink truncate">Edit placement</h3>
            <p className="text-[12px] text-mt-ink-4 truncate">{productName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close"
            className="text-mt-ink-4 hover:text-mt-ink-2 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          <div
            ref={canvasRef}
            className="relative bg-mt-surface-2 rounded-lg overflow-hidden select-none"
            style={{
              width: canvasSize ? `${canvasSize.w}px` : `${EDITOR_MAX_WIDTH}px`,
              height: canvasSize ? `${canvasSize.h}px` : `${EDITOR_MAX_WIDTH * 0.75}px`,
              maxWidth: "100%",
            }}
            onWheel={onWheel}
          >
            <img
              src={productImageUrl}
              alt={productName}
              onLoad={onProductImgLoad}
              draggable={false}
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
            {canvasSize && (
              <div style={logoStyle} onPointerDown={startMove}>
                {activeLogoUrl ? (
                  <img
                    ref={logoImgRef}
                    src={activeLogoUrl}
                    alt=""
                    draggable={false}
                    crossOrigin="anonymous"
                    className="w-full h-full object-contain pointer-events-none"
                  />
                ) : (
                  <div className="w-full h-full border-2 border-dashed border-primary/70 bg-primary/5 flex items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-primary pointer-events-none">
                    Logo placeholder
                  </div>
                )}
                {/* Resize handles */}
                {(["nw", "ne", "sw", "se"] as const).map(corner => (
                  <div
                    key={corner}
                    onPointerDown={startResize(corner)}
                    style={{
                      position: "absolute",
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      background: "#fff",
                      border: "2px solid #654BF9",
                      borderRadius: 2,
                      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                      ...(corner === "nw" && { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }),
                      ...(corner === "ne" && { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }),
                      ...(corner === "sw" && { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }),
                      ...(corner === "se" && { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }),
                    }}
                  />
                ))}
                {/* Rotation handle */}
                <div
                  onPointerDown={startRotate}
                  style={{
                    position: "absolute",
                    top: -ROTATION_HANDLE_OFFSET,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: HANDLE_SIZE + 4,
                    height: HANDLE_SIZE + 4,
                    background: "#654BF9",
                    border: "2px solid #fff",
                    borderRadius: "50%",
                    cursor: "grab",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  }}
                >
                  <RotateCw size={8} color="#fff" />
                </div>
              </div>
            )}
          </div>

          <p className="text-[11px] text-mt-ink-4 text-center max-w-md">
            Drag the logo to move. Drag the corners to resize (hold Shift for free
            aspect). Use the top circle to rotate. Scroll to zoom.
          </p>

          {!activeLogoUrl && (
            <p className="text-[11px] text-[#D97706] bg-[#FEF3C7] px-3 py-1.5 rounded-md font-medium text-center max-w-md">
              No store logo configured — placement coords can be saved for the next render, but the override-composite path is unavailable until a logo is uploaded.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 justify-center">
            <button
              onClick={handleRemoveBackground}
              disabled={isBusy || !activeLogoUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
            >
              {removingBg ? <Loader2 size={12} className="animate-spin" /> : <Eraser size={12} />}
              Remove Background
            </button>
            <button
              onClick={reset}
              disabled={isBusy}
              className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3 px-5 py-4 border-t border-mt-border">
          <button
            onClick={onClose}
            disabled={isBusy}
            className="py-2.5 px-4 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex-1 flex flex-col gap-1">
            <button
              onClick={handleSaveAsPhotorealistic}
              disabled={isBusy || !canvasSize}
              className="flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] transition-colors disabled:opacity-60"
            >
              {savingPlacement && <Loader2 size={14} className="animate-spin" />}
              Save as Photorealistic Render
            </button>
            <span className="text-xs text-mt-ink-3 text-center">
              AI-rendered with realistic texture
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <button
              onClick={handleSaveAsOverride}
              disabled={isBusy || !canvasSize || !activeLogoUrl}
              title={!activeLogoUrl ? "Upload a store logo to enable composite saving" : undefined}
              className="flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold rounded-lg border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2 transition-colors disabled:opacity-50"
            >
              {savingOverride && <Loader2 size={14} className="animate-spin" />}
              Save as Flat Overlay
            </button>
            <span className="text-xs text-mt-ink-3 text-center">
              Exact positioning, no texture effects
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Flatten product image + transformed logo onto an offscreen canvas at the
 * product image's natural resolution, then encode JPEG. The logo is rotated
 * around its own center to match the on-screen preview.
 */
async function renderComposite(
  productImg: HTMLImageElement,
  logoImg: HTMLImageElement,
  placement: { x: number; y: number; width: number; height: number; rotation: number },
): Promise<Blob> {
  const w = productImg.naturalWidth || productImg.width;
  const h = productImg.naturalHeight || productImg.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(productImg, 0, 0, w, h);

  const lw = (placement.width / 100) * w;
  const lh = (placement.height / 100) * h;
  const lx = (placement.x / 100) * w;
  const ly = (placement.y / 100) * h;
  const cx = lx + lw / 2;
  const cy = ly + lh / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((placement.rotation * Math.PI) / 180);
  ctx.drawImage(logoImg, -lw / 2, -lh / 2, lw, lh);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      "image/jpeg",
      0.9,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Client-side background removal: knock out near-white pixels from the
 * logo. Crude but adequate for the editor preview — the durable, stitched-
 * to-fabric processing happens server-side in logo-background-removal.ts
 * during the actual render. Returns a data: URL ready to assign to <img>.
 */
async function removeBackgroundClientSide(srcUrl: string): Promise<string> {
  const img = await loadImage(srcUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) {
      px[i + 3] = 0;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

