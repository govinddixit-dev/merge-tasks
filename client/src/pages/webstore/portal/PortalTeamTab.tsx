/**
 * PortalTeamTab — Team member management grouped by department.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Users, Plus, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { MergeTasksLoader } from "@/components/MergeTasksLoader";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "./portalHelpers";

interface TeamTabProps {
  storeSlug: string;
  pc: string;
}

export function PortalTeamTab({ storeSlug, pc }: TeamTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ id: number; label: string } | null>(null);
  const [newUser, setNewUser] = useState({
    email: "",
    name: "",
    role: "employee" as "admin" | "manager" | "employee" | "intern",
    department: "",
    spendingLimit: "",
  });

  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.storePortal.departments.list.useQuery(
    { storeSlug },
    { retry: false }
  );

  const addMut = trpc.storePortal.departments.add.useMutation({
    onSuccess: () => {
      toast.success("Team member added");
      setShowAddForm(false);
      setNewUser({ email: "", name: "", role: "employee", department: "", spendingLimit: "" });
      utils.storePortal.departments.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't add the member");
    },
  });

  const removeMut = trpc.storePortal.departments.remove.useMutation({
    onSuccess: () => {
      toast.success("Team member removed");
      setMemberToRemove(null);
      utils.storePortal.departments.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't remove the member");
    },
  });

  if (isLoading) return <MergeTasksLoader variant="inline" message="Loading team..." />;

  // Group by department
  const departments = new Map<string, typeof members>();
  (members || []).forEach((m) => {
    const dept = m.department || "No Department";
    if (!departments.has(dept)) departments.set(dept, []);
    departments.get(dept)!.push(m);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-bold text-mt-ink">Team Members</h3>
          <p className="text-[12px] text-mt-ink-3">{members?.length || 0} members across {departments.size} department{departments.size !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white"
          style={{ backgroundColor: pc }}
        >
          <Plus size={14} /> Add Member
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="border border-mt-border rounded-lg p-5 bg-mt-surface">
          <h4 className="text-[14px] font-bold text-mt-ink mb-4">Add Team Member</h4>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Name</label>
              <input
                type="text"
                placeholder="Full name"
                value={newUser.name}
                onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Email</label>
              <input
                type="email"
                placeholder="email@company.com"
                value={newUser.email}
                onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={e => setNewUser(u => ({ ...u, role: e.target.value as "admin" | "manager" | "employee" | "intern" }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
                <option value="intern">Intern</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Department</label>
              <input
                type="text"
                placeholder="e.g., Marketing"
                value={newUser.department}
                onChange={e => setNewUser(u => ({ ...u, department: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-bold text-mt-ink-3 uppercase tracking-wide mb-1">Spending Limit (optional)</label>
            <input
              type="text"
              placeholder="e.g., 500.00"
              value={newUser.spendingLimit}
              onChange={e => setNewUser(u => ({ ...u, spendingLimit: e.target.value }))}
              className="w-full sm:w-48 px-3 py-2 rounded-lg border border-mt-border text-[13px] focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!newUser.name.trim() || !newUser.email.trim()) {
                  toast.error("Name and email are required");
                  return;
                }
                addMut.mutate({
                  storeSlug,
                  name: newUser.name,
                  email: newUser.email,
                  role: newUser.role,
                  department: newUser.department || undefined,
                  spendingLimit: newUser.spendingLimit || undefined,
                });
              }}
              disabled={addMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: pc }}
            >
              <Plus size={13} /> {addMut.isPending ? "Adding..." : "Add Member"}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Member List by Department */}
      {!members || members.length === 0 ? (
        <div className="text-center py-12 border border-mt-border rounded-lg">
          <Users size={32} className="mx-auto mb-3 text-[#D4D4D4]" />
          <p className="text-[14px] font-semibold text-mt-ink mb-1">No team members</p>
          <p className="text-[12px] text-mt-ink-3">Add team members to manage store access and spending limits</p>
        </div>
      ) : (
        Array.from(departments.entries()).map(([dept, deptMembers]) => (
          <div key={dept} className="border border-mt-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 bg-mt-surface border-b border-mt-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={14} style={{ color: pc }} />
                <h4 className="text-[13px] font-bold text-mt-ink">{dept}</h4>
                <span className="text-[11px] text-mt-ink-3">({(deptMembers ?? []).length})</span>
              </div>
            </div>
            <div className="divide-y divide-[#F5F5F5]">
              {(deptMembers ?? []).map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold" style={{ backgroundColor: pc }}>
                      {m.name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-mt-ink">{m.name || m.email}</p>
                      <p className="text-[11px] text-mt-ink-3">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: `${pc}15`, color: pc }}>
                      {m.role}
                    </span>
                    {m.spendingLimit && (
                      <span className="text-[11px] text-mt-ink-3">
                        Limit: {formatCurrency(m.spendingLimit)}
                      </span>
                    )}
                    <StatusBadge status={m.status} pc={pc} />
                    <button
                      onClick={() => setMemberToRemove({ id: m.id, label: m.name || m.email || "this member" })}
                      className="w-7 h-7 rounded flex items-center justify-center text-mt-ink-4 hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                      title="Remove member"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={memberToRemove !== null}
        title="Remove this team member?"
        description={
          memberToRemove
            ? <><strong>{memberToRemove.label}</strong> will lose access to this store. You can add them again any time.</>
            : null
        }
        confirmLabel="Remove"
        loading={removeMut.isPending}
        onCancel={() => setMemberToRemove(null)}
        onConfirm={() => {
          if (!memberToRemove) return;
          removeMut.mutate({ storeSlug, userId: memberToRemove.id });
        }}
      />
    </div>
  );
}
