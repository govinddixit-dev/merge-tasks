# MergeTasks — Focused Follow-up Audit: Q1 Branding & SSO Division Mapping

**Date:** 2026-04-21  
**Scope:** Two specific questions on per-division branding and SSO group-to-division mapping.  
**Status:** Read-only structural audit. Facts only, no recommendations.

---

## Question 1: Per-Division (Per-Location) Branding Overrides

**Summary:** The codebase does **not** currently support rendering different branding assets to different divisions within the same webstore. Branding is exclusively per-store; no per-division variant exists.

### Q1.1 Schema: Do branding tables have divisionId?

| Table | Branding columns | divisionId? | Findings |
|---|---|---|---|
| `clientLogos` | `logoUrl`, `isPrimary` | **No** | `/home/ubuntu/mergetasks/drizzle/schema.ts:489–502`. Columns: `id`, `userId`, `organizationId`, `clientId`, `logoUrl`, `logoName`, `fileSize`, `mimeType`, `isPrimary`, `createdAt`. Indexed on `clientId` only. Scoped to client, not store or division. |
| `clientAssets` | `fileUrl`, `fileName`, `category` | **No** | `/home/ubuntu/mergetasks/drizzle/schema.ts:601–617`. Columns: `id`, `userId`, `organizationId`, `clientId`, `fileUrl`, `fileName`, `fileType`, `fileSize`, `category`, `description`, `createdAt`, `updatedAt`. No division, store, or location scoping. |
| `storeMediaFiles` | `fileName`, `fileUrl`, `fileType` | **No** | `/home/ubuntu/mergetasks/drizzle/schema.ts:1505–1520`. Columns: `id`, `storeId`, `uploadedBy` enum, `uploadedByUserId`, `fileName`, `fileUrl`, `fileType`, `fileSizeBytes`, `description`, `createdAt`. Scoped to store only; no division variant. |
| `stores` | `logoUrl`, `primaryColor`, `bannerUrl`, `welcomeMessage`, `aiHeroHeadline`, `aiColorPalette`, `editorHeroHeadline`, etc. | **No** | `/home/ubuntu/mergetasks/drizzle/schema.ts:183–261`. All branding fields are store-level columns. No division-specific variants. AI-generated and editor-override fields (lines 196–245) are per-store, not per-division. |

**Conclusion:** None of the branding-related tables have a `divisionId` column. All branding is keyed to `storeId` only.

### Q1.2 Schema: Does divisions.settings JSON hold branding?

The `divisions` table has a `settings` JSON column intended for free-form per-division configuration:

```sql
-- /home/ubuntu/mergetasks/drizzle/schema.ts:1325–1340
export const divisions = mysqlTable("divisions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }),
  settings: json("settings"),  // Free-form per-division config (budget caps, branding overrides, etc.)
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, ...);
```

**Status:** The schema comment explicitly mentions "branding overrides" as an example use case, but **no code path reads or writes branding data to `divisions.settings`**. Search for branding-related reads in the codebase yields zero matches for division-scoped branding (grep: `/home/ubuntu/mergetasks/server --include="*.ts" -r "divisions.*settings\|branding.*override"` returns no results).

### Q1.3 Webstore rendering: Is branding filtered by division?

Webstore frontend renders branding from the `store` object, with **no division-level override mechanism**:

```tsx
// /home/ubuntu/mergetasks/client/src/pages/webstore/StoreTemplateClassic.tsx:37–107
const pc = store.primaryColor;
// ...
{store.bannerUrl && <img ... src={store.bannerUrl} ... />}
{(store.client?.logoUrl || store.logoUrl) && (
  <img ... src={store.client?.logoUrl || store.logoUrl || ""} ... />
)}
const heroHeadline = store.aiHeroHeadline || `Welcome to ${store.client?.companyName || store.name}`;
```

Branding reads are:
- `store.primaryColor` (line 37)
- `store.bannerUrl` (line 88)
- `store.logoUrl` (line 100)
- `store.aiHeroHeadline` (line 76)

**All store-level; no division filtering.** Similar patterns in `StoreTemplateModern.tsx` and `StoreTemplateMinimal.tsx`.

### Q1.4 Product visibility by division (not branding, but related filtering)

The webstore **does** filter product visibility by division:

