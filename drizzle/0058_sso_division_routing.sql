-- Multi-division SSO routing
-- Adds optional targetStoreId (which child store/division to redirect to
-- after SSO) and defaultDepartmentId (auto-assigned department on JIT
-- provisioning) to storeIdentityProviders.

ALTER TABLE `storeIdentityProviders`
  ADD COLUMN `targetStoreId` INT NULL,
  ADD COLUMN `defaultDepartmentId` INT NULL;

ALTER TABLE `storeIdentityProviders`
  ADD CONSTRAINT `fk_sip_target_store`
    FOREIGN KEY (`targetStoreId`) REFERENCES `stores`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sip_default_dept`
    FOREIGN KEY (`defaultDepartmentId`) REFERENCES `storeDepartments`(`id`) ON DELETE SET NULL;
