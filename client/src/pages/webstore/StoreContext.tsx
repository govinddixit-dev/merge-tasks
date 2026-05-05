/**
 * StoreContext — shared state and types for the LiveStore storefront.
 * All sub-pages (Header, Home, Products, Cart, Checkout, Login, etc.)
 * consume this context via `useStore()`.
 */

import { createContext, useContext } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Shirt, Coffee, Laptop, Briefcase, PenTool, Heart, TreePine, BookOpen, Package, Sparkles,
} from "lucide-react";

//  Types 

/**
 * PlacementZone — defines where the client logo sits on a product image.
 * All values are percentages of the image container dimensions so the
 * overlay scales correctly at any card or PDP image size.
 *
 * Added as part of branded-product-visualization (feature branch).
 * No schema migration required — placement is derived heuristically from
 * product category when not explicitly set, using getDefaultPlacement().
 */
export interface PlacementZone {
  /** Unique identifier, e.g. 'leftChest' | 'fullFront' | 'back' */
  id: string;
  label: string;
  /** Left edge as % of image container width */
  x: number;
  /** Top edge as % of image container height */
  y: number;
  /** Logo render width as % of image container width */
  w: number;
  /** Opacity override — defaults to 0.90 */
  opacity?: number;
}

/**
 * Derive a sensible default placement zone from product category.
 * Used when no explicit placement metadata is stored on the product.
 * Apparel → left chest; everything else → full front center.
 */
export function getDefaultPlacement(category: string | null): PlacementZone {
  const cat = (category || "").toLowerCase();
  if (cat === "apparel" || cat === "shirts" || cat === "jackets" || cat === "polos") {
    return { id: "leftChest", label: "Left Chest", x: 16, y: 14, w: 20 };
  }
  // Default: full-front center — works for bags, drinkware, stationery, etc.
  return { id: "fullFront", label: "Full Front", x: 28, y: 22, w: 44 };
}

export interface StoreProduct {
  id: number;
  storeProductId: number | null; // FK into storeProducts — needed by checkout
  name: string;
  basePrice: string;
  customPrice: string;
  imageUrl: string | null;
  category: string | null;
  description: string | null;
  sku: string | null;
  featured: boolean;
  colors: string | null;
  sizes: string | null;
  material: string | null;
  type: "promotional" | "print";
  printAreas: string[] | null;
  printMethods: string[] | null;
  printColors: string[] | null;
  minOrderQty: number | null;
  fileSpecs: string | null;
  additionalImages: string[] | null;
  decorationMethods: string[] | null;
  pricingTiers: { minQty: number; maxQty: number; price: number }[] | null;
  /** Division visibility — null/[] = shared, otherwise restricted to listed division IDs. */
  divisionIds?: number[] | null;
  // Phase 6 — webstore AI imprint placement coordinates from the
  // webstoreImprintPlacement* columns on products. All 5 are decimal
  // strings (mysql2 / Drizzle) or varchar; null when the row hasn't
  // been analyzed yet. Read by WebstoreLogoOverlay via
  // extractWebstorePlacement(); strict all-or-nothing — half-populated
  // rows render no overlay.
  webstoreImprintPlacementX:         string | null;
  webstoreImprintPlacementY:         string | null;
  webstoreImprintPlacementWidth:     string | null;
  webstoreImprintPlacementHeight:    string | null;
  webstoreImprintPlacementBlendMode: string | null;
  // Step 6 — photorealistic nano-banana render. Non-null URL means the
  // worker has produced a customer-facing rendered image; the overlay
  // shows that image instead of compositing the CSS overlay. Null means
  // either no render yet (NULL/pending) or first-time rendering — fall
  // back to the CSS composite. webstoreRenderStatus is intentionally not
  // shipped to the client (distributor-side feedback only).
  webstoreRenderedImageUrl:          string | null;
}

