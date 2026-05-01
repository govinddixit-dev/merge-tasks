/**
 * EditModePanel.tsx — Edit mode UI: edit banner with notes, product
 * quantity editor with remove/restore, and the post-edit panel with
 * re-approval and override options.
 */
import { useState } from "react";
import {
  Package, Minus, Plus, Trash2, RotateCcw, Edit3, Save,
  Loader2, RefreshCw, Send, ShieldAlert,
} from "lucide-react";
import type { ProposalProduct, DeptStatus } from "./publicProposalTypes";

// ── Edit Mode Controls ────────────────────────────────────────────────

interface EditControlsProps {
  editMode: boolean;
  expired: boolean;
  saving: boolean;
  onEnter: () => void;
  onSave: () => void;
  onCancel: () => void;
  onAddAll: () => void;
  primaryColor: string;
}

export function EditModeControls({
  editMode, expired, saving,
  onEnter, onSave, onCancel, onAddAll, primaryColor,
}: EditControlsProps) {
  if (expired) return null;

  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-2">
        {!editMode && (
          <button className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-mt-ink-2 border border-mt-border rounded-md hover:bg-mt-surface-2 transition-colors" onClick={onEnter}>
            <Edit3 size={13} /> Edit Proposal
          </button>
        )}
        {editMode && (
          <>
            <button
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#16A34A" }}
              onClick={onSave}
              disabled={saving}
            >
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : <><Save size={13} /> Save Changes</>}
            </button>
            <button className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-[#DC2626] border border-[#FECACA] rounded-md hover:bg-[#FEF2F2] transition-colors" onClick={onCancel}>
              <RotateCcw size={13} /> Cancel
            </button>
          </>
        )}
      </div>
      <button
        className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-bold text-white rounded-md transition-all hover:opacity-90 active:scale-[0.97]"
        style={{ backgroundColor: primaryColor }}
        onClick={onAddAll}
      >
        Add all to list
      </button>
    </div>
  );
}

// ── Edit Mode Banner + Product Editor ─────────────────────────────────

interface EditBannerProps {
  editMode: boolean;
  products: ProposalProduct[];
  editNotes: string;
  setEditNotes: (v: string) => void;
  editedQuantities: Record<number, number>;
  setEditedQuantities: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  removedProducts: Set<number>;
  setRemovedProducts: React.Dispatch<React.SetStateAction<Set<number>>>;
}

