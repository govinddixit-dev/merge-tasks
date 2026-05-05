/**
 * useTemplate — single source of truth for which template the active webstore
 * is using. Reads `store.template` from StoreContext and normalizes anything
 * unknown to "modern" (the default in StoreHomePage today).
 *
 * Per-page dispatchers (StoreCartPage, StoreCheckoutPage, StoreCustomRequestPage,
 * StoreProductsPage) call this to decide which variant to render. Modern gets
 * the new wireframe-driven UI; classic + minimal still render the legacy pages
 * until those templates are rebuilt in a later phase.
 */
import { useStore } from "../StoreContext";

export type Template = "modern" | "classic" | "minimal";

export function useTemplate(): Template {
  const { store } = useStore();
  const t = store.template;
  if (t === "classic" || t === "minimal") return t;
  return "modern";
}

/**
 * The Modern template owns its own header / footer chrome (centered logo,
 * curtain-reveal scroll, etc.). Classic + Minimal keep using the global
 * <StoreHeader /> + <StoreFooter /> from LiveStore until they are rebuilt.
 *
 * LiveStore reads this flag to decide whether to mount its own chrome.
 */
export function templateOwnsChrome(t: Template): boolean {
  return t === "modern";
}
