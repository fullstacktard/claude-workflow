/**
 * Agent Completion Stream Service
 *
 * Watches Claude Code session logs (~/.claude/projects/) for agent/Task completions
 * and extracts token usage, duration, and tool count metrics.
 *
 * Session logs are stored at: ~/.claude/projects/{encoded-project-path}/{session-uuid}.jsonl
 * Each line contains either an assistant message or a user message with toolUseResult.
 *
 * When a Task tool completes, the JSONL entry contains a toolUseResult object with:
 * - totalTokens: Total tokens used by the agent
 * - totalDurationMs: Execution time in milliseconds
 * - totalToolUseCount: Number of tool calls made
 * - usage: Detailed breakdown (input_tokens, output_tokens, cache_*)
 * - agentId: Unique agent identifier
 *
 * @module agent-completion-stream
 */

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import chokidar, { type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ============================================================================
// Constants
// ============================================================================

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const DEFAULT_DEBOUNCE_DELAY_MS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run cleanup every 5 minutes
const MAX_PENDING_TASK_CALLS = 500; // Cap orphaned pending task calls
const MAX_TRACKED_FILES = 500; // Cap filePositions/lastFileSizes to prevent unbounded growth

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Token usage breakdown from Claude API
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  service_tier?: string;
}

/**
 * Tool use result from Claude session log
 * Contains metrics for completed Task (agent) executions
 */
export interface ToolUseResult {
  status: string;
  prompt?: string;
  agentId?: string;
  content?: Array<{ type: string; text: string }>;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  usage?: TokenUsage;
}

/**
 * Agent completion event with full metrics
 */
export interface AgentCompletionEvent {
  /** Timestamp of completion */
  timestamp: string;
  /** Session ID (from JSONL filename) */
  sessionId: string;
  /** Project path (decoded from directory name) */
  projectPath: string;
  /** Project name (basename of project path) */
  projectName: string;
  /** Agent ID assigned by Claude Code */
  agentId?: string;
  /** Agent type (extracted from tool_input if available) */
  agentType?: string;
  /** Completion status */
  status: string;
  /** Total tokens used */
  totalTokens?: number;
  /** Execution duration in milliseconds */
  totalDurationMs?: number;
  /** Number of tool calls made */
  totalToolUseCount?: number;
  /** Detailed token usage breakdown */
  usage?: TokenUsage;
}

/**
 * Configuration options for AgentCompletionStream
 */
export interface AgentCompletionStreamOptions {
  /** Debounce delay for file changes in ms (default: 100) */
  debounceDelay?: number;
  /** Encoded directory names under ~/.claude/projects/ to watch (e.g., "-home-user-project").
   *  These are the actual directory names on disk. Pass empty to watch all (fallback). */
  watchDirs?: string[];
}

/**
 * Events emitted by AgentCompletionStream
 */
export interface AgentCompletionStreamEvents {
  "agent-completion": (event: AgentCompletionEvent) => void;
  error: (error: Error, context: string) => void;
  "project-watching": (projectPath: string) => void;
}

/**
 * Type-safe event emitter declaration
 */
export declare interface AgentCompletionStream {
  emit<K extends keyof AgentCompletionStreamEvents>(
    event: K,
    ...args: Parameters<AgentCompletionStreamEvents[K]>
  ): boolean;
  on<K extends keyof AgentCompletionStreamEvents>(
    event: K,
    listener: AgentCompletionStreamEvents[K]
  ): this;
  off<K extends keyof AgentCompletionStreamEvents>(
    event: K,
    listener: AgentCompletionStreamEvents[K]
  ): this;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decode Claude's encoded project path
 * ~/.claude/projects/-home-user-project becomes /home/user/project
 */
function decodeProjectPath(encodedDir: string): string {
  // Replace leading dash and all dashes with /
  // e.g., "-home-user-project" -> "/home/user/project"
  return encodedDir.replace(/^-/, "/").replaceAll("-", "/");
}

/**
 * Check if a JSONL entry contains a Task tool completion
 */
function isTaskToolCompletion(entry: Record<string, unknown>): boolean {
  // Must have toolUseResult with status
  if (typeof entry.toolUseResult !== "object" || entry.toolUseResult === null) {
    return false;
  }

  const result = entry.toolUseResult as Record<string, unknown>;

  // Skip async_launched - this is just the background task being started, not completed
  // The actual completion comes later with status "completed" and metrics
  if (result.status === "async_launched") {
    return false;
  }

  // Check for Task tool markers: agentId or totalTokens (both indicate agent completion)
  return (
    typeof result.status === "string" &&
    (typeof result.agentId === "string" || typeof result.totalTokens === "number")
  );
}

/**
 * Task tool input structure for extracting agent type
 */
interface TaskToolInput {
  subagent_type?: string;
  description?: string;
  prompt?: string;
}

/**
 * Tool use content block from assistant message
 */
interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: TaskToolInput;
}

