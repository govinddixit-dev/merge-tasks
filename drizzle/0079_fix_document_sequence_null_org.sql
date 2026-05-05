-- 0079_fix_document_sequence_null_org.sql
-- Permanent fix for solo-user document-number collisions in documentSequences.
--
-- Root cause: the existing unique index on
-- documentSequences(organizationId, userId, docType) treats NULL as distinct
-- (MySQL semantics), so every `INSERT ... ON DUPLICATE KEY UPDATE` from a solo
-- user (organizationId IS NULL) takes the INSERT path instead of UPDATE. The
-- result is duplicate sequence rows stuck at the same nextNumber, causing every
-- solo-created estimate / PO / invoice to be handed back the same number
-- (EST-1001, INV-1001, ...).
--
-- Fix: add a STORED generated column `orgKey = COALESCE(organizationId, 0)` and
-- move the unique index onto (orgKey, userId, docType). Generated columns are
-- never NULL, so uniqueness is enforced uniformly for both team
-- (organizationId = N → orgKey = N) and solo (organizationId = NULL →
-- orgKey = 0) users. Team uniqueness behaviour is byte-for-byte identical.
--
-- This migration also collapses existing duplicate documentSequences rows
-- inline (section 2). Without this, ADD UNIQUE KEY in section 5 would fail
-- with ER_DUP_ENTRY. The collapse is scoped to `organizationId IS NULL`
-- rows only (solo-user rows — the sole population affected by the NULL-
-- distinct bug). Team rows (organizationId IS NOT NULL) are never read or
-- written by section 2, so team-side sequences are guaranteed untouched.
-- The collapse touches only internal counter rows — no estimate / PO /
-- invoice / external reference is modified here. Renumbering of affected
-- document rows is handled separately by an audited script with an
-- external-reference gate.
--
-- Section 3 adds a non-unique index `docseq_organizationId_idx` on
-- (organizationId) BEFORE the old unique composite index is dropped in
-- section 4. This is required because InnoDB uses the old unique index as
-- the backing index for FK `docseq_org_fk` (organizationId → organizations.id).
-- Without the new plain index, DROP INDEX fails with ER_DROP_INDEX_FK (1553).
-- The new unique index added in section 5 is on (orgKey, userId, docType) —
-- its leading column is the GENERATED `orgKey`, not `organizationId`, so it
-- cannot back the FK.
--
-- Zero-regression: the FK on organizationId is unchanged; orgKey is derived
-- and cannot be written directly. MAX(nextNumber) is preserved per scope
-- during collapse so no in-flight numbers are lost.
--
-- Idempotent: re-running on environments that already have the new columns
-- / indexes, or that have no duplicates to collapse, is a no-op. All
-- changes are guarded via information_schema lookups.

-- 1. Add orgKey generated column (idempotent)
SET @has_orgkey := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'documentSequences'
    AND COLUMN_NAME = 'orgKey'
);
SET @add_col_sql := IF(
  @has_orgkey = 0,
  'ALTER TABLE `documentSequences` ADD COLUMN `orgKey` INT GENERATED ALWAYS AS (COALESCE(`organizationId`, 0)) STORED AFTER `organizationId`',
  'DO 0'
);
PREPARE stmt FROM @add_col_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Acquire a session-level exclusive write lock on documentSequences so
-- sections 2–5 execute without interleaved concurrent INSERT / UPDATE /
-- DELETE on this table. Released by UNLOCK TABLES after section 5.
--
-- Safety notes:
--   * MySQL 8.x permits information_schema reads while LOCK TABLES is held
--     (verified empirically against this DB), so the idempotency guards in
--     sections 3–5 still function.
--   * DDL under LOCK TABLES on the locked table is supported; the implicit
--     commit from ALTER / CREATE / DROP does NOT release LOCK TABLES.
--   * The `ds` alias used by the UPDATE / DELETE in section 2 must be
--     locked explicitly alongside the base table: MySQL requires every
--     alias reference to appear in the LOCK TABLES list or the statement
--     fails with ER_TABLE_NOT_LOCKED (1100).
--   * Without this lock a concurrent INSERT between section 2 and
--     section 5 could reintroduce a duplicate (orgKey, userId, docType),
--     causing ADD UNIQUE KEY to fail with ER_DUP_ENTRY.
LOCK TABLES documentSequences WRITE, documentSequences AS ds WRITE;

-- 2. Collapse existing duplicates so ADD UNIQUE KEY in section 5 succeeds.
-- SCOPED EXPLICITLY TO `organizationId IS NULL` ROWS ONLY — the only
-- population affected by the NULL-distinct index bug. Team rows
-- (organizationId IS NOT NULL) are never read or written by this section.
--
-- For each (userId, docType) in the solo-user scope with >1 row, keep the
-- row with the highest id and set its nextNumber to MAX(nextNumber) across
-- the group; delete the others.
--
-- Both statements are no-ops when no solo-user duplicates exist
-- (HAVING COUNT(*) > 1 yields an empty derived table).

UPDATE documentSequences ds
  JOIN (
    SELECT MAX(id) AS keep_id, MAX(nextNumber) AS max_next
    FROM documentSequences
    WHERE organizationId IS NULL
    GROUP BY userId, docType
    HAVING COUNT(*) > 1
  ) g ON ds.id = g.keep_id
  SET ds.nextNumber = g.max_next;

DELETE ds FROM documentSequences ds
  JOIN (
    SELECT userId, docType, MAX(id) AS keep_id
    FROM documentSequences
    WHERE organizationId IS NULL
    GROUP BY userId, docType
    HAVING COUNT(*) > 1
  ) g ON ds.organizationId IS NULL
     AND ds.userId = g.userId
     AND ds.docType = g.docType
     AND ds.id <> g.keep_id;

-- 3. Add a non-unique FK-backing index on (organizationId) (idempotent).
-- Required before section 4 because InnoDB uses the old unique composite
-- index as the backing index for FK docseq_org_fk. Dropping it without an
-- alternative backing index fails with ER_DROP_INDEX_FK (1553). The new
-- unique index added in section 5 leads with the GENERATED `orgKey`, not
-- `organizationId`, so it cannot serve as the FK backing index.
SET @has_orgid_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'documentSequences'
    AND INDEX_NAME = 'docseq_organizationId_idx'
);
SET @add_orgid_idx_sql := IF(
  @has_orgid_idx = 0,
  'ALTER TABLE `documentSequences` ADD INDEX `docseq_organizationId_idx` (`organizationId`)',
  'DO 0'
);
PREPARE stmt FROM @add_orgid_idx_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Drop the old unique index on (organizationId, userId, docType) (idempotent)
SET @has_old_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'documentSequences'
    AND INDEX_NAME = 'docseq_org_user_doctype_idx'
);
SET @drop_idx_sql := IF(
  @has_old_idx > 0,
  'ALTER TABLE `documentSequences` DROP INDEX `docseq_org_user_doctype_idx`',
  'DO 0'
);
PREPARE stmt FROM @drop_idx_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Add the new unique index on (orgKey, userId, docType) (idempotent)
SET @has_new_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'documentSequences'
    AND INDEX_NAME = 'docseq_orgkey_user_doctype_uniq'
);
SET @add_idx_sql := IF(
  @has_new_idx = 0,
  'ALTER TABLE `documentSequences` ADD UNIQUE KEY `docseq_orgkey_user_doctype_uniq` (`orgKey`, `userId`, `docType`)',
  'DO 0'
);
PREPARE stmt FROM @add_idx_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Release the session-level write lock acquired before section 2.
UNLOCK TABLES;
