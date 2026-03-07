/**
 * Competitor Benchmarking Types
 *
 * Shared type definitions for competitor benchmarking UI components.
 *
 * @module components/analytics/types
 */

/** Per-competitor aggregate metrics from the benchmarks API */
export interface CompetitorBenchmark {
  competitor_id: string;
  total_posts: number;
  avg_weighted_score: number;
  avg_engagement_rate: number;
  top_post_score: number;
  posting_frequency: number;
}

/** Individual competitor post with engagement breakdown */
export interface CompetitorPost {
  competitor_id: string;
  tweet_id: string;
  weighted_score: number;
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
  content_type: string;
  posted_at: string;
}

/** Per-competitor content type distribution */
export interface CompetitorContentType {
  competitor_id: string;
  types: Array<{ type: string; count: number }>;
}

/** Full response shape from /api/analytics/benchmarks (enhanced) */
export interface BenchmarksResponse {
  benchmarks: CompetitorBenchmark[];
  top_posts: CompetitorPost[];
  content_types: CompetitorContentType[];
  all_competitor_ids: string[];
}
