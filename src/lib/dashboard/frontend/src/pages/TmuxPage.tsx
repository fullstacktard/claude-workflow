/**
 * TmuxPage -- Full-viewport xterm.js terminal running the tmux-manager TUI
 *
 * Connects to /ws/terminal?mode=command&cmd=tmux-tui on mount.
 * The blessed TUI renders inside xterm.js -- user interacts with it directly.
 * Navigating away disconnects the WebSocket; the server kills the PTY.
 * Re-visiting starts a fresh connection and fresh TUI instance.
 *
 * @example
 * ```tsx
 * // In main.tsx routes:
 * <Route element={<TmuxPage />} path="/tmux" />
 * ```
 */

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { WifiOff, RefreshCw } from "lucide-react";

import { useTerminal } from "../hooks/useTerminal";
import {
  useTerminalWebSocket,
  type ConnectionStatus,
  type TerminalControlMessage,
} from "../hooks/useTerminalWebSocket";

// ── Connection Overlay ────────────────────────────────────────────────

/**
 * Connection status overlay -- shown when disconnected or reconnecting.
 * Renders on top of the terminal container with a semi-transparent backdrop.
 */
function ConnectionOverlay({
  status,
  onReconnect,
}: {
  status: ConnectionStatus;
  onReconnect: () => void;
}): React.JSX.Element | null {
  if (status.state === "connected") return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80">
      <div className="flex flex-col items-center gap-3 text-sm">
        {status.state === "disconnected" && (
          <>
            <WifiOff className="h-6 w-6 text-red-400" />
            <span className="text-red-400">Disconnected</span>
            {status.reason !== undefined && (
              <span className="max-w-xs text-center text-xs text-gray-500">
                {status.reason}
              </span>
            )}
            <button
              type="button"
              onClick={onReconnect}
              className="mt-2 rounded border border-red-800 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-900/30"
            >
              Reconnect
            </button>
          </>
        )}
        {status.state === "reconnecting" && (
          <>
            <RefreshCw className="h-6 w-6 animate-spin text-amber-400" />
            <span className="text-amber-400">
              Reconnecting ({status.attempt}/{status.maxAttempts})
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── TmuxPage ──────────────────────────────────────────────────────────

/** WebSocket path for the terminal endpoint */
const WS_PATH = "/ws/terminal";

/** Detect mobile viewport for responsive terminal font sizing.
 *  Uses clientWidth which respects CSS viewport emulation (unlike window.innerWidth
 *  which may return the physical window size under CDP emulation). */
function isMobileViewport(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.clientWidth < 640;
}

export function TmuxPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const attachSession = searchParams.get("attach");

  // Build the connect message with optional attachSession field
  const connectMessage = useMemo(
    () => ({
      type: "command",
      command: "tmux-tui",
      ...(attachSession ? { attachSession } : {}),
    }),
    [attachSession],
  );

  const { containerRef, terminalRef, ready } = useTerminal({
    scrollback: 0,
    fontSize: isMobileViewport() ? 11 : 16,
  });

  const handleControlMessage = useCallback(
    (message: TerminalControlMessage): void => {
      if (message.type === "exit") {
        console.info("[TmuxPage] TUI process exited", message.code);
      }
    },
    [],
  );

  const { status, reconnect } = useTerminalWebSocket({
    wsPath: WS_PATH,
    connectMessage,
    terminal: terminalRef.current,
    enabled: ready,
    onControlMessage: handleControlMessage,
  });

  // Enable SGR mouse encoding after the blessed TUI connects.
  // blessed sends \x1b[?1006h during startup, but it can arrive before xterm.js
  // is fully ready, causing xterm.js to stay in legacy X10 mouse encoding.
  // Legacy reports go through onBinary (binary path) which works but is less
  // reliable. SGR reports go through onData (text path) and support unlimited
  // coordinates. Writing \x1b[?1006h client-side after connection ensures
  // xterm.js switches to SGR mode for all subsequent mouse reports.
  useEffect(() => {
    if (status.state !== "connected" || !terminalRef.current) return;
    const timer = setTimeout(() => {
      terminalRef.current?.write("\x1b[?1006h");
    }, 300);
    return () => { clearTimeout(timer); };
  }, [status.state, terminalRef]);

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Terminal fills entire remaining viewport height (below BottomBar from main.tsx layout) */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full w-full bg-gray-950" />
        <ConnectionOverlay status={status} onReconnect={reconnect} />
      </div>
    </div>
  );
}
