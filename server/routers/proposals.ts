/**
 * proposals — Barrel router that composes all proposal sub-routers.
 *
 * Sub-modules:
 *   proposalsCrud.ts      — list, getById, create, update, delete, duplicate
 *   proposalsSend.ts      — send, emailPreview
 *   proposalsCatalog.ts   — getProductCatalogConfig, saveProductCatalogConfig
 *   proposalsVersions.ts  — listVersions, generatePdf, revertToVersion
 *
 * Why the barrel stays:
 *   The appRouter references `proposalsRouter` as a single namespace.
 *   This file merges all sub-routers so the tRPC client sees a flat
 *   `trpc.proposals.*` API — no breaking change for the front-end.
 */
import { router } from "../_core/trpc";
import { proposalsCrudRouter } from "./proposalsCrud";
import { proposalsSendRouter } from "./proposalsSend";
import { proposalsCatalogRouter } from "./proposalsCatalog";
import { proposalsVersionsRouter } from "./proposalsVersions";

export const proposalsRouter = router({
  // ── Core CRUD ─────────────────────────────────────────
  ...proposalsCrudRouter._def.procedures,

  // ── Send & email preview ──────────────────────────────
  ...proposalsSendRouter._def.procedures,

  // ── Catalog variant configuration ─────────────────────
  ...proposalsCatalogRouter._def.procedures,

  // ── Version history & PDF ─────────────────────────────
  ...proposalsVersionsRouter._def.procedures,
});
