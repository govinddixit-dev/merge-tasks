/**
 * BrandRoot — sets the per-store brand accent CSS variable so the Modern
 * template's `bg-brand` / `text-brand` / `border-brand` utilities resolve
 * to the distributor's chosen color (`store.primaryColor`).
 *
 * Wireframe handoff §01_DESIGN_SYSTEM.md describes brand context as a per-
 * webstore CSS variable cascading down from the storefront root. We don't
 * change tRPC — we simply map the existing `primaryColor` field onto
 * `--brand-accent`, which `index.css` resolves via `--color-brand`.
 */
import type { CSSProperties, ReactNode } from "react";
import { useStore } from "../StoreContext";

type Props = { children: ReactNode };

export function BrandRoot({ children }: Props) {
  const { store } = useStore();
  const style = { "--brand-accent": store.primaryColor } as CSSProperties;
  return <div style={style}>{children}</div>;
}
