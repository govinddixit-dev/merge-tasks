-- Add 'payment' to the notification type enum
-- Supports Stripe Connect payment-lifecycle alerts (transfer.reversed, payout.failed,
-- account.application.deauthorized, dispute.created, dispute.funds_withdrawn). Writes
-- of notifType='payment' will fail against the existing ENUM until this ALTER runs.
ALTER TABLE `notifications` MODIFY COLUMN `notifType` ENUM(
  'proposal_sent','proposal_viewed','proposal_approved','proposal_declined',
  'order_placed','order_shipped','order_delivered',
  'store_order','store_user_joined',
  'payment_received','invoice_overdue',
  'approval_requested','approval_granted','approval_denied',
  'ai_insight','system',
  'po_created','po_sent','po_acknowledged','po_shipped','po_received','po_overdue',
  'custom_order_request',
  'print_request',
  'supplier_cost_change',
  'payment'
) NOT NULL DEFAULT 'system';
