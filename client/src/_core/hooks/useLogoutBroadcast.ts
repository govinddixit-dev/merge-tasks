/**
 * useLogoutBroadcast — cross-tab logout synchronisation.
 *
 * When one tab triggers a logout we want every open tab to drop the
 * session immediately rather than leaving a stale authenticated view
 * running until its own activity timer fires. Implemented on top of
 * BroadcastChannel (standard in all supported browsers); falls back to
 * `storage` events when BroadcastChannel is unavailable.
 *
 * The channel name is parameterised so distributor and store-portal
 * sessions can use independent streams (e.g. logging out of one store
 * portal should not kick the distributor out of the admin console).
 */
import { useEffect, useRef } from "react";

type LogoutReason = "inactivity" | "manual";

interface LogoutMessage {
  type: "logout";
  reason: LogoutReason;
  ts: number;
}

export interface UseLogoutBroadcastResult {
  /** Broadcast a logout event to every other tab on this channel. */
  broadcast: (reason: LogoutReason) => void;
}

/**
 * @param channelName  — isolation key; use different names for distributor
 *   vs per-store-slug sessions so they don't cross-logout each other.
 * @param onLogoutBroadcast — fired when another tab announces a logout.
 */
export function useLogoutBroadcast(
  channelName: string,
  onLogoutBroadcast: (reason: LogoutReason) => void,
): UseLogoutBroadcastResult {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlerRef = useRef(onLogoutBroadcast);
  handlerRef.current = onLogoutBroadcast;

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(channelName);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<LogoutMessage>) => {
        const msg = event.data;
        if (msg && msg.type === "logout") handlerRef.current(msg.reason);
      };
      return () => {
        channel.close();
        channelRef.current = null;
      };
    }

    // Fallback: localStorage event is dispatched to *other* tabs on write.
    const storageKey = `mergetasks:logout:${channelName}`;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue) as LogoutMessage;
        if (msg.type === "logout") handlerRef.current(msg.reason);
      } catch { /* ignore malformed */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [channelName]);

  const broadcast = (reason: LogoutReason) => {
    const msg: LogoutMessage = { type: "logout", reason, ts: Date.now() };
    if (channelRef.current) {
      try { channelRef.current.postMessage(msg); } catch { /* channel closed */ }
      return;
    }
    try {
      const storageKey = `mergetasks:logout:${channelName}`;
      localStorage.setItem(storageKey, JSON.stringify(msg));
      // Remove so a subsequent identical broadcast still fires a storage event.
      localStorage.removeItem(storageKey);
    } catch { /* localStorage unavailable */ }
  };

  return { broadcast };
}