/**
 * Tool result content block from user message
 */
interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content?: string;
  is_error?: boolean;
}

/**
 * Check if entry is an assistant message with Task tool calls
 * Returns array of { id, subagent_type } for each Task call
 */
function extractTaskToolCalls(entry: Record<string, unknown>): Array<{ id: string; subagentType: string }> {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "assistant") {
    return [];
  }

  const content = message.content as unknown[] | undefined;
  if (!Array.isArray(content)) {
    return [];
  }

  const taskCalls: Array<{ id: string; subagentType: string }> = [];

  for (const block of content) {
    const toolUse = block as ToolUseContent;
    if (
      toolUse.type === "tool_use" &&
      toolUse.name === "Task" &&
      typeof toolUse.id === "string" &&
      typeof toolUse.input?.subagent_type === "string"
    ) {
      taskCalls.push({
        id: toolUse.id,
        subagentType: toolUse.input.subagent_type,
      });
    }
  }

  return taskCalls;
}

/**
 * Extract tool_use_id from a tool result user message
 */
function extractToolUseId(entry: Record<string, unknown>): string | undefined {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "user") {
    return undefined;
  }

  const content = message.content as unknown[] | undefined;
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }

  // Tool result is typically the first content block
  const toolResult = content[0] as ToolResultContent;
  if (toolResult.type === "tool_result" && typeof toolResult.tool_use_id === "string") {
    return toolResult.tool_use_id;
  }

  return undefined;
}

// ============================================================================
// Agent Completion Stream Class
// ============================================================================

/**
 * Watches Claude Code session logs for agent completions
 *
 * @example
 * ```typescript
 * const stream = new AgentCompletionStream();
 *
 * stream.on('agent-completion', (event) => {
 *   console.log(`Agent ${event.agentId} completed in ${event.totalDurationMs}ms`);
 *   console.log(`Tokens: ${event.totalTokens}, Tools: ${event.totalToolUseCount}`);
 * });
 *
 * await stream.start();
 * ```
 */
export class AgentCompletionStream extends EventEmitter {
  private readonly options: Required<AgentCompletionStreamOptions>;
  private watcher: FSWatcher | null = null;
  private isRunning = false;