export function EditModeBanner({
  editMode, products, editNotes, setEditNotes,
  editedQuantities, setEditedQuantities,
  removedProducts, setRemovedProducts,
}: EditBannerProps) {
  if (!editMode) return null;

  return (
    <>
      {/* Edit notes */}
      <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-4 mb-5">
        <p className="text-[12px] font-semibold text-[#92400E] mb-2">Edit Mode Active</p>
        <p className="text-[11px] text-[#B45309] mb-3">Adjust quantities or remove products below. Add a note to explain your changes.</p>
        <textarea
          className="w-full h-16 px-3 py-2 text-[12px] border border-[#FDE68A] rounded-md outline-none focus:border-[#D97706] resize-none bg-white text-mt-ink-2"
          placeholder="Notes about your changes (optional)..."
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
        />
      </div>

      {/* Product list with qty edit + remove */}
      {products.length > 0 && (
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
          <div className="px-5 py-3 bg-[#F8F8FA] border-b border-mt-border">
            <p className="text-[12px] font-semibold text-mt-ink-2">Products ({products.filter(p => !removedProducts.has(p.id)).length})</p>
          </div>
          {products.map((p) => {
            const isRemoved = removedProducts.has(p.id);
            const qty = editedQuantities[p.id] ?? p.quantity;
            return (
              <div key={p.id} className={`flex items-center gap-4 px-5 py-3 border-b border-[#F0F0F0] last:border-b-0 ${isRemoved ? "opacity-40" : ""}`}>
                <div className="w-12 h-12 bg-[#F8F8FA] rounded flex items-center justify-center p-1 flex-shrink-0">
                  {p.imageUrl ? <img src={p.imageUrl} alt="" className="max-h-full max-w-full object-contain" /> : <Package size={18} className="text-[#D4D4D4]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold ${isRemoved ? "line-through text-mt-ink-4" : "text-mt-ink"}`}>{p.name}</p>
                  <p className="text-[11px] text-mt-ink-4">${parseFloat(p.unitPrice || "0").toFixed(2)} each</p>
                </div>
                {!isRemoved && (
                  <div className="flex items-center gap-1 border border-mt-border rounded overflow-hidden">
                    <button className="w-7 h-7 flex items-center justify-center hover:bg-mt-surface-2" onClick={() => setEditedQuantities(prev => ({ ...prev, [p.id]: Math.max(1, (prev[p.id] ?? p.quantity) - 1) }))}>
                      <Minus size={12} />
                    </button>
                    <span className="w-8 text-center text-[12px] font-semibold">{qty}</span>
                    <button className="w-7 h-7 flex items-center justify-center hover:bg-mt-surface-2" onClick={() => setEditedQuantities(prev => ({ ...prev, [p.id]: (prev[p.id] ?? p.quantity) + 1 }))}>
                      <Plus size={12} />
                    </button>
                  </div>
                )}
                <button
                  className={`p-1.5 rounded transition-colors ${isRemoved ? "text-[#16A34A] hover:bg-[#F0FDF4]" : "text-[#DC2626] hover:bg-[#FEF2F2]"}`}
                  onClick={() => {
                    if (isRemoved) setRemovedProducts(prev => { const n = new Set(prev); n.delete(p.id); return n; });
                    else setRemovedProducts(prev => new Set(prev).add(p.id));
                  }}
                >
                  {isRemoved ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── After-Edit Panel (Re-approval + Override) ─────────────────────────

interface AfterEditProps {
  show: boolean;
  multiDepartment: boolean;
  departments: DeptStatus[];
  primaryColor: string;
  token: string;
  onReapprovalSent: () => void;
  onOverrideSent: () => void;
  fetchDepartments: () => void;
}

export function AfterEditPanel({
  show, multiDepartment, departments, primaryColor,
  token, onReapprovalSent, onOverrideSent, fetchDepartments,
}: AfterEditProps) {
  const [showReapprovalSelector, setShowReapprovalSelector] = useState(false);
  const [selectedDeptIds, setSelectedDeptIds] = useState<Set<number>>(new Set());
  const [reapprovalNotes, setReapprovalNotes] = useState("");
  const [reapproving, setReapproving] = useState(false);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState("");
  const [overriding, setOverriding] = useState(false);

  if (!show || !multiDepartment) return null;

  const handleRequestReapproval = async () => {
    if (selectedDeptIds.size === 0) return;
    setReapproving(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/request-reapproval`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentIds: Array.from(selectedDeptIds), notes: reapprovalNotes.trim() || undefined, origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request re-approval");
      await fetchDepartments();
      setShowReapprovalSelector(false);
      setSelectedDeptIds(new Set());
      setReapprovalNotes("");
      onReapprovalSent();
    } catch (err: unknown) {
      // handled by parent
    } finally { setReapproving(false); }
  };

  const handleOverrideFulfillment = async () => {
    setOverriding(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/override-fulfillment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: overrideNotes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to override");
      setShowOverrideConfirm(false);
      onOverrideSent();
    } catch (err: unknown) {
      // handled by parent
    } finally { setOverriding(false); }
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
      <div className="px-5 py-3.5 bg-[#F8F8FA] border-b border-mt-border">
        <h3 className="text-[14px] font-bold text-mt-ink">Changes Saved — What's Next?</h3>
      </div>
      <div className="p-5 space-y-4">
        {/* Option 1: Request Re-approval */}
        <div className="border border-mt-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw size={15} style={{ color: primaryColor }} />
            <h4 className="text-[13px] font-semibold text-mt-ink">Request Re-approval</h4>
          </div>
          <p className="text-[11px] text-mt-ink-3 mb-3">Select departments to re-approve the updated proposal.</p>
          {!showReapprovalSelector ? (
            <button className="px-4 py-2 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors" style={{ backgroundColor: primaryColor }} onClick={() => setShowReapprovalSelector(true)}>
              Select Departments
            </button>
          ) : (
            <div>
              <div className="space-y-2 mb-3">
                {departments.map(dept => (
                  <label key={dept.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedDeptIds.has(dept.id)} onChange={() => { setSelectedDeptIds(prev => { const n = new Set(prev); if (n.has(dept.id)) n.delete(dept.id); else n.add(dept.id); return n; }); }} className="rounded" />
                    <span className="text-[12px] text-mt-ink">{dept.departmentName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${dept.status === "approved" ? "bg-[#F0FDF4] text-[#16A34A]" : dept.status === "rejected" ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#F8F8FA] text-mt-ink-4"}`}>{dept.status}</span>
                  </label>
                ))}
              </div>
              <textarea className="w-full h-12 px-3 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-[#999] resize-none bg-white text-mt-ink-2 mb-3" placeholder="Add a note for the re-approval request (optional)..." value={reapprovalNotes} onChange={(e) => setReapprovalNotes(e.target.value)} />
              <button className="px-4 py-2 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-1.5" style={{ backgroundColor: primaryColor }} onClick={handleRequestReapproval} disabled={reapproving || selectedDeptIds.size === 0}>
                {reapproving ? <><Loader2 size={13} className="animate-spin" /> Sending...</> : <><Send size={13} /> Send Re-approval</>}
              </button>
            </div>
          )}
        </div>

        {/* Option 2: Override & Send for Fulfillment */}
        <div className="border border-[#FECACA] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={15} className="text-[#DC2626]" />
            <h4 className="text-[13px] font-semibold text-mt-ink">Override & Send for Fulfillment</h4>
          </div>
          <p className="text-[11px] text-mt-ink-3 mb-3">Skip department approvals and send directly for fulfillment.</p>
          {!showOverrideConfirm ? (
            <button className="px-4 py-2 text-[12px] font-bold text-[#DC2626] border border-[#FECACA] rounded-md hover:bg-[#FEF2F2] transition-colors" onClick={() => setShowOverrideConfirm(true)}>
              Override Approvals
            </button>
          ) : (
            <div>
              <textarea className="w-full h-12 px-3 py-2 text-[12px] border border-[#FECACA] rounded-md outline-none focus:border-[#DC2626] resize-none bg-white text-mt-ink-2 mb-3" placeholder="Reason for override (optional)..." value={overrideNotes} onChange={(e) => setOverrideNotes(e.target.value)} />
              <div className="flex gap-2">
                <button className="px-4 py-2 text-[12px] font-bold text-white bg-[#DC2626] rounded-md hover:bg-[#B91C1C] transition-colors disabled:opacity-50 flex items-center gap-1.5" onClick={handleOverrideFulfillment} disabled={overriding}>
                  {overriding ? <><Loader2 size={13} className="animate-spin" /> Processing...</> : <><ShieldAlert size={13} /> Confirm Override</>}
                </button>
                <button className="px-4 py-2 text-[12px] font-medium text-mt-ink-2 border border-mt-border rounded-md hover:bg-mt-surface-2" onClick={() => setShowOverrideConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
