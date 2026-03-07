/**
 * EngagementRateComparisonChart Component
 *
 * Horizontal bar chart comparing engagement rates across competitors.
 * CSS-only bars with terminal aesthetic. Optional "You" bar highlighted
 * in red-400, competitor bars in gray-600.
 *
 * @module components/analytics/EngagementRateComparisonChart
 */

import type { CompetitorBenchmark } from "./types";

interface EngagementRateComparisonChartProps {
  competitors: CompetitorBenchmark[];
  /** The user's own engagement rate (shown as a highlighted "You" bar) */
  userRate?: number;
}

/**
 * Renders horizontal bar chart comparing engagement rates.
 * Displays empty state when no data is available.
 */
export function EngagementRateComparisonChart({
  competitors,
  userRate,
}: EngagementRateComparisonChartProps): JSX.Element {
  if (competitors.length === 0 && userRate === undefined) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-600">
        No engagement data available
      </div>
    );
  }

  // Combine user + competitors for max calculation
  const allRates = [
    ...(userRate !== undefined ? [userRate] : []),
    ...competitors.map((c) => c.avg_engagement_rate),
  ];
  const maxRate = Math.max(...allRates, 1);

  return (
    <div className="space-y-2">
      {/* User's own rate (highlighted) */}
      {userRate !== undefined && (
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs font-medium text-red-400">
            You
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-gray-800">
            <div
              className="h-full rounded bg-red-400 transition-all duration-300"
              style={{ width: `${String((userRate / maxRate) * 100)}%` }}
            />
          </div>
          <span className="w-14 text-right font-mono text-xs text-red-400">
            {userRate.toFixed(2)}%
          </span>
        </div>
      )}

      {/* Competitor rates */}
      {competitors.map((c) => (
        <div key={c.competitor_id} className="flex items-center gap-2">
          <span
            className="w-24 shrink-0 truncate text-xs text-gray-400"
            title={`@${c.competitor_id}`}
          >
            @{c.competitor_id}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-gray-800">
            <div
              className="h-full rounded bg-gray-600 transition-all duration-300"
              style={{
                width: `${String((c.avg_engagement_rate / maxRate) * 100)}%`,
              }}
            />
          </div>
          <span className="w-14 text-right font-mono text-xs text-gray-500">
            {c.avg_engagement_rate.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}
