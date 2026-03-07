/**
 * useCompetitors Hook
 *
 * Fetches competitor list via REST GET /api/marketing/competitors.
 * Provides refetch callback for post-mutation refreshes.
 *
 * @module hooks/useCompetitors
 */

import { useCallback, useEffect, useState } from "react";
import type { Competitor } from "../types/marketing";
import { dashboardFetch } from "../utils/dashboard-fetch";

const COMPETITORS_URL = "/api/marketing/competitors";

export interface UseCompetitorsResult {
  competitors: Competitor[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useCompetitors(): UseCompetitorsResult {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCompetitors = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(COMPETITORS_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as {
        competitors: Competitor[] | { competitors: Competitor[] };
      };
      const raw = data.competitors;
      setCompetitors(
        Array.isArray(raw) ? raw : (raw?.competitors ?? []),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCompetitors();
  }, [fetchCompetitors]);

  const refetch = useCallback(async (): Promise<void> => {
    await fetchCompetitors();
  }, [fetchCompetitors]);

  return { competitors, loading, error, refetch };
}
