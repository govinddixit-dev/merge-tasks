/**
 * useIsMobile — Detects whether the viewport is below the mobile breakpoint.
 *
 * Uses `window.matchMedia` to subscribe to viewport changes and returns
 * a boolean (`true` when width < 768px). Returns `undefined` on first render
 * before the media query resolves (SSR-safe).
 *
 * @module client/hooks/useMobile
 */
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
