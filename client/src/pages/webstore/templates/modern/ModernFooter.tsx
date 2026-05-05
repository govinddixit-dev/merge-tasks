/**
 * ModernFooter — content rendered inside the curtain-reveal panel.
 *
 * The "default" variant shows a hero band ("Welcome to your TEAM STORE")
 * plus columns + © attribution; "compact" trims the hero band so cart /
 * checkout / form pages don't get a giant final reveal.
 *
 * "Powered by MergeTasks" + Terms / Privacy links preserved per the
 * regression checklist.
 */
import { useStore } from "../../StoreContext";

type Props = { variant?: "default" | "compact" };

export default function ModernFooter({ variant = "default" }: Props) {
  const { store } = useStore();
  const companyName = store.client?.companyName || store.name;
  const showHero = variant === "default";
  return (
    <div className="h-full px-6 lg:px-12 py-6 flex flex-col text-paper">
      {showHero && (
        <div className="text-center pt-2 pb-4">
          <h2 className="font-serif-display text-[24px] sm:text-[28px] leading-[1.1] text-paper italic">
            Thank you for visiting <span className="not-italic font-semibold">{companyName}</span>.
          </h2>
        </div>
      )}
      <div className="flex-1" />
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 pt-3 border-t border-paper/10 text-[11px] text-paper/60">
        <div>©{new Date().getFullYear()} <span className="text-paper">{companyName}</span></div>
        <div className="text-left sm:text-right">
          Powered by <span className="text-paper">MergeTasks</span>
          <span className="mx-2">·</span>
          <a href="/legal/terms" className="hover:text-paper transition-colors">Terms</a>
          <span className="mx-1.5">·</span>
          <a href="/legal/privacy" className="hover:text-paper transition-colors">Privacy</a>
        </div>
      </div>
    </div>
  );
}
