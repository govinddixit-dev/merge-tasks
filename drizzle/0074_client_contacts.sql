-- 0074_client_contacts.sql
-- Adds a clientContacts table to support multiple contact people per client.
-- The existing clients.contactName/contactTitle/contactEmail/contactPhone
-- fields are preserved for backward compatibility; UI reads/writes them
-- through the mirrored primary contact row when present.

CREATE TABLE IF NOT EXISTS `clientContacts` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `clientId` INT NOT NULL,
  `firstName` VARCHAR(128) NULL,
  `lastName` VARCHAR(128) NULL,
  `email` VARCHAR(320) NULL,
  `phone` VARCHAR(32) NULL,
  `title` VARCHAR(128) NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `clientContacts_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`),
  KEY `clientContacts_clientId_idx` (`clientId`),
  KEY `clientContacts_clientId_primary_idx` (`clientId`, `isPrimary`)
);

-- Backfill: one primary contact row per existing client, derived from the
-- legacy columns on `clients`. Split contactName on the first space into
-- firstName/lastName; LEFT JOIN guards against duplicate inserts so the
-- file stays safe under replay (e.g. CI fresh-DB path).
INSERT INTO `clientContacts` (`clientId`, `firstName`, `lastName`, `email`, `phone`, `title`, `isPrimary`)
SELECT
  c.`id`,
  NULLIF(TRIM(SUBSTRING_INDEX(c.`contactName`, ' ', 1)), ''),
  NULLIF(TRIM(
    CASE
      WHEN LOCATE(' ', c.`contactName`) > 0
      THEN SUBSTRING(c.`contactName`, LOCATE(' ', c.`contactName`) + 1)
      ELSE ''
    END
  ), ''),
  c.`contactEmail`,
  c.`contactPhone`,
  c.`contactTitle`,
  TRUE
FROM `clients` c
LEFT JOIN `clientContacts` cc ON cc.`clientId` = c.`id`
WHERE cc.`id` IS NULL;
