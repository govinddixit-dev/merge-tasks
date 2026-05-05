/**
 * ConfirmDialog — single source of truth for confirmation / destructive
 * prompts across the app. Built on the existing Radix/shadcn Dialog
 * primitive; no new dependencies.
 *
 * Layout (intentionally unconventional):
 *   ┌───────────────────────────────────────────────┐
 *   │  X                       [Cancel]  [Confirm]  │  ← action bar
 *   │                                                │
 *   │  Delete this client?                           │  ← title
 *   │  This cannot be undone. Related records will   │  ← description
 *   │  also be removed.                              │
 *   └───────────────────────────────────────────────┘
 *
 * The X close control sits top-LEFT, the action buttons top-RIGHT
 * (Cancel + primary). Title + description sit below the action bar,
 * left-aligned, bold title above a subtle-gray body.
 *
 * Primary action colour:
 *   confirmVariant = "destructive" (default) → solid black, not red, so
 *                    destructive prompts read as deliberate, not alarming.
 *   confirmVariant = "primary"               → brand purple (#654BF9).
 */

import * as React from "react";
import { X as XIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const BRAND_PURPLE = "#654BF9";
const BRAND_PURPLE_HOVER = "#5640E0";
const DESTRUCTIVE = "#111111";
const DESTRUCTIVE_HOVER = "#000000";

export type ConfirmVariant = "destructive" | "primary";

export interface ConfirmDialogProps {
  /** Controlled open state. */
  open: boolean;
  /** Bold, left-aligned headline — the yes/no question. */
  title: string;
  /** Subtle-gray supporting copy. Optional; omit for one-line prompts. */
  description?: React.ReactNode;
  /** Cancel / secondary button label. Default: "Cancel". */
  cancelLabel?: string;
  /** Primary action button label. Default: "Confirm". */
  confirmLabel?: string;
  /**
   * Colour of the primary action.
   *   "destructive" (default) → solid black — delete/remove/disconnect.
   *   "primary"               → brand purple — routine confirmations.
   */
  confirmVariant?: ConfirmVariant;
  /** Fires when the primary action is clicked. */
  onConfirm: () => void;
  /**
   * Fires when the dialog is dismissed — Cancel button, X close,
   * backdrop click, or Escape key all route through here. Callers
   * typically use this to reset their own `open` state back to false.
   */
  onCancel: () => void;
  /**
   * External loading flag. When true, both buttons are disabled and
   * the X close is blocked so the caller's async mutation can settle
   * without the user clicking through a half-committed state.
   */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  confirmVariant = "destructive",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const confirmBg = confirmVariant === "destructive" ? DESTRUCTIVE : BRAND_PURPLE;
  const confirmHover = confirmVariant === "destructive" ? DESTRUCTIVE_HOVER : BRAND_PURPLE_HOVER;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While a caller-tracked mutation is pending, block dismissal so
        // the user can't close the modal mid-action.
        if (loading) return;
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[460px] p-0 gap-0 rounded-lg border border-mt-border bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
      >
        {/* ── Action bar: X on the left, Cancel + Confirm on the right ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-mt-border">
          <DialogPrimitive.Close
            type="button"
            aria-label="Close"
            disabled={loading}
            className="inline-flex w-7 h-7 items-center justify-center rounded-md text-mt-ink-3 hover:bg-mt-surface-2 hover:text-mt-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <XIcon size={15} />
          </DialogPrimitive.Close>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="inline-flex items-center h-8 px-3 rounded-md text-[12.5px] font-medium text-mt-ink-2 border border-mt-border bg-white hover:bg-mt-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center h-8 px-3 rounded-md text-[12.5px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: confirmBg }}
              onMouseEnter={(e) => {
                if (loading) return;
                e.currentTarget.style.backgroundColor = confirmHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = confirmBg;
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>

        {/* ── Title + description ── */}
        <div className="px-5 py-5">
          <DialogTitle className="text-[17px] font-semibold text-mt-ink tracking-tight text-left leading-snug">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="mt-2 text-[13px] text-mt-ink-3 text-left leading-relaxed">
              {description}
            </DialogDescription>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
