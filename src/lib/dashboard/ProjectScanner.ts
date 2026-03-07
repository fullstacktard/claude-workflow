 
/**
 * ProjectScanner - Discovers and monitors claude-workflow projects
 * @module dashboard/ProjectScanner
 *
 * Scans filesystem for Claude Code projects using the central registry,
 * validates project directories, and aggregates statistics for the
 * web dashboard.
 */

import { exec } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ProjectRegistryEntry } from "../registry/types.js";

import { ProjectRegistryManager } from "../registry/manager.js";
import {
  getActiveClaudeProcesses,
  mapProcessesToProjects,
  type SessionCounts,
} from "./services/claude-process-detector.js";

/**
 * Complete project information with enriched data
 */
export interface ProjectInfo {
  /** Number of active/recent sessions */
  activeSessions: number;
  /** Timestamp of last project usage */
  lastUsed: Date;
  /** Project name (basename of path) */
  name: string;
  /** Absolute path to project directory */
  path: string;
  /** Parsed Claude settings for this project */
  settings: JsonObject;
  /** Token usage metrics by time period */
  tokenUsage: {
    day: number;
    month: number;
    week: number;
  };
}

/**
 * Statistics for a single project
 */
export interface ProjectStats {
  /** Timestamp of most recent session */
  lastUsed: Date;
  /** Total number of session directories found */
  sessionCount: number;
  /** Token usage aggregated by time period */
  tokenUsage: {
    day: number;
    month: number;
    week: number;
  };
}

/**
 * Internal cache structure with timestamp
 */
interface CachedData {
  cachedAt: number;
  projects: ProjectInfo[];
}
/**
 * Log entry formats for token counting
 */
interface ClaudeCodeLogEntry {
  [key: string]: JsonValue;
  tokens: number;
}

interface JsonArray extends ReadonlyArray<JsonValue> {
  [index: number]: JsonValue;
}

interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * JSON value types
 */
type JsonPrimitive = boolean | null | number | string;

type JsonValue = JsonArray | JsonObject | JsonPrimitive;

interface LiteLLMLogEntry {
  [key: string]: JsonValue;
  usage: {
    total_tokens: number;
  };
}

interface TokenCountLogEntry {
  [key: string]: JsonValue;
  token_count: number;
}

/**
 * Type guard for ClaudeCodeLogEntry
 */
function isClaudeCodeLogEntry(value: JsonValue): value is ClaudeCodeLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "tokens" in value &&
    typeof value.tokens === "number"
  );
}

/**
 * Type guard for LiteLLMLogEntry
 */
function isLiteLLMLogEntry(value: JsonValue): value is LiteLLMLogEntry {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "usage" in value
  ) {
    const usage = value.usage;
    return (
      typeof usage === "object" &&
      usage !== null &&
      !Array.isArray(usage) &&
      "total_tokens" in usage &&
      typeof usage.total_tokens === "number"
    );
  }
  return false;
}

/**
 * Type guard for TokenCountLogEntry
 */
function isTokenCountLogEntry(value: JsonValue): value is TokenCountLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "token_count" in value &&
    typeof value.token_count === "number"
  );
}

/**
 * Safely parse JSON string to JsonValue
 * @param text - JSON string to parse
 * @returns Parsed JSON value
 */
function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

// Constants for cache and limits
const DEFAULT_CACHE_TTL_MS = 60_000; // 60 seconds
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_LOG_FILE_SIZE_MB = 10;

// Time constants
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;

// Byte conversion constants
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * KB_PER_MB;

/**
 * ProjectScanner discovers and monitors claude-workflow projects
 *
 * Uses the ProjectRegistryManager to load project list from
 * ~/.claude-workflow/projects.json, validates each project by checking
 * for .claude/settings.json, and enriches the data with live statistics.
 *
 * Features:
 * - TTL cache (60 second default) to minimize file I/O
 * - Automatic pruning of stale/deleted projects on first scan
 * - Event emission when project list changes
 * - Graceful error handling for missing/invalid projects
 */
export class ProjectScanner extends EventEmitter {
  private cache: CachedData | undefined = undefined;
  private cacheTTL: number;
  private firstScan = true;
  private maxLogFileSizeMB: number;
  private maxSessionsToProcess: number;
  private registryManager: ProjectRegistryManager;

