/**
 * POBulkPreviewCard — collapsed inline preview rendered by AIChatBox
 * when the assistant returns a `po_bulk_preview` attachment.
 *
 * Lists supplier groups + flagged count and deep-links to the full
 * preview screen at /purchase-orders/preview/:token.
 */
import { Link } from "wouter";
import { Sparkles, AlertCircle, ExternalLink } from "lucide-react";

export type POBulkPreviewPayload = {
  previewToken: string;
  groups: Array<{
    supplierName: string;
    itemCount: number;
    confidence: number;
    needsManualAssignment: boolean;
  }>;
  sourceProposalIds: number[];
  flaggedCount: number;
};

export default function POBulkPreviewCard({ payload }: { payload: POBulkPreviewPayload }) {
  const { previewToken, groups, sourceProposalIds, flaggedCount } = payload;

  return (
    <div
      className="rounded-lg border bg-white p-4 shadow-sm"
      style={{ borderColor: "#E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="size-7 rounded-full flex items-center justify-center" style={{ backgroundColor: "#F5F3FF" }}>
          <Sparkles className="size-4" style={{ color: "#654BF9" }} />
        </div>
        <div>
          <p className="text-[13px] font-bold text-[#1A1A1A]">PO Preview Ready</p>
          <p className="text-[11px] text-gray-500">
            {groups.length} supplier{groups.length !== 1 ? "s" : ""} · {sourceProposalIds.length} proposal{sourceProposalIds.length !== 1 ? "s" : ""}
            {flaggedCount > 0 ? ` · ${flaggedCount} need review` : ""}
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 mb-4">
        {groups.slice(0, 6).map((g, idx) => (
          <li key={idx} className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-[#1A1A1A] truncate flex-1 mr-2">
              {g.needsManualAssignment ? (
                <AlertCircle className="inline size-3 mr-1 text-amber-500" />
              ) : null}
              {g.supplierName}
            </span>
            <span className="text-gray-500 shrink-0">
              {g.itemCount} item{g.itemCount !== 1 ? "s" : ""} · {g.confidence}%
            </span>
          </li>
        ))}
        {groups.length > 6 && (
          <li className="text-[11px] text-gray-400 italic">+ {groups.length - 6} more supplier(s)</li>
        )}
      </ul>

      <Link
        href={`/purchase-orders/preview/${previewToken}`}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-md px-3 py-1.5 text-white"
        style={{ backgroundColor: "#654BF9" }}
      >
        Open full preview <ExternalLink className="size-3" />
      </Link>
    </div>
  );
}
