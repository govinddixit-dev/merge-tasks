/**
 * publicProposalTypes.ts — Shared types, constants, and helpers for the
 * public proposal view feature.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface PriceTier {
  id: number;
  tierType: "quantity" | "size";
  label: string;
  minQty: number | null;
  maxQty: number | null;
  price: string;
}

export interface SizeChart {
  chartData: Array<Record<string, string>>;
  imageUrl: string | null;
}

export interface ProposalProduct {
  id: number;
  productId: number;
  name: string;
  description: string | null;
  category: string;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  decorationType: string | null;
  decorationNotes: string | null;
  imageUrl: string | null;
  additionalImages: string[];
  proofImageUrl: string | null;
  proofStatus: string | null;
  decorationZone: string | null;
  colors: string[];
  sizes: string[];
  logoPositions: string[];
  priceTiers: PriceTier[];
  proposalImages: string[];
  sizeChart: SizeChart | null;
}

export interface OrderItem {
  id?: number;
  proposalProductId: number;
  productId: number;
  color: string | null;
  size: string | null;
  logoPosition: string | null;
  quantity: number;
  unitPrice: string | null;
  comment: string | null;
  productName?: string;
  productImage?: string | null;
}

export interface ProposalData {
  id: number;
  title: string;
  status: string;
  notes: string | null;
  validDays: number;
  sentAt: string | null;
  stripeCheckout: boolean;
  multiDepartment: boolean;
  approvalRouting: string | null;
  fulfillmentRequestedAt: string | null;
  products: ProposalProduct[];
  orderItems: OrderItem[];
  client: {
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
  };
  branding: {
    companyName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

export interface DeptStatus {
  id: number;
  departmentName: string;
  contactName: string | null;
  contactEmail: string | null;
  description: string | null;
  status: string;
  addedBy: string;
  approvedAt: string | null;
  approverName: string | null;
  approverNotes: string | null;
  emailSentAt: string | null;
  rejectionNotes: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────

export const LOGO_URL = "/logo_clean.png";

export const DECORATION_LABELS: Record<string, string> = {
  screen_print: "Screen Print", embroidery: "Embroidery",
  dtg: "DTG", heat_transfer: "Heat Transfer",
  sublimation: "Sublimation", laser_engrave: "Laser Engrave",
};

export const CATEGORY_LABELS: Record<string, string> = {
  apparel: "APPAREL", headwear: "HEADWEAR", bags: "BAGS",
  drinkware: "DRINKWARE", tech: "TECH", writing: "WRITING",
  other: "OTHER",
};

// ── Helpers ───────────────────────────────────────────────────────────

export function getExpirationInfo(validDays: number, sentAt: string | null) {
  if (validDays <= 0) return { expired: false, daysLeft: Infinity };
  const sent = sentAt ? new Date(sentAt) : new Date();
  const expiresAt = new Date(sent.getTime() + validDays * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return { expired: daysLeft <= 0, daysLeft: Math.max(0, daysLeft) };
}
