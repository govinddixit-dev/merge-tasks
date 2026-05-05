import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { waitlist, users } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { eq, sql } from "drizzle-orm";

export const waitlistRouter = router({
  /**
   * Public endpoint — anyone can submit their info to join the waitlist.
   * Saves to DB and notifies the owner.
   */
  join: publicProcedure
    .input(
      z.object({
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().optional(),
        email: z.string().email("Valid email is required"),
        company: z.string().optional(),
        companySize: z.string().optional(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if email already exists
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const existing = await db
        .select()
        .from(waitlist)
        .where(eq(waitlist.email, input.email))
        .limit(1);

      if (existing.length > 0) {
        return {
          success: true,
          alreadyExists: true,
          message: "You're already on the waitlist! We'll be in touch soon.",
        };
      }

      // CR5 fix: catch duplicate key error from race condition (concurrent inserts)
      try {
        await db.insert(waitlist).values({
          firstName: input.firstName,
          lastName: input.lastName || null,
          email: input.email,
          company: input.company || null,
          companySize: input.companySize || null,
          message: input.message || null,
        });
      } catch (err: unknown) {
        // MySQL duplicate entry error code = ER_DUP_ENTRY (1062)
        const isdup = err instanceof Object && (("errno" in err && err.errno === 1062) || ("code" in err && err.code === "ER_DUP_ENTRY"));
        if (isdup) {
          return {
            success: true,
            alreadyExists: true,
            message: "You're already on the waitlist! We'll be in touch soon.",
          };
        }
        throw err;
      }

      // Get total count for the notification
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(waitlist);
      const totalCount = countResult?.count || 0;

      // CR6 fix: dynamically look up the first admin user instead of hardcoded userId: 1
      try {
        const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
        if (admin) {
          await notifyOwner({
            userId: admin.id,
            title: `New Waitlist Signup: ${input.firstName} ${input.lastName || ""}`.trim(),
            content: `**${input.firstName} ${input.lastName || ""}** (${input.email}) just joined the MergeTasks waitlist.\n\nCompany: ${input.company || "Not provided"}\nSize: ${input.companySize || "Not provided"}\nMessage: ${input.message || "None"}\n\n**Total waitlist signups: ${totalCount}**`,
          });
        }
      } catch (_) { /* non-critical */ }

      return {
        success: true,
        alreadyExists: false,
        message: "You're on the waitlist! Redirecting to book your demo...",
      };
    }),

  /**
   * Get current waitlist count (public — used for the scarcity counter on the site).
   */
  count: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { count: 0 };
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlist);
    const count = result?.count || 0;
    return { count, total: count };
  }),
});
