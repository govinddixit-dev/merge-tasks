import { useContext } from "react";
import { StoreContext } from "./StoreContext";
import { trpc } from "@/lib/trpc";

interface BudgetBannerProps {
  storeId: number;
  isDark: boolean;
  cartTotalCents?: number;
}

export function BudgetBanner({ storeId, isDark, cartTotalCents = 0 }: BudgetBannerProps) {
  const { data: budget } = trpc.storeDepartmentBudgets.getMyBudget.useQuery(
    { storeId },
    { enabled: !!storeId }
  );

  if (!budget?.hasDepartment && !budget?.spendingLimit) return null;

  const cardBg = isDark ? "#1a1a1a" : "#F9FAFB";
  const borderColor = isDark ? "#333" : "#E5E7EB";

  if (budget?.department) {
    const dept = budget.department;
    const projectedSpent = dept.spentCents + cartTotalCents;
    const projectedRemaining = dept.remainingCents - cartTotalCents;
    const isOverBudget = projectedRemaining < 0;
    const isWarning = dept.utilizationPercent >= (dept.warnThresholdPct ?? 80);
    const barColor = isOverBudget ? "#DC2626" : isWarning ? "#CA8A04" : "#16A34A";

    const formatDollars = (cents: number) =>
      `$${(Math.abs(cents) / 100).toFixed(2)}`;

    return (
      <div
        className="rounded-xl border p-3 mb-4 text-[12px]"
        style={{ backgroundColor: cardBg, borderColor }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold" style={{ color: isDark ? "#fff" : "#111" }}>
            {dept.name} Budget
          </span>
          <span className="font-mono font-semibold" style={{ color: barColor }}>
            {isOverBudget
              ? `Over by ${formatDollars(Math.abs(projectedRemaining))}`
              : `${formatDollars(projectedRemaining)} remaining`}
          </span>
        </div>

        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden mb-1.5">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, (projectedSpent / dept.budgetCents) * 100)}%`,
              backgroundColor: barColor,
            }}
          />
        </div>

        <div className="flex justify-between text-gray-500">
          <span>{formatDollars(projectedSpent)} spent{cartTotalCents > 0 ? " (incl. this order)" : ""}</span>
          <span>{formatDollars(dept.budgetCents)} total</span>
        </div>

        {isOverBudget && (
          <div className="mt-2 text-red-600 font-medium">
            ⚠ This order exceeds your department budget. Contact your manager to proceed.
          </div>
        )}

        {!isOverBudget && isWarning && (
          <div className="mt-2 text-amber-600 font-medium">
            You've used {dept.utilizationPercent}% of your department budget.
          </div>
        )}

        {dept.maxPerOrderCents && cartTotalCents > dept.maxPerOrderCents && (
          <div className="mt-2 text-red-600 font-medium">
            ⚠ This order exceeds the per-order limit of {formatDollars(dept.maxPerOrderCents)}.
          </div>
        )}
      </div>
    );
  }

  if (budget?.spendingLimit) {
    return (
      <div
        className="rounded-xl border p-3 mb-4 text-[12px]"
        style={{ backgroundColor: cardBg, borderColor }}
      >
        <span className="font-semibold" style={{ color: isDark ? "#fff" : "#111" }}>
          Spending limit: ${parseFloat(budget.spendingLimit).toFixed(2)} per order
        </span>
      </div>
    );
  }

  return null;
}
