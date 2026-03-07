/**
 * useSubscribers Hook
 *
 * Fetches paginated subscriber data from /api/admin/subscribers.
 * Supports search by email, status filtering, and product tier filtering.
 * Follows the useMetrics/useCompetitors hook pattern.
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type { Subscription, PaginatedResponse } from "../types/admin";

const SUBSCRIBERS_URL = "/api/admin/subscribers";

export interface UseSubscribersParams {
  search?: string;
  status?: string;
  productName?: string;
  page?: number;
  limit?: number;
}

export interface UseSubscribersResult {
  subscriptions: Subscription[];
  totalCount: number;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useSubscribers(params: UseSubscribersParams): UseSubscribersResult {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSubscribers = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const url = new URL(SUBSCRIBERS_URL, window.location.origin);
      if (params.search) url.searchParams.set("search", params.search);
      if (params.status) url.searchParams.set("status", params.status);
      if (params.productName) url.searchParams.set("product_name", params.productName);
      url.searchParams.set("page", String(params.page ?? 1));
      url.searchParams.set("limit", String(params.limit ?? 25));

      const res = await dashboardFetch(url.pathname + url.search);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as PaginatedResponse<Subscription>;

      setSubscriptions(data.items);
      setTotalCount(data.pagination.total_count);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [params.search, params.status, params.productName, params.page, params.limit]);

  useEffect(() => {
    void fetchSubscribers();
  }, [fetchSubscribers]);

  return { subscriptions, totalCount, loading, error, refetch: fetchSubscribers };
}
