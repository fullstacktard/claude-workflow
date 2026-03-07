/**
 * useGeeLarkPhones - Polls the phone fleet list at 15-second intervals.
 *
 * Follows the same fetch + setInterval + cleanup pattern as AccountUsageWidget.
 * Returns the current phone list, loading/error state, and a manual refresh function.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GeeLarkPhone } from "../types/x-accounts";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** Polling interval for the phone list (15 seconds) */
const PHONE_POLL_INTERVAL = 15_000;

interface UseGeeLarkPhonesReturn {
  /** Current list of GeeLark phones */
  phones: GeeLarkPhone[];
  /** True during the initial fetch only */
  loading: boolean;
  /** Most recent fetch error, null if last fetch succeeded */
  error: Error | null;
  /** Trigger an immediate re-fetch of the phone list */
  refresh: () => Promise<void>;
}

export function useGeeLarkPhones(): UseGeeLarkPhonesReturn {
  const [phones, setPhones] = useState<GeeLarkPhone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchPhones = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch("/api/geelark/phones", { skipErrorEvents: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = (await res.json()) as
        | GeeLarkPhone[]
        | { data?: { items?: GeeLarkPhone[] }; items?: GeeLarkPhone[] };
      // geelark_list_phones returns { data: { items: [...] } } or flat array
      const data = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: { items?: GeeLarkPhone[] } }).data?.items)
          ? (json as { data: { items: GeeLarkPhone[] } }).data.items
          : Array.isArray((json as { items?: GeeLarkPhone[] }).items)
            ? (json as { items: GeeLarkPhone[] }).items
            : [];
      if (mountedRef.current) {
        setPhones(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchPhones();
    const interval = setInterval(() => {
      fetchPhones().catch(console.error);
    }, PHONE_POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchPhones]);

  return { phones, loading, error, refresh: fetchPhones };
}
