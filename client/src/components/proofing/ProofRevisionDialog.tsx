/**
 * ProofRevisionDialog.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal dialog for requesting AI revision on a virtual proof.
 * Accessibility: role="dialog", aria-modal, focus trap, Escape to close.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface ProofRevisionDialogProps {
  revisionText: string;
  isRevising: boolean;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function ProofRevisionDialog({
  revisionText, isRevising, onTextChange, onSubmit, onCancel,
}: ProofRevisionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when the dialog opens
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Focus trap: keep Tab/Shift+Tab inside the dialog; Escape closes it
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10002] bg-black/50 flex items-center justify-center"
      onClick={onCancel}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-dialog-title"
        aria-describedby="revision-dialog-desc"
        className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3
          id="revision-dialog-title"
          className="text-lg font-semibold text-gray-900 mb-1"
        >
          Request Revision
        </h3>
        <p id="revision-dialog-desc" className="text-sm text-gray-500 mb-4">
          Describe what changes you&apos;d like the AI to make to this proof. Be specific about
          placement, size, color, or style adjustments.
        </p>
        <textarea
          ref={textareaRef}
          value={revisionText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="e.g., Make the logo larger, move it to the left chest area, use white thread for embroidery..."
          className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          rows={4}
          aria-label="Revision instructions"
        />
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            disabled={isRevising}
            aria-label="Cancel revision"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!revisionText.trim() || isRevising}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            aria-label="Submit revision to AI"
          >
            {isRevising ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Revising...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" aria-hidden="true" /> Revise with AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
