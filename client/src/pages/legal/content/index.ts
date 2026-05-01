// content/index.ts
// Barrel re-export for all legal content files.
// Each file is the source of truth for its language/document combination.
// To update legal text, edit the relevant file — the UI will reflect changes automatically.

export { termsEN } from "./terms-en";
export { termsES } from "./terms-es";
export { termsFR } from "./terms-fr";
export { privacyEN } from "./privacy-en";
export { privacyES } from "./privacy-es";
export { privacyFR } from "./privacy-fr";

export type LegalLocale = "en" | "fr" | "es";
export type LegalDocType = "terms" | "privacy";

export const LOCALE_LABELS: Record<LegalLocale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};
