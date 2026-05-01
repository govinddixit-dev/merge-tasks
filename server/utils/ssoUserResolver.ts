/**
 * SSO User Resolver — Just-In-Time (JIT) Provisioning
 *
 * Resolves an SSO-authenticated identity to a storeUser record:
 *   1. If a storeUser with matching ssoProviderId + ssoSubject exists → return it
 *   2. If a storeUser with matching email exists → link SSO identity and return it
 *   3. Otherwise → auto-create a new storeUser with role "employee"
 *
 * Also enforces domain-based access control and checks for suspended accounts.
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { storeUsers, storeIdentityProviders } from "../../drizzle/schema";
import { getLogger } from "./logger";
import { auditLog } from "./auditLog";
import type { AuditAction } from "./auditLog";

const log = getLogger("ssoUserResolver");

export interface SsoIdentity {
  /** The IdP's unique subject identifier (SAML nameID or OIDC sub) */
  subject: string;
  /** The user's email from the IdP assertion */
  email: string;
  /** Optional first name */
  firstName?: string;
  /** Optional last name */
  lastName?: string;
  /** Optional list of group/role names carried in the IdP assertion. Used
   *  for location auto-assignment via storeIdentityProviders.groupToLocationMap. */
  groups?: string[];
}

export interface ResolvedStoreUser {
  id: number;
  storeId: number;
  email: string;
  name: string | null;
  role: string;
  department: string | null;
  spendingLimit: string | null;
  pointsBalance: number;
}

/**
 * Resolve an SSO identity to a storeUser, creating one if necessary.
 * Throws if the user is suspended or the domain is not authorized.
 */
export async function resolveSsoUser(
  storeId: number,
  idpId: number,
  identity: SsoIdentity,
  defaultDepartmentId?: number | null,
): Promise<ResolvedStoreUser> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // 0. Enforce IdP domain match — reject assertions where the email domain
  //    does not match the configured IdP domain. Prevents a compromised IdP
  //    from minting assertions for unrelated email domains.
  const [idp] = await db
    .select({
      domain: storeIdentityProviders.domain,
      groupToLocationMap: storeIdentityProviders.groupToLocationMap,
    })
    .from(storeIdentityProviders)
    .where(eq(storeIdentityProviders.id, idpId))
    .limit(1);
  if (idp?.domain) {
    const emailDomain = identity.email.toLowerCase().split("@")[1] ?? "";
    const expected = idp.domain.toLowerCase().trim();
    if (expected && emailDomain !== expected) {
      auditLog({
        action: "sso.login.failed" as AuditAction,
        // No userId at this point — domain mismatch happens before we
        // resolve an account. AuditEvent.userId is `number | null`.
        userId: null,
        description: `SSO domain mismatch: expected ${expected}, got ${emailDomain}`,
        metadata: { storeId, idpId, email: identity.email, emailDomain, expected },
      });
      throw new Error(`Email domain ${emailDomain} is not authorized for this identity provider.`);
    }
  }

  // Pick the group to persist on the user row: prefer one that has a
  // location mapping so the health indicator doesn't flag it as unmapped,
  // otherwise fall back to the first group in the assertion.
  const mapped = (idp?.groupToLocationMap ?? {}) as Record<string, number>;
  const ssoGroup =
    identity.groups?.find((g) => Object.prototype.hasOwnProperty.call(mapped, g))
    ?? identity.groups?.[0]
    ?? null;
  // Map the chosen group to a locationId; null when unmapped / no groups.
  // Applied only on JIT creation (step 3) — existing users are left
  // untouched and will be updated on next login naturally.
  const mappedLocationId = ssoGroup && Object.prototype.hasOwnProperty.call(mapped, ssoGroup)
    ? (mapped[ssoGroup] ?? null)
    : null;

  // 1. Try to find by SSO identity link (fastest path)
  const byIdentity = await db
    .select()
    .from(storeUsers)
    .where(and(
      eq(storeUsers.storeId, storeId),
      eq(storeUsers.ssoProviderId, idpId),
      eq(storeUsers.ssoSubject, identity.subject),
    ))
    .limit(1);

  if (byIdentity.length > 0) {
    const user = byIdentity[0];
    if (user.deletedAt) {
      throw new Error("This account has been deactivated. Contact your administrator.");
    }
    if (user.status === "suspended") {
      throw new Error("Your account has been suspended. Contact your administrator.");
    }
    await db.update(storeUsers)
      .set({ lastLoginAt: new Date(), ssoGroup })
      .where(eq(storeUsers.id, user.id));

    log.info(`SSO login: existing linked user ${user.email} (store ${storeId})`);
    return toResolved(user);
  }

  // 2. Try to find by email (link existing account)
  const byEmail = await db
    .select()
    .from(storeUsers)
    .where(and(
      eq(storeUsers.storeId, storeId),
      eq(storeUsers.email, identity.email.toLowerCase()),
    ))
    .limit(1);

  if (byEmail.length > 0) {
    const user = byEmail[0];
    if (user.deletedAt) {
      throw new Error("This account has been deactivated. Contact your administrator.");
    }
    if (user.status === "suspended") {
      throw new Error("Your account has been suspended. Contact your administrator.");
    }
    // Link SSO identity to existing account.
    await db.update(storeUsers)
      .set({
        ssoProviderId: idpId,
        ssoSubject: identity.subject,
        ssoGroup,
        lastLoginAt: new Date(),
        status: "active",
      })
      .where(eq(storeUsers.id, user.id));

    log.info(`SSO login: linked SSO to existing user ${user.email} (store ${storeId})`);
    auditLog({
      action: "sso.account.linked",
      userId: user.id,
      description: `SSO identity linked to existing user ${user.email} (store ${storeId})`,
      metadata: { email: user.email, idpId, subject: identity.subject, storeId },
    });

    return toResolved({
      ...user,
      ssoProviderId: idpId,
      ssoSubject: identity.subject,
    });
  }

  // 3. JIT provisioning — create new store user
  const displayName = [identity.firstName, identity.lastName].filter(Boolean).join(" ") || null;

  await db.insert(storeUsers).values({
    storeId,
    email: identity.email.toLowerCase(),
    name: displayName,
    role: "employee",
    status: "active",
    ssoProviderId: idpId,
    ssoSubject: identity.subject,
    ssoGroup,
    locationId: mappedLocationId,
    departmentId: defaultDepartmentId ?? null,
    lastLoginAt: new Date(),
  });

  // Fetch the newly created user
  const newUser = await db
    .select()
    .from(storeUsers)
    .where(and(
      eq(storeUsers.storeId, storeId),
      eq(storeUsers.email, identity.email.toLowerCase()),
    ))
    .limit(1);

  if (newUser.length === 0) {
    throw new Error("Failed to create store user during SSO provisioning");
  }

  log.info(`SSO login: JIT provisioned new user ${identity.email} (store ${storeId})`);
    auditLog({
      action: "sso.user.provisioned",
      userId: newUser[0].id,
      description: `SSO JIT provisioned new user ${identity.email} (store ${storeId})`,
      metadata: { email: identity.email, idpId, subject: identity.subject, role: "employee", storeId },
    });

  return toResolved(newUser[0]);
}

/** Map a raw storeUser row to the resolved shape */
function toResolved(user: typeof storeUsers.$inferSelect): ResolvedStoreUser {
  return {
    id: user.id,
    storeId: user.storeId,
    email: user.email,
    name: user.name,
    role: user.role,
    department: user.department,
    spendingLimit: user.spendingLimit,
    pointsBalance: user.pointsBalance ?? 0,
  };
}
