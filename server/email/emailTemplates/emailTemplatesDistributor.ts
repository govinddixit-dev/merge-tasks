/**
 * emailTemplatesDistributor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lane 1 — MergeTasks → Distributor email templates.
 *
 * Exports:
 *   - buildFulfillmentApprovedEmail()
 *   - buildOrderShippedEmail()
 *   - buildStoreApprovedEmail()
 *   - buildStoreChangesRequestedEmail()
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  MT, buildEmailHtml, formatCurrency,
  type EmailProductCard, type EmailBranding,
} from "./emailTemplateBase";

// ─── buildFulfillmentApprovedEmail ────────────────────────────────────────────

/**
 * Lane 1 — MergeTasks → Distributor
 * Fulfillment Approved email — sent to the distributor when a POC approves
 * and requests fulfillment on a proposal.
 */
export function buildFulfillmentApprovedEmail(opts: {
  distributorName?: string;
  pocName: string;
  clientCompany: string;
  proposalTitle: string;
  proposalTotal?: number;
  pocNotes?: string;
  products?: EmailProductCard[];
  dashboardUrl: string;
  /** Pass distributor branding for Lane 2 (distributor-branded alert to themselves) */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const subject = `✅ Fulfillment Approved — ${opts.proposalTitle}`;

  const html = buildEmailHtml({
    branding: opts.branding ?? { lane: "mergetasks" },
    badge: { text: "Action Required", color: MT.green, bgColor: MT.greenLight },
    headline: "Proposal Approved for Fulfillment",
    subheadline: `${opts.pocName} from ${opts.clientCompany} is ready to go.`,
    bodyParagraphs: [
      `<strong>${opts.pocName}</strong> from <strong>${opts.clientCompany}</strong> has reviewed and approved the proposal. All required department sign-offs have been received and fulfillment has been requested.`,
      opts.pocNotes
        ? `<strong>Client notes:</strong> ${opts.pocNotes}`
        : "No additional notes were provided.",
    ],
    infoCard: {
      title: opts.proposalTitle,
      subtitle: "Fulfillment requested — ready to process",
      accentColor: MT.green,
      bgColor: MT.greenLight,
      meta: [
        ...(opts.proposalTotal != null
          ? [{ label: "Proposal Total", value: formatCurrency(opts.proposalTotal) }]
          : []),
        { label: "Client", value: opts.clientCompany },
        { label: "Approved by", value: opts.pocName },
        {
          label: "Requested",
          value: new Date().toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          }),
        },
      ],
    },
    products: opts.products,
    cta: {
      label: "Open Dashboard to Begin Fulfillment →",
      url: opts.dashboardUrl,
      color: MT.green,
    },
    alertBox: {
      text: "This proposal is now in your fulfillment queue. Log in to your dashboard to review the order details, assign to a supplier, and begin processing.",
      type: "success",
    },
    footerNote:
      "You received this email because a client approved a proposal on your MergeTasks account.",
  });

  return { subject, html };
}

// ─── buildOrderShippedEmail ───────────────────────────────────────────────────

/**
 * Lane 1 — MergeTasks → Distributor
 * Order Shipped / Delivered alert — sent to the distributor when an order
 * status is updated to "shipped" or "delivered".
 */
