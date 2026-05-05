/**
 * storeThemeUtils — Derives visual theme settings from store data.
 *
 * Consumes AI branding fields (Guide 2) and template selection to produce
 * a normalized theme object used by ProductCard, StoreProductsPage,
 * StoreProductDetailPage, and StoreCartPage.
 */

import type { StoreData } from "./StoreContext";

export interface StoreTheme {
  gridCols: 3 | 4;
  imageAspect: string;
  imageEdgeToEdge: boolean;
  cardRadius: string;
  cardNameSize: string;
  ctaLabel: string;
  gridHeading: string;
  badgeStyle: "pill" | "ribbon" | "corner";
}

/**
 * Build a StoreTheme from the store's template + AI branding fields.
 * All AI fields use `??` fallbacks — safe when null/undefined.
 */
export function getStoreTheme(store: StoreData): StoreTheme {
  const template = store.template ?? "modern";

  const gridCols: 3 | 4 = template === "classic" ? 4 : template === "minimal" ? 3 : 4;

  const imageAspect =
    template === "minimal"
      ? "aspect-[4/5]"
      : template === "classic"
        ? "aspect-square"
        : "aspect-[3/4]";

  const imageEdgeToEdge = template === "minimal";

  const cardRadius =
    template === "minimal"
      ? "rounded-lg"
      : template === "classic"
        ? "rounded-xl"
        : "rounded-xl";

  const cardNameSize =
    template === "minimal" ? "text-[14px]" : "text-[15px]";

  const ctaLabel =
    store.aiProductPageCTA ?? (template === "minimal" ? "Add to Bag" : "Add to Cart");

  const gridHeading =
    store.aiProductGridHeading ??
    (store.client?.companyName ? `${store.client.companyName} Products` : "All Products");

  const badgeStyle: "pill" | "ribbon" | "corner" =
    store.aiProductBadgeStyle ??
    (template === "minimal" ? "pill" : template === "modern" ? "ribbon" : "corner");

  return {
    gridCols,
    imageAspect,
    imageEdgeToEdge,
    cardRadius,
    cardNameSize,
    ctaLabel,
    gridHeading,
    badgeStyle,
  };
}
