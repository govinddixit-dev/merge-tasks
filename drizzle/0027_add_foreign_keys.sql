-- Migration: Add Foreign Key Constraints
-- Addresses CRITICAL finding: no FK constraints across 25+ tables.
-- All FKs use ON DELETE CASCADE so child rows are automatically cleaned up.
-- Run with: mysql -u root -p mergetasks < drizzle/0027_add_foreign_keys.sql
--
-- NOTE: If you have orphaned rows from before this migration, clean them up first:
--   DELETE FROM proposalProducts WHERE proposalId NOT IN (SELECT id FROM proposals);
--   DELETE FROM orderItems WHERE orderId NOT IN (SELECT id FROM orders);
--   etc.

-- ── clients → users ──
ALTER TABLE `clients`
  ADD CONSTRAINT `fk_clients_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── products → users ──
ALTER TABLE `products`
  ADD CONSTRAINT `fk_products_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── apiConnections → users ──
ALTER TABLE `apiConnections`
  ADD CONSTRAINT `fk_apiConnections_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── stores → users, clients ──
ALTER TABLE `stores`
  ADD CONSTRAINT `fk_stores_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_stores_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── storeProducts → stores, products ──
ALTER TABLE `storeProducts`
  ADD CONSTRAINT `fk_storeProducts_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_storeProducts_productId` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE;

-- ── proposals → users, clients ──
ALTER TABLE `proposals`
  ADD CONSTRAINT `fk_proposals_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_proposals_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── proposalProducts → proposals, products ──
ALTER TABLE `proposalProducts`
  ADD CONSTRAINT `fk_proposalProducts_proposalId` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_proposalProducts_productId` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE;

-- ── orders → users, clients ──
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_orders_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── orderItems → orders, products ──
ALTER TABLE `orderItems`
  ADD CONSTRAINT `fk_orderItems_orderId` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_orderItems_productId` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE;

-- ── virtualProofs → users ──
ALTER TABLE `virtualProofs`
  ADD CONSTRAINT `fk_virtualProofs_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── clientLogos → users, clients ──
ALTER TABLE `clientLogos`
  ADD CONSTRAINT `fk_clientLogos_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_clientLogos_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── emailConnections → users ──
ALTER TABLE `emailConnections`
  ADD CONSTRAINT `fk_emailConnections_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── verificationCodes → users ──
ALTER TABLE `verificationCodes`
  ADD CONSTRAINT `fk_verificationCodes_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── distributorProfiles → users ──
ALTER TABLE `distributorProfiles`
  ADD CONSTRAINT `fk_distributorProfiles_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── clientAssets → users, clients ──
ALTER TABLE `clientAssets`
  ADD CONSTRAINT `fk_clientAssets_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_clientAssets_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── storeUsers → stores ──
ALTER TABLE `storeUsers`
  ADD CONSTRAINT `fk_storeUsers_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE;

-- ── storeVerificationCodes → stores ──
ALTER TABLE `storeVerificationCodes`
  ADD CONSTRAINT `fk_storeVerificationCodes_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE;

-- ── storeAllowedDomains → stores ──
ALTER TABLE `storeAllowedDomains`
  ADD CONSTRAINT `fk_storeAllowedDomains_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE;

-- ── departmentApprovals → proposals ──
ALTER TABLE `departmentApprovals`
  ADD CONSTRAINT `fk_departmentApprovals_proposalId` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE;

-- ── copilot_conversations → users ──
ALTER TABLE `copilot_conversations`
  ADD CONSTRAINT `fk_copilotConversations_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── copilot_memory → users ──
ALTER TABLE `copilot_memory`
  ADD CONSTRAINT `fk_copilotMemory_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── copilot_task_log → users ──
ALTER TABLE `copilot_task_log`
  ADD CONSTRAINT `fk_copilotTaskLog_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── printRequests → stores, clients, users ──
ALTER TABLE `printRequests`
  ADD CONSTRAINT `fk_printRequests_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_printRequests_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_printRequests_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── storePasswordTokens → stores, storeUsers ──
ALTER TABLE `storePasswordTokens`
  ADD CONSTRAINT `fk_storePasswordTokens_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_storePasswordTokens_storeUserId` FOREIGN KEY (`storeUserId`) REFERENCES `storeUsers`(`id`) ON DELETE CASCADE;

-- ── productVariants → products ──
ALTER TABLE `productVariants`
  ADD CONSTRAINT `fk_productVariants_productId` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE;

-- ── proposalProductVariants → proposalProducts ──
ALTER TABLE `proposalProductVariants`
  ADD CONSTRAINT `fk_proposalProductVariants_ppId` FOREIGN KEY (`proposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE;

-- ── proposalPriceTiers → proposalProducts ──
ALTER TABLE `proposalPriceTiers`
  ADD CONSTRAINT `fk_proposalPriceTiers_ppId` FOREIGN KEY (`pptProposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE;

-- ── proposalOrderItems → proposals, proposalProducts, products ──
ALTER TABLE `proposalOrderItems`
  ADD CONSTRAINT `fk_proposalOrderItems_proposalId` FOREIGN KEY (`poiProposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_proposalOrderItems_ppId` FOREIGN KEY (`poiProposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_proposalOrderItems_productId` FOREIGN KEY (`poiProductId`) REFERENCES `products`(`id`) ON DELETE CASCADE;

-- ── proposalProductImages → proposalProducts ──
ALTER TABLE `proposalProductImages`
  ADD CONSTRAINT `fk_proposalProductImages_ppId` FOREIGN KEY (`ppiProposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE;

-- ── proposalSizeCharts → proposalProducts ──
ALTER TABLE `proposalSizeCharts`
  ADD CONSTRAINT `fk_proposalSizeCharts_ppId` FOREIGN KEY (`pscProposalProductId`) REFERENCES `proposalProducts`(`id`) ON DELETE CASCADE;

-- ── estimates → users, proposals, clients ──
ALTER TABLE `estimates`
  ADD CONSTRAINT `fk_estimates_userId` FOREIGN KEY (`estUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_estimates_proposalId` FOREIGN KEY (`estProposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_estimates_clientId` FOREIGN KEY (`estClientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── invoices → users, clients ──
ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoices_userId` FOREIGN KEY (`invUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_invoices_clientId` FOREIGN KEY (`invClientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE;

-- ── proposalVersions → proposals, users ──
ALTER TABLE `proposalVersions`
  ADD CONSTRAINT `fk_proposalVersions_proposalId` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_proposalVersions_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── organizations → users ──
ALTER TABLE `organizations`
  ADD CONSTRAINT `fk_organizations_ownerId` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── orgMembers → organizations ──
ALTER TABLE `orgMembers`
  ADD CONSTRAINT `fk_orgMembers_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE;

-- ── notifications → users ──
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notifications_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ── aiEditFeedback → users ──
ALTER TABLE `aiEditFeedback`
  ADD CONSTRAINT `fk_aiEditFeedback_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;
