// legal/index.ts
// Barrel re-export for legal pages and shared layout.
//
// Routes:
//   /legal/terms   → TermsPage
//   /legal/privacy → PrivacyPage
//
// Compliance touchpoints that link here:
//   - Signup consent checkbox (Tier 1)
//   - App footer links (Tier 1)
//   - Store checkout consent (Tier 1)
//   - Store login consent (Tier 2)
//   - Proposal acceptance consent (Tier 2)
//   - Email footers (Tier 2)
//   - QB Connect dialog (Tier 3)
//   - Stripe Connect dialog (Tier 3)
//   - Account deletion notice (Tier 3)

export { default as TermsPage } from "./TermsPage";
export { default as PrivacyPage } from "./PrivacyPage";
export { LegalPageLayout } from "./LegalPageLayout";
export type { LegalDocument, LegalSection, LegalSummaryBox } from "./LegalPageLayout";
export { LOCALE_LABELS } from "./content";
export type { LegalLocale, LegalDocType } from "./content";
