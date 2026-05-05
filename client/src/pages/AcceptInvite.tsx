import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Building2, CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: invite, isLoading: inviteLoading, error: inviteError } =
    trpc.organizations.getInviteByToken.useQuery(
      { token },
      { enabled: !!token, retry: false }
    );

  const acceptMutation = trpc.organizations.acceptInvite.useMutation({
    onSuccess: () => {
      setAccepted(true);
      setTimeout(() => navigate("/dashboard"), 2500);
    },
    onError: (err) => setError(err.message),
  });

  const { data: me } = trpc.auth.me.useQuery();

  function handleAccept() {
    if (!token) return;
    acceptMutation.mutate({ token });
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Invite Link</h2>
          <p className="text-gray-500">This invite link is missing a token. Please check the link in your email.</p>
        </div>
      </div>
    );
  }

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (inviteError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invite Not Found</h2>
          <p className="text-gray-500">This invite link has expired or has already been used.</p>
        </div>
      </div>
    );
  }

  if (invite.inviteAcceptedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Already Accepted</h2>
          <p className="text-gray-500">This invite has already been accepted.</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to the team!</h2>
          <p className="text-gray-500">You've joined <strong>{invite.orgName}</strong>. Redirecting to dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <Building2 className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Team Invitation</h2>
          <p className="text-gray-500 mt-2">
            You've been invited to join <strong>{invite.orgName}</strong> as a <strong>{invite.role}</strong>.
          </p>
          {invite.inviteEmail && (
            <p className="text-sm text-gray-400 mt-1">Invite sent to: {invite.inviteEmail}</p>
          )}
        </div>

        {!me ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 text-center">You need to be signed in to accept this invitation.</p>
            <button
              onClick={() => navigate(`/sign-in?redirect=/accept-invite?token=${token}`)}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Sign In to Accept
            </button>
            <button
              onClick={() => navigate(`/sign-up?redirect=/accept-invite?token=${token}`)}
              className="w-full py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Create Account & Accept
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 text-center">
              Signed in as <strong>{me.email}</strong>
            </p>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
            <button
              onClick={handleAccept}
              disabled={acceptMutation.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {acceptMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Accept Invitation
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-1">
              By accepting, you agree to MergeTasks'{" "}
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms of Service</a>{" "}and{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.
            </p>
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Decline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
