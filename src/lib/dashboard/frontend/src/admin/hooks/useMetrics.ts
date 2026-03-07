/**
 * useMetrics Hook
 *
 * Fetches revenue analytics metrics from /api/admin/metrics.
 * Polls every 60 seconds for live updates.
 * Follows useEngagementAnalytics pattern.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardFetch } from "../../utils/dashboard-fetch";

const METRICS_URL = "/api/admin/metrics";
const POLL_INTERVAL_MS = 60_000;

export interface KPIData {
  mrr: number; // cents
  activeSubscribers: number;
  churnRate: number; // 0-100
  arpu: number; // cents
}

export interface TimeSeriesPoint {
  date: string; // formatted label
  timestamp: string; // ISO 8601
  mrr: number; // dollars
  subscribers: number;
  free: number;
  pro: number;
}

export interface TierRevenue {
  name: string;
  value: number; // dollars
  color: string;
}

export interface SubscriptionEvent {
  id: string;
  timestamp: string;
  type:
    | "subscription.created"
    | "subscription.canceled"
    | "subscription.updated";
  customerEmail: string;
  tier: string;
  amountCents: number;
  status: "active" | "canceled" | "churned" | "upgraded";
}

export interface MetricsData {
  kpi: KPIData;
  previousKpi: KPIData | null;
  timeSeries: TimeSeriesPoint[];
  revenueByTier: TierRevenue[];
  recentEvents: SubscriptionEvent[];
}

export interface UseMetricsResult {
  data: MetricsData | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMetrics(days = 30): UseMetricsResult {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isInitialLoad = useRef(true);

  const fetchMetrics = useCallback(async (): Promise<void> => {
    if (isInitialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      // Polar API expects start_date, end_date, interval — convert days param
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const params = new URLSearchParams({
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        interval: days <= 7 ? "day" : days <= 90 ? "day" : "week",
      });
      const response = await dashboardFetch(
        `${METRICS_URL}?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(
          `Metrics: HTTP ${String(response.status)}`,
        );
      }

      const json = (await response.json()) as MetricsData;
      setData(json);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
      isInitialLoad.current = false;
    }
  }, [days]);

  useEffect(() => {
    isInitialLoad.current = true;
    void fetchMetrics();

    const intervalId = setInterval(() => {
      void fetchMetrics();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [fetchMetrics]);

  return {
    data,
    loading,
    refreshing,
    error,
    refetch: (): void => void fetchMetrics(),
  };
}
