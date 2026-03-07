/**
 * useLinkedInStatus Hook
 *
 * Fetches LinkedIn OAuth connection status via REST on mount.
 * Provides methods to start OAuth flow, disconnect, and refetch status.
 *
 * Pattern follows useXAccounts.ts: REST fetch on mount,
 * loading/error/data states, typed response.
 *
 * @module hooks/useLinkedInStatus
 */

import { useCallback, useEffect, useState } from "react";

import type { LinkedInConnection } from "../types/marketing";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** REST endpoint for LinkedIn connection status */
const STATUS_URL = "/api/marketing/linkedin/status";

/** Result shape returned by useLinkedInStatus */
export interface UseLinkedInStatusResult {
  /** Current LinkedIn connection state (reactive) */
  connection: LinkedInConnection | null;
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Re-fetch connection status from the server */
  refetch: () => Promise<void>;
  /** Start OAuth flow - returns the authorization URL or null on failure */
  startOAuth: () => Promise<string | null>;
  /** Disconnect LinkedIn account - returns true on success */
  disconnect: () => Promise<boolean>;
}

/**
 * Hook providing LinkedIn connection data with OAuth management.
 *
 * On mount:
 * 1. Fetches connection status via GET /api/marketing/linkedin/status
 * 2. Exposes startOAuth() for initiating OAuth flow via POST /api/marketing/linkedin/connect
 * 3. Exposes disconnect() for removing connection via POST /api/marketing/linkedin/disconnect
 */
export function useLinkedInStatus(): UseLinkedInStatusResult {
  const [connection, setConnection] = useState<LinkedInConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(STATUS_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as LinkedInConnection;
      setConnection(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  // REST fetch on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await dashboardFetch(STATUS_URL);
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json()) as LinkedInConnection;
        if (cancelled) return;
        setConnection(data);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startOAuth = useCallback(async (): Promise<string | null> => {
    try {
      const res = await dashboardFetch("/api/marketing/linkedin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uri: `${window.location.origin}/api/marketing/linkedin/callback`,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { authorization_url: string };
      return data.authorization_url;
    } catch {
      return null;
    }
  }, []);

  const disconnect = useCallback(async (): Promise<boolean> => {
    try {
      const res = await dashboardFetch("/api/marketing/linkedin/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        setConnection({ connected: false, account: null, tokenStatus: "no_token" });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return { connection, loading, error, refetch: fetchStatus, startOAuth, disconnect };
}
