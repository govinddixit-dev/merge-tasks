-- Per-org supplier credentials store (Session 1 of generic supplier credential system).
--
-- One row per (organizationId, supplierCode). Both accountId and password are
-- encrypted at rest by the application layer (server/utils/encryption.ts);
-- the columns are sized at 512 chars to fit the "enc:v1:"-prefixed base64
-- ciphertext, not the plaintext length.
CREATE TABLE `supplierCredentials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organizationId` int NOT NULL,
  `supplierCode` varchar(64) NOT NULL,
  `accountId` varchar(512) NOT NULL,
  `password` varchar(512) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `supplierCredentials_id` PRIMARY KEY(`id`),
  CONSTRAINT `sc_org_supplier_unique` UNIQUE(`organizationId`, `supplierCode`)
);

ALTER TABLE `supplierCredentials`
  ADD CONSTRAINT `sc_org_fk`
  FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE;
