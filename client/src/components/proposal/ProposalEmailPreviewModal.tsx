/**
 * ProposalEmailPreviewModal
 * Email preview modal used in the Create Proposal wizard after sending.
 *
 * SECURITY (PO-8): The `html` prop comes from a server-rendered email template
 * that may contain user-supplied content (client name, proposal notes, etc.).
 * We sanitize it with DOMPurify before rendering to prevent stored XSS.
 */

import { useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import DOMPurify from "dompurify";

interface Props {
  show: boolean;
  loading: boolean;
  html: string | null;
  subject: string;
  clientName: string;
  clientEmail: string;
  onClose: () => void;
}

/**
 * DOMPurify configuration for email previews.
 * We allow standard HTML email tags and inline styles but strip scripts,
 * event handlers, and dangerous URI schemes.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "a", "b", "blockquote", "br", "caption", "center", "code", "col",
    "colgroup", "dd", "div", "dl", "dt", "em", "font", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s",
    "small", "span", "strong", "sub", "sup", "table", "tbody", "td",
    "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  ALLOWED_ATTR: [
    "align", "alt", "bgcolor", "border", "cellpadding", "cellspacing",
    "class", "color", "colspan", "dir", "face", "height", "href", "id",
    "rowspan", "size", "src", "style", "target", "title", "valign", "width",
  ],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export default function ProposalEmailPreviewModal({
  show, loading, html, subject, clientName, clientEmail, onClose,
}: Props) {
  // Sanitize once when html changes — avoids re-sanitizing on every render
  const sanitizedHtml = useMemo(() => {
    if (!html) return null;
    return DOMPurify.sanitize(html, PURIFY_CONFIG);
  }, [html]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[10002] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#F0F0F0] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Email Client Chrome */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-mt-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#EF4444]" />
              <span className="w-3 h-3 rounded-full bg-[#F59E0B]" />
              <span className="w-3 h-3 rounded-full bg-[#22C55E]" />
            </div>
            <span className="text-[13px] font-semibold text-mt-ink">Email Preview — Actual Template</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-mt-surface-2 rounded-lg transition-colors">
            <X size={16} className="text-mt-ink-3" />
          </button>
        </div>

        {/* Email Header Meta */}
        <div className="px-5 py-3 bg-white border-b border-mt-border space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-mt-ink-4 w-12">To:</span>
            <span className="text-[12px] text-mt-ink">{clientName} &lt;{clientEmail}&gt;</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-mt-ink-4 w-12">Subject:</span>
            <span className="text-[12px] font-semibold text-mt-ink">{subject || "Proposal — Ready for Review"}</span>
          </div>
        </div>

        {/* Email Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 size={24} className="animate-spin text-primary mx-auto mb-3" />
                <p className="text-[13px] text-mt-ink-3">Generating email preview...</p>
              </div>
            </div>
          ) : sanitizedHtml ? (
            <div
              className="w-full bg-white rounded-xl overflow-auto"
              style={{ minHeight: 600, maxWidth: 620, margin: '0 auto', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          ) : (
            <div className="flex items-center justify-center py-20">
              <p className="text-[13px] text-mt-ink-3">No preview available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
