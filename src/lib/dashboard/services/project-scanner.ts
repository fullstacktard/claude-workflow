/**
 * ProjectScannerService - Discover claude-workflow projects in home directory
 * @module dashboard/services/project-scanner
 *
 * Scans user's home directory for projects containing .claude/ directories
 * without requiring manual registration. Used for dashboard multi-project view.
 *
 * Performance optimizations:
 * - TTL-based caching for scan results (default 60s)
 * - Separate cache for token usage (default 300s) - expensive operation
 * - Parallel async operations where possible
 * - Early bailouts for directories that can't be projects
 * - Depth limiting for filesystem traversal
 * - Progressive loading support via scanBasic() + enrichWithStats()
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import { createReadStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";

// Import DiscoveredProject for internal use and re-export for other modules
import type { DiscoveredProject } from "./log-aggregator.js";
export type { DiscoveredProject } from "./log-aggregator.js";

// Import project registry for fast discovery
import { getProjectRegistry } from "../../services/project-registry.js";

// Import process detection functions and types
import {
  getActiveClaudeProcesses,
  type SessionCounts,
} from "./claude-process-detector.js";

// Import version tracking functions
import {
  getCurrentVersion,
  getInstalledVersion,
  isVersionOutdated
} from "./version-tracker.js";

/**
 * Configuration options for ProjectScannerService
 */
export interface ProjectScannerOptions {
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTTL?: number;
  /** Directories to skip during scan (default: common non-project dirs) */
  excludeDirs?: string[];
  /** Base directory to scan (default: user home directory) */
  homeDir?: string;
  /** Maximum depth to scan (default:4) */
  maxDepth?: number;
}

// Default directories to skip
const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "Library",
  "Application Support",
  ".npm",
  ".nvm",
  ".cargo",
  ".rustup",
  ".local",
  ".config",
  "snap",
  ".vscode-server",
]);

// Default configuration constants
// Note: Use depth 6 to handle deeply nested project structures like:
// /host-home/development/projects/personal/ai-projects/project/.claude
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const PROCESS_CACHE_TTL_MS = 5 * 1000; // 5 seconds
const TOKEN_USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - expensive operation
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - rarely changes

/**
 * Internal cache structure
 */
interface CachedScanResult {
  cachedAt: number;
  projects: DiscoveredProject[];
}

/**
 * Cache entry for token usage per project
 */
interface TokenUsageCacheEntry {
  cachedAt: number;
  usage: TokenUsageStats;
}

/**
 * Cache entry for version info per project
 */
interface VersionCacheEntry {
  cachedAt: number;
  installedVersion: string | null;
}

/**
 * Cached session file stats - shared across methods to avoid redundant stat() calls
 */
interface SessionFileStats {
  name: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

/**
 * Cache entry for session file stats per project
 */
interface SessionFileStatsCacheEntry {
  cachedAt: number;
  claudeProjectsDir: string;
  stats: SessionFileStats[];
}

// Time constants for token aggregation
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;

// File size limits
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * KB_PER_MB;
const DEFAULT_MAX_LOG_FILE_SIZE_MB = 10;

/**
 * Token usage by time period
 */
interface TokenUsageStats {
  day: number;
  month: number;
  week: number;
}

/**
 * Log entry formats for token counting
 */
interface ClaudeCodeLogEntry {
  tokens: number;
  [key: string]: unknown;
}

interface LiteLLMLogEntry {
  usage: {
    total_tokens: number;
  };
  [key: string]: unknown;
}

interface TokenCountLogEntry {
  token_count: number;
  [key: string]: unknown;
}

interface OpenAIStyleLogEntry {
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  [key: string]: unknown;
}

interface InputOutputTokensLogEntry {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

interface TotalTokensLogEntry {
  totalTokens: number;
  [key: string]: unknown;
}

/**
 * Claude Code session log entry format
 * Token usage is nested inside message.usage
 */
interface ClaudeSessionLogEntry {
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  type?: string;
  [key: string]: unknown;
}

/**
 * Type guard for ClaudeCodeLogEntry
 */
function isClaudeCodeLogEntry(value: unknown): value is ClaudeCodeLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "tokens" in value &&
    typeof (value as ClaudeCodeLogEntry).tokens === "number"
  );
}

/**
 * Type guard for LiteLLMLogEntry
 */
function isLiteLLMLogEntry(value: unknown): value is LiteLLMLogEntry {
  if (typeof value === "object" && value !== null && "usage" in value) {
    const usage = (value as LiteLLMLogEntry).usage;
    return (
      typeof usage === "object" &&
      usage !== null &&
      "total_tokens" in usage &&
      typeof usage.total_tokens === "number"
    );
  }
  return false;
}

/**
 * Type guard for TokenCountLogEntry
 */
