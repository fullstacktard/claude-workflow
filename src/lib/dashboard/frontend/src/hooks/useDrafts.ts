/**
 * useDrafts Hook
 *
 * Fetches initial draft list via REST, then subscribes to the /ws/logs
 * WebSocket for real-time draft_updated and draft_published messages.
 * Maintains a reactive array of Draft objects for the review queue.
 *
 * Pattern follows useXAccounts.ts: own WS connection, subscribe_all,
 * heartbeat ping, exponential backoff reconnect.
 *
 * REST API: GET /api/drafts?status=...&persona_id=...&date_from=...&date_to=...
 *
 * @module hooks/useDrafts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DraftPublishedPayload, DraftUpdatedPayload, WSServerMessage } from "../types/websocket";
import type { Draft, DraftFilterState, DraftStatus } from "../types/draft";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** WebSocket URL for log streaming (same endpoint as useXAccounts) */
const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/logs`;

/** REST endpoint for drafts */
const DRAFTS_URL = "/api/drafts";

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

/** Result shape returned by useDrafts */
export interface UseDraftsResult {
  /** Current draft list (reactive) */
  drafts: Draft[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** State setter for optimistic updates */
  setDrafts: Dispatch<SetStateAction<Draft[]>>;
  /** Manual re-fetch trigger */
  refetch: () => Promise<void>;
}

/**
 * Build query string from filter state.
 * Returns empty string if no filters active, otherwise "?status=...&persona_id=..." etc.
 */
function buildQueryString(f: DraftFilterState): string {
  const params = new URLSearchParams();
  if (f.status !== "all") params.set("status", f.status);
  if (f.personaId) params.set("persona_id", f.personaId);
  if (f.dateRange) {
    params.set("date_from", f.dateRange.start);
    params.set("date_to", f.dateRange.end);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Hook providing draft data with real-time WebSocket updates.
 *
 * On mount:
 * 1. Fetches drafts via GET /api/drafts?status=...
 * 2. Opens WS to /ws/logs with subscribe_all
 * 3. Listens for draft_updated (inline merge) and draft_published (status update)
 */
export function useDrafts(filters: DraftFilterState): UseDraftsResult {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // REST fetch
  const fetchDrafts = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(`${DRAFTS_URL}${buildQueryString(filters)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { drafts: Draft[] };
      setDrafts(data.drafts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Initial fetch on mount or filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async (): Promise<void> => {
      await fetchDrafts();
      if (cancelled) return;
    })();
    return (): void => {
      cancelled = true;
    };
  }, [fetchDrafts]);

  // Use a ref to hold current filters so the WS handler always reads the latest
  // without causing WebSocket reconnection on every filter change.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Re-fetch helper for WS handlers. Uses filtersRef to avoid stale closures.
  const refetchDrafts = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(`${DRAFTS_URL}${buildQueryString(filtersRef.current)}`, { skipErrorEvents: true });
      if (!res.ok) return;
      const data = (await res.json()) as { drafts: Draft[] };
      setDrafts(data.drafts ?? []);
    } catch {
      // Silently ignore re-fetch errors; existing data remains
    }
  }, []);

  // WebSocket for real-time updates -- stable connection independent of filters
  useEffect(() => {
    let disposed = false;

    function connect(): void {
      if (disposed) return;

      const ws = new WebSocket(WS_URL);

      ws.onopen = (): void => {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        ws.send(JSON.stringify({ type: "subscribe_all" }));

        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event: MessageEvent): void => {
        try {
          const message = JSON.parse(event.data as string) as WSServerMessage;

          // drafts_snapshot: WS sends draft summaries on initial subscribe.
          // Trigger a full REST re-fetch to get the complete Draft DTOs.
          if (message.type === "drafts_snapshot") {
            void refetchDrafts();
            return;
          }

          // draft_updated: a single draft changed (edit, approve, reject)
          if (message.type === "draft_updated") {
            const payload = message.payload as DraftUpdatedPayload | undefined;
            if (!payload?.draftId) return;

            setDrafts((prev) => {
              const exists = prev.some((d) => d.id === payload.draftId);
              if (!exists) {
                // New draft -- re-fetch full list
                void refetchDrafts();
                return prev;
              }
              return prev.map((d) =>
                d.id === payload.draftId
                  ? {
                      ...d,
                      ...(payload.status ? { status: payload.status as DraftStatus } : {}),
                      _optimistic: false,
                    }
                  : d,
              );
            });
            return;
          }

          // draft_published: draft was published to X
          if (message.type === "draft_published") {
            const payload = message.payload as DraftPublishedPayload | undefined;
            if (!payload?.draftId) return;

            setDrafts((prev) =>
              prev.map((d) =>
                d.id === payload.draftId
                  ? { ...d, status: "published" as DraftStatus, tweetId: payload.tweetId ?? null, _optimistic: false }
                  : d,
              ),
            );
            return;
          }
        } catch {
          // Ignore parse errors for non-draft message types
        }
      };

      ws.onclose = (): void => {
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (disposed) return;

        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (): void => {
        // onclose handles reconnection
      };

      wsRef.current = ws;
    }

    const timer = setTimeout(connect, 0);

    return (): void => {
      disposed = true;
      clearTimeout(timer);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [refetchDrafts]);

  return { drafts, loading, error, setDrafts, refetch: refetchDrafts };
}
