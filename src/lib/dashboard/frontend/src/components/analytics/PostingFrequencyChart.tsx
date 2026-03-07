/**
 * PostingFrequencyChart Component
 *
 * Horizontal bar chart showing posts/day for each competitor.
 * CSS-only bars with terminal aesthetic and monospace values.
 *
 * @module components/analytics/PostingFrequencyChart
 */

import type { CompetitorBenchmark } from "./types";

interface PostingFrequencyChartProps {
  competitors: CompetitorBenchmark[];
}

/**
 * Renders horizontal bar chart showing posting frequency (posts/day)
 * for each competitor. Displays empty state when no data is available.
 */
export function PostingFrequencyChart({
  competitors,
}: PostingFrequencyChartProps): JSX.Element {
  if (competitors.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-600">
        No posting frequency data available
      </div>
    );
  }

  const maxFreq = Math.max(
    ...competitors.map((c) => c.posting_frequency),
    0.1,
  );

  return (
    <div className="space-y-2">
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
              className="h-full rounded bg-emerald-500/60 transition-all duration-300"
              style={{
                width: `${String((c.posting_frequency / maxFreq) * 100)}%`,
              }}
            />
          </div>
          <span className="w-16 text-right font-mono text-xs text-gray-500">
            {c.posting_frequency.toFixed(1)}/day
          </span>
        </div>
      ))}
    </div>
  );
}
