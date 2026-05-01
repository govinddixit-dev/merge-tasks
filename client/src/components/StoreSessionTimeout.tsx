/**
 * StoreSessionTimeout — inactivity watchdog for store portal sessions
 * (employees + POC). Mounted inside LiveStore once the session is logged in.
 *
 *   - 30 minute total inactivity window
 *   - Warning at 25 minutes (5 min before logout)
 *   - Logout redirects to /s/{slug}/login?logout=inactive
 *   - Cross-tab broadcast scoped to the store slug so logouts in one store
 *     portal don't affect open tabs on a different store or the distributor
 *     console.
 */
import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useInactivityTimer } from "@/_core/hooks/useInactivityTimer";
import { useLogoutBroadcast } from "@/_core/hooks/useLogoutBroadcast";
import { SessionTimeoutModal } from "./SessionTimeoutModal";

const STORE_TIMEOUT_MS = 30 * 60 * 1000;       // 30 minutes
const STORE_WARNING_LEAD_MS = 5 * 60 * 1000;   // 5 minutes before

interface StoreSessionTimeoutProps {
  /** URL slug of the active store — scopes both cookie logout and broadcast. */
  storeSlug: string;
  /** Indicates a logged-in store user exists. When false, timer is disabled. */
  isLoggedIn: boolean;
  /** Context-level logout callback that clears client-side session state. */
  onLogoutLocal: () => void;
}

export function StoreSessionTimeout({
  storeSlug,
  isLoggedIn,
  onLogoutLocal,
}: StoreSessionTimeoutProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const storeLogoutMut = trpc.storeAuth.logout.useMutation();

  const performLogoutAndRedirect = useCallback(
    async (reasonQuery: string) => {
      try {
        await storeLogoutMut.mutateAsync({ storeSlug });
      } catch {
        // Best-effort server-side clear; local state + redirect matter more.
      }
      onLogoutLocal();
      window.location.href = `/s/${storeSlug}/login${reasonQuery}`;
    },
    [storeLogoutMut, storeSlug, onLogoutLocal],
  );

  const { broadcast } = useLogoutBroadcast(
    `mergetasks-store-session:${storeSlug}`,
    (reason) => {
      const suffix = reason === "inactivity" ? "?logout=inactive" : "";
      performLogoutAndRedirect(suffix);
    },
  );

  const { secondsRemaining, reset } = useInactivityTimer({
    enabled: isLoggedIn,
    timeoutMs: STORE_TIMEOUT_MS,
    warningLeadMs: STORE_WARNING_LEAD_MS,
    onWarning: () => setModalOpen(true),
    onTimeout: () => {
      setModalOpen(false);
      broadcast("inactivity");
      performLogoutAndRedirect("?logout=inactive");
    },
  });

  const handleStay = useCallback(() => {
    setModalOpen(false);
    reset();
  }, [reset]);

  const handleLogoutNow = useCallback(() => {
    setModalOpen(false);
    broadcast("manual");
    performLogoutAndRedirect("");
  }, [broadcast, performLogoutAndRedirect]);

  if (!isLoggedIn) return null;

  return (
    <SessionTimeoutModal
      open={modalOpen}
      secondsRemaining={secondsRemaining}
      onStay={handleStay}
      onLogout={handleLogoutNow}
    />
  );
}
