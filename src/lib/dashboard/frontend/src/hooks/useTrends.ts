/**
 * useTrends Hook
 *
 * Fetches trending topics via GET /api/trends and viral tweets via
 * GET /api/trends/viral. Polls every 60 seconds.
 * Uses dashboardFetch for consistent error handling.
 *
 * Pattern follows useServiceHealth.ts: useCallback + setInterval + cleanup.
 *
 * @module hooks/useTrends
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";
import type { Trend, ViralTweet, TrendRegion } from "../types/trend";

/** Polling interval in milliseconds (60 seconds) */
const POLL_INTERVAL = 60_000;

/** Fetch timeout in milliseconds */
const FETCH_TIMEOUT = 10_000;

export interface UseTrendsOptions {
  /** Region filter (default: "us") */
  region?: TrendRegion;
  /** Number of trends to fetch (default: 10) */
  count?: number;
  /** Polling interval override in ms (default: 60000) */
  pollInterval?: number;
  /** Whether to also fetch viral tweets (default: false) */
  includeViral?: boolean;
}

export interface UseTrendsResult {
  /** Array of trending topics */
  trends: Trend[];
  /** Array of viral tweets (only populated when includeViral is true) */
  viralTweets: ViralTweet[];
  /** Whether the initial load is in progress */
  loading: boolean;
  /** Last fetch error, or null */
  error: Error | null;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
}

interface TrendsApiResponse {
  trends: Trend[];
}

interface ViralApiResponse {
  viral: ViralTweet[];
}

export function useTrends(options: UseTrendsOptions = {}): UseTrendsResult {
  const {
    region = "us",
    count = 10,
    pollInterval = POLL_INTERVAL,
    includeViral = false,
  } = options;

  const [trends, setTrends] = useState<Trend[]>([]);
  const [viralTweets, setViralTweets] = useState<ViralTweet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFirstFetchRef = useRef(true);

  const fetchTrends = useCallback(async (): Promise<void> => {
    try {
      const trendsResponse = await dashboardFetch(
        `/api/trends?region=${encodeURIComponent(region)}&count=${String(count)}`,
        { timeoutMs: FETCH_TIMEOUT },
      );

      if (!trendsResponse.ok) {
        throw new Error(`Failed to fetch trends: ${String(trendsResponse.status)}`);
      }

      const trendsData = (await trendsResponse.json()) as TrendsApiResponse;

      // Merge state to avoid flicker -- only update if data arrived
      setTrends(trendsData.trends ?? []);

      // Optionally fetch viral tweets
      if (includeViral) {
        const viralResponse = await dashboardFetch(
          `/api/trends/viral?limit=${String(count)}`,
          { timeoutMs: FETCH_TIMEOUT },
        );

        if (viralResponse.ok) {
          const viralData = (await viralResponse.json()) as ViralApiResponse;
          setViralTweets(viralData.viral ?? []);
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      if (isFirstFetchRef.current) {
        setLoading(false);
        isFirstFetchRef.current = false;
      }
    }
  }, [region, count, includeViral]);

  useEffect(() => {
    // Reset on region/count change
    isFirstFetchRef.current = true;
    setLoading(true);

    // Initial fetch
    void fetchTrends();

    // Poll on interval, but skip when tab is hidden to save bandwidth
    intervalRef.current = setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void fetchTrends();
      }
    }, pollInterval);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchTrends, pollInterval]);

  return { trends, viralTweets, loading, error, refetch: fetchTrends };
}
