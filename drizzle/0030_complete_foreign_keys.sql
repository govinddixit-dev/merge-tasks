-- Migration 0030: Complete Foreign Key Coverage
-- Adds all FK constraints that were declared in schema.ts .references() but missing
-- from migration 0027, plus circular/self-referencing FKs that can't use .references().
--
-- All nullable FKs use ON DELETE SET NULL (parent deleted → child keeps row, FK nulled).
-- All NOT NULL FKs use ON DELETE CASCADE (parent deleted → child row deleted).
-- Run with: mysql -u root -p mergetasks < drizzle/0030_complete_foreign_keys.sql

-- ── organizationId FKs (all nullable → SET NULL) ──

ALTER TABLE `clients`
  ADD CONSTRAINT `fk_clients_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `products`
  ADD CONSTRAINT `fk_products_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `apiConnections`
  ADD CONSTRAINT `fk_apiConnections_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `stores`
  ADD CONSTRAINT `fk_stores_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `proposals`
  ADD CONSTRAINT `fk_proposals_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `virtualProofs`
  ADD CONSTRAINT `fk_virtualProofs_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `clientLogos`
  ADD CONSTRAINT `fk_clientLogos_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `emailConnections`
  ADD CONSTRAINT `fk_emailConnections_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `distributorProfiles`
  ADD CONSTRAINT `fk_distributorProfiles_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `clientAssets`
  ADD CONSTRAINT `fk_clientAssets_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `aiEditFeedback`
  ADD CONSTRAINT `fk_aiEditFeedback_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `copilot_conversations`
  ADD CONSTRAINT `fk_copilotConversations_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `copilot_memory`
  ADD CONSTRAINT `fk_copilotMemory_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `copilot_task_log`
  ADD CONSTRAINT `fk_copilotTaskLog_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `printRequests`
  ADD CONSTRAINT `fk_printRequests_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notifications_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `estimates`
  ADD CONSTRAINT `fk_estimates_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoices_organizationId` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL;

-- ── Nullable entity FKs (SET NULL) ──

ALTER TABLE `proposals`
  ADD CONSTRAINT `fk_proposals_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL;

ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_storeId` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_orders_proposalId` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE SET NULL;

ALTER TABLE `virtualProofs`
  ADD CONSTRAINT `fk_virtualProofs_productId` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_virtualProofs_proposalId` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_virtualProofs_clientId` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL;

-- ── orgMembers → users (nullable userId for pending invites) ──

ALTER TABLE `orgMembers`
  ADD CONSTRAINT `fk_orgMembers_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_orgMembers_invitedByUserId` FOREIGN KEY (`invitedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

-- ── aiTrainingData → users (nullable) ──

ALTER TABLE `aiTrainingData`
  ADD CONSTRAINT `fk_aiTrainingData_userId` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

-- ── aiEditFeedback → aiTrainingData (NOT NULL → CASCADE) ──

ALTER TABLE `aiEditFeedback`
  ADD CONSTRAINT `fk_aiEditFeedback_trainingDataId` FOREIGN KEY (`trainingDataId`) REFERENCES `aiTrainingData`(`id`) ON DELETE CASCADE;

-- ── Circular / Self-referencing FKs ──

-- stores.linkedStoreId → stores.id (self-reference for pop-up → permanent store links)
ALTER TABLE `stores`
  ADD CONSTRAINT `fk_stores_linkedStoreId` FOREIGN KEY (`linkedStoreId`) REFERENCES `stores`(`id`) ON DELETE SET NULL;

-- estimates.convertedToInvoiceId → invoices.id (circular ref)
ALTER TABLE `estimates`
  ADD CONSTRAINT `fk_estimates_convertedToInvoiceId` FOREIGN KEY (`convertedToInvoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL;

-- invoices → proposals, estimates, orders (nullable FKs)
ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoices_proposalId` FOREIGN KEY (`invProposalId`) REFERENCES `proposals`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_invoices_estimateId` FOREIGN KEY (`invEstimateId`) REFERENCES `estimates`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_invoices_orderId` FOREIGN KEY (`invOrderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL;