export function buildOrderShippedEmail(opts: {
  distributorName?: string;
  orderNumber: string;
  clientName?: string;
  storeName?: string;
  trackingNumber?: string;
  carrier?: string;
  status: "shipped" | "delivered";
  products?: EmailProductCard[];
  orderTotal?: number;
  dashboardUrl: string;
  /** Pass distributor branding for Lane 2 */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const isDelivered = opts.status === "delivered";
  const subject = isDelivered
    ? `📦 Order ${opts.orderNumber} Delivered`
    : `🚚 Order ${opts.orderNumber} Has Shipped`;

  const html = buildEmailHtml({
    branding: opts.branding ?? { lane: "mergetasks" },
    badge: {
      text: isDelivered ? "Delivered" : "Shipped",
      color: isDelivered ? MT.green : MT.purple,
      bgColor: isDelivered ? MT.greenLight : MT.purpleGhost,
    },
    headline: isDelivered ? "Order Delivered" : "Order Shipped",
    subheadline: `Order ${opts.orderNumber}${opts.storeName ? ` · ${opts.storeName}` : ""}`,
    bodyParagraphs: [
      isDelivered
        ? `Order <strong>${opts.orderNumber}</strong> has been successfully delivered${opts.clientName ? ` to <strong>${opts.clientName}</strong>` : ""}.`
        : `Order <strong>${opts.orderNumber}</strong> is on its way${opts.clientName ? ` to <strong>${opts.clientName}</strong>` : ""}.`,
    ],
    infoCard: {
      title: `Order ${opts.orderNumber}`,
      subtitle: isDelivered ? "Successfully delivered" : "In transit",
      accentColor: isDelivered ? MT.green : MT.purple,
      bgColor: isDelivered ? MT.greenLight : MT.purpleGhost,
      meta: [
        ...(opts.clientName ? [{ label: "Customer", value: opts.clientName }] : []),
        ...(opts.storeName ? [{ label: "Store", value: opts.storeName }] : []),
        ...(opts.trackingNumber ? [{ label: "Tracking #", value: opts.trackingNumber }] : []),
        ...(opts.carrier ? [{ label: "Carrier", value: opts.carrier }] : []),
        ...(opts.orderTotal != null
          ? [{ label: "Order Total", value: formatCurrency(opts.orderTotal) }]
          : []),
      ],
    },
    products: opts.products,
    cta: {
      label: "View Order Details →",
      url: opts.dashboardUrl,
    },
    footerNote:
      "You received this email because an order status was updated on your MergeTasks account.",
  });

  return { subject, html };
}

// ─── buildStoreApprovedEmail ──────────────────────────────────────────────────

/**
 * Lane 1 — MergeTasks → Distributor
 * Sent when a client approves a store design.
 */
export function buildStoreApprovedEmail(opts: {
  distributorName: string;
  clientCompany: string;
  storeName: string;
  approverName: string;
  clientNotes?: string | null;
  launchUrl?: string | null;
  /** Optional distributor branding — Tier 2. Defaults to MergeTasks (Tier 1). */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const { distributorName, clientCompany, storeName, approverName, clientNotes, launchUrl } = opts;
  const subject = `${clientCompany}'s store has been approved — ready to launch`;
  const html = buildEmailHtml({
    branding: opts.branding ?? { lane: "mergetasks" },
    badge: { text: "Store Approved", color: MT.green, bgColor: MT.greenLight },
    headline: `${clientCompany}'s store has been approved`,
    subheadline: `${approverName} has reviewed and approved the ${storeName} store design.`,
    bodyParagraphs: [
      `Hi <strong>${distributorName}</strong>,`,
      `<strong>${approverName}</strong> approved the <strong>${storeName}</strong> store. It's ready to launch whenever you are.`,
    ],
    ...(clientNotes
      ? { alertBox: { type: "info" as const, text: `<strong>Client note:</strong> ${clientNotes}` } }
      : {}),
    ...(launchUrl ? { cta: { label: "Launch Store →", url: launchUrl } } : {}),
  });
  return { subject, html };
}

// ─── buildStoreChangesRequestedEmail ─────────────────────────────────────────

/**
 * Lane 1 — MergeTasks → Distributor
 * Sent when a client requests changes to a store design.
 */
export function buildStoreChangesRequestedEmail(opts: {
  distributorName: string;
  clientCompany: string;
  storeName: string;
  approverName: string;
  notes: string;
  editUrl?: string | null;
  /** Optional distributor branding — Tier 2. Defaults to MergeTasks (Tier 1). */
  branding?: EmailBranding;
}): { subject: string; html: string } {
  const { distributorName, clientCompany, storeName, approverName, notes, editUrl } = opts;
  const subject = `${clientCompany} requested changes to the ${storeName} store`;
  const html = buildEmailHtml({
    branding: opts.branding ?? { lane: "mergetasks" },
    badge: { text: "Changes Requested", color: MT.amber, bgColor: MT.amberLight },
    headline: `${clientCompany} requested changes`,
    subheadline: `${approverName} has reviewed the ${storeName} store and requested revisions.`,
    bodyParagraphs: [
      `Hi <strong>${distributorName}</strong>,`,
      `<strong>${approverName}</strong> reviewed the <strong>${storeName}</strong> store and asked for the changes below before approving.`,
    ],
    alertBox: { type: "warning" as const, text: `<strong>Requested changes:</strong> ${notes}` },
    ...(editUrl ? { cta: { label: "View & Edit Store →", url: editUrl } } : {}),
  });
  return { subject, html };
}
