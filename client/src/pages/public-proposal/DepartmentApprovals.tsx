/**
 * DepartmentApprovals.tsx — Department approval list with progress bar,
 * rejection notes, and "Share with Departments" form.
 */
import { useState } from "react";
import {
  Users, Check, X, Clock, ChevronUp, PlusCircle,
  Send, Loader2, BellRing,
} from "lucide-react";
import { toast } from "sonner";
import type { DeptStatus } from "./publicProposalTypes";

interface Props {
  departments: DeptStatus[];
  deptLoading: boolean;
  primaryColor: string;
  approvalRouting: string | null;
  token: string;
  onDepartmentsUpdated: (depts: DeptStatus[]) => void;
}

export function DepartmentApprovals({
  departments, deptLoading, primaryColor,
  approvalRouting, token, onDepartmentsUpdated,
}: Props) {
  const [showAddDept, setShowAddDept] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [remindingAll, setRemindingAll] = useState(false);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [newDepts, setNewDepts] = useState([{ name: "", contactName: "", contactEmail: "", description: "" }]);

  const pendingCount = departments.filter(d => d.status === "pending").length;

  const sendReminder = async (departmentId?: number) => {
    if (departmentId != null) setRemindingId(departmentId);
    else setRemindingAll(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/departments/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId, origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reminder");
      toast.success(
        data.sent > 0
          ? `Reminder sent to ${data.sent} approver${data.sent === 1 ? "" : "s"}.`
          : "No pending approvers to remind."
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setRemindingId(null);
      setRemindingAll(false);
    }
  };

  const approvedCount = departments.filter(d => d.status === "approved").length;
  const allApproved = departments.length > 0 && approvedCount === departments.length;

  const addNewDeptRow = () => setNewDepts(prev => [...prev, { name: "", contactName: "", contactEmail: "", description: "" }]);
  const removeNewDeptRow = (idx: number) => setNewDepts(prev => prev.filter((_, i) => i !== idx));
  const updateNewDept = (idx: number, field: string, value: string) => setNewDepts(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));

  const handleForwardToDepts = async () => {
    const valid = newDepts.filter(d => d.name.trim() && d.contactEmail.trim());
    if (valid.length === 0) return;
    setForwarding(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/departments/forward`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departments: valid.map(d => ({ name: d.name.trim(), contactName: d.contactName.trim() || undefined, contactEmail: d.contactEmail.trim(), description: d.description.trim() || undefined })), origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to forward");
      onDepartmentsUpdated(data.departments || []);
      setNewDepts([{ name: "", contactName: "", contactEmail: "", description: "" }]);
      setShowAddDept(false);
    } catch (err: unknown) {
      // toast handled by parent
    } finally { setForwarding(false); }
  };

  return (
    <div className="bg-white rounded-lg border border-mt-border overflow-hidden mb-6">
      <div className="px-5 py-3.5 bg-[#2A2A2A] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-white" />
          <h3 className="text-[14px] font-bold text-white">Department Approvals</h3>
        </div>
        <div className="flex items-center gap-2">
          {approvalRouting && (
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-white/15 text-white/80 uppercase tracking-wider">
              {approvalRouting === "sequential" ? "Sequential" : "Parallel"}
            </span>
          )}
          {departments.length > 0 && (
            <span className="text-[11px] font-bold px-3 py-1 rounded-full text-white" style={{ backgroundColor: allApproved ? "#16A34A" : primaryColor }}>
              {approvedCount}/{departments.length} Approved
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* Progress bar */}
        {departments.length > 0 && (
          <div className="mb-5">
            <div className="w-full h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(approvedCount / departments.length) * 100}%`, backgroundColor: allApproved ? "#16A34A" : primaryColor }} />
            </div>
            <p className="text-[11px] text-mt-ink-4 mt-1.5">{approvedCount} of {departments.length} departments approved</p>
          </div>
        )}

        {/* Department list */}
        {deptLoading ? (
          <div className="flex items-center gap-2 py-4"><Loader2 size={16} className="animate-spin text-mt-ink-4" /><span className="text-[12px] text-mt-ink-4">Loading departments...</span></div>
        ) : departments.length > 0 ? (
          <div className="space-y-2 mb-4">
            {departments.map(dept => (
              <div key={dept.id} className="flex items-center gap-3 p-3 rounded-lg border border-[#F0F0F0] hover:bg-mt-surface transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${dept.status === "approved" ? "bg-[#F0FDF4]" : dept.status === "rejected" ? "bg-[#FEF2F2]" : "bg-[#F8F8FA]"}`}>
                  {dept.status === "approved" ? <Check size={14} className="text-[#16A34A]" /> : dept.status === "rejected" ? <X size={14} className="text-[#DC2626]" /> : <Clock size={14} className="text-mt-ink-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-mt-ink">{dept.departmentName}</p>
                  <p className="text-[11px] text-mt-ink-4">{dept.contactEmail}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${dept.status === "approved" ? "bg-[#F0FDF4] text-[#16A34A]" : dept.status === "rejected" ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#F8F8FA] text-mt-ink-4"}`}>
                  {dept.status}
                </span>
                {dept.status === "pending" && (
                  <button
                    onClick={() => sendReminder(dept.id)}
                    disabled={remindingId === dept.id || remindingAll}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-mt-border text-mt-ink-2 hover:border-[#999] hover:text-mt-ink transition-colors disabled:opacity-50"
                    title="Resend approval email to this department"
                  >
                    {remindingId === dept.id ? <Loader2 size={11} className="animate-spin" /> : <BellRing size={11} />}
                    Remind
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-mt-ink-4 py-2">No departments added yet. Share this proposal with your team below.</p>
        )}

        {/* Rejection notes */}
        {departments.filter(d => d.status === "rejected" && d.rejectionNotes).map(dept => (
          <div key={`rej-${dept.id}`} className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 mb-3">
            <p className="text-[11px] font-semibold text-[#DC2626] mb-1">{dept.departmentName} — Rejection Note:</p>
            <p className="text-[12px] text-[#991B1B]">{dept.rejectionNotes}</p>
          </div>
        ))}

        {/* Actions row */}
        <div className="flex items-center gap-3 mb-3">
          <button
            className="flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
            style={{ color: primaryColor }}
            onClick={() => setShowAddDept(!showAddDept)}
          >
            {showAddDept ? <ChevronUp size={14} /> : <PlusCircle size={14} />}
            {showAddDept ? "Hide" : "Share with Departments"}
          </button>
          {pendingCount > 0 && (
            <button
              className="flex items-center gap-1.5 text-[12px] font-medium text-mt-ink-2 hover:text-mt-ink transition-colors disabled:opacity-50"
              onClick={() => sendReminder()}
              disabled={remindingAll}
              title="Resend to every pending approver"
            >
              {remindingAll ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
              Remind All Pending ({pendingCount})
            </button>
          )}
        </div>

        {showAddDept && (
          <div className="bg-[#F8F8FA] rounded-lg p-4">
            {newDepts.map((dept, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                <input className="px-3 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white" placeholder="Department name *" value={dept.name} onChange={(e) => updateNewDept(idx, "name", e.target.value)} />
                <input className="px-3 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white" placeholder="Contact name" value={dept.contactName} onChange={(e) => updateNewDept(idx, "contactName", e.target.value)} />
                <input className="px-3 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white" placeholder="Email *" value={dept.contactEmail} onChange={(e) => updateNewDept(idx, "contactEmail", e.target.value)} />
                <div className="flex gap-2">
                  <input className="flex-1 px-3 py-2 text-[12px] border border-mt-border rounded-md outline-none focus:border-[#999] bg-white" placeholder="Description" value={dept.description} onChange={(e) => updateNewDept(idx, "description", e.target.value)} />
                  {newDepts.length > 1 && <button className="p-2 text-[#DC2626] hover:bg-[#FEF2F2] rounded" onClick={() => removeNewDeptRow(idx)}><X size={14} /></button>}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button className="text-[11px] font-medium text-mt-ink-2 hover:text-mt-ink transition-colors" onClick={addNewDeptRow}>+ Add another</button>
              <div className="flex-1" />
              <button
                className="px-4 py-2 text-[12px] font-bold text-white rounded-md hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: primaryColor }}
                onClick={handleForwardToDepts}
                disabled={forwarding || newDepts.every(d => !d.name.trim() || !d.contactEmail.trim())}
              >
                {forwarding ? <><Loader2 size={13} className="animate-spin" /> Sending...</> : <><Send size={13} /> Forward</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
