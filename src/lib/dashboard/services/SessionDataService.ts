 
/**
 * Session Data Service
 * Scans for active Claude Code sessions and provides session metadata
 */

import type { FSWatcher } from "chokidar";

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  SessionEventHandler,
  SessionInfo,
  SessionListItem,
} from "../../../types/dashboard/session.js";

// Constants for time calculations
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const INACTIVE_THRESHOLD_MINUTES = 5;
const RECENT_THRESHOLD_HOURS = 1;

/**
 * Service for discovering and tracking Claude Code sessions
 * Scans filesystem for .claude/logs/session-* directories
 */
export class SessionDataService {
  private eventHandlers = new Map<string, Set<SessionEventHandler>>();
  private sessionCache = new Map<string, SessionInfo>();
  private watcher: FSWatcher | undefined = undefined;

  constructor() {
    // Initialization deferred to first getActiveSessions() call
    // This allows for lazy initialization and better error handling

    // Bind methods to ensure correct `this` context when used as callbacks
    this._initializeWatcher = this._initializeWatcher.bind(this);
    this._parseSessionInfo = this._parseSessionInfo.bind(this);
    this._emit = this._emit.bind(this);
  }

  /**
   * Cleanup service resources
   * Closes file watchers and clears caches
   */
  cleanup(): void {
    if (this.watcher !== undefined) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.sessionCache.clear();
    this.eventHandlers.clear();
  }

  /**
   * Get all active sessions
   * Scans filesystem for session directories
   */
  async getActiveSessions(): Promise<SessionListItem[]> {
    // Scan for sessions if cache is empty
    if (this.sessionCache.size === 0) {
      await this.scanSessions();
    }

    // Convert cached sessions to list items
    const sessions: SessionListItem[] = [];
    for (const sessionInfo of this.sessionCache.values()) {
      sessions.push({
        elapsedTime: sessionInfo.elapsedTime,
        id: sessionInfo.id,
        projectName: sessionInfo.projectName,
        status: sessionInfo.status,
      });
    }

    return sessions;
  }

