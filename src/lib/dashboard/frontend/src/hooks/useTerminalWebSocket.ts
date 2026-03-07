/**
 * useTerminalWebSocket -- reconnecting WebSocket for terminal I/O
 *
 * Uses ttyd-style single-byte prefix protocol (binary):
 *   Client -> Server: 0x00 + data (input), 0x01 + JSON (control)
 *   Server -> Client: 0x00 + data (output), 0x01 + JSON (control)
 *
 * On connect, sends an initial control message (connectMessage) to tell the
 * server whether to "attach" to a tmux session or spawn a "command" (TUI).
 * Then sends a resize control message with the terminal dimensions.
 *
 * Exposes connection status as discriminated union for overlay rendering.
 *
 * @example
 * // Attach to tmux session:
 * const { status } = useTerminalWebSocket({
 *   wsPath: "/ws/terminal",
 *   connectMessage: { type: "attach", sessionName: "my-session" },
 *   terminal: terminalRef.current,
 *   enabled: ready,
 * });
 *
 * // Spawn TUI command:
 * const { status } = useTerminalWebSocket({
 *   wsPath: "/ws/terminal",
 *   connectMessage: { type: "command", command: "tmux-tui" },
 *   terminal: terminalRef.current,
 *   enabled: ready,
 * });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";

/** Binary prefix bytes matching terminal-server.ts protocol */
const PREFIX_DATA = 0x00;
const PREFIX_CONTROL = 0x01;

/** Initial reconnection delay (1 second) */
const INITIAL_RECONNECT_DELAY = 1000;

/** Maximum reconnection delay (30 seconds) */
const MAX_RECONNECT_DELAY = 30_000;

/** Maximum reconnection attempts before giving up */
const MAX_RECONNECT_ATTEMPTS = 20;

/** Connection status discriminated union */
export type ConnectionStatus =
  | { state: "connected" }
  | { state: "disconnected"; reason?: string }
  | { state: "reconnecting"; attempt: number; maxAttempts: number };

/** Server-sent control message */
export interface TerminalControlMessage {
  type: "exit" | "error" | "title" | "session-info";
  code?: number;
  message?: string;
  title?: string;
  sessionId?: string;
  sessionName?: string;
  mode?: string;
}

export interface UseTerminalWebSocketOptions {
  /** WebSocket path (e.g., "/ws/terminal"). Required. */
  wsPath?: string;
  /** Legacy: tmux session ID used to build URL if wsPath is not provided */
  sessionId?: string;
  /** Control message sent on connect as the first message.
   *  For attach mode: { type: "attach", sessionName: "..." }
   *  For command mode: { type: "command", command: "tmux-tui" }
   */
  connectMessage?: Record<string, unknown>;
  /** Terminal instance (null before ready) */
  terminal: Terminal | null;
  /** Whether the terminal is ready for I/O */
  enabled: boolean;
  /** Called when server sends a control message */
  onControlMessage?: (message: TerminalControlMessage) => void;
}

export interface UseTerminalWebSocketResult {
  /** Current connection status */
  status: ConnectionStatus;
  /** Manually trigger reconnection */
  reconnect: () => void;
  /** Send terminal input data */
  sendData: (data: string) => void;
  /** Send resize control message */
  sendResize: (cols: number, rows: number) => void;
}

/** Encode a string payload with a binary prefix byte into a Uint8Array */
function encodeMessage(prefix: number, payload: string): Uint8Array {
  const encoded = new TextEncoder().encode(payload);
  const buffer = new Uint8Array(1 + encoded.length);
  buffer[0] = prefix;
  buffer.set(encoded, 1);
  return buffer;
}

