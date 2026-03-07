/**
 * useEmailAudiences Hook
 *
 * Fetches available email audience/segment list via REST.
 * Provides segment data for the audience selector in the campaign editor.
 *
 * @module hooks/useEmailAudiences
 */

import { useCallback, useEffect, useState } from "react";
import type { EmailAudience } from "../types/marketing";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** REST endpoint for audience/segment list */
const AUDIENCES_URL = "/api/marketing/email/audiences";

/** Result shape returned by useEmailAudiences */
export interface UseEmailAudiencesResult {
  /** Available audience segments */
  audiences: EmailAudience[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Re-fetch audience list */
  refetch: () => Promise<void>;
}

/**
 * Hook providing email audience/segment data.
 *
 * On mount:
 * 1. Fetches audience list via GET /api/marketing/email/audiences
 * 2. Returns typed audience array with contact counts
 */
export function useEmailAudiences(): UseEmailAudiencesResult {
  const [audiences, setAudiences] = useState<EmailAudience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAudiences = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(AUDIENCES_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { audiences: EmailAudience[] };
      setAudiences(data.audiences ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAudiences();
  }, [fetchAudiences]);

  return { audiences, loading, error, refetch: fetchAudiences };
}
