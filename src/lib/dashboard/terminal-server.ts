/**
 * Terminal WebSocket Server - PTY to WebSocket Bridge
 *
 * Provides browser-based terminal access by bridging WebSocket connections to
 * PTY sessions. Supports two modes:
 *
 *   - **Attach mode**: Connects to an existing tmux session via `tmux attach-session`
 *   - **Command mode**: Spawns a whitelisted command (e.g. tmux-manager TUI) as a PTY process
 *
 * Uses a ttyd-style single-byte prefix protocol for minimal overhead:
 *
 *   0x00 = Terminal data (stdin from client, stdout from server)
 *   0x01 = Control JSON (resize, attach, command, exit, session-info)
 *   0x02 = Error JSON
 *
 * Features:
 * - Backpressure handling via pty.pause()/resume() with HIGH/LOW water marks
 * - Per-IP and total session limits to prevent resource exhaustion
 * - Graceful cleanup on disconnect, PTY exit, and server shutdown
 * - Dynamic node-pty import (native module only available in Docker)
 * - Command whitelist for secure spawning of TUI applications
 *
 * Architecture:
 *   Browser (xterm.js) <--WS (ttyd protocol)--> TerminalSessionManager (node-pty) <--PTY--> tmux attach | whitelisted command
 *
 * @module terminal-server
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer as WsServer } from "ws";

// ============================================================================
// node-pty Types (native module, only available in Docker container)
// Defined inline to avoid requiring @types/node-pty as a dev dependency.
// ============================================================================

/** Pseudoterminal process interface (subset of node-pty's IPty) */
interface IPty {
  /** Subscribe to data output from the PTY */
  onData(callback: (data: string) => void): { dispose(): void };
  /** Subscribe to PTY process exit */
  onExit(callback: (e: { exitCode: number; signal: number }) => void): { dispose(): void };
  /** Write data to the PTY stdin */
  write(data: string): void;
  /** Resize the PTY */
  resize(cols: number, rows: number): void;
  /** Pause the PTY output (flow control) */
  pause(): void;
  /** Resume the PTY output (flow control) */
  resume(): void;
  /** Kill the PTY child process */
  kill(signal?: string): void;
  /** PID of the child process */
  pid: number;
  /** Current column count */
  cols: number;
  /** Current row count */
  rows: number;
}

/** node-pty module interface for dynamic import */
interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}

// ============================================================================
// WebSocket Type Interfaces (matches ws library, same pattern as websocket-server.ts)
// ============================================================================

/** WebSocket connection interface (minimal, matches ws library) */
interface WS extends EventEmitter {
  readyState: number;
  bufferedAmount: number;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  removeAllListeners(event?: string): this;
  on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[]) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

/** WebSocket Server interface */
interface WSServer extends EventEmitter {
  clients: Set<WS>;
  close(callback?: (error?: Error) => void): void;
  on(event: "connection", listener: (ws: WS, request: IncomingMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WS) => void
  ): void;
}

// ============================================================================
// Constants
// ============================================================================

/** WebSocket.OPEN readyState constant */
const WS_OPEN = 1;
/** WebSocket.CONNECTING readyState constant */
const WS_CONNECTING = 0;

/** Protocol prefix bytes (ttyd-style) */
const PREFIX = {
  /** Terminal data (input from client, output from server) */
  DATA: "\u0000",
  /** Control JSON message (resize, exit, session info) */
  CONTROL: "\u0001",
  /** Error JSON message */
  ERROR: "\u0002",
} as const;

/** Backpressure water marks */
const BACKPRESSURE = {
  /** Pause PTY when WS bufferedAmount exceeds this (128 KB) */
  HIGH_WATER_MARK: 128 * 1024,
  /** Resume PTY when WS bufferedAmount drops below this (64 KB) */
  LOW_WATER_MARK: 64 * 1024,
  /** Drain check interval in milliseconds */
  DRAIN_CHECK_INTERVAL_MS: 50,
} as const;

/** Default session limits */
const SESSION_LIMITS = {
  MAX_TOTAL: 10,
  MAX_PER_IP: 3,
} as const;

