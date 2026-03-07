/**
 * useCampaignDetail Hook
 *
 * Fetches a single campaign with its linked posts and aggregate analytics
 * when a campaign ID changes. Provides loading/error states and a refetch method.
 *
 * @module hooks/useCampaignDetail
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** A post linked to a campaign, with platform-specific engagement metrics */
export interface LinkedPost {
  id: string;
  content: string;
  platform: "x" | "linkedin" | "email";
  status: string;
  scheduled_at?: string;
  published_at?: string;
  engagement_metrics?: {
    impressions?: number;
    likes?: number;
    replies?: number;
    reposts?: number;
    clicks?: number;
  };
}

/** Aggregate analytics for a campaign */
export interface CampaignAnalytics {
  total_posts: number;
  platforms_published: string[];
  total_impressions: number;
  total_likes: number;
  total_replies: number;
  total_reposts: number;
  total_clicks: number;
  total_weighted_score: number;
  per_platform: Record<
    string,
    {
      impressions?: number;
      likes?: number;
      replies?: number;
      reposts?: number;
      clicks?: number;
      weighted_score: number;
    }
  >;
  collected_at: string;
}

/** Full campaign detail including linked posts */
export interface CampaignDetail {
  id: string;
  name: string;
  description?: string;
  platforms: string[];
  status: "draft" | "active" | "completed";
  goal?: string;
  start_date?: string;
  end_date?: string;
  post_ids: Record<string, string>;
  linked_posts: LinkedPost[];
  created_at: string;
  updated_at: string;
}

/** Return type for useCampaignDetail hook */
export interface UseCampaignDetailResult {
  campaign: CampaignDetail | null;
  analytics: CampaignAnalytics | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching a single campaign with linked posts and analytics.
 *
 * When campaignId is null, resets to empty state.
 * When campaignId changes, fetches both the campaign detail and analytics in parallel.
 */
export function useCampaignDetail(campaignId: string | null): UseCampaignDetailResult {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetail = useCallback(async (): Promise<void> => {
    if (!campaignId) {
      setCampaign(null);
      setAnalytics(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [campaignRes, analyticsRes] = await Promise.all([
        dashboardFetch(`/api/marketing/campaigns/${campaignId}`),
        dashboardFetch(`/api/marketing/campaigns/${campaignId}/analytics`),
      ]);

      if (!campaignRes.ok) throw new Error(`HTTP ${campaignRes.status}: ${campaignRes.statusText}`);

      const campaignData = (await campaignRes.json()) as CampaignDetail;
      setCampaign(campaignData);

      if (analyticsRes.ok) {
        const analyticsData = (await analyticsRes.json()) as CampaignAnalytics;
        setAnalytics(analyticsData);
      } else {
        setAnalytics(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  return { campaign, analytics, loading, error, refetch: fetchDetail };
}