function isTokenCountLogEntry(value: unknown): value is TokenCountLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "token_count" in value &&
    typeof (value as TokenCountLogEntry).token_count === "number"
  );
}

/**
 * Type guard for OpenAI-style usage with prompt_tokens/completion_tokens
 */
function isOpenAIStyleLogEntry(value: unknown): value is OpenAIStyleLogEntry {
  if (typeof value === "object" && value !== null && "usage" in value) {
    const usage = (value as OpenAIStyleLogEntry).usage;
    if (typeof usage === "object" && usage !== null) {
      return (
        ("prompt_tokens" in usage && typeof usage.prompt_tokens === "number") ||
        ("completion_tokens" in usage && typeof usage.completion_tokens === "number")
      );
    }
  }
  return false;
}

/**
 * Type guard for input_tokens/output_tokens format
 */
function isInputOutputTokensLogEntry(value: unknown): value is InputOutputTokensLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as InputOutputTokensLogEntry;
  return (
    ("input_tokens" in entry && typeof entry.input_tokens === "number") ||
    ("output_tokens" in entry && typeof entry.output_tokens === "number")
  );
}

/**
 * Type guard for camelCase totalTokens
 */
function isTotalTokensLogEntry(value: unknown): value is TotalTokensLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "totalTokens" in value &&
    typeof (value as TotalTokensLogEntry).totalTokens === "number"
  );
}

/**
 * Type guard for Claude Code session log entry (message.usage format)
 */
function isClaudeSessionLogEntry(value: unknown): value is ClaudeSessionLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as ClaudeSessionLogEntry;
  if (entry.type !== "assistant") return false; // Only assistant messages have usage
  if (typeof entry.message !== "object" || entry.message === null) return false;
  if (typeof entry.message.usage !== "object" || entry.message.usage === null) return false;
  const usage = entry.message.usage;
  return (
    ("input_tokens" in usage && typeof usage.input_tokens === "number") ||
    ("output_tokens" in usage && typeof usage.output_tokens === "number")
  );
}

/**
 * Extract token count from any supported log entry format
 * Only counts BILLED tokens:
 * - input_tokens: billed at input rate
 * - output_tokens: billed at output rate
 * - cache_creation_input_tokens: billed at 1.25x input rate (creates cache)
 * - cache_read_input_tokens: NOT billed (free - reads from existing cache)
 */
function extractTokenCount(parsed: unknown): number {
  // Check Claude session log format first (most common case for ~/.claude/projects/ logs)
  if (isClaudeSessionLogEntry(parsed)) {
    const usage = parsed.message!.usage!;
    // Only count billed tokens - cache_read_input_tokens are FREE
    return (
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
      // NOTE: cache_read_input_tokens are NOT counted - they're free (read from cache)
    );
  }
  if (isClaudeCodeLogEntry(parsed)) {
    return parsed.tokens;
  }
  if (isLiteLLMLogEntry(parsed)) {
    return parsed.usage.total_tokens;
  }
  if (isTokenCountLogEntry(parsed)) {
    return parsed.token_count;
  }
  if (isOpenAIStyleLogEntry(parsed)) {
    return (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0);
  }
  if (isInputOutputTokensLogEntry(parsed)) {
    return (parsed.input_tokens ?? 0) + (parsed.output_tokens ?? 0);
  }
  if (isTotalTokensLogEntry(parsed)) {
    return parsed.totalTokens;
  }
  return 0;
}

/**
 * Project with session count, token usage, and version tracking
 */
export interface DiscoveredProjectWithStats extends DiscoveredProject {
  /** Number of active main Claude sessions */
  activeSessions: number;
  /** Number of active agent subprocesses */
  activeAgents: number;
  /** Token usage statistics by time period */
  tokenUsage?: {
    day: number;
    month: number;
    week: number;
  };
  /** Installed claude-workflow version (null if undeterminable) */
  installedVersion: string | null;
  /** Latest claude-workflow version (dashboard's version) */
  latestVersion: string;
  /** Whether the installed version is outdated */
  isOutdated: boolean;
}

/**
 * Service for discovering claude-workflow projects in home directory
 *
 * Uses breadth-first filesystem traversal to find all directories containing
 * .claude/ folders. Results are cached for performance.
 *
 * Features:
 * - Configurable max depth to prevent excessive scanning
 * - Automatic exclusion of common non-project directories
 * - Graceful permission error handling
 * - TTL-based caching (default 60 seconds)
 * - Results sorted by lastActivity descending
 * - Active session counting via process detection
 */
export class ProjectScannerService {
  private cache: CachedScanResult | undefined;
  private readonly cacheTTL: number;
  private readonly excludeDirs: Set<string>;
  private readonly homeDir: string;
  private readonly maxDepth: number;

  // Process detection cache (for counting active sessions and agents)
  private processSessionCache: Map<string, SessionCounts> | undefined;
  private processSessionCacheTime = 0;

