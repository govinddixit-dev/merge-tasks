/**
 * tRPC React client — provides typed hooks for calling server procedures.
 *
 * Re-exports the inferred `RouterOutput` type so components can reference
 * procedure return types without importing from the server directly.
 *
 * @module client/lib/trpc
 */
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types for all tRPC procedures — use instead of `as any` casts */
export type RouterOutput = inferRouterOutputs<AppRouter>;
