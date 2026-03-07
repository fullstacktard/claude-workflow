/**
 * useXAccounts Hook
 *
 * Fetches initial X account list via REST, then subscribes to the /ws/logs
 * WebSocket for real-time x_account_updated and x_accounts_snapshot messages.
 * Maintains a reactive array of DashboardXAccount objects for the account list panel.
 *
 * Pattern follows useSessionState.ts: own WS connection, subscribe_all,
 * heartbeat ping, exponential backoff reconnect.
 *
 * @module hooks/useXAccounts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSServerMessage, XAccountUpdatedPayload } from "../types/websocket";
import type { DashboardXAccount } from "../types/x-accounts";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** WebSocket URL for log streaming (same endpoint as useSessionState) */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** REST endpoint for initial account list */
const ACCOUNTS_URL = "/api/x-accounts";

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

/** Result shape returned by useXAccounts */
export interface UseXAccountsResult {
  /** Current account list (reactive) */
  accounts: DashboardXAccount[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Get a specific account by ID */
  getAccount: (id: string) => DashboardXAccount | undefined;
}

/**
 * Hook providing X account data with real-time WebSocket updates.
 *
 * On mount:
 * 1. Fetches account list via GET /api/x-accounts
 * 2. Opens WS to /ws/logs with subscribe_all
 * 3. Listens for x_accounts_snapshot (full replacement) and
 *    x_account_updated (partial merge by accountId)
 */
export function useXAccounts(): UseXAccountsResult {
  const [accounts, setAccounts] = useState<DashboardXAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // ── REST fetch on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await dashboardFetch(ACCOUNTS_URL);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json()) as { accounts: DashboardXAccount[] };
        if (cancelled) return;
        setAccounts(data.accounts ?? []);
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

  // ── Re-fetch helper (called from WS handlers) ──────────────────
  const refetchAccounts = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(ACCOUNTS_URL, { skipErrorEvents: true });
      if (!res.ok) return;
      const data = (await res.json()) as { accounts: DashboardXAccount[] };
      setAccounts(data.accounts ?? []);
    } catch {
      // Silently ignore re-fetch errors; existing data remains
    }
  }, []);

  // ── WebSocket for real-time updates ──────────────────────────────
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

          // x_accounts_snapshot: WS sends lightweight account summaries on initial subscribe.
          // Trigger a full REST re-fetch to get the complete DashboardXAccount DTOs.
          if (message.type === "x_accounts_snapshot") {
            void refetchAccounts();
            return;
          }

          // x_account_updated: A single account changed (warming step, import, etc.).
          // For vault_file_change events, re-fetch the full list via REST.
          // For targeted updates with known account, merge what we can inline.
          if (message.type === "x_account_updated") {
            const payload = message.payload as XAccountUpdatedPayload | undefined;
            if (!payload?.accountId) return;

            if (payload.changeSource === "vault_file_change") {
              // Vault-level change: re-fetch full list for accurate state
              void refetchAccounts();
            } else {
              // Targeted update: update state inline for immediate feedback,
              // then re-fetch in background for complete DTO
              setAccounts((prev) =>
                prev.map((a) =>
                  a.id === payload.accountId
                    ? {
                        ...a,
                        handle: payload.handle,
                        state: payload.currentState as DashboardXAccount["state"],
                        updated_at: payload.timestamp,
                      }
                    : a,
                ),
              );
              void refetchAccounts();
            }
            return;
          }
        } catch {
          // Ignore parse errors for non-X message types
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

    return () => {
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
  }, []);

  const getAccount = useCallback(
    (id: string): DashboardXAccount | undefined => accounts.find((a) => a.id === id),
    [accounts],
  );

  return { accounts, loading, error, getAccount };
}
