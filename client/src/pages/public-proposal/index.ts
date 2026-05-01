/**
 * public-proposal/index.ts — Barrel re-export for the public proposal
 * view feature folder.
 *
 * Modules:
 *  - publicProposalTypes  — shared types, constants, helpers
 *  - ProposalHeader       — logo, banners, client info, summary card
 *  - ProductDetail        — single product view with image carousel
 *  - ProductCarousel      — horizontal product thumbnail strip
 *  - OrderSummary         — drawer, inline list, floating button
 *  - DepartmentApprovals  — dept list, progress bar, add form
 *  - EditModePanel        — edit controls, qty editor, after-edit panel
 *  - StripeCheckout       — product selection + pay CTA
 *  - FulfillmentSection   — approved banner, dialog, requested banner
 */
export * from "./publicProposalTypes";
export { ProposalHeader } from "./ProposalHeader";
export { ProductDetail } from "./ProductDetail";
export { ProductCarousel } from "./ProductCarousel";
export { OrderDrawer, InlineOrderSummary, FloatingOrderButton } from "./OrderSummary";
export { DepartmentApprovals } from "./DepartmentApprovals";
export { EditModeControls, EditModeBanner, AfterEditPanel } from "./EditModePanel";
export { StripeCheckout } from "./StripeCheckout";
export { FulfillmentSection } from "./FulfillmentSection";
