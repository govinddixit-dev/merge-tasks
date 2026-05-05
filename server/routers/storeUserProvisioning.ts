/**
 * storeUserProvisioning.ts  — thin barrel
 * ─────────────────────────────────────────────────────────────────────────────
 * Assembles the storeUserProvisioningRouter by spreading the auth and management
 * sub-routers, and re-exports provisionStoreUser for use by other routers.
 *
 * Sub-modules:
 *   ./storeUserProvisioning/storeUserProvisioningHelpers    — shared utilities
 *   ./storeUserProvisioning/storeUserProvisioningAuth       — public auth flows
 *   ./storeUserProvisioning/storeUserProvisioningManagement — distributor CRUD
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { router } from "../_core/trpc";
import { storeUserProvisioningAuthRouter } from "./storeUserProvisioning/storeUserProvisioningAuth";
import { storeUserProvisioningManagementRouter } from "./storeUserProvisioning/storeUserProvisioningManagement";

export { provisionStoreUser } from "./storeUserProvisioning/storeUserProvisioningHelpers";

export const storeUserProvisioningRouter = router({
  // ── Public auth procedures ─────────────────────────────────────────────────
  ...storeUserProvisioningAuthRouter._def.procedures,

  // ── Protected management procedures ───────────────────────────────────────
  ...storeUserProvisioningManagementRouter._def.procedures,
});
