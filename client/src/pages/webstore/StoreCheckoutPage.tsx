/**
 * StoreCheckoutPage — template dispatcher.
 *
 * See StoreCartPage.tsx for the dispatcher pattern. Modern gets the new
 * wireframe-driven UI in Phase 4; Classic + Minimal continue to render the
 * legacy shared checkout.
 */
import { useTemplate } from "./templates/useTemplate";
import ModernCheckout from "./templates/modern/ModernCheckout";
import StoreCheckoutPageLegacy from "./StoreCheckoutPage.legacy";

export default function StoreCheckoutPage() {
  const template = useTemplate();
  if (template === "modern") return <ModernCheckout />;
  return <StoreCheckoutPageLegacy />;
}
