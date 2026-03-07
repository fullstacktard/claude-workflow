/**
 * Real-Time Log Monitoring and Correlation System
 *
 * Monitors hook-activity.log files across all active sessions using chokidar,
 * parses structured tool calls, extracts token usage, and correlates with
 * claude-proxy routing decisions for real-time dashboard monitoring.
 *
 * Features:
 * - Real-time file watching with chokidar
 * - JSONL parsing with multi-line support
 * - Event correlation with configurable time windows
 * - Type-safe event emission
 * - Graceful error handling
 * - Memory-efficient circular buffers
 *
 * @file Uses EventEmitter pattern for Node.js compatibility
 * @file Uses `unknown` type for generic tool inputs (appropriate use case)
 */

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import chokidar, { type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * Type-safe event emitter declaration
 *
 * eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
 */
export declare interface RealTimeLogMonitor {
  emit<K extends keyof RealTimeLogMonitorEvents>(
    event: K,
    ...args: Parameters<RealTimeLogMonitorEvents[K]>
  ): boolean;
  on<K extends keyof RealTimeLogMonitorEvents>(
    event: K,
    listener: RealTimeLogMonitorEvents[K]
  ): this;
}

/**
 * Correlated event combining tool call with routing decision
 */
export interface CorrelatedEvent {
  correlationConfidence: number;
  routingDecision?: RoutingDecision;
  sessionId: string;
  toolCall: ToolCallEvent;
}

/**
 * Parsed log entry from hook-activity.log
 */
export interface LogEntry {
  details?: string;
  event: string;
  hook: string;
  status: string;
  timestamp: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
   
  toolInput?: Record<string, unknown>;
  toolName?: string;
}

/**
 * Malformed log entry event
 */
export interface MalformedEntryEvent {
  error: string;
  line: string;
  sessionId: string;
  timestamp: Date;
}

/**
 * Parse error event
 */
export interface ParseErrorEvent {
  error: string;
  logFile: string;
  sessionId: string;
  timestamp: Date;
}

/**
 * Type-safe event map for RealTimeLogMonitor
 */
export interface RealTimeLogMonitorEvents {
  "malformed-entry": (event: MalformedEntryEvent) => void;
  "parse-error": (event: ParseErrorEvent) => void;
  "routing-decision": (event: CorrelatedEvent) => void;
  "session-end": (event: SessionLifecycleEvent) => void;
  "session-start": (event: SessionLifecycleEvent) => void;
  "token-update": (event: TokenUpdateEvent) => void;
  "tool-call": (event: ToolCallEvent) => void;
}

/**
 * Configuration options for RealTimeLogMonitor
 */
export interface RealTimeLogMonitorOptions {
  /** Correlation time window in milliseconds (default: 100) */
  correlationWindowMs?: number;
  /** Debounce delay for file changes in milliseconds (default: 100) */
  debounceDelay?: number;
  /** Enable event correlation (default: true) */
  enableCorrelation?: boolean;
  /** Directory containing session log folders (default: .claude/logs) - DEPRECATED: use logsDirectories */
  logsDirectory?: string;
  /** Multiple directories containing session log folders */
  logsDirectories?: string[];
  /** Maximum routing decisions to keep in buffer (default: 1000) */
  maxRoutingBuffer?: number;
}

/**
 * Routing decision from claude-proxy logs
 */
export interface RoutingDecision {
  childServer: string;
  reason: string;
  timestamp: Date;
  toolName: string;
}

/**
 * Session lifecycle events
 */
export interface SessionLifecycleEvent {
  sessionId: string;
  timestamp: Date;
}

/**
 * Token usage update event
 */
export interface TokenUpdateEvent {
  inputTokens: number;
  outputTokens: number;
  sessionId: string;
  timestamp: Date;
  totalTokens: number;
}

/**
 * Tool call event emitted when a tool is used
 */
export interface ToolCallEvent {
  filePath?: string | undefined;
  hook: string;
   
  input: Record<string, unknown>;
  sessionId: string;
  status: string;
  timestamp: Date;
  toolName: string;
}

/**
 * Real-time log monitoring and correlation system
 *
 * Watches hook-activity.log files across all active sessions,
 * parses structured events, and correlates with routing decisions.
 *
 * @example
 * ```typescript
 * const monitor = new RealTimeLogMonitor({
 *   logsDirectory: '.claude/logs',
 *   correlationWindowMs: 100
 * });
 *
 * monitor.on('tool-call', (event) => {
 *   console.log(`Tool used: ${event.toolName}`);
 * });
 *
 * monitor.on('token-update', (event) => {
 *   console.log(`Tokens: ${event.totalTokens}`);
 * });
 *
 * await monitor.start();
 * ```
 */
export class RealTimeLogMonitor extends EventEmitter {
  private correlationWindowMs: number;
  private debounceDelay: number;
  private enableCorrelation: boolean;
  private lineBuffer: Map<string, string>;
  private logsDirectories: string[];
  private maxRoutingBuffer: number;
  private processedBytes: Map<string, number>;
  private routingBuffer: RoutingDecision[];
  private sessionWatchers: Map<string, FSWatcher>;
  private watchers: FSWatcher[];

  constructor(options: RealTimeLogMonitorOptions = {}) {
    super();
    const DEFAULT_DEBOUNCE_MS = 100;
    const DEFAULT_CORRELATION_WINDOW_MS = 100;
    const DEFAULT_MAX_ROUTING_BUFFER = 1000;

    // Support both single directory (deprecated) and multiple directories
    if (options.logsDirectories !== undefined && options.logsDirectories.length > 0) {
      this.logsDirectories = options.logsDirectories;
    } else if (options.logsDirectory === undefined) {
      this.logsDirectories = [".claude/logs"];
    } else {
      this.logsDirectories = [options.logsDirectory];
    }

    this.debounceDelay = options.debounceDelay ?? DEFAULT_DEBOUNCE_MS;
    this.correlationWindowMs = options.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS;
    this.enableCorrelation = options.enableCorrelation ?? true;
    this.maxRoutingBuffer = options.maxRoutingBuffer ?? DEFAULT_MAX_ROUTING_BUFFER;
    this.sessionWatchers = new Map();
    this.watchers = [];
    this.routingBuffer = [];
    this.lineBuffer = new Map();
    this.processedBytes = new Map();
  }

  /**
   * Add routing decision from claude-proxy logs for correlation
   *
   * @param decision - Routing decision to add to correlation buffer
   */
  addRoutingDecision(decision: RoutingDecision): void {
    this.routingBuffer.push(decision);

    // Limit buffer size using circular buffer pattern
    if (this.routingBuffer.length > this.maxRoutingBuffer) {
      this.routingBuffer.shift();
    }
  }

  /**
   * Start monitoring log files
   *
   * Watches for new session directories and monitors their log files.
   */
  async start(): Promise<void> {
    // Process each logs directory
    for (const logsDirectory of this.logsDirectories) {
      // Scan for existing session directories
      try {
        const entries = await readdir(logsDirectory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("session-")) {
            const sessionDir = join(logsDirectory, entry.name);
            this._watchSessionLogs(sessionDir).catch(console.error);
          }
        }
      } catch {
        // Directory might not exist yet
        console.warn(`Logs directory not found: ${logsDirectory}`);
        continue;
      }

      // Watch for new session directories
      const watcher = chokidar.watch(`${logsDirectory}/session-*`, {
        awaitWriteFinish: {
          pollInterval: 50,
          stabilityThreshold: this.debounceDelay
        },
        depth: 0,
        ignoreInitial: true, // We already scanned above
        persistent: true
      });

      watcher.on("addDir", (dirPath: string) => {
        this._watchSessionLogs(dirPath).catch(console.error);
      });

      watcher.on("unlinkDir", (dirPath: string) => {
        this._unwatchSessionLogs(dirPath).catch(console.error);
      });

      this.watchers.push(watcher);
      console.log(`RealTimeLogMonitor started monitoring: ${logsDirectory}`);
    }
  }

  /**
   * Stop monitoring and cleanup resources
   */
  async stop(): Promise<void> {
    // Close all directory watchers
    for (const watcher of this.watchers) {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await watcher.close();
    }
    this.watchers = [];

    // Close all session watchers
    const sessionWatchers = [...this.sessionWatchers.values()];
    for (const watcher of sessionWatchers) {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await watcher.close();
    }
    this.sessionWatchers.clear();
    this.lineBuffer.clear();
    this.processedBytes.clear();

    console.log("RealTimeLogMonitor stopped");
  }

  /**
   * Correlate tool call with routing decisions
   *
   * Uses timestamp-based correlation within configurable time window.
   */
  private _correlateWithRouting(toolCall: ToolCallEvent): CorrelatedEvent | undefined {
    if (this.routingBuffer.length === 0) {
      return undefined;
    }

    // Find routing decisions within correlation window
    const matches = this.routingBuffer.filter((routing) => {
      const timeDiff = Math.abs(toolCall.timestamp.getTime() - routing.timestamp.getTime());
      return timeDiff <= this.correlationWindowMs && routing.toolName === toolCall.toolName;
    });

    if (matches.length === 0) {
      return undefined;
    }

    // Use closest match by timestamp
    const closestMatch = matches.reduce((closest, current) => {
      const closestDiff = Math.abs(toolCall.timestamp.getTime() - closest.timestamp.getTime());
      const currentDiff = Math.abs(toolCall.timestamp.getTime() - current.timestamp.getTime());
      return currentDiff < closestDiff ? current : closest;
    });

    // Calculate correlation confidence (1.0 = exact match, 0.0 = at window edge)
    const timeDiff = Math.abs(toolCall.timestamp.getTime() - closestMatch.timestamp.getTime());
    const confidence = 1 - timeDiff / this.correlationWindowMs;

    return {
      correlationConfidence: confidence,
      routingDecision: closestMatch,
      sessionId: toolCall.sessionId,
      toolCall
    };
  }

  /**
   * Extract file path from tool input
   *
   * Handles common tool input patterns (file_path, filePath, path).
   */
   
  private _extractFilePath(toolInput: Record<string, unknown> | undefined): string | undefined {
    if (toolInput === undefined) {
      return undefined;
    }

    // Common tool input patterns
    const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path;
    return typeof filePath === "string" ? filePath : undefined;
  }

  /**
   * Parse individual log entry and emit appropriate events
   *
   * Handles malformed entries gracefully without crashing.
   */
  private _parseLogEntry(sessionId: string, line: string): void {
    try {
      const entry = JSON.parse(line) as LogEntry;

      // Validate required fields (defensive checks for runtime safety)
       
      if (entry.timestamp === undefined || entry.event === undefined) {
        throw new Error("Missing required fields: timestamp or event");
      }

      // Extract and emit tool calls
      if (entry.toolName !== undefined) {
        const toolCallEvent: ToolCallEvent = {
          filePath: this._extractFilePath(entry.toolInput),
          hook: entry.hook,
          input: entry.toolInput ?? {},
          sessionId,
          status: entry.status,
          timestamp: new Date(entry.timestamp),
          toolName: entry.toolName
        };

        this.emit("tool-call", toolCallEvent);

        // Attempt correlation if enabled
        if (this.enableCorrelation) {
          const correlated = this._correlateWithRouting(toolCallEvent);
          if (correlated !== undefined) {
            this.emit("routing-decision", correlated);
          }
        }
      }

      // Extract and emit token usage
      if (entry.tokenUsage !== undefined) {
        const tokenEvent: TokenUpdateEvent = {
          inputTokens: entry.tokenUsage.inputTokens,
          outputTokens: entry.tokenUsage.outputTokens,
          sessionId,
          timestamp: new Date(entry.timestamp),
          totalTokens: entry.tokenUsage.inputTokens + entry.tokenUsage.outputTokens
        };

        this.emit("token-update", tokenEvent);
      }
    } catch (error) {
      // Gracefully handle malformed entries - don't crash
      const MAX_LINE_PREVIEW_LENGTH = 100;
      const MAX_LINE_ERROR_LENGTH = 200;

      console.warn(`Malformed log entry in session ${sessionId}:`, {
        error: (error as Error).message,
        line: line.slice(0, MAX_LINE_PREVIEW_LENGTH)
      });

      this.emit("malformed-entry", {
        error: (error as Error).message,
        line: line.slice(0, MAX_LINE_ERROR_LENGTH),
        sessionId,
        timestamp: new Date()
      });
    }
  }

  /**
   * Parse log file and emit events for new entries
   *
   * Uses incremental parsing to only process new lines since last read.
   */
  private async _parseLogFile(sessionId: string, logFile: string): Promise<void> {
    try {
      const content = await readFile(logFile, "utf8");
      const lastProcessedBytes = this.processedBytes.get(sessionId) ?? 0;

      // Only process new content since last read
      if (content.length <= lastProcessedBytes) {
        return;
      }

      const newContent = content.slice(lastProcessedBytes);
      this.processedBytes.set(sessionId, content.length);

      // Get any buffered incomplete line from previous read
      let buffer = this.lineBuffer.get(sessionId) ?? "";
      buffer += newContent;

      const lines = buffer.split("\n");

      // Keep last potentially incomplete line in buffer
      const incompleteLineExists = !newContent.endsWith("\n");
      if (incompleteLineExists) {
        this.lineBuffer.set(sessionId, lines.pop() ?? "");
      } else {
        this.lineBuffer.set(sessionId, "");
      }

      // Process complete lines
      for (const line of lines) {
        if (line.trim() === "") {
          continue;
        }

        this._parseLogEntry(sessionId, line);
      }
    } catch (error) {
      console.error(`Error parsing log file ${logFile}:`, error);
      this.emit("parse-error", {
        error: (error as Error).message,
        logFile,
        sessionId,
        timestamp: new Date()
      });
    }
  }

  /**
   * Stop watching logs for a specific session
   */
  private async _unwatchSessionLogs(sessionDir: string): Promise<void> {
    const sessionId = basename(sessionDir);
    const watcher = this.sessionWatchers.get(sessionId);

    if (watcher === undefined) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/await-thenable
    await watcher.close();
    this.sessionWatchers.delete(sessionId);
    this.lineBuffer.delete(sessionId);
    this.processedBytes.delete(sessionId);

    this.emit("session-end", {
      sessionId,
      timestamp: new Date()
    });
  }

  /**
   * Watch log files for a specific session
   */
  private async _watchSessionLogs(sessionDir: string): Promise<void> {
    const sessionId = basename(sessionDir);

    // Skip if already watching
    if (this.sessionWatchers.has(sessionId)) {
      return;
    }

    const logFile = join(sessionDir, "hook-activity.log");

    const watcher = chokidar.watch(logFile, {
      awaitWriteFinish: {
        pollInterval: 50,
        stabilityThreshold: this.debounceDelay
      },
      ignoreInitial: false,
      persistent: true
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      watcher.on("ready", () => {
        resolve();
      });
    });

    watcher.on("change", () => {
      this._parseLogFile(sessionId, logFile).catch(console.error);
    });

    watcher.on("add", () => {
      this.emit("session-start", {
        sessionId,
        timestamp: new Date()
      });
      this._parseLogFile(sessionId, logFile).catch(console.error);
    });

    watcher.on("unlink", () => {
      // Log file was deleted, treat as session end
      this._unwatchSessionLogs(sessionDir).catch(console.error);
    });

    watcher.on("error", (error: Error) => {
      console.error(`Watcher error for session ${sessionId}:`, error);
      // On error (e.g., file/directory deleted), clean up
      this._unwatchSessionLogs(sessionDir).catch(console.error);
    });

    this.sessionWatchers.set(sessionId, watcher);

    // IMPORTANT: Manually check for existing log file after watcher is ready
    // This ensures we don't miss files that were created before the watcher started
    // or when ignoreInitial events don't fire reliably (e.g., in test environments)
    try {
      const fs = await import("node:fs/promises");
      await fs.access(logFile);

      // File exists, emit session-start and parse it
      this.emit("session-start", {
        sessionId,
        timestamp: new Date()
      });
      await this._parseLogFile(sessionId, logFile);
    } catch {
      // File doesn't exist yet, watcher will catch it when created
    }
  }
}
