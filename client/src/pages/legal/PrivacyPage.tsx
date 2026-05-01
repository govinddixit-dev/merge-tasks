// PrivacyPage.tsx
// Public route: /legal/privacy
// Renders the MergeTasks Privacy Policy in English, French, and Spanish.
// Language is toggled client-side — no server round-trip required.

import React from "react";
import { LegalPageLayout } from "./LegalPageLayout";
import { privacyEN, privacyFR, privacyES } from "./content";

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      documents={{ en: privacyEN, fr: privacyFR, es: privacyES }}
      availableLocales={["en", "fr", "es"]}
    />
  );
}
