/**
 * DistributorSessionTimeout — mounts once inside ProtectedRoute / AdminRoute.
 *
 * Owns:
 *   - the 2h inactivity timer for distributor sessions
 *   - the "Still there?" warning modal (shown at 1h 45min)
 *   - the actual logout call on expiry, with redirect to /login?logout=inactive
 *   - cross-tab sync so a logout anywhere kicks every open distributor tab
 *
 * The timer is gated on `isAuthenticated` so we don't fire on the sign-in
 * page itself. `useAuth` is already the single source of truth for session
 * state and exposes the shared `logout()` mutation wrapper.
 */
import { useCallback, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useInactivityTimer } from "@/_core/hooks/useInactivityTimer";
import { useLogoutBroadcast } from "@/_core/hooks/useLogoutBroadcast";
import { SessionTimeoutModal } from "./SessionTimeoutModal";

const DISTRIBUTOR_TIMEOUT_MS = 2 * 60 * 60 * 1000;          // 2 hours
const DISTRIBUTOR_WARNING_LEAD_MS = 15 * 60 * 1000;         // 15 minutes before
const CHANNEL_NAME = "mergetasks-distributor-session";

export function DistributorSessionTimeout() {
  const { isAuthenticated, logout } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  const performLogoutAndRedirect = useCallback(
    async (redirect: string) => {
      try {
        await logout();
      } catch {
        // logout() already handles UNAUTHORIZED; any other error is benign —
        // we still want the UI to land on the login page.
      }
      window.location.href = redirect;
    },
    [logout],
  );

  const { broadcast } = useLogoutBroadcast(CHANNEL_NAME, (reason) => {
    // Another tab logged out — drop this tab too. Preserve the inactivity
    // hint on the redirect so the login page can explain what happened.
    const suffix = reason === "inactivity" ? "?logout=inactive" : "";
    performLogoutAndRedirect(`/sign-in${suffix}`);
  });

  const { secondsRemaining, reset } = useInactivityTimer({
    enabled: isAuthenticated,
    timeoutMs: DISTRIBUTOR_TIMEOUT_MS,
    warningLeadMs: DISTRIBUTOR_WARNING_LEAD_MS,
    onWarning: () => setModalOpen(true),
    onTimeout: () => {
      setModalOpen(false);
      broadcast("inactivity");
      performLogoutAndRedirect("/sign-in?logout=inactive");
    },
  });

  const handleStay = useCallback(() => {
    setModalOpen(false);
    reset();
  }, [reset]);

  const handleLogoutNow = useCallback(() => {
    setModalOpen(false);
    broadcast("manual");
    performLogoutAndRedirect("/sign-in");
  }, [broadcast, performLogoutAndRedirect]);

  if (!isAuthenticated) return null;

  return (
    <SessionTimeoutModal
      open={modalOpen}
      secondsRemaining={secondsRemaining}
      onStay={handleStay}
      onLogout={handleLogoutNow}
    />
  );
}
