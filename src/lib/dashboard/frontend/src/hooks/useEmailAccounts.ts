/**
 * useEmailAccounts Hook
 *
 * Fetches initial email account list via REST, then subscribes to /ws/logs
 * WebSocket for real-time email_account_updated and email_accounts_snapshot messages.
 * Maintains a reactive array of DashboardEmailAccount objects for the account list panel.
 *
 * Pattern follows useXAccounts.ts: own WS connection, subscribe_all,
 * heartbeat ping, exponential backoff reconnect.
 *
 * @module hooks/useEmailAccounts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSServerMessage } from "../types/websocket";
import type { DashboardEmailAccount } from "../types/email-accounts";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** WebSocket URL for log streaming (same endpoint as useXAccounts) */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** REST endpoint for initial account list */
const ACCOUNTS_URL = "/api/email-accounts";

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

/** Result shape returned by useEmailAccounts */
export interface UseEmailAccountsResult {
  /** Current account list (reactive) */
  accounts: DashboardEmailAccount[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Get a specific account by ID */
  getAccount: (id: string) => DashboardEmailAccount | undefined;
  /** Manually refetch accounts */
  refetch: () => Promise<void>;
}

/**
 * Hook providing email account data with real-time WebSocket updates.
 *
 * On mount:
 * 1. Fetches account list via GET /api/email-accounts
 * 2. Opens WS to /ws/logs with subscribe_all
 * 3. Listens for email_accounts_snapshot (triggers refetch) and
 *    email_account_updated (triggers refetch)
 */
export function useEmailAccounts(): UseEmailAccountsResult {
  const [accounts, setAccounts] = useState<DashboardEmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // -- REST fetch on mount --
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await dashboardFetch(ACCOUNTS_URL);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json()) as
          | { accounts: DashboardEmailAccount[] }
          | DashboardEmailAccount[];
        if (cancelled) return;
        setAccounts(Array.isArray(data) ? data : data.accounts ?? []);
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

  // -- Re-fetch helper (called from WS handlers) --
  const refetchAccounts = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(ACCOUNTS_URL, { skipErrorEvents: true });
      if (!res.ok) return;
      const data = (await res.json()) as
        | { accounts: DashboardEmailAccount[] }
        | DashboardEmailAccount[];
      setAccounts(Array.isArray(data) ? data : data.accounts ?? []);
    } catch {
      // Silently ignore re-fetch errors; existing data remains
    }
  }, []);

  // -- WebSocket for real-time updates --
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

          // email_accounts_snapshot: full list refresh on initial subscribe
          if (message.type === "email_accounts_snapshot") {
            void refetchAccounts();
            return;
          }

          // email_account_updated: single account changed
          if (message.type === "email_account_updated") {
            void refetchAccounts();
            return;
          }
        } catch {
          // Ignore parse errors for non-email message types
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
  }, [refetchAccounts]);

  const getAccount = useCallback(
    (id: string): DashboardEmailAccount | undefined =>
      accounts.find((a) => a.id === id),
    [accounts],
  );

  return { accounts, loading, error, getAccount, refetch: refetchAccounts };
}
