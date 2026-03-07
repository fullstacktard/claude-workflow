/**
 * Hook for real-time Docker container log streaming via WebSocket
 *
 * Provides WebSocket-based real-time updates for Docker container logs (claude-proxy, mcp-proxy).
 * More efficient than REST API polling as logs are pushed in real-time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DockerLogPayload, WSServerMessage } from "../types";

/** Maximum log entries to keep per container */
const MAX_LOG_ENTRIES = 500;

/** WebSocket URL - uses current host for correct port in Docker environments */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** Debug logging helper - only logs in development */
const logDebug = (message: string, ...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.log(`[useDockerLogs] ${message}`, ...args);
  }
};

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30000;

/** Initial reconnection delay (1 second) */
const INITIAL_RECONNECT_DELAY = 1000;

/** Maximum reconnection delay (30 seconds) */
const MAX_RECONNECT_DELAY = 30000;

/**
 * Docker log entry for display
 */
export interface DockerLogEntry {
  container: string;
  level: "debug" | "error" | "info" | "warn";
  message: string;
  stream: "stderr" | "stdout";
  timestamp: string;
}

/**
 * Connection status type
 */
export type DockerLogStatus = "connected" | "connecting" | "disconnected" | "error";

/**
 * Result of useDockerLogs hook
 */
export interface UseDockerLogsResult {
  /** All Docker log entries received */
  entries: DockerLogEntry[];
  /** claude-proxy container logs */
  claudeProxyEntries: DockerLogEntry[];
  /** MCP Proxy container logs */
  mcpproxyEntries: DockerLogEntry[];
  /** Dashboard container logs */
  dashboardEntries: DockerLogEntry[];
  /** Current connection status */
  status: DockerLogStatus;
  /** Error message if any */
  error: string | null;
  /** Clear all entries */
  clearEntries: () => void;
  /** Clear entries for a specific container */
  clearContainerEntries: (container: string) => void;
}

/**
 * Custom hook for Docker container logs via WebSocket
 *
 * Connects to the dashboard WebSocket server and receives real-time Docker log events.
 * Automatically subscribes to all sessions to receive docker_log messages.
 */
export function useDockerLogs(): UseDockerLogsResult {
  const [entries, setEntries] = useState<DockerLogEntry[]>([]);
  const [status, setStatus] = useState<DockerLogStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);

  /**
   * Send message to WebSocket server
   */
  const send = useCallback((message: Record<string, unknown>): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

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
   * Handle incoming WebSocket message
   */
  const handleMessage = useCallback((event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as WSServerMessage;
      logDebug(`Received message type: ${message.type}`);

      // Handle subscription confirmations
      if (message.type === "subscribed_all") {
        logDebug("Subscription confirmed: subscribed_all");
        return;
      }

      // Handle pong messages (heartbeat response)
      if (message.type === "pong") {
        logDebug("Received pong response");
        return;
      }

      // Only handle docker_log messages
      if (message.type === "docker_log" && message.payload !== undefined) {
        const payload = message.payload as DockerLogPayload;
        logDebug(`Docker log from ${payload.container}: ${payload.message.substring(0, 50)}...`);

        const entry: DockerLogEntry = {
          container: payload.container,
          level: payload.level,
          message: payload.message,
          stream: payload.stream,
          timestamp: payload.timestamp,
        };

        setEntries((prev) => {
          const updated = [...prev, entry];
          // Keep only last MAX_LOG_ENTRIES
          return updated.slice(-MAX_LOG_ENTRIES);
        });
      }
    } catch (err) {
      console.error("[useDockerLogs] Failed to parse message:", err);
    }
  }, []);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback((): void => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      logDebug("Connection already in progress, skipping");
      return;
    }

    isConnectingRef.current = true;
    setStatus("connecting");
    logDebug(`Connecting to WebSocket at: ${WS_URL}`);

    // Clean up existing connection
    if (wsRef.current !== null) {
      logDebug("Closing existing WebSocket connection");
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = (): void => {
      logDebug("WebSocket connection established");
      isConnectingRef.current = false;
      setStatus("connected");
      setError(null);
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      startHeartbeat();

      // Subscribe to all sessions to receive docker_log messages
      logDebug("Sending subscribe_all message");
      send({ type: "subscribe_all" });
    };

    ws.onmessage = handleMessage;

    ws.onclose = (event: CloseEvent): void => {
      logDebug(`WebSocket closed: code=${event.code}, reason=${event.reason || "none"}, wasClean=${event.wasClean}`);
      isConnectingRef.current = false;
      setStatus("disconnected");
      stopHeartbeat();

      // Schedule reconnection with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      logDebug(`Scheduling reconnection in ${delay}ms`);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = (event: Event): void => {
      logDebug("WebSocket error:", event);
      setError("WebSocket connection error");
      setStatus("error");
    };

    wsRef.current = ws;
  }, [handleMessage, send, startHeartbeat, stopHeartbeat]);

  /**
   * Clear all entries
   */
  const clearEntries = useCallback((): void => {
    setEntries([]);
  }, []);

  /**
   * Clear entries for a specific container
   */
  const clearContainerEntries = useCallback((container: string): void => {
    setEntries((prev) => prev.filter((e) => e.container !== container));
  }, []);

  /**
   * Filter entries by container - memoized to prevent re-renders
   */
  const claudeProxyEntries = useMemo(
    () => entries.filter((e) => e.container === "claude-proxy"),
    [entries]
  );
  const mcpproxyEntries = useMemo(
    () => entries.filter((e) => e.container === "mcp-proxy"),
    [entries]
  );
  const dashboardEntries = useMemo(
    () => entries.filter((e) => e.container === "claude-dashboard"),
    [entries]
  );

  /**
   * Initialize connection on mount
   * Note: Empty dependency array - connect once on mount, cleanup on unmount
   * Using refs to avoid dependency issues that cause flickering reconnections
   */
  useEffect(() => {
    connect();

    return () => {
      stopHeartbeat();
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    entries,
    claudeProxyEntries,
    mcpproxyEntries,
    dashboardEntries,
    status,
    error,
    clearEntries,
    clearContainerEntries,
  };
}