  /**
   * Create a new ProjectScanner instance
   *
   * @param cacheTTL - Cache TTL in milliseconds (default: 60000 = 60 seconds)
   * @param maxSessionsToProcess - Max sessions to process per project (default: 100)
   * @param maxLogFileSizeMB - Max log file size to read in MB (default: 10)
   */
  constructor(
    cacheTTL = DEFAULT_CACHE_TTL_MS,
    maxSessionsToProcess = DEFAULT_MAX_SESSIONS,
    maxLogFileSizeMB = DEFAULT_MAX_LOG_FILE_SIZE_MB
  ) {
    super();
    this.cacheTTL = cacheTTL;
    this.maxSessionsToProcess = maxSessionsToProcess;
    this.maxLogFileSizeMB = maxLogFileSizeMB;
    this.registryManager = new ProjectRegistryManager();
  }

  /**
   * Get project by path
   *
   * @param projectPath - Absolute path to project directory
   * @returns ProjectInfo if found, undefined otherwise
   */
  async getProject(projectPath: string): Promise<ProjectInfo | undefined> {
    const projects = await this.scan();
    return projects.find((p) => p.path === projectPath) ?? undefined;
  }

  /**
   * Invalidate cache to force refresh on next scan
   */
  invalidateCache(): void {
    this.cache = undefined;
  }

