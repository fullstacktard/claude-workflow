/**
 * ApiUsageTracker - Track API usage via Anthropic OAuth endpoint
 *
 * Fetches real-time usage data from Anthropic's OAuth API endpoint.
 * Implements caching to avoid excessive API calls (60-second TTL).
 * Includes graceful degradation with timeout, retry, and offline detection.
 * Used by AnthropicProvider to provide usage tracking functionality.
 *
 * @class ApiUsageTracker
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createHttpError, retryWithBackoff } from "../../utils/retry-with-backoff.js";
import { logUsageError } from "../../utils/usage-error-log.js";

declare const fetch: typeof globalThis.fetch;
declare const AbortController: typeof globalThis.AbortController;

// Interfaces for type safety
interface ClaudeOAuthCredentials {
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeOAuthCredentials;
}

interface ErrorWithCode {
  code?: string;
  message: string;
  name?: string;
  status?: number;
}

interface UsageData {
  five_hour?: {
    request_count: number;
    reset_at: string;
  };
  seven_day?: {
    request_count: number;
    reset_at: string;
  };
}

// Constants
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CREDENTIALS_FILE = path.join(CLAUDE_DIR, ".credentials.json");
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 60_000; // Cache TTL: 60 seconds
const API_TIMEOUT_MS = 5000; // 5 second timeout
const OFFLINE_THRESHOLD = 3; // Mark offline after 3 failures

// Time constants (extracted magic numbers)
const MINUTES_TO_MS = 60;
const MS_PER_SECOND = 1000;
const OFFLINE_WINDOW_MINUTES = 5;
const RECOVERY_WINDOW_MINUTES = 10;
const HOURS_PER_DAY = 24;
const MINUTES_IN_HOUR = 60;
const SECONDS_IN_MINUTE = 60;
const MS_IN_MINUTE = 60_000;

const OFFLINE_WINDOW_MS = OFFLINE_WINDOW_MINUTES * MINUTES_TO_MS * MS_PER_SECOND;
const RECOVERY_WINDOW_MS = RECOVERY_WINDOW_MINUTES * MINUTES_TO_MS * MS_PER_SECOND;

// HTTP Status codes
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
const HTTP_STATUS_CLIENT_ERROR_MAX = 500;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_SERVER_ERROR_MAX = 600;

export default class ApiUsageTracker {
  consecutiveFailures = 0;
  failureHistory: { error: string; time: number; type: string }[];
  isOffline = false;
  lastFetchTime = 0;
  offlineSince: number | undefined = undefined;
  usageCache: undefined | UsageData = undefined;

  constructor() {
    // Instance-level cache - prevents stale data after account switching

    // Offline detection and circuit breaker
    this.failureHistory = []; // { time, error, type }
  }

  /**
   * Classify error type for logging and retry logic
   *
   * @private
   * @param {Error} error - Error to classify
   * @returns {string} Error type (timeout, network, auth, server, unknown)
   */
  classifyError(error: ErrorWithCode): string {
    if (error.name === "AbortError") return "timeout";
    if (error.code === "ECONNREFUSED") return "network";
    if (error.code === "ECONNRESET") return "network";
    if (error.code === "ETIMEDOUT") return "timeout";
    if (error.code === "ENETUNREACH") return "network";
    if (error.code === "ENOTFOUND") return "network";

    if (error.status === HTTP_STATUS_UNAUTHORIZED || error.status === HTTP_STATUS_FORBIDDEN) return "auth";
    if (error.status === HTTP_STATUS_TOO_MANY_REQUESTS) return "rate-limit";
    if (error.status !== undefined && error.status >= HTTP_STATUS_SERVER_ERROR_MIN && error.status < HTTP_STATUS_SERVER_ERROR_MAX) return "server";
    if (error.status !== undefined && error.status >= HTTP_STATUS_CLIENT_ERROR_MIN && error.status < HTTP_STATUS_CLIENT_ERROR_MAX) return "client";

    return "unknown";
  }

  /**
   * Clear the usage cache
   *
   * Call this after account switches or when you need to force
   * a fresh fetch from the API.
   *
   * @example
   * tracker.clearCache();
   * const freshUsage = await tracker.fetchUsage();
   */
  clearCache(): void {
    this.usageCache = undefined;
    this.lastFetchTime = 0;
  }

  /**
   * Get real usage from OAuth API (cached)
   *
   * Returns usage data with five_hour and seven_day fields.
   * Results are cached for 60 seconds to avoid hammering the API.
   * Returns null on any error (never throws exceptions).
   *
   * @async
   * @returns {Promise<Object|null>} Usage data with five_hour and seven_day fields, or null if unavailable
   *
   * @example
   * const tracker = new ApiUsageTracker();
   * const usage = await tracker.fetchUsage();
   * if (usage) {
   *   console.log('5-hour usage:', usage.five_hour.request_count);
   *   console.log('7-day usage:', usage.seven_day.request_count);
   * }
   */
  async fetchUsage(): Promise<undefined | UsageData> {
    try {
      const now = Date.now();

      // Return cached data if still fresh
      if (this.usageCache !== undefined && (now - this.lastFetchTime) < CACHE_TTL_MS) {
        return this.usageCache;
      }

      const credentials = this.getCurrentCredentials();
      const accessToken = credentials?.claudeAiOauth?.accessToken;

      if (accessToken === undefined) {
        await logUsageError(
          "anthropic",
          "auth",
          "No access token available",
          { credentialsFile: CREDENTIALS_FILE }
        );
        return undefined;
      }

      const usage = await this.fetchUsageFromAPI(accessToken);

      // Cache successful results (undefined means failure)
      if (usage !== undefined) {
        this.usageCache = usage;
        this.lastFetchTime = now;
        return usage;
      }

      return undefined;
    } catch (error) {
      // Defensive catch - should never reach here since fetchUsageFromAPI returns null on error
      const errorObj = error as Error;
      await logUsageError(
        "anthropic",
        "unexpected",
        `Unexpected error in fetchUsage: ${errorObj.message}`,
         
        { stack: errorObj.stack ?? null }
      );
      return undefined;
    }
  }

  /**
   * Fetch usage data from Anthropic OAuth API with timeout and retry
   *
   * Implements:
   * - 5-second timeout using AbortController
   * - Exponential backoff retry for transient errors
   * - Detailed error logging
   * - Circuit breaker via offline detection
   *
   * @private
   * @param {string} accessToken - OAuth access token
   * @returns {Promise<Object>} Usage data or null on error
   */
  async fetchUsageFromAPI(accessToken: string): Promise<undefined | UsageData> {
    // Skip retries if already marked offline
    if (this.isOffline) {
      await logUsageError(
        "anthropic",
        "circuit-breaker",
        "API marked offline, skipping request",
         
        { offlineSince: this.offlineSince ?? null }
      );
      return undefined;
    }

    try {
      // Retry with exponential backoff for transient errors
      const result = await retryWithBackoff(
        async (): Promise<UsageData> => {

          const controller = new AbortController();

          const timeoutId = setTimeout((): void => { controller.abort(); }, API_TIMEOUT_MS);

          try {

            const response = await fetch(USAGE_ENDPOINT, {
              headers: {
                "Accept": "application/json",
                "anthropic-beta": "oauth-2025-04-20",
                "Authorization": `Bearer ${accessToken}`,
                "User-Agent": "claude-code/2.0.32"
              },
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              // Create HTTP error with status for retry logic
              throw createHttpError(response.status, `HTTP status ${String(response.status)}`);
            }

            return await response.json() as UsageData;
          } catch (error) {

            clearTimeout(timeoutId);
            throw error;
          }
        },
        {
          baseDelay: 100,
          maxRetries: 3
        }
      );

      // Success - record it
      this.recordSuccess();
      return result;

    } catch (error) {
      // All retries exhausted - record failure
      await this.recordFailure(error as ErrorWithCode);
      return undefined;
    }
  }

  /**
   * Format time until usage reset
   *
   * @param {string} resetAt - ISO 8601 timestamp for reset
   * @returns {string} Formatted time string (e.g., "2h 15m", "1d 3h", "45m")
   *
   * @example
   * const resetTime = tracker.formatTimeUntilReset('2025-11-28T15:30:00Z');
   * console.log(`Resets in: ${resetTime}`);
   */
  formatTimeUntilReset(resetAt: string): string {
    if (resetAt.length === 0) return "unknown";

    const now = new Date();
    const reset = new Date(resetAt);
    const diffMs = reset.getTime() - now.getTime();

    if (diffMs <= 0) return "now";

    const hours = Math.floor(diffMs / (MS_PER_SECOND * SECONDS_IN_MINUTE * MINUTES_IN_HOUR));
    const minutes = Math.floor((diffMs % (MS_PER_SECOND * SECONDS_IN_MINUTE * MINUTES_IN_HOUR)) / (MS_PER_SECOND * SECONDS_IN_MINUTE));

    if (hours === 0) return `${String(minutes)}m`;
    if (hours >= HOURS_PER_DAY) {
      const days = Math.floor(hours / HOURS_PER_DAY);
      const remainingHours = hours % HOURS_PER_DAY;
      return `${String(days)}d ${String(remainingHours)}h`;
    }
    return `${String(hours)}h ${String(minutes)}m`;
  }

  /**
   * Get current OAuth credentials from Claude's credential file
   *
   * @private
   * @returns {Object|null} Credentials object or null if not found
   */
  getCurrentCredentials(): CredentialsFile | undefined {
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8")) as CredentialsFile;
      }
    } catch {
      // Ignore file read errors - credentials may not exist yet
    }
    return undefined;
  }

  /**
   * Get current API status
   *
   * @returns {Object} Status information
   *
   * @example
   * const status = tracker.getStatus();
   * console.log(`API status: ${status.state}`);
   * if (status.offlineMinutes) {
   *   console.log(`Offline for ${status.offlineMinutes} minutes`);
   * }
   */
  getStatus(): {
    consecutiveFailures: number;
    offlineMinutes?: number;
    offlineSince?: number;
    recentFailures: number;
    state: string;
    } {
    if (this.isOffline) {
      const offlineMinutes = this.offlineSince === undefined ? 0 : Math.floor((Date.now() - this.offlineSince) / MS_IN_MINUTE);

      // Use conditional property assignment to avoid exactOptionalPropertyTypes issues
      return {
        consecutiveFailures: this.consecutiveFailures,
        ...(offlineMinutes > 0 && { offlineMinutes }),
        ...(this.offlineSince !== undefined && { offlineSince: this.offlineSince }),
        recentFailures: this.failureHistory.length,
        state: "offline"
      };
    }

    return {
      consecutiveFailures: this.consecutiveFailures,
      recentFailures: this.failureHistory.length,
      state: "online"
    };
  }

  /**
   * Record a failure and update offline detection
   *
   * Tracks consecutive failures and marks API as offline
   * if 3+ failures occur within 5-minute window.
   *
   * @private
   * @async
   * @param {Error} error - Error that occurred
   * @returns {Promise<void>}
   */
  async recordFailure(error: ErrorWithCode): Promise<void> {
    this.consecutiveFailures++;

    // Classify error type
    const errorType = this.classifyError(error);

    // Add to failure history
    this.failureHistory.push({
      error: error.message,
      time: Date.now(),
      type: errorType
    });

    // Keep only recent failures (last 5 minutes)
    const cutoffTime = Date.now() - OFFLINE_WINDOW_MS;
    this.failureHistory = this.failureHistory.filter((f): boolean => f.time > cutoffTime);

    // Mark offline if 3+ failures in last 5 minutes
    if (this.failureHistory.length >= OFFLINE_THRESHOLD) {
      this.isOffline = true;
      this.offlineSince = this.offlineSince ?? Date.now();
    }

    // Log the failure
    await logUsageError(
      "anthropic",
      errorType,
      error.message,
      {
        consecutiveFailures: this.consecutiveFailures,
        isOffline: this.isOffline,
        recentFailures: this.failureHistory.length
      }
    );
  }

  /**
   * Record a successful API call
   *
   * Resets failure counters and auto-recovers from offline state
   * if successful for 10 minutes.
   *
   * @private
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;

    // Auto-recover if offline for more than 10 minutes
    if (this.offlineSince !== undefined && (Date.now() - this.offlineSince) > RECOVERY_WINDOW_MS) {
      this.isOffline = false;
      this.offlineSince = undefined;
      this.failureHistory = [];
    }
  }
}
