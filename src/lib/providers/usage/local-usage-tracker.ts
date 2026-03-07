
import { glob } from "glob";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * LocalUsageTracker parses Claude Code session logs to estimate token usage
 * when provider APIs are unavailable.
 *
 * Usage data is clearly marked as "estimated" to distinguish from API-sourced data.
 */

interface CacheData {
  cachedTokens: number;
  estimatedAt: Date;
  inputTokens: number;
  isEstimated: boolean;
  outputTokens: number;
  totalTokens: number;
}

interface LogEntry {
  message?: {
    usage?: {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  timestamp?: string;
}

interface UsageOptions {
  endTime?: Date;
  sessionPath?: string;
  startTime?: Date;
}

const CACHE_TTL_SECONDS = 60;
const MILLISECONDS_PER_SECOND = 1000;

export class LocalUsageTracker {
  cache: Map<string, { data: CacheData; timestamp: number }>;
  cacheTTLMs: number;

  constructor() {
    // In-memory cache for parsed session data
    // Format: Map<cacheKey, {data, timestamp}>
    this.cache = new Map();
    this.cacheTTLMs = CACHE_TTL_SECONDS * MILLISECONDS_PER_SECOND; // 60-second TTL
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Create empty/zero usage response
   *
   * @private
   */
  createEmptyUsage(): CacheData {
    return {
      cachedTokens: 0,
      estimatedAt: new Date(),
      inputTokens: 0,
      isEstimated: true,
      outputTokens: 0,
      totalTokens: 0
    };
  }

  /**
   * Generate cache key from options
   *
   * @private
   */
  generateCacheKey(options: UsageOptions): string {
    const parts = [
      options.sessionPath ?? "all",
      options.startTime?.getTime() ?? "0",
      options.endTime?.getTime() ?? "now"
    ];
    return parts.join(":");
  }

  /**
   * Get cached result if still valid
   *
   * @private
   */
  getCachedResult(cacheKey: string): CacheData | undefined {
    const cached = this.cache.get(cacheKey);

    if (cached === undefined) {
      return undefined;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTTLMs) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return cached.data;
  }

  /**
   * Get usage from session logs, with optional filtering
   *
   * @param {Object} options
   * @param {string} options.sessionPath - Path to session (e.g., "project/path")
   * @param {Date} options.startTime - Filter entries after this time
   * @param {Date} options.endTime - Filter entries before this time
   * @returns {Promise<{inputTokens: number, outputTokens: number, cachedTokens: number, totalTokens: number, estimatedAt: Date, isEstimated: boolean}>}
   */
  async getUsage(options: UsageOptions = {}): Promise<CacheData> {
    const cacheKey = this.generateCacheKey(options);
    const cached = this.getCachedResult(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const usage = await this.parseSessionLogs(options);

    // Cache the result
    this.cache.set(cacheKey, {
      data: usage,
      timestamp: Date.now()
    });

    return usage;
  }

  /**
   * Parse a single JSONL file
   *
   * @private
   */
  async parseFile(filePath: string, options: UsageOptions = {}): Promise<{ cachedTokens: number; inputTokens: number; outputTokens: number; }> {
    if (!existsSync(filePath)) {
      return { cachedTokens: 0, inputTokens: 0, outputTokens: 0 };
    }

    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter((l: string) => l.trim() !== "");

      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;

          // Apply time range filters if provided

          if (options.startTime !== undefined || options.endTime !== undefined) {
            const entryTime = entry.timestamp === undefined ? undefined : new Date(entry.timestamp);
            if (entryTime === undefined) continue;

            if (options.startTime !== undefined && entryTime < options.startTime) continue;

            if (options.endTime !== undefined && entryTime > options.endTime) continue;
          }

          // Extract tokens from message.usage
          if (entry.message?.usage !== undefined) {
            const usage = entry.message.usage;
            inputTokens += usage.input_tokens ?? 0;
            outputTokens += usage.output_tokens ?? 0;
            cachedTokens += (usage.cache_read_input_tokens ?? 0) +
                           (usage.cache_creation_input_tokens ?? 0);
          }
        } catch {
          // Skip malformed JSON lines - this matches claudeUsage.js pattern
          continue;
        }
      }

      return { cachedTokens, inputTokens, outputTokens };
    } catch {
      // File read error - return empty
      return { cachedTokens: 0, inputTokens: 0, outputTokens: 0 };
    }
  }

  /**
   * Parse JSONL files from ~/.claude/projects/{path}/*.jsonl
   *
   * @private
   */
  async parseSessionLogs(options: UsageOptions = {}): Promise<CacheData> {
    const logDir = path.join(os.homedir(), ".claude", "projects");

    let pattern = "**/*.jsonl";

    if (options.sessionPath !== undefined && options.sessionPath !== "") {

      pattern = path.join(options.sessionPath, "*.jsonl");
    }

    try {
      // Find all matching JSONL files
      const files = await glob(pattern, {
        absolute: false,
        cwd: logDir
      });

      if (files.length === 0) {
        return this.createEmptyUsage();
      }

      // Parse each file and accumulate tokens
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;

      for (const file of files) {
        const filePath = path.join(logDir, file);
        const fileUsage = await this.parseFile(filePath, options);

        inputTokens += fileUsage.inputTokens;
        outputTokens += fileUsage.outputTokens;
        cachedTokens += fileUsage.cachedTokens;
      }

      const totalTokens = inputTokens + outputTokens + cachedTokens;

      return {
        cachedTokens,
        estimatedAt: new Date(),
        inputTokens,
        isEstimated: true,
        outputTokens,
        totalTokens
      };
    } catch {
      // Return empty usage on any error
      return this.createEmptyUsage();
    }
  }
}
