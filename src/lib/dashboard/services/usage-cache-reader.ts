/**
 * Usage Cache Reader - Read header-based usage data for setup-token accounts
 *
 * Reads usage data captured from Anthropic API response headers by claude-proxy.
 * This enables usage tracking for setup-token accounts that cannot access the
 * OAuth usage API due to missing 'user:profile' scope.
 *
 * Data source: ~/.claude-workflow/usage-cache.json
 * Written by: claude-proxy (Python) after each API call
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { systemLogger } from "./system-logger.js";

const USAGE_CACHE_PATH = path.join(
  os.homedir(),
  ".claude-workflow",
  "usage-cache.json"
);

/**
 * Usage data from response headers for a single account (old format)
 */
export interface HeaderUsageData {
	/** ISO timestamp when this data was last updated */
	lastUpdated: string;
	/** Request limit for current window */
	requestsLimit: number;
	/** Requests remaining in current window */
	requestsRemaining: number;
	/** ISO timestamp when request limit resets */
	requestsReset: string | null;
	/** Token limit for current window */
	tokensLimit: number;
	/** Tokens remaining in current window */
	tokensRemaining: number;
	/** ISO timestamp when token limit resets */
	tokensReset: string;
}

/**
 * Usage data from unified rate limit headers (new format as of 2025)
 */
export interface UnifiedHeaderUsageData {
	/** Indicates this is the new unified format */
	unified: true;
	/** ISO timestamp when this data was last updated */
	lastUpdated: string;
	/** 5-hour window utilization (0.0-1.0) */
	fiveHourUtilization: number;
	/** Unix timestamp when 5-hour window resets */
	fiveHourReset: string;
	/** 7-day window utilization (0.0-1.0) */
	sevenDayUtilization: number;
	/** Unix timestamp when 7-day window resets */
	sevenDayReset: string;
}

/**
 * Usage data from response headers (supports both formats)
 */
export type CachedUsageData = HeaderUsageData | UnifiedHeaderUsageData;

/**
 * Usage cache file format
 */
interface UsageCacheFile {
	[accountUuid: string]: CachedUsageData;
}

/**
 * Formatted usage metrics compatible with OAuthUsageResponse format
 */
export interface FormattedUsageMetrics {
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

type JsonArray = Array<boolean | JsonObject | null | number | string>;
type JsonObject = { [key: string]: boolean | JsonArray | JsonObject | null | number | string };

/**
 * Read usage data for a specific account from the cache
 *
 * @param accountUuid - UUID of the account to read usage for
 * @returns Usage data or undefined if not available
 */
export function readUsageFromCache(
  accountUuid: string
): CachedUsageData | undefined {
  try {
    if (!fs.existsSync(USAGE_CACHE_PATH)) {
      return undefined;
    }

    const content = fs.readFileSync(USAGE_CACHE_PATH, "utf8");
    const cache = JSON.parse(content) as UsageCacheFile;

    return cache[accountUuid];
  } catch (error) {
    systemLogger.debug(
      "UsageCacheReader",
      `Failed to read usage cache: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/**
 * Convert header-based usage data to OAuth API format
 *
 * Handles both old format (token counts) and new unified format (utilization percentages).
 * When reset time has already passed, treats utilization as 0% (usage has reset).
 *
 * @param headerData - Usage data from response headers (old or new format)
 * @returns Formatted metrics compatible with OAuth API format
 */
export function convertHeaderDataToUsageMetrics(
  headerData: CachedUsageData
): FormattedUsageMetrics {
  const now = Date.now();

  // Check if this is the new unified format
  if ("unified" in headerData && headerData.unified) {
    // New format: utilization percentages are already provided
    // Convert Unix timestamps to ISO format
    const fiveHourResetMs = Number.parseInt(headerData.fiveHourReset) * 1000;
    const sevenDayResetMs = Number.parseInt(headerData.sevenDayReset) * 1000;

    const fiveHourReset = new Date(fiveHourResetMs).toISOString();
    const sevenDayReset = new Date(sevenDayResetMs).toISOString();

    // If reset time has passed, usage has reset to 0
    // (cached data is stale and no longer accurate)
    const fiveHourUtilization =
			fiveHourResetMs < now ? 0 : Math.round(headerData.fiveHourUtilization * 100);
    const sevenDayUtilization =
			sevenDayResetMs < now ? 0 : Math.round(headerData.sevenDayUtilization * 100);

    return {
      five_hour: {
        resets_at: fiveHourReset,
        utilization: fiveHourUtilization,
      },
      seven_day: {
        resets_at: sevenDayReset,
        utilization: sevenDayUtilization,
      },
    };
  }

  // Old format: calculate utilization from token counts
  // TypeScript needs explicit type assertion here
  const oldFormatData = headerData as HeaderUsageData;
  const tokensUsed = oldFormatData.tokensLimit - oldFormatData.tokensRemaining;
  const utilization =
		oldFormatData.tokensLimit > 0 ? tokensUsed / oldFormatData.tokensLimit : 0;

  // Convert to percentage (0-100 range like OAuth API)
  let utilizationPercentage = Math.round(utilization * 100);

  // If reset time has passed, usage has reset to 0
  if (oldFormatData.tokensReset) {
    const resetMs = new Date(oldFormatData.tokensReset).getTime();
    if (resetMs < now) {
      utilizationPercentage = 0;
    }
  }

  // The old header data typically represents a 5-hour window
  // We don't have separate 7-day data, so we use the same values
  return {
    five_hour: {
      resets_at: oldFormatData.tokensReset,
      utilization: utilizationPercentage,
    },
    seven_day: {
      resets_at: oldFormatData.tokensReset,
      utilization: utilizationPercentage,
    },
  };
}

/**
 * Check if usage data is stale
 *
 * Data is considered stale if it's older than 5 minutes.
 * Stale data should be used with caution or refreshed.
 *
 * @param headerData - Usage data to check (old or new format)
 * @returns True if data is stale
 */
export function isUsageDataStale(headerData: CachedUsageData): boolean {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  try {
    const lastUpdated = new Date(headerData.lastUpdated);
    const age = Date.now() - lastUpdated.getTime();
    return age > STALE_THRESHOLD_MS;
  } catch {
    // If we can't parse the date, consider it stale
    return true;
  }
}

/**
 * Get all cached usage data
 *
 * Useful for debugging or displaying all accounts.
 *
 * @returns Map of account UUID to usage data (both old and new format supported)
 */
export function getAllCachedUsage(): Map<string, CachedUsageData> {
  const result = new Map<string, CachedUsageData>();

  try {
    if (!fs.existsSync(USAGE_CACHE_PATH)) {
      return result;
    }

    const content = fs.readFileSync(USAGE_CACHE_PATH, "utf8");
    const cache = JSON.parse(content) as UsageCacheFile;

    for (const [accountUuid, data] of Object.entries(cache)) {
      result.set(accountUuid, data);
    }
  } catch (error) {
    systemLogger.warn(
      "UsageCacheReader",
      `Failed to read all cached usage: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

/**
 * Clear the usage cache
 *
 * Useful for testing or forcing a refresh.
 */
export function clearUsageCache(): void {
  try {
    if (fs.existsSync(USAGE_CACHE_PATH)) {
      fs.unlinkSync(USAGE_CACHE_PATH);
      systemLogger.info("UsageCacheReader", "Usage cache cleared");
    }
  } catch (error) {
    systemLogger.error(
      "UsageCacheReader",
      `Failed to clear usage cache: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
