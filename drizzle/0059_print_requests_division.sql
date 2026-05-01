-- Division tagging for print requests.
-- When a storeUser submits a print request, we stamp their divisionId
-- so downstream views can filter by division without joining storeUsers.

ALTER TABLE `printRequests`
  ADD COLUMN `divisionId` INT NULL,
  ADD CONSTRAINT `fk_print_requests_division`
    FOREIGN KEY (`divisionId`) REFERENCES `divisions`(`id`) ON DELETE SET NULL;
