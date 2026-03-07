/**
 * DockerLogStreamService - Real-time Docker container log streaming
 *
 * Streams logs from Docker containers (claude-proxy, mcp-proxy) via the Docker API.
 * Uses dockerode library for Docker socket communication.
 *
 * Features:
 * - Real-time log streaming from multiple containers
 * - Automatic reconnection on container restart
 * - Log level detection (info, warn, error, debug)
 * - ANSI escape code stripping
 * - Event-based architecture for WebSocket integration
 *
 * @module docker-log-stream
 */

import Docker from "dockerode";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

/**
 * Docker log entry emitted to WebSocket clients
 */
export interface DockerLogEntry {
  /** Container name (claude-proxy, mcp-proxy, claude-dashboard) */
  container: string;
  /** Log level inferred from content */
  level: "debug" | "error" | "info" | "warn";
  /** Log message content */
  message: string;
  /** Stream source (stdout or stderr) */
  stream: "stderr" | "stdout";
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Container stream state tracking
 */
interface ContainerStreamState {
  /** Container name */
  name: string;
  /** Log stream */
  stream: Readable | undefined;
  /** Whether currently streaming */
  active: boolean;
  /** Retry count for failed connections */
  retryCount: number;
  /** Last error message */
  lastError: string | undefined;
}

/**
 * Configuration options for DockerLogStreamService
 */
export interface DockerLogStreamOptions {
  /** Docker socket path (default: /var/run/docker.sock) */
  socketPath?: string;
  /** Container names to stream logs from */
  containers?: string[];
  /** Number of historical log lines to fetch (default: 100) */
  tailLines?: number;
  /** Maximum retry attempts per container (default: 5) */
  maxRetries?: number;
  /** Retry delay in milliseconds (default: 5000) */
  retryDelay?: number;
}

const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";
const DEFAULT_CONTAINERS = ["claude-proxy", "mcp-proxy", "claude-dashboard"];
const DEFAULT_TAIL_LINES = 100;

// Messages from the dashboard's own services that should be filtered when watching claude-dashboard
// This prevents infinite recursion (dashboard logs about watching → picked up → logs again)
const DASHBOARD_SELF_LOG_PREFIXES = new Set([
  "[docker-log-stream]",
  "[websocket-server]",
  "[accounts]",
  "[agent-completion-stream]",
  "[ProjectScanner]",
  "[live-log-stream]",
  "[update-executor]",
  "[projects]",
  "[claude-process-detector]",
]);
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 5000;
const DEFAULT_MAX_CACHE_SIZE = 2000;

// Docker multiplexed stream header size (8 bytes)
// Format: [stream_type (1 byte), 0, 0, 0, size (4 bytes big-endian)]
const DOCKER_HEADER_SIZE = 8;

/**
 * Service for streaming Docker container logs
 *
 * @example
 * ```typescript
 * const dockerStream = new DockerLogStreamService();
 *
 * dockerStream.on("log", (entry: DockerLogEntry) => {
 *   console.log(`[${entry.container}] ${entry.message}`);
 * });
 *
 * dockerStream.on("error", (error: Error, container: string) => {
 *   console.error(`Error streaming ${container}:`, error.message);
 * });
 *
 * await dockerStream.start();
 * ```
 */
export class DockerLogStreamService extends EventEmitter {
  private readonly docker: Docker;
  private readonly containers: string[];
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly tailLines: number;
  private containerStates: Map<string, ContainerStreamState> = new Map();
  private isRunning = false;
  private watchInterval: NodeJS.Timeout | undefined;

  /** Cache of recent log entries for initial subscription */
  private readonly recentLogs: DockerLogEntry[] = [];
  private readonly maxCacheSize: number;

  constructor(options: DockerLogStreamOptions = {}) {
    super();

    this.docker = new Docker({
      socketPath: options.socketPath ?? DEFAULT_SOCKET_PATH,
    });

    this.containers = options.containers ?? DEFAULT_CONTAINERS;
    this.tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.maxCacheSize = DEFAULT_MAX_CACHE_SIZE;

    // Initialize state for each container
    for (const name of this.containers) {
      this.containerStates.set(name, {
        active: false,
        lastError: undefined,
        name,
        retryCount: 0,
        stream: undefined,
      });
    }
  }