export function useTerminalWebSocket(
  options: UseTerminalWebSocketOptions
): UseTerminalWebSocketResult {
  const { sessionId, wsPath, connectMessage, terminal, enabled, onControlMessage } = options;

  const [status, setStatus] = useState<ConnectionStatus>({
    state: "disconnected",
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const isConnectingRef = useRef(false);
  const onControlMessageRef = useRef(onControlMessage);
  onControlMessageRef.current = onControlMessage;
  const connectMessageRef = useRef(connectMessage);
  connectMessageRef.current = connectMessage;

  /** Build WebSocket URL for terminal endpoint */
  const buildWsUrl = useCallback((): string => {
    const protocol =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    if (wsPath !== undefined) {
      return `${protocol}//${window.location.host}${wsPath}`;
    }
    return `${protocol}//${window.location.host}/ws/terminal?sessionId=${encodeURIComponent(sessionId ?? "")}`;
  }, [sessionId, wsPath]);

  /** Send raw terminal input data with 0x00 prefix */
  const sendData = useCallback((data: string): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(encodeMessage(PREFIX_DATA, data));
    }
  }, []);

  /** Send resize control message with 0x01 prefix */
  const sendResize = useCallback((cols: number, rows: number): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        encodeMessage(PREFIX_CONTROL, JSON.stringify({ type: "resize", cols, rows }))
      );
    }
  }, []);

  /** Connect to WebSocket */
  const connect = useCallback((): void => {
    if (isConnectingRef.current || !terminal || !enabled) return;
    isConnectingRef.current = true;

    // Clean up existing connection
    if (wsRef.current !== null) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(buildWsUrl());
    ws.binaryType = "arraybuffer";

    ws.onopen = (): void => {
      isConnectingRef.current = false;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      reconnectAttemptRef.current = 0;

      // Send initial control message (attach or command) -- server expects this first.
      // Include cols/rows so the PTY is spawned at the correct size from the start.
      if (connectMessageRef.current) {
        ws.send(
          encodeMessage(PREFIX_CONTROL, JSON.stringify({
            ...connectMessageRef.current,
            cols: terminal.cols,
            rows: terminal.rows,
          }))
        );
      }

      setStatus({ state: "connected" });
    };

    ws.onmessage = (event: MessageEvent): void => {
      const data = event.data;

      // Server sends text frames with \u0000 (data) or \u0001 (control) prefix
      if (typeof data === "string") {
        if (data.length === 0) return;
        const prefix = data.charCodeAt(0);
        const payload = data.slice(1);

        if (prefix === PREFIX_DATA) {
          terminal.write(payload);
        } else if (prefix === PREFIX_CONTROL) {
          try {
            const message = JSON.parse(payload) as TerminalControlMessage;
            onControlMessageRef.current?.(message);
          } catch {
            console.warn("[useTerminalWebSocket] Invalid control message:", payload);
          }
        }
        return;
      }

      // Handle binary frames (ArrayBuffer) if server ever sends them
      if (data instanceof ArrayBuffer) {
        const raw = new Uint8Array(data);
        if (raw.length === 0) return;
        const prefix = raw[0];
        const payload = new TextDecoder().decode(raw.subarray(1));

        if (prefix === PREFIX_DATA) {
          terminal.write(payload);
        } else if (prefix === PREFIX_CONTROL) {
          try {
            const message = JSON.parse(payload) as TerminalControlMessage;
            onControlMessageRef.current?.(message);
          } catch {
            console.warn("[useTerminalWebSocket] Invalid control message:", payload);
          }
        }
      }
    };

    ws.onclose = (): void => {
      isConnectingRef.current = false;
      wsRef.current = null;

      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setStatus({
          state: "disconnected",
          reason: `Failed after ${String(MAX_RECONNECT_ATTEMPTS)} reconnection attempts`,
        });
        return;
      }

      // Schedule reconnection with exponential backoff
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      setStatus({
        state: "reconnecting",
        attempt,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    };

    ws.onerror = (): void => {
      // onclose will fire after onerror, handling reconnection
    };

    wsRef.current = ws;
  }, [terminal, enabled, buildWsUrl, sendResize]);

  /** Manual reconnect -- resets attempt counter */
  const reconnect = useCallback((): void => {
    reconnectAttemptRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    connect();
  }, [connect]);

  // Connect/disconnect lifecycle (deferred for React strict mode)
  useEffect(() => {
    if (!terminal || !enabled) return;

    const timer = setTimeout(() => {
      connect();
    }, 0);

    return () => {
      clearTimeout(timer);
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus({ state: "disconnected" });
    };
  }, [terminal, enabled, connect]);

  // Wire terminal.onData -> WebSocket send
  useEffect(() => {
    if (!terminal || status.state !== "connected") return;

    const dataDisposable = terminal.onData((data) => {
      sendData(data);
    });

    const binaryDisposable = terminal.onBinary((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Binary events (mouse reports) -- encode as single-byte chars with 0x00 prefix
        const buffer = new Uint8Array(data.length + 1);
        buffer[0] = PREFIX_DATA;
        for (let index = 0; index < data.length; index++) {
          buffer[index + 1] = data.charCodeAt(index) & 255;
        }
        wsRef.current.send(buffer);
      }
    });

    return () => {
      dataDisposable.dispose();
      binaryDisposable.dispose();
    };
  }, [terminal, status.state, sendData]);

  // Wire terminal.onResize -> WebSocket resize message
  useEffect(() => {
    if (!terminal || status.state !== "connected") return;

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    return () => {
      resizeDisposable.dispose();
    };
  }, [terminal, status.state, sendResize]);

  return { status, reconnect, sendData, sendResize };
}