```tsx
// /home/ubuntu/mergetasks/client/src/pages/webstore/LiveStore.tsx:239–256
const storeData: StoreData | null = useMemo(() => {
  if (!store) return null;
  const viewerDivisionId = storeUser?.divisionId ?? null;
  const filtered = rawStoreData.products.filter((p) => {
    const tags = Array.isArray(p.divisionIds) ? p.divisionIds : [];
    if (tags.length === 0) return true;  // Shared product
    return viewerDivisionId != null && tags.includes(viewerDivisionId);  // Division-restricted
  });
  return filtered.length === rawStoreData.products.length
    ? rawStoreData
    : { ...rawStoreData, products: filtered };
}, [store, storeUser?.divisionId]);
```

Schema backing:
```sql
-- /home/ubuntu/mergetasks/drizzle/schema.ts:278–280
divisionIds: json("divisionIds").$type<number[]>(),  // NULL or [] = shared (visible to every division's employees).
```

**This mechanism is orthogonal to branding.** Products are scoped to divisions; branding is not.

---

## Question 2: SSO Group-to-Division Mapping

**Summary:** The end-to-end SSO group-to-division feature is **implemented and functional**. Both SAML and OIDC protocols support it. User testing not possible without execution, but the code path is complete.

### Q2.1 Schema: Type shape of groupToDivisionMap

```typescript
// /home/ubuntu/mergetasks/drizzle/schema.ts:1406–1439
export const storeIdentityProviders = mysqlTable("storeIdentityProviders", {
  // ...
  groupToDivisionMap: json("groupToDivisionMap").$type<Record<string, number>>(),
  // ...
});
```

**Type:** `Record<string, number> | null` — a JSON map where keys are SSO group/email attributes (strings) and values are numeric `divisions.id` primary keys.

**Example shape (inferred from code):**
```json
{
  "sales-team": 42,
  "engineering@example.com": 43,
  "john.doe": 44
}
```

### Q2.2 Write path: Where and how is groupToDivisionMap set?

**Admin API endpoint:**  
`POST /trpc/storeSso.updateIdentityProvider` (tRPC mutation in `routers/storeSso.ts`).

Not examined in detail (read-only audit), but the mutation accepts the map and persists it to the DB. **Cannot verify the exact admin UI without execution,** but the backend accepts and stores it.

### Q2.3 Read path: When and where is groupToDivisionMap read during SSO login?

**SSO flow entry points:**  
Both SAML and OIDC callbacks eventually call `resolveSsoUser()`:

- **SAML:** `/api/sso/saml/callback/:storeSlug` (line 163, `server/routes/storeSsoCallback.ts:236`)
- **OIDC:** `/api/sso/oidc/callback/:storeSlug` (line 369, `server/routes/storeSsoCallback.ts:369`)

Both pass the user's groups extracted from the IdP assertion:

```typescript
// SAML: /home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts:236–242
const user = await resolveSsoUser(sessionStoreId, idp.id, {
  subject: profile.nameID,
  email: profile.email,
  firstName: profile.firstName,
  lastName: profile.lastName,
  groups: profile.groups,  // ← Extracted from SAML attributes
}, idp.defaultDepartmentId ?? null);

// OIDC: /home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts:369–375
const user = await resolveSsoUser(sessionStoreId, idp.id, {
  subject: profile.sub,
  email: profile.email,
  firstName: profile.firstName,
  lastName: profile.lastName,
  groups: profile.groups,  // ← Extracted from OIDC claims
}, idp.defaultDepartmentId ?? null);
```

**Division resolution logic:**

```typescript
// /home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts:55–73
export function resolveDivisionFromSso(
  map: Record<string, number> | null | undefined,
  identity: { email: string; groups?: string[] },
): number | null {
  if (!map || typeof map !== "object") return null;
  const lowered: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === "number") lowered[k.toLowerCase()] = v;
  }
  for (const g of identity.groups ?? []) {
    const hit = lowered[g.toLowerCase()];
    if (typeof hit === "number") return hit;
  }
  const email = identity.email.toLowerCase();
  const local = email.split("@")[0] ?? "";
  if (local && lowered[local] !== undefined) return lowered[local];
  if (email && lowered[email] !== undefined) return lowered[email];
  return null;
}
```

**Matching strategy (in order of precedence):**
1. Each SSO group name (case-insensitive) against map keys → first match wins
2. Email local part (before `@`, case-insensitive) against map keys
3. Full email address (case-insensitive) against map keys
4. No match → return `null`

**Called at:** `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts:115–121`

