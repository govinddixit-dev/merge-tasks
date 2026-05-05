/**
 * tRPC initialization — creates the tRPC instance, middleware, and
 * base procedure builders (`publicProcedure`, `protectedProcedure`).
 *
 * All routers import `router` and procedure builders from this module.
 * Input sanitization middleware is applied globally.
 *
 * @module server/_core/trpc
 */
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { createSanitizeMiddleware } from "../utils/sanitizeMiddleware";

export const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

/**
 * Base procedure — all inputs are automatically sanitized (XSS, null bytes, length cap).
 * Both publicProcedure and protectedProcedure inherit this.
 */
// Create sanitize middleware AFTER t is initialized to avoid circular dependency
const sanitizeInputs = createSanitizeMiddleware(t);
const baseProcedure = t.procedure.use(sanitizeInputs);

export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = baseProcedure.use(requireUser);

/**
 * orgProcedure — requires an authenticated user AND a resolved organizationId.
 *
 * Use this for every query/mutation that reads or writes org-scoped data.
 * The organizationId is set by createContext() from the `x-org-id` header
 * after verifying the caller is a member of that org, so any procedure using
 * this middleware can trust ctx.organizationId to be a safely-scoped value.
 *
 * Procedures that don't use orgProcedure must perform their own org filter
 * in the DB query — see docs/security-audit-multitenant.md for the pattern.
 */
export const orgProcedure = protectedProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No active organization selected for this session.",
      });
    }
    return next({
      ctx: { ...ctx, organizationId: ctx.organizationId },
    });
  }),
);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
