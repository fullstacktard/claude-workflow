/**
 * useBrandVoices Hook
 * Fetches and manages brand voice list + individual brand voice retrieval.
 *
 * Pattern follows useCompetitors.ts:
 *   - REST fetch on mount via dashboardFetch
 *   - loading/error/refetch state
 *   - Individual fetch for full config (includes few_shot_examples, system_prompt_template)
 *
 * @module hooks/useBrandVoices
 */

import { useCallback, useEffect, useState } from "react";

import { dashboardFetch } from "../utils/dashboard-fetch";
import type { BrandVoice, BrandVoiceSummary } from "../types/marketing";

interface UseBrandVoicesResult {
  voices: BrandVoiceSummary[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  fetchVoice: (id: string) => Promise<BrandVoice>;
}

export function useBrandVoices(): UseBrandVoicesResult {
  const [voices, setVoices] = useState<BrandVoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchVoices = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardFetch("/api/marketing/brand-voices");
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to fetch brand voices");
      }
      const data = (await response.json()) as {
        voices: BrandVoiceSummary[] | { brand_voices: BrandVoiceSummary[] };
      };
      const raw = data.voices;
      setVoices(
        Array.isArray(raw) ? raw : (raw?.brand_voices ?? []),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVoice = useCallback(async (id: string): Promise<BrandVoice> => {
    const response = await dashboardFetch(`/api/marketing/brand-voices/${id}`);
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "Failed to fetch brand voice");
    }
    return (await response.json()) as BrandVoice;
  }, []);

  useEffect(() => {
    void fetchVoices();
  }, [fetchVoices]);

  return { voices, loading, error, refetch: fetchVoices, fetchVoice };
}