  // Token usage cache per project path (expensive operation)
  private tokenUsageCache: Map<string, TokenUsageCacheEntry> = new Map();

  // Version cache per project path
  private versionCache: Map<string, VersionCacheEntry> = new Map();

  // Session file stats cache - avoids redundant stat() calls across methods
  // TTL of 5 seconds to balance freshness with performance
  private sessionFileStatsCache: Map<string, SessionFileStatsCacheEntry> = new Map();
  private static readonly SESSION_STATS_CACHE_TTL_MS = 5 * 1000;

  /**
   * Create a new ProjectScannerService
   *
   * @param options - Configuration options
   */
  constructor(options: ProjectScannerOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.cacheTTL = options.cacheTTL ?? DEFAULT_CACHE_TTL_MS;

    // Merge default and custom exclude directories
    this.excludeDirs = new Set(DEFAULT_EXCLUDE_DIRS);
    for (const dir of options.excludeDirs ?? []) {
      this.excludeDirs.add(dir);
    }
  }

  /**
   * Clear cache to force refresh on next scan
   */
  clearCache(): void {
    this.cache = undefined;
    this.processSessionCache = undefined;
    this.processSessionCacheTime = 0;
    this.tokenUsageCache.clear();
    this.versionCache.clear();
    this.sessionFileStatsCache.clear();
  }

  /**
   * Scan for claude-workflow projects
   *
   * Uses global project registry as primary source for instant discovery.
   * Falls back to filesystem scanning if registry is empty or unavailable.
   * Validates registry entries (removes stale entries for non-existent projects).
   *
   * @returns Array of DiscoveredProject objects, sorted by lastActivity descending
   */
  async scan(): Promise<DiscoveredProject[]> {
    const startTime = performance.now();

    // Check cache validity
    if (this.isCacheValid()) {
      console.log(`[ProjectScanner] scan() cache hit (${(performance.now() - startTime).toFixed(1)}ms)`);
      return this.cache!.projects;
    }

    // Try registry-based discovery first (fast path)
    const registryStartTime = performance.now();
    const registryProjects = await this.discoverFromRegistry();
    const registryTime = performance.now() - registryStartTime;

    // If registry has projects, use those
    // Otherwise fall back to filesystem scan for backward compatibility
    let projects: DiscoveredProject[];
    let scanMethod: string;

    if (registryProjects.length > 0) {
      projects = registryProjects;
      scanMethod = "registry";
      console.log(`[ProjectScanner] Registry discovery: ${projects.length} projects in ${registryTime.toFixed(1)}ms`);
    } else {
      const fsStartTime = performance.now();
      projects = await this.discoverProjects();
      scanMethod = "filesystem";
      console.log(`[ProjectScanner] Filesystem scan: ${projects.length} projects in ${(performance.now() - fsStartTime).toFixed(1)}ms`);
    }

    // Sort by lastActivity descending
    projects.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    // Prune caches for projects that no longer exist in scan results
    const currentPaths = new Set(projects.map(p => p.path));
    for (const cachedPath of this.tokenUsageCache.keys()) {
      if (!currentPaths.has(cachedPath)) {
        this.tokenUsageCache.delete(cachedPath);
      }
    }
    for (const cachedPath of this.versionCache.keys()) {
      if (!currentPaths.has(cachedPath)) {
        this.versionCache.delete(cachedPath);
      }
    }
    for (const cachedPath of this.sessionFileStatsCache.keys()) {
      if (!currentPaths.has(cachedPath)) {
        this.sessionFileStatsCache.delete(cachedPath);
      }
    }

    // Update cache
    this.cache = {
      cachedAt: Date.now(),
      projects,
    };

    console.log(`[ProjectScanner] scan() complete via ${scanMethod}: ${projects.length} projects in ${(performance.now() - startTime).toFixed(1)}ms`);
    return projects;
  }