  /**
   * Start streaming logs from all configured containers
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log("[docker-log-stream] Starting Docker log streaming...");
    console.log(`[docker-log-stream] Target containers: ${this.containers.join(", ")}`);

    // Check Docker socket availability
    try {
      await this.docker.ping();
      console.log("[docker-log-stream] Docker socket connected successfully");

      // List running containers for debugging
      try {
        const containers = await this.docker.listContainers({ all: true });
        console.log(`[docker-log-stream] Found ${containers.length} Docker containers:`);
        for (const container of containers) {
          const names = container.Names?.map(n => n.replace(/^\//, "")).join(", ") ?? "unknown";
          const state = container.State ?? "unknown";
          const status = container.Status ?? "unknown";
          console.log(`[docker-log-stream]   - ${names} (${state}): ${status}`);
        }
      } catch (listError) {
        console.warn("[docker-log-stream] Could not list containers:", (listError as Error).message);
      }
    } catch (error) {
      console.error("[docker-log-stream] Docker socket not available:", (error as Error).message);
      console.error("[docker-log-stream] Ensure Docker socket is mounted at /var/run/docker.sock");
      console.error("[docker-log-stream] And that the container has permission to access it (DOCKER_GID)");
      this.emit("error", error, "docker-socket");
      return;
    }

    // Start streaming for each container
    console.log("[docker-log-stream] Starting streams for configured containers...");
    await Promise.all(
      this.containers.map((container) => this.startContainerStream(container))
    );

    // Log initial status after starting streams
    const status = this.getStatus();
    console.log("[docker-log-stream] Initial stream status:");
    for (const [name, state] of Object.entries(status)) {
      console.log(`[docker-log-stream]   - ${name}: active=${String(state.active)}, error=${state.lastError ?? "none"}`);
    }

    // Watch for container restarts
    this.watchInterval = setInterval(() => {
      void this.checkContainers();
    }, 10_000);
  }

  /**
   * Stop all log streams and clean up
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log("[docker-log-stream] Stopping Docker log streaming...");

    // Clear watch interval
    if (this.watchInterval !== undefined) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
    }

    // Destroy all streams
    for (const state of this.containerStates.values()) {
      if (state.stream !== undefined) {
        state.stream.destroy();
        state.stream = undefined;
      }
      state.active = false;
    }

    this.removeAllListeners();
  }

  /**
   * Get current status of container streams
   */
  getStatus(): Record<string, { active: boolean; lastError: string | undefined }> {
    const status: Record<string, { active: boolean; lastError: string | undefined }> = {};

    for (const [name, state] of this.containerStates) {
      status[name] = {
        active: state.active,
        lastError: state.lastError,
      };
    }

    return status;
  }

  /**
   * Get detailed status for debugging purposes
   */
  getDetailedStatus(): {
    isRunning: boolean;
    containers: Record<string, {
      active: boolean;
      lastError: string | undefined;
      retryCount: number;
      hasStream: boolean;
    }>;
    cachedLogCount: number;
    } {
    const containers: Record<string, {
      active: boolean;
      lastError: string | undefined;
      retryCount: number;
      hasStream: boolean;
    }> = {};

    for (const [name, state] of this.containerStates) {
      containers[name] = {
        active: state.active,
        hasStream: state.stream !== undefined,
        lastError: state.lastError,
        retryCount: state.retryCount,
      };
    }

    return {
      cachedLogCount: this.recentLogs.length,
      containers,
      isRunning: this.isRunning,
    };
  }

