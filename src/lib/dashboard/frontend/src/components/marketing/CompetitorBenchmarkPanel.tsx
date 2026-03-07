/**
 * CompetitorBenchmarkPanel Component
 *
 * Displays competitor engagement benchmarks fetched from the analytics API.
 * Shows a comparison table with scoring, engagement rates, and posting frequency.
 * Includes day-range selector (7d, 30d, 90d) and refresh capability.
 *
 * @module components/marketing/CompetitorBenchmarkPanel
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, AlertCircle } from "lucide-react";

import { dashboardFetch } from "../../utils/dashboard-fetch";

interface CompetitorBenchmark {
  competitor_id: string;
  total_posts: number;
  avg_weighted_score: number;
  avg_engagement_rate: number;
  top_post_score: number;
  posting_frequency: number;
}

interface CompetitorBenchmarkPanelProps {
  className?: string;
}

type DayRange = 7 | 30 | 90;

const DAY_OPTIONS: DayRange[] = [7, 30, 90];

export function CompetitorBenchmarkPanel({
  className = "",
}: CompetitorBenchmarkPanelProps): JSX.Element {
  const [benchmarks, setBenchmarks] = useState<CompetitorBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayRange>(30);

  const fetchBenchmarks = useCallback(async (dayRange: DayRange): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardFetch(
        `/api/analytics/benchmarks?days=${dayRange}`,
        { timeoutMs: 15_000 }
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? `Failed to fetch benchmarks (${response.status})`);
      }
      const data = (await response.json()) as
        | CompetitorBenchmark[]
        | { benchmarks?: CompetitorBenchmark[] };
      const items = Array.isArray(data) ? data : (data.benchmarks ?? []);
      // Sort by avg_weighted_score descending
      items.sort((a, b) => b.avg_weighted_score - a.avg_weighted_score);
      setBenchmarks(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch benchmarks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBenchmarks(days);
  }, [days, fetchBenchmarks]);

  const handleDayChange = useCallback((newDays: DayRange): void => {
    setDays(newDays);
  }, []);

  const handleRefresh = useCallback((): void => {
    void fetchBenchmarks(days);
  }, [days, fetchBenchmarks]);

  // Compute averages for the summary row
  const averages = computeAverages(benchmarks);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h2 className="text-xs font-medium text-gray-300">Competitor Benchmarks</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Day range selector */}
          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleDayChange(d)}
                className={`h-6 px-2 text-xs rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 ${
                  days === d
                    ? "bg-red-700 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
                }`}
                aria-pressed={days === d}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-600"
            aria-label="Refresh benchmarks"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="spinner w-5 h-5" />
            <span className="ml-2 text-gray-500 text-xs">Loading benchmarks...</span>
          </div>
        )}

        {/* Error state */}
        {error !== null && !loading && (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <AlertCircle className="h-6 w-6 text-red-400 mb-2" aria-hidden="true" />
            <p className="text-xs text-red-400 text-center mb-3">{error}</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="h-7 px-3 text-xs rounded-md bg-red-700 text-white border border-red-600 hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && error === null && benchmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-6 w-6 text-gray-600 mb-2" aria-hidden="true" />
            <p className="text-gray-500 text-xs">No benchmark data available</p>
            <p className="text-gray-600 text-xs mt-1">
              Add competitors and scrape their posts to see benchmarks
            </p>
          </div>
        )}

        {/* Data table */}
        {!loading && error === null && benchmarks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" role="table">
              <thead>
                <tr className="bg-gray-800/50 text-gray-400">
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Competitor
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    Posts
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    Avg Score
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    Engagement Rate
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    Top Score
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    Frequency
                  </th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => (
                  <tr
                    key={b.competitor_id}
                    className={i % 2 === 0 ? "bg-gray-900" : "bg-gray-900/60"}
                  >
                    <td className="px-3 py-2 text-gray-300 font-medium">
                      @{b.competitor_id}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">
                      {b.total_posts}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={getScoreColor(b.avg_weighted_score, averages.avg_weighted_score)}
                      >
                        {b.avg_weighted_score.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">
                      {(b.avg_engagement_rate * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">
                      {b.top_post_score.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">
                      {b.posting_frequency.toFixed(1)} posts/day
                    </td>
                  </tr>
                ))}

                {/* Average summary row */}
                <tr className="border-t border-gray-700 bg-gray-800/30 font-medium">
                  <td className="px-3 py-2 text-gray-400 italic">Average</td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {averages.total_posts.toFixed(0)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {averages.avg_weighted_score.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {(averages.avg_engagement_rate * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {averages.top_post_score.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {averages.posting_frequency.toFixed(1)} posts/day
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Returns a Tailwind text color class based on whether value is above or below avg */
function getScoreColor(value: number, avg: number): string {
  if (value > avg) return "text-green-400";
  if (value < avg) return "text-red-400";
  return "text-gray-300";
}

/** Compute column averages from benchmark rows */
function computeAverages(benchmarks: CompetitorBenchmark[]): CompetitorBenchmark {
  if (benchmarks.length === 0) {
    return {
      competitor_id: "avg",
      total_posts: 0,
      avg_weighted_score: 0,
      avg_engagement_rate: 0,
      top_post_score: 0,
      posting_frequency: 0,
    };
  }

  const count = benchmarks.length;
  return {
    competitor_id: "avg",
    total_posts: benchmarks.reduce((s, b) => s + b.total_posts, 0) / count,
    avg_weighted_score: benchmarks.reduce((s, b) => s + b.avg_weighted_score, 0) / count,
    avg_engagement_rate: benchmarks.reduce((s, b) => s + b.avg_engagement_rate, 0) / count,
    top_post_score: benchmarks.reduce((s, b) => s + b.top_post_score, 0) / count,
    posting_frequency: benchmarks.reduce((s, b) => s + b.posting_frequency, 0) / count,
  };
}
