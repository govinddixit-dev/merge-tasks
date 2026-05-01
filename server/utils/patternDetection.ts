/**
 * patternDetection.ts — Derive reorder forecasts from a client's order
 * history, used by the predictive-opportunities cron scan to surface
 * proactive outreach actions.
 *
 * Two pattern families are evaluated and the stronger one wins:
 *   • Interval — orders at a consistent cadence (e.g. every ~90 days).
 *   • Seasonal — orders clustering in the same calendar month across
 *                multiple years (annual swag/uniform refreshes).
 *
 * The function is deliberately conservative: it returns null when fewer
 * than two orders exist, when no pattern crosses its family-specific
 * confidence floor, or when the underlying query fails. Callers (the
 * cron) additionally gate on confidence >= 0.6 before firing a trigger.
 *
 * All queries are organization-scoped when an organizationId is
 * supplied, so cross-tenant leakage is impossible even if a clientId
 * happens to collide between tenants.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { orders } from "../../drizzle/schema";
import { getLogger } from "./logger";

const log = getLogger("patternDetection");

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_ORDERS_FOR_PATTERN = 2;
const MIN_INTERVAL_CONFIDENCE = 0.3;
const MIN_SEASONAL_CONFIDENCE = 0.4;

export interface ReorderPattern {
  predictedWindowStart: Date;
  predictedWindowEnd: Date;
  /** 0..1 — how consistent the detected pattern is. Higher = tighter. */
  confidence: number;
  patternSummary: string;
  /** Average of past order totals in USD. */
  estimatedValue: number;
}

/**
 * Query the client's order history and return a forecast, or null when
 * no pattern of sufficient confidence exists.
 */
export async function detectReorderPatterns(
  clientId: number,
  organizationId: number | null,
): Promise<ReorderPattern | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({
        createdAt: orders.createdAt,
        total: orders.total,
      })
      .from(orders)
      .where(
        organizationId != null
          ? and(eq(orders.clientId, clientId), eq(orders.organizationId, organizationId))
          : eq(orders.clientId, clientId),
      )
      .orderBy(asc(orders.createdAt));

    if (rows.length < MIN_ORDERS_FOR_PATTERN) return null;

    const points = rows
      .map((r) => ({
        date: new Date(r.createdAt),
        total: Number(r.total ?? 0),
      }))
      .filter((p) => !Number.isNaN(p.date.getTime()));

    if (points.length < MIN_ORDERS_FOR_PATTERN) return null;

    const estimatedValue =
      points.reduce((s, p) => s + p.total, 0) / points.length;

    const dates = points.map((p) => p.date);
    const interval = analyzeInterval(dates);
    const seasonal = analyzeSeasonal(dates);

    const candidate = pickStrongerCandidate(interval, seasonal);
    if (!candidate) return null;

    return {
      predictedWindowStart: candidate.predictedWindowStart,
      predictedWindowEnd: candidate.predictedWindowEnd,
      confidence: candidate.confidence,
      patternSummary: candidate.patternSummary,
      estimatedValue,
    };
  } catch (err: unknown) {
    log.warn(`[patternDetection] query failed for client=${clientId}:`, err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface PatternCandidate {
  predictedWindowStart: Date;
  predictedWindowEnd: Date;
  confidence: number;
  patternSummary: string;
}

function pickStrongerCandidate(
  a: PatternCandidate | null,
  b: PatternCandidate | null,
): PatternCandidate | null {
  if (a && b) return a.confidence >= b.confidence ? a : b;
  return a ?? b;
}

/**
 * Interval pattern — detect whether gaps between orders cluster around a
 * stable cadence. A single gap (two orders) is allowed at a moderate
 * baseline confidence so learning can start early; longer histories are
 * scored via coefficient of variation so tight cadences (90d ±1d) score
 * near 1 while noisy ones fall toward zero.
 */
function analyzeInterval(dates: Date[]): PatternCandidate | null {
  if (dates.length < 2) return null;

  const gapsDays: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i].getTime() - dates[i - 1].getTime()) / DAY_MS;
    if (diff > 0) gapsDays.push(diff);
  }
  if (gapsDays.length === 0) return null;

  const mean = gapsDays.reduce((s, g) => s + g, 0) / gapsDays.length;
  if (mean <= 0) return null;

  let confidence: number;
  if (gapsDays.length === 1) {
    // A single observed gap can't tell us how consistent the cadence is
    // — give it moderate baseline confidence so the system can begin
    // learning, but keep it below the cron's 0.6 firing threshold.
    confidence = 0.5;
  } else {
    const variance =
      gapsDays.reduce((s, g) => s + (g - mean) ** 2, 0) / gapsDays.length;
    const stdDev = Math.sqrt(variance);
    const coefVar = stdDev / mean;
    confidence = Math.max(0, Math.min(1, 1 - coefVar));
  }

  if (confidence < MIN_INTERVAL_CONFIDENCE) return null;

  const last = dates[dates.length - 1];
  const meanDaysRounded = Math.round(mean);
  const predictedCenter = new Date(last.getTime() + meanDaysRounded * DAY_MS);
  // Window = ±max(7, 15% of mean) days. Short cadences get a generous
  // floor; long cadences get a proportionally wider window.
  const windowHalf = Math.max(7, Math.round(mean * 0.15));
  const predictedWindowStart = new Date(
    predictedCenter.getTime() - windowHalf * DAY_MS,
  );
  const predictedWindowEnd = new Date(
    predictedCenter.getTime() + windowHalf * DAY_MS,
  );

  const patternSummary =
    `Orders every ~${meanDaysRounded} days, last order ${formatMonthYear(last)}, ` +
    `next window predicted ${formatMonthYear(predictedCenter)}`;

  return { predictedWindowStart, predictedWindowEnd, confidence, patternSummary };
}

