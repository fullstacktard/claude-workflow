/**
 * Live Log Stream Service
 *
 * @deprecated This service is deprecated and will be removed in a future version.
 * Use EventStreamService instead, which watches the consolidated events.jsonl file.
 * See: src/lib/dashboard/services/event-stream.ts
 *
 * Real-time log streaming service for cross-project log aggregation.
 * Watches routing log files across all discovered projects using chokidar
 * and emits events for new log entries with full project context.
 *
 * Features:
 * - Integration with ProjectScannerService for auto-discovery
 * - File watching with chokidar (handles rotation gracefully)
 * - LRU cache with configurable max entries (default: 1000)
 * - Real-time event emission for WebSocket broadcasting
 * - Memory-efficient streaming with incremental parsing
 * - Filtering by project, timeRange, and type
 *
 * @module live-log-stream
 */

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import chokidar, { type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import type { DiscoveredProject } from "./log-aggregator.js";
import { ProjectScannerService } from "./project-scanner.js";
import {
  isLogEvent,
  type LogEvent,
  type StandardLogEntry
} from "./types/log-entry.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_DEBOUNCE_DELAY_MS = 100;
const DEFAULT_PROJECT_POLL_INTERVAL_MS = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_IN_WEEK = 7;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Live log entry with full project context
 * Extends StandardLogEntry with additional dashboard-specific fields
 */
export interface LiveLogEntry extends StandardLogEntry {
  /** Project name (alias for display) */
  project: string;
  /** The routing decision made (derived from type and agent/skill) */
  decision: string;
  /** Confidence score 0-1 */
  confidence?: number;
  /** Whether user followed recommendation */
  followed?: boolean;
  /** Agent type for completion events */
  agentType?: string;
  /** Completion status */
  status?: string;
  /** Total tokens used */
  totalTokens?: number;
  /** Duration in milliseconds */
  totalDurationMs?: number;
  /** Number of tool uses */
  totalToolUseCount?: number;
  /** Cumulative context token usage for this session */
  sessionContextTokens?: number;
  /** Claude's internal session UUID for token lookup correlation */
  claudeSessionId?: string;
}

/**
 * Filter options for live log queries
 */
export interface LiveLogFilterOptions {
  /** Filter by project name */
  project?: string;
  /** Filter by time range */
  timeRange?: "1h" | "24h" | "7d";
  /** Filter by entry type */
  type?: "agent_invocation" | "skill_invocation" | "agent_with_skill";
}

/**
 * Configuration options for LiveLogStream
 */
export interface LiveLogStreamOptions {
  /** Maximum entries to keep in memory (default: 1000) */
  maxEntries?: number;
  /** Debounce delay for file changes in ms (default: 100) */
  debounceDelay?: number;
  /** Poll interval for project discovery in ms (default: 60000) */
  projectPollInterval?: number;
}

/**
 * Events emitted by LiveLogStream
 */
export interface LiveLogStreamEvents {
  "log-entry": (entry: LiveLogEntry) => void;
  error: (error: Error, project: string) => void;
  "project-added": (project: DiscoveredProject) => void;
  "project-removed": (projectPath: string) => void;
}

/**
 * Type-safe event emitter declaration
 */
export declare interface LiveLogStream {
  emit<K extends keyof LiveLogStreamEvents>(
    event: K,
    ...args: Parameters<LiveLogStreamEvents[K]>
  ): boolean;
  on<K extends keyof LiveLogStreamEvents>(
    event: K,
    listener: LiveLogStreamEvents[K]
  ): this;
  off<K extends keyof LiveLogStreamEvents>(
    event: K,
    listener: LiveLogStreamEvents[K]
  ): this;
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Entry with pre-parsed timestamp for O(1) comparisons
 */
interface CachedEntry {
  entry: LiveLogEntry;
  timestampMs: number;
  id: string;
}

/**
 * Optimized LRU cache for log entries with deduplication
 *
 * Performance improvements over naive implementation:
 * - Ring buffer approach: O(1) eviction instead of O(n) shift()
 * - Pre-parsed timestamps: avoids Date parsing on every comparison
 * - Binary search insertion: maintains sorted order, O(log n) insert
 * - Single-pass filtering: avoids multiple array iterations
 *
 * Uses composite keys for deduplication: ${timestamp}-${type}-${agent}-${skill}
 */
class LogEntryCache {
  /** Entries stored in descending timestamp order (newest first) */
  private entries: CachedEntry[] = [];
  private readonly maxSize: number;
  /** Set of composite keys for deduplication */
  private seenIds: Set<string> = new Set();

  constructor(maxSize: number = DEFAULT_MAX_ENTRIES) {
    this.maxSize = maxSize;
  }

  /**
   * Generate composite key for deduplication
   * Uses sessionId, timestamp, type, agent, and skill to uniquely identify entries
   * SessionId is critical to prevent cross-session duplicates
   */
  private generateEntryId(entry: LiveLogEntry): string {
    return `${entry.sessionId}-${entry.timestamp}-${entry.type}-${entry.agent ?? ""}-${entry.skill ?? ""}`;
  }

  /**
   * Binary search to find insertion index for maintaining descending sort order
   * Returns index where entry should be inserted to maintain newest-first order
   */
  private findInsertIndex(timestampMs: number): number {
    let low = 0;
    let high = this.entries.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      // Descending order: newer (larger) timestamps come first
      if (this.entries[mid].timestampMs > timestampMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * Add entry to cache with LRU eviction and deduplication
   * Maintains sorted order via binary search insertion - O(log n) search + O(n) splice
   * Returns true if entry was added, false if duplicate
   */
  add(entry: LiveLogEntry): boolean {
    // Generate unique ID for deduplication
    const entryId = this.generateEntryId(entry);

    // Skip duplicate entries - O(1) lookup
    if (this.seenIds.has(entryId)) {
      return false;
    }

    // Pre-parse timestamp once
    const timestampMs = new Date(entry.timestamp).getTime();

    // Find insertion point via binary search - O(log n)
    const insertIndex = this.findInsertIndex(timestampMs);

    // Create cached entry with pre-parsed data
    const cachedEntry: CachedEntry = {
      entry,
      id: entryId,
      timestampMs,
    };

    // Insert at correct position to maintain sorted order
    this.entries.splice(insertIndex, 0, cachedEntry);
    this.seenIds.add(entryId);

    // LRU eviction - remove oldest (last in array) when over limit
    // O(1) pop() instead of O(n) shift()
    while (this.entries.length > this.maxSize) {
      const removed = this.entries.pop();
      if (removed) {
        this.seenIds.delete(removed.id);
      }
    }

    return true;
  }

  /**
   * Get recent entries with optional limit
   * Returns oldest first (chronological order for reading top-to-bottom)
   */
  getRecent(limit?: number): LiveLogEntry[] {
    const result = limit === undefined
      ? this.entries
      : this.entries.slice(0, limit);
    // Reverse to return oldest first (entries are stored newest first internally)
    return result.map((c) => c.entry).reverse();
  }

  /**
   * Get filtered entries - single pass with pre-parsed timestamps
   */
  getFiltered(filters: LiveLogFilterOptions): LiveLogEntry[] {
    // Calculate cutoff once if needed
    let cutoffMs: number | undefined;
    if (filters.timeRange !== undefined) {
      const now = Date.now();
      switch (filters.timeRange) {
      case "1h": {
        cutoffMs = now - MILLISECONDS_PER_HOUR;
        break;
      }
      case "24h": {
        cutoffMs = now - MILLISECONDS_PER_DAY;
        break;
      }
      case "7d": {
        cutoffMs = now - DAYS_IN_WEEK * MILLISECONDS_PER_DAY;
        break;
      }
      }
    }

    // Single-pass filter using pre-parsed timestamps
    const result: LiveLogEntry[] = [];
    for (const cached of this.entries) {
      // Time filter using pre-parsed timestamp - O(1)
      if (cutoffMs !== undefined && cached.timestampMs < cutoffMs) {
        // Since entries are sorted newest-first, once we hit old entries
        // we could break early, but filtering might still need older entries
        // that match other criteria, so continue
        continue;
      }

      const e = cached.entry;

      // Project filter
      if (filters.project !== undefined && e.project !== filters.project) {
        continue;
      }

      // Type filter
      if (filters.type !== undefined && e.type !== filters.type) {
        continue;
      }

      result.push(e);
    }

    // Already sorted newest-first, no need to re-sort
    return result;
  }

  /**
   * Clear all entries and dedup tracking
   */
  clear(): void {
    this.entries = [];
    this.seenIds.clear();
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.entries.length;
  }
}

// ============================================================================
// Live Log Stream Class
// ============================================================================

/**
 * Live log streaming service
 *
 * Watches log files across all discovered projects and emits
 * events for new log entries. Integrates with ProjectScannerService
 * for auto-discovery and maintains an LRU cache of recent entries.
 *
 * @example
 * ```typescript
 * import { ProjectScannerService } from './project-scanner.js';
 *
 * const projectScanner = new ProjectScannerServiceService();
 * const liveStream = new LiveLogStream(projectScanner, {
 *   maxEntries: 1000,
 *   debounceDelay: 100,
 *   projectPollInterval: 60000
 * });
 *
 * liveStream.on('log-entry', (entry) => {
 *   console.log(`[${entry.project}] ${entry.type}: ${entry.decision}`);
 * });
 *
 * await liveStream.startLiveStream();
 * ```
 */
export class LiveLogStream extends EventEmitter {
  private readonly projectScanner: ProjectScannerService;
  private readonly cache: LogEntryCache;
  private readonly options: Required<LiveLogStreamOptions>;

  /** Map of project path to file watcher */
  private watchers: Map<string, FSWatcher> = new Map();
  /** Map of project path to last processed byte position */
  private filePositions: Map<string, number> = new Map();
  /** Map of project path to last known file size (for rotation detection) */
  private lastFileSizes: Map<string, number> = new Map();
  /** Map of project path to consecutive error count */
  private errorCounts: Map<string, number> = new Map();
  /** Map of file key to incomplete line buffer (for handling partial writes) */
  private lineBuffers: Map<string, string> = new Map();
  /** Interval for project discovery polling */
  private discoveryInterval: ReturnType<typeof setInterval> | undefined;
  /** Fallback polling interval for file change detection (Docker/WSL2 workaround) */
  private fallbackPollInterval: ReturnType<typeof setInterval> | undefined;
  /** Map of project path to watched file info for fallback polling */
  private watchedProjectFiles: Map<string, { project: DiscoveredProject; filePath: string }> = new Map();
  /** Whether streaming is active */
  private isStreaming = false;

  /** Maximum consecutive errors before stopping watcher */
  private static readonly MAX_CONSECUTIVE_ERRORS = 3;

  /** Cache for session context token counts: Map<sessionId, { tokens: number, cachedAt: number }> */
  private sessionTokenCache: Map<string, { tokens: number; cachedAt: number }> = new Map();
  /** Cache TTL for session tokens (30 seconds) - sessions update frequently */
  private static readonly SESSION_TOKEN_CACHE_TTL_MS = 30_000;
  /** Map our session ID (timestamp-pid) to Claude's session UUID + creation time for token lookup */
  private sessionToClaudeSessionMap: Map<string, { claudeSessionId: string; createdAt: number }> = new Map();
  /** Interval for periodic memory cleanup */
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  /** How often to run cleanup (5 minutes) */
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  /** How often to run fallback file polling (2 seconds) - Docker/WSL2 workaround */
  private static readonly FALLBACK_POLL_INTERVAL_MS = 2000;
  /** Max age for session mappings before cleanup (1 hour) */
  private static readonly SESSION_MAX_AGE_MS = 60 * 60 * 1000;

  constructor(projectScanner: ProjectScannerService, options: LiveLogStreamOptions = {}) {
    super();
    this.projectScanner = projectScanner;
    this.options = {
      debounceDelay: options.debounceDelay ?? DEFAULT_DEBOUNCE_DELAY_MS,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      projectPollInterval: options.projectPollInterval ?? DEFAULT_PROJECT_POLL_INTERVAL_MS,
    };
    this.cache = new LogEntryCache(this.options.maxEntries);
  }

  /**
   * Start live streaming from all discovered projects
   */
  async startLiveStream(): Promise<void> {
    if (this.isStreaming) {
      return;
    }
    this.isStreaming = true;

    // Initial project discovery and watcher setup
    await this.discoverAndWatchProjects();

    // Start polling for new projects
    this.discoveryInterval = setInterval(
      () => {
        this.discoverAndWatchProjects().catch((error) => {
          console.error("[live-log-stream] Error discovering projects:", error);
        });
      },
      this.options.projectPollInterval
    );

    // Start periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(
      () => this.performCleanup(),
      LiveLogStream.CLEANUP_INTERVAL_MS
    );

    // Start fallback file polling (Docker/WSL2 workaround)
    // Chokidar's polling can stall after processing large initial file reads.
    // This interval directly checks for new content regardless of watcher state.
    this.fallbackPollInterval = setInterval(
      () => {
        for (const [, { project, filePath }] of this.watchedProjectFiles) {
          this.processLogFile(project, filePath).catch((error) => {
            this.handleError(project.path, project.name, error as Error);
          });
        }
      },
      LiveLogStream.FALLBACK_POLL_INTERVAL_MS
    );

    console.log("[live-log-stream] Started live streaming (with fallback polling)");
  }

  /**
   * Stop live streaming and cleanup resources
   */
  stopLiveStream(): void {
    if (!this.isStreaming) {
      return;
    }
    this.isStreaming = false;

    // Stop project discovery polling
    if (this.discoveryInterval !== undefined) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = undefined;
    }

    // Stop cleanup interval
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Stop fallback polling
    if (this.fallbackPollInterval !== undefined) {
      clearInterval(this.fallbackPollInterval);
      this.fallbackPollInterval = undefined;
    }

    // Close all file watchers
    for (const [projectPath, watcher] of this.watchers) {
      watcher.close();
      this.emit("project-removed", projectPath);
    }
    this.watchers.clear();
    this.watchedProjectFiles.clear();
    this.filePositions.clear();
    this.lastFileSizes.clear();
    this.errorCounts.clear();
    this.lineBuffers.clear();

    // Clear session caches to free memory
    this.sessionTokenCache.clear();
    this.sessionToClaudeSessionMap.clear();
    this.sessionNumberMap.clear();

    console.log("[live-log-stream] Stopped live streaming");
  }

  /**
   * Get recent log entries across all projects
   */
  getRecentLogs(limit?: number): LiveLogEntry[] {
    return this.cache.getRecent(limit);
  }

  /**
   * Get filtered log entries
   */
  getFilteredLogs(filters: LiveLogFilterOptions): LiveLogEntry[] {
    return this.cache.getFiltered(filters);
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Discover projects and set up watchers for new ones
   */
  private async discoverAndWatchProjects(): Promise<void> {
    const projects = await this.projectScanner.scan();
    const currentPaths = new Set(this.watchers.keys());

    for (const project of projects) {
      if (!currentPaths.has(project.path)) {
        await this.watchProject(project);
      }
      currentPaths.delete(project.path);
    }

    // Remove watchers for projects that no longer exist
    for (const removedPath of currentPaths) {
      const watcher = this.watchers.get(removedPath);
      if (watcher !== undefined) {
        watcher.close();
        this.watchers.delete(removedPath);
        this.watchedProjectFiles.delete(removedPath);
        this.filePositions.delete(removedPath);
        this.lastFileSizes.delete(removedPath);
        this.emit("project-removed", removedPath);
      }
    }
  }

  /**
   * Set up watcher for a single project
   * Watches the consolidated events.jsonl file (not legacy routing/ directory)
   */
  private async watchProject(project: DiscoveredProject): Promise<void> {
    const eventsLogPath = join(project.path, ".claude", "logs", "events.jsonl");

    try {
      // Check if events.jsonl file exists
      await stat(eventsLogPath);
    } catch {
      // No events.jsonl file - skip this project
      return;
    }

    const watcher = chokidar.watch(eventsLogPath, {
      // Disable awaitWriteFinish for real-time streaming
      // Our incremental read approach handles partial lines safely
      awaitWriteFinish: false,
      ignoreInitial: false,
      persistent: true,
      // Use polling for more reliable detection of rapid writes
      usePolling: true,
      interval: 100,
    });

    // Set up event handlers BEFORE waiting for ready
    watcher.on("add", (filePath: string) => {
      this.processLogFile(project, filePath).catch((error) => {
        this.handleError(project.path, project.name, error as Error);
      });
    });

    watcher.on("change", (filePath: string) => {
      this.processLogFile(project, filePath).catch((error) => {
        this.handleError(project.path, project.name, error as Error);
      });
    });

    watcher.on("error", (error: Error) => {
      this.handleError(project.path, project.name, error);
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      watcher.on("ready", () => {
        resolve();
      });
    });

    this.watchers.set(project.path, watcher);
    this.watchedProjectFiles.set(project.path, { project, filePath: eventsLogPath });
    this.emit("project-added", project);

    console.log(`[live-log-stream] Watching project: ${project.name}`);
  }

  /**
   * Process a log file for new entries
   * Uses incremental reads to avoid loading entire file into memory
   * Handles file rotation by detecting file size reduction
   * Handles partial lines by buffering incomplete content
   */
  private async processLogFile(project: DiscoveredProject, filePath: string): Promise<void> {
    const fileKey = `${project.path}:${basename(filePath)}`;

    try {
      const stats = await stat(filePath);
      const lastSize = this.lastFileSizes.get(fileKey) ?? 0;

      // Detect file rotation (file was truncated or recreated)
      if (stats.size < lastSize) {
        this.filePositions.set(fileKey, 0);
        this.lineBuffers.delete(fileKey); // Clear incomplete line buffer
      }

      this.lastFileSizes.set(fileKey, stats.size);

      const lastPosition = this.filePositions.get(fileKey) ?? 0;

      // No new content
      if (stats.size <= lastPosition) {
        return;
      }

      // Calculate bytes to read
      const bytesToRead = stats.size - lastPosition;

      // Incremental read: only read new bytes instead of entire file
      const fileHandle = await open(filePath, "r");
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, lastPosition);

        // Update position based on actual bytes read
        this.filePositions.set(fileKey, lastPosition + bytesRead);

        // Convert buffer to string
        const newContent = buffer.toString("utf8", 0, bytesRead);

        // Prepend any buffered incomplete line from previous read
        const bufferedLine = this.lineBuffers.get(fileKey) ?? "";
        const fullContent = bufferedLine + newContent;

        // Split into lines - the last element might be incomplete if it doesn't end with \n
        const parts = fullContent.split("\n");

        // Check if content ends with newline (complete last line)
        const endsWithNewline = fullContent.endsWith("\n");

        // If doesn't end with newline, save the last part as incomplete
        if (!endsWithNewline && parts.length > 0) {
          this.lineBuffers.set(fileKey, parts.pop()!);
        } else {
          this.lineBuffers.delete(fileKey);
        }

        // Process complete lines
        for (const line of parts) {
          if (line.length === 0) continue;

          try {
            const entry = this.parseLogEntry(project, line);
            if (entry !== null) {
              // Only emit if not a duplicate (cache.add returns false for duplicates)
              const wasAdded = this.cache.add(entry);
              if (wasAdded) {
                // Fetch session context tokens before emitting
                // Use Claude's session UUID if available, otherwise fall back to session ID
                const sessionMapping = this.sessionToClaudeSessionMap.get(entry.sessionId);
                const claudeSessionId = sessionMapping?.claudeSessionId ?? entry.sessionId;
                const sessionTokens = await this.getSessionContextTokens(
                  claudeSessionId,
                  project.path
                );
                if (sessionTokens !== undefined) {
                  entry.sessionContextTokens = sessionTokens;
                }
                this.emit("log-entry", entry);
              }
            }
          } catch {
            // Skip malformed lines
            continue;
          }
        }
      } finally {
        await fileHandle.close();
      }

      // Reset error count on successful processing
      this.resetErrorCount(fileKey);
    } catch (error) {
      // File may have been deleted during processing
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Handle errors with consecutive error tracking
   * Stops watcher after 3 consecutive errors to prevent flooding
   */
  private handleError(projectPath: string, projectName: string, error: Error): void {
    const errorCount = (this.errorCounts.get(projectPath) ?? 0) + 1;
    this.errorCounts.set(projectPath, errorCount);

    this.emit("error", error, projectName);

    // Stop watcher after 3 consecutive errors
    if (errorCount >= LiveLogStream.MAX_CONSECUTIVE_ERRORS) {
      console.error(
        `[live-log-stream] Too many consecutive errors (${errorCount}) for project "${projectName}". Stopping watcher.`
      );

      const watcher = this.watchers.get(projectPath);
      if (watcher !== undefined) {
        watcher.close();
        this.watchers.delete(projectPath);
        this.filePositions.delete(projectPath);
        this.lastFileSizes.delete(projectPath);
        this.errorCounts.delete(projectPath);
        this.emit("project-removed", projectPath);
      }
    }
  }

  /**
   * Reset error count for a project (call on successful operation)
   */
  private resetErrorCount(projectPath: string): void {
    const currentCount = this.errorCounts.get(projectPath);
    if (currentCount !== undefined && currentCount > 0) {
      this.errorCounts.set(projectPath, 0);
    }
  }

  /**
   * Parse a single log entry line from events.jsonl
   * Converts new LogEvent format to LiveLogEntry for dashboard display
   */
  private parseLogEntry(project: DiscoveredProject, line: string): LiveLogEntry | null {
    try {
      const parsed = JSON.parse(line) as unknown;

      if (!isLogEvent(parsed)) {
        return null;
      }

      const event = parsed;
      const eventData = event as unknown as Record<string, unknown>;

      // Convert LogEvent to LiveLogEntry format for dashboard display
      // Generate message based on event type
      const message = this.generateEventMessage(event);

      // Extract agent/skill based on event type
      let agent: string | undefined;
      let skill: string | undefined;
      let mcpServer: string | undefined;
      let mcpTool: string | undefined;

      switch (event.type) {
      case "recommendation": {
        // Recommendation events use recommendationType to distinguish agent vs skill
        if (eventData.recommendationType === "agent") {
          agent = eventData.agent as string | undefined;
        } else if (eventData.recommendationType === "skill") {
          skill = eventData.skill as string | undefined;
        }
        break;
      }
      case "agent_invocation":
      case "agent_start": {
        agent = (eventData.agent ?? eventData.agentType) as string | undefined;
        break;
      }
      case "skill_invocation": {
        // skill_invocation events use skillName field
        skill = (eventData.skillName ?? eventData.skill) as string | undefined;
        break;
      }
      case "mcp_tool_call": {
        mcpServer = eventData.mcpServer as string | undefined;
        mcpTool = eventData.mcpTool as string | undefined;
        break;
      }
      case "follow_through": {
        // follow_through has invokedType and invokedName
        if (eventData.invokedType === "agent") {
          agent = eventData.invokedName as string | undefined;
        } else if (eventData.invokedType === "skill") {
          skill = eventData.invokedName as string | undefined;
        }
        break;
      }
      case "agent_end": {
        agent = eventData.agentType as string | undefined;
        break;
      }
      case "agent_completion": {
        // Hook writes agent_completion with "agent" field (not "agentType")
        agent = (eventData.agent ?? eventData.agentType) as string | undefined;
        break;
      }
      }

      // For session_start events, capture claudeSessionId for token lookup correlation
      if (event.type === "session_start") {
        const claudeSessionId = eventData.claudeSessionId as string | undefined;
        if (claudeSessionId) {
          // Map our session ID to Claude's UUID for token lookup (with creation time for cleanup)
          this.sessionToClaudeSessionMap.set(event.session, {
            claudeSessionId,
            createdAt: Date.now(),
          });
        }
      }

      // Derive session number from session ID
      // Format can be UUID or timestamp-pid like "1768190452-1740129"
      const sessionNumber = this.getSessionNumber(project.name, event.session);

      // Map event type to standard log entry type
      // Returns null for session_start, session_end, and unknown event types
      const mappedType = this.mapEventTypeToStandardType(event.type);
      if (mappedType === null) {
        return null; // Skip events that shouldn't be displayed in the feed
      }

      // Extract recommendationId for correlation:
      // - For "recommendation" events, the ID is in event data as "id"
      // - For "follow_through" events, the ID is in event data as "recommendationId"
      const recommendationId = (
        event.type === "recommendation"
          ? eventData.id
          : (event.type === "follow_through"
            ? eventData.recommendationId
            : undefined)
      ) as string | undefined;

      return {
        // StandardLogEntry fields
        timestamp: event.ts,
        projectName: project.name,
        projectPath: project.path,
        sessionId: event.session,
        sessionNumber,
        type: mappedType,
        message,
        agent,
        skill,
        agentContext: eventData.agentContext as string | undefined,
        mcpServer,
        mcpTool,
        recommendationId,
        // LiveLogEntry additional fields
        project: project.name,
        decision: message,
        confidence: eventData.confidence as number | undefined,
        followed: eventData.followed as boolean | undefined,
        // Agent completion fields
        // Hook writes "agent" field, agent_end events use "agentType"
        agentType: (eventData.agentType ?? eventData.agent) as string | undefined,
        status: eventData.status as string | undefined,
        totalTokens: eventData.totalTokens as number | undefined,
        totalDurationMs: eventData.totalDurationMs as number | undefined,
        totalToolUseCount: eventData.totalToolUseCount as number | undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Track session numbers per project
   */
  private sessionNumberMap = new Map<string, Map<string, number>>();

  /**
   * Get or assign a session number for a session ID within a project
   */
  private getSessionNumber(projectName: string, sessionId: string): number {
    if (!this.sessionNumberMap.has(projectName)) {
      this.sessionNumberMap.set(projectName, new Map());
    }
    const projectSessions = this.sessionNumberMap.get(projectName)!;

    if (!projectSessions.has(sessionId)) {
      projectSessions.set(sessionId, projectSessions.size + 1);
    }
    return projectSessions.get(sessionId)!;
  }

  /**
   * Map LogEvent type to StandardLogEntry type
   * Returns null for event types that should not be displayed in the log feed
   */
  private mapEventTypeToStandardType(
    eventType: string,
  ): StandardLogEntry["type"] | null {
    // Skip recommendation and follow_through events - these are deprecated
    if (eventType === "recommendation" || eventType === "follow_through") {
      return null;
    }

    const typeMap: Record<string, StandardLogEntry["type"]> = {
      "agent_invocation": "agent_invocation",
      "skill_invocation": "skill_invocation",
      "mcp_tool_call": "mcp_tool_call",
      "agent_start": "agent_invocation",
      "agent_end": "agent_completion",
      "agent_completion": "agent_completion", // Hook writes this directly
      "workflow_stage": "workflow_stage",
      "workflow_trigger": "workflow_trigger",
      "workflow_complete": "workflow_complete",
      "workflow_resumed": "workflow_resumed",
    };

    // Return null for session lifecycle events (don't display in feed)
    // Also return null for unknown event types to avoid false "invoked" entries
    if (eventType === "session_start" || eventType === "session_end") {
      return null;
    }

    return typeMap[eventType] ?? null;
  }

  /**
   * Generate human-readable message from event
   */
  private generateEventMessage(event: LogEvent): string {
    const eventData = event as unknown as Record<string, unknown>;

    switch (event.type) {
    case "session_start": {
      return `Session started for ${eventData.projectName as string}`;
    }
    case "session_end": {
      return `Session ended (${eventData.endReason as string || "unknown"})`;
    }
    case "recommendation": {
      if (eventData.agent) {
        return `Recommended agent: ${eventData.agent as string}`;
      }
      if (eventData.skills) {
        return `Recommended skills: ${(eventData.skills as string[]).join(", ")}`;
      }
      return "Routing recommendation made";
    }
    case "follow_through": {
      if (eventData.followed) {
        return `Followed recommendation: ${eventData.invokedName as string || "unknown"}`;
      }
      return `Ignored recommendation (expired: ${(eventData.expired as boolean | undefined) ?? false})`;
    }
    case "agent_invocation": {
      return `Agent spawned: ${eventData.agent as string}`;
    }
    case "skill_invocation": {
      return `Skill invoked: ${eventData.skill as string}`;
    }
    case "mcp_tool_call": {
      return `MCP tool: ${eventData.mcpServer as string}/${eventData.mcpTool as string}`;
    }
    case "agent_start": {
      return `Agent started: ${eventData.agentType as string} (PID: ${eventData.agentPid as number})`;
    }
    case "agent_end": {
      return `Agent completed (PID: ${eventData.agentPid as number})`;
    }
    case "compliance": {
      return `Compliance: ${eventData.decision as string} - ${eventData.reason as string}`;
    }
    case "tokens": {
      return `Tokens used: ${eventData.input as number} input, ${eventData.output as number} output`;
    }
    case "workflow_stage": {
      const action = eventData.action as string;
      const stage = eventData.stage as string;
      const agentType = eventData.agentType as string | undefined;
      if (agentType) {
        return `Workflow ${stage}: ${agentType} ${action}`;
      }
      return `Workflow ${stage}: stage ${action}`;
    }
    case "workflow_trigger": {
      return `Pipeline: ${eventData.completedAgent as string} → ${eventData.nextAgent as string} (task-${eventData.taskId as number})`;
    }
    case "workflow_complete": {
      return `Workflow complete: task-${eventData.taskId as number}`;
    }
    case "workflow_resumed": {
      const staleInfo = (eventData.staleAgentCount as number) > 0 ? ` (${eventData.staleAgentCount as number} stale agents)` : "";
      return `Workflow resumed: "${eventData.workflowName as string}" from phase ${eventData.currentPhase as string}${staleInfo}`;
    }
    default: {
      return `Event: ${String(event.type)}`;
    }
    }
  }

  /**
   * Get context token usage for a session
   * Reads from the session's JSONL file and caches the result
   *
   * Session files are stored at: ~/.claude/projects/<encoded-path>/<session-id>.jsonl
   *
   * @param sessionId - Session UUID
   * @param projectPath - Project path for encoding
   * @returns Token count or undefined if not available
   */
  async getSessionContextTokens(sessionId: string, projectPath: string): Promise<number | undefined> {
    // Check cache first
    const cached = this.sessionTokenCache.get(sessionId);
    const now = Date.now();

    if (cached !== undefined && (now - cached.cachedAt) < LiveLogStream.SESSION_TOKEN_CACHE_TTL_MS) {
      return cached.tokens;
    }

    try {
      // Convert container path to host path for Claude session lookup
      // Docker mounts projects at /app/projects but Claude encodes sessions using host paths
      const hostPath = this.projectScanner.containerPathToHostPath(projectPath);
      // Encode project path: replace / with - (Claude's format is just path with / -> -)
      // /home/fullstacktard/... becomes -home-fullstacktard-...
      const encodedPath = hostPath.replaceAll("/", "-");
      const claudeDir = join(homedir(), ".claude", "projects", encodedPath);
      const sessionFile = join(claudeDir, `${sessionId}.jsonl`);

      // Use streaming to avoid loading entire file into memory (sessions can be several MB)
      // Track the LAST (most recent) context token count, not cumulative sum
      // Context tokens = input_tokens (what Claude received) which represents current context window usage
      let lastContextTokens: number | undefined;

      const fileStream = createReadStream(sessionFile, { encoding: "utf8" });
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity, // Handle both \n and \r\n
      });

      // Process line by line without loading entire file
      for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;

          // Claude session files have usage nested in message.usage for type: "assistant"
          if (parsed.type === "assistant" && typeof parsed.message === "object" && parsed.message !== null) {
            const message = parsed.message as Record<string, unknown>;
            if (typeof message.usage === "object" && message.usage !== null) {
              const usage = message.usage as Record<string, unknown>;
              // Context = input_tokens + cache_read_input_tokens (what was sent to Claude)
              // This represents the current context window usage
              let contextTokens = 0;
              if (typeof usage.input_tokens === "number") {
                contextTokens += usage.input_tokens;
              }
              if (typeof usage.cache_read_input_tokens === "number") {
                contextTokens += usage.cache_read_input_tokens;
              }
              if (contextTokens > 0) {
                lastContextTokens = contextTokens;
              }
            }
          }
          // Fallback: check direct usage property (for other log formats)
          else if (typeof parsed.usage === "object" && parsed.usage !== null) {
            const usage = parsed.usage as Record<string, unknown>;
            let contextTokens = 0;
            if (typeof usage.input_tokens === "number") {
              contextTokens += usage.input_tokens;
            }
            if (typeof usage.cache_read_input_tokens === "number") {
              contextTokens += usage.cache_read_input_tokens;
            }
            if (contextTokens > 0) {
              lastContextTokens = contextTokens;
            }
          }
          // Fallback: direct token properties
          else if (typeof parsed.tokens === "number") {
            lastContextTokens = parsed.tokens;
          } else if (typeof parsed.totalTokens === "number") {
            lastContextTokens = parsed.totalTokens;
          }
        } catch {
          // Not valid JSON, skip
        }
      }

      // Cache the result
      this.sessionTokenCache.set(sessionId, { tokens: lastContextTokens ?? 0, cachedAt: now });
      return lastContextTokens;
    } catch {
      // File doesn't exist or can't be read - return undefined
      return undefined;
    }
  }

  /**
   * Periodic cleanup to prevent memory leaks from accumulated session data
   *
   * Cleans up:
   * - Stale sessionTokenCache entries (older than TTL)
   * - Old sessionToClaudeSessionMap entries (sessions no longer active)
   * - sessionNumberMap for projects no longer being watched
   */
  private performCleanup(): void {
    const now = Date.now();
    let cleanedTokens = 0;
    let cleanedSessions = 0;
    let cleanedProjects = 0;

    // 1. Clean stale sessionTokenCache entries (use longer TTL for cleanup - 1 hour)
    for (const [sessionId, cached] of this.sessionTokenCache) {
      if (now - cached.cachedAt > LiveLogStream.SESSION_MAX_AGE_MS) {
        this.sessionTokenCache.delete(sessionId);
        cleanedTokens++;
      }
    }

    // 2. Clean old sessionToClaudeSessionMap entries
    // Sessions that haven't been seen recently are likely completed
    // Use the createdAt timestamp stored when the mapping was created
    for (const [sessionId, mapping] of this.sessionToClaudeSessionMap) {
      if (now - mapping.createdAt > LiveLogStream.SESSION_MAX_AGE_MS) {
        this.sessionToClaudeSessionMap.delete(sessionId);
        cleanedSessions++;
      }
    }

    // 3. Clean sessionNumberMap for projects no longer being watched
    const activeProjects = new Set(this.watchers.keys());
    for (const projectName of this.sessionNumberMap.keys()) {
      // Convert project name back to path format to check against watchers
      // Note: This is a heuristic - project names may not exactly match paths
      let isActive = false;
      for (const watcherPath of activeProjects) {
        if (watcherPath.includes(projectName) || projectName.includes(watcherPath)) {
          isActive = true;
          break;
        }
      }
      if (!isActive) {
        this.sessionNumberMap.delete(projectName);
        cleanedProjects++;
      }
    }

    if (cleanedTokens > 0 || cleanedSessions > 0 || cleanedProjects > 0) {
      console.log(
        `[live-log-stream] Cleanup: removed ${cleanedTokens} token cache entries, ` +
        `${cleanedSessions} session mappings, ${cleanedProjects} project session maps`
      );
    }
  }
}

// ============================================================================
// WebSocket Integration Helper
// ============================================================================

/**
 * Connect live log stream to WebSocket server for broadcasting
 *
 * @param liveStream - LiveLogStream instance
 * @param broadcastFn - Function to broadcast messages to WebSocket clients
 *
 * @example
 * ```typescript
 * connectToWebSocket(liveStream, (sessionId, type, payload) => {
 *   // Broadcast to all clients subscribed to this project
 *   webSocketServer.broadcast(sessionId, type, payload);
 * });
 * ```
 */
export function connectToWebSocket(
  liveStream: LiveLogStream,
  broadcastFn: (sessionId: string, type: string, payload: unknown) => void
): void {
  liveStream.on("log-entry", (entry) => {
    // Broadcast to all clients subscribed to project
    // Using project name as a pseudo-session for cross-project monitoring
    broadcastFn(`project-${entry.project}`, "log", {
      data: entry,
      eventType: "routing-decision",
    });
  });
}