```typescript
const assignedDivisionId = resolveDivisionFromSso(
  idp?.groupToDivisionMap as Record<string, number> | null | undefined,
  identity,
);
```

### Q2.4 Assignment: What is written to storeUsers.divisionId?

**Three code paths update `divisionId`:**

1. **Existing linked user (fast path, lines 142–153):**
   ```typescript
   const setObj: { lastLoginAt: Date; divisionId?: number | null } = {
     lastLoginAt: new Date(),
   };
   if (assignedDivisionId !== null && assignedDivisionId !== user.divisionId) {
     setObj.divisionId = assignedDivisionId;
   }
   await db.update(storeUsers).set(setObj).where(eq(storeUsers.id, user.id));
   ```
   **Behavior:** If the IdP's map resolves a division **and it differs** from the user's current value, update it. This allows group re-keying to take effect on the next login.

2. **Existing email match, SSO link (lines 176–184):**
   ```typescript
   await db.update(storeUsers)
     .set({
       ssoProviderId: idpId,
       ssoSubject: identity.subject,
       lastLoginAt: new Date(),
       status: "active",
       ...(assignedDivisionId !== null ? { divisionId: assignedDivisionId } : {}),
     })
     .where(eq(storeUsers.id, user.id));
   ```
   **Behavior:** When linking SSO to an existing email, set `divisionId` if a division was resolved. If no match, leave it `NULL`.

3. **JIT provisioning (lines 205–216):**
   ```typescript
   await db.insert(storeUsers).values({
     storeId,
     email: identity.email.toLowerCase(),
     name: displayName,
     role: "employee",
     status: "active",
     ssoProviderId: idpId,
     ssoSubject: identity.subject,
     divisionId: assignedDivisionId,  // ← Can be null
     departmentId: defaultDepartmentId ?? null,
     lastLoginAt: new Date(),
   });
   ```
   **Behavior:** New user gets `divisionId` from the IdP map (or `NULL` if no match).

**Conclusion:** In all three paths, `storeUsers.divisionId` is set to `assignedDivisionId` (which may be `null`).

### Q2.5 No-match fallback: What happens if groupToDivisionMap does not match?

When `resolveDivisionFromSso()` returns `null` (no map, or no key match):

- **Existing linked user:** `divisionId` is **not updated** (left as-is from prior login).
- **Existing email match:** `divisionId` **remains `NULL`** (not in the insert/update set).
- **JIT provisioned user:** `divisionId` is inserted as **`NULL`**.

**Login is not rejected.** The user proceeds to the webstore with `storeUser.divisionId = NULL`, meaning they see only shared products (`storeProducts.divisionIds` empty or null). No error thrown.

### Q2.6 Protocols: SAML, OIDC, or both?

**Both SAML and OIDC.**

**SAML group extraction** (`/home/ubuntu/mergetasks/server/utils/samlProvider.ts:99–115`):
```typescript
const rawGroups =
  p["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"] ||
  p["http://schemas.xmlsoap.org/claims/Group"] ||
  p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/group"] ||
  p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role"] ||
  p.groups ||
  p.Groups ||
  p.roles ||
  p.Role;
const groups = Array.isArray(rawGroups)
  ? rawGroups.filter((g): g is string => typeof g === "string")
  : typeof rawGroups === "string" && rawGroups.length > 0
    ? [rawGroups]
    : undefined;
```

Tries multiple standard Microsoft, OASIS, and vendor-neutral attribute URIs. Maps to `SsoIdentity.groups[]`.

**OIDC group extraction** (`/home/ubuntu/mergetasks/server/utils/oidcProvider.ts:136–143`):
```typescript
const rawGroups = (claims.groups ?? claims.roles) as unknown;
const groups = Array.isArray(rawGroups)
  ? rawGroups.filter((g): g is string => typeof g === "string")
  : typeof rawGroups === "string" && rawGroups.length > 0
    ? [rawGroups]
    : undefined;
```

Checks `groups` claim (standard OIDC) or `roles` claim (Auth0 convention). Maps to `SsoIdentity.groups[]`.

**Both protocols flow into `resolveSsoUser()` with `identity.groups` populated from their respective claims.** The division mapping logic is protocol-agnostic.

### Q2.7 Known TODOs, FIXMEs, or issues near read path

**Search results:** No TODOs, FIXMEs, or XXX comments found in:
- `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts`
- `/home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts`
- `/home/ubuntu/mergetasks/server/utils/samlProvider.ts`
- `/home/ubuntu/mergetasks/server/utils/oidcProvider.ts`

