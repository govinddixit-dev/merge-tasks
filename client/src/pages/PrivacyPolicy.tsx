/**
 * /privacy — Public-facing Privacy Policy.
 *
 * This page is the plain-English summary of how MergeTasks handles
 * distributor data. It complements the full multi-language legal text
 * at /legal/privacy. The headline guarantee — that we have no
 * technical ability to access another org's supplier credentials,
 * pricing, catalog, or client data — is enforced by automated tests
 * (server/securityAdminAccess.test.ts and securityOrgScope.test.ts)
 * that run on every PR.
 *
 * Mounted unauthenticated; no AppShell, no protected route.
 */

import { Link } from "wouter";
import {
  ShieldCheck,
  Lock,
  EyeOff,
  Database,
  Download,
  Trash2,
  Mail,
  ArrowLeft,
} from "lucide-react";

const LOGO_URL = "/logo_clean.png";
const PRIVACY_EMAIL = "privacy@mergetasks.com";

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <h2 className="text-[18px] font-semibold text-mt-ink">{title}</h2>
      </div>
      <div className="text-[14px] leading-relaxed text-mt-ink-2 space-y-3 ml-12">
        {children}
      </div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-mt-ink-4" />
      <span>{children}</span>
    </li>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-mt-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <img src={LOGO_URL} alt="MergeTasks" className="h-7 w-auto" />
            <span className="text-[14px] font-semibold text-mt-ink">MergeTasks</span>
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mt-ink-3 hover:text-mt-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-primary">
          MergeTasks
        </p>
        <h1 className="text-[32px] font-bold tracking-tight text-mt-ink">Privacy Policy</h1>
        <p className="mt-2 text-[14px] text-mt-ink-3">
          Plain-English summary of how MergeTasks handles your data.
        </p>

        {/* Headline data-isolation callout */}
        <div className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-700" />
            <div>
              <h2 className="text-[15px] font-semibold text-green-900">
                Your supplier credentials and pricing are completely isolated to your account.
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-green-900/90">
                MergeTasks encrypts all supplier credentials at rest. As platform
                operator, we have no technical ability to access your negotiated
                supplier pricing, your catalog, your client data, or your supplier
                account credentials. This isolation is enforced automatically and
                verified by automated tests on every code change.
              </p>
            </div>
          </div>
        </div>

        {/* What we collect */}
        <div className="mt-12">
          <Section icon={<Database className="h-5 w-5" />} title="What we collect">
            <ul className="space-y-2">
              <Bullet>
                <strong>Account information</strong> — your name, email address, and
                company name so we can identify your account and bill correctly.
              </Bullet>
              <Bullet>
                <strong>Usage data</strong> — which features you use and how often, so
                we can improve the product. We do not analyze the content inside your
                proposals, estimates, or messages.
              </Bullet>
              <Bullet>
                <strong>Billing information</strong> — processed entirely by Stripe.
                MergeTasks does not store your card number or full payment details on
                our servers.
              </Bullet>
            </ul>
          </Section>

          {/* What we never access */}
          <Section icon={<EyeOff className="h-5 w-5" />} title="What we never access">
            <p>
              By design, the platform owner cannot read another organization&apos;s
              tenant data. The following stay inside your account, encrypted, and
              filtered out of every cross-tenant query:
            </p>
            <ul className="space-y-2 mt-2">
              <Bullet>Your supplier credentials (account IDs and passwords)</Bullet>
              <Bullet>Your negotiated supplier pricing</Bullet>
              <Bullet>Your client information and contact details</Bullet>
              <Bullet>Your order history with suppliers</Bullet>
            </ul>
          </Section>

          {/* Encryption */}
          <Section icon={<Lock className="h-5 w-5" />} title="How we protect your data">
            <ul className="space-y-2">
              <Bullet>
                <strong>Encryption at rest</strong> — all supplier credentials are
                encrypted with AES-256-GCM before they touch the database.
              </Bullet>
              <Bullet>
                <strong>Encryption in transit</strong> — every connection uses HTTPS
                (TLS 1.2 or higher).
              </Bullet>
              <Bullet>
                <strong>Tenant isolation</strong> — every database query is filtered
                by your organization id automatically. A meta-test scans every
                router on every PR and fails if any new endpoint forgets the
                filter.
              </Bullet>
            </ul>
          </Section>

          {/* Your rights */}
          <Section icon={<Download className="h-5 w-5" />} title="Your rights">
            <ul className="space-y-2">
              <Bullet>
                <strong>Export your data</strong> at any time from Settings → Data
                Export. You receive a machine-readable copy of everything we store
                about you.
              </Bullet>
              <Bullet>
                <strong>Delete your account</strong> from Settings → Account.
                Deletion removes your organization, your row-level data, and
                cascades to every dependent record.
                <span className="ml-1 inline-flex items-center gap-1 text-mt-ink-4">
                  <Trash2 className="h-3 w-3" />
                </span>
              </Bullet>
              <Bullet>
                <strong>Contact us</strong> for any privacy concern at{" "}
                <a
                  href={`mailto:${PRIVACY_EMAIL}`}
                  className="text-primary font-medium hover:underline"
                >
                  {PRIVACY_EMAIL}
                </a>
                .
              </Bullet>
            </ul>
          </Section>

          {/* Contact card */}
          <div className="mt-12 flex flex-col items-center rounded-xl border border-mt-border bg-mt-surface px-6 py-8 text-center">
            <Mail className="mb-3 h-6 w-6 text-primary" />
            <h2 className="text-[15px] font-semibold text-mt-ink">
              Questions about your privacy?
            </h2>
            <p className="mt-1 text-[13px] text-mt-ink-3">
              We read every message and respond within two business days.
            </p>
            <a
              href={`mailto:${PRIVACY_EMAIL}`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#5340d4]"
            >
              <Mail className="h-3.5 w-3.5" />
              {PRIVACY_EMAIL}
            </a>
          </div>

          {/* Footer */}
          <footer className="mt-12 flex flex-col items-center gap-2 border-t border-mt-border pt-6 text-center text-[11px] text-mt-ink-4">
            <p>© 2026 MergeTasks. All rights reserved.</p>
            <p className="flex items-center gap-3">
              <Link href="/legal/privacy" className="hover:text-mt-ink-2">
                Full legal Privacy Policy
              </Link>
              <span aria-hidden>·</span>
              <Link href="/legal/terms" className="hover:text-mt-ink-2">
                Terms of Service
              </Link>
              <span aria-hidden>·</span>
              <Link href="/sign-in" className="hover:text-mt-ink-2">
                Sign in
              </Link>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
