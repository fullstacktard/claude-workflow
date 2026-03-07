/**
 * Project Data Aggregator
 * Aggregates analytics data from project session logs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  ComplianceMetrics,
  ModelDistribution,
  ProjectMetadata,
  ProjectSettings,
  RoutingStats,
  SessionLogData,
  TokenUsageData,
} from "../../../types/dashboard/project.js";

// Constants for time calculations
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

// Constants for time periods
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;

// Constants for rate calculations
const PERCENTAGE_COMPLETE = 100;

// Constants for JSON formatting
const JSON_INDENT_SPACES = 2;

// Constants for activity thresholds
const ACTIVE_SESSION_MINUTES = 5;
const ACTIVE_SESSION_THRESHOLD = ACTIVE_SESSION_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/**
 * Aggregates data from project session logs for analytics display
 * Scans .claude/logs/session-* directories and parses log files
 */
export class ProjectDataAggregator {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Aggregate compliance metrics from compliance logs
   */
  async aggregateComplianceMetrics(): Promise<ComplianceMetrics> {
    const hookLogPath = path.join(this.projectPath, ".claude/logs/global-compliance.jsonl");

    let totalHookExecutions = 0;
    let successfulHookExecutions = 0;
    let totalTaskValidations = 0;
    let passedTaskValidations = 0;
    let codeReviewViolations = 0;
    let lastScan = new Date(0);

    try {
      // Check if compliance log exists
      await fs.access(hookLogPath);

      const content = await fs.readFile(hookLogPath, "utf8");
      const lines = content.trim().split("\n").filter((line) => line.length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            passed?: boolean;
            success?: boolean;
            timestamp?: string;
            type?: string;
          };

          if (entry.type === "hook_execution") {
            totalHookExecutions++;
            if (entry.success === true) {
              successfulHookExecutions++;
            }
          }

          if (entry.type === "task_validation") {
            totalTaskValidations++;
            if (entry.passed === true) {
              passedTaskValidations++;
            }
          }

          if (entry.type === "code_review_violation") {
            codeReviewViolations++;
          }

          if (entry.timestamp !== undefined && entry.timestamp !== "") {
            const entryDate = new Date(entry.timestamp);
            if (entryDate > lastScan) {
              lastScan = entryDate;
            }
          }
        } catch {
          // Skip malformed JSON lines
          continue;
        }
      }
    } catch {
      // Compliance log doesn't exist - return default metrics
    }

    return {
      codeReviewViolations,
      hookExecutionSuccessRate:
        totalHookExecutions > 0 ? (successfulHookExecutions / totalHookExecutions) * PERCENTAGE_COMPLETE : PERCENTAGE_COMPLETE,
      lastComplianceScan: lastScan,
      taskValidationPassRate:
        totalTaskValidations > 0 ? (passedTaskValidations / totalTaskValidations) * PERCENTAGE_COMPLETE : PERCENTAGE_COMPLETE,
    };
  }

  /**
   * Aggregate model distribution from session logs
   */
  async aggregateModelDistribution(): Promise<ModelDistribution> {
    const sessionData = await this.getAllSessionData();

    const distribution: ModelDistribution = {};

    for (const session of sessionData) {
      const modelUsage = session.modelUsage;
      for (const model of Object.keys(modelUsage)) {
        const count = modelUsage[model];
        if (count !== undefined && count !== 0 && !Number.isNaN(count)) {
          distribution[model] = (distribution[model] ?? 0) + count;
        }
      }
    }

    return distribution;
  }

  /**
   * Aggregate routing statistics from routing logs
   */
  async aggregateRoutingStats(): Promise<RoutingStats> {
    const stats: RoutingStats = {
      costSavings: 0,
      routedRequests: 0,
      routingBreakdown: {},
      totalRequests: 0,
    };

    const routingLogPath = path.join(this.projectPath, ".claude/logs/routing");

    try {
      // Check if routing directory exists
      await fs.access(routingLogPath);

      const files = await fs.readdir(routingLogPath);
      const routingFiles = files.filter((file) => file.endsWith(".jsonl"));

      for (const file of routingFiles) {
        const filePath = path.join(routingLogPath, file);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.trim().split("\n").filter((line) => line.length > 0);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as {
              costSaved?: number;
              routed?: boolean;
              targetModel?: string;
            };

            stats.totalRequests++;

            if (entry.routed === true && entry.targetModel !== undefined && entry.targetModel !== "") {
              stats.routedRequests++;
              stats.routingBreakdown[entry.targetModel] =
                (stats.routingBreakdown[entry.targetModel] ?? 0) + 1;
              if (entry.costSaved !== undefined && entry.costSaved !== 0 && !Number.isNaN(entry.costSaved)) {
                stats.costSavings += entry.costSaved ?? 0;
              }
            }
          } catch {
            // Skip malformed JSON lines
            continue;
          }
        }
      }
    } catch {
      // Routing logs don't exist - return empty stats
    }

    return stats;
  }

  /**
   * Aggregate token usage by time period (24h, 7d, 30d)
   */
  async aggregateTokenUsage(): Promise<TokenUsageData> {
    const sessionData = await this.getAllSessionData();

    const now = Date.now();

    let tokens24h = 0;
    let tokens7d = 0;
    let tokens30d = 0;
    let cost30d = 0;

    for (const session of sessionData) {
      const age = now - session.timestamp.getTime();

      if (age < MILLISECONDS_PER_DAY) {
        tokens24h += session.tokens;
      }
      if (age < DAYS_IN_WEEK * MILLISECONDS_PER_DAY) {
        tokens7d += session.tokens;
      }
      if (age < DAYS_IN_MONTH * MILLISECONDS_PER_DAY) {
        tokens30d += session.tokens;
        cost30d += session.cost;
      }
    }

    return {
      last7d: tokens7d,
      last24h: tokens24h,
      last30d: tokens30d,
      totalCost30d: cost30d,
    };
  }

  /**
   * Get project metadata (path, active sessions, last activity)
   */
  async getProjectMetadata(): Promise<ProjectMetadata> {
    const activeSessions = await this.countActiveSessions();
    const lastActivity = await this.getLastActivityTime();

    return {
      activeSessions,
      lastActivity,
      path: this.projectPath,
    };
  }

  /**
   * Load project settings from .claude/settings.json
   */
  async loadProjectSettings(): Promise<ProjectSettings> {
    const settingsPath = path.join(this.projectPath, ".claude/settings.json");

    try {
      const content = await fs.readFile(settingsPath, "utf8");
      return JSON.parse(content) as ProjectSettings;
    } catch {
      // Settings file doesn't exist - return defaults
      return this.getDefaultSettings();
    }
  }

  /**
   * Save project settings to .claude/settings.json
   */
  async saveProjectSettings(settings: Partial<ProjectSettings>): Promise<void> {
    const claudeDir = path.join(this.projectPath, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    // Ensure .claude directory exists
    await fs.mkdir(claudeDir, { recursive: true });

    // Load current settings and merge with updates
    const currentSettings = await this.loadProjectSettings();
    const newSettings = { ...currentSettings, ...settings };

    // Write back to file with proper formatting
    await fs.writeFile(settingsPath, JSON.stringify(newSettings, undefined, JSON_INDENT_SPACES) + "\n", "utf8");
  }

  /**
   * Count active sessions for this project
   */
  private async countActiveSessions(): Promise<number> {
    const logsDir = path.join(this.projectPath, ".claude/logs");

    try {
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      const sessionDirs = entries.filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("session-")
      );

      // Count sessions with recent activity (last 5 minutes)
      const now = Date.now();
      let activeCount = 0;

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(logsDir, sessionDir.name);
        const stats = await fs.stat(sessionPath);
        const lastModified = stats.mtime.getTime();

        if (now - lastModified < ACTIVE_SESSION_THRESHOLD) {
          activeCount++;
        }
      }

      return activeCount;
    } catch {
      // Directory doesn't exist or can't be read
      return 0;
    }
  }

  /**
   * Get all session data from session log directories
   */
  private async getAllSessionData(): Promise<SessionLogData[]> {
    const logsDir = path.join(this.projectPath, ".claude/logs");

    try {
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      const sessionDirs = entries.filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("session-")
      );

      const sessionData: SessionLogData[] = [];

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(logsDir, sessionDir.name);
        const data = await this.parseSessionLogs(sessionPath);

        if (data) {
          sessionData.push(data);
        }
      }

      return sessionData;
    } catch {
      // Logs directory doesn't exist
      return [];
    }
  }

  /**
   * Get default project settings
   */
  private getDefaultSettings(): ProjectSettings {
    return {
      fallback: "log",
      output_style: "default",
      routing: false,
      thinking_mode: false,
    };
  }

  /**
   * Get last activity timestamp for project
   */
  private async getLastActivityTime(): Promise<Date> {
    const logsDir = path.join(this.projectPath, ".claude/logs");

    try {
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      const sessionDirs = entries.filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("session-")
      );

      let latestTime = new Date(0);

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(logsDir, sessionDir.name);
        const stats = await fs.stat(sessionPath);

        if (stats.mtime > latestTime) {
          latestTime = stats.mtime;
        }
      }

      return latestTime;
    } catch {
      // Return epoch if no sessions found
      return new Date(0);
    }
  }

  /**
   * Parse session logs from a session directory
   */
  private async parseSessionLogs(sessionPath: string): Promise<SessionLogData | undefined> {
    try {
      const data: SessionLogData = {
        cost: 0,
        modelUsage: {},
        timestamp: new Date(0),
        tokens: 0,
      };

      // Try to read session metadata if it exists
      const metadataPath = path.join(sessionPath, "session-metadata.json");
      try {
        const metadataContent = await fs.readFile(metadataPath, "utf8");
        const metadata = JSON.parse(metadataContent) as {
          timestamp?: string;
          totalCost?: number;
          totalTokens?: number;
        };

        data.tokens = metadata.totalTokens ?? 0;
        data.cost = metadata.totalCost ?? 0;
        data.timestamp = metadata.timestamp !== undefined && metadata.timestamp !== "" ? new Date(metadata.timestamp) : new Date(0);
      } catch {
        // Metadata file doesn't exist - use directory stats
        const stats = await fs.stat(sessionPath);
        data.timestamp = stats.birthtime;
      }

      // Try to parse hook activity log for model usage
      const hookLogPath = path.join(sessionPath, "hook-activity.log");
      try {
        const content = await fs.readFile(hookLogPath, "utf8");
        const lines = content.split("\n");

        for (const line of lines) {
          const modelMatch = /Model:\s+(\S+)/.exec(line);
          if (modelMatch?.[1] !== undefined && modelMatch[1] !== "") {
            const model = modelMatch[1];
            data.modelUsage[model] = (data.modelUsage[model] ?? 0) + 1;
          }
        }
      } catch {
        // Hook activity log doesn't exist
      }

      return data;
    } catch {
      return undefined;
    }
  }
}
