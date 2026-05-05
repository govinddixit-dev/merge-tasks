import StripeStatusPill from "./StripeStatusPill";
import NotificationCenter from "./NotificationCenter";

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /**
   * Skip the white title strip entirely. Used by the Dashboard hero, which
   * renders its own greeting and docks StripeStatusPill + NotificationCenter
   * inside the hero section. When false, this component owns the top-right
   * widget row for the page.
   */
  hideHeader?: boolean;
}

/**
 * DashboardLayout — header/footer chrome inside the app shell.
 *
 * Sidebar and GlobalAIAssistant are rendered once by `AppShell` in App.tsx
 * so they stay static across route transitions. This component only
 * provides the header strip, content slot, and footer within the main
 * column (offset by 260px on desktop for the fixed sidebar).
 */
export default function DashboardLayout({ children, title, subtitle, hideHeader }: DashboardLayoutProps) {
  return (
    // #F9FAFB — the single off-white shared across every shell surface so
    // the sidebar (#F3F4F6), header strip, and content area read as one
    // continuous canvas with no visible seam. Same off-white the dashboard
    // canvas already uses internally, centralised here so page-level
    // components don't each reinvent it.
    <div className="min-h-screen" style={{ backgroundColor: '#F9FAFB' }}>
      {/* Sidebar offset is applied by AppShell's motion wrapper so it can react to
         collapse state; this main column only handles its own vertical layout. */}
      <main className="min-h-screen flex flex-col">
        {/* Mobile top bar spacer */}
        <div className="h-14 xl:hidden" />
        {/* Page header — transparent so it inherits the unified shell bg.
           Hidden for pages that render their own hero (see Dashboard). */}
        {!hideHeader && (
          <header className="px-5 sm:px-8 lg:px-10 pt-6 sm:pt-8 pb-4 sm:pb-6" style={{ borderBottom: '1px solid #F0F0F0' }}>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-[22px] sm:text-[26px] font-bold text-mt-ink tracking-tight">
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-[12px] sm:text-[13px] mt-1 text-mt-ink-3">
                    {subtitle}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StripeStatusPill />
                <NotificationCenter />
              </div>
            </div>
          </header>
        )}
        <div className="flex-1 px-5 sm:px-8 lg:px-10 py-6 sm:py-8">
          {children}
        </div>
        {/* App footer — inside <main> so it respects the 260px sidebar offset on desktop */}
        <footer className="py-3 text-center text-[11px] text-mt-ink-4 border-t border-mt-border">
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:text-mt-ink-3 transition-colors">Terms</a>
          <span className="mx-2">&middot;</span>
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-mt-ink-3 transition-colors">Privacy</a>
        </footer>
      </main>
    </div>
  );
}