  /**
   * Scan filesystem for Claude Code projects
   *
   * Loads projects from registry, validates each project directory,
   * calculates statistics, and returns enriched project data.
   *
   * Uses TTL cache to avoid excessive file I/O. Cache is invalidated
   * automatically after TTL expires or via invalidateCache().
   *
   * On first scan, automatically prunes stale entries from registry
   * to remove deleted projects.
   *
   * Emits 'projects-updated' event when project list changes.
   *
   * FIXED: Uses process-based detection for active sessions (ps aux | grep claude)
   *
   * @returns Array of enriched ProjectInfo objects
   */
  async scan(): Promise<ProjectInfo[]> {
    // Check cache validity
    if (this.isCacheValid()) {
       
      return this.cache!.projects;
    }

    // Prune stale entries on first scan
    if (this.firstScan) {
      await this.registryManager.pruneStaleEntries();
      this.firstScan = false;
    }

    // Load all projects from registry
    let registryEntries = await this.registryManager.getAllProjects();

    // AC: Auto-register discovered projects with active Claude sessions or filesystem scan
    // Try multiple methods to find Claude projects:
    // 1. Process detection via /proc (host PID namespace)
    // 2. Filesystem scan via SCAN_ROOT env var
    const discoveredPaths: Set<string> = new Set();

    // Method 1: Process detection via /proc (works with pid: host in docker-compose)
    try {
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        exec("ps aux | grep claude", (err, stdout) => {
          if (err) reject(err);
          else resolve({ stdout: stdout ?? "" });
        });
      });
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        if (line.includes("grep claude")) continue;
        const match = line.match(/^\s*\S+\s+(\d+)/);
        if (match) {
          const pid = Number.parseInt(match[1], 10);
          if (!Number.isNaN(pid)) {
            try {
              const cwd = await fs.readlink(`/proc/${pid}/cwd`);
              // Normalize to absolute path and check for .claude/settings.json
              const normalizedCwd = path.resolve(cwd);
              if (!discoveredPaths.has(normalizedCwd)) {
                const settingsPath = path.join(normalizedCwd, ".claude", "settings.json");
                try {
                  await fs.access(settingsPath);
                  console.log(`[ProjectScanner] Found Claude project via process: ${normalizedCwd}`);
                  discoveredPaths.add(normalizedCwd);
                } catch {
                  // Not a Claude project
                }
              }
            } catch {
              // Can't read CWD
            }
          }
        }
      }
    } catch (error) {
      console.log("[ProjectScanner] Process detection failed:", error);
    }

    // Method 2: Filesystem scan via SCAN_ROOT (fallback)
    const scanRoot = process.env.SCAN_ROOT ?? os.homedir();
    console.log(`[ProjectScanner] Scanning filesystem from: ${scanRoot}`);
    try {
      await this.scanDirectoryForProjects(scanRoot, discoveredPaths);
    } catch (error) {
      console.log("[ProjectScanner] Filesystem scan failed:", error);
    }

    // Auto-register discovered projects
    for (const projectPath of discoveredPaths) {
      const existsInRegistry = registryEntries.some((p) => p.path === projectPath);
      if (!existsInRegistry) {
        console.log(`[ProjectScanner] Auto-registering discovered project: ${projectPath}`);
        await this.registryManager.addProject(projectPath);
      }
    }

    // Reload registry to include auto-registered projects
    registryEntries = await this.registryManager.getAllProjects();

    // Validate and enrich each project
    const enrichedProjects: ProjectInfo[] = [];
    for (const entry of registryEntries) {
      const projectInfo = await this.validateProject(entry);
      if (projectInfo !== undefined) {
        enrichedProjects.push(projectInfo);
      }
    }

    // FIXED: Get active sessions from running processes (ps-based detection)
    let activeProcesses;
    let processSessionCounts: Map<string, SessionCounts>;

    try {
      activeProcesses = await getActiveClaudeProcesses();
      const projectPaths = enrichedProjects.map((p) => p.path);
      processSessionCounts = mapProcessesToProjects(activeProcesses, projectPaths);
    } catch (error) {
      // Process detection failed, fall back to log-based detection
      console.error("[ProjectScanner] Process detection failed, falling back to log-based:", error);
      activeProcesses = [];
      processSessionCounts = new Map();
    }

    // Override activeSessions with process-based counts, or fall back to log-based
    const projectsWithSessionCounts = enrichedProjects.map((project) => {
      const sessionCounts = processSessionCounts.get(project.path);

      // Use process count if available (sessions count)
      if (sessionCounts !== undefined && sessionCounts.sessions >= 0) {
        return {
          ...project,
          activeSessions: sessionCounts.sessions,
        };
      }

      // Fallback: use log-based session count from calculateStats
      return {
        ...project,
        activeSessions: project.activeSessions,
      };
    });

    // Update cache
    const previousProjects = this.cache?.projects ?? [];
    this.cache = {
      cachedAt: Date.now(),
      projects: projectsWithSessionCounts,
    };

    // Emit event if data changed
    if (this.hasProjectListChanged(previousProjects, projectsWithSessionCounts)) {
      this.emit("projects-updated", projectsWithSessionCounts);
    }

    return projectsWithSessionCounts;
  }

  /**
   * Calculate statistics for project
   *
   * Counts session directories, aggregates token usage by time period,
   * and finds most recent session timestamp.
   * FIXED: Limits sessions processed to maxSessionsToProcess (most recent)
   *
   * @param projectPath - Absolute path to project directory
   * @returns ProjectStats with session count, token usage, and last used
   */
  private async calculateStats(projectPath: string): Promise<ProjectStats> {
    const logsPath = path.join(projectPath, ".claude", "logs");

    try {
      // Get all session directories
      const entries = await fs.readdir(logsPath, { withFileTypes: true });
      const sessionDirs = entries.filter(
        (e) => e.isDirectory() && e.name.startsWith("session-")
      );

      // FIXED: Sort by timestamp and limit to most recent N sessions
      const sessionDirsWithTime: { name: string; time: Date }[] = [];

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(logsPath, sessionDir.name);
        const timestamp = await this.getSessionTimestamp(sessionPath);
        sessionDirsWithTime.push({ name: sessionDir.name, time: timestamp });
      }

      // Sort by timestamp descending (most recent first)
      sessionDirsWithTime.sort((a, b) => b.time.getTime() - a.time.getTime());

      // Take only the most recent N sessions
      const recentSessions = sessionDirsWithTime.slice(0, this.maxSessionsToProcess);

      // Calculate session count (total, not limited)
      const sessionCount = sessionDirs.length;

      // Calculate token usage and last used from RECENT sessions only
      let lastUsed = new Date(0);
      const tokenUsage = { day: 0, month: 0, week: 0 };

      const now = Date.now();

      for (const session of recentSessions) {
        const sessionPath = path.join(logsPath, session.name);
        const sessionTimestamp = session.time;

        if (sessionTimestamp > lastUsed) {
          lastUsed = sessionTimestamp;
        }

        // Calculate time difference
        const age = now - sessionTimestamp.getTime();

        // Read token usage from session logs (with file size limit - AC #18)
        const tokens = await this.getSessionTokens(sessionPath);

        // Aggregate by time period
        if (age < MS_PER_DAY) {
          tokenUsage.day += tokens;
        }
        if (age < DAYS_PER_WEEK * MS_PER_DAY) {
          tokenUsage.week += tokens;
        }
        if (age < DAYS_PER_MONTH * MS_PER_DAY) {
          tokenUsage.month += tokens;
        }
      }

      return {
        lastUsed: sessionCount > 0 ? lastUsed : new Date(),
        sessionCount,
        tokenUsage,
      };
    } catch (error) {
      // AC #17: Specific error handling
      if (error instanceof Error) {
        this.handleStatsError(error, projectPath);
      }
      return {
        lastUsed: new Date(),
        sessionCount: 0,
        tokenUsage: { day: 0, month: 0, week: 0 },
      };
    }
  }

  /**
   * Get timestamp for session
   *
   * Tries to read from metadata.json first, falls back to directory birthtime.
   *
   * @param sessionPath - Path to session directory
   * @returns Session timestamp
   */
  private async getSessionTimestamp(sessionPath: string): Promise<Date> {
    try {
      // Try to read metadata file
      const metadataPath = path.join(sessionPath, "metadata.json");
      const metadata = JSON.parse(
        await fs.readFile(metadataPath, "utf8")
      ) as { startTime: string };
      return new Date(metadata.startTime);
    } catch {
      // Fallback to directory creation time
      const stats = await fs.stat(sessionPath);
      return stats.birthtime;
    }
  }

  /**
   * Get total token count for session
   *
   * Reads log files and aggregates token counts.
   * FIXED: No longer reads non-existent token data from metadata.json
   * FIXED: Checks file size before reading to prevent memory exhaustion
   *
   * @param sessionPath - Path to session directory
   * @returns Total tokens for session
   */
  private async getSessionTokens(sessionPath: string): Promise<number> {
    try {
      const files = await fs.readdir(sessionPath);
      let totalTokens = 0;

      for (const file of files) {
        // FIXED: Skip metadata.json - it only has startTime, no token data
        if (file === "metadata.json") {
          continue;
        }

        // Process only log and JSON files
        if (file.endsWith(".log") || file.endsWith(".json")) {
          const filePath = path.join(sessionPath, file);

          // AC #18: Check file size before reading
          const stats = await fs.stat(filePath);
          const maxSizeBytes = this.maxLogFileSizeMB * BYTES_PER_MB;

          if (stats.size > maxSizeBytes) {
            // Log warning but continue - don't fail entire scan
            console.warn(
              `Skipping large log file (${String(stats.size)} bytes): ${filePath}`
            );
            continue;
          }

          const content = await fs.readFile(filePath, "utf8");
          totalTokens += this.parseTokensFromLog(content);
        }
      }

      return totalTokens;
    } catch (error) {
      // AC #17: Specific error handling
      if (error instanceof Error) {
        this.handleSessionError(error, sessionPath);
      }
      return 0;
    }
  }

  /**
   * Handle session-level errors with specific error types
   * @private
   */
  private handleSessionError(error: Error | NodeJS.ErrnoException | SyntaxError, sessionPath: string): void {
    if (error instanceof SyntaxError) {
      // JSON parse error in log files
      console.warn(
        `Invalid JSON in session logs: ${sessionPath}\n` +
        "Skipping token parsing for this session"
      );
    } else if ("code" in error) {
      const nodeError = error;

      switch (nodeError.code) {
      case "EACCES": {
        // Permission denied - log warning but continue scan
        console.warn(
          `Permission denied reading session: ${sessionPath}\n` +
            "Some metrics may be incomplete"
        );
        break;
      }

      case "ENOENT": {
        // Session directory deleted mid-scan - not critical
        // Silently skip - this is normal during cleanup
        break;
      }

      default: {
        // Other errors - log but don't fail entire scan
        console.warn(
          `Error reading session ${sessionPath}: ${nodeError.message}`
        );
      }
      }
    } else {
      // Generic error
      console.warn(`Unexpected error in session ${sessionPath}:`, error);
    }
  }

  /**
   * Handle stats calculation errors with specific error types
   * @private
   */
  private handleStatsError(error: Error | NodeJS.ErrnoException, projectPath: string): void {
    if ("code" in error) {
      const nodeError = error;

      switch (nodeError.code) {
      case "EACCES": {
        // Permission denied - warn user
        console.warn(
          `Permission denied reading logs: ${projectPath}/.claude/logs\n` +
            "Project stats will be incomplete"
        );
        break;
      }

      case "ENOENT": {
        // Logs directory doesn't exist - normal for new projects
        // Return zero stats silently
        break;
      }

      default: {
        console.warn(
          `Error calculating stats for ${projectPath}: ${nodeError.message}`
        );
      }
      }
    } else {
      console.warn(`Unexpected error calculating stats for ${projectPath}:`, error);
    }
  }

  /**
   * Compare project lists to detect changes
   *
   * Compares by project paths (sorted) to determine if
   * projects were added/removed.
   *
   * @param prev - Previous project list
   * @param current - Current project list
   * @returns true if lists differ
   */
  private hasProjectListChanged(
    prev: ProjectInfo[],
    current: ProjectInfo[]
  ): boolean {
    if (prev.length !== current.length) return true;

    // Compare project paths (sorted)
    const prevPaths = prev.map((p) => p.path).sort();
    const currentPaths = current.map((p) => p.path).sort();

    return JSON.stringify(prevPaths) !== JSON.stringify(currentPaths);
  }

  /**
   * Check if cache is still valid based on TTL
   *
   * @returns true if cache exists and TTL not expired
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const age = Date.now() - this.cache.cachedAt;
    return age < this.cacheTTL;
  }

  /**
   * Parse token counts from log content
   *
   * FIXED: Uses structured JSON parsing instead of fragile regex.
   * Handles both JSONL (one JSON per line) and plain text gracefully.
   *
   * @param content - Log file content
   * @returns Total tokens found in log
   */
  private parseTokensFromLog(content: string): number {
    let totalTokens = 0;
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") {
        continue;
      }

      try {
        // Try to parse as JSON
        const parsed = parseJson(trimmed);

        // Look for token fields in various formats
        // Claude Code format: { tokens: number }
        if (isClaudeCodeLogEntry(parsed)) {
          totalTokens += parsed.tokens;
          continue;
        }

        // LiteLLM format: { usage: { total_tokens: number } }
        if (isLiteLLMLogEntry(parsed)) {
          totalTokens += parsed.usage.total_tokens;
          continue;
        }

        // Alternative format: { token_count: number }
        if (isTokenCountLogEntry(parsed)) {
          totalTokens += parsed.token_count;
        }
      } catch {
        // Not valid JSON - skip line
        // This is normal for plain text logs
        continue;
      }
    }

    return totalTokens;
  }

  /**
   * Scan directory recursively for Claude projects
   *
   * Finds all directories containing .claude/settings.json.
   * Used for auto-registration when process detection fails.
   *
   * @param dirPath - Directory to scan
   * @param discoveredPaths - Set to add discovered project paths to
   * @param maxDepth - Maximum depth to scan (default 6 to handle deep project structures)
   */
  private async scanDirectoryForProjects(
    dirPath: string,
    discoveredPaths: Set<string>,
    maxDepth = 6
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      // Check if current directory is a Claude project
      const settingsPath = path.join(dirPath, ".claude", "settings.json");
      try {
        await fs.access(settingsPath);
        // This is a Claude project
        const normalizedPath = path.resolve(dirPath);
        if (!discoveredPaths.has(normalizedPath)) {
          console.log(`[ProjectScanner] Found Claude project via scan: ${normalizedPath}`);
          discoveredPaths.add(normalizedPath);
        }
        // Don't recurse into Claude project directories
        return;
      } catch {
        // Not a Claude project, continue scanning
      }

      // Recurse into subdirectories (with depth limit)
      if (maxDepth > 0) {
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && // Skip known non-project directories
            
              entry.name !== "node_modules" &&
              entry.name !== ".git" &&
              entry.name !== "dist" &&
              entry.name !== "build"
          ) {
            await this.scanDirectoryForProjects(
              path.join(dirPath, entry.name),
              discoveredPaths,
              maxDepth - 1
            );
          }
        }
      }
    } catch {
      // Can't read directory, skip
    }
  }

  /**
   * Validate project and enrich with statistics
   *
   * Checks for .claude/settings.json existence, reads settings,
   * and calculates project statistics.
   *
   * @param entry - Registry entry for project
   * @returns Enriched ProjectInfo if valid, undefined if invalid/deleted
   */
  private async validateProject(
    entry: ProjectRegistryEntry
  ): Promise<ProjectInfo | undefined> {
    const settingsPath = path.join(entry.path, ".claude", "settings.json");

    try {
      // Check if settings file exists
      await fs.access(settingsPath);

      // Read and parse settings
      const settingsContent = await fs.readFile(settingsPath, "utf8");
      const parsedSettings = parseJson(settingsContent);

      // Calculate project statistics
      const stats = await this.calculateStats(entry.path);

      // Ensure settings is a JsonObject
      const settings: JsonObject =
        typeof parsedSettings === "object" &&
        parsedSettings !== null &&
        !Array.isArray(parsedSettings)
          ? (parsedSettings as JsonObject)
          : {};

      // Return enriched project info
      return {
        activeSessions: stats.sessionCount,
        lastUsed: stats.lastUsed,
        name: entry.name,
        path: entry.path,
        settings,
        tokenUsage: stats.tokenUsage,
      };
    } catch {
      // Project invalid (deleted, no settings, invalid JSON, etc.)
      return undefined;
    }
  }
}
