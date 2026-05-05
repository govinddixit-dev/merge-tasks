-- Add explicit self-signup mode to stores. Replaces the implicit
-- "no domain restrictions = allow all" fallback at storeAuth.ts:130-132
-- with a four-state enum that distributors set consciously.
--
-- Default for NEW stores: 'invite_only' (closed by default — distributor
-- must opt in to broader signup).
--
-- For EXISTING stores: the three UPDATE passes below preserve today's
-- effective behavior so no live user is locked out by the deploy. Order
-- matters — the chained `WHERE selfSignupMode = 'invite_only'` guards
-- ensure each row is matched by exactly one statement.
--
-- ALGORITHM=INSTANT for the ADD COLUMN — same convention as 0096/0098/0099
-- on this 8.4.8 instance.

ALTER TABLE `stores`
  ADD COLUMN `selfSignupMode` ENUM('closed','invite_only','domain_whitelist','open_signup') NOT NULL DEFAULT 'invite_only',
  ALGORITHM=INSTANT;

-- Pass 1 — stores with a non-empty allowedEmailsJson list. The historical
-- code (storeAuth.ts:138-141) treated this list as an OR with domain
-- match; the explicit invite list is the more deliberate signal so we
-- mark these 'invite_only'. A distributor who needs both layers can
-- adjust later via the Phase 7 admin UI.
UPDATE `stores` s
SET s.selfSignupMode = 'invite_only'
WHERE s.allowedEmailsJson IS NOT NULL
  AND JSON_LENGTH(s.allowedEmailsJson) > 0;

-- Pass 2 — stores with at least one storeAllowedDomains row but no
-- allowedEmailsJson entries (i.e. not yet matched by pass 1).
UPDATE `stores` s
SET s.selfSignupMode = 'domain_whitelist'
WHERE s.selfSignupMode = 'invite_only'
  AND (s.allowedEmailsJson IS NULL OR JSON_LENGTH(s.allowedEmailsJson) = 0)
  AND EXISTS (SELECT 1 FROM storeAllowedDomains d WHERE d.storeId = s.id);

-- Pass 3 — everything else: preserve today's any-email behavior.
-- requireAuth=0 stores never gated signup anyway; requireAuth=1 stores
-- with no whitelist are exactly the "open by default" case the
-- 2026-04-27 investigation flagged. Marking them 'open_signup' makes
-- that explicit so a distributor reviewing the column sees it.
UPDATE `stores` s
SET s.selfSignupMode = 'open_signup'
WHERE s.selfSignupMode = 'invite_only'
  AND (s.allowedEmailsJson IS NULL OR JSON_LENGTH(s.allowedEmailsJson) = 0)
  AND NOT EXISTS (SELECT 1 FROM storeAllowedDomains d WHERE d.storeId = s.id);
