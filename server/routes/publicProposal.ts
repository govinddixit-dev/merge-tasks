/**
 * publicProposal.ts — Public Proposal API Router (barrel)
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin barrel: composes sub-routers into the single Express router that the
 * server bootstrap mounts via `app.use(publicProposalRouter)`.
 *
 * Sub-modules (all in ./publicProposal/):
 *   publicProposalHelpers.ts     — loadProposalByToken, loadBrandingForProposal
 *   publicProposalView.ts        — GET proposal, GET product detail
 *   publicProposalOrderItems.ts  — order-item CRUD + submit-order
 *   publicProposalApprovals.ts   — department approval flow + /api/approve/:token
 *   publicProposalFulfillment.ts — checkout, edit, override, request-fulfillment
 *
 * Public API (unchanged):
 *   GET  /api/proposals/public/:token
 *   GET  /api/proposals/public/:token/product/:productId
 *   GET  /api/proposals/public/:token/departments
 *   POST /api/proposals/public/:token/departments/forward
 *   GET  /api/approve/:token
 *   POST /api/approve/:token
 *   POST /api/proposals/public/:token/checkout
 *   POST /api/proposals/public/:token/edit
 *   POST /api/proposals/public/:token/request-reapproval
 *   POST /api/proposals/public/:token/override-fulfillment
 *   POST /api/proposals/public/:token/request-fulfillment
 *   POST /api/proposals/public/:token/order-items
 *   PUT  /api/proposals/public/:token/order-items/:itemId
 *   DELETE /api/proposals/public/:token/order-items/:itemId
 *   POST /api/proposals/public/:token/order-items/bulk
 *   DELETE /api/proposals/public/:token/order-items
 *   POST /api/proposals/public/:token/submit-order
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { publicProposalViewRouter } from "./publicProposal/publicProposalView";
import { publicProposalOrderItemsRouter } from "./publicProposal/publicProposalOrderItems";
import { publicProposalApprovalsRouter } from "./publicProposal/publicProposalApprovals";
import { publicProposalFulfillmentRouter } from "./publicProposal/publicProposalFulfillment";

export const publicProposalRouter = Router();

publicProposalRouter.use(publicProposalViewRouter);
publicProposalRouter.use(publicProposalOrderItemsRouter);
publicProposalRouter.use(publicProposalApprovalsRouter);
publicProposalRouter.use(publicProposalFulfillmentRouter);
