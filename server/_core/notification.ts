/**
 * Notification service — writes in-app notifications to the database.
 * Falls back to console logging if the DB is unavailable so callers are never disrupted.
 */
import { getLogger } from "../utils/logger";
import { getDb } from "../db";
import { notifications } from "../../drizzle/schema";

const log = getLogger("Notification");

const MAX_NOTIFICATION_CONTENT_LENGTH = 5000;

export type NotificationType =
  | "proposal_sent"
  | "proposal_viewed"
  | "proposal_approved"
  | "proposal_declined"
  | "order_placed"
  | "order_shipped"
  | "order_delivered"
  | "store_order"
  | "store_user_joined"
  | "payment_received"
  | "invoice_overdue"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "ai_insight"
  | "system"
  // Purchase order lifecycle events
  | "po_created"
  | "po_sent"
  | "po_acknowledged"
  | "po_shipped"
  | "po_received"
  | "po_overdue"
  // Custom order requests
  | "custom_order_request"
  // Print requests from client portal
  | "print_request"
  // Stripe Connect payment lifecycle (payout/dispute/deauthorization alerts)
  | "payment";

export type NotificationPayload = {
  /** The distributor (owner) user ID to notify */
  userId: number;
  /** Optional org scope */
  organizationId?: number;
  /** Notification category */
  type?: NotificationType;
  /** Short title shown in the notification bell */
  title: string;
  /** Full message body */
  content: string;
  /** Optional deep-link path inside the app, e.g. /proposals/42 */
  actionPath?: string;
  /** Optional label for the action link, e.g. "View Proposal" */
  actionLabel?: string;
  /** Optional ID of the related entity (proposalId, orderId, etc.) */
  entityId?: number;
  /** Optional type of the related entity, e.g. "proposal" | "order" */
  entityType?: string;
};

/**
 * Write an in-app notification for the given user.
 * Always returns true so callers are never disrupted by notification failures.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const {
    userId,
    organizationId,
    type = "system",
    title,
    content,
    actionPath,
    actionLabel,
    entityId,
    entityType,
  } = payload;

  if (!title?.trim() || !content?.trim()) {
    log.warn("[Notification] Skipped — missing title or content");
    return true;
  }

  try {
    const db = await getDb();
    if (!db) {
      log.warn(`[Notification] DB unavailable — ${title}: ${content.substring(0, 100)}`);
      return true;
    }

    await db.insert(notifications).values({
      userId,
      organizationId: organizationId ?? null,
      type: type,
      title: title.trim().substring(0, 255),
      message: content.trim().substring(0, MAX_NOTIFICATION_CONTENT_LENGTH),
      read: false,
      actionPath: actionPath ?? null,
      actionLabel: actionLabel ?? null,
      entityId: entityId ?? null,
      entityType: entityType ?? null,
    });

    log.info(`[Notification → user:${userId}] ${title}`);
    return true;
  } catch (err) {
    // Never throw — notification failure must not break the calling operation
    log.error(`[Notification] Failed to write notification for user ${userId}: ${err}`);
    return true;
  }
}
