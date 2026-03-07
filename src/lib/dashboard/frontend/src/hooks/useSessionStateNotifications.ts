/**
 * useSessionStateNotifications Hook
 *
 * Listens for session state changes and triggers appropriate notifications:
 * - waiting_permission -> amber "attention" toast + audio beep
 * - idle (from working) -> info toast "Claude finished"
 * - Auto-dismisses permission toasts when state changes away from waiting_permission
 *
 * @module hooks/useSessionStateNotifications
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import type { SessionStateChangePayload, WSServerMessage } from "../types/websocket";

/** WebSocket URL for log streaming */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30_000;

/** Reconnection delay range */
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30_000;

/** Play an audio beep using Web Audio API */
function playBeep(): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 880;
    gain.gain.value = 0.3;
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
    // Clean up after beep finishes
    oscillator.onended = (): void => {
      void ctx.close();
    };
  } catch {
    // Audio not available, skip silently
  }
}


export function useSessionStateNotifications(): void {
  const { addToast, removeCategory } = useToast();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // Track previous states to detect transitions
  const prevStatesRef = useRef<Map<string, string>>(new Map());

  // Stable refs for toast functions and navigation
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const removeCategoryRef = useRef(removeCategory);
  removeCategoryRef.current = removeCategory;
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
        connectedAt = Date.now();
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

          // Skip events from before we connected
          if (payload.timestamp) {
            const eventTime = new Date(payload.timestamp).getTime();
            if (eventTime < connectedAt) return;
          }

          const prevState = prevStatesRef.current.get(payload.sessionName);
          prevStatesRef.current.set(payload.sessionName, payload.state);

          const currentState = payload.state;

          if (currentState === "error") {
            const errorInfo = payload.errorMessage ? `: ${payload.errorMessage}` : "";
            addToastRef.current(
              `Error in ${payload.sessionName}${errorInfo}`,
              "error",
              {
                persistent: true,
                category: "session_error",
                onClick: () => navigateRef.current(`/tmux?attach=${encodeURIComponent(payload.sessionName)}`),
              },
            );
            playBeep();
          } else if (currentState === "waiting_permission") {
            const toolInfo = payload.toolName ? ` (${payload.toolName})` : "";
            addToastRef.current(
              `Permission needed in ${payload.sessionName}${toolInfo}`,
              "attention",
              {
                persistent: true,
                category: "permission",
                onClick: () => navigateRef.current(`/tmux?attach=${encodeURIComponent(payload.sessionName)}`),
              },
            );
            playBeep();
          } else if (currentState === "idle" && prevState === "working") {
            // Auto-dismiss permission toast if it was showing
            removeCategoryRef.current("permission");
            addToastRef.current(
              `Claude finished in ${payload.sessionName}`,
              "info",
              {
                category: "completion",
                duration: 5000,
                onClick: () => navigateRef.current(`/tmux?attach=${encodeURIComponent(payload.sessionName)}`),
              },
            );
          }

          // Dismiss permission toast when state moves away from waiting_permission
          if (currentState !== "waiting_permission" && prevState === "waiting_permission") {
            removeCategoryRef.current("permission");
          }

          // Dismiss error toast when state moves away from error
          if (currentState !== "error" && prevState === "error") {
            removeCategoryRef.current("session_error");
          }
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
}
