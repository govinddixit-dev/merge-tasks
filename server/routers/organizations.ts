/**
 * Organizations Router
 *
 * Handles all multi-tenancy operations:
 *   - Creating and managing organizations
 *   - Inviting team members by email
 *   - Accepting invites via token
 *   - Managing member roles (owner, admin, member)
 *   - Removing members
 *   - Switching active organization context
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { organizations, orgMembers, users } from "../../drizzle/schema";
import { randomBytes } from "crypto";
import { sendEmail } from "../email/mailer";
import { getLogger } from "../utils/logger";
import { generateOrgExternalId } from "../utils/externalCustomerId";

const log = getLogger("organizations");

//  Helpers 

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

async function getOrgOrThrow(db: Awaited<ReturnType<typeof getDb>>, orgId: number, userId: number) {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [member] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  return member;
}

//  Router 

export const organizationsRouter = router({

  /**
   * List all organizations the current user belongs to.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        ownerId: organizations.ownerId,
        role: orgMembers.role,
        createdAt: organizations.createdAt,
        aiApprovalLevel: organizations.aiApprovalLevel,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
      .where(eq(orgMembers.userId, ctx.user.id));

    return rows;
  }),

  /**
   * Get a single organization with its members list.
   * Only accessible to members of the org.
   */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await getOrgOrThrow(db, input.id, ctx.user.id);

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id))
        .limit(1);

      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });

      const members = await db
        .select({
          id: orgMembers.id,
          userId: orgMembers.userId,
          role: orgMembers.role,
          inviteEmail: orgMembers.inviteEmail,
          inviteAcceptedAt: orgMembers.inviteAcceptedAt,
          createdAt: orgMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(orgMembers)
        .leftJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.organizationId, input.id));

      return { ...org, members };
    }),

  /**
   * Create a new organization. The creating user becomes the owner.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const baseSlug = generateSlug(input.name);
      let slug = baseSlug;
      let result: import("../db/types").MysqlInsertResult | undefined;

      // Retry with suffix on duplicate slug (race-safe via unique constraint)
      const MAX_SLUG_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
        try {
          [result] = await db.insert(organizations).values({
            name: input.name,
            slug,
            ownerId: ctx.user.id,
          });
          break;
        } catch (err: unknown) {
          if (err instanceof Object && "code" in err && err.code === "ER_DUP_ENTRY" && err instanceof Error && err.message?.includes("slug")) {
            slug = `${baseSlug}-${attempt + 1}`;
            continue;
          }
          throw err;
        }
      }
      if (!result) {
        throw new TRPCError({ code: "CONFLICT", message: "Could not generate unique slug" });
      }

      const orgId = result.insertId;

      // Auto-populate externalCustomerId for PSRESTful Sub-Accounts routing.
      await db.update(organizations)
        .set({ externalCustomerId: generateOrgExternalId(orgId) })
        .where(eq(organizations.id, orgId));

      // Add creator as owner member
      await db.insert(orgMembers).values({
        organizationId: orgId,
        userId: ctx.user.id,
        role: "owner",
      });

      log.info(`User ${ctx.user.id} created organization ${orgId} (${slug})`);

      return { id: orgId, slug, name: input.name };
    }),

  /**
   * Update organization name.
   * Only owners and admins can update.
   */
  update: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const member = await getOrgOrThrow(db, input.id, ctx.user.id);
      if (member.role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can update the organization" });
      }

      await db
        .update(organizations)
        .set({ name: input.name })
        .where(eq(organizations.id, input.id));

      return { success: true };
    }),

  /**
   * Update organization AI approval level and other settings.
   * Only owners and admins can update.
   */
  updateSettings: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      aiApprovalLevel: z.enum(["all_auto", "review_auto", "all_review"]).optional(),
      /**
       * Default tax rate as a fraction (0.0000 – 1.0000). Pass null to clear.
       * 0 means "tax-exempt"; a nullable value means "unset — inherit store-level".
       */
      defaultTaxRate: z
        .union([z.number().min(0).max(1), z.null()])
        .optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const member = await getOrgOrThrow(db, input.organizationId, ctx.user.id);
      if (member.role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can update organization settings" });
      }

      const patch: Record<string, unknown> = {};
      if (input.aiApprovalLevel !== undefined) patch.aiApprovalLevel = input.aiApprovalLevel;
      if (input.defaultTaxRate !== undefined) {
        patch.defaultTaxRate = input.defaultTaxRate === null
          ? null
          : input.defaultTaxRate.toFixed(4);
      }
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No settings fields provided to update.",
        });
      }

      await db
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, input.organizationId));

      return { success: true };
    }),

  /**
   * Invite a user to the organization by email.
   * Sends an invite email with a unique token link.
   * Only owners and admins can invite.
   */
  invite: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      email: z.string().email(),
      role: z.enum(["admin", "member"]).default("member"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const member = await getOrgOrThrow(db, input.organizationId, ctx.user.id);
      if (member.role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can invite members" });
      }

      // Check if already a member
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existingUser) {
        const [existingMember] = await db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, input.organizationId),
            eq(orgMembers.userId, existingUser.id)
          ))
          .limit(1);
        if (existingMember) {
          throw new TRPCError({ code: "CONFLICT", message: "This user is already a member of the organization" });
        }
      }

      const token = generateInviteToken();

      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);

      const [inviter] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      // Create pending invite record
      await db.insert(orgMembers).values({
        organizationId: input.organizationId,
        userId: existingUser?.id ?? null,
        role: input.role,
        invitedByUserId: ctx.user.id,
        inviteEmail: input.email,
        inviteToken: token,
      });

      // Send invite email
      const appUrl = process.env.APP_BASE_URL || "https://app.mergetasks.com";
      const inviteUrl = `${appUrl}/accept-invite?token=${token}`;
      const inviterName = inviter?.name || inviter?.email || "A team member";
      const orgName = org?.name || "MergeTasks";

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited to join ${orgName} on MergeTasks</h2>
          <p>${inviterName} has invited you to join their team on MergeTasks as a <strong>${input.role}</strong>.</p>
          <p>Click the button below to accept the invitation and get started:</p>
          <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0;">
            Accept Invitation
          </a>
          <p style="color: #666; font-size: 14px;">This invitation link expires in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
          <div style="text-align:center;padding:20px 0 10px;border-top:1px solid #e5e7eb;margin-top:30px;">
            <span style="color:#9ca3af;font-size:12px;">Powered by <a href="https://mergetasks.com" style="color:#6b7280;text-decoration:none;font-weight:500;">MergeTasks</a></span>
          </div>
        </div>
      `;

      // Invite email is non-critical: the invite record exists and the owner
      // can resend. But we must never drop the failure on the floor — log it
      // visibly so ops can see delivery problems. Two failure surfaces:
      //   1. sendEmail() returns { sent: false, error } on Resend API errors
      //   2. unexpected exceptions in the mailer module itself
      let emailDelivered = false;
      let emailError: string | undefined;
      try {
        const result = await sendEmail(
          input.email,
          `You're invited to join ${orgName} on MergeTasks`,
          html,
          "MergeTasks",
        );
        if (result.sent) {
          emailDelivered = true;
          log.info(`Invite sent to ${input.email} for org ${input.organizationId}`);
        } else {
          emailError = result.error;
          log.error(
            `Failed to send invite email to ${input.email} for org ${input.organizationId}: ${result.error}`,
          );
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        log.error(
          `Exception sending invite email to ${input.email} for org ${input.organizationId}:`,
          err,
        );
      }

      return { success: true, token, emailDelivered, emailError };
    }),

  /**
   * Accept an invite via token.
   * Can be called by an authenticated user or during sign-up.
   */
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [invite] = await db
        .select()
        .from(orgMembers)
        .where(eq(orgMembers.inviteToken, input.token))
        .limit(1);

      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already used" });
      if (invite.inviteAcceptedAt) throw new TRPCError({ code: "CONFLICT", message: "Invite already accepted" });

      // S21: Enforce 7-day invite expiry (the email says "expires in 7 days")
      const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
      if (invite.createdAt && Date.now() - new Date(invite.createdAt).getTime() > INVITE_TTL_MS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has expired. Please ask the organization owner to send a new one." });
      }

      // Update the invite record to link to the accepting user
      await db
        .update(orgMembers)
        .set({
          userId: ctx.user.id,
          inviteToken: null,
          inviteAcceptedAt: new Date(),
        })
        .where(eq(orgMembers.id, invite.id));

      log.info(`User ${ctx.user.id} accepted invite to org ${invite.organizationId}`);

      return { organizationId: invite.organizationId, role: invite.role };
    }),

  /**
   * Update a member's role.
   * Only the owner can change roles. Owners cannot demote themselves.
   */
  updateMemberRole: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      memberId: z.number(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const callerMember = await getOrgOrThrow(db, input.organizationId, ctx.user.id);
      if (callerMember.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can change member roles" });
      }

      await db
        .update(orgMembers)
        .set({ role: input.role })
        .where(and(
          eq(orgMembers.id, input.memberId),
          eq(orgMembers.organizationId, input.organizationId)
        ));

      return { success: true };
    }),

  /**
   * Remove a member from the organization.
   * Owners and admins can remove members. Owners cannot remove themselves.
   */
  removeMember: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      memberId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const callerMember = await getOrgOrThrow(db, input.organizationId, ctx.user.id);
      if (callerMember.role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can remove members" });
      }

      const [targetMember] = await db
        .select()
        .from(orgMembers)
        .where(and(
          eq(orgMembers.id, input.memberId),
          eq(orgMembers.organizationId, input.organizationId)
        ))
        .limit(1);

      if (!targetMember) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (targetMember.userId === ctx.user.id && targetMember.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owners cannot remove themselves. Transfer ownership first." });
      }

      await db
        .delete(orgMembers)
        .where(and(
          eq(orgMembers.id, input.memberId),
          eq(orgMembers.organizationId, input.organizationId)
        ));

      return { success: true };
    }),

  /**
   * Leave an organization (self-removal).
   * Owners must transfer ownership before leaving.
   */
  leave: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const member = await getOrgOrThrow(db, input.organizationId, ctx.user.id);
      if (member.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owners cannot leave. Transfer ownership or delete the organization." });
      }

      await db
        .delete(orgMembers)
        .where(and(
          eq(orgMembers.organizationId, input.organizationId),
          eq(orgMembers.userId, ctx.user.id)
        ));

      return { success: true };
    }),

  /**
   * Get invite details by token (public — used on the accept-invite page before login).
   */
  getInviteByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [invite] = await db
        .select({
          id: orgMembers.id,
          organizationId: orgMembers.organizationId,
          inviteEmail: orgMembers.inviteEmail,
          role: orgMembers.role,
          inviteAcceptedAt: orgMembers.inviteAcceptedAt,
          orgName: organizations.name,
        })
        .from(orgMembers)
        .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
        .where(eq(orgMembers.inviteToken, input.token))
        .limit(1);

      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or expired" });

      return invite;
    }),
});
