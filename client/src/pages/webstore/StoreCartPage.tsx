/**
 * StoreCartPage — template dispatcher.
 *
 * Reads the active webstore template and routes to the matching variant.
 * Modern is rebuilt against the wireframe handoff (Phase 4); Classic and
 * Minimal still render the legacy shared cart until those templates are
 * rebuilt in a later phase.
 */
import { useTemplate } from "./templates/useTemplate";
import ModernCart from "./templates/modern/ModernCart";
import StoreCartPageLegacy from "./StoreCartPage.legacy";

export default function StoreCartPage() {
  const template = useTemplate();
  if (template === "modern") return <ModernCart />;
  return <StoreCartPageLegacy />;
}
