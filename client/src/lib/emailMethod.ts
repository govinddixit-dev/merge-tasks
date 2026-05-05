/**
 * Maps the backend `emailMethod` string returned from `proposals.send`
 * to a human-readable phrase for toast messages.
 *
 * Backend shapes:
 *   "gmail:user@example.com"   → "your connected Gmail account"
 *   "outlook:user@example.com" → "your connected Outlook account"
 *   "smtp:user@example.com"    → "your connected email (SMTP)"
 *   "system_smtp"              → "MergeTasks mail"
 *   "notification"             → "in-app notification"
 */
export function humanizeEmailMethod(method: string | undefined | null): string {
  if (!method) return "email";
  if (method.startsWith("gmail:")) return "your connected Gmail account";
  if (method.startsWith("outlook:")) return "your connected Outlook account";
  if (method.startsWith("smtp:")) return "your connected email (SMTP)";
  if (method === "system_smtp") return "MergeTasks mail";
  if (method === "notification") return "in-app notification";
  return method;
}