/**
 * Seasonal pattern — detect orders that consistently land in the same
 * calendar month across multiple years. Requires at least two orders in
 * the dominant month AND that they span distinct years (otherwise the
 * cluster could be coincidental).
 */
function analyzeSeasonal(dates: Date[]): PatternCandidate | null {
  if (dates.length < 2) return null;

  const countsByMonth = new Map<number, number>();
  const yearsByMonth = new Map<number, Set<number>>();
  for (const d of dates) {
    const m = d.getUTCMonth();
    countsByMonth.set(m, (countsByMonth.get(m) ?? 0) + 1);
    if (!yearsByMonth.has(m)) yearsByMonth.set(m, new Set<number>());
    yearsByMonth.get(m)!.add(d.getUTCFullYear());
  }

  let dominantMonth = -1;
  let dominantCount = 0;
  for (const entry of Array.from(countsByMonth.entries())) {
    const [m, count] = entry;
    if (count > dominantCount) {
      dominantMonth = m;
      dominantCount = count;
    }
  }
  if (dominantMonth < 0) return null;

  const yearsSeen = yearsByMonth.get(dominantMonth) ?? new Set<number>();
  if (dominantCount < 2 || yearsSeen.size < 2) return null;

  const confidence = dominantCount / dates.length;
  if (confidence < MIN_SEASONAL_CONFIDENCE) return null;

  // Predicted window: the dominant month in the next upcoming occurrence.
  // If we're already past the end of that month this year, roll forward.
  const now = new Date();
  let year = now.getUTCFullYear();
  const thisYearMonthEnd = new Date(Date.UTC(year, dominantMonth + 1, 0, 23, 59, 59, 999));
  if (thisYearMonthEnd.getTime() < now.getTime()) year += 1;
  const predictedWindowStart = new Date(Date.UTC(year, dominantMonth, 1));
  const predictedWindowEnd = new Date(Date.UTC(year, dominantMonth + 1, 0, 23, 59, 59, 999));

  const lastInMonth = [...dates]
    .filter((d) => d.getUTCMonth() === dominantMonth)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const patternSummary =
    `Orders typically in ${MONTH_NAMES[dominantMonth]}, last in ${formatMonthYear(lastInMonth)}, ` +
    `next window predicted ${formatMonthYear(predictedWindowStart)}`;

  return { predictedWindowStart, predictedWindowEnd, confidence, patternSummary };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthYear(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