/** Valid session name pattern: word characters, dots, hyphens */
const SESSION_NAME_REGEX = /^[\w.-]+$/;

/** Maximum session name length */
const MAX_SESSION_NAME_LENGTH = 128;

/**
 * Whitelist of commands that can be spawned via the "command" control message.
 * Maps friendly command names to their executable and arguments.
 *
 * Security: Only commands in this map can be spawned. Unknown command names
 * are rejected with an error and the WebSocket is closed with code 1008.
 */
const COMMAND_WHITELIST: ReadonlyMap<string, { bin: string; args: string[] }> = new Map([
  [
    "tmux-tui",
    {
      // tmux-manager is installed as a file: dependency and volume-mounted
      // into the Docker container at /app/node_modules/tmux-manager
      bin: "node",
      args: ["/app/node_modules/tmux-manager/dist/index.js"],
    },
  ],
]);

// ============================================================================
// Types
// ============================================================================

/** Tracked terminal session */
interface TerminalSession {
  id: string;
  pty: IPty;
  ws: WS;
  clientIp: string;
  sessionName: string;
  /** Whether session was created via "attach" (tmux) or "command" (whitelisted cmd) */
  mode: "attach" | "command";
  cols: number;
  rows: number;
  createdAt: number;
  paused: boolean;
  drainCheckInterval: ReturnType<typeof setInterval> | undefined;
  ptyDataDisposable: { dispose(): void } | undefined;
  ptyExitDisposable: { dispose(): void } | undefined;
}

/** Terminal server configuration */
export interface TerminalServerConfig {
  /** Maximum total concurrent sessions (default: env TERMINAL_MAX_SESSIONS or 10) */
  maxSessions?: number;
  /** Maximum sessions per IP address (default: env TERMINAL_MAX_SESSIONS_PER_IP or 3) */
  maxSessionsPerIp?: number;
  /** Path to tmux socket (default: env TMUX_SOCKET) */
  tmuxSocketPath?: string;
}

/** Control message from client */
interface ClientControlMessage {
  type: string;
  sessionName?: string;
  /** Command name for "command" mode (must be in COMMAND_WHITELIST) */
  command?: string;
  /** Session name to auto-attach after TUI startup */
  attachSession?: string;
  cols?: number;
  rows?: number;
}

/** Options for creating a new terminal session (discriminated union by mode) */
type CreateSessionOpts =
  | {
      mode: "attach";
      sessionName: string;
      cols: number;
      rows: number;
    }
  | {
      mode: "command";
      command: string;
      commandDef: { bin: string; args: string[] };
      /** Extra CLI arguments appended after the command definition args */
      extraArgs?: string[];
      cols: number;
      rows: number;
    };

// ============================================================================
// Lazy node-pty loader
// ============================================================================

/** Cached node-pty module reference */
let cachedNodePty: NodePtyModule | undefined;

/**
 * Dynamically import node-pty. The module is a native C++ addon that is only
 * available inside the Docker container (installed by task-1225). Using dynamic
 * import avoids build failures on dev machines that don't have it installed.
 *
 * The module is cached after the first successful import.
 */
async function loadNodePty(): Promise<NodePtyModule> {
  if (cachedNodePty) {
    return cachedNodePty;
  }
  try {
    cachedNodePty = (await import("node-pty")) as unknown as NodePtyModule;
    return cachedNodePty;
  } catch (error) {
    throw new Error(
      `node-pty is not available. This module requires the native node-pty package ` +
      `which is only installed in the Docker container. Error: ${(error as Error).message}`
    );
  }
}

// ============================================================================
// TerminalSessionManager
// ============================================================================

/**
 * Manages PTY terminal sessions bridged to WebSocket connections.
 *
 * Supports two modes:
 *   - **Attach mode**: Spawns `tmux attach-session -t <name>` to connect to an existing tmux session
 *   - **Command mode**: Spawns a whitelisted command (e.g. tmux-manager TUI) as a standalone PTY process
 *
 * Both modes pipe I/O to/from the WebSocket using the ttyd single-byte prefix protocol.
 *
 * Lifecycle:
 *   1. Client connects to /ws/terminal
 *   2. Client sends control message:
 *      - Attach: `{ type: "attach", sessionName: "main", cols: 80, rows: 24 }`
 *      - Command: `{ type: "command", command: "tmux-tui", cols: 80, rows: 24 }`
 *   3. Server spawns PTY (tmux attach or whitelisted command)
 *   4. Bidirectional data flow with backpressure
 *   5. Session destroyed on WS close, PTY exit, or server shutdown
 */
