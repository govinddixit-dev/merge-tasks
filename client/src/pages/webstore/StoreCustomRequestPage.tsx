/**
 * StoreCustomRequestPage — template dispatcher. See StoreCartPage.tsx.
 */
import { useTemplate } from "./templates/useTemplate";
import ModernCustomRequest from "./templates/modern/ModernCustomRequest";
import StoreCustomRequestPageLegacy from "./StoreCustomRequestPage.legacy";

export default function StoreCustomRequestPage() {
  const template = useTemplate();
  if (template === "modern") return <ModernCustomRequest />;
  return <StoreCustomRequestPageLegacy />;
}