  /** Map of file path to last processed byte position */
  private filePositions: Map<string, number> = new Map();
  /** Map of file path to last known file size (for rotation detection) */
  private lastFileSizes: Map<string, number> = new Map();
  /** Map of file path to incomplete line buffer (for handling partial writes) */
  private lineBuffers: Map<string, string> = new Map();
  /** Cache of recent agent completions for initial WebSocket send */
  private recentCompletions: AgentCompletionEvent[] = [];
  /** Maximum completions to cache */
  private readonly maxCachedCompletions: number;
  /** Map of tool_use_id to subagent_type for correlation */
  private pendingTaskCalls: Map<string, string> = new Map();
  /** Periodic cleanup timer */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentCompletionStreamOptions = {}) {
    super();
    this.options = {
      debounceDelay: options.debounceDelay ?? DEFAULT_DEBOUNCE_DELAY_MS,
      watchDirs: options.watchDirs ?? [],
    };
    this.maxCachedCompletions = 100; // Cache up to 100 recent completions
  }

  /**
   * Start watching for agent completions
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      // Check if Claude projects directory exists
      await stat(CLAUDE_PROJECTS_DIR);
    } catch {
      console.warn(`[agent-completion-stream] Claude projects directory not found: ${CLAUDE_PROJECTS_DIR}`);
      return;
    }

    this.isRunning = true;

    // IMPORTANT: Process historical data FIRST, before starting the watcher
    // This ensures we capture recent completions that happened before dashboard restart
    // and properly sets up file positions before the watcher starts tracking
    console.log("[agent-completion-stream] Starting up...");
    await this.processRecentHistory();

    // Watch only registered project subdirectories instead of entire ~/.claude/projects/
    // This reduces watched files from ~35,000 to ~50-200, fixing 5-7GB memory / 100% CPU
    const watchPaths = this.options.watchDirs.length > 0
      ? this.options.watchDirs.map(d => join(CLAUDE_PROJECTS_DIR, d))
      : [CLAUDE_PROJECTS_DIR]; // fallback: watch all (shouldn't happen)

    console.log(`[agent-completion-stream] Watching ${watchPaths.length} project dirs (was: entire ~/.claude/projects/)`);

    this.watcher = chokidar.watch(watchPaths, {
      // CRITICAL: awaitWriteFinish can cause issues with large directories
      awaitWriteFinish: false,
      // ignoreInitial: true since we already processed historical data
      ignoreInitial: true,
      persistent: true,
      // Depth 3 to catch:
      // - project-dir/*.jsonl (main sessions)
      // - project-dir/session-uuid/subagents/*.jsonl (agent sessions)
      depth: 3,
      // CRITICAL: Use polling for Docker volume mounts
      usePolling: true,
      interval: 5000, // Poll every 5 seconds (was 1s — reduced CPU load)
      binaryInterval: 5000,
    });

    this.watcher.on("add", (filePath: string) => {
      // Only track .jsonl files
      if (!filePath.endsWith(".jsonl")) return;

      console.log(`[agent-completion-stream] New file detected: ${filePath}`);
      // New file created after watcher started - process it from beginning
      this.filePositions.set(filePath, 0);
      this.lastFileSizes.set(filePath, 0);
      this.handleFileChange(filePath).catch((error) => {
        this.emit("error", error as Error, `add: ${filePath}`);
      });
    });

    this.watcher.on("change", (filePath: string) => {
      // Only process .jsonl files
      if (!filePath.endsWith(".jsonl")) return;

      this.handleFileChange(filePath).catch((error) => {
        this.emit("error", error as Error, `change: ${filePath}`);
      });
    });

    this.watcher.on("error", (error: Error) => {
      this.emit("error", error, "watcher");
    });

    // Don't await "ready" - with polling + many files it takes forever
    // The watcher is functional as soon as events are attached
    this.watcher.on("ready", () => {
      const watched = this.watcher!.getWatched();
      const pathCount = Object.keys(watched).length;
      const fileCount = Object.values(watched).flat().length;
      console.log(`[agent-completion-stream] Watcher ready: ${pathCount} directories, ${fileCount} files`);
    });

    // Start periodic cleanup to prevent memory leaks from orphaned entries
    this.cleanupTimer = setInterval(() => { void this.performCleanup(); }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();

    console.log(`[agent-completion-stream] Started watching ${watchPaths.length} project paths`);
  }

  /**
   * Process recent historical data from existing JSONL files
   * This ensures we have data even after dashboard restart
   */
  private async processRecentHistory(): Promise<void> {
    console.log(`[agent-completion-stream] Processing recent historical data from ${CLAUDE_PROJECTS_DIR}...`);

    try {
      // Only scan registered project directories (not all 1,500+ dirs)
      const projectDirs = this.options.watchDirs.length > 0
        ? this.options.watchDirs
        : (await readdir(CLAUDE_PROJECTS_DIR)).filter(d => d.startsWith("-"));

      console.log(`[agent-completion-stream] Scanning ${projectDirs.length} project directories`);
      const cutoffTime = Date.now() - 2 * 60 * 60 * 1000; // Last 2 hours (was 24h)

      let processedCount = 0;
      for (const projectDir of projectDirs) {
        const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
        const projectStats = await stat(projectPath).catch(() => null);
        if (!projectStats?.isDirectory()) continue;

        console.log(`[agent-completion-stream] Processing project: ${projectDir.slice(0, 50)}...`);

        // Process files recursively to catch:
        // - projectDir/*.jsonl (main session logs)
        // - projectDir/{session-uuid}/subagents/*.jsonl (agent logs)
        await this.processDirectoryRecursive(projectPath, cutoffTime, 0);
        processedCount++;
      }

      console.log(`[agent-completion-stream] Processed ${processedCount} projects. Cached ${this.recentCompletions.length} completions`);
    } catch (error) {
      console.error("[agent-completion-stream] Error processing historical data:", error);
    }
  }

  /**
   * Recursively process a directory for JSONL files
   */
  private async processDirectoryRecursive(dirPath: string, cutoffTime: number, depth: number): Promise<void> {
    // Limit recursion depth to match watcher depth
    if (depth > 3) return;

    const entries = await readdir(dirPath).catch(() => []);

    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const entryStats = await stat(entryPath).catch(() => null);
      if (!entryStats) continue;

      if (entryStats.isDirectory()) {
        // Recurse into subdirectories
        await this.processDirectoryRecursive(entryPath, cutoffTime, depth + 1);
      } else if (entry.endsWith(".jsonl") && entryStats.mtimeMs >= cutoffTime) {
        // Process JSONL files modified recently
        // Process the entire file (set position to 0)
        this.filePositions.set(entryPath, 0);
        this.lastFileSizes.set(entryPath, 0);

        await this.handleFileChange(entryPath).catch((error) => {
          console.error(`[agent-completion-stream] Error processing historical file ${entryPath}:`, error);
        });

        // After processing, update the position to current file size
        // so the watcher doesn't reprocess this content
        const currentStats = await stat(entryPath).catch(() => null);
        if (currentStats) {
          this.filePositions.set(entryPath, currentStats.size);
          this.lastFileSizes.set(entryPath, currentStats.size);
        }
      }
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.filePositions.clear();
    this.lastFileSizes.clear();
    this.lineBuffers.clear();
    this.pendingTaskCalls.clear();
    this.recentCompletions = [];

    console.log("[agent-completion-stream] Stopped");
  }

  /**
   * Get recent agent completions from cache
   *
   * @param limit - Maximum number of completions to return
   * @returns Array of recent agent completion events
   */
  getRecentCompletions(limit?: number): AgentCompletionEvent[] {
    if (limit === undefined) {
      return [...this.recentCompletions];
    }
    return this.recentCompletions.slice(-limit);
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(filePath: string): Promise<void> {
    const fileName = basename(filePath);

    // Only process UUID-named JSONL files (session logs)
    if (!UUID_PATTERN.test(fileName)) {
      return;
    }

    // Extract project info from path
    const pathParts = filePath.split("/");
    const projectsIndex = pathParts.indexOf("projects");
    if (projectsIndex === -1 || projectsIndex + 1 >= pathParts.length) {
      return;
    }

    const encodedProjectDir = pathParts[projectsIndex + 1];
    const projectPath = decodeProjectPath(encodedProjectDir);
    const projectName = basename(projectPath);
    const sessionId = fileName.replace(".jsonl", "");

    // Filter by watchDirs if configured (compare encoded dir names to avoid lossy decode issues)
    if (this.options.watchDirs.length > 0) {
      if (!this.options.watchDirs.includes(encodedProjectDir)) {
        return;
      }
    }

    try {
      const stats = await stat(filePath);
      const lastSize = this.lastFileSizes.get(filePath) ?? 0;

      // Detect file rotation (file was truncated or recreated)
      if (stats.size < lastSize) {
        this.filePositions.set(filePath, 0);
      }

      this.lastFileSizes.set(filePath, stats.size);

      const lastPosition = this.filePositions.get(filePath) ?? 0;

      // No new content
      if (stats.size <= lastPosition) {
        return;
      }

      // Calculate bytes to read (only new content, not entire file)
      const bytesToRead = stats.size - lastPosition;

      // Incremental read: only read new bytes instead of entire file
      // This prevents memory explosion with large session files
      const fileHandle = await open(filePath, "r");
      let newContent: string;
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, lastPosition);
        newContent = buffer.toString("utf8", 0, bytesRead);
        this.filePositions.set(filePath, lastPosition + bytesRead);
      } finally {
        await fileHandle.close();
      }

      // Prepend any buffered incomplete line from previous read
      const bufferedLine = this.lineBuffers.get(filePath) ?? "";
      const fullContent = bufferedLine + newContent;

      // Split into lines - the last element might be incomplete if it doesn't end with \n
      const parts = fullContent.split("\n");

      // Check if content ends with newline (complete last line)
      const endsWithNewline = fullContent.endsWith("\n");

      // If doesn't end with newline, save the last part as incomplete
      if (!endsWithNewline && parts.length > 0) {
        this.lineBuffers.set(filePath, parts.pop()!);
      } else {
        this.lineBuffers.delete(filePath);
      }

      // Process complete lines
      const lines = parts.filter((line) => line.length > 0);
      // Only log if there are lines to process (avoid noise for empty changes)
      if (lines.length > 0 && lines.length < 1000) {
        console.log(`[agent-completion-stream] Processing ${lines.length} lines from ${basename(filePath)}`);
      } else if (lines.length >= 1000) {
        console.log(`[agent-completion-stream] Processing ${lines.length} lines from ${basename(filePath)} (large file)`);
      }

      let taskCompletionsFound = 0;
      let taskCallsFound = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          // Track Task tool calls from assistant messages
          // These contain the subagent_type which we need for the tool result
          const taskCalls = extractTaskToolCalls(entry);
          for (const call of taskCalls) {
            taskCallsFound++;
            console.log(`[agent-completion-stream] Tracking Task call: id=${call.id}, type=${call.subagentType}`);
            this.pendingTaskCalls.set(call.id, call.subagentType);
          }

          if (isTaskToolCompletion(entry)) {
            taskCompletionsFound++;
            console.log("[agent-completion-stream] Found Task completion entry");
            const toolUseResult = entry.toolUseResult as ToolUseResult;
            const timestamp = (entry.timestamp as string) ?? new Date().toISOString();

            // Extract tool_use_id to look up the agent type
            const toolUseId = extractToolUseId(entry);
            const agentType = toolUseId ? this.pendingTaskCalls.get(toolUseId) : undefined;
            console.log(`[agent-completion-stream] toolUseId=${toolUseId}, agentType=${agentType}, pendingCalls=${this.pendingTaskCalls.size}`);

            // Clean up the pending call to avoid memory leak
            if (toolUseId) {
              this.pendingTaskCalls.delete(toolUseId);
            }

            const event: AgentCompletionEvent = {
              timestamp,
              sessionId,
              projectPath,
              projectName,
              agentId: toolUseResult.agentId,
              agentType,
              status: toolUseResult.status,
              totalTokens: toolUseResult.totalTokens,
              totalDurationMs: toolUseResult.totalDurationMs,
              totalToolUseCount: toolUseResult.totalToolUseCount,
              usage: toolUseResult.usage,
            };

            console.log(`[agent-completion-stream] Emitting agent-completion: agentType=${agentType}, tokens=${toolUseResult.totalTokens}, duration=${toolUseResult.totalDurationMs}ms`);
            this.emit("agent-completion", event);

            // Add to recent completions cache
            this.recentCompletions.push(event);
            if (this.recentCompletions.length > this.maxCachedCompletions) {
              this.recentCompletions.shift();
            }
          }
        } catch {
          // Skip malformed lines
          continue;
        }
      }

      // Summary log for debugging
      if (taskCallsFound > 0 || taskCompletionsFound > 0) {
        console.log(`[agent-completion-stream] SUMMARY for ${basename(filePath)}: ${taskCallsFound} Task calls, ${taskCompletionsFound} completions found`);
      }
    } catch (error) {
      // File may have been deleted during processing
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Get all watched project directories
   */
  async getWatchedProjects(): Promise<string[]> {
    try {
      const entries = await readdir(CLAUDE_PROJECTS_DIR);
      return entries
        .filter((e) => e.startsWith("-"))
        .map((e) => decodeProjectPath(e));
    } catch {
      return [];
    }
  }

  /**
   * Periodic cleanup to prevent memory leaks from:
   * - Orphaned pendingTaskCalls (session crashed before tool result)
   * - filePositions/lastFileSizes/lineBuffers for deleted files
   */
  private async performCleanup(): Promise<void> {
    let cleanedPending = 0;
    let cleanedFiles = 0;

    // 1. Cap pendingTaskCalls to prevent unbounded growth from orphaned entries
    if (this.pendingTaskCalls.size > MAX_PENDING_TASK_CALLS) {
      // Remove oldest entries (Map maintains insertion order)
      const excess = this.pendingTaskCalls.size - MAX_PENDING_TASK_CALLS;
      const iterator = this.pendingTaskCalls.keys();
      for (let i = 0; i < excess; i++) {
        const key = iterator.next().value;
        if (key !== undefined) {
          this.pendingTaskCalls.delete(key);
          cleanedPending++;
        }
      }
    }

    // 2. Clean file tracking entries for files that no longer exist
    // Only check a subset each cycle to avoid excessive I/O
    const filePaths = [...this.filePositions.keys()];
    for (const filePath of filePaths) {
      try {
        await stat(filePath);
      } catch {
        // File no longer exists - clean up tracking
        this.filePositions.delete(filePath);
        this.lastFileSizes.delete(filePath);
        this.lineBuffers.delete(filePath);
        cleanedFiles++;
      }
    }

    // 3. Cap filePositions/lastFileSizes if they exceed max to prevent unbounded growth
    let cleanedCapped = 0;
    if (this.filePositions.size > MAX_TRACKED_FILES) {
      const entries = [...this.filePositions.entries()];
      const toRemove = entries.slice(0, entries.length - MAX_TRACKED_FILES);
      for (const [key] of toRemove) {
        this.filePositions.delete(key);
        this.lastFileSizes.delete(key);
        this.lineBuffers.delete(key);
        cleanedCapped++;
      }
    }

    if (cleanedPending > 0 || cleanedFiles > 0 || cleanedCapped > 0) {
      console.log(
        `[agent-completion-stream] Cleanup: removed ${cleanedPending} orphaned task calls, ` +
        `${cleanedFiles} stale file entries, ${cleanedCapped} capped entries. ` +
        `Tracking ${this.filePositions.size} files, ${this.pendingTaskCalls.size} pending calls`
      );
    }
  }
}