export class TerminalSessionManager {
  /** Active sessions indexed by session ID */
  private readonly sessions: Map<string, TerminalSession> = new Map();
  /** Session IDs grouped by client IP */
  private readonly sessionsByIp: Map<string, Set<string>> = new Map();
  /** Maximum total concurrent sessions */
  private readonly maxSessions: number;
  /** Maximum sessions per IP address */
  private readonly maxSessionsPerIp: number;
  /** Path to tmux socket (undefined = use tmux default) */
  private readonly tmuxSocketPath: string | undefined;
  /** Whether the server is shutting down (reject new connections) */
  private isShuttingDown = false;

  constructor(config: TerminalServerConfig = {}) {
    this.maxSessions = config.maxSessions
      ?? (Number.parseInt(process.env.TERMINAL_MAX_SESSIONS ?? "", 10) || SESSION_LIMITS.MAX_TOTAL);
    this.maxSessionsPerIp = config.maxSessionsPerIp
      ?? (Number.parseInt(process.env.TERMINAL_MAX_SESSIONS_PER_IP ?? "", 10) || SESSION_LIMITS.MAX_PER_IP);
    this.tmuxSocketPath = config.tmuxSocketPath
      ?? process.env.TMUX_SOCKET
      ?? undefined;

    console.log(
      `[terminal-server] Initialized (max=${String(this.maxSessions)}, ` +
      `maxPerIp=${String(this.maxSessionsPerIp)}, ` +
      `socket=${this.tmuxSocketPath ?? "default"})`
    );
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Handle a new WebSocket connection.
   *
   * Waits for the client to send an initial control message before spawning
   * the PTY. Supports two message types:
   *   - `{ type: "attach", sessionName: "...", cols, rows }` - Attach to a tmux session
   *   - `{ type: "command", command: "tmux-tui", cols, rows }` - Spawn a whitelisted command
   *
   * Validates session limits, name format, and command whitelist before proceeding.
   *
   * @param ws - WebSocket connection
   * @param req - HTTP upgrade request
   */
  handleConnection(ws: WS, req: IncomingMessage): void {
    if (this.isShuttingDown) {
      this.sendError(ws, "Server is shutting down");
      ws.close(1001, "Server shutting down");
      return;
    }

    const ip = this.extractIp(req);

    // Check session limits before proceeding
    if (!this.checkSessionLimits(ws, ip)) {
      return;
    }

    // Set up initial message handler: wait for "attach" or "command" control message
    const onInitialMessage = (data: Buffer | ArrayBuffer | Buffer[]): void => {
      const raw = this.toBuffer(data);
      if (raw.length === 0) return;

      const prefix = raw[0];

      // First message must be a control message to attach or spawn a command
      if (prefix === 0x01) {
        try {
          const control = JSON.parse(raw.subarray(1).toString("utf8")) as ClientControlMessage;

          if (control.type === "attach" && control.sessionName) {
            // Validate session name
            if (!this.validateSessionName(control.sessionName)) {
              this.sendError(
                ws,
                `Invalid session name: "${control.sessionName}". Must match /^[\\w.-]+$/ and be <= ${String(MAX_SESSION_NAME_LENGTH)} chars`
              );
              ws.close(1008, "Invalid session name");
              return;
            }

            // Remove initial handler before creating session
            ws.removeAllListeners("message");
            ws.removeAllListeners("close");
            ws.removeAllListeners("error");

            // Create the session in attach mode
            void this.createSession(ws, ip, {
              mode: "attach",
              sessionName: control.sessionName,
              cols: control.cols ?? 80,
              rows: control.rows ?? 24,
            });
            return;
          }

          if (control.type === "command" && control.command) {
            // Validate command against whitelist
            const commandDef = COMMAND_WHITELIST.get(control.command);
            if (!commandDef) {
              this.sendError(
                ws,
                `Unknown command: "${control.command}". Available: ${[...COMMAND_WHITELIST.keys()].join(", ")}`
              );
              ws.close(1008, "Unknown command");
              return;
            }

            // Remove initial handler before creating session
            ws.removeAllListeners("message");
            ws.removeAllListeners("close");
            ws.removeAllListeners("error");

            // Build extra CLI args (e.g., --attach <sessionName>)
            const extraArgs: string[] = [];
            if (control.attachSession) {
              extraArgs.push("--attach", control.attachSession);
            }

            // Create the session in command mode
            void this.createSession(ws, ip, {
              mode: "command",
              command: control.command,
              commandDef,
              extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
              cols: control.cols ?? 80,
              rows: control.rows ?? 24,
            });
            return;
          }
        } catch {
          this.sendError(ws, "Invalid control message JSON");
          ws.close(1008, "Invalid initial message");
          return;
        }
      }

      this.sendError(ws, "First message must be a control message with type 'attach' or 'command'");
      ws.close(1008, "Invalid initial message");
    };

    ws.on("message", onInitialMessage);

    // Handle early close (before session was created)
    ws.on("close", () => {
      console.log(`[terminal-server] Connection from ${ip} closed before session attach`);
    });

    ws.on("error", (error: Error) => {
      console.error(`[terminal-server] Connection error from ${ip}:`, error.message);
    });
  }

  /**
   * Destroy all active sessions. Called during graceful server shutdown.
   */
  destroyAllSessions(): void {
    this.isShuttingDown = true;

    const sessionIds = [...this.sessions.keys()];
    for (const sessionId of sessionIds) {
      this.destroySession(sessionId);
    }

    // Clear all tracking maps (defensive, destroySession should have cleaned up)
    this.sessions.clear();
    this.sessionsByIp.clear();

    console.log(`[terminal-server] All ${String(sessionIds.length)} sessions destroyed`);
  }

  /**
   * Get the number of active sessions.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  // --------------------------------------------------------------------------
  // Session Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Create a new terminal session: spawn PTY, wire I/O, track in maps.
   *
   * Accepts a discriminated union of options to support both attach mode
   * (tmux attach-session) and command mode (whitelisted command spawning).
   */
  private async createSession(
    ws: WS,
    clientIp: string,
    opts: CreateSessionOpts
  ): Promise<void> {
    const sessionId = `term-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

    // Derive display name for logging
    const displayName = opts.mode === "attach"
      ? opts.sessionName
      : `cmd:${opts.command}`;

    // Spawn PTY process (async due to dynamic node-pty import)
    let ptyProcess: IPty;
    try {
      ptyProcess = opts.mode === "attach"
        ? await this.spawnPty(opts.sessionName, opts.cols, opts.rows)
        : await this.spawnCommandPty(opts.commandDef, opts.cols, opts.rows, opts.extraArgs);
    } catch (error) {
      this.sendError(ws, `Failed to spawn PTY: ${(error as Error).message}`);
      ws.close(1011, "PTY spawn failed");
      return;
    }

    // Create session record
    const session: TerminalSession = {
      id: sessionId,
      pty: ptyProcess,
      ws,
      clientIp,
      sessionName: displayName,
      mode: opts.mode,
      cols: opts.cols,
      rows: opts.rows,
      createdAt: Date.now(),
      paused: false,
      drainCheckInterval: undefined,
      ptyDataDisposable: undefined,
      ptyExitDisposable: undefined,
    };

    // Track session
    this.sessions.set(sessionId, session);
    if (!this.sessionsByIp.has(clientIp)) {
      this.sessionsByIp.set(clientIp, new Set());
    }
    this.sessionsByIp.get(clientIp)!.add(sessionId);

    // Wire PTY output to WebSocket with backpressure
    this.wirePtyToWs(session);

    // Set up session message handler (replaces initial handler)
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      this.handleMessage(session, data);
    });

    // Handle WebSocket close
    ws.on("close", () => {
      console.log(`[terminal-server] WebSocket closed for session ${sessionId}`);
      this.destroySession(sessionId);
    });

    // Handle WebSocket errors
    ws.on("error", (error: Error) => {
      console.error(`[terminal-server] WebSocket error for session ${sessionId}:`, error.message);
      this.destroySession(sessionId);
    });

    // Send session info to client
    this.sendControl(ws, {
      type: "session-info",
      sessionId,
      sessionName: displayName,
      mode: opts.mode,
      cols: opts.cols,
      rows: opts.rows,
    });

    console.log(
      `[terminal-server] Session ${sessionId} created ` +
      `(name=${displayName}, mode=${opts.mode}, ip=${clientIp}, total=${String(this.sessions.size)})`
    );
  }

  /**
   * Destroy a session: stop intervals, dispose listeners, kill PTY, close WS, update tracking.
   */
  private destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 1. Stop drain check interval
    if (session.drainCheckInterval !== undefined) {
      clearInterval(session.drainCheckInterval);
      session.drainCheckInterval = undefined;
    }

    // 2. Remove PTY event listeners (prevent callbacks after cleanup)
    session.ptyDataDisposable?.dispose();
    session.ptyExitDisposable?.dispose();
    session.ptyDataDisposable = undefined;
    session.ptyExitDisposable = undefined;

    // 3. Kill PTY process
    // For tmux: equivalent to detach -- session survives
    // For raw shell: shell process terminates
    try {
      session.pty.kill();
    } catch {
      // PTY may already be dead (user typed `exit`)
    }

    // 4. Close WebSocket if still open
    if (session.ws.readyState === WS_OPEN || session.ws.readyState === WS_CONNECTING) {
      session.ws.close(1000, "Session ended");
    }

    // 5. Remove from session tracking map
    this.sessions.delete(sessionId);

    // 6. Decrement IP counter
    const ipSessions = this.sessionsByIp.get(session.clientIp);
    if (ipSessions) {
      ipSessions.delete(sessionId);
      if (ipSessions.size === 0) {
        this.sessionsByIp.delete(session.clientIp);
      }
    }

    console.log(
      `[terminal-server] Session ${sessionId} destroyed ` +
      `(remaining: ${String(this.sessions.size)}, session: ${session.sessionName})`
    );
  }

  // --------------------------------------------------------------------------
  // PTY Spawn & Wiring
  // --------------------------------------------------------------------------

  /**
   * Spawn a PTY process running `tmux attach-session -t <name>`.
   *
   * Uses dynamic import for node-pty since it's a native module only
   * available in the Docker container.
   *
   * Removes `TMUX` env var from child environment to prevent nested tmux
   * detection warnings ("sessions should be nested with care").
   */
  private async spawnPty(sessionName: string, cols: number, rows: number): Promise<IPty> {
    const pty = await loadNodePty();

    const socketPath = this.tmuxSocketPath;
    const args = socketPath
      ? ["-S", socketPath, "attach-session", "-t", sessionName]
      : ["attach-session", "-t", sessionName];

    // Build environment: inherit process.env but remove TMUX to prevent
    // nested tmux detection warnings ("sessions should be nested with care")
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== "TMUX" && value !== undefined) {
        env[key] = value;
      }
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.LANG = env.LANG ?? "en_US.UTF-8";

    return pty.spawn("tmux", args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? "/app",
      env,
    });
  }

  /**
   * Spawn a PTY process running a whitelisted command.
   *
   * Uses dynamic import for node-pty since it's a native module only
   * available in the Docker container.
   *
   * Passes through all relevant environment variables including TMUX_SOCKET
   * for tmux-manager to discover and connect to host tmux sessions.
   */
  private async spawnCommandPty(
    commandDef: { bin: string; args: string[] },
    cols: number,
    rows: number,
    extraArgs?: string[]
  ): Promise<IPty> {
    const pty = await loadNodePty();

    // Build environment: inherit process.env but remove TMUX to prevent
    // nested tmux detection warnings. Pass TMUX_SOCKET explicitly so the
    // TUI can discover the host's tmux socket.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== "TMUX" && value !== undefined) {
        env[key] = value;
      }
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.LANG = env.LANG ?? "en_US.UTF-8";

    // Ensure TMUX_SOCKET is set (tmux-manager reads this to find the socket)
    if (this.tmuxSocketPath) {
      env.TMUX_SOCKET = this.tmuxSocketPath;
    }

    const args = extraArgs ? [...commandDef.args, ...extraArgs] : commandDef.args;

    return pty.spawn(commandDef.bin, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? "/app",
      env,
    });
  }

  /**
   * Wire PTY output to WebSocket with backpressure handling.
   *
   * Data flow: PTY stdout -> 0x00 prefix -> WebSocket send
   *
   * Backpressure: When ws.bufferedAmount exceeds HIGH_WATER_MARK (128KB),
   * the PTY is paused. A periodic drain check resumes it when the buffer
   * drops below LOW_WATER_MARK (64KB). The hysteresis gap prevents rapid
   * pause/resume oscillation.
   *
   * PTY exit: Sends an exit control message (0x01) to the client before
   * destroying the session.
   */
  private wirePtyToWs(session: TerminalSession): void {
    const { pty: ptyProcess, ws, id } = session;

    // PTY -> WebSocket: forward terminal output with backpressure
    session.ptyDataDisposable = ptyProcess.onData((data: string) => {
      if (ws.readyState !== WS_OPEN) return;

      // Send data with prefix
      this.sendData(ws, data);

      // Check backpressure: pause PTY if WebSocket buffer is filling up
      if (!session.paused && ws.bufferedAmount > BACKPRESSURE.HIGH_WATER_MARK) {
        session.paused = true;
        ptyProcess.pause();
        console.log(
          `[terminal-server] Session ${id}: PTY paused (buffered: ${String(ws.bufferedAmount)} bytes)`
        );
      }
    });

    // Periodic drain check: resume PTY when buffer drops below low water mark
    // ws library does not emit a 'drain' event, so we poll bufferedAmount.
    session.drainCheckInterval = setInterval(() => {
      if (session.paused && ws.bufferedAmount < BACKPRESSURE.LOW_WATER_MARK) {
        session.paused = false;
        ptyProcess.resume();
        console.log(
          `[terminal-server] Session ${id}: PTY resumed (buffered: ${String(ws.bufferedAmount)} bytes)`
        );
      }
    }, BACKPRESSURE.DRAIN_CHECK_INTERVAL_MS);

    // PTY exit: notify client and clean up
    session.ptyExitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(
        `[terminal-server] Session ${id}: PTY exited (code=${String(exitCode)}, signal=${String(signal)})`
      );

      // Send exit notification before closing WebSocket (AC #14)
      this.sendControl(ws, {
        type: "exit",
        exitCode,
        signal,
      });

      // Destroy session (full cleanup)
      this.destroySession(id);
    });
  }

  // --------------------------------------------------------------------------
  // Message Handling (Client -> Server)
  // --------------------------------------------------------------------------

  /**
   * Handle an incoming WebSocket message from the client.
   *
   * Protocol:
   *   0x00 + data  = Terminal input (keystrokes) -> write to PTY
   *   0x01 + JSON  = Control message (resize) -> resize PTY
   */
  private handleMessage(session: TerminalSession, data: Buffer | ArrayBuffer | Buffer[]): void {
    const raw = this.toBuffer(data);
    if (raw.length === 0) return;

    const prefix = raw[0];
    const payload = raw.subarray(1);

    switch (prefix) {
    case 0x00: {
      // Terminal input data - write directly to PTY
      session.pty.write(payload.toString("utf8"));
      break;
    }
    case 0x01: {
      // Control message - parse JSON
      try {
        const control = JSON.parse(payload.toString("utf8")) as ClientControlMessage;
        if (control.type === "resize" && control.cols && control.rows) {
          session.pty.resize(control.cols, control.rows);
          session.cols = control.cols;
          session.rows = control.rows;
        }
      } catch {
        this.sendError(session.ws, "Invalid control message JSON");
      }
      break;
    }
    default: {
      this.sendError(session.ws, `Unknown message prefix: 0x${prefix.toString(16)}`);
    }
    }
  }

  // --------------------------------------------------------------------------
  // Message Sending (Server -> Client)
  // --------------------------------------------------------------------------

  /** Send terminal data with 0x00 prefix */
  private sendData(ws: WS, data: string): void {
    if (ws.readyState !== WS_OPEN) return;
    ws.send(PREFIX.DATA + data, (err) => {
      if (err) {
        console.error("[terminal-server] Send error:", err.message);
      }
    });
  }

  /** Send control JSON with 0x01 prefix */
  private sendControl(ws: WS, control: Record<string, unknown>): void {
    if (ws.readyState !== WS_OPEN) return;
    ws.send(PREFIX.CONTROL + JSON.stringify(control), (err) => {
      if (err) {
        console.error("[terminal-server] Control send error:", err.message);
      }
    });
  }

  /** Send error JSON with 0x02 prefix */
  private sendError(ws: WS, message: string): void {
    if (ws.readyState !== WS_OPEN) return;
    ws.send(PREFIX.ERROR + JSON.stringify({ message }), (err) => {
      if (err) {
        console.error("[terminal-server] Error send error:", err.message);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Validation & Utilities
  // --------------------------------------------------------------------------

  /**
   * Validate a tmux session name.
   * Must match /^[\w.-]+$/ and be non-empty, max 128 chars.
   */
  private validateSessionName(name: string): boolean {
    return name.length > 0 && name.length <= MAX_SESSION_NAME_LENGTH && SESSION_NAME_REGEX.test(name);
  }

  /**
   * Check if session limits allow a new connection.
   * Sends error and closes WS if limits exceeded.
   *
   * @returns true if within limits, false if connection was rejected
   */
  private checkSessionLimits(ws: WS, ip: string): boolean {
    // Check total session limit
    if (this.sessions.size >= this.maxSessions) {
      this.sendError(ws, `Maximum total sessions exceeded (${String(this.maxSessions)})`);
      ws.close(1008, "Session limit exceeded");
      return false;
    }

    // Check per-IP session limit
    const ipSessions = this.sessionsByIp.get(ip)?.size ?? 0;
    if (ipSessions >= this.maxSessionsPerIp) {
      this.sendError(ws, `Maximum sessions per IP exceeded (${String(this.maxSessionsPerIp)})`);
      ws.close(1008, "Per-IP session limit exceeded");
      return false;
    }

    return true;
  }

  /**
   * Extract the client IP address from the upgrade request.
   * Respects X-Forwarded-For header for reverse proxy setups.
   */
  private extractIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  /**
   * Convert WebSocket message data to a Buffer.
   * The ws library may deliver data as Buffer, ArrayBuffer, or Buffer[].
   */
  private toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data);
    }
    return Buffer.from(data);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a terminal WebSocket server for PTY session management.
 *
 * Returns the terminal manager and a handleUpgrade callback for the
 * centralized WebSocket upgrade dispatcher in server.ts.
 *
 * @param config - Terminal server configuration
 * @returns Object with terminalManager and handleUpgrade callback
 *
 * @example
 * ```typescript
 * const { terminalManager, handleUpgrade } = createTerminalWebSocketServer({
 *   tmuxSocketPath: process.env.TMUX_SOCKET,
 * });
 *
 * // In centralized upgrade dispatcher:
 * server.on("upgrade", (request, socket, head) => {
 *   if (pathname === "/ws/terminal") {
 *     handleUpgrade(request, socket, head);
 *   }
 * });
 *
 * // Graceful shutdown:
 * await terminalManager.destroyAllSessions();
 * ```
 */
export function createTerminalWebSocketServer(
  config: TerminalServerConfig = {}
): {
  terminalManager: TerminalSessionManager;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
   
  const wss = new WsServer({ noServer: true }) as unknown as WSServer;
  const terminalManager = new TerminalSessionManager(config);

  // Wire WSS connection events to terminal manager
  wss.on("connection", (ws: WS, req: IncomingMessage) => {
    terminalManager.handleConnection(ws, req);
  });

  wss.on("error", (error: Error) => {
    console.error("[terminal-server] WebSocket server error:", error);
  });

  return {
    terminalManager,
    handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      wss.handleUpgrade(request, socket, head, (ws: WS) => {
        wss.emit("connection", ws, request);
      });
    },
  };
}
