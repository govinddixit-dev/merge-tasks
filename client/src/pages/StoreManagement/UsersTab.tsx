/**
 * UsersTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Users tab for StoreManagement: list of provisioned store users with
 * inline editing, remove, resend-invite actions, and an "Add User" modal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import { Users, Edit, Trash2, RefreshCw, Mail, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { StoreUser } from "./StoreManagementTypes";
import CsvUploadModal from "./CsvUploadModal";

interface AddUserForm {
  name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "intern";
  department: string;
  spendingLimit: string;
}

interface EditingUser {
  id: number;
  name?: string | null;
  email: string;
  role?: string;
  department?: string | null;
  spendingLimit?: string | null;
  [key: string]: unknown;
}

interface UsersTabProps {
  isNumeric: boolean;
  numericId: number;
  storeUsersData: { users?: StoreUser[] } | StoreUser[] | undefined;
  refetchUsers: () => void;
  showAddUserModal: boolean;
  setShowAddUserModal: (v: boolean) => void;
  editingUser: EditingUser | null;
  setEditingUser: (u: EditingUser | null) => void;
  addUserForm: AddUserForm;
  setAddUserForm: (f: AddUserForm) => void;
  removingUserId: number | null;
  setRemovingUserId: (id: number | null) => void;
}

export function UsersTab({
  isNumeric,
  numericId,
  storeUsersData,
  refetchUsers,
  showAddUserModal,
  setShowAddUserModal,
  editingUser,
  setEditingUser,
  addUserForm,
  setAddUserForm,
  removingUserId,
  setRemovingUserId,
}: UsersTabProps) {
  const [deactivateTarget, setDeactivateTarget] = React.useState<{ id: number; label: string } | null>(null);
  const [showCsvModal, setShowCsvModal] = React.useState(false);
  const provisionUsersMut = trpc.storeProvisioning.provisionUsers.useMutation({
    onSuccess: () => {
      refetchUsers();
      setShowAddUserModal(false);
      setAddUserForm({ name: "", email: "", role: "employee", department: "", spendingLimit: "" });
      toast.success("User invited — password setup email sent");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateUserMut = trpc.storeProvisioning.updateUser.useMutation({
    onSuccess: () => {
      refetchUsers();
      setEditingUser(null);
      toast.success("User updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeUserMut = trpc.storeProvisioning.removeUser.useMutation({
    onSuccess: () => {
      refetchUsers();
      setRemovingUserId(null);
      toast.success("User deactivated — order history preserved");
    },
    onError: (e) => toast.error(e.message),
  });

  const resendInviteMut = trpc.storeProvisioning.resendInvite.useMutation({
    onSuccess: () => toast.success("Invitation resent"),
    onError: (e) => toast.error(e.message),
  });

  const usersSource = storeUsersData;
  const users: StoreUser[] = Array.isArray(usersSource) ? usersSource : usersSource?.users || [];

  const roleColors: Record<string, string> = {
    admin: "bg-[#F5F3FF] text-primary",
    manager: "bg-[#EFF6FF] text-[#3B82F6]",
    employee: "bg-[#F0FDF4] text-[#16A34A]",
    intern: "bg-mt-surface-2 text-mt-ink-3",
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 sm:gap-0">
        <div>
          <h3 className="text-[14px] font-bold text-mt-ink">Store Users</h3>
          <p className="text-[12px] text-mt-ink-4 mt-0.5">
            {users.length} user{users.length !== 1 ? "s" : ""} with access to this store
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="sq-action-btn flex items-center gap-1.5 text-[12px]"
            onClick={() => {
              if (!isNumeric) {
                toast("Demo store — user management requires a real store");
                return;
              }
              setShowCsvModal(true);
            }}
          >
            <Upload size={13} /> Bulk Upload
          </button>
          <button
            className="sq-action-btn primary flex items-center gap-1.5 text-[12px]"
            onClick={() => {
              if (!isNumeric) {
                toast("Demo store — user management requires a real store");
                return;
              }
              setShowAddUserModal(true);
            }}
          >
            <Users size={13} /> Add User
          </button>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="bg-white rounded-lg border border-mt-border p-12 text-center">
          <Users size={32} className="text-[#D4D4D4] mx-auto mb-3" />
          <p className="text-[14px] font-semibold text-mt-ink mb-1">No users yet</p>
          <p className="text-[12px] text-mt-ink-4">
            Add users to give them access to this store.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-mt-border overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr style={{ borderBottom: "1px solid #F0F0F0" }}>
                {["User", "Role", "Department", "Spending Limit", "Status", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left px-5 py-3 text-[10px] font-semibold text-mt-ink-4 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user: StoreUser, i: number) => (
                <tr
                  key={user.id}
                  className="hover:bg-mt-surface transition-colors"
                  style={{ borderBottom: i < users.length - 1 ? "1px solid #F5F5F5" : "none" }}
                >
                  <td className="px-5 py-3.5">
                    {editingUser?.id === user.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          className="px-2 py-1 text-[12px] border border-mt-border rounded outline-none focus:border-primary"
                          value={editingUser.name ?? ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, name: e.target.value })
                          }
                          placeholder="Name"
                        />
                        <input
                          className="px-2 py-1 text-[12px] border border-mt-border rounded outline-none focus:border-primary"
                          value={editingUser.email}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, email: e.target.value })
                          }
                          placeholder="Email"
                          type="email"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="text-[13px] font-semibold text-mt-ink">{user.name}</div>
                        <div className="text-[11px] text-mt-ink-4">{user.email}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {editingUser?.id === user.id ? (
                      <select
                        className="px-2 py-1 text-[12px] border border-mt-border rounded outline-none focus:border-primary"
                        value={editingUser.role}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, role: e.target.value })
                        }
                      >
                        {["admin", "manager", "employee", "intern"].map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          (user.role ? roleColors[user.role] : undefined) || "bg-mt-surface-2 text-mt-ink-3"
                        }`}
                      >
                        {(user.role?.charAt(0).toUpperCase() ?? "") + (user.role?.slice(1) ?? "")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] text-mt-ink-3">
                    {editingUser?.id === user.id ? (
                      <input
                        className="px-2 py-1 text-[12px] border border-mt-border rounded outline-none focus:border-primary"
                        value={editingUser.department || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, department: e.target.value })
                        }
                        placeholder="Department"
                      />
                    ) : (
                      user.department || "—"
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] text-mt-ink-3 data-mono">
                    {editingUser?.id === user.id ? (
                      <input
                        className="px-2 py-1 text-[12px] border border-mt-border rounded outline-none focus:border-primary w-24"
                        value={editingUser.spendingLimit || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, spendingLimit: e.target.value })
                        }
                        placeholder="e.g. 500"
                      />
                    ) : user.spendingLimit ? (
                      `$${parseFloat(user.spendingLimit).toLocaleString()}`
                    ) : (
                      "Unlimited"
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        user.status === "active"
                          ? "bg-[#F0FDF4] text-[#16A34A]"
                          : user.status === "pending"
                          ? "bg-[#FEF3C7] text-[#D97706]"
                          : "bg-mt-surface-2 text-mt-ink-3"
                      }`}
                    >
                      {(user.status?.charAt(0).toUpperCase() ?? "") + (user.status?.slice(1) ?? "") || "Active"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1">
                      {editingUser?.id === user.id ? (
                        <>
                          <button
                            className="text-[11px] font-semibold text-primary hover:underline"
                            disabled={updateUserMut.isPending}
                            onClick={() =>
                              updateUserMut.mutate({
                                storeUserId: user.id,
                                name: editingUser.name ?? undefined,
                                role: editingUser.role as "admin" | "manager" | "employee" | "intern" | undefined,
                                department: editingUser.department ?? undefined,
                                spendingLimit: editingUser.spendingLimit ?? undefined,
                              })
                            }
                          >
                            {updateUserMut.isPending ? "Saving..." : "Save"}
                          </button>
                          <button
                            className="text-[11px] font-semibold text-mt-ink-3 hover:underline"
                            onClick={() => setEditingUser(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="p-1 rounded hover:bg-mt-surface-2 transition-colors"
                            title="Edit user"
                            onClick={() => setEditingUser({ ...user })}
                          >
                            <Edit size={13} className="text-mt-ink-4" />
                          </button>
                          {user.status === "pending" && (
                            <button
                              className="p-1 rounded hover:bg-mt-surface-2 transition-colors"
                              title="Resend invite"
                              onClick={() =>
                                resendInviteMut.mutate({ storeUserId: user.id, origin: window.location.origin })
                              }
                            >
                              <Mail size={13} className="text-mt-ink-4" />
                            </button>
                          )}
                          <button
                            className="p-1 rounded hover:bg-[#FEF2F2] transition-colors"
                            title="Remove user"
                            disabled={removingUserId === user.id}
                            onClick={() => setDeactivateTarget({ id: user.id, label: user.name || user.email || "this user" })}
                          >
                            {removingUserId === user.id ? (
                              <RefreshCw size={13} className="text-[#EF4444] animate-spin" />
                            ) : (
                              <Trash2 size={13} className="text-[#EF4444]" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div
          className="fixed inset-0 bg-black/40 z-[10002] flex items-center justify-center p-4"
          onClick={() => setShowAddUserModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-mt-ink mb-1">Add User</h3>
            <p className="text-[12px] text-mt-ink-4 mb-4">
              Invite a new user to this store. They will receive a password setup email.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                  Full Name
                </label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                  value={addUserForm.name}
                  onChange={(e) => setAddUserForm({ ...addUserForm, name: e.target.value })}
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
                  placeholder="jane@company.com"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                    Role
                  </label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                    value={addUserForm.role}
                    onChange={(e) =>
                      setAddUserForm({
                        ...addUserForm,
                        role: e.target.value as "admin" | "manager" | "employee" | "intern",
                      })
                    }
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                    Department
                  </label>
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                    value={addUserForm.department}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, department: e.target.value })
                    }
                    placeholder="Engineering"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-mt-ink-3 mb-1">
                  Spending Limit (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-mt-ink-3">
                    $
                  </span>
                  <input
                    type="number"
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-mt-border text-[13px] outline-none focus:border-primary"
                    value={addUserForm.spendingLimit}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, spendingLimit: e.target.value })
                    }
                    placeholder="Unlimited"
                    min="0"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                className="flex-1 py-2.5 text-[13px] font-semibold text-mt-ink-3 rounded-lg border border-mt-border hover:bg-mt-surface-2"
                onClick={() => setShowAddUserModal(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 text-[13px] font-semibold text-white rounded-lg bg-primary hover:bg-[#4F3BC7] disabled:opacity-60 flex items-center justify-center gap-1"
                disabled={!addUserForm.email || !addUserForm.name || provisionUsersMut.isPending}
                onClick={() => {
                  provisionUsersMut.mutate({
                    storeId: numericId,
                    origin: window.location.origin,
                    users: [
                      {
                        name: addUserForm.name,
                        email: addUserForm.email,
                        role: addUserForm.role,
                        department: addUserForm.department || undefined,
                      },
                    ],
                  });
                }}
              >
                {provisionUsersMut.isPending ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" /> Sending...
                  </>
                ) : (
                  "Send Invite"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <CsvUploadModal
        open={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        storeId={numericId}
        onSuccess={refetchUsers}
      />
      <ConfirmDialog
        open={deactivateTarget !== null}
        title="Deactivate this user?"
        description={
          deactivateTarget
            ? <>{deactivateTarget.label} will lose access to the store immediately. Their order history stays intact.</>
            : null
        }
        confirmLabel="Deactivate"
        loading={removingUserId !== null}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (!deactivateTarget) return;
          setRemovingUserId(deactivateTarget.id);
          removeUserMut.mutate(
            { storeUserId: deactivateTarget.id },
            { onSettled: () => setDeactivateTarget(null) },
          );
        }}
      />
    </>
  );
}
