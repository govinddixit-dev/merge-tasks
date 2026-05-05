/**
 * Status badge color palette — single source of truth for status pill colors
 * across the platform. Maps semantic tones (gray / blue / purple / green /
 * red / amber) to background + text hex values that align with the design
 * spec (Tailwind `*-50` background, `*-700` text).
 *
 * Pages map their domain-specific status keys to a tone, ensuring the same
 * visual identity for matching states across Proposals, Estimates, Invoices,
 * Purchase Orders, Stores, etc.
 */

export type StatusTone =
  | "gray"
  | "blue"
  | "purple"
  | "green"
  | "red"
  | "amber";

export interface StatusToneStyle {
  bg: string;
  text: string;
}

export const statusTone: Record<StatusTone, StatusToneStyle> = {
  gray:   { bg: "#F3F4F6", text: "#4B5563" }, // Draft / Inactive / Void
  blue:   { bg: "#EFF6FF", text: "#1D4ED8" }, // Pending / Sent
  purple: { bg: "#FAF5FF", text: "#6B21A8" }, // Active / Approved / Acknowledged
  green:  { bg: "#F0FDF4", text: "#15803D" }, // Accepted / Completed / Paid / Received
  red:    { bg: "#FEF2F2", text: "#B91C1C" }, // Rejected / Cancelled / Failed / Declined
  amber:  { bg: "#FFFBEB", text: "#B45309" }, // Warning / Overdue / Partial / On Hold
};

/** Standard pill-shape classes for a status badge. */
export const statusBadgeClass =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
