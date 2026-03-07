/**
 * OAuthUsageClient - Fetch Claude OAuth usage limits from undocumented API
 *
 * Provides real-time usage data for Claude account limits:
 * - Five-hour rolling window utilization
 * - Seven-day rolling window utilization
 *
 * Implements caching (60s TTL) to minimize API calls to undocumented endpoint.
 *
 * @class OAuthUsageClient
 *
 * @example
 * const client = new OAuthUsageClient();
 * const usage = await client.fetchUsage();
 * if (usage) {
 *   console.log(`5h: ${usage.fiveHour.percentage}% (resets in ${usage.fiveHour.resetsIn})`);
 *   console.log(`7d: ${usage.sevenDay.percentage}% (resets in ${usage.sevenDay.resetsIn})`);
 * }
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createHttpError, retryWithBackoff } from "../utils/retry-with-backoff.js";
import { logUsageError } from "../utils/usage-error-log.js";

declare const fetch: typeof globalThis.fetch;
declare const AbortController: typeof globalThis.AbortController;

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CREDENTIALS_FILE = path.join(CLAUDE_DIR, ".credentials.json");
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 60_000; // 60 seconds
const API_TIMEOUT_MS = 5000; // 5 seconds
const OFFLINE_THRESHOLD = 3;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_IN_MS = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const TOKEN_EXPIRY_BUFFER_MINUTES = 5;
const TOKEN_EXPIRY_BUFFER_MS = TOKEN_EXPIRY_BUFFER_MINUTES * MINUTES_IN_MS; // Refresh token 5 minutes before expiry
const PERCENTAGE_MULTIPLIER = 100;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_SERVER_ERROR_MAX = 600;

/**
 * Raw OAuth usage API response
 */
export interface OAuthUsageResponse {
  [key: string]: boolean | JsonArray | JsonObject | null | number | string | undefined;
  five_hour: {
    resets_at: string;
    utilization: number;
  };
  seven_day: {
    resets_at: string;
    utilization: number;
  };
}

/**
 * Formatted usage metrics for display
 */
export interface UsageMetrics {
  fiveHour: {
    percentage: number;
    resetsAt: string;
    resetsIn: string;
  };
  isStale: boolean;
  lastUpdated: Date;
  sevenDay: {
    percentage: number;
    resetsAt: string;
    resetsIn: string;
  };
}

/**
 * Claude credentials file structure
 */
interface CredentialsFile {
  claudeAiOauth: {
    accessToken: string;
    expiresAt: number;
    rateLimitTier: string;
    refreshToken: string;
    scopes: string[];
    subscriptionType: string;
  };
}

/**
 * Error object with potential properties
 */
interface ErrorLike {
  code?: string;
  message?: string;
  name?: string;
  stack?: string;
  status?: number;
}

/**
 * JSON array type
 */
type JsonArray = JsonValue[];

/**
 * JSON object type
 */
interface JsonObject { [key: string]: JsonValue }

/**
 * Generic JSON value type
 */
type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

export default class OAuthUsageClient {
  private consecutiveFailures = 0;
  private inflightRequest: Promise<OAuthUsageResponse | undefined> | undefined = undefined;
  private isOffline = false;
  private lastFetchTime = 0;
  private usageCache: OAuthUsageResponse | undefined = undefined;

  /**
   * Clear the usage cache
   *
   * Call this after account switches or when you need to force
   * a fresh fetch from the API.
   *
   * @example
   * client.clearCache();
   * const freshUsage = await client.fetchUsage();
   */
  public clearCache(): void {
    this.usageCache = undefined;
    this.lastFetchTime = 0;
  }

