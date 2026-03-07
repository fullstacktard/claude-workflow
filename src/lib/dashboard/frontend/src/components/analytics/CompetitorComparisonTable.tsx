/**
 * CompetitorComparisonTable Component
 *
 * Side-by-side table comparing competitor metrics.
 * Terminal aesthetic with red-800 borders and monospace values.
 * Shows per-competitor: avg engagement rate, total posts, avg weighted score,
 * posting frequency (posts/day).
 *
 * @module components/analytics/CompetitorComparisonTable
 */

import type { CompetitorBenchmark } from "./types";

interface CompetitorComparisonTableProps {
  competitors: CompetitorBenchmark[];
}

/**
 * Renders a comparison table with key metrics for each competitor.
 * Displays empty state when no data is available.
 */
export function CompetitorComparisonTable({
  competitors,
}: CompetitorComparisonTableProps): JSX.Element {
  if (competitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-sm text-gray-600">
        <p>No competitor data available</p>
        <p className="mt-1 text-xs text-gray-700">
          Add competitors in the Marketing page to start benchmarking
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="border-b border-red-800/50">
            <th
              className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Competitor
            </th>
            <th
              className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Posts
            </th>
            <th
              className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Avg Score
            </th>
            <th
              className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Eng. Rate
            </th>
            <th
              className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Top Post
            </th>
            <th
              className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
              scope="col"
            >
              Posts/Day
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {competitors.map((c) => (
            <tr
              key={c.competitor_id}
              className="transition-colors hover:bg-gray-800/30"
            >
              <td className="px-3 py-2 font-mono text-gray-300">
                @{c.competitor_id}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">
                {c.total_posts}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-red-400">
                {c.avg_weighted_score.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">
                {c.avg_engagement_rate.toFixed(2)}%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">
                {c.top_post_score.toFixed(0)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">
                {c.posting_frequency.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
