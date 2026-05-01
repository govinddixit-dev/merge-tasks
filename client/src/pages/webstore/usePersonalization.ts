/**
 * usePersonalization — Derives per-user AI personalization signals from
 * data we already fetch (session user, division budget, recent orders via
 * storePortal.dashboard) plus purely client-side relevance scoring.
 *
 * No new tRPC endpoints. No backend changes. Gracefully no-ops for
 * logged-out visitors and non-SSO/single-division stores.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useStore } from "./StoreContext";
import type { StoreProduct } from "./StoreContext";

export interface PersonalizationData {
  isPersonalized: boolean;
  firstName: string | null;
  fullName: string | null;
  role: string | null;
  department: string | null;
  /** Formatted remaining budget string (e.g. "$450") or null. */
  budgetRemaining: string | null;
  budgetPct: number | null;
  budgetState: "ok" | "warn" | "block" | null;
  /** Relevant categories for this user, ordered by relevance score. */
  relevantCategories: string[];
  /** Products reordered by relevance to the user. */
  rankedProducts: StoreProduct[];
  /** Top picks for "Recommended for you" / "Picked for you". */
  picks: StoreProduct[];
  /** How many orders this user/team has placed. */
  orderCount: number;
  /** Greeting string like "Hi Sarah — your Q2 budget is $450 remaining". */
  greeting: string;
}

// Heuristic keyword map from role/department → product categories.
const DEPT_CATEGORY_HINTS: Record<string, string[]> = {
  sales: ["bags", "writing", "tech", "apparel"],
  marketing: ["apparel", "bags", "writing"],
  engineering: ["tech", "drinkware", "writing"],
  it: ["tech", "writing"],
  hr: ["wellness", "apparel", "office"],
  operations: ["office", "writing", "bags"],
  finance: ["office", "writing"],
  legal: ["office", "writing"],
  executive: ["apparel", "drinkware", "writing"],
  field: ["outdoor", "apparel", "bags"],
  warehouse: ["outdoor", "apparel"],
};

function hintsFor(dept: string | null, role: string | null): string[] {
  const out = new Set<string>();
  const addFor = (key: string | null) => {
    if (!key) return;
    const k = key.toLowerCase();
    for (const [hint, cats] of Object.entries(DEPT_CATEGORY_HINTS)) {
      if (k.includes(hint)) cats.forEach(c => out.add(c));
    }
  };
  addFor(dept);
  addFor(role);
  return Array.from(out);
}

export function usePersonalization(): PersonalizationData {
  const { store, storeUser, isLoggedIn } = useStore();

  // TODO(phase-1.5): reintroduce per-user budget lookup against the new
  // location-scoped budgets endpoint. The prior `getMyDivisionBudget` query
  // was removed when the divisions table was dropped in migration 0082.

  const dashEnabled = isLoggedIn;
  const { data: dashboard } = trpc.storePortal.dashboard.useQuery(
    { storeSlug: store.slug },
    { enabled: dashEnabled, staleTime: 60_000, retry: false },
  );

  return useMemo(() => {
    const firstName = storeUser?.name?.split(" ")[0] ?? null;
    const fullName = storeUser?.name ?? null;
    const role = storeUser?.role ?? null;
    const department = storeUser?.department ?? null;

    const budgetRemaining: string | null = null;
    const budgetPct: number | null = null;
    const budgetState: PersonalizationData["budgetState"] = null;

    const hints = hintsFor(department, role);

    // Build relevant categories list from hints ∩ store categories, falling
    // back to most-populous categories when we have no hints for this user.
    const storeCats = Array.from(
      new Set(store.products.map(p => (p.category || "Other").toLowerCase()))
    );
    const relevantCategories =
      hints.length > 0
        ? [
            ...hints.filter(h => storeCats.includes(h)),
            ...storeCats.filter(c => !hints.includes(c)),
          ]
        : storeCats;

    // Score each product: featured > hinted-category > alphabetical.
    const scored = store.products.map(p => {
      let score = 0;
      if (p.featured) score += 5;
      const cat = (p.category || "other").toLowerCase();
      const hintIdx = hints.indexOf(cat);
      if (hintIdx >= 0) score += 10 - hintIdx; // earlier hints rank higher
      return { p, score };
    });
    const rankedProducts = scored
      .slice()
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
      .map(s => s.p);

    const picks = rankedProducts.slice(0, 6);

    const orderCount = Number(dashboard?.stats?.totalOrders ?? 0);

    const isPersonalized = !!isLoggedIn && (!!firstName || !!budgetRemaining);

    const greeting = (() => {
      if (!isPersonalized) return "";
      const namePart = firstName ? `Hi ${firstName}` : "Welcome back";
      if (budgetRemaining && budgetState !== "block") {
        return `${namePart} — your team budget is ${budgetRemaining} remaining`;
      }
      if (budgetRemaining && budgetState === "block") {
        return `${namePart} — your team budget is fully allocated this cycle`;
      }
      if (department) return `${namePart}, here's what's curated for ${department}`;
      return `${namePart}`;
    })();

    return {
      isPersonalized,
      firstName,
      fullName,
      role,
      department,
      budgetRemaining,
      budgetPct,
      budgetState,
      relevantCategories,
      rankedProducts,
      picks,
      orderCount,
      greeting,
    };
  }, [
    store,
    storeUser,
    isLoggedIn,
    dashboard,
  ]);
}
