/**
 * SessionStateWatcher Service
 *
 * Watches ~/.claude-workflow/session-state/*.json for changes using chokidar.
 * Emits 'state_change' events when session state files are created, modified,
 * or deleted. These events are broadcast to WebSocket clients for real-time
 * session state updates in the React frontend.
 *
 * Uses polling mode (usePolling: true) for WSL2 compatibility and
 * awaitWriteFinish for atomic write safety (the hook writes .tmp + rename).
 */

import { EventEmitter } from "node:events";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

import chokidar from "chokidar";

// ============================================================================
// Types
// ============================================================================

export type SessionState = "error" | "idle" | "working" | "waiting_permission";

export interface SessionStateChange {
  sessionName: string;
  state: SessionState;
  timestamp: string;
  toolName?: string;
  errorMessage?: string;
  cumulativeTokens?: number;
  projectName?: string;
}

interface SessionStateFile {
  state: string;
  timestamp: string;
  sessionId?: string;
  toolName?: string;
  errorMessage?: string;
  cumulativeTokens?: number;
  projectName?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATE_DIR = join(homedir(), ".claude-workflow", "session-state");
const VALID_STATES = new Set(["error", "idle", "working", "waiting_permission"]);

/** Non-idle states older than 10 minutes are treated as stale → idle */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// ============================================================================
// Service
// ============================================================================

export class SessionStateWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private stateDir: string;

  constructor(stateDir?: string) {
    super();
    this.stateDir = stateDir ?? STATE_DIR;
  }

  /**
   * Start watching the session state directory.
   * Creates the directory if it doesn't exist.
   */
  async start(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }

    this.watcher = chokidar.watch(this.stateDir, {
      usePolling: true,
      interval: 1000,
      ignoreInitial: true,
      atomic: 100,
      depth: 0,
    });

    this.watcher.on("add", (filePath: string) => {
      if (!filePath.endsWith(".json") || filePath.endsWith(".tmp")) return;
      console.log(`[SessionStateWatcher] File added: ${filePath}`);
      this.handleFileChange(filePath);
    });
    this.watcher.on("change", (filePath: string) => {
      if (!filePath.endsWith(".json") || filePath.endsWith(".tmp")) return;
      console.log(`[SessionStateWatcher] File changed: ${filePath}`);
      this.handleFileChange(filePath);
    });
    this.watcher.on("unlink", (filePath: string) => {
      if (!filePath.endsWith(".json") || filePath.endsWith(".tmp")) return;
      console.log(`[SessionStateWatcher] File removed: ${filePath}`);
      this.handleFileRemoved(filePath);
    });
    this.watcher.on("error", (error: Error) => {
      console.error("[SessionStateWatcher] Error:", error.message);
    });
    this.watcher.on("ready", () => {
      console.log("[SessionStateWatcher] Ready and watching for changes");
    });

    // Periodically scan for stale non-idle states and emit idle
    this.staleTimer = setInterval(() => this.cleanupStaleStates(), 60_000);

    console.log(`[SessionStateWatcher] Watching ${this.stateDir}`);
  }

  /**
   * Stop watching and clean up.
   */
  async stop(): Promise<void> {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
      console.log("[SessionStateWatcher] Stopped");
    }
  }

  /**
   * Get current states for all session state files.
   * Used to send initial state to newly connected WebSocket clients.
   */
  getCurrentStates(): SessionStateChange[] {
    const states: SessionStateChange[] = [];
    try {
      const files = readdirSync(this.stateDir);
      for (const file of files) {
        if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
        const filePath = join(this.stateDir, file);
        try {
          const content = readFileSync(filePath, "utf8");
          const data = JSON.parse(content) as SessionStateFile;
          if (!VALID_STATES.has(data.state)) continue;
          const state = data.state as SessionState;
          const timestamp = data.timestamp ?? new Date().toISOString();
          const isStale =
            state !== "idle" &&
            Date.now() - new Date(timestamp).getTime() > STALE_THRESHOLD_MS;

          states.push({
            sessionName: basename(file, ".json"),
            state: isStale ? "idle" : state,
            timestamp,
            ...(data.toolName && { toolName: data.toolName }),
            ...(data.errorMessage && { errorMessage: data.errorMessage }),
            ...(data.cumulativeTokens !== undefined && { cumulativeTokens: data.cumulativeTokens }),
            ...(data.projectName && { projectName: data.projectName }),
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory read failed
    }
    return states;
  }

  /**
   * Scan state dir for non-idle states older than threshold and emit idle.
   */
  private cleanupStaleStates(): void {
    try {
      const files = readdirSync(this.stateDir);
      for (const file of files) {
        if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
        const filePath = join(this.stateDir, file);
        try {
          const content = readFileSync(filePath, "utf8");
          const data = JSON.parse(content) as SessionStateFile;
          if (!VALID_STATES.has(data.state) || data.state === "idle") continue;
          const age = Date.now() - new Date(data.timestamp).getTime();
          if (age > STALE_THRESHOLD_MS) {
            const sessionName = basename(file, ".json");
            console.log(
              `[SessionStateWatcher] Stale state for ${sessionName} (${Math.round(age / 60_000)}min), emitting idle`
            );
            this.emit("state_change", {
              sessionName,
              state: "idle" as SessionState,
              timestamp: new Date().toISOString(),
              ...(data.cumulativeTokens !== undefined && { cumulativeTokens: data.cumulativeTokens }),
              ...(data.projectName && { projectName: data.projectName }),
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory read failed
    }
  }

  /**
   * Handle a state file being created or modified.
   */
  private handleFileChange(filePath: string): void {
    const sessionName = basename(filePath, ".json");
    // Skip .tmp files (intermediate writes)
    if (sessionName.endsWith(".tmp")) return;

    try {
      const content = readFileSync(filePath, "utf8");
      const data = JSON.parse(content) as SessionStateFile;

      if (!VALID_STATES.has(data.state)) return;

      const change: SessionStateChange = {
        sessionName,
        state: data.state as SessionState,
        timestamp: data.timestamp ?? new Date().toISOString(),
        ...(data.toolName && { toolName: data.toolName }),
        ...(data.errorMessage && { errorMessage: data.errorMessage }),
        ...(data.cumulativeTokens !== undefined && { cumulativeTokens: data.cumulativeTokens }),
        ...(data.projectName && { projectName: data.projectName }),
      };

      this.emit("state_change", change);
    } catch {
      // Skip unreadable/malformed files
    }
  }

  /**
   * Handle a state file being removed (session ended).
   */
  private handleFileRemoved(filePath: string): void {
    const sessionName = basename(filePath, ".json");
    if (sessionName.endsWith(".tmp")) return;

    const change: SessionStateChange = {
      sessionName,
      state: "idle",
      timestamp: new Date().toISOString(),
    };

    this.emit("state_change", change);
  }
}