  /**
   * Async check if file/directory exists
   * Replaces synchronous existsSync for non-blocking operation
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover projects from the global registry
   *
   * Reads ~/.claude-workflow/registry.json and validates each entry.
   * Removes stale entries (projects that no longer exist on filesystem).
   * Uses parallel validation for better performance.
   *
   * @returns Array of DiscoveredProject objects
   */
  private async discoverFromRegistry(): Promise<DiscoveredProject[]> {
    try {
      const registry = getProjectRegistry();
      const entries = registry.list();

      // Check if running in Docker (SCAN_ROOT is set)
      const scanRoot = process.env.SCAN_ROOT;
      const hostProjectPath = process.env.HOST_PROJECT_PATH ?? "";
      const isDocker = scanRoot !== undefined && scanRoot !== "";

      // Process entries in parallel for better performance
      const validationResults = await Promise.all(
        entries.map(async (entry) => {
          let projectPath = entry.pwd;

          // In Docker, translate host path to container path
          if (isDocker) {
            let containerPath: string;

            if (hostProjectPath !== "" && entry.pwd.startsWith(hostProjectPath)) {
              const relativePath = entry.pwd.slice(hostProjectPath.length);
              containerPath = path.join(scanRoot, relativePath);
            } else {
              containerPath = path.join(scanRoot, path.basename(entry.pwd));
            }

            const containerConfigPath = path.join(containerPath, ".claude", "workflow-config.json");

            if (await this.pathExists(containerConfigPath)) {
              projectPath = containerPath;
            } else {
              return { valid: false, stale: false, projectPath: entry.pwd };
            }
          } else {
            const configPath = path.join(projectPath, ".claude", "workflow-config.json");
            if (!(await this.pathExists(configPath))) {
              return { valid: false, stale: true, projectPath: entry.pwd };
            }
          }

          return { valid: true, stale: false, projectPath };
        })
      );

      // Collect valid projects and stale entries
      const validPaths: string[] = [];
      const staleEntries: string[] = [];

      for (const result of validationResults) {
        if (result.valid) {
          validPaths.push(result.projectPath);
        } else if (result.stale) {
          staleEntries.push(result.projectPath);
        }
      }

      // Create project info in parallel
      const projectResults = await Promise.all(
        validPaths.map(projectPath => this.createProjectInfo(projectPath))
      );

      const projects = projectResults.filter((p: DiscoveredProject | undefined): p is DiscoveredProject => p !== undefined);

      // Clean up stale entries (only outside Docker, may fail on read-only filesystem)
      if (!isDocker && staleEntries.length > 0) {
        try {
          for (const stalePath of staleEntries) {
            registry.unregister(stalePath);
          }
          console.log(`[ProjectScanner] Cleaned up ${staleEntries.length} stale registry entries`);
        } catch {
          console.log(`[ProjectScanner] Found ${staleEntries.length} stale entries (cleanup skipped - read-only)`);
        }
      }

      return projects;
    } catch (error) {
      console.log("[ProjectScanner] Registry unavailable, using filesystem scan:",
        error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Scan for basic project info only (fast path)
   *
   * Returns projects without expensive stats like token usage.
   * Use this for initial fast rendering, then call enrichWithStats()
   * for the full data.
   *
   * @returns Array of DiscoveredProject objects, sorted by lastActivity descending
   */
  async scanBasic(): Promise<DiscoveredProject[]> {
    return this.scan();
  }

  /**
   * Enrich a single project with stats
   *
   * Adds session counts, agent counts, token usage, and version info to a project.
   * Uses caching for expensive operations.
   *
   * @param project - Project to enrich
   * @returns Project with stats
   */
  async enrichProjectWithStats(project: DiscoveredProject): Promise<DiscoveredProjectWithStats> {
    const latestVersion = getCurrentVersion();
    const now = Date.now();

    // Active sessions and agents - always fresh (5s cache in countActiveSessions)
    const sessionCounts = await this.countActiveSessions(project.path);

    // Token usage - use cache if valid (expensive operation)
    let tokenUsage: TokenUsageStats;
    const cachedTokenUsage = this.tokenUsageCache.get(project.path);
    if (cachedTokenUsage && (now - cachedTokenUsage.cachedAt) < TOKEN_USAGE_CACHE_TTL_MS) {
      tokenUsage = cachedTokenUsage.usage;
    } else {
      tokenUsage = await this.calculateTokenUsage(project.path);
      this.tokenUsageCache.set(project.path, { cachedAt: now, usage: tokenUsage });
    }

    // Version info - use cache if valid
    let installedVersion: string | null;
    const cachedVersion = this.versionCache.get(project.path);
    if (cachedVersion && (now - cachedVersion.cachedAt) < VERSION_CACHE_TTL_MS) {
      installedVersion = cachedVersion.installedVersion;
    } else {
      installedVersion = await getInstalledVersion(project.path);
      this.versionCache.set(project.path, { cachedAt: now, installedVersion });
    }

    return {
      ...project,
      activeSessions: sessionCounts.sessions,
      activeAgents: sessionCounts.agents,
      tokenUsage,
      installedVersion,
      latestVersion,
      isOutdated: isVersionOutdated(installedVersion, latestVersion),
    };
  }

  /**
   * Scan home directory for claude-workflow projects with session counts
   *
   * Returns cached results if cache is valid, otherwise performs
   * full filesystem scan with active session counting and token usage.
   *
   * Performance: Uses separate caches for token usage (5min TTL) and
   * version info (5min TTL) since these are expensive operations.
   *
   * @returns Array of DiscoveredProjectWithStats objects, sorted by lastActivity descending
   */
  async scanWithStats(): Promise<DiscoveredProjectWithStats[]> {
    const startTime = performance.now();
    const projects = await this.scan();
    const scanTime = performance.now() - startTime;

    // Enrich projects with stats sequentially to avoid memory pressure
    // (Each enrichment streams through session files, and parallel execution
    // of 13+ concurrent stream operations causes memory explosion)
    const statsStartTime = performance.now();
    const projectsWithStats: DiscoveredProjectWithStats[] = [];
    for (const project of projects) {
      const enriched = await this.enrichProjectWithStats(project);
      projectsWithStats.push(enriched);
    }

    const totalTime = performance.now() - startTime;
    console.log(`[ProjectScanner] scanWithStats(): scan=${scanTime.toFixed(1)}ms, stats=${(performance.now() - statsStartTime).toFixed(1)}ms, total=${totalTime.toFixed(1)}ms for ${projects.length} projects`);

    return projectsWithStats;
  }

  /**
   * Get most recent activity timestamp from session directories
   * Falls back to .claude directory mtime if no sessions exist
   *
   * Scans session directories for the most recently modified file,
   * which accurately reflects the last Claude session time.
   *
   * Performance optimizations:
   * - Only checks the last 5 session directories (most recent)
   * - Uses parallel stat operations within each session
   * - Exits early if activity is found within the last hour
   * - Uses directory mtime as quick proxy before checking files
   *
   * @param projectPath - Path to project directory
   * @returns Date of most recent activity
   */
  /**
   * Get most recent activity timestamp from Claude session files
   * Falls back to .claude directory mtime if no sessions exist
   *
   * Scans Claude's session directory at ~/.claude/projects/{encoded-path}/
   * for most recently modified JSONL file, which accurately reflects last activity.
   *
   * Performance optimizations:
   * - Uses parallel stat operations for all session files
   * - Exits early if activity is found within the last hour
   * - Caches results for performance (handled by caller via scanWithStats)
   *
   * @param projectPath - Path to project directory
   * @returns Date of most recent activity
   */

  /**
   * Create DiscoveredProject info from a project directory
   *
   * @param projectPath - Path to project directory
   * @returns DiscoveredProject if valid, undefined if error
   */
  private async createProjectInfo(
    projectPath: string
  ): Promise<DiscoveredProject | undefined> {
    const claudeDir = path.join(projectPath, ".claude");
    const logDir = path.join(claudeDir, "logs");
    const workflowConfig = path.join(claudeDir, "workflow-config.json");

    try {
      // Only include projects with claude-workflow installed (have workflow-config.json)
      try {
        await fs.access(workflowConfig);
      } catch {
        // No workflow-config.json = not a claude-workflow project, skip it
        return undefined;
      }

      // Get lastActivity from workflow-config.json mtime as a reasonable proxy
      // (indicates when project was last updated/scanned)
      let lastActivity = new Date(0);
      try {
        const stats = await fs.stat(workflowConfig);
        lastActivity = stats.mtime;
      } catch {
        // Use epoch if stat fails
      }

      // Fallback to session-based activity if available for more accurate timestamps
      try {
        const sessionActivity = await this.getSessionActivityFromSessions(projectPath);
        if (sessionActivity.getTime() > lastActivity.getTime()) {
          lastActivity = sessionActivity;
        }
      } catch {
        // Session lookup failed, use workflow-config mtime
      }

      // Check if logs directory exists
      let logDirExists = false;
      try {
        await fs.access(logDir);
        logDirExists = true;
      } catch {
        // logs directory doesn't exist
      }

      // Check for routing logs
      let hasRoutingLogs = false;
      if (logDirExists) {
        const routingDir = path.join(logDir, "routing");
        try {
          await fs.access(routingDir);
          hasRoutingLogs = true;
        } catch {
          // routing directory doesn't exist
        }
      }

      return {
        hasRoutingLogs,
        lastActivity, // Now uses session-based activity time
        logDirectory: logDir,
        name: path.basename(projectPath),
        path: projectPath,
      };
    } catch {
      // Error reading project info - skip this project
      return undefined;
    }
  }

  /**
   * Discover all claude-workflow projects using breadth-first traversal
   *
   * Scans filesystem starting from homeDir, looking for directories
   * containing .claude/ folders.
   *
   * Performance optimizations:
   * - Early bailout for directories that can't contain projects
   * - Batch directory processing at each level
   * - Skip directories with names that indicate non-project content
   *
   * @returns Array of DiscoveredProject objects (unsorted)
   */
  private async discoverProjects(): Promise<DiscoveredProject[]> {
    const projects: DiscoveredProject[] = [];

    // Additional directories to skip (unlikely to contain projects)
    const additionalSkipPatterns = new Set([
      "build",
      "dist",
      "out",
      "target",
      "coverage",
      "__pycache__",
      "venv",
      ".venv",
      "env",
      ".env",
      "vendor",
      "bower_components",
      ".idea",
      ".gradle",
      "bin",
      "obj",
      "Pods",
      "DerivedData",
    ]);

    // Queue entries: [directory path, current depth]
    const queue: Array<[string, number]> = [[this.homeDir, 0]];

    while (queue.length > 0) {
      const [currentDir, depth] = queue.shift()!;

      // Skip if max depth exceeded
      if (depth > this.maxDepth) {
        continue;
      }

      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        // Separate .claude directories from others for immediate processing
        const claudeDirs: string[] = [];
        const subDirs: Array<[string, number]> = [];

        for (const entry of entries) {
          // Skip non-directories
          if (!entry.isDirectory()) {
            continue;
          }

          const name = entry.name;

          // Skip excluded directories
          if (this.excludeDirs.has(name) || additionalSkipPatterns.has(name)) {
            continue;
          }

          // Skip hidden directories (except .claude which we're looking for)
          if (name.startsWith(".") && name !== ".claude") {
            continue;
          }

          const entryPath = path.join(currentDir, name);

          // Check if this is a .claude directory
          if (name === ".claude") {
            // Found a claude-workflow project - parent is project dir
            claudeDirs.push(currentDir);
            // Don't descend into .claude directories
            continue;
          }

          // Add to queue for further exploration
          subDirs.push([entryPath, depth + 1]);
        }

        // Process found .claude directories in parallel
        if (claudeDirs.length > 0) {
          const projectResults = await Promise.all(
            claudeDirs.map(dir => this.createProjectInfo(dir))
          );
          for (const project of projectResults) {
            if (project !== undefined) {
              projects.push(project);
            }
          }
        }

        // Add subdirs to queue
        queue.push(...subDirs);
      } catch {
        // Permission denied or other error - skip this directory
        continue;
      }
    }

    return projects;
  }

  /**
   * Check if cache is still valid
   *
   * @returns true if cache exists and TTL not expired
   */
  private isCacheValid(): boolean {
    if (this.cache === undefined) {
      return false;
    }
    const age = Date.now() - this.cache.cachedAt;
    return age < this.cacheTTL;
  }

  /**
   * Count active Claude sessions and agents for a project
   *
   * Uses two detection methods in parallel:
   * 1. Process-based: Read lock files and map to project via CWD
   * 2. Log-based: Check file modification times in session directories
   *
   * Returns the maximum of both methods to ensure we don't miss active sessions.
   * Process detection may fail in Docker environments where /proc is not accessible.
   * Log-based detection catches sessions even when process detection fails.
   *
   * @param projectPath - Path to project directory
   * @returns SessionCounts with sessions and agents counts
   */
  async countActiveSessions(projectPath: string): Promise<SessionCounts> {
    const processCounts = await this.countActiveSessionsByProcess(projectPath).catch((error) => {
      console.log("[ProjectScanner] Process-based detection failed:", error instanceof Error ? error.message : String(error));
      return { sessions: 0, agents: 0 };
    });

    if (processCounts.sessions > 0 || processCounts.agents > 0) {
      console.log("[ProjectScanner] Active counts for", path.basename(projectPath), ":", processCounts.sessions, "sessions,", processCounts.agents, "agents");
    }

    return processCounts;
  }

  /**
   * Count sessions and agents by detecting running Claude processes
   *
   * Reads lock files from ~/.claude/ide/ directory,
   * verifies each process is still running, maps process
   * working directory to project paths, and returns counts.
   *
   * @param projectPath - Path to project directory
   * @returns SessionCounts with sessions and agents for this project
   */
  private async countActiveSessionsByProcess(
    projectPath: string
  ): Promise<SessionCounts> {
    const now = Date.now();

    // Check cache validity
    if (
      this.processSessionCache &&
      now - this.processSessionCacheTime < PROCESS_CACHE_TTL_MS
    ) {
      return this.processSessionCache.get(projectPath) ?? { sessions: 0, agents: 0 };
    }

    // Refresh process detection
    const processes = await getActiveClaudeProcesses();
    const allProjectPaths =
      this.cache?.projects.map((p) => p.path) ?? [projectPath];

    // Use dynamic import to avoid circular dependency
    // Then call mapProcessesToProjects to create the mapping
    const { mapProcessesToProjects } = await import("./claude-process-detector.js");
    const mapping = mapProcessesToProjects(processes, allProjectPaths);

    this.processSessionCache = mapping;
    this.processSessionCacheTime = now;

    return mapping.get(projectPath) ?? { sessions: 0, agents: 0 };
  }

  /**
   * Get session file stats with caching - unified method to avoid redundant stat() calls
   *
   * This method is shared by:
   * - getSessionActivityFromSessions() - needs mtime for most recent activity
   * - calculateTokenUsage() - needs mtime and size for filtering and reading
   *
   * Performance: Stats all files once per 5-second window, caches results.
   * Reduces ~1500 stat calls per scan cycle to ~500.
   *
   * @param projectPath - Path to project directory
   * @returns Array of session file stats, empty if directory doesn't exist
   */
  private async getSessionFileStats(projectPath: string): Promise<SessionFileStats[]> {
    const hostPath = this.containerPathToHostPath(projectPath);
    const encodedPath = this.encodeProjectPath(hostPath);
    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects", encodedPath);

    // Check cache
    const now = Date.now();
    const cached = this.sessionFileStatsCache.get(projectPath);
    if (cached && now - cached.cachedAt < ProjectScannerService.SESSION_STATS_CACHE_TTL_MS) {
      return cached.stats;
    }

    try {
      const entries = await fs.readdir(claudeProjectsDir, { withFileTypes: true });

      // Filter for session JSONL files (UUID.jsonl format, excluding agent-*.jsonl)
      const sessionFiles = entries.filter(
        (e) => e.isFile() &&
               e.name.endsWith(".jsonl") &&
               !e.name.startsWith("agent-")
      );

      // Stat all files in parallel - single pass for all consumers
      const stats = await Promise.all(
        sessionFiles.map(async (entry) => {
          const filePath = path.join(claudeProjectsDir, entry.name);
          try {
            const fileStats = await fs.stat(filePath);
            return {
              filePath,
              mtimeMs: fileStats.mtimeMs,
              name: entry.name,
              size: fileStats.size,
            };
          } catch {
            return null;
          }
        })
      );

      // Filter out failed stats
      const validStats = stats.filter((s): s is SessionFileStats => s !== null);

      // Cache results
      this.sessionFileStatsCache.set(projectPath, {
        cachedAt: now,
        claudeProjectsDir,
        stats: validStats,
      });

      return validStats;
    } catch {
      // Directory doesn't exist or not readable
      return [];
    }
  }

  /**
   * Convert container path back to host path for Claude session lookup
   *
   * In Docker, project paths are like /app/projects/development/...
   * But Claude encodes sessions using the HOST path like /home/user/development/...
   *
   * @param containerPath - Path as seen inside Docker container
   * @returns Host path for Claude session encoding
   */
  public containerPathToHostPath(containerPath: string): string {
    const scanRoot = process.env.SCAN_ROOT;
    let hostProjectPath = process.env.HOST_PROJECT_PATH ?? "";

    // Not in Docker or env vars not set - return as-is
    if (!scanRoot || !hostProjectPath) {
      return containerPath;
    }

    // Expand ~ to actual home directory (docker-compose passes ~ literally)
    if (hostProjectPath === "~" || hostProjectPath.startsWith("~/")) {
      // Inside Docker, HOME might be /home/dashboard but we need the actual host user's home
      // Look at the Claude projects directory to infer the host user's home
      const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
      try {
        const entries = fsSync.readdirSync(claudeProjectsDir);
        // Find a path pattern like -home-username-...
        const homePattern = entries.find(e => e.startsWith("-home-"));
        if (homePattern) {
          // Extract: -home-fullstacktard-development -> /home/fullstacktard
          const parts = homePattern.split("-");
          if (parts.length >= 3 && parts[0] === "" && parts[1] === "home") {
            hostProjectPath = `/${parts[1]}/${parts[2]}`;
          }
        }
      } catch {
        // Fall back to using container's HOME
        hostProjectPath = os.homedir();
      }
    }

    // Translate: /app/projects/development/... -> /home/user/development/...
    if (containerPath.startsWith(scanRoot)) {
      const relativePath = containerPath.slice(scanRoot.length);
      return hostProjectPath + relativePath;
    }

    return containerPath;
  }

  /**
   * Encode project path for Claude's ~/.claude/projects/ directory naming
   * Claude uses the full path with / replaced by -
   *
   * @param projectPath - Absolute path to project directory (host path)
   * @returns Encoded path for ~/.claude/projects/ lookup
   */
  private encodeProjectPath(projectPath: string): string {
    // Claude encodes paths by replacing / with -
    // /home/user/project -> -home-user-project
    return projectPath.replaceAll("/", "-");
  }

  /**
   * Calculate token usage for a project
   *
   * Reads Claude Code session logs from ~/.claude/projects/{encoded-path}/*.jsonl
   * and aggregates token counts by time period.
   *
   * @param projectPath - Path to project directory
   * @returns Token usage stats by day/week/month
   */
  private async calculateTokenUsage(projectPath: string): Promise<TokenUsageStats> {
    const tokenUsage: TokenUsageStats = { day: 0, month: 0, week: 0 };
    const now = Date.now();
    const maxAge = DAYS_PER_MONTH * MS_PER_DAY;
    const maxSizeBytes = DEFAULT_MAX_LOG_FILE_SIZE_MB * BYTES_PER_MB;

    console.log("[ProjectScanner] calculateTokenUsage for:", projectPath);

    // Use cached session file stats - avoids redundant stat() calls
    const fileStats = await this.getSessionFileStats(projectPath);

    if (fileStats.length === 0) {
      console.log("[ProjectScanner] No session files found");
      return tokenUsage;
    }

    console.log("[ProjectScanner] Found", fileStats.length, "session files");

    // Filter to files modified within month window and size limit
    // (optimization: skip files that haven't been touched in a month)
    const recentFiles = fileStats.filter((f) => {
      const age = now - f.mtimeMs;
      return age <= maxAge && f.size <= maxSizeBytes;
    });

    console.log("[ProjectScanner]", recentFiles.length, "files within month window");

    // Stream and parse files sequentially to avoid memory explosion
    // (Streaming processes line-by-line without loading entire file into memory)
    for (const file of recentFiles) {
      try {
        const fileTokens = await this.streamParseTokensFromLog(file.filePath, now);
        tokenUsage.day += fileTokens.day;
        tokenUsage.week += fileTokens.week;
        tokenUsage.month += fileTokens.month;
      } catch {
        // Skip files that can't be read
      }
    }

    console.log("[ProjectScanner] Total token usage:", tokenUsage);
    return tokenUsage;
  }

  /**
   * Get most recent activity timestamp from Claude session files
   * This method provides accurate activity tracking by scanning session files.
   *
   * Uses cached session file stats to avoid redundant stat() calls.
   *
   * @param projectPath - Path to project directory
   * @returns Date of most recent session activity
   */
  private async getSessionActivityFromSessions(projectPath: string): Promise<Date> {
    // Use cached session file stats - avoids redundant stat() calls
    const fileStats = await this.getSessionFileStats(projectPath);

    if (fileStats.length === 0) {
      return new Date(0);
    }

    // Find most recent file
    let mostRecentMtime = 0;
    for (const f of fileStats) {
      if (f.mtimeMs > mostRecentMtime) {
        mostRecentMtime = f.mtimeMs;
      }
    }

    return mostRecentMtime > 0 ? new Date(mostRecentMtime) : new Date(0);
  }

  /**
   * Stream parse tokens from a log file without loading entire file into memory.
   * Processes file line-by-line using streaming.
   *
   * @param filePath - Path to the session log file
   * @param now - Current timestamp for time period calculation
   * @returns Token usage stats by day/week/month
   */
  private async streamParseTokensFromLog(
    filePath: string,
    now: number
  ): Promise<TokenUsageStats> {
    const tokenUsage: TokenUsageStats = { day: 0, week: 0, month: 0 };

    const dayAgo = now - MS_PER_DAY;
    const weekAgo = now - DAYS_PER_WEEK * MS_PER_DAY;
    const monthAgo = now - DAYS_PER_MONTH * MS_PER_DAY;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath, { encoding: "utf8" });
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (trimmed === "") return;

        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const tokens = extractTokenCount(parsed);
          if (tokens > 0) {
            const entryTimestamp = this.extractEntryTimestamp(parsed);
            if (entryTimestamp === null || entryTimestamp < monthAgo) {
              return;
            }

            // Aggregate by time period based on entry timestamp
            tokenUsage.month += tokens;
            if (entryTimestamp >= weekAgo) {
              tokenUsage.week += tokens;
            }
            if (entryTimestamp >= dayAgo) {
              tokenUsage.day += tokens;
            }
          }
        } catch {
          // Not valid JSON - skip line
        }
      });

      rl.on("close", () => {
        resolve(tokenUsage);
      });

      rl.on("error", (error: Error) => {
        reject(error);
      });

      fileStream.on("error", (error: Error) => {
        rl.close();
        reject(error);
      });
    });
  }

  /**
   * Extract timestamp from a log entry.
   * Returns timestamp in milliseconds, or null if not found.
   */
  private extractEntryTimestamp(parsed: unknown): number | null {
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const entry = parsed as Record<string, unknown>;

    // Claude session logs have a "timestamp" field as ISO string
    if (typeof entry.timestamp === "string") {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts)) {
        return ts;
      }
    }

    // Some logs might have a numeric timestamp field
    if (typeof entry.timestamp === "number") {
      return entry.timestamp;
    }

    // Check for other common timestamp field names
    if (typeof entry.time === "number") {
      return entry.time;
    }
    if (typeof entry.time === "string") {
      const ts = Date.parse(entry.time);
      if (!Number.isNaN(ts)) {
        return ts;
      }
    }

    if (typeof entry.createdAt === "string") {
      const ts = Date.parse(entry.createdAt);
      if (!Number.isNaN(ts)) {
        return ts;
      }
    }

    return null;
  }

}
