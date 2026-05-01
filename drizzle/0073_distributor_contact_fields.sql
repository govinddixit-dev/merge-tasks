-- 0073_distributor_contact_fields.sql
-- Adds contact detail columns to distributorProfiles so branded PDFs
-- (estimates, invoices, purchase orders) can display the distributor's
-- address, phone, email, and website pulled live from their profile.

ALTER TABLE `distributorProfiles`
  ADD COLUMN `companyAddress` TEXT NULL AFTER `brandCompanyName`,
  ADD COLUMN `companyPhone` VARCHAR(40) NULL AFTER `companyAddress`,
  ADD COLUMN `companyEmail` VARCHAR(320) NULL AFTER `companyPhone`,
  ADD COLUMN `companyWebsite` VARCHAR(512) NULL AFTER `companyEmail`;
