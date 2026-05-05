-- 0064_email_unsubscribes.sql
-- CASL / CAN-SPAM unsubscribe suppression list for commercial emails.
--
-- A row suppresses email sends that match (email, unsubscribeType) and,
-- optionally, a specific store. Transactional emails never consult this
-- table; only templates flagged as commercial at send-time do.

CREATE TABLE `emailUnsubscribes` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(320) NOT NULL,
  `storeId` INT NULL,
  `unsubscribeType` ENUM('all', 'proposals', 'marketing') NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `email_unsubs_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`),
  UNIQUE KEY `email_unsubs_unique_idx` (`email`, `unsubscribeType`, `storeId`),
  KEY `email_unsubs_email_idx` (`email`)
);