  /**
   * Get session by ID
   * Returns cached session or scans filesystem if not cached
   */
  async getSessionById(sessionId: string): Promise<SessionInfo | undefined> {
    // Check cache first
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId);
    }

    // Scan for the session
    await this.scanSessions();

    return this.sessionCache.get(sessionId);
  }

  /**
   * Register event handler for session events
   */
  on(event: "session-ended", handler: SessionEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)?.add(handler);
  }

  /**
   * Emit event to all registered handlers
   * Prefixed with _ as it's not yet used (planned for task-617)
   */
  private _emit(event: string, sessionId: string): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        handler(sessionId);
      }
    }
  }

  /**
   * Initialize filesystem watcher
   * Watches for session directory changes
   * Prefixed with _ as it's not yet used (planned for task-617)
   */
  private _initializeWatcher(): void {
    // TODO: Implement filesystem watching
    // For Phase 3, this is a placeholder
    // Will use chokidar to watch for session directory changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.watcher; // Silence unused variable warning
  }

  /**
   * Parse session info from directory
   * Extracts session metadata from filesystem
   * Prefixed with _ as it's not yet used (planned for task-617)
   */
  private async _parseSessionInfo(
    sessionPath: string
  ): Promise<SessionInfo | undefined> {
    try {
      const sessionId = path.basename(sessionPath);

      // Get project path from session path
      // Pattern: /path/to/project/.claude/logs/session-xxx
      const projectPath = path.dirname(path.dirname(path.dirname(sessionPath)));
      const projectName = path.basename(projectPath);

      // Get session start time from directory creation time
      const stats = await fs.stat(sessionPath);
      const startTime = stats.birthtime;

      // Calculate elapsed time
      const elapsedMs = Date.now() - startTime.getTime();
      const elapsedTime = this.formatElapsedTime(elapsedMs);

      // Determine status (simplified for now)
      const status = await this.determineSessionStatus(sessionPath);

      return {
        elapsedTime,
        id: sessionId,
        logPath: sessionPath,
        projectName,
        projectPath,
        startTime,
        status,
      };
    } catch (error) {
      console.error(`Error parsing session info for ${sessionPath}:`, error);
      return undefined;
    }
  }

  /**
   * Decode project path from encoded directory name
   * Converts -home-user-project format back to /home/user/project
   */
  private decodeProjectPath(encodedName: string): string {
    // Remove leading dash and replace dashes with slashes
    if (encodedName.startsWith("-")) {
      return "/" + encodedName.slice(1).replaceAll("-", "/");
    }
    return encodedName;
  }

  /**
   * Determine session status based on filesystem state
   */
  private async determineSessionStatus(
    sessionPath: string
  ): Promise<"active" | "error" | "paused"> {
    try {
      // Check for error files
      const errorLogPath = path.join(sessionPath, "errors.log");
      try {
        await fs.stat(errorLogPath);
        return "error";
      } catch {
        // No error log, continue checking
      }

      // Check for recent activity (last modified time)
      const stats = await fs.stat(sessionPath);
      const lastModified = stats.mtime.getTime();
      const inactiveDuration = Date.now() - lastModified;

      // If no activity for 5 minutes, consider paused
      const inactiveThresholdMs =
        INACTIVE_THRESHOLD_MINUTES * MINUTES_PER_HOUR * MILLISECONDS_PER_SECOND;
      if (inactiveDuration > inactiveThresholdMs) {
        return "paused";
      }

      return "active";
    } catch {
      return "error";
    }
  }

  /**
   * Format elapsed time in human-readable format
   */
  private formatElapsedTime(ms: number): string {
    const seconds = Math.floor(ms / MILLISECONDS_PER_SECOND);
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const days = Math.floor(hours / HOURS_PER_DAY);

    if (days > 0) {
      return `${String(days)}d ${String(hours % HOURS_PER_DAY)}h`;
    }
    if (hours > 0) {
      return `${String(hours)}h ${String(minutes % MINUTES_PER_HOUR)}m`;
    }
    if (minutes > 0) {
      return `${String(minutes)}m ${String(seconds % SECONDS_PER_MINUTE)}s`;
    }
    return `${String(seconds)}s`;
  }

  /**
   * Check if a Claude process is running for a specific project
   * Uses pidusage to verify process exists and is consuming resources
   */
  private isClaudeProcessRunning(projectPath: string): boolean {
    // For performance, we skip process detection for now
    // This will be enhanced in a future update
    // Just return false to rely on file modification time
    void projectPath;
    return false;
  }

  /**
   * Parse session info from a JSONL session file
   */
  private async parseSessionFromFile(
    sessionId: string,
    sessionFilePath: string,
    encodedProjectName: string
  ): Promise<SessionInfo | undefined> {
    try {
      // Get file stats for timestamps
      const stats = await fs.stat(sessionFilePath);
      const startTime = stats.birthtime;

      // Calculate elapsed time
      const elapsedMs = Date.now() - startTime.getTime();
      const elapsedTime = this.formatElapsedTime(elapsedMs);

      // Decode project path
      const projectPath = this.decodeProjectPath(encodedProjectName);
      const projectName = path.basename(projectPath);

      // Determine session status by checking:
      // 1. If Claude process is running for this project
      // 2. If file was recently modified
      const lastModified = stats.mtime.getTime();
      const inactiveDuration = Date.now() - lastModified;
      const inactiveThresholdMs =
        INACTIVE_THRESHOLD_MINUTES * MINUTES_PER_HOUR * MILLISECONDS_PER_SECOND;

      let status: "active" | "error" | "paused";

      // Check if Claude is actively running in this project
      const isRunning = this.isClaudeProcessRunning(projectPath);

      if (isRunning && inactiveDuration < inactiveThresholdMs) {
        status = "active";
      } else if (inactiveDuration > inactiveThresholdMs) {
        status = "paused";
      } else {
        status = "paused";
      }

      return {
        elapsedTime,
        id: sessionId,
        logPath: sessionFilePath,
        projectName,
        projectPath,
        startTime,
        status,
      };
    } catch (error) {
      console.error(
        `[SessionDataService] Error parsing session ${sessionId}:`,
        error
      );
      return undefined;
    }
  }

  /**
   * Scan filesystem for active sessions
   * Internal method to populate session cache
   * Only includes sessions modified in the last hour (likely active)
   */
  private async scanSessions(): Promise<void> {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE;
      if (homeDir === undefined || homeDir === "") {
        console.error("[SessionDataService] HOME directory not found");
        return;
      }

      const claudeProjectsDir = path.join(homeDir, ".claude", "projects");

      // Check if directory exists
      try {
        await fs.stat(claudeProjectsDir);
      } catch {
        console.log(
          "[SessionDataService] No .claude/projects directory found"
        );
        return;
      }

      // Only show sessions modified in the last hour
      const recentThresholdMs =
        RECENT_THRESHOLD_HOURS *
        MINUTES_PER_HOUR *
        SECONDS_PER_MINUTE *
        MILLISECONDS_PER_SECOND;
      const now = Date.now();

      // Read all project directories
      const projectDirs = await fs.readdir(claudeProjectsDir);

      for (const projectDir of projectDirs) {
        const projectPath = path.join(claudeProjectsDir, projectDir);

        // Get all JSONL session files
        let sessionFiles: string[];
        try {
          const files = await fs.readdir(projectPath);
          sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
        } catch {
          // Directory not readable, skip
          continue;
        }

        // Process each session file - only recent ones
        for (const sessionFile of sessionFiles) {
          const sessionFilePath = path.join(projectPath, sessionFile);

          // Check if file was modified recently
          try {
            const stats = await fs.stat(sessionFilePath);
            const lastModified = stats.mtime.getTime();
            if (now - lastModified > recentThresholdMs) {
              // Skip sessions not modified in the last hour
              continue;
            }
          } catch {
            continue;
          }

          const sessionId = sessionFile.replace(".jsonl", "");

          // Parse session info from file
          const sessionInfo = await this.parseSessionFromFile(
            sessionId,
            sessionFilePath,
            projectDir
          );

          if (sessionInfo) {
            this.sessionCache.set(sessionId, sessionInfo);
          }
        }
      }
    } catch (error) {
      console.error("[SessionDataService] Error scanning sessions:", error);
    }
  }
}
