/**
 * brandingResolver.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for three-tier email branding.
 *
 *   Tier 1 — Platform → Distributor   (MergeTasks branded)
 *   Tier 2 — Distributor → Client/POC (Distributor branded)
 *   Tier 3 — Workstore → End User     (Client/workstore branded)
 *
 * Every outbound email should route through this helper so the correct
 * logo, color, display name, and reply-to are applied automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { distributorProfiles, stores, users } from "../../drizzle/schema";
import { MT, type EmailBranding } from "./emailTemplates/emailTemplateBase";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}

export type EmailTier = 1 | 2 | 3;

export interface ResolvedBranding {
  /** EmailBranding payload ready to pass into buildEmailHtml({ branding }) */
  branding: EmailBranding;
  /** Display name used for the "from" header (e.g. "Acme Distributing") */
  fromName: string;
  /** Optional reply-to address (undefined for Tier 1) */
  replyTo?: string;
}

function toAbsoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.PUBLIC_BASE_URL || "";
  if (!base) return url;
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : `/${url}`);
}

/**
 * Resolve branding for a Tier 1 email — Platform → Distributor.
 * Always MergeTasks branding.
 */
export function resolveTier1(): ResolvedBranding {
  return {
    branding: { lane: "mergetasks" },
    fromName: MT.name,
  };
}

/**
 * Resolve branding for a Tier 2 email — Distributor → Client/POC.
 * Uses the distributor profile's brand* fields with MergeTasks fallback.
 */
export async function resolveTier2(params: {
  distributorUserId?: number | null;
  organizationId?: number | null;
}): Promise<ResolvedBranding> {
  let profile: typeof distributorProfiles.$inferSelect | undefined;

  if (params.distributorUserId) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(distributorProfiles)
      .where(eq(distributorProfiles.userId, params.distributorUserId))
      .limit(1);
    profile = rows[0];
  } else if (params.organizationId) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(distributorProfiles)
      .where(eq(distributorProfiles.organizationId, params.organizationId))
      .limit(1);
    profile = rows[0];
  }

  const companyName =
    profile?.brandCompanyName || profile?.companyName || MT.name;
  const primaryColor = profile?.brandPrimaryColor || MT.purple;
  const logoUrl = toAbsoluteUrl(profile?.brandLogoUrl);

  let replyTo = profile?.senderEmail || undefined;
  if (!replyTo && params.distributorUserId) {
    const db2 = await requireDb();
    const u = await db2.select({ email: users.email }).from(users).where(eq(users.id, params.distributorUserId)).limit(1);
    replyTo = u[0]?.email || undefined;
  }

  return {
    branding: {
      lane: "distributor",
      companyName,
      primaryColor,
      logoUrl,
    },
    fromName: profile?.senderName || companyName,
    replyTo,
  };
}

/**
 * Resolve branding for a Tier 3 email — Workstore → End User.
 * Uses the store's logo, primaryColor, and name. End users should never
 * see MergeTasks or distributor branding in these emails.
 */
export async function resolveTier3(params: {
  storeId: number;
}): Promise<ResolvedBranding> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(stores)
    .where(eq(stores.id, params.storeId))
    .limit(1);
  const store = rows[0];

  const companyName = store?.senderName || store?.name || "Your Store";
  const primaryColor = store?.primaryColor || MT.purple;
  const logoUrl = toAbsoluteUrl(store?.logoUrl);

  return {
    branding: {
      lane: "store",
      companyName,
      primaryColor,
      logoUrl,
    },
    // Display name appears in inboxes as "<Client Name> via MergeTasks"
    fromName: `${companyName} via MergeTasks`,
    replyTo: store?.senderEmail || undefined,
  };
}

/**
 * Generic dispatcher. Prefer the tier-specific helpers above when you know
 * the tier statically — they're clearer. Use this when tier is dynamic.
 */
export async function resolveBranding(input:
  | { tier: 1 }
  | { tier: 2; distributorUserId?: number | null; organizationId?: number | null }
  | { tier: 3; storeId: number }
): Promise<ResolvedBranding> {
  if (input.tier === 1) return resolveTier1();
  if (input.tier === 2) return resolveTier2(input);
  return resolveTier3(input);
}
