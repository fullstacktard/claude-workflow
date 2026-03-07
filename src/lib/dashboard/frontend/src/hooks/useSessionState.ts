/**
 * useSessionState Hook
 *
 * Fetches initial session states via REST, then connects to the /ws/logs
 * WebSocket for real-time session_state_change updates. Maintains a reactive
 * Map of session states for use by components that display session activity
 * indicators (TreeItem icons, toasts, etc.).
 *
 * @module hooks/useSessionState
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStateChangePayload, WSServerMessage } from "../types/websocket";

/** WebSocket URL for log streaming */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** REST endpoint for initial session states */
const STATES_URL = `${window.location.origin}/api/session-states`;

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

export interface UseSessionStateResult {
  /** Map of session name to latest state payload */
  states: Map<string, SessionStateChangePayload>;
  /** Get state for a specific session */
  getState: (sessionName: string) => SessionStateChangePayload | undefined;
}

export function useSessionState(): UseSessionStateResult {
  const [states, setStates] = useState<Map<string, SessionStateChangePayload>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // Fetch initial states via REST
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(STATES_URL);
        if (!res.ok) return;
        const data = (await res.json()) as { states: SessionStateChangePayload[] };
        if (cancelled || !data.states?.length) return;
        setStates((prev) => {
          const next = new Map(prev);
          for (const s of data.states) {
            if (s.sessionName) next.set(s.sessionName, s);
          }
          return next;
        });
      } catch {
        // Ignore fetch errors
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // WebSocket for real-time updates
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
          if (message.type !== "session_state_change") return;

          const payload = message.payload as SessionStateChangePayload | undefined;
          if (!payload?.sessionName) return;

          setStates((prev) => {
            const next = new Map(prev);
            next.set(payload.sessionName, payload);
            return next;
          });
        } catch {
          // Ignore parse errors
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

  const getState = useCallback(
    (sessionName: string): SessionStateChangePayload | undefined => {
      return states.get(sessionName);
    },
    [states],
  );

  return { states, getState };
}