  /**
   * Check if Docker socket is accessible
   */
  async checkDockerAccess(): Promise<{ accessible: boolean; containers?: string[]; error?: string }> {
    try {
      await this.docker.ping();
      const containerList = await this.docker.listContainers({ all: true });
      const containerNames = containerList.flatMap(c => c.Names?.map(n => n.replace(/^\//, "")) ?? []);
      return { accessible: true, containers: containerNames };
    } catch (error) {
      return { accessible: false, error: (error as Error).message };
    }
  }

  /**
   * Get recent log entries from cache
   *
   * Used to send historical logs to new WebSocket subscribers.
   *
   * @param limit - Maximum number of entries to return (default: 100)
   * @returns Array of recent log entries, oldest first (chronological order)
   */
  getRecentLogs(limit = 100): DockerLogEntry[] {
    // Return oldest first (chronological order for reading top-to-bottom)
    return this.recentLogs.slice(-limit);
  }

  /**
   * Add a log entry to the cache
   *
   * Maintains a fixed-size cache, removing oldest entries when full.
   *
   * @param entry - Log entry to cache
   */
  private cacheLog(entry: DockerLogEntry): void {
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxCacheSize) {
      this.recentLogs.shift();
    }
  }

  /**
   * Start streaming logs from a specific container
   */
  private async startContainerStream(containerName: string): Promise<void> {
    const state = this.containerStates.get(containerName);
    if (state === undefined) {
      console.warn(`[docker-log-stream] No state found for container: ${containerName}`);
      return;
    }

    // Already streaming
    if (state.active && state.stream !== undefined) {
      console.log(`[docker-log-stream] Already streaming from ${containerName}, skipping`);
      return;
    }

    console.log(`[docker-log-stream] Attempting to connect to container: ${containerName}`);

    try {
      const container = this.docker.getContainer(containerName);

      // Check if container exists and is running
      let info;
      try {
        info = await container.inspect();
      } catch (inspectError) {
        const errMsg = (inspectError as Error).message;
        state.lastError = `Container not found: ${errMsg}`;
        console.warn(`[docker-log-stream] Container ${containerName} not found or inaccessible: ${errMsg}`);
        return;
      }

      if (!info.State.Running) {
        state.lastError = `Container not running (state: ${info.State.Status})`;
        console.log(`[docker-log-stream] Container ${containerName} not running (state: ${info.State.Status})`);
        return;
      }

      console.log(`[docker-log-stream] Container ${containerName} is running (ID: ${info.Id.slice(0, 12)}), starting log stream...`);

      // Create log stream with follow, timestamps, and since filter
      // Only fetch logs from the last hour to prevent loading stale entries
      const sinceSeconds = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
      const stream = await container.logs({
        follow: true,
        stderr: true,
        stdout: true,
        since: sinceSeconds,
        tail: this.tailLines,
        timestamps: true,
      });

      state.stream = stream as unknown as Readable;
      state.active = true;
      state.retryCount = 0;
      state.lastError = undefined;

      console.log(`[docker-log-stream] Successfully started streaming logs from ${containerName} (tail=${this.tailLines})`);

      // Process the multiplexed stream
      this.processMultiplexedStream(containerName, stream as unknown as Readable);

      // Handle stream end
      (stream as unknown as Readable).on("end", () => {
        console.log(`[docker-log-stream] Stream ended for ${containerName}`);
        state.active = false;
        state.stream = undefined;

        // Retry if still running
        if (this.isRunning && state.retryCount < this.maxRetries) {
          state.retryCount++;
          console.log(`[docker-log-stream] Scheduling retry for ${containerName} (attempt ${state.retryCount}/${this.maxRetries}) in ${this.retryDelay}ms`);
          setTimeout(() => {
            void this.startContainerStream(containerName);
          }, this.retryDelay);
        } else if (this.isRunning) {
          console.warn(`[docker-log-stream] Max retries (${this.maxRetries}) reached for ${containerName}`);
        }
      });

      // Handle stream errors
      (stream as unknown as Readable).on("error", (error: Error) => {
        console.error(`[docker-log-stream] Stream error for ${containerName}:`, error.message);
        state.lastError = error.message;
        state.active = false;
        state.stream = undefined;
        this.emit("error", error, containerName);
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      state.lastError = errorMessage;
      console.error(`[docker-log-stream] Failed to start stream for ${containerName}:`, errorMessage);
      this.emit("error", error, containerName);

      // Retry if container might be starting
      if (this.isRunning && state.retryCount < this.maxRetries) {
        state.retryCount++;
        console.log(`[docker-log-stream] Scheduling retry for ${containerName} (attempt ${state.retryCount}/${this.maxRetries}) in ${this.retryDelay}ms`);
        setTimeout(() => {
          void this.startContainerStream(containerName);
        }, this.retryDelay);
      } else if (this.isRunning) {
        console.warn(`[docker-log-stream] Max retries (${this.maxRetries}) reached for ${containerName}`);
      }
    }
  }

  /**
   * Process Docker multiplexed stream format
   *
   * Docker logs use a multiplexed format with 8-byte headers:
   * - Byte 0: Stream type (1 = stdout, 2 = stderr)
   * - Bytes 1-3: Reserved (zeros)
   * - Bytes 4-7: Frame size (big-endian uint32)
   */
  private processMultiplexedStream(containerName: string, stream: Readable): void {
    let buffer = Buffer.alloc(0);
    let messageCount = 0;
    let lastLogTime = Date.now();

    console.log(`[docker-log-stream] Processing multiplexed stream for ${containerName}`);

    stream.on("data", (chunk: Buffer) => {
      // Append new data to buffer
      buffer = Buffer.concat([buffer, chunk]);

      // Process complete frames
      while (buffer.length >= DOCKER_HEADER_SIZE) {
        // Read header
        const streamType = buffer[0];
        const frameSize = buffer.readUInt32BE(4);

        // Check if we have the complete frame
        if (buffer.length < DOCKER_HEADER_SIZE + frameSize) {
          // Wait for more data
          break;
        }

        // Extract the frame
        const frameData = buffer.subarray(DOCKER_HEADER_SIZE, DOCKER_HEADER_SIZE + frameSize);
        buffer = buffer.subarray(DOCKER_HEADER_SIZE + frameSize);

        // Determine stream type
        const streamName: "stderr" | "stdout" = streamType === 2 ? "stderr" : "stdout";

        // Parse and emit log entry
        const logLine = frameData.toString("utf8").trim();
        if (logLine.length > 0) {
          const entry = this.parseLogLine(containerName, streamName, logLine);

          // Filter out self-referential logs from claude-dashboard to prevent infinite recursion
          // (dashboard service logs → picked up as new log → logged about → infinite loop)
          if (containerName === "claude-dashboard") {
            // Check if message starts with any known dashboard service prefix
            const startsWithDashboardPrefix = [...DASHBOARD_SELF_LOG_PREFIXES].some(
              prefix => entry.message.startsWith(prefix)
            );
            if (startsWithDashboardPrefix) {
              continue; // Skip without caching or emitting
            }
          }

          this.cacheLog(entry);
          this.emit("log", entry);
          messageCount++;

          // Log progress periodically (every 60 seconds after first 5 messages)
          // Note: This log is filtered by SELF_REFERENCE_PATTERNS to prevent recursion
          const now = Date.now();
          if (messageCount <= 5 || now - lastLogTime > 60_000) {
            console.log(`[docker-log-stream] [${containerName}] Processed ${messageCount} entries`);
            lastLogTime = now;
          }
        }
      }
    });

    // Log when stream receives data for the first time
    stream.once("data", () => {
      console.log(`[docker-log-stream] First data received from ${containerName}`);
    });
  }

  /**
   * Parse a log line into a DockerLogEntry
   *
   * Log format: [ISO timestamp] message
   * Example: 2024-01-15T10:30:45.123456789Z INFO: Starting server
   */
  private parseLogLine(
    container: string,
    stream: "stderr" | "stdout",
    line: string
  ): DockerLogEntry {
    // Strip ANSI escape codes
    const cleanLine = this.stripAnsi(line);

    // Extract timestamp (Docker adds timestamps in RFC3339Nano format)
    let timestamp = new Date().toISOString();
    let message = cleanLine;

    // Match Docker timestamp format: 2024-01-15T10:30:45.123456789Z
    const timestampMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s*(.*)$/.exec(cleanLine);
    if (timestampMatch !== null) {
      timestamp = timestampMatch[1];
      message = timestampMatch[2];
    }

    // Detect log level from message content
    const level = this.detectLogLevel(message);

    // Strip log level prefix from message (level is shown in badge)
    // Handles: ERR, OUT, INFO, DEBUG, WARN, WARNING, [ERROR], [INFO], etc.
    message = this.stripLevelPrefix(message);

    return {
      container,
      level,
      message,
      stream,
      timestamp,
    };
  }

  /**
   * Detect log level from message content
   *
   * Note on stderr: MCP servers use stderr for debug/info output because stdout
   * is reserved for JSON-RPC protocol. We detect debug prefixes like "-DEBUG"
   * or "[DEBUG]" and treat unrecognized stderr as info, not error.
   */
  private detectLogLevel(message: string): "debug" | "error" | "info" | "warn" {
    const lowerMessage = message.toLowerCase();

    // Check explicit level prefixes
    if (/^(error|err|\[error\]|\[err\])[:|\s]/i.test(message)) {
      return "error";
    }
    if (/^(warn|warning|\[warn\]|\[warning\])[:|\s]/i.test(message)) {
      return "warn";
    }
    if (/^(debug|\[debug\])[:|\s]/i.test(message)) {
      return "debug";
    }
    if (/^(info|\[info\])[:|\s]/i.test(message)) {
      return "info";
    }

    // MCP servers use stderr for debug output (stdout reserved for JSON-RPC)
    // Detect common debug patterns: "-DEBUG", "-DEBUG]", "[server-DEBUG]", etc.
    if (/-DEBUG\]?[\s:]/i.test(message) || lowerMessage.includes("-debug")) {
      return "debug";
    }

    // Check for error indicators
    if (lowerMessage.includes("error") ||
        lowerMessage.includes("exception") ||
        lowerMessage.includes("failed") ||
        lowerMessage.includes("failure")) {
      return "error";
    }

    // Check for warning indicators
    if (lowerMessage.includes("warn") ||
        lowerMessage.includes("deprecated") ||
        lowerMessage.includes("timeout")) {
      return "warn";
    }

    // For MCP proxy containers, stderr is typically debug/info output, not errors
    // MCP servers MUST use stderr for debug because stdout is JSON-RPC only
    // Default to "info" instead of "error" for stderr from mcp-proxy
    return "info";
  }

  /**
   * Strip ANSI escape codes from a string
   */
  private stripAnsi(str: string): string {
     
    return str.replaceAll(/\u001B\[[0-9;]*m/g, "");
  }

  /**
   * Strip log level prefix from message after level detection
   * Handles: ERR, OUT, INFO, DEBUG, WARN, WARNING, [ERROR], [INFO], etc.
   * Note: Strips prefixes after level detection so level is preserved.
   */
  private stripLevelPrefix(message: string): string {
    // Remove common level prefixes (case-insensitive)
    // Pattern handles:
    // - Single prefixes: ERR, INFO, DEBUG, WARN, WARNING, OUT
    // - Brackets: [ERROR], [INFO], [DEBUG], [WARN], [WARNING]
    // - Followed by colon or space
    const prefixPattern = /^(?:ERR|ERROR|OUT|INFO|DEBUG|WARN|WARNING|\[ERROR\]|\[INFO\]|\[DEBUG\]|\[WARN\]|\[WARNING\])[:\s]+/i;

    let cleaned = message;

    // Strip prefix (may need multiple passes for "OUT INFO:" pattern)
    for (let i = 0; i < 2; i++) {
      const match = prefixPattern.exec(cleaned);
      if (match) {
        cleaned = cleaned.slice(match[0].length);
      } else {
        break;
      }
    }

    return cleaned.trim();
  }

  /**
   * Check containers and restart streams if needed
   *
   * This method runs on an interval and handles two cases:
   * 1. Container exists but stream isn't active - try to reconnect
   * 2. Container doesn't exist yet - wait for it to be created
   *
   * Unlike startContainerStream which has a retry limit for rapid failures,
   * this method always tries to reconnect inactive containers regardless of
   * retry count, since it runs on a slower interval (10 seconds).
   */
  private async checkContainers(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    for (const containerName of this.containers) {
      const state = this.containerStates.get(containerName);
      if (state === undefined) {
        continue;
      }

      // If not active, always try to reconnect (ignore retry count for interval checks)
      // This ensures containers that start later (like mcp-proxy) eventually get connected
      if (!state.active) {
        try {
          const container = this.docker.getContainer(containerName);
          const info = await container.inspect();

          if (info.State.Running) {
            console.log(`[docker-log-stream] Periodic check: Container ${containerName} is running but stream inactive, reconnecting...`);
            state.retryCount = 0; // Reset retry count on successful reconnect
            await this.startContainerStream(containerName);
          } else {
            // Container exists but not running - log only if state changed
            if (state.lastError !== `Container not running (state: ${info.State.Status})`) {
              console.log(`[docker-log-stream] Periodic check: Container ${containerName} exists but not running (state: ${info.State.Status})`);
            }
          }
        } catch (error) {
          // Container doesn't exist or can't be inspected - will retry on next interval
          // Log only if this is a new error state
          const errMsg = (error as Error).message;
          if (state.lastError !== errMsg) {
            console.log(`[docker-log-stream] Periodic check: Container ${containerName} not accessible: ${errMsg}`);
            state.lastError = errMsg;
          }
        }
      }
    }
  }
}
