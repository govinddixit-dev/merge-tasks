/**
 * WebstoreContext — centralised state for the CreateWebstore wizard.
 * Uses useReducer so each step reads/writes only what it needs via the
 * context, eliminating the 15+ setter-prop pattern from the parent.
 */
import { createContext, useContext, useReducer, ReactNode } from "react";
import type { PocEntry, StoreEmployee } from "./types";

export interface CatalogSubCategory {
  id: string;
  name: string;
  productIds: number[];
}

export interface CatalogBlock {
  id: string;
  name: string;
  subCategories: CatalogSubCategory[];
}

export interface WebstoreDivision {
  id: string;              // local wizard-only id (e.g. crypto.randomUUID())
  name: string;
  departments: string[];   // plain department names, rendered as pills
  pocEmail?: string;       // 1 POC per division — required when multi-division is enabled
}

//  State shape 

export interface WebstoreState {
  // Step 1
  selectedClientId: number | null;
  pocEnabled: boolean;
  pocs: PocEntry[];
  industry: string;
  employeeCount: string;
  ssoProvider: string;
  storeEmployees: StoreEmployee[];

  // Step 2
  subdomain: string;
  useCustomDomain: boolean;
  customDomain: string;
  /** null = not yet evaluated; true/false = last availability check result */
  subdomainAvailable: boolean | null;

  // Step 3
  enablePromo: boolean;
  enablePrint: boolean;

  // Step 4 — Divisions & Departments
  multiDivisionEnabled: boolean;
  divisions: WebstoreDivision[];

  // Step 5 (previously 4)
  storeDuration: "permanent" | "popup";
  popupStartDate: string;
  popupEndDate: string;
  linkToPermanent: boolean;
  linkedStoreId: string;

  // Step 5
  selectedTemplate: string;

  // Step 6
  selectedCategories: string[];
  addedProductIds: number[];
  catalogSearch: string;
  autoSelected: boolean;
  customCategories: { id: string; name: string }[];
  // Step 6 — new block builder
  catalogBlocks: CatalogBlock[]; // ordered category blocks with sub-categories
  catalogClassified: boolean; // true after AI auto-classify has run

  // Step 7
  brandColor: string;
  heroBannerUrl: string | null;
  heroBannerPreview: string | null;
  isUploadingBanner: boolean;
  heroBannerPosition: { x: number; y: number };

  // Step 8
  enabledCheckout: string[];
  budgetEnabled: boolean;
  approvalEnabled: boolean;
  rbacEnabled: boolean;

  // Launch
  deploying: boolean;
  deployStep: number;
  deployed: boolean;
  createdStoreId: number | null;
  showItPacket: boolean;
  generatingPdf: boolean;
  // AI results (populated after deploy)
  aiTagline: string;
  aiHeroHeadline: string;
  aiHeroSubtitle: string;
  aiTemplateSuggestion: string;
  aiIndustryTheme: string;
}

//  Action types 
// Fully discriminated union — no generic SET action.
// Each field gets its own action so TypeScript can enforce the correct value type.

