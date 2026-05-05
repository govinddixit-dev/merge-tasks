/**
 * VirtualProofingViewer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Fullscreen 3D interactive proof viewer modal.
 * Supports drag-to-rotate, scroll-to-zoom, download, and reset.
 *
 * Audit fixes:
 *   F4:  Added keyboard equivalents for drag-to-rotate (arrow keys) so the
 *        viewer is operable without a mouse.
 *   F13: Added aria-label to all icon-only control buttons.
 *   F16: Viewer container now exposes role="img" with an accessible name so
 *        screen readers announce the product being previewed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Download, X } from "lucide-react";

const DECORATION_METHODS = [
  { id: "embroidery", label: "Embroidery", icon: "🧵" },
  { id: "screen_print", label: "Screen Print", icon: "🖨️" },
  { id: "laser_engraving", label: "Laser Engraving", icon: "⚡" },
  { id: "heat_transfer", label: "Heat Transfer", icon: "🔥" },
  { id: "dtg", label: "DTG Print", icon: "🎨" },
  { id: "sublimation", label: "Sublimation", icon: "💎" },
  { id: "deboss", label: "Deboss", icon: "📐" },
  { id: "patch", label: "Patch", icon: "🏷️" },
] as const;

type DecorationId = (typeof DECORATION_METHODS)[number]["id"];

export interface ViewerProof {
  proofImageUrl: string | null;
  productName: string;
  decorationMethod: string;
}

interface VirtualProofingViewerProps {
  proof: ViewerProof;
  onClose: () => void;
  onDownload: (url: string, name: string) => void;
}

// Degrees rotated per arrow-key press
const KEY_ROTATE_STEP = 5;
const KEY_ZOOM_STEP = 0.1;

export function VirtualProofingViewer({ proof, onClose, onDownload }: VirtualProofingViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const decoration = DECORATION_METHODS.find((d) => d.id === (proof.decorationMethod as DecorationId));

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - rotation.y * 2, y: e.clientY - rotation.x * 2 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setRotation({
      x: (e.clientY - dragStart.y) / 2,
      y: (e.clientX - dragStart.x) / 2,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Audit fix F4: keyboard equivalents for rotate and zoom so the viewer is
  // fully operable without a pointing device.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        setRotation((r) => ({ ...r, y: r.y - KEY_ROTATE_STEP }));
        break;
      case "ArrowRight":
        e.preventDefault();
        setRotation((r) => ({ ...r, y: r.y + KEY_ROTATE_STEP }));
        break;
      case "ArrowUp":
        e.preventDefault();
        setRotation((r) => ({ ...r, x: r.x - KEY_ROTATE_STEP }));
        break;
      case "ArrowDown":
        e.preventDefault();
        setRotation((r) => ({ ...r, x: r.x + KEY_ROTATE_STEP }));
        break;
      case "+":
      case "=":
        e.preventDefault();
        setZoom((z) => Math.min(3, z + KEY_ZOOM_STEP));
        break;
      case "-":
        e.preventDefault();
        setZoom((z) => Math.max(0.5, z - KEY_ZOOM_STEP));
        break;
      case "r":
      case "R":
        e.preventDefault();
        setRotation({ x: 0, y: 0 });
        setZoom(1);
        break;
      case "Escape":
        onClose();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10002] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Controls — audit fix F13: add aria-label to all icon-only buttons */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button
          aria-label="Zoom in"
          onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(3, z + 0.25)); }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          title="Zoom In"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          aria-label="Zoom out"
          onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(0.5, z - 0.25)); }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          title="Zoom Out"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          aria-label="Reset rotation and zoom"
          onClick={(e) => { e.stopPropagation(); setRotation({ x: 0, y: 0 }); setZoom(1); }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          title="Reset"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
        <button
          aria-label={`Download proof for ${proof.productName}`}
          onClick={(e) => { e.stopPropagation(); onDownload(proof.proofImageUrl ?? "", proof.productName); }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          title="Download"
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          aria-label="Close viewer"
          onClick={onClose}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-xs font-medium">
        Drag or use arrow keys to rotate &middot; Scroll or +/- to zoom
      </div>

      {/* 3D canvas — audit fix F4: tabIndex + onKeyDown for keyboard rotate/zoom */}
      <div
        ref={viewerRef}
        className="relative select-none outline-none"
        style={{ perspective: "1200px", cursor: isDragging ? "grabbing" : "grab" }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onKeyDown={handleKeyDown}
        onWheel={(e) => {
          e.stopPropagation();
          setZoom((z) => Math.max(0.5, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1))));
        }}
        tabIndex={0}
        role="img"
        aria-label={`3D proof viewer for ${proof.productName}. Use arrow keys to rotate, plus/minus to zoom, R to reset.`}
      >
        <img
          src={proof.proofImageUrl ?? ""}
          alt={proof.productName}
          className="max-h-[75vh] max-w-[80vw] object-contain rounded-lg shadow-2xl"
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale(${zoom})`,
            transition: isDragging ? "none" : "transform 0.2s ease-out",
            transformOrigin: "center center",
          }}
          draggable={false}
        />
      </div>

      {/* Caption */}
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 text-center">
        <p className="text-white text-sm font-semibold">{proof.productName}</p>
        <p className="text-white/70 text-xs">
          {decoration?.icon} {decoration?.label}
        </p>
      </div>
    </div>
  );
}
