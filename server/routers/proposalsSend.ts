/**
 * proposalsSend — Send proposal email and email preview.
 *
 * Procedures: send, emailPreview
 */
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  proposals, proposalProducts, clients, clientContacts, products, virtualProofs,
  emailConnections, distributorProfiles, departmentApprovals, proposalVersions,
  productImprintZones,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "../_core/notification";
import { nanoid } from "nanoid";
import * as nodemailer from "nodemailer";
import { buildProposalEmail, type ProposalEmailProduct, type ProposalEmailBranding } from "../email/proposalEmail";
import { sendEmail } from "../email/mailer";
import { buildUnsubscribeUrl, type UnsubscribeContext } from "../email/unsubscribe";
import { getLogger } from "../utils/logger";
import { getOrgScope } from "../utils/orgScope";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { PROPOSAL_SEND_LIMIT } from "../utils/rateLimiter";
import {
  sendViaGmail, refreshGmailToken,
  sendViaOutlook, refreshOutlookToken,
} from "./email/emailRouterHelpers";

const log = getLogger("proposals:send");

export const proposalsSendRouter = router({
  send: protectedProcedure
    .use(rateLimited("proposals.send", PROPOSAL_SEND_LIMIT))
    .input(z.object({
      id: z.number(),
      origin: z.string().optional(),
      /**
       * Optional list of clientContacts.id values to send this proposal to.
       * When omitted or empty, the send falls back to the client's primary
       * contactEmail so every existing caller keeps working.
       */
      contactIds: z.array(z.number()).optional(),
      departments: z.array(z.object({
        name: z.string(),
        contact: z.string().optional(),
        email: z
          .string()
          .optional()
          .refine(
            (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
            { message: "Invalid email address" },
          ),
        description: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scope = getOrgScope(ctx);

      const existing = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.id), scope.proposals))
        .limit(1);
      if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });

      let viewToken = existing[0].viewToken;
      if (!viewToken) {
        viewToken = nanoid(24);
      }

      const clientRows = await db
        .select()
        .from(clients)
        .where(eq(clients.id, existing[0].clientId))
        .limit(1);
      const client = clientRows[0];

      const ppRows = await db
        .select()
        .from(proposalProducts)
        .where(eq(proposalProducts.proposalId, input.id));

      const productIds = ppRows.map(pp => pp.productId);
      const productRows = productIds.length > 0
        ? await db.select().from(products).where(scope.products)
        : [];
      const productMap = new Map(productRows.map(p => [p.id, p]));

      const proofRows = await db
        .select()
        .from(virtualProofs)
        .where(and(scope.virtualProofs, eq(virtualProofs.proposalId, input.id)));
      const proofByProduct = new Map(proofRows.map(p => [p.productId, p]));

      // Batched zone-label lookup — one query for every line with an
      // imprintZoneId, keyed by id. Map lookup is O(1) in the render loop.
      const zoneIds = ppRows.map(pp => pp.imprintZoneId).filter((v): v is number => v != null);
      const zoneRows = zoneIds.length > 0
        ? await db
          .select({ id: productImprintZones.id, label: productImprintZones.label })
          .from(productImprintZones)
          .where(inArray(productImprintZones.id, zoneIds))
        : [];
      const zoneLabelById = new Map(zoneRows.map(z => [z.id, z.label]));

      const toAbsoluteUrl = (url: string | null | undefined): string | null => {
        if (!url) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        const base = input.origin || process.env.APP_BASE_URL || "";
        return base ? `${base}${url}` : url;
      };

      const emailProducts: ProposalEmailProduct[] = ppRows.map(pp => {
        const prod = productMap.get(pp.productId);
        const proof = proofByProduct.get(pp.productId);
        return {
          name: prod?.name || "Product",
          quantity: pp.quantity ?? 1,
          unitPrice: pp.unitPrice?.toString() || prod?.basePrice?.toString() || null,
          decorationType: pp.decorationType || proof?.decorationMethod || null,
          imageUrl: toAbsoluteUrl(prod?.imageUrl) || null,
          proofImageUrl: toAbsoluteUrl(proof?.proofImageUrl) || null,
          proofStatus: proof?.status || null,
          imprintZone: pp.imprintZoneId != null ? zoneLabelById.get(pp.imprintZoneId) ?? null : null,
        };
      });

      let branding: ProposalEmailBranding = {};
      try {
        const profileRows = await db
          .select()
          .from(distributorProfiles)
          .where(scope.distributorProfiles)
          .limit(1);
        if (profileRows.length > 0) {
          const profile = profileRows[0];
          branding = {
            logoUrl: toAbsoluteUrl(profile.brandLogoUrl) || undefined,
            primaryColor: profile.brandPrimaryColor || undefined,
            secondaryColor: profile.brandSecondaryColor || undefined,
            bannerColor: profile.brandBannerColor || profile.brandPrimaryColor || undefined,
            companyName: profile.brandCompanyName || profile.companyName || undefined,
          };
        }
      } catch (e) {
        log.info("Could not fetch branding, using defaults", e);
      }

      const proposalUrl = input.origin
        ? `${input.origin}/view/proposal/${viewToken}`
        : undefined;

      // Resolve recipients. When the caller supplies contactIds we pull
      // emails from clientContacts (scoped to this client for safety). If
      // nothing resolves, fall back to the legacy primary contactEmail
      // column so existing callers keep working.
      let recipientEmails: string[] = [];
      if (input.contactIds && input.contactIds.length > 0) {
        const contactRows = await db
          .select({ email: clientContacts.email })
          .from(clientContacts)
          .where(and(
            inArray(clientContacts.id, input.contactIds),
            eq(clientContacts.clientId, existing[0].clientId),
          ));
        recipientEmails = Array.from(new Set(
          contactRows
            .map((c) => c.email?.trim() || "")
            .filter((e) => e.length > 0)
        ));
      }
      if (recipientEmails.length === 0 && client?.contactEmail) {
        recipientEmails = [client.contactEmail];
      }

      // Proposal emails are commercial under CASL — each recipient needs
      // their own unsubscribe URL (and suppression-list lookup), so we
      // rebuild the HTML per recipient rather than once up front.
      const buildEmailForRecipient = (recipient: string) => {
        const unsubCtx: UnsubscribeContext = { email: recipient, storeId: null, type: "proposals" };
        const unsubUrl = buildUnsubscribeUrl(unsubCtx);
        const built = buildProposalEmail({
          proposalTitle: existing[0].title,
          clientName: client?.contactName || "",
          clientCompany: client?.companyName || "",
          senderName: ctx.user.name || "",
          senderCompany: branding.companyName || "Your Distributor",
          estimatedValue: existing[0].estimatedValue?.toString() || "0",
          validDays: existing[0].validDays || 30,
          products: emailProducts,
          notes: existing[0].notes || undefined,
          proposalId: input.id,
          proposalUrl,
          branding,
          unsubscribeUrl: unsubUrl,
        });
        return { subject: built.subject, html: built.html, unsubCtx };
      };

      let emailSent = false;
      let emailMethod = "notification";
      const emailFailures: string[] = [];
      let suppressedCount = 0;

      if (recipientEmails.length > 0) {
        // Resolve the connected email account ONCE — it's org-level config.
        const connRows = await db
          .select()
          .from(emailConnections)
          .where(and(scope.emailConnections, eq(emailConnections.status, "connected")))
          .limit(5);
        const defaultConn = connRows.find((c) => c.isDefault) || connRows[0];

        for (const recipient of recipientEmails) {
          const { subject: emailSubject, html: emailHtml, unsubCtx } = buildEmailForRecipient(recipient);
          let sentThisRecipient = false;
          let methodThisRecipient = "";

          try {
            if (defaultConn && defaultConn.provider === "smtp" && defaultConn.smtpHost && defaultConn.smtpPassword) {
              const transporter = nodemailer.createTransport({
                host: defaultConn.smtpHost,
                port: defaultConn.smtpPort ?? 587,
                secure: defaultConn.smtpSecure ?? true,
                auth: {
                  user: defaultConn.smtpUsername || defaultConn.email,
                  pass: defaultConn.smtpPassword,
                },
              });

              await transporter.sendMail({
                from: `"${defaultConn.displayName || branding.companyName || 'Your Distributor'}" <${defaultConn.email}>`,
                to: recipient,
                subject: emailSubject,
                html: emailHtml,
              });

              sentThisRecipient = true;
              methodThisRecipient = `smtp:${defaultConn.email}`;
              log.info(`Email sent via connected SMTP (${defaultConn.email}) to ${recipient}`);
            } else if (defaultConn && (defaultConn.provider === "gmail" || defaultConn.provider === "outlook") && defaultConn.accessToken) {
              const tokenExpiry = defaultConn.tokenExpiresAt ? new Date(defaultConn.tokenExpiresAt).getTime() : 0;
              const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
              const tokenExpired = tokenExpiry < fiveMinFromNow;

              if (tokenExpired && !defaultConn.refreshToken) {
                // Stale access token with no refresh path would 401 and surface
                // as a generic failure. Skip OAuth so Resend runs instead, and
                // flag the connection so the user knows to re-auth.
                log.warn(`OAuth token expired, falling back to Resend (${defaultConn.provider} ${defaultConn.email})`);
                emailFailures.push(`${recipient}: connected OAuth token expired, no refresh token`);
                await db.update(emailConnections).set({ status: "expired" }).where(eq(emailConnections.id, defaultConn.id));
               } else {
                let currentAccessToken = defaultConn.accessToken;
                let refreshFailed = false;
                if (tokenExpired && defaultConn.refreshToken) {
                  try {
                    if (defaultConn.provider === "gmail") {
                      const refreshed = await refreshGmailToken(defaultConn.refreshToken);
                      currentAccessToken = refreshed.access_token;
                      await db.update(emailConnections).set({
                        accessToken: refreshed.access_token,
                        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
                        status: "connected",
                      }).where(eq(emailConnections.id, defaultConn.id));
                    } else {
                      const refreshed = await refreshOutlookToken(defaultConn.refreshToken);
                      currentAccessToken = refreshed.access_token;
                      await db.update(emailConnections).set({
                        accessToken: refreshed.access_token,
                        refreshToken: refreshed.refresh_token, // Outlook rotates refresh tokens
                        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
                        status: "connected",
                      }).where(eq(emailConnections.id, defaultConn.id));
                    }
                    log.info(`Refreshed ${defaultConn.provider} OAuth token for ${defaultConn.email}`);
                  } catch (refreshErr) {
                    // Token refresh failed — mark as expired and fall through to
                    // the Resend fallback rather than aborting the entire send.
                    // The distributor will see a warning in the failure log and
                    // can reconnect their email in Settings → Email.
                    log.warn(`Failed to refresh ${defaultConn.provider} token for ${defaultConn.email}; falling back to Resend:`, refreshErr);
                    await db.update(emailConnections).set({ status: "expired" }).where(eq(emailConnections.id, defaultConn.id));
                    emailFailures.push(`${recipient}: ${defaultConn.provider} token refresh failed — reconnect email in Settings`);
                    // sentThisRecipient remains false → outer block falls through to Resend
                    refreshFailed = true;
                  }
                }
                if (!refreshFailed) {
                  const fromAddress = `"${defaultConn.displayName || branding.companyName || 'Your Distributor'}" <${defaultConn.email}>`;
                  if (defaultConn.provider === "gmail") {
                    await sendViaGmail(currentAccessToken, fromAddress, recipient, emailSubject, emailHtml);
                  } else {
                    await sendViaOutlook(currentAccessToken, recipient, emailSubject, emailHtml);
                  }
                  sentThisRecipient = true;
                  methodThisRecipient = `${defaultConn.provider}:${defaultConn.email}`;
                  log.info(`Email sent via ${defaultConn.provider} OAuth (${defaultConn.email}) to ${recipient}`);
                }
              }
            }
          } catch (emailErr) {
            const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
            emailFailures.push(`${recipient}: connected ${msg}`);
            log.warn(`Connected email send failed for ${recipient}, falling back to Resend:`, emailErr);
          }

          if (!sentThisRecipient) {
            try {
              const result = await sendEmail(
                recipient,
                emailSubject,
                emailHtml,
                branding.companyName || ctx.user.name || "Your Distributor",
                ctx.user.email || undefined,
                undefined,
                unsubCtx,
              );
              if (result.suppressed) {
                log.warn(`Proposal ${input.id}: recipient ${recipient} has unsubscribed; skipping`);
                suppressedCount++;
              } else if (result.sent) {
                sentThisRecipient = true;
                methodThisRecipient = "system_smtp";
                log.info(`Email sent via system SMTP to ${recipient}`);
              } else {
                emailFailures.push(`${recipient}: resend ${result.error ?? "unknown"}`);
                log.error(`System SMTP failed for proposal ${input.id} → ${recipient}: ${result.error}`);
              }
            } catch (smtpErr) {
              const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
              emailFailures.push(`${recipient}: resend-exception ${msg}`);
              log.error(`System SMTP fallback failed for ${recipient}:`, smtpErr);
            }
          }

          if (sentThisRecipient) {
            emailSent = true;
            if (emailMethod === "notification") emailMethod = methodThisRecipient;
          }
        }

        // Do not mark the proposal as "sent" if no recipient accepted the email.
        if (!emailSent) {
          // All recipients on the unsubscribe suppression list gets its own
          // error code so the UI can surface a targeted message rather than
          // a generic "try again".
          if (suppressedCount > 0 && suppressedCount === recipientEmails.length) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: recipientEmails.length === 1
                ? "This contact has unsubscribed from proposal emails. Update the contact or remove them before sending."
                : "All selected contacts have unsubscribed from proposal emails. Update or remove them before sending.",
            });
          }
          log.error(
            `Proposal ${input.id} send failed — all email paths exhausted: ${emailFailures.join("; ")}`,
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Proposal could not be sent — please try again",
          });
        }
      }

      // Delivery confirmed (or no client email on file for a link-only flow).
      // Persist the "sent" status now so DB never diverges from reality.
      await db.transaction(async (tx) => {
        await tx
          .update(proposals)
          .set({ status: "sent", sentAt: new Date(), viewToken })
          .where(eq(proposals.id, input.id));
      });

      try {
        await notifyOwner({
          userId: ctx.user.id,
          organizationId: ctx.organizationId ?? undefined,
          type: "proposal_sent",
          title: `Proposal sent to ${client?.companyName || 'Client'}`,
          content: `Your proposal "${existing[0].title}" was sent to ${client?.companyName || 'Unknown Client'} (${client?.contactEmail || ''}).`,
          actionPath: `/proposals/${input.id}`,
          actionLabel: "View Proposal",
          entityId: input.id,
          entityType: "proposal",
        });
      } catch (e) {
        log.warn("Failed to send notification:", e);
      }

      if (existing[0].multiDepartment && input.departments && input.departments.length > 0) {
        try {
          const existingApprovals = await db
            .select()
            .from(departmentApprovals)
            .where(eq(departmentApprovals.proposalId, input.id));

          if (existingApprovals.length === 0) {
            const tokenExpiresAt = existing[0].approvalLinkExpiryEnabled
              ? new Date(Date.now() + 72 * 60 * 60 * 1000)
              : null;
            for (let i = 0; i < input.departments.length; i++) {
              const dept = input.departments[i];
              await db.insert(departmentApprovals).values({
                proposalId: input.id,
                departmentName: dept.name,
                contactName: dept.contact || null,
                contactEmail: dept.email || null,
                description: dept.description || null,
                status: "pending",
                approvalToken: nanoid(32),
                tokenExpiresAt,
                addedBy: "distributor",
                sortOrder: i,
              });
            }
            log.info(`Created ${input.departments.length} department approval records for proposal ${input.id}`);
          }
        } catch (deptErr) {
          log.warn("Failed to create department approvals:", deptErr);
        }
      }

      const updated = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);

      try {
        const ppRowsV = await db.select().from(proposalProducts).where(eq(proposalProducts.proposalId, input.id));
        const deptRows = await db.select().from(departmentApprovals).where(eq(departmentApprovals.proposalId, input.id));
        await db.insert(proposalVersions).values({
          proposalId: input.id,
          userId: ctx.user.id,
          authorName: ctx.user.name || "Distributor",
          snapshotTitle: updated[0].title,
          snapshotEstimatedValue: updated[0].estimatedValue,
          snapshotStatus: "sent",
          snapshotProductCount: ppRowsV.length,
          snapshotDepartmentCount: deptRows.length,
          changes: [`Proposal sent to ${client?.contactEmail || "client"}`, emailSent ? `Email delivered via ${emailMethod}` : "Email pending"],
          action: "sent",
        });
      } catch (vErr) {
        log.warn("Failed to record version for send:", vErr);
      }

      return { ...updated[0], notificationSent: true, emailSent, emailMethod };
    }),

  emailPreview: protectedProcedure
    .input(
      z.object({
        proposalTitle: z.string(),
        clientName: z.string(),
        clientCompany: z.string(),
        estimatedValue: z.string(),
        validDays: z.number(),
        stripeCheckout: z.boolean().optional(),
        multiDepartment: z.boolean().optional(),
        notes: z.string().optional(),
        products: z.array(
          z.object({
            name: z.string(),
            quantity: z.number(),
            unitPrice: z.string().nullable(),
            decorationType: z.string().nullable(),
            imageUrl: z.string().nullable(),
            proofImageUrl: z.string().nullable(),
            proofStatus: z.string().nullable(),
            imprintZone: z.string().nullable().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const scope = getOrgScope(ctx);
      let branding: ProposalEmailBranding = {};
      if (db) {
        try {
          const profileRows = await db
            .select()
            .from(distributorProfiles)
            .where(scope.distributorProfiles)
            .limit(1);
          if (profileRows.length > 0) {
            const profile = profileRows[0];
            const toAbs = (url: string | null | undefined) => {
              if (!url) return null;
              if (url.startsWith("http://") || url.startsWith("https://")) return url;
              const base = process.env.APP_BASE_URL || "";
              return base ? `${base}${url}` : url;
            };
            branding = {
              logoUrl: toAbs(profile.brandLogoUrl),
              primaryColor: profile.brandPrimaryColor || "#654BF9",
              bannerColor: profile.brandBannerColor || profile.brandPrimaryColor || "#654BF9",
              companyName: profile.brandCompanyName || profile.companyName || "Your Distributor",
            };
          }
        } catch (e) {
          log.info("Could not fetch branding", e);
        }
      }

      const { subject, html } = buildProposalEmail({
        proposalTitle: input.proposalTitle,
        clientName: input.clientName,
        clientCompany: input.clientCompany,
        senderName: ctx.user.name || "",
        senderCompany: branding.companyName || "Your Distributor",
        estimatedValue: input.estimatedValue,
        validDays: input.validDays,
        products: input.products,
        notes: input.notes,
        proposalId: 0,
        proposalUrl: "#preview",
        branding,
      });

      return { subject, html };
    }),
});
