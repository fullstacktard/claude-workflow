/**
 * CompetitorBenchmarks Component
 *
 * Container component for all competitor benchmarking visualizations.
 * Handles competitor selection filter and orchestrates data fetching
 * via useCompetitorBenchmarks hook. Wraps child charts in TerminalCard
 * components for consistent terminal aesthetic.
 *
 * Layout:
 *   - Competitor filter buttons (top)
 *   - CompetitorComparisonTable (full width)
 *   - EngagementRateComparisonChart + ContentTypeDistribution (2-col on lg)
 *   - PostingFrequencyChart (full width)
 *   - TopCompetitorPosts (full width)
 *
 * @module components/analytics/CompetitorBenchmarks
 */

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { TerminalCard } from "../TerminalCard";
import { LoadingSpinner } from "../LoadingSpinner";
import { useCompetitorBenchmarks } from "../../hooks/useCompetitorBenchmarks";
import { CompetitorComparisonTable } from "./CompetitorComparisonTable";
import { EngagementRateComparisonChart } from "./EngagementRateComparisonChart";
import { ContentTypeDistribution } from "./ContentTypeDistribution";
import { PostingFrequencyChart } from "./PostingFrequencyChart";
import { TopCompetitorPosts } from "./TopCompetitorPosts";

interface CompetitorBenchmarksProps {
  /** Number of days to look back (7, 30, 60, 90) */
  dateRange: number;
}

/**
 * Container component for competitor benchmarking section.
 * Manages competitor filter state and renders all chart sub-components.
 */
export function CompetitorBenchmarks({
  dateRange,
}: CompetitorBenchmarksProps): JSX.Element {
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const {
    benchmarks,
    topPosts,
    contentTypes,
    loading,
    error,
    allCompetitorIds,
    refetch,
  } = useCompetitorBenchmarks(dateRange, selectedCompetitors);

  /** Toggle a competitor in/out of the selection filter */
  function toggleCompetitor(id: string): void {
    setSelectedCompetitors((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  /* ── Error state ────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-600">
        <p className="text-sm text-red-400">
          Failed to load competitor data
        </p>
        <p className="text-xs">{error.message}</p>
        <button
          type="button"
          onClick={refetch}
          className="mt-2 cursor-pointer rounded-md border border-gray-700 bg-gray-900 px-3.5 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-800"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Competitor filter + refresh ──────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Filter:</span>
          <button
            type="button"
            onClick={() => setSelectedCompetitors([])}
            className={`cursor-pointer rounded border px-2 py-0.5 text-xs transition-colors ${
              selectedCompetitors.length === 0
                ? "border-red-400 bg-red-400/10 text-red-400"
                : "border-gray-700 text-gray-500 hover:text-gray-300"
            }`}
          >
            All
          </button>
          {allCompetitorIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggleCompetitor(id)}
              className={`cursor-pointer rounded border px-2 py-0.5 text-xs transition-colors ${
                selectedCompetitors.includes(id)
                  ? "border-red-400 bg-red-400/10 text-red-400"
                  : "border-gray-700 text-gray-500 hover:text-gray-300"
              }`}
            >
              @{id}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refetch}
          title="Refresh competitor data"
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-gray-700 bg-transparent text-gray-400 transition-colors duration-150 hover:bg-gray-800 hover:text-gray-200"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Loading state ──────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="md" text="Loading competitor data..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Comparison table - full width */}
          <div className="lg:col-span-12">
            <TerminalCard command="diff" filename="competitors.csv">
              <CompetitorComparisonTable competitors={benchmarks} />
            </TerminalCard>
          </div>

          {/* Engagement rate chart - 6 cols */}
          <div className="lg:col-span-6">
            <TerminalCard command="bar" filename="engagement-rates">
              <EngagementRateComparisonChart competitors={benchmarks} />
            </TerminalCard>
          </div>

          {/* Content type distribution - 6 cols */}
          <div className="lg:col-span-6">
            <TerminalCard command="stat" filename="content-types">
              <ContentTypeDistribution data={contentTypes} />
            </TerminalCard>
          </div>

          {/* Posting frequency - full width */}
          <div className="lg:col-span-12">
            <TerminalCard command="rate" filename="posting-frequency">
              <PostingFrequencyChart competitors={benchmarks} />
            </TerminalCard>
          </div>

          {/* Top competitor posts - full width */}
          <div className="lg:col-span-12">
            <TerminalCard command="head" filename="top-competitor-posts.log">
              <TopCompetitorPosts posts={topPosts} />
            </TerminalCard>
          </div>
        </div>
      )}
    </div>
  );
}
