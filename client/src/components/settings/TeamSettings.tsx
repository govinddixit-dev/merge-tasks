import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Users, UserPlus, Mail, Shield, Crown, Trash2, Loader2,
  CheckCircle, XCircle, Building2
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Crown className="w-3.5 h-3.5 text-yellow-500" />,
  admin: <Shield className="w-3.5 h-3.5 text-blue-500" />,
  member: <Users className="w-3.5 h-3.5 text-gray-400" />,
};

interface TeamSettingsProps {
  organizationId: number;
}

export default function TeamSettings({ organizationId }: TeamSettingsProps) {
  const utils = trpc.useUtils();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data: org, isLoading } = trpc.organizations.get.useQuery({ id: organizationId });
  const { data: me } = trpc.auth.me.useQuery();

  const inviteMutation = trpc.organizations.invite.useMutation({
    onSuccess: () => {
      setInviteEmail("");
      setInviteSuccess(true);
      setInviteError(null);
      utils.organizations.get.invalidate({ id: organizationId });
      setTimeout(() => setInviteSuccess(false), 4000);
    },
    onError: (err) => {
      setInviteError(err.message);
      setInviteSuccess(false);
    },
  });

  const removeMemMutation = trpc.organizations.removeMember.useMutation({
    onSuccess: () => utils.organizations.get.invalidate({ id: organizationId }),
  });

  const updateRoleMutation = trpc.organizations.updateMemberRole.useMutation({
    onSuccess: () => utils.organizations.get.invalidate({ id: organizationId }),
  });

  const myMembership = org?.members.find((m) => m.userId === me?.id);
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin";

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    inviteMutation.mutate({ organizationId, email: inviteEmail.trim(), role: inviteRole });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!org) return null;

  const acceptedMembers = org.members.filter((m) => m.inviteAcceptedAt || m.userId);
  const pendingInvites = org.members.filter((m) => !m.inviteAcceptedAt && !m.userId && m.inviteEmail);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="w-6 h-6 text-blue-600" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{org.name}</h2>
          <p className="text-sm text-gray-500">{acceptedMembers.length} member{acceptedMembers.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Invite Form */}
      {canManage && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            Invite Team Member
          </h3>
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {inviteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Send Invite
            </button>
          </form>
          {inviteSuccess && (
            <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> Invite sent successfully!
            </p>
          )}
          {inviteError && (
            <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
              <XCircle className="w-4 h-4" /> {inviteError}
            </p>
          )}
        </div>
      )}

      {/* Members List */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Members</h3>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {acceptedMembers.map((member) => (
            <div key={member.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm">
                  {(member.userName || member.userEmail || "?")[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{member.userName || member.userEmail || "Unknown"}</p>
                  {member.userName && <p className="text-xs text-gray-400">{member.userEmail}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {canManage && member.role !== "owner" && member.userId !== me?.id ? (
                  <select
                    value={member.role ?? "member"}
                    onChange={(e) =>
                      updateRoleMutation.mutate({
                        organizationId,
                        memberId: member.id,
                        role: e.target.value as "admin" | "member",
                      })
                    }
                    className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {ROLE_ICONS[member.role ?? "member"]}
                    {ROLE_LABELS[member.role ?? "member"]}
                  </span>
                )}
                {canManage && member.role !== "owner" && member.userId !== me?.id && (
                  <button
                    onClick={() => removeMemMutation.mutate({ organizationId, memberId: member.id })}
                    disabled={removeMemMutation.isPending}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove member"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pending Invites</h3>
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between px-4 py-3 bg-yellow-50">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-yellow-500" />
                  <div>
                    <p className="text-sm text-gray-700">{invite.inviteEmail}</p>
                    <p className="text-xs text-gray-400">Invite pending — {ROLE_LABELS[invite.role ?? "member"]}</p>
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={() => removeMemMutation.mutate({ organizationId, memberId: invite.id })}
                    disabled={removeMemMutation.isPending}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    title="Cancel invite"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
