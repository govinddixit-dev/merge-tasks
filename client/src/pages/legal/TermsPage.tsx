// TermsPage.tsx
// Public route: /legal/terms
// Renders the MergeTasks Terms of Service in English, French, and Spanish.
// Language is toggled client-side — no server round-trip required.

import React from "react";
import { LegalPageLayout } from "./LegalPageLayout";
import { termsEN, termsFR, termsES } from "./content";

export default function TermsPage() {
  return (
    <LegalPageLayout
      documents={{ en: termsEN, fr: termsFR, es: termsES }}
      availableLocales={["en", "fr", "es"]}
    />
  );
}
