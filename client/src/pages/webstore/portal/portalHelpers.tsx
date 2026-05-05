/**
 * Portal Helpers — shared types, status helpers, and StatusBadge used across all portal tabs.
 */

export interface ClientPortalProps {
  storeSlug: string;
  primaryColor: string;
  storeName: string;
  onNavigateToProposal?: (viewToken: string) => void;
}

export function statusColor(status: string, pc: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    sent: { bg: "#EFF6FF", text: "#2563EB" },
    viewed: { bg: "#FFF7ED", text: "#EA580C" },
    accepted: { bg: "#F0FDF4", text: "#16A34A" },
    declined: { bg: "#FEF2F2", text: "#DC2626" },
    expired: { bg: "#F5F5F5", text: "#737373" },
    draft: { bg: "#F5F5F5", text: "#737373" },
    pending: { bg: "#FFF7ED", text: "#EA580C" },
    processing: { bg: "#EFF6FF", text: "#2563EB" },
    production: { bg: "#F5F3FF", text: "#7C3AED" },
    shipped: { bg: "#ECFDF5", text: "#059669" },
    delivered: { bg: "#F0FDF4", text: "#16A34A" },
    cancelled: { bg: "#FEF2F2", text: "#DC2626" },
    submitted: { bg: "#EFF6FF", text: "#2563EB" },
    reviewed: { bg: "#FFF7ED", text: "#EA580C" },
    quoted: { bg: "#F5F3FF", text: "#7C3AED" },
    approved: { bg: "#F0FDF4", text: "#16A34A" },
    in_production: { bg: "#F5F3FF", text: "#7C3AED" },
    completed: { bg: "#F0FDF4", text: "#16A34A" },
    rejected: { bg: "#FEF2F2", text: "#DC2626" },
  };
  return map[status] || { bg: `${pc}15`, text: pc };
}

export function StatusBadge({ status, pc }: { status: string; pc: string }) {
  const { bg, text } = statusColor(status, pc);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: bg, color: text }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