export type WebstoreAction =
  // Step 1
  | { type: "SET_CLIENT_ID"; clientId: number | null }
  | { type: "SET_POC_ENABLED"; enabled: boolean }
  | { type: "SET_POCS"; pocs: PocEntry[] }
  | { type: "SET_INDUSTRY"; industry: string }
  | { type: "SET_EMPLOYEE_COUNT"; count: string }
  | { type: "SET_SSO_PROVIDER"; provider: string }
  | { type: "SET_STORE_EMPLOYEES"; employees: StoreEmployee[] }
  // Step 2
  | { type: "SET_SUBDOMAIN"; subdomain: string }
  | { type: "SET_USE_CUSTOM_DOMAIN"; useCustomDomain: boolean }
  | { type: "SET_CUSTOM_DOMAIN"; customDomain: string }
  // Step 3
  | { type: "SET_ENABLE_PROMO"; enabled: boolean }
  | { type: "SET_ENABLE_PRINT"; enabled: boolean }
  | { type: "TOGGLE_ENABLE_PROMO" }
  | { type: "TOGGLE_ENABLE_PRINT" }
  // Step 4 — Divisions
  | { type: "SET_MULTI_DIVISION_ENABLED"; enabled: boolean }
  | { type: "SET_DIVISIONS"; divisions: WebstoreDivision[] }
  // Step 4
  | { type: "SET_STORE_DURATION"; duration: "permanent" | "popup" }
  | { type: "SET_POPUP_START_DATE"; date: string }
  | { type: "SET_POPUP_END_DATE"; date: string }
  | { type: "SET_LINK_TO_PERMANENT"; link: boolean }
  | { type: "SET_LINKED_STORE_ID"; storeId: string }
  // Step 5
  | { type: "SET_TEMPLATE"; template: string }
  // Step 6
  | { type: "TOGGLE_CATEGORY"; categoryId: string }
  | { type: "TOGGLE_PRODUCT"; productId: number }
  | { type: "SET_ADDED_PRODUCT_IDS"; ids: number[] }
  | { type: "SET_CATALOG_SEARCH"; search: string }
  | { type: "SET_AUTO_SELECTED"; autoSelected: boolean }
  | { type: "SET_CUSTOM_CATEGORIES"; categories: { id: string; name: string }[] }
  | { type: "SET_CATALOG_BLOCKS"; blocks: CatalogBlock[] }
  | { type: "SET_CATALOG_CLASSIFIED"; classified: boolean }
  // Step 7
  | { type: "SET_BRAND_COLOR"; color: string }
  | { type: "SET_HERO_BANNER_URL"; url: string | null }
  | { type: "SET_HERO_BANNER_PREVIEW"; preview: string | null }
  | { type: "SET_IS_UPLOADING_BANNER"; uploading: boolean }
  | { type: "SET_HERO_BANNER_POSITION"; position: { x: number; y: number } }
  // Step 8
  | { type: "TOGGLE_CHECKOUT"; methodId: string }
  | { type: "SET_BUDGET_ENABLED"; enabled: boolean }
  | { type: "SET_APPROVAL_ENABLED"; enabled: boolean }
  | { type: "SET_RBAC_ENABLED"; enabled: boolean }
  // Launch / deploy
  | { type: "SET_DEPLOYING"; deploying: boolean }
  | { type: "SET_DEPLOY_STEP"; step: number }
  | { type: "SET_DEPLOYED"; deployed: boolean }
  | { type: "SET_CREATED_STORE_ID"; id: number | null }
  | { type: "SET_SHOW_IT_PACKET"; show: boolean }
  | { type: "SET_GENERATING_PDF"; generating: boolean }
  // AI results
  | { type: "SET_AI_TAGLINE"; tagline: string }
  | { type: "SET_AI_HERO_HEADLINE"; headline: string }
  | { type: "SET_AI_HERO_SUBTITLE"; subtitle: string }
  | { type: "SET_AI_TEMPLATE_SUGGESTION"; suggestion: string }
  | { type: "SET_AI_INDUSTRY_THEME"; theme: string }
  // Escape hatch for one-off bulk updates (use sparingly)
  | { type: "MERGE"; patch: Partial<WebstoreState> };

//  Initial state 

