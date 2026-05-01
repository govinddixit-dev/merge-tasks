// LegalPageLayout.tsx
// Shared layout wrapper for all legal pages (Terms of Service, Privacy Policy).
// Renders the page title, effective date, optional summary box, language toggle,
// and a scrollable section list. Fully driven by the content objects in ./content/.

import React, { useState } from "react";
import { type LegalLocale, LOCALE_LABELS } from "./content";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LegalSection {
  number: string;
  title: string;
  content: { number: string; text: string }[];
}

export interface LegalSummaryBox {
  heading: string;
  points: string[];
}

export interface LegalDocument {
  title: string;
  subtitle: string;
  effectiveDate: string;
  summaryBox?: LegalSummaryBox;
  intro?: string;
  sections: LegalSection[];
}

interface LegalPageLayoutProps {
  documents: Record<LegalLocale, LegalDocument>;
  /** Which locales are available for this document */
  availableLocales?: LegalLocale[];
}

// ─── Language Toggle ──────────────────────────────────────────────────────────

function LanguageToggle({
  locale,
  available,
  onChange,
}: {
  locale: LegalLocale;
  available: LegalLocale[];
  onChange: (l: LegalLocale) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
      {available.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            locale === l
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

// ─── Summary Box ──────────────────────────────────────────────────────────────

function SummaryBox({ box }: { box: LegalSummaryBox }) {
  return (
    <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50 p-6">
      <h2 className="mb-3 text-base font-semibold text-blue-900">{box.heading}</h2>
      <ul className="space-y-2">
        {box.points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
            <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-blue-200 text-center text-xs font-bold leading-4 text-blue-700">
              ✓
            </span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function LegalSectionBlock({ section }: { section: LegalSection }) {
  return (
    <div className="mb-8" id={`section-${section.number}`}>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        {section.number}. {section.title}
      </h2>
      <div className="space-y-3">
        {section.content.map((item) => (
          <div key={item.number} className="flex gap-3">
            <span className="mt-0.5 flex-shrink-0 text-sm font-medium text-gray-400">
              {item.number}
            </span>
            <p className="text-sm leading-relaxed text-gray-700">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Table of Contents ────────────────────────────────────────────────────────

function TableOfContents({ sections }: { sections: LegalSection[] }) {
  return (
    <nav className="mb-8 rounded-xl border border-gray-100 bg-gray-50 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Table of Contents
      </h2>
      <ol className="space-y-1">
        {sections.map((s) => (
          <li key={s.number}>
            <a
              href={`#section-${s.number}`}
              className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              {s.number}. {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ─── Main Layout ──────────────────────────────────────────────────────────────

export function LegalPageLayout({
  documents,
  availableLocales = ["en", "fr", "es"],
}: LegalPageLayoutProps) {
  const [locale, setLocale] = useState<LegalLocale>("en");
  const doc = documents[locale];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-600">
                MergeTasks
              </p>
              <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
              <p className="mt-1 text-sm text-gray-500">{doc.subtitle}</p>
              <p className="mt-2 text-xs text-gray-400">{doc.effectiveDate}</p>
            </div>
            <LanguageToggle
              locale={locale}
              available={availableLocales}
              onChange={setLocale}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Summary box (Privacy Policy only) */}
        {doc.summaryBox && <SummaryBox box={doc.summaryBox} />}

        {/* Intro paragraph */}
        {doc.intro && (
          <p className="mb-8 text-sm leading-relaxed text-gray-600">{doc.intro}</p>
        )}

        {/* Table of contents */}
        <TableOfContents sections={doc.sections} />

        {/* Sections */}
        {doc.sections.map((section) => (
          <LegalSectionBlock key={section.number} section={section} />
        ))}

        {/* Footer */}
        <div className="mt-12 border-t border-gray-100 pt-6 text-center text-xs text-gray-400">
          © 2026 MergeTasks. All rights reserved. &nbsp;·&nbsp;{" "}
          <a href="mailto:legal@mergetasks.com" className="hover:text-gray-600">
            legal@mergetasks.com
          </a>
        </div>
      </div>
    </div>
  );
}