  /**
   * Get real usage from OAuth API (cached)
   *
   * Returns usage data with five_hour and seven_day fields.
   * Results are cached for 60 seconds to avoid hammering the undocumented API.
   * Returns undefined on any error (never throws exceptions).
   *
   * @returns {Promise<UsageMetrics|undefined>} Usage metrics or undefined if unavailable
   *
   * @example
   * const client = new OAuthUsageClient();
   * const usage = await client.fetchUsage();
   * if (usage) {
   *   console.log(`5h usage: ${usage.fiveHour.percentage}%`);
   *   console.log(`Resets in: ${usage.fiveHour.resetsIn}`);
   * }
   */
  public async fetchUsage(): Promise<undefined | UsageMetrics> {
    try {
      const now = Date.now();

      // Return cached data if still fresh
      if (this.usageCache && (now - this.lastFetchTime) < CACHE_TTL_MS) {
        return this.parseUsageMetrics(this.usageCache, false);
      }

      // If request already in flight, wait for it instead of making new request
      if (this.inflightRequest !== undefined) {
        const result = await this.inflightRequest;
        if (result !== undefined) {
          return this.parseUsageMetrics(result, false);
        }
        return undefined;
      }

      // Get credentials and validate token
      const credentials = this.getCurrentCredentials();
      if (!credentials) {
        await logUsageError(
          "anthropic-oauth",
          "auth",
          "No credentials file found",
          { credentialsFile: CREDENTIALS_FILE }
        );
        return undefined;
      }

      const { accessToken, expiresAt } = credentials.claudeAiOauth;

      // Check token expiration
      if (this.isTokenExpired(expiresAt)) {
        await logUsageError(
          "anthropic-oauth",
          "auth",
          "Access token expired",
          { expiresAt: new Date(expiresAt).toISOString() }
        );
        return undefined;
      }

      // Set inflight request and fetch
      try {
        this.inflightRequest = this.fetchUsageFromAPI(accessToken);
        const response = await this.inflightRequest;

        // Cache successful results with completion timestamp
        if (response !== undefined) {
          this.usageCache = response;
          this.lastFetchTime = Date.now(); // Capture completion time
          return this.parseUsageMetrics(response, false);
        }

        return undefined;
      } finally {
        // Clear inflight request
        this.inflightRequest = undefined;
      }
    } catch (error) {
      const errorObj = error as Error | ErrorLike | null | string;
      const stackValue = this.isError(errorObj) ? (errorObj).stack : undefined;
      await logUsageError(
        "anthropic-oauth",
        "unexpected",
        this.sanitizeErrorMessage(`Unexpected error in fetchUsage: ${this.getErrorMessage(errorObj)}`),
        { stack: stackValue ?? "" }
      );
      return undefined;
    }
  }

  /**
   * Get usage with fallback to stale cache
   *
   * Attempts to fetch fresh data, but returns stale cached data
   * if the API is unavailable. Useful for displaying something
   * even when the undocumented endpoint breaks.
   *
   * @returns {Promise<UsageMetrics|undefined>} Usage metrics (potentially stale) or undefined
   */
  public async fetchUsageWithFallback(): Promise<undefined | UsageMetrics> {
    const freshUsage = await this.fetchUsage();

    // Return fresh data if available
    if (freshUsage !== undefined) {
      return freshUsage;
    }

    // Fallback to stale cache if API failed
    if (this.usageCache !== undefined) {
      return this.parseUsageMetrics(this.usageCache, true);
    }

    // No data available
    return undefined;
  }

  /**
   * Get API status
   *
   * @returns {Object} Status information for monitoring
   *
   * @example
   * const status = client.getStatus();
   * console.log(`API status: ${status.state}`);
   * if (status.state === 'offline') {
   *   console.log('Using cached data');
   * }
   */
  public getStatus(): {
    cacheAge?: number;
    consecutiveFailures: number;
    state: "offline" | "online" | "unknown";
    } {
    const cacheAge = this.lastFetchTime > 0
      ? Math.floor((Date.now() - this.lastFetchTime) / MILLISECONDS_PER_SECOND)
      : undefined;

    return {
      ...(cacheAge !== undefined && { cacheAge }),
      consecutiveFailures: this.consecutiveFailures,
      state: this.isOffline ? "offline" : "online"
    };
  }

  /**
   * Classify error type for logging and retry logic
   *
   * @private
   * @param {Error | ErrorLike | null | string} error - Error to classify
   * @returns {string} Error type (timeout, network, auth, server, unknown)
   */
  private classifyError(error: Error | ErrorLike | null | string): string {
    if (typeof error === "string") {
      return "unknown";
    }

    if (typeof error !== "object" || error === null) {
      return "unknown";
    }

    const errorObj = error;

    // Check error name for abort errors
    if ("name" in errorObj && errorObj.name === "AbortError") {
      return "timeout";
    }

    // Check error codes for network errors
    if ("code" in errorObj) {
      const code = errorObj.code;
      if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENETUNREACH" || code === "ENOTFOUND") {
        return "network";
      }
      if (code === "ETIMEDOUT") {
        return "timeout";
      }
    }

