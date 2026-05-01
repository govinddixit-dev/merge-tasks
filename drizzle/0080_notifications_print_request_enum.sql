-- Add print_request to the notification type enum
-- Supports GAP 1 (portal print request → distributor notification) from the
-- phase-3 branch. Writes of notifType='print_request' will fail against the
-- existing ENUM until this ALTER runs.
ALTER TABLE `notifications` MODIFY COLUMN `notifType` ENUM(
  'proposal_sent','proposal_viewed','proposal_approved','proposal_declined',
  'order_placed','order_shipped','order_delivered',
  'store_order','store_user_joined',
  'payment_received','invoice_overdue',
  'approval_requested','approval_granted','approval_denied',
  'ai_insight','system',
  'po_created','po_sent','po_acknowledged','po_shipped','po_received','po_overdue',
  'custom_order_request',
  'print_request'
) NOT NULL DEFAULT 'system';
