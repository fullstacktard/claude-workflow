/**
 * useEngagementAnalytics Hook
 *
 * Fetches engagement analytics data from the dashboard REST API.
 * Provides stats, top posts, posting insights, and competitor benchmarks.
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";

const ANALYTICS_URL = "/api/analytics";

/** Aggregate engagement stats */
export interface EngagementStats {
  total_posts: number;
  avg_weighted_score: number;
  total_engagement: number;
  avg_engagement_rate: number;
  total_impressions: number;
  period_start: string;
  period_end: string;
}

/** Post engagement row from analytics DB */
export interface TopPost {
  id: number;
  post_id: string;
  snapshot_date: string;
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
  impressions: number;
  clicks: number;
  weighted_score: number;
  platform: string;
  content_type: string;
  posted_at: string;
}

/** Day-of-week performance */
export interface DayInsight {
  day_of_week: string;
  avg_score: number;
  post_count: number;
}

/** Hour-of-day performance */
export interface HourInsight {
  hour: number;
  avg_score: number;
  post_count: number;
}

/** Content type performance */
export interface ContentTypeInsight {
  type: string;
  avg_score: number;
  post_count: number;
  avg_engagement_rate: number;
}

/** Posting insights response */
export interface PostingInsights {
  best_days: DayInsight[];
  best_hours: HourInsight[];
  content_types: ContentTypeInsight[];
}

/** Competitor benchmark data */
export interface CompetitorBenchmark {
  competitor_id: string;
  total_posts: number;
  avg_weighted_score: number;
  avg_engagement_rate: number;
  top_post_score: number;
  posting_frequency: number;
}

export interface UseEngagementAnalyticsResult {
  stats: EngagementStats | null;
  topPosts: TopPost[];
  insights: PostingInsights | null;
  benchmarks: CompetitorBenchmark[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEngagementAnalytics(
  days = 30,
  platform?: string,
): UseEngagementAnalyticsResult {
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [topPosts, setTopPosts] = useState<TopPost[]>([]);
  const [insights, setInsights] = useState<PostingInsights | null>(null);
  const [benchmarks, setBenchmarks] = useState<CompetitorBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (platform) params.set("platform", platform);
      const qs = params.toString();

      const [statsRes, postsRes, insightsRes, benchmarksRes] =
        await Promise.all([
          dashboardFetch(`${ANALYTICS_URL}/stats?${qs}`),
          dashboardFetch(`${ANALYTICS_URL}/top-posts?${qs}&limit=10`),
          dashboardFetch(`${ANALYTICS_URL}/insights?${qs}`),
          dashboardFetch(`${ANALYTICS_URL}/benchmarks?days=${String(days)}`),
        ]);

      if (!statsRes.ok) throw new Error(`Stats: HTTP ${String(statsRes.status)}`);
      if (!postsRes.ok) throw new Error(`Top posts: HTTP ${String(postsRes.status)}`);
      if (!insightsRes.ok) throw new Error(`Insights: HTTP ${String(insightsRes.status)}`);
      if (!benchmarksRes.ok) throw new Error(`Benchmarks: HTTP ${String(benchmarksRes.status)}`);

      setStats((await statsRes.json()) as EngagementStats);
      setTopPosts((await postsRes.json()) as TopPost[]);
      setInsights((await insightsRes.json()) as PostingInsights);
      setBenchmarks((await benchmarksRes.json()) as CompetitorBenchmark[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [days, platform]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return {
    stats,
    topPosts,
    insights,
    benchmarks,
    loading,
    error,
    refetch: (): void => void fetchAll(),
  };
}
