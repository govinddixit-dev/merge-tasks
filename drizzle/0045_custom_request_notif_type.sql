-- Add custom_order_request to the notification type enum
ALTER TABLE `notifications` MODIFY COLUMN `notifType` ENUM(
  'proposal_sent','proposal_viewed','proposal_approved','proposal_declined',
  'order_placed','order_shipped','order_delivered',
  'store_order','store_user_joined',
  'payment_received','invoice_overdue',
  'approval_requested','approval_granted','approval_denied',
  'ai_insight','system',
  'po_created','po_sent','po_acknowledged','po_shipped','po_received','po_overdue',
  'custom_order_request'
) NOT NULL DEFAULT 'system';
