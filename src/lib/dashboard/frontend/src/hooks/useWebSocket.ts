/**
 * Custom hook for WebSocket connection management
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LogEntry,
  LogEventPayload,
  Session,
  SessionUpdatePayload,
  WSClientMessage,
  WSServerMessage,
} from "../types";

/** Sessions API URL */
const SESSIONS_API_URL = "/api/sessions";

/** WebSocket URL */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30000;

/** Initial reconnection delay (1 second) */
const INITIAL_RECONNECT_DELAY = 1000;

/** Maximum reconnection delay (30 seconds) */
const MAX_RECONNECT_DELAY = 30000;

/** Maximum log entries to keep in memory */
const MAX_LOG_ENTRIES = 500;

/**
 * Result of the useWebSocket hook
 */
interface UseWebSocketResult {
  /** Whether WebSocket is connected */
  connected: boolean;
  /** Connection error if any */
  error: Error | null;
  /** Log entries received */
  logs: LogEntry[];
  /** Last WebSocket message received (for CLI login events, etc.) */
  lastMessage: WSServerMessage | null;
  /** Active sessions */
  sessions: Session[];
  /** Subscribe to a session */
  subscribe: (sessionId: string) => void;
  /** Unsubscribe from a session */
  unsubscribe: (sessionId: string) => void;
}

/**
 * Custom hook for WebSocket connection
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lastMessage, setLastMessage] = useState<WSServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);

  /**
   * Send message to WebSocket server
   */
  const send = useCallback((message: WSClientMessage): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Subscribe to a session
   */
  const subscribe = useCallback(
    (sessionId: string): void => {
      send({ sessionId, type: "subscribe" });
    },
    [send]
  );

  /**
   * Unsubscribe from a session
   */
  const unsubscribe = useCallback(
    (sessionId: string): void => {
      send({ sessionId, type: "unsubscribe" });
    },
    [send]
  );

  /**
   * Start heartbeat timer
   */
  const startHeartbeat = useCallback((): void => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
    }
    heartbeatRef.current = setInterval(() => {
      send({ type: "ping" });
    }, HEARTBEAT_INTERVAL);
  }, [send]);

  /**
   * Stop heartbeat timer
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * Handle incoming message
   */
  const handleMessage = useCallback((event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as WSServerMessage;

      // Store last message for components that need it (CLI login, etc.)
      setLastMessage(message);

      switch (message.type) {
        case "cli_login_url":
        case "cli_login_complete":
        case "cli_login_error":
        case "credentials_updated":
          // These messages are handled via lastMessage by consuming components
          break;
        case "log": {
          const payload = message.payload as LogEventPayload | undefined;
          if (payload !== undefined && "eventType" in payload) {
            const logEntry: LogEntry = {
              data: payload.data,
              eventType: payload.eventType,
              sessionId: message.sessionId ?? "",
              timestamp: message.timestamp,
            };
            setLogs((prev) => {
              const updated = [...prev, logEntry];
              // Keep only last MAX_LOG_ENTRIES
              return updated.slice(-MAX_LOG_ENTRIES);
            });
          }
          break;
        }
        case "session-update": {
          const payload = message.payload as SessionUpdatePayload | undefined;
          if (payload !== undefined && "status" in payload) {
            const { status } = payload;
            if (status === "started" && message.sessionId !== undefined) {
              setSessions((prev) => [
                ...prev,
                { id: message.sessionId!, status: "active" },
              ]);
            } else if (status === "ended" && message.sessionId !== undefined) {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === message.sessionId ? { ...s, status: "ended" } : s
                )
              );
            }
          }
          break;
        }
        case "error": {
          const payload = message.payload as { message?: string } | undefined;
          if (payload !== undefined && "message" in payload) {
            setError(new Error(payload.message ?? "Unknown error"));
          }
          break;
        }
        case "pong":
        case "subscribed":
        case "unsubscribed":
        case "warning":
          // Acknowledgment messages, no action needed
          break;
      }
    } catch (err) {
      console.error("[useWebSocket] Failed to parse message:", err);
    }
  }, []);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback((): void => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;

    // Clean up existing connection
    if (wsRef.current !== null) {
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = (): void => {
      isConnectingRef.current = false;
      setConnected(true);
      setError(null);
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      startHeartbeat();
      // Subscribe to all events (global subscriber) to receive CLI login broadcasts
      ws.send(JSON.stringify({ type: "subscribe_all" }));
    };

    ws.onmessage = handleMessage;

    ws.onclose = (): void => {
      isConnectingRef.current = false;
      setConnected(false);
      stopHeartbeat();

      // Schedule reconnection with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = (): void => {
      setError(new Error("WebSocket connection error"));
    };

    wsRef.current = ws;
  }, [handleMessage, startHeartbeat, stopHeartbeat]);

  /**
   * Fetch initial sessions from REST API
   */
  const fetchInitialSessions = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(SESSIONS_API_URL);
      if (!response.ok) {
        console.error("[useWebSocket] Failed to fetch sessions:", response.status);
        return;
      }
      const data = await response.json() as { sessions: Array<{ id: string; status: string; projectName?: string; elapsedTime?: string }> };
      if (Array.isArray(data.sessions)) {
        const mappedSessions: Session[] = data.sessions.map((s) => ({
          id: s.id,
          status: s.status === "active" ? "active" : s.status === "ended" ? "ended" : "paused",
          projectName: s.projectName,
          elapsedTime: s.elapsedTime,
        }));
        setSessions(mappedSessions);
      }
    } catch (err) {
      console.error("[useWebSocket] Error fetching sessions:", err);
    }
  }, []);

  /**
   * Initialize connection on mount
   *
   * The deferred setTimeout(connect, 0) prevents React 18 strict mode from
   * creating a WebSocket that gets immediately closed during the rapid
   * mount → unmount → remount cycle, which would cause a browser warning:
   * "WebSocket is closed before the connection is established."
   */
  useEffect(() => {
    // Fetch initial sessions from REST API
    void fetchInitialSessions();

    // Connect WebSocket for live updates (deferred to survive strict mode)
    const timer = setTimeout(() => {
      connect();
    }, 0);

    return () => {
      clearTimeout(timer);
      stopHeartbeat();
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
      }
    };
  }, [connect, fetchInitialSessions, stopHeartbeat]);

  return {
    connected,
    error,
    lastMessage,
    logs,
    sessions,
    subscribe,
    unsubscribe,
  };
}
