/**
 * useEmailCampaigns Hook
 *
 * Fetches email campaign list via REST and provides a sendBroadcast action
 * for creating / scheduling email broadcasts.
 *
 * Pattern follows useXAccounts.ts: REST fetch, loading/error states, typed responses.
 *
 * @module hooks/useEmailCampaigns
 */

import { useCallback, useEffect, useState } from "react";
import type { EmailCampaign } from "../types/marketing";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** REST endpoint for campaign list */
const CAMPAIGNS_URL = "/api/marketing/email/campaigns";

/** REST endpoint for sending / scheduling broadcasts */
const BROADCAST_URL = "/api/marketing/email/broadcast";

/** Parameters accepted by the broadcast action */
export interface SendBroadcastParams {
  segmentId: string;
  from: string;
  subject: string;
  html: string;
  previewText?: string;
  name?: string;
  scheduledAt?: string;
}

/** Result returned by the broadcast action */
export interface SendBroadcastResult {
  success: boolean;
  broadcastId?: string;
  error?: string;
}

/** Result shape returned by useEmailCampaigns */
export interface UseEmailCampaignsResult {
  /** Current campaign list (reactive) */
  campaigns: EmailCampaign[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Re-fetch campaign list */
  refetch: () => Promise<void>;
  /** Send or schedule a broadcast */
  sendBroadcast: (params: SendBroadcastParams) => Promise<SendBroadcastResult>;
}

/**
 * Hook providing email campaign data with send/schedule capability.
 *
 * On mount:
 * 1. Fetches campaign list via GET /api/marketing/email/campaigns
 * 2. Exposes sendBroadcast() for POST /api/marketing/email/broadcast
 * 3. Automatically re-fetches after a successful broadcast
 */
export function useEmailCampaigns(): UseEmailCampaignsResult {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaigns = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(CAMPAIGNS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { campaigns: EmailCampaign[] };
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

  const sendBroadcast = useCallback(
    async (params: SendBroadcastParams): Promise<SendBroadcastResult> => {
      try {
        const res = await dashboardFetch(BROADCAST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segment_id: params.segmentId,
            from: params.from,
            subject: params.subject,
            html: params.html,
            preview_text: params.previewText,
            name: params.name,
            scheduled_at: params.scheduledAt,
          }),
          timeoutMs: 30_000,
        });
        const data = (await res.json()) as {
          success?: boolean;
          broadcast_id?: string;
          error?: string;
        };
        if (data.success) void fetchCampaigns();
        return {
          success: !!data.success,
          broadcastId: data.broadcast_id,
          error: data.error,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [fetchCampaigns],
  );

  return { campaigns, loading, error, refetch: fetchCampaigns, sendBroadcast };
}
