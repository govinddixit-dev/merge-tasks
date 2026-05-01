import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiConnections, type InsertApiConnection } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getOrgScope } from "../utils/orgScope";

export const apiConnectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

    return db
      .select()
      .from(apiConnections)
      .where(scope.apiConnections)
      .orderBy(desc(apiConnections.updatedAt));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const rows = await db
        .select()
        .from(apiConnections)
        .where(and(eq(apiConnections.id, input.id), scope.apiConnections))
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "API connection not found" });
      return rows[0];
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        baseUrl: z.string().url(),
        format: z.enum(["rest_json", "rest_xml", "graphql", "soap"]).optional(),
        authType: z.enum(["api_key", "oauth2", "basic_auth", "none"]).optional(),
        credentials: z.record(z.string(), z.string()).optional(),
        fieldMapping: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const scope = getOrgScope(ctx);
      const values: InsertApiConnection = {
        ...scope.stamp,
        name: input.name,
        baseUrl: input.baseUrl,
        format: input.format ?? "rest_json",
        authType: input.authType ?? "api_key",
        credentials: (input.credentials as Record<string, string>) ?? null,
        fieldMapping: (input.fieldMapping as Record<string, string>) ?? null,
        syncStatus: "pending",
      };

      const result = await db.insert(apiConnections).values(values);
      const insertId = result[0].insertId;

      const created = await db.select().from(apiConnections).where(eq(apiConnections.id, insertId)).limit(1);
      return created[0];
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        baseUrl: z.string().url().optional(),
        format: z.enum(["rest_json", "rest_xml", "graphql", "soap"]).optional(),
        authType: z.enum(["api_key", "oauth2", "basic_auth", "none"]).optional(),
        credentials: z.record(z.string(), z.string()).optional(),
        fieldMapping: z.record(z.string(), z.string()).optional(),
        syncStatus: z.enum(["connected", "error", "pending", "never"]).optional(),
        productCount: z.number().optional(),
        status: z.enum(["active", "inactive"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const { id, ...updateData } = input;

      const existing = await db
        .select()
        .from(apiConnections)
        .where(and(eq(apiConnections.id, id), scope.apiConnections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "API connection not found" });

      const setObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) setObj[key] = value;
      }

      if (Object.keys(setObj).length > 0) {
        await db.update(apiConnections).set(setObj).where(and(eq(apiConnections.id, id), scope.apiConnections));
      }

      const updated = await db.select().from(apiConnections).where(eq(apiConnections.id, id)).limit(1);
      return updated[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(apiConnections)
        .where(and(eq(apiConnections.id, input.id), scope.apiConnections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "API connection not found" });

      await db.delete(apiConnections).where(and(eq(apiConnections.id, input.id), scope.apiConnections));
      return { success: true };
    }),

  // Test connection (simulated for MVP)
  testConnection: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(apiConnections)
        .where(and(eq(apiConnections.id, input.id), scope.apiConnections))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "API connection not found" });

      // Actually test the connection by hitting the stored baseUrl
      const conn = existing[0];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const headers: Record<string, string> = { "Accept": "application/json" };
        if (conn.authType === "api_key" && conn.credentials) {
          const creds = typeof conn.credentials === "string" ? JSON.parse(conn.credentials) : conn.credentials;
          if (creds.apiKey) headers["Authorization"] = `Bearer ${creds.apiKey}`;
        } else if (conn.authType === "basic_auth" && conn.credentials) {
          const creds = typeof conn.credentials === "string" ? JSON.parse(conn.credentials) : conn.credentials;
          if (creds.username && creds.password) {
            headers["Authorization"] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
          }
        }
        const res = await fetch(conn.baseUrl, { method: "GET", headers, signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok || res.status === 401 || res.status === 403) {
          // 401/403 means the server is reachable but credentials may be wrong
          const status = res.ok ? "connected" as const : "error" as const;
          await db.update(apiConnections)
            .set({ syncStatus: status, lastSyncAt: new Date() })
            .where(eq(apiConnections.id, input.id));
          return {
            success: res.ok,
            message: res.ok
              ? "Connection test successful"
              : `Server reachable but returned ${res.status} — check credentials`,
          };
        }
        await db.update(apiConnections)
          .set({ syncStatus: "error", lastSyncAt: new Date() })
          .where(eq(apiConnections.id, input.id));
        return { success: false, message: `Server returned HTTP ${res.status}` };
      } catch (err: unknown) {
        await db.update(apiConnections)
          .set({ syncStatus: "error", lastSyncAt: new Date() })
          .where(eq(apiConnections.id, input.id));
        const msg = err instanceof Error ? err.message : "Unknown error";
        return { success: false, message: `Connection failed: ${msg}` };
      }
    }),
});
