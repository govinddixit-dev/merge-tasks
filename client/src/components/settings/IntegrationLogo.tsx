/**
 * IntegrationLogo
 * Renders a brand mark in a consistent 44x44 white container.
 * Uses inline SVGs — no network requests, no broken favicons.
 */

import type { ReactNode } from "react";

export type IntegrationKind =
  | "asi"
  | "sanmar"
  | "ss"
  | "alphabroder"
  | "quickbooks"
  | "stripe";

interface IntegrationLogoProps {
  kind: IntegrationKind;
}

function Mark({ bg, children, textSize = 10 }: { bg: string; children: ReactNode; textSize?: number }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" role="img" aria-hidden="true">
      <rect width="28" height="28" rx="6" fill={bg} />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#FFFFFF"
        fontFamily="'Albert Sans', system-ui, sans-serif"
        fontWeight={800}
        fontSize={textSize}
        letterSpacing="-0.02em"
      >
        {children}
      </text>
    </svg>
  );
}

function StripeMark() {
  // Stripe "S" mark on a rounded brand-purple square.
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" role="img" aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="#635BFF" />
      <path
        d="M13.96 11.17c0-.62.52-.87 1.36-.87 1.22 0 2.77.38 3.99 1.03v-3.8c-1.34-.53-2.66-.74-3.99-.74-3.26 0-5.44 1.72-5.44 4.59 0 4.48 6.1 3.76 6.1 5.7 0 .73-.63 1-1.51 1-1.33 0-3.04-.55-4.4-1.3v3.85c1.5.65 3.02.93 4.4.93 3.35 0 5.66-1.67 5.66-4.57 0-4.84-6.17-3.98-6.17-5.82Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

const MARKS: Record<IntegrationKind, ReactNode> = {
  asi: <Mark bg="#0066CC" textSize={10}>ASI</Mark>,
  sanmar: <Mark bg="#CC0000" textSize={11}>SM</Mark>,
  ss: <Mark bg="#1D4ED8" textSize={10}>S&amp;S</Mark>,
  alphabroder: <Mark bg="#7C3AED" textSize={11}>AB</Mark>,
  quickbooks: <Mark bg="#2CA01C" textSize={11}>QB</Mark>,
  stripe: <StripeMark />,
};

export default function IntegrationLogo({ kind }: IntegrationLogoProps) {
  return (
    <div
      className="w-11 h-11 flex items-center justify-center flex-shrink-0 bg-white"
      style={{ border: "1px solid #E5E7EB", borderRadius: 10 }}
    >
      {MARKS[kind]}
    </div>
  );
}