export const initialWebstoreState: WebstoreState = {
  selectedClientId: null,
  pocEnabled: true,
  pocs: [{ name: "", email: "" }],
  industry: "",
  employeeCount: "",
  ssoProvider: "",
  storeEmployees: [],

  subdomain: "",
  useCustomDomain: false,
  customDomain: "",
  subdomainAvailable: null,

  enablePromo: true,
  enablePrint: false,

  multiDivisionEnabled: false,
  divisions: [],

  storeDuration: "permanent",
  popupStartDate: "",
  popupEndDate: "",
  linkToPermanent: false,
  linkedStoreId: "",

  selectedTemplate: "modern",

  selectedCategories: ["apparel", "drinkware", "tech"],
  addedProductIds: [],
  catalogSearch: "",
  autoSelected: false,
  customCategories: [],
  catalogBlocks: [],
  catalogClassified: false,

  brandColor: "var(--mt-brand)",
  heroBannerUrl: null,
  heroBannerPreview: null,
  isUploadingBanner: false,
  heroBannerPosition: { x: 50, y: 50 },

  enabledCheckout: ["cc"],
  budgetEnabled: false,
  approvalEnabled: false,
  rbacEnabled: false,

  deploying: false,
  deployStep: -1,
  deployed: false,
  createdStoreId: null,
  showItPacket: false,
  generatingPdf: false,
  // AI results
  aiTagline: "",
  aiHeroHeadline: "",
  aiHeroSubtitle: "",
  aiTemplateSuggestion: "",
  aiIndustryTheme: "",
};

//  Reducer 

