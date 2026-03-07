/**
 * TypeScript interfaces for Trends feature.
 * Frontend-safe DTOs for trending topics, viral tweets, and sparkline data.
 *
 * @module types/trend
 */

/** Supported trend regions */
export type TrendRegion = "us" | "global" | "eu" | "uk";

/** A single trending topic */
export interface Trend {
  /** Unique identifier */
  id: string;
  /** Topic name or hashtag */
  name: string;
  /** Current tweet volume (null if unknown) */
  tweetVolume: number | null;
  /** Volume change percentage vs previous period */
  volumeChangePercent: number;
  /** 24-point volume history for sparkline rendering */
  volumeHistory: number[];
  /** Topic category tag (e.g., "tech", "politics", null if uncategorized) */
  category: string | null;
  /** ISO timestamp of when this trend was last updated */
  updatedAt: string;
}

/** A viral tweet with engagement metrics */
export interface ViralTweet {
  /** Tweet ID */
  id: string;
  /** Tweet full text */
  text: string;
  /** Author handle (without @) */
  authorHandle: string;
  /** Author display name */
  authorName: string;
  /** Like count */
  likes: number;
  /** Retweet count */
  retweets: number;
  /** Reply count */
  replies: number;
  /** ISO timestamp of tweet creation */
  createdAt: string;
  /** Related trend name (if associated) */
  relatedTrend: string | null;
}
