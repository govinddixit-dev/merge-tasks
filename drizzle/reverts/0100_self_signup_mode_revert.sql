-- Revert 0100 — drop the selfSignupMode column. Data-lossy (resets all
-- distributor mode choices), but the application falls back to the
-- legacy "any-email when no restrictions" predicate via the existing
-- allowedEmailsJson + storeAllowedDomains tables, so revert does not
-- break logins.
--
-- LIVES IN drizzle/reverts/, NOT drizzle/. scripts/migrate.sh globs
-- drizzle/*.sql non-recursively (see 0099 forward-and-revert incident
-- 2026-04-27 for the lesson learned).
--
-- To apply: invoke directly via the mysql CLI with production
-- credentials, then DELETE the 0100 row from _schema_migrations so a
-- future migrate.sh run does not skip the forward migration on a
-- re-attempted deploy.

ALTER TABLE `stores`
  DROP COLUMN `selfSignupMode`,
  ALGORITHM=INSTANT;
