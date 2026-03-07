/**
 * usePersonas Hook
 *
 * Fetches persona list via REST. No WebSocket needed --
 * personas change infrequently (CRUD operations only).
 * Pattern follows useXAccounts.ts but simplified.
 *
 * @module hooks/usePersonas
 */

import { useCallback, useEffect, useState } from "react";
import type { DashboardPersona, UsePersonasResult } from "../types/persona";
import { dashboardFetch } from "../utils/dashboard-fetch";

const PERSONAS_URL = "/api/personas";

export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<DashboardPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPersonas = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(PERSONAS_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { personas: DashboardPersona[] };
      setPersonas(data.personas ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchPersonas();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPersonas]);

  const refetch = useCallback(async (): Promise<void> => {
    await fetchPersonas();
  }, [fetchPersonas]);

  return { personas, loading, error, refetch };
}