function webstoreReducer(state: WebstoreState, action: WebstoreAction): WebstoreState {
  switch (action.type) {
    // Step 1
    case "SET_CLIENT_ID":           return { ...state, selectedClientId: action.clientId };
    case "SET_POC_ENABLED":         return { ...state, pocEnabled: action.enabled };
    case "SET_POCS":                return { ...state, pocs: action.pocs };
    case "SET_INDUSTRY":            return { ...state, industry: action.industry };
    case "SET_EMPLOYEE_COUNT":      return { ...state, employeeCount: action.count };
    case "SET_SSO_PROVIDER":        return { ...state, ssoProvider: action.provider };
    case "SET_STORE_EMPLOYEES":     return { ...state, storeEmployees: action.employees };
    // Step 2
    case "SET_SUBDOMAIN":           return { ...state, subdomain: action.subdomain };
    case "SET_USE_CUSTOM_DOMAIN":   return { ...state, useCustomDomain: action.useCustomDomain };
    case "SET_CUSTOM_DOMAIN":       return { ...state, customDomain: action.customDomain };
    // Step 3
    case "SET_ENABLE_PROMO":        return { ...state, enablePromo: action.enabled };
    case "SET_ENABLE_PRINT":        return { ...state, enablePrint: action.enabled };
    case "TOGGLE_ENABLE_PROMO":     return { ...state, enablePromo: !state.enablePromo };
    case "TOGGLE_ENABLE_PRINT":     return { ...state, enablePrint: !state.enablePrint };
    // Step 4 — Divisions
    case "SET_MULTI_DIVISION_ENABLED": return { ...state, multiDivisionEnabled: action.enabled };
    case "SET_DIVISIONS":              return { ...state, divisions: action.divisions };
    // Step 4
    case "SET_STORE_DURATION":      return { ...state, storeDuration: action.duration };
    case "SET_POPUP_START_DATE":    return { ...state, popupStartDate: action.date };
    case "SET_POPUP_END_DATE":      return { ...state, popupEndDate: action.date };
    case "SET_LINK_TO_PERMANENT":   return { ...state, linkToPermanent: action.link };
    case "SET_LINKED_STORE_ID":     return { ...state, linkedStoreId: action.storeId };
    // Step 5
    case "SET_TEMPLATE":            return { ...state, selectedTemplate: action.template };
    // Step 6
    case "TOGGLE_CATEGORY":
      return {
        ...state,
        selectedCategories: state.selectedCategories.includes(action.categoryId)
          ? state.selectedCategories.filter((c) => c !== action.categoryId)
          : [...state.selectedCategories, action.categoryId],
      };
    case "TOGGLE_PRODUCT":
      return {
        ...state,
        addedProductIds: state.addedProductIds.includes(action.productId)
          ? state.addedProductIds.filter((id) => id !== action.productId)
          : [...state.addedProductIds, action.productId],
      };
    case "SET_ADDED_PRODUCT_IDS":   return { ...state, addedProductIds: action.ids };
    case "SET_CATALOG_SEARCH":      return { ...state, catalogSearch: action.search };
    case "SET_AUTO_SELECTED":       return { ...state, autoSelected: action.autoSelected };
    case "SET_CUSTOM_CATEGORIES":   return { ...state, customCategories: action.categories };
    case "SET_CATALOG_BLOCKS":      return { ...state, catalogBlocks: action.blocks };
    case "SET_CATALOG_CLASSIFIED":  return { ...state, catalogClassified: action.classified };
    // Step 7
    case "SET_BRAND_COLOR":         return { ...state, brandColor: action.color };
    case "SET_HERO_BANNER_URL":     return { ...state, heroBannerUrl: action.url };
    case "SET_HERO_BANNER_PREVIEW": return { ...state, heroBannerPreview: action.preview };
    case "SET_IS_UPLOADING_BANNER": return { ...state, isUploadingBanner: action.uploading };
    case "SET_HERO_BANNER_POSITION":return { ...state, heroBannerPosition: action.position };
    // Step 8
    case "TOGGLE_CHECKOUT":
      return {
        ...state,
        enabledCheckout: state.enabledCheckout.includes(action.methodId)
          ? state.enabledCheckout.filter((c) => c !== action.methodId)
          : [...state.enabledCheckout, action.methodId],
      };
    case "SET_BUDGET_ENABLED":      return { ...state, budgetEnabled: action.enabled };
    case "SET_APPROVAL_ENABLED":    return { ...state, approvalEnabled: action.enabled };
    case "SET_RBAC_ENABLED":        return { ...state, rbacEnabled: action.enabled };
    // Launch
    case "SET_DEPLOYING":           return { ...state, deploying: action.deploying };
    case "SET_DEPLOY_STEP":         return { ...state, deployStep: action.step };
    case "SET_DEPLOYED":            return { ...state, deployed: action.deployed };
    case "SET_CREATED_STORE_ID":    return { ...state, createdStoreId: action.id };
    case "SET_SHOW_IT_PACKET":      return { ...state, showItPacket: action.show };
    case "SET_GENERATING_PDF":      return { ...state, generatingPdf: action.generating };
    // AI results
    case "SET_AI_TAGLINE":          return { ...state, aiTagline: action.tagline };
    case "SET_AI_HERO_HEADLINE":    return { ...state, aiHeroHeadline: action.headline };
    case "SET_AI_HERO_SUBTITLE":    return { ...state, aiHeroSubtitle: action.subtitle };
    case "SET_AI_TEMPLATE_SUGGESTION": return { ...state, aiTemplateSuggestion: action.suggestion };
    case "SET_AI_INDUSTRY_THEME":   return { ...state, aiIndustryTheme: action.theme };
    // Escape hatch
    case "MERGE":                   return { ...state, ...action.patch };
    default:
      return state;
  }
}

//  Context 

interface WebstoreContextValue {
  state: WebstoreState;
  dispatch: React.Dispatch<WebstoreAction>;
  /** Convenience setter — wraps dispatch SET for simple scalar fields */
  set: <K extends keyof WebstoreState>(key: K, value: WebstoreState[K]) => void;
}

const WebstoreContext = createContext<WebstoreContextValue | null>(null);

export function WebstoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(webstoreReducer, initialWebstoreState);
  /**
   * Convenience helper — dispatches a MERGE action for simple scalar updates.
   * Prefer explicit typed actions (SET_CLIENT_ID, SET_SUBDOMAIN, etc.) for
   * anything that benefits from compile-time type checking.
   */
  const set = <K extends keyof WebstoreState>(key: K, value: WebstoreState[K]) =>
    dispatch({ type: "MERGE", patch: { [key]: value } as Partial<WebstoreState> });
  return (
    <WebstoreContext.Provider value={{ state, dispatch, set }}>
      {children}
    </WebstoreContext.Provider>
  );
}

export function useWebstore() {
  const ctx = useContext(WebstoreContext);
  if (!ctx) throw new Error("useWebstore must be used inside WebstoreProvider");
  return ctx;
}
