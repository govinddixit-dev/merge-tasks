/**
 * StoreProductsPage — template dispatcher. See StoreCartPage.tsx.
 */
import { useTemplate } from "./templates/useTemplate";
import ModernShop from "./templates/modern/ModernShop";
import StoreProductsPageLegacy from "./StoreProductsPage.legacy";

export default function StoreProductsPage() {
  const template = useTemplate();
  if (template === "modern") return <ModernShop />;
  return <StoreProductsPageLegacy />;
}