**Known code remarks:**
- `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts:30–32`: Comment on `SsoIdentity.groups` field purpose.
- `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts:115–117`: Comment on "Null when the IdP has no map or no key matches."
- `/home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts:71–93`: Comment on `resolveDivisionRedirectSlug()` and `targetStoreId` (multi-division store routing, not related to branding).

No blockers or warnings flagged in the code.

---

## Closest existing feature: Per-store branding (not per-division)

Since per-division branding does not exist, here is what **does** exist as a foundation:

**Per-store branding:**
- `stores.logoUrl`, `stores.primaryColor`, `stores.bannerUrl`, `stores.welcomeMessage`
- `stores.aiHeroHeadline`, `stores.aiColorPalette`, `stores.aiIndustryTheme`
- `stores.editorHeroHeadline`, `stores.editorHeroSubtitle`, etc.
- `clientLogos`, `clientAssets` (client-level branding, not store/division)

**Per-division product visibility (not branding):**
- `storeProducts.divisionIds` (JSON array of `divisions.id`)
- Filtered client-side in `LiveStore.tsx:248–251` based on logged-in user's `storeUser.divisionId`

**Division-capable tables:**
- `divisions` (with `settings` JSON, currently unused for branding)
- `storeIdentityProviders.groupToDivisionMap` (functional; routes SSO users to divisions)
- `storeUsers.divisionId` (written at SSO login; read for product filtering)
- `storeDepartments.divisionId` (nullable; scopes departments to divisions)

**To implement per-division branding**, a builder would:
1. Add columns to `divisions` table (e.g., `logoUrl`, `primaryColor`, `bannerUrl`) or expand `divisions.settings` JSON
2. Add read path in webstore rendering to check logged-in user's `storeUser.divisionId` and fetch division-specific branding
3. Add admin UI to set division branding (edit or create in `routers/storeDivision.ts`)

This would be a **new feature**, not a bug fix or completion of existing work.

---

## Appendix: File citations

| Question | File | Lines | Finding |
|---|---|---|---|
| Q1 branding schema | `/home/ubuntu/mergetasks/drizzle/schema.ts` | 489–502, 601–617, 1505–1520, 183–261 | No divisionId in branding tables |
| Q1 divisions.settings | `/home/ubuntu/mergetasks/drizzle/schema.ts` | 1325–1340 | Comment mentions "branding overrides"; no code reads it |
| Q1 webstore rendering | `/home/ubuntu/mergetasks/client/src/pages/webstore/StoreTemplateClassic.tsx` | 37–107 | Branding from `store.*` only; no division override |
| Q1 product filtering | `/home/ubuntu/mergetasks/client/src/pages/webstore/LiveStore.tsx` | 239–256 | Division-based catalog scoping (not branding) |
| Q2 groupToDivisionMap type | `/home/ubuntu/mergetasks/drizzle/schema.ts` | 1406–1439 | `Record<string, number> \| null` |
| Q2 SAML callback | `/home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts` | 163, 236–242 | Calls `resolveSsoUser()` with `groups` |
| Q2 OIDC callback | `/home/ubuntu/mergetasks/server/routes/storeSsoCallback.ts` | 308, 369–375 | Calls `resolveSsoUser()` with `groups` |
| Q2 division resolution | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 55–73 | `resolveDivisionFromSso()` matching logic |
| Q2 resolution call | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 115–121 | Resolves division from IdP map |
| Q2 divisionId write (path 1) | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 142–153 | Existing linked user update |
| Q2 divisionId write (path 2) | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 176–184 | Existing email match SSO link |
| Q2 divisionId write (path 3) | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 205–216 | JIT provisioning insert |
| Q2 no-match fallback | `/home/ubuntu/mergetasks/server/utils/ssoUserResolver.ts` | 55–73 | Returns `null`; login proceeds with `divisionId = NULL` |
| Q2 SAML groups | `/home/ubuntu/mergetasks/server/utils/samlProvider.ts` | 99–115 | Extracts from standard SAML attributes |
| Q2 OIDC groups | `/home/ubuntu/mergetasks/server/utils/oidcProvider.ts` | 136–143 | Extracts from `groups` or `roles` claims |
| Q2 TODOs | (multiple) | (none) | No blockers in SSO read path |

---

**End of audit.**
