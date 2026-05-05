/**
 * WebstoreLayout — Layout wrapper for public-facing webstore pages.
 */
import type { ReactNode } from "react";

interface WebstoreLayoutProps {
  children: ReactNode;
}

export default function WebstoreLayout({ children }: WebstoreLayoutProps) {
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
