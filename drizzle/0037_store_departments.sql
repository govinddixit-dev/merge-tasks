-- 0037_store_departments.sql
-- Creates the storeDepartments table for budget-tracked departments
-- and adds departmentId FK to storeUsers.

CREATE TABLE storeDepartments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  storeId INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  budgetCents INT NOT NULL DEFAULT 0,
  spentCents INT NOT NULL DEFAULT 0,
  maxPerOrderCents INT DEFAULT NULL
    COMMENT 'Optional per-order cap for this department',
  fiscalPeriodStart DATE NOT NULL,
  fiscalPeriodEnd DATE NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdBy ENUM('distributor', 'poc') NOT NULL DEFAULT 'distributor',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sd_storeId FOREIGN KEY (storeId)
    REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE KEY uq_sd_store_name (storeId, name),
  INDEX idx_sd_store_active (storeId, isActive)
);

ALTER TABLE storeUsers
  ADD COLUMN `departmentId` INT DEFAULT NULL AFTER department,
  ADD CONSTRAINT fk_su_deptId FOREIGN KEY (departmentId)
    REFERENCES storeDepartments(id) ON DELETE SET NULL;
