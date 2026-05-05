/**
 * ProposalSendConfirmModal
 * Confirmation dialog before sending a proposal to the client.
 *
 * Upgraded to support multi-contact recipient selection: when a clientId is
 * provided the modal fetches all contacts for that client and renders a
 * checkbox list so the distributor can choose exactly who receives the email.
 * The selected contact IDs are surfaced via onConfirm(contactIds) so the
 * caller can pass them to the proposals.send mutation.
 *
 * Backward-compatible: if clientId is omitted the modal falls back to the
 * legacy single-email display and calls onConfirm([]) (backend will use the
 * primary contactEmail in that case).
 */

import { useState, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface Department {
  name: string;
  enabled: boolean;
}

interface Props {
  show: boolean;
  /** clientId used to fetch the contact list. Pass undefined for legacy callers. */
  clientId?: number;
  /** Fallback display name when no contacts are loaded (legacy). */
  clientContact: string;
  /** Fallback email when no contacts are loaded (legacy). */
  clientEmail: string;
  title: string;
  productTotal: number;
  deliveryMethod: "email" | "webstore" | "both" | "link" | "pdf";
  validDays: number;
  multiDept: boolean;
  departments: Department[];
  approvalRouting: "parallel" | "sequential" | "any";
  sending: boolean;
  sendPending: boolean;
  onClose: () => void;
  /** Called with the selected contactIds array (empty = use legacy primary email). */
  onConfirm: (contactIds: number[]) => void;
}

export default function ProposalSendConfirmModal({
  show, clientId, clientContact, clientEmail, title, productTotal,
  deliveryMethod, validDays, multiDept, departments, approvalRouting,
  sending, sendPending, onClose, onConfirm,
}: Props) {
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);

  // Fetch contacts for this client when the modal is shown and a clientId is available.
  const { data: clientContacts } = trpc.clientContacts.list.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: show && !!clientId },
  );

  // Pre-select the primary contact (or first contact with email) when contacts load.
  useEffect(() => {
    if (!clientContacts || clientContacts.length === 0) return;
    if (selectedContactIds.length > 0) return;
    const withEmail = clientContacts.filter((c) => c.email && c.email.trim().length > 0);
    if (withEmail.length === 0) return;
    const primary = withEmail.find((c) => c.isPrimary) ?? withEmail[0];
    setSelectedContactIds([primary.id]);
  }, [clientContacts, selectedContactIds.length]);

  // Reset selection when the modal is closed so the next open starts fresh.
  useEffect(() => {
    if (!show) setSelectedContactIds([]);
  }, [show]);

  if (!show) return null;

  const enabledDepts = departments.filter(d => d.enabled);
  const hasContacts = clientContacts && clientContacts.length > 0;
  const canSend = hasContacts ? selectedContactIds.length > 0 : true;

  const handleConfirm = () => {
    onClose();
    onConfirm(selectedContactIds);
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md p-0 shadow-lg rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6" style={{ backgroundColor: 'var(--mt-brand)' }}>
          <h3 className="text-white text-[16px] font-bold">Send Proposal</h3>
          <p className="text-white/80 text-[12px] mt-1">This will send a branded email to the client</p>
        </div>
        <div className="p-6 space-y-4">
          {/* Proposal summary rows */}
          <div className="space-y-2">
            {[
              ["Proposal", title],
              ["Value", `$${productTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`],
              ["Delivery", deliveryMethod === "both" ? "Email + Webstore" : deliveryMethod === "webstore" ? "Webstore" : "Email"],
              ["Valid", validDays === 0 ? "No Expiration" : `${validDays} Days`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between p-3 bg-mt-surface border border-[#F0F0F0]">
                <span className="text-[12px] text-mt-ink-3">{label}</span>
                <span className="text-[12px] font-semibold text-mt-ink">{value}</span>
              </div>
            ))}
            {multiDept && enabledDepts.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-mt-surface border border-[#F0F0F0]">
                <span className="text-[12px] text-mt-ink-3">Departments</span>
                <span className="text-[12px] font-semibold text-mt-ink">{enabledDepts.length} ({approvalRouting})</span>
              </div>
            )}
          </div>

          {/* Recipients */}
          <div>
            <p className="text-[11px] font-semibold text-mt-ink-3 uppercase tracking-wider mb-2">Recipients</p>
            {hasContacts ? (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {clientContacts!.map((c) => {
                  const hasEmail = !!(c.email && c.email.trim().length > 0);
                  const checked = selectedContactIds.includes(c.id);
                  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2 rounded-md border text-[12px] ${hasEmail ? "border-[#F0F0F0] hover:bg-mt-surface cursor-pointer" : "border-transparent opacity-50 cursor-not-allowed"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!hasEmail}
                        checked={checked}
                        onChange={() => {
                          if (!hasEmail) return;
                          setSelectedContactIds((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                          );
                        }}
                        className="accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-mt-ink truncate">{fullName}</span>
                          {c.isPrimary && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-mt-brand-light text-primary uppercase tracking-wide">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-mt-ink-4 truncate">{c.email || "No email on file"}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              // Legacy fallback — no clientId or contacts not yet loaded
              <div className="p-3 bg-mt-surface border border-[#F0F0F0]">
                <span className="text-[12px] font-semibold text-mt-ink">
                  {clientContact ? `${clientContact} (${clientEmail})` : clientEmail || "—"}
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-[12px] font-semibold text-mt-ink-3 border border-mt-border hover:border-[#1A1A1A] transition-colors rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={sending || sendPending || !canSend}
              className="flex-1 py-2.5 text-[12px] font-semibold text-white flex items-center justify-center gap-2 rounded disabled:opacity-50"
              style={{ backgroundColor: 'var(--mt-brand)' }}
            >
              {(sending || sendPending) ? (
                <><Loader2 size={14} className="animate-spin" /> Sending...</>
              ) : (
                <>
                  <Send size={14} />
                  {hasContacts
                    ? `Send to ${selectedContactIds.length} contact${selectedContactIds.length === 1 ? "" : "s"}`
                    : "Send Proposal"
                  }
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
