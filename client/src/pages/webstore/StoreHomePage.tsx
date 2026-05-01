/**
 * StoreHomePage — Template router.
 * Reads store.template and delegates to the correct layout component:
 * - "classic"  → StoreTemplateClassic  (sidebar nav + grid)
 * - "modern"   → StoreTemplateModern   (full-width hero + card grid) [default]
 * - "minimal"  → StoreTemplateMinimal  (editorial single-column)
 */
import { useStore } from "./StoreContext";
import StoreTemplateClassic from "./StoreTemplateClassic";
import StoreTemplateModern from "./StoreTemplateModern";
import StoreTemplateMinimal from "./StoreTemplateMinimal";

export default function StoreHomePage() {
  const { store } = useStore();
  const template = store.template || "modern";

  if (template === "classic") return <StoreTemplateClassic />;
  if (template === "minimal") return <StoreTemplateMinimal />;
  return <StoreTemplateModern />;
}