export interface StoreData {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  bannerUrl: string | null;
  welcomeMessage: string | null;
  aiDescription: string | null;
  aiTagline: string | null;
  aiCategoryDescriptions: Record<string, string> | null;
  aiOptimizedAt: string | null;
  // Template & AI-generated hero content
  template: "classic" | "modern" | "minimal";
  aiHeroHeadline: string | null;
  aiHeroSubtitle: string | null;
  aiIndustryTheme: string | null;
  aiColorPalette: string[] | null;
  aiProductPageCTA?: string | null;
  aiProductGridHeading?: string | null;
  aiProductBadgeStyle?: "pill" | "ribbon" | "corner" | null;
  aiTemplateSuggestion: "classic" | "modern" | "minimal" | null;
  // Status
  status?: string | null;
  // Editor overrides
  editorHeroHeadline?: string | null;
  editorHeroSubtitle?: string | null;
  editorTagline?: string | null;
  editorWelcomeMessage?: string | null;
  editorCategoryOrder?: string[] | null;
  editorCategoryNames?: Record<string, string> | null;
  editorSubCategories?: Record<string, Array<{ id: string; name: string; productIds: number[] }>> | null;
  editorProductNames?: Record<string, string> | null;
  editorProductDescriptions?: Record<string, string> | null;
  stripeEnabled: boolean;
  ssoEnabled: boolean;
  ssoProvider: string | null;
  rbacEnabled: boolean;
  requireAuth: boolean;
  branchLocations: Array<{ id: string; name: string; address: string; isDefault?: boolean }> | null;
  allowedPaymentMethods: string[] | null;
  multiLocationEnabled: boolean;
  locations: Array<{
    id: number;
    name: string;
    slug: string;
    sortOrder: number;
    branding: {
      logoUrl: string | null;
      primaryColor: string | null;
      bannerUrl: string | null;
      bannerText: string | null;
      welcomeMessage: string | null;
      aiTagline: string | null;
    } | null;
  }>;
  client: { companyName: string; industry?: string | null; website?: string | null; logoUrl?: string | null } | null;
  products: StoreProduct[];
  // Phase 8 — variant-grouped projection. Same data as `products`, bucketed
  // by styleGroup with per-variant render URLs already gated by approval.
  // Webstore grid + PDP read this; legacy iterators continue to use
  // `products`. Optional for backward compat with cached store payloads.
  // `primary` mirrors the server's raw products row — only the subset
  // used by the card surface is typed here.
  productGroups?: Array<{
    styleGroup: string;
    primary: {
      id: number;
      name: string;
      sku: string | null;
      category: string | null;
      basePrice: string | null;
      imageUrl: string | null;
      type: "promotional" | "print" | null;
    };
    primaryStoreProductId: number | null;
    variants: Array<{
      productId: number;
      storeProductId: number | null;
      colorName: string | null;
      colorHex: string | null;
      swatchUrl: string | null;
      imageUrl: string | null;
      webstoreRenderedImageUrl: string | null;
    }>;
    variantCount: number;
  }>;
}

/**
 * Unified cart item used across promotional and print products.
 *
 * Every line has:
 *   - a unique `lineKey` so two print lines with the same underlying
 *     product but different variants don't collapse together.
 *   - a `kind` discriminator; promotional items have `storeProductId`
 *     populated and go through the Stripe/GL/PO flow, while print items
 *     carry printProductId + printVariantId + variant labels and are
 *     routed to printRequests on submit.
 *   - a `price` already normalized to USD (per-unit).
 */
export type CartItemKind = "promotional" | "print";

export interface CartItem {
  lineKey: string;               // unique per cart line
  kind: CartItemKind;
  /** products.id for promotional; printProducts.id for print */
  id: number;
  storeProductId: number | null; // storeProducts.id — only used for promotional
  name: string;
  price: number;                 // per-unit USD
  quantity: number;
  image?: string | null;
  // Print-product-only metadata. Kept optional so promo items serialize unchanged.
  printProductId?: number;
  printVariantId?: number;
  /** printProducts.productType — used to map to printRequests.category on submit. */
  printProductType?: "business_cards" | "flyers" | "banners" | "posters";
  variantLabel?: string;         // e.g. "3.5 x 2 in · 14pt Matte · 500 units"
  size?: string;
  stock?: string;
  // Promotional decoration metadata — captured when buyer picks an imprint
  // zone and decoration method on the PDP. Consumed by proposal / PO
  // generation downstream.
  imprintZoneSlug?: string;
  decorationMethod?: string;
}

export interface StoreUserData {
  id: number;
  email: string;
  name: string | null;
  role: string;
  department: string | null;
  departmentId: number | null;   // FK into storeDepartments — for budget lookups
  locationId: number | null;     // FK into storeLocations — resolved from SSO or manual assignment
  spendingLimit: string | null;
  pointsBalance: number;
}

export interface AddPrintToCartInput {
  printProductId: number;
  printVariantId?: number;
  printProductType: "business_cards" | "flyers" | "banners" | "posters";
  name: string;
  size: string;
  stock: string;
  tierQuantity: number;
  unitPriceCents: number;
  image?: string | null;
}

export interface StoreContextType {
  store: StoreData;
  cart: CartItem[];
  addToCart: (
    product: StoreProduct,
    options?: { imprintZoneSlug?: string; decorationMethod?: string },
  ) => void;
  addPrintToCart: (input: AddPrintToCartInput) => void;
  removeFromCart: (lineKey: string) => void;
  updateQty: (lineKey: string, qty: number) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;
  isDark: boolean;
  toggleTheme: () => void;
  isLoggedIn: boolean;
  storeUser: StoreUserData | null;
  loginUser: (user: StoreUserData) => void;
  logoutUser: () => void;
  activeLocationId: number | null;
  setActiveLocationId: (id: number | null) => void;
}

//  Context 

export const StoreContext = createContext<StoreContextType | null>(null);

export function useStore(): StoreContextType {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within LiveStore");
  return ctx;
}

//  Utilities 

export function capitalize(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  apparel: Shirt,
  drinkware: Coffee,
  tech: Laptop,
  bags: Briefcase,
  writing: PenTool,
  wellness: Heart,
  outdoor: TreePine,
  office: BookOpen,
  other: Package,
};

export function getCategoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category.toLowerCase()] || Sparkles;
}
