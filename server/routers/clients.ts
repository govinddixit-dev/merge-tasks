/**
 * clients.ts — Client Router (Public API Entry Point)
 * ─────────────────────────────────────────────────────────────────────────────
 * Barrel that merges the two sub-routers into a single `clientsRouter`.
 * All consumers import from this file — no changes needed in routers.ts.
 *
 * Sub-modules:
 *   clientsCrud.ts   — list, getById, stats, create, update, delete
 *   clientsAssets.ts — listAssets, uploadAsset, deleteAsset
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { router } from "../_core/trpc";
import { clientsCrudRouter } from "./clientsCrud";
import { clientsAssetsRouter } from "./clientsAssets";

export const clientsRouter = router({
  ...clientsCrudRouter._def.procedures,
  ...clientsAssetsRouter._def.procedures,
});
