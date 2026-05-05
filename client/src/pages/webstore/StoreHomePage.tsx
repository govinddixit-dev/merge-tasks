/**
 * StoreHomePage — Template router.
 * Reads store.template and delegates to the correct layout component:
 * - "classic"  → StoreTemplateClassic        (legacy sidebar nav + grid)
 * - "modern"   → templates/modern/ModernHome (wireframe-driven, Phase 4)
 * - "minimal"  → StoreTemplateMinimal        (legacy editorial single-column)
 */
import { useStore } from "./StoreContext";
import StoreTemplateClassic from "./StoreTemplateClassic";
import StoreTemplateMinimal from "./StoreTemplateMinimal";
import ModernHome from "./templates/modern/ModernHome";

export default function StoreHomePage() {
  const { store } = useStore();
  const template = store.template || "modern";

  if (template === "classic") return <StoreTemplateClassic />;
  if (template === "minimal") return <StoreTemplateMinimal />;
  return <ModernHome />;
}