    // Check status codes for HTTP errors
    if ("status" in errorObj && typeof errorObj.status === "number") {
      const status = errorObj.status;
      if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
        return "auth";
      }
      if (status === HTTP_STATUS_TOO_MANY_REQUESTS) {
        return "rate-limit";
      }
      if (status >= HTTP_STATUS_SERVER_ERROR_MIN && status < HTTP_STATUS_SERVER_ERROR_MAX) {
        return "server";
      }
      if (status >= HTTP_STATUS_BAD_REQUEST && status < HTTP_STATUS_SERVER_ERROR_MIN) {
        return "client";
      }
    }

    return "unknown";
  }

  /**
   * Fetch usage data from Anthropic OAuth API with timeout and retry
   *
   * Implements:
   * - 5-second timeout using AbortController
   * - Exponential backoff retry for transient errors
   * - Required anthropic-beta header for undocumented API
   * - Circuit breaker via offline detection
   *
   * @private
   * @param {string} accessToken - OAuth access token
   * @returns {Promise<OAuthUsageResponse|undefined>} Usage data or undefined on error
   */
  private async fetchUsageFromAPI(accessToken: string): Promise<OAuthUsageResponse | undefined> {
    // Skip retries if already marked offline
    if (this.isOffline) {
      await logUsageError(
        "anthropic-oauth",
        "circuit-breaker",
        "API marked offline, skipping request",
        { consecutiveFailures: this.consecutiveFailures }
      );
      return undefined;
    }

    try {
      // Retry with exponential backoff for transient errors
      const result = await retryWithBackoff<JsonValue>(
        async (): Promise<JsonValue> => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => { controller.abort(); }, API_TIMEOUT_MS);

          try {
            const response = await fetch(USAGE_ENDPOINT, {
              headers: {
                "Accept": "application/json, text/plain, */*",
                "anthropic-beta": "oauth-2025-04-20", // Required for undocumented API
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": "claude-code/2.0.32"
              },
              method: "GET",
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              // Create HTTP error with status for retry logic
              throw createHttpError(response.status, `HTTP ${String(response.status)}`);
            }

            const rawData: JsonValue = await response.json() as JsonValue;

            // Log full API response to see what fields are available
            console.log("[OAuthUsageClient] RAW API RESPONSE:", JSON.stringify(rawData, null, 2));

            if (!this.isValidUsageResponse(rawData)) {
              throw createHttpError(
                response.status,
                "API returned invalid response structure"
              );
            }

            return rawData;
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

      // Cast validated result to OAuthUsageResponse
      const validatedResult = result as OAuthUsageResponse;

      // Success - reset failure counters
      this.consecutiveFailures = 0;
      this.isOffline = false;
      return validatedResult;

    } catch (error) {
      // All retries exhausted - record failure
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= OFFLINE_THRESHOLD) {
        this.isOffline = true;
      }

      await logUsageError(
        "anthropic-oauth",
        this.classifyError(error as Error | ErrorLike | null | string),
        this.sanitizeErrorMessage(this.getErrorMessage(error as Error | ErrorLike | null | string)),
        {
          consecutiveFailures: this.consecutiveFailures,
          isOffline: this.isOffline
        }
      );

      return undefined;
    }
  }

  /**
   * Format time until usage reset
   *
   * @param {string} resetAt - ISO 8601 timestamp for reset
   * @returns {string} Formatted time string (e.g., "2h 15m", "1d 3h", "45m")
   */
  private formatTimeUntilReset(resetAt: string): string {
    if (!resetAt) return "unknown";

    const now = new Date();
    const reset = new Date(resetAt);
    const diffMs = reset.getTime() - now.getTime();

    if (diffMs <= 0) return "now";

    const msPerHour = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
    const msPerMinute = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE;
    const hours = Math.floor(diffMs / msPerHour);
    const minutes = Math.floor((diffMs % msPerHour) / msPerMinute);

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
   * @returns {CredentialsFile|undefined} Credentials object or undefined if not found
   */
  private getCurrentCredentials(): CredentialsFile | undefined {
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const content = fs.readFileSync(CREDENTIALS_FILE, "utf8");
        return JSON.parse(content) as CredentialsFile;
      }
    } catch {
      // Ignore file read errors - credentials may not exist yet
    }
    return undefined;
  }

  /**
   * Extract error message safely from error
   *
   * @private
   * @param {Error | ErrorLike | null | string} error - Error value
   * @returns {string} Error message or string representation
   */
  private getErrorMessage(error: Error | ErrorLike | null | string): string {
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof (error as Record<string, JsonValue>).message === "string") {
      const msg = (error as Record<string, string>).message;
      return msg ?? "";
    }
    return JSON.stringify(error);
  }

  /**
   * Type guard for Error objects
   *
   * @private
   * @param {Error | ErrorLike | null | string} error - Value to check
   * @returns {boolean} True if value is an Error instance
   */
  private isError(error: Error | ErrorLike | null | string): error is Error {
    return error instanceof Error;
  }

  /**
   * Check if access token is expired
   *
   * @private
   * @param {number} expiresAt - Expiration timestamp in milliseconds
   * @returns {boolean} True if token is expired or will expire within 5 minutes
   */
  private isTokenExpired(expiresAt: number): boolean {
    const now = Date.now();
    return now >= (expiresAt - TOKEN_EXPIRY_BUFFER_MS);
  }

  /**
   * Type guard for OAuth usage API response
   *
   * Validates runtime structure of API response to catch schema changes
   * or malformed data before it causes issues downstream.
   *
   * @private
   * @param {JsonValue} data - Data to validate
   * @returns {boolean} True if data matches OAuthUsageResponse schema
   */
  private isValidUsageResponse(data: JsonValue): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return false;
    }

    const response = data;

    // Validate five_hour field
    if (typeof response.five_hour !== "object" || response.five_hour === null || Array.isArray(response.five_hour)) {
      return false;
    }
    const fiveHour = response.five_hour;
    if (typeof fiveHour.utilization !== "number" || typeof fiveHour.resets_at !== "string") {
      return false;
    }

    // Validate seven_day field
    if (typeof response.seven_day !== "object" || response.seven_day === null || Array.isArray(response.seven_day)) {
      return false;
    }
    const sevenDay = response.seven_day;
    if (typeof sevenDay.utilization !== "number" || typeof sevenDay.resets_at !== "string") {
      return false;
    }

    return true;
  }

  /**
   * Parse OAuth usage response into user-friendly metrics
   *
   * Converts utilization (0.0-1.0) to percentage and formats reset times.
   *
   * @param {OAuthUsageResponse} response - Raw OAuth API response
   * @param {boolean} isStale - Whether data is from stale cache
   * @returns {UsageMetrics} Formatted usage metrics
   */
  private parseUsageMetrics(response: OAuthUsageResponse, isStale: boolean): UsageMetrics {
    return {
      fiveHour: {
        percentage: Math.round(response.five_hour.utilization * PERCENTAGE_MULTIPLIER),
        resetsAt: response.five_hour.resets_at,
        resetsIn: this.formatTimeUntilReset(response.five_hour.resets_at)
      },
      isStale,
      lastUpdated: new Date(),
      sevenDay: {
        percentage: Math.round(response.seven_day.utilization * PERCENTAGE_MULTIPLIER),
        resetsAt: response.seven_day.resets_at,
        resetsIn: this.formatTimeUntilReset(response.seven_day.resets_at)
      }
    };
  }

  /**
   * Sanitize sensitive data from error messages and logs
   *
   * Removes access tokens that may appear in error messages to prevent
   * token leakage in log files.
   *
   * @private
   * @param {string} message - Error message that may contain tokens
   * @returns {string} Sanitized message with tokens masked
   */
  private sanitizeErrorMessage(message: string): string {
    // Redact Bearer tokens (format: "Bearer abc123xyz...")
    return message
      .replaceAll(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replaceAll(/access[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+/gi, "access_token=[REDACTED]")
      .replaceAll(/token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+/gi, "token=[REDACTED]");
  }
}
