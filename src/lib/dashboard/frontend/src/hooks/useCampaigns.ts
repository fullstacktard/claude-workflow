/**
 * useCampaigns Hook
 *
 * Fetches the campaign list via REST and provides methods for
 * creating and updating campaigns. Follows the useXAccounts pattern
 * with REST fetch on mount, loading/error states, and refetch on mutation.
 *
 * @module hooks/useCampaigns
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** Summary of a campaign returned by the list endpoint */
export interface CampaignSummary {
  id: string;
  name: string;
  description?: string;
  platforms: Array<"x" | "linkedin" | "email">;
  status: "draft" | "active" | "completed";
  goal?: string;
  start_date?: string;
  end_date?: string;
  post_ids: Partial<Record<"x" | "linkedin" | "email", string>>;
  created_at: string;
  updated_at: string;
}

/** Return type for useCampaigns hook */
export interface UseCampaignsResult {
  campaigns: CampaignSummary[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  createCampaign: (params: {
    name: string;
    platforms: string[];
    description?: string;
    goal?: string;
    start_date?: string;
    end_date?: string;
    auto_create_posts?: boolean;
    post_content?: string;
  }) => Promise<CampaignSummary | null>;
  updateCampaign: (
    id: string,
    updates: Record<string, unknown>,
  ) => Promise<CampaignSummary | null>;
}

const CAMPAIGNS_URL = "/api/marketing/campaigns";

/**
 * Hook for managing the campaign list with CRUD operations.
 *
 * On mount: fetches all campaigns via GET /api/marketing/campaigns.
 * After mutations (create/update): automatically refetches the list.
 */
export function useCampaigns(): UseCampaignsResult {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaigns = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(CAMPAIGNS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { total: number; campaigns: CampaignSummary[] };
      setCampaigns(data.campaigns ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  const createCampaign = useCallback(
    async (params: {
      name: string;
      platforms: string[];
      description?: string;
      goal?: string;
      start_date?: string;
      end_date?: string;
      auto_create_posts?: boolean;
      post_content?: string;
    }): Promise<CampaignSummary | null> => {
      try {
        const res = await dashboardFetch(CAMPAIGNS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        if (!res.ok) return null;
        const campaign = (await res.json()) as CampaignSummary;
        void fetchCampaigns();
        return campaign;
      } catch {
        return null;
      }
    },
    [fetchCampaigns],
  );

  const updateCampaign = useCallback(
    async (id: string, updates: Record<string, unknown>): Promise<CampaignSummary | null> => {
      try {
        const res = await dashboardFetch(`${CAMPAIGNS_URL}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) return null;
        const campaign = (await res.json()) as CampaignSummary;
        void fetchCampaigns();
        return campaign;
      } catch {
        return null;
      }
    },
    [fetchCampaigns],
  );

  return { campaigns, loading, error, refetch: fetchCampaigns, createCampaign, updateCampaign };
}
