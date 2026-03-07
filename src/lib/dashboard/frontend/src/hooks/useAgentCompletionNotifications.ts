/**
 * useAgentCompletionNotifications -- shows in-app toasts on agent completion
 *
 * Connects to the existing /ws/logs WebSocket, listens for `agent_completion`
 * messages, and shows toast notifications within the dashboard.
 *
 * @example
 * ```tsx
 * // In App component:
 * useAgentCompletionNotifications();
 * ```
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useToast } from "../contexts/ToastContext";
import type { AgentCompletionPayload, WSServerMessage } from "../types";

/** WebSocket URL for log streaming (same as useLogStream) */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

/** Format duration from ms to human-readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

/** Format token count to human-readable string */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function useAgentCompletionNotifications(): void {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    let disposed = false;
    let connectedAt = Date.now();

    function connect(): void {
      if (disposed) return;

      const ws = new WebSocket(WS_URL);

      ws.onopen = (): void => {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        // Record connection time -- ignore cached/historical completions
        // that arrive in the initial subscribe_all burst
        connectedAt = Date.now();
        // Subscribe to all sessions for agent completion events
        ws.send(JSON.stringify({ type: "subscribe_all" }));
        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event: MessageEvent): void => {
        try {
          const message = JSON.parse(event.data as string) as WSServerMessage;

          // Only handle agent_completion messages
          if (message.type !== "agent_completion") return;

          const payload = message.payload as AgentCompletionPayload | undefined;
          if (!payload) return;

          // Skip historical/cached completions replayed on subscribe_all.
          // Only notify for events that happened AFTER we connected.
          if (payload.timestamp) {
            const eventTime = new Date(payload.timestamp).getTime();
            if (eventTime < connectedAt) return;
          }

          const agentType = payload.agentType ?? "agent";
          const tokens = payload.totalTokens ? formatTokens(payload.totalTokens) : "?";
          const duration = payload.totalDurationMs ? formatDuration(payload.totalDurationMs) : "?";
          const project = payload.projectName ?? "";

          const body = `${agentType} finished in ${project} (${tokens} tokens, ${duration})`;

          addToastRef.current(body, "info", {
            category: "agent-completion",
            duration: 5000,
            onClick: project
              ? () => navigateRef.current(`/tmux?attach=${encodeURIComponent(project)}`)
              : undefined,
          });
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = (): void => {
        // Clear heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        if (disposed) return;

        // Reconnect with exponential backoff
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (): void => {
        // onclose will handle reconnection
      };

      wsRef.current = ws;
    }

    // Defer connection to avoid React strict mode double-connect
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
}
