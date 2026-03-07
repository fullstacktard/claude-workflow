/**
 * TerminalView -- Interactive xterm.js terminal with WebSocket connection
 *
 * Composes useTerminal (lifecycle) and useTerminalWebSocket (I/O) hooks.
 * Renders a full-height terminal with connection status overlay.
 *
 * NOTE: This component is intentionally NOT exported from components/index.ts
 * to prevent xterm.js (~400KB) from being bundled into the main chunk.
 * Import directly: import { TerminalView } from './components/terminal/TerminalView';
 *
 * @example
 * <TerminalView sessionId="my-project:0" />
 */

import { useCallback } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

import { useTerminal } from "../../hooks/useTerminal";
import {
  useTerminalWebSocket,
  type ConnectionStatus,
  type TerminalControlMessage,
} from "../../hooks/useTerminalWebSocket";

export interface TerminalViewProps {
  /** tmux session ID to attach to */
  sessionId: string;
  /** Additional CSS classes for the outer container */
  className?: string;
  /** Called when the terminal session exits */
  onSessionExit?: (code: number) => void;
}

/**
 * Connection status overlay -- shown when disconnected or reconnecting.
 * Hidden when connected to avoid blocking terminal interaction.
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
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 pointer-events-auto">
      <div className="flex flex-col items-center gap-3 text-sm">
        {status.state === "disconnected" && (
          <>
            <WifiOff className="w-6 h-6 text-red-400" />
            <span className="text-red-400">Disconnected</span>
            {status.reason && (
              <span className="text-gray-500 text-xs max-w-xs text-center">
                {status.reason}
              </span>
            )}
            <button
              type="button"
              onClick={onReconnect}
              className="mt-2 px-3 py-1.5 text-xs rounded border border-red-800 text-red-300 hover:bg-red-900/30 transition-colors"
            >
              Reconnect
            </button>
          </>
        )}
        {status.state === "reconnecting" && (
          <>
            <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
            <span className="text-amber-400">
              Reconnecting ({status.attempt}/{status.maxAttempts})
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function TerminalView({
  sessionId,
  className = "",
  onSessionExit,
}: TerminalViewProps): React.JSX.Element {
  const { containerRef, terminalRef, ready } = useTerminal();

  const handleControlMessage = useCallback(
    (message: TerminalControlMessage): void => {
      if (message.type === "exit" && message.code !== undefined) {
        onSessionExit?.(message.code);
      }
    },
    [onSessionExit]
  );

  const { status, reconnect } = useTerminalWebSocket({
    wsPath: "/ws/terminal",
    connectMessage: { type: "attach", sessionName: sessionId },
    terminal: terminalRef.current,
    enabled: ready,
    onControlMessage: handleControlMessage,
  });

  return (
    <div className={`relative w-full h-full ${className}`.trim()}>
      {/* Terminal container -- must have explicit dimensions for FitAddon */}
      <div ref={containerRef} className="w-full h-full overflow-hidden" />

      {/* Connection status overlay */}
      <ConnectionOverlay status={status} onReconnect={reconnect} />

      {/* Connected indicator -- small dot in top-right corner */}
      {status.state === "connected" && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 pointer-events-none">
          <Wifi className="w-3 h-3 text-green-500 opacity-50" />
        </div>
      )}
    </div>
  );
}
