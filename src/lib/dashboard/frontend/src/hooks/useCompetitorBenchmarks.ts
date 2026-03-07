/**
 * useCompetitorBenchmarks Hook
 *
 * Fetches competitor benchmarking data from the dashboard REST API.
 * Re-fetches when date range or selected competitors change.
 * Uses the existing /api/analytics/benchmarks endpoint with enhanced response shape.
 *
 * @module hooks/useCompetitorBenchmarks
 */

import { useCallback, useEffect, useState } from "react";

import { dashboardFetch } from "../utils/dashboard-fetch";
import type {
  CompetitorBenchmark,
  CompetitorPost,
  CompetitorContentType,
  BenchmarksResponse,
} from "../components/analytics/types";

export interface UseCompetitorBenchmarksResult {
  benchmarks: CompetitorBenchmark[];
  topPosts: CompetitorPost[];
  contentTypes: CompetitorContentType[];
  loading: boolean;
  error: Error | null;
  allCompetitorIds: string[];
  refetch: () => void;
}

/**
 * Hook to fetch and manage competitor benchmarking data.
 *
 * @param days - Number of days to look back (7, 30, 60, 90)
 * @param selectedCompetitors - Array of competitor IDs to filter by (empty = all)
 * @returns Benchmarks, top posts, content types, and loading/error state
 */
export function useCompetitorBenchmarks(
  days: number,
  selectedCompetitors: string[],
): UseCompetitorBenchmarksResult {
  const [benchmarks, setBenchmarks] = useState<CompetitorBenchmark[]>([]);
  const [topPosts, setTopPosts] = useState<CompetitorPost[]>([]);
  const [contentTypes, setContentTypes] = useState<CompetitorContentType[]>([]);
  const [allCompetitorIds, setAllCompetitorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Serialize selectedCompetitors to a stable string for dependency tracking
  const competitorKey = selectedCompetitors.join(",");

  const fetchBenchmarks = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ days: String(days) });
      if (competitorKey) {
        params.set("competitor_ids", competitorKey);
      }

      const res = await dashboardFetch(
        `/api/analytics/benchmarks?${params.toString()}`,
        { timeoutMs: 15_000 },
      );

      if (!res.ok) {
        throw new Error(`HTTP ${String(res.status)}`);
      }

      const data = (await res.json()) as BenchmarksResponse | CompetitorBenchmark[];

      // Handle both enhanced response shape and legacy array response
      if (Array.isArray(data)) {
        // Legacy: API returns plain array of benchmarks
        const sorted = [...data].sort(
          (a, b) => b.avg_weighted_score - a.avg_weighted_score,
        );
        setBenchmarks(sorted);
        setTopPosts([]);
        setContentTypes([]);
        setAllCompetitorIds(sorted.map((b) => b.competitor_id));
      } else {
        // Enhanced: API returns full response object
        const sorted = [...data.benchmarks].sort(
          (a, b) => b.avg_weighted_score - a.avg_weighted_score,
        );
        setBenchmarks(sorted);
        setTopPosts(data.top_posts ?? []);
        setContentTypes(data.content_types ?? []);
        setAllCompetitorIds(
          data.all_competitor_ids ??
            sorted.map((b) => b.competitor_id),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [days, competitorKey]);

  useEffect(() => {
    void fetchBenchmarks();
  }, [fetchBenchmarks]);

  return {
    benchmarks,
    topPosts,
    contentTypes,
    loading,
    error,
    allCompetitorIds,
    refetch: (): void => void fetchBenchmarks(),
  };
}
