/**
 * stores — Barrel router that composes all store sub-routers.
 *
 * Sub-modules:
 *   storesCrud.ts       — list, getById, getBySlug, create, update, delete
 *   storesCatalog.ts    — assignProducts, uploadBanner, removeProduct, updateStoreProduct
 *   storesAi.ts         — aiOptimize, autoClassifyCatalog, saveEditorChanges, launch
 *   storesApproval.ts   — sendForApproval, getByApprovalToken, approveByToken
 *
 * Why the barrel stays:
 *   The appRouter references `storesRouter` as a single namespace.
 *   This file merges all sub-routers so the tRPC client sees a flat
 *   `trpc.stores.*` API — no breaking change for the front-end.
 */
import { router } from "../_core/trpc";
import { storesCrudRouter } from "./storesCrud";
import { storesCatalogRouter } from "./storesCatalog";
import { storesAiRouter } from "./storesAi";
import { storesApprovalRouter } from "./storesApproval";

export const storesRouter = router({
  // ── Core CRUD & public read ───────────────────────────
  ...storesCrudRouter._def.procedures,

  // ── Catalog / product management ──────────────────────
  ...storesCatalogRouter._def.procedures,

  // ── AI optimization & editor ──────────────────────────
  ...storesAiRouter._def.procedures,

  // ── Client approval workflow ──────────────────────────
  ...storesApprovalRouter._def.procedures,
});
