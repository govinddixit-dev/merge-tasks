/**
 * Phase 8 Item 3 regression guard — stores.update zod schema must NOT
 * accept clientId. The 5c logo-change hook
 * (flagPendingForStoreLogoChange) only fires on stores.logoUrl changes;
 * if a future change makes clientId mutable on the stores.update tRPC
 * procedure, the hook coverage at storesCrud.ts:743 must extend to
 * also fire on clientId changes — see the FUTURE-EXTENSION comment in
 * server/services/webstore-render-orchestrator.ts.
 *
 * If this test fails because clientId was added to the schema, the
 * required follow-up is: extend the hook predicate at storesCrud.ts:743
 * to also fire when setObj.clientId differs from oldStore.clientId, in
 * the SAME PR.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { storesCrudRouter } from "./routers/storesCrud";

// tRPC's runtime layout exposes a sub-router's procedures via
// _def.procedures and each procedure's input zod schemas via _def.inputs.
// Same access pattern as server/departmentApprovals.test.ts.
function getUpdateInputSchema(): z.ZodObject<z.ZodRawShape> {
  const procs = (storesCrudRouter as unknown as {
    _def: { procedures: Record<string, { _def: { inputs: unknown[] } }> };
  })._def.procedures;
  const updateProc = procs.update;
  return updateProc._def.inputs[0] as z.ZodObject<z.ZodRawShape>;
}

describe("stores.update — clientId immutability guard (Phase 8 Item 3)", () => {
  it("update procedure exists on storesCrudRouter", () => {
    const procs = (storesCrudRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procs.update).toBeDefined();
  });

  it("input schema does NOT include clientId — preserves clientId as immutable post-creation", () => {
    const schema = getUpdateInputSchema();
    expect(schema.shape).toBeDefined();
    expect("clientId" in schema.shape).toBe(false);
  });

  it("input schema includes the known-allowed fields — sanity check the introspection", () => {
    const schema = getUpdateInputSchema();
    // Spot-check fields that have always been part of the update API.
    // If tRPC changes its internal layout and the introspection silently
    // walks the wrong object, these would also fail and surface that.
    expect("id" in schema.shape).toBe(true);
    expect("name" in schema.shape).toBe(true);
    expect("logoUrl" in schema.shape).toBe(true);
    expect("primaryColor" in schema.shape).toBe(true);
  });

  it("zod strips clientId from any input that smuggles it in (defense in depth)", () => {
    const schema = getUpdateInputSchema();
    // A caller that forces { id, clientId, name } via `as any` — zod's
    // default object behavior strips unknown keys, so clientId never
    // reaches the mutation handler's setObj construction.
    const parsed = schema.safeParse({ id: 1, clientId: 999, name: "test-store" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("clientId" in parsed.data).toBe(false);
      expect(parsed.data.id).toBe(1);
      expect(parsed.data.name).toBe("test-store");
    }
  });
});
