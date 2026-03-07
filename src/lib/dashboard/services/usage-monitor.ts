/**
 * UsageMonitor - Multi-account OAuth usage monitoring service
 *
 * Monitors usage metrics (5h/7d utilization) for all stored OAuth accounts,
 * enabling the dashboard to show real-time usage and enabling intelligent
 * account switching based on remaining capacity.
 *
 * Features:
 * - Real-time polling of all OAuth accounts
 * - Threshold-based warning and limit events
 * - Proactive rotation triggering when active account hits limits
 * - Intelligent account selection based on utilization and reset times
 *
 * @example
 * const monitor = new UsageMonitor(accountManager, {
 *   autoRotation: true,  // Enable proactive rotation (default)
 * });
 *
 * // Set the active account for rotation tracking
 * monitor.setActiveAccountId('current-account-id');
 *
 * // Listen for rotation recommendations
 * monitor.on('rotation-needed', ({ currentAccountId, recommendedAccountId, reason }) => {
 *   console.log(`Switch from ${currentAccountId} to ${recommendedAccountId}`);
 *   console.log(`Reason: ${reason}`);
 *   // Perform account switch...
 * });
 *
 * monitor.on('limit-warning', ({ accountId, usage }) => {
 *   console.log(`Account ${accountId} at ${usage.fiveHour.percentage}% usage`);
 * });
 *
 * monitor.start(); // Begin polling
 *
 * // Get account with most capacity (simple)
 * const bestAccount = monitor.getAccountWithMostCapacity();
 *
 * // Get best account for rotation with fallback (recommended)
 * const candidate = monitor.getBestAccountForRotation('current-account-id');
 * if (candidate) {
 *   console.log(`Switch to: ${candidate.accountId}`);
 *   console.log(`Reason: ${candidate.selectionReason}`);
 *   console.log(`Utilization: ${candidate.utilization}%`);
 *   console.log(`Resets in: ${Math.round(candidate.resetsInMs / 60000)}min`);
 * }
 */

import { EventEmitter } from "node:events";

import { AccountManager } from "../../account/account-manager.js";
import type { Account } from "../../account/types/account.js";
import type { OAuthUsageResponse } from "../oauth-usage-client.js";
import { systemLogger } from "./system-logger.js";
import {
  convertHeaderDataToUsageMetrics,
  isUsageDataStale,
  readUsageFromCache,
} from "./usage-cache-reader.js";

import type {
  AccountUsageMetrics,
  RotationCandidate,
  RotationNeededEvent,
  UsageMonitorOptions,
  UsageThresholdEvent,
} from "./types/usage.js";

const DEFAULT_POLL_INTERVAL = 60_000; // 60 seconds
const DEFAULT_WARNING_THRESHOLD = 80; // 80% utilization
const DEFAULT_LIMIT_THRESHOLD = 95; // 95% utilization
const DEFAULT_AUTO_ROTATION = true; // Enable proactive rotation by default
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export class UsageMonitor extends EventEmitter {
  private readonly accountManager: AccountManager;
  private readonly autoRotation: boolean;
  private readonly limitThreshold: number;
  private readonly pollInterval: number;
  private readonly warningThreshold: number;
  private activeAccountId: string | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private usageCache: Map<string, AccountUsageMetrics> = new Map();

  /**
   * Create a new UsageMonitor
   *
   * @param accountManager - AccountManager instance to get accounts from
   * @param options - Configuration options
   */
  constructor(
    accountManager: AccountManager,
    options: UsageMonitorOptions = {}
  ) {
    super();
    this.accountManager = accountManager;
    this.autoRotation = options.autoRotation ?? DEFAULT_AUTO_ROTATION;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.warningThreshold = options.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    this.limitThreshold = options.limitThreshold ?? DEFAULT_LIMIT_THRESHOLD;
  }

  /**
   * Fetch usage metrics for all stored OAuth accounts
   *
   * Polls all accounts in parallel using Promise.allSettled to isolate errors.
   * Updates cache, emits events, and checks thresholds.
   *
   * @returns Map of accountId to UsageMetrics
   */
  public async fetchAllUsage(): Promise<Map<string, AccountUsageMetrics>> {
    const usageMap = new Map<string, AccountUsageMetrics>();
    const accounts = await this.accountManager.getAccounts();

    if (accounts.length === 0) {
      return usageMap;
    }

    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const usage = await this.fetchUsageForAccount(account.id);
        return { accountId: account.id, usage };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.usage !== undefined) {
        usageMap.set(result.value.accountId, result.value.usage);
      }
    }

    // Update cache and emit events
    this.usageCache = usageMap;
    this.emit("usage-updated", usageMap);

    // Check thresholds and emit warnings
    this.checkThresholdsAndEmit(usageMap);

    return usageMap;
  }

  /**
   * Fetch usage metrics for a specific OAuth account
   *
   * @param accountId - Unique identifier for the OAuth account
   * @returns UsageMetrics or undefined if unavailable
   */
  public async fetchUsageForAccount(
    accountId: string
  ): Promise<AccountUsageMetrics | undefined> {
    const account = await this.accountManager.getAccount(accountId);

    if (account === undefined) {
      return undefined;
    }

    const accountUuid = account.metadata.accountUuid;

    // Use cached rate limit header data from proxy responses
    // This works uniformly for all token types (OAuth and long-lived/setup tokens)
    // Headers are cached by the proxy on every successful /v1/messages response
    let cachedData = readUsageFromCache(accountId);
    if (!cachedData && accountUuid) {
      cachedData = readUsageFromCache(accountUuid);
    }
    if (cachedData) {
      const converted = convertHeaderDataToUsageMetrics(cachedData);
      const isStale = isUsageDataStale(cachedData);
      return {
        ...this.parseUsageMetrics(converted, isStale),
        accountId,
        accountName: this.getAccountName(account),
      };
    }

    // No cached data yet - account hasn't made any requests through the proxy
    return undefined;
  }

  /**
   * Get the currently set active account ID
   *
   * @returns The active account ID or undefined if not set
   */
  public getActiveAccountId(): string | undefined {
    return this.activeAccountId;
  }

  /**
   * Set the currently active account for rotation tracking
   *
   * This is used by checkThresholdsAndEmit to determine if the account
   * that hit the threshold is the active one, triggering rotation-needed events.
   *
   * @param accountId - The currently active account ID, or undefined to clear
   */
  public setActiveAccountId(accountId: string | undefined): void {
    this.activeAccountId = accountId;
  }

  /**
   * Get the account with the most remaining capacity
   *
   * Uses 5-hour utilization as the metric (most restrictive window).
   * Skips stale data and accounts at or above limit threshold.
   *
   * @returns Account ID with lowest utilization, or undefined if none available
   */
  public getAccountWithMostCapacity(): string | undefined {
    if (this.usageCache.size === 0) {
      return undefined;
    }

    let bestAccountId: string | undefined;
    let lowestUtilization = Number.POSITIVE_INFINITY;

    for (const [accountId, usage] of this.usageCache) {
      // Skip stale data
      if (usage.isStale) {
        continue;
      }

      // Skip accounts at or above limit
      if (usage.fiveHour.percentage >= this.limitThreshold) {
        continue;
      }

      if (usage.fiveHour.percentage < lowestUtilization) {
        lowestUtilization = usage.fiveHour.percentage;
        bestAccountId = accountId;
      }
    }

    return bestAccountId;
  }

  /**
   * Get the best account for rotation, prioritizing 5h limit availability
   *
   * Selection logic (5h limit is the immediate blocking constraint):
   * 1. Find accounts with 5h < 100% (immediately usable)
   * 2. Primary: Pick account with LOWEST 5h utilization (most headroom)
   * 3. Tiebreaker: If 5h utilization is equal, prefer lower weekly utilization
   * 4. Fallback: If all at 5h >= 100%, pick soonest 5h reset
   * 5. Returns undefined if no valid candidates
   *
   * IMPORTANT: Weekly limit (7d) is NOT used as a primary filter.
   * An account with weekly=100% but 5h=50% can still process requests
   * for hours, making it more valuable than an account with weekly=50%
   * but 5h=100% (which is blocked RIGHT NOW).
   *
   * @param currentAccountId - Account to exclude (typically the active account)
   * @param excludeAccountIds - Additional accounts to exclude from selection
   * @returns Best rotation candidate or undefined if none available
   *
   * @example
   * const candidate = monitor.getBestAccountForRotation('current-id');
   * if (candidate) {
   *   console.log(`Switch to ${candidate.accountId} (${candidate.selectionReason})`);
   * }
   */
  public getBestAccountForRotation(
    currentAccountId?: string,
    excludeAccountIds?: string[]
  ): RotationCandidate | undefined {
    if (this.usageCache.size === 0) {
      return undefined;
    }

    // Build exclusion set for O(1) lookups
    const excludeSet = new Set<string>(excludeAccountIds ?? []);
    if (currentAccountId !== undefined) {
      excludeSet.add(currentAccountId);
    }

    // Collect valid candidates (non-stale, non-excluded)
    const candidates: Array<{
      accountId: string;
      usage: AccountUsageMetrics;
      resetsInMs: number;
    }> = [];

    for (const [accountId, usage] of this.usageCache) {
      // Skip excluded accounts
      if (excludeSet.has(accountId)) {
        continue;
      }

      // Skip stale data
      if (usage.isStale) {
        continue;
      }

      // Calculate milliseconds until reset
      const resetsInMs = this.calculateResetTimeMs(usage.fiveHour.resetsAt);

      candidates.push({
        accountId,
        usage,
        resetsInMs,
      });
    }

    // No valid candidates
    if (candidates.length === 0) {
      return undefined;
    }

    // STEP 1: Find accounts with 5h < 100% (immediately usable)
    // The 5h limit is the BLOCKING constraint - it determines if requests work RIGHT NOW.
    // An account with weekly=100% but 5h=50% can still process requests for hours.
    const usableNow = candidates.filter(
      (c) => c.usage.fiveHour.percentage < 100
    );

    // STEP 2: Primary selection - pick account with LOWEST 5h utilization
    // Among usable accounts, prefer the one with most 5h headroom
    if (usableNow.length > 0) {
      let bestAccount = usableNow[0];
      let lowestFiveHourUsage = bestAccount.usage.fiveHour.percentage;

      for (const candidate of usableNow) {
        const fiveHourUsage = candidate.usage.fiveHour.percentage;

        // Pick account with lower 5h utilization
        if (fiveHourUsage < lowestFiveHourUsage) {
          lowestFiveHourUsage = fiveHourUsage;
          bestAccount = candidate;
        }
        // Tiebreaker: if 5h utilization is equal, prefer account with lower weekly utilization
        else if (fiveHourUsage === lowestFiveHourUsage && candidate.usage.sevenDay.percentage < bestAccount.usage.sevenDay.percentage) {
          bestAccount = candidate;
        }
      }

      return {
        accountId: bestAccount.accountId,
        utilization: bestAccount.usage.fiveHour.percentage,
        resetsAt: bestAccount.usage.fiveHour.resetsAt,
        resetsInMs: bestAccount.resetsInMs,
        selectionReason: "lowest_utilization",
      };
    }

    // STEP 3: Fallback - all accounts have 5h >= 100% (all currently blocked)
    // Pick the one with soonest 5h reset (will be usable soonest)
    let soonestReset: (typeof candidates)[0] | undefined;
    let soonestResetMs = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate.resetsInMs < soonestResetMs) {
        soonestResetMs = candidate.resetsInMs;
        soonestReset = candidate;
      }
    }

    if (soonestReset !== undefined) {
      return {
        accountId: soonestReset.accountId,
        utilization: soonestReset.usage.fiveHour.percentage,
        resetsAt: soonestReset.usage.fiveHour.resetsAt,
        resetsInMs: soonestReset.resetsInMs,
        selectionReason: "soonest_reset",
      };
    }

    // Should never reach here, but TypeScript needs this
    return undefined;
  }

  /**
   * Start polling for usage metrics
   *
   * Performs immediate first poll, then polls at configured interval.
   * Safe to call multiple times (stops existing timer first).
   */
  public start(): void {
    if (this.pollTimer !== undefined) {
      this.stop();
    }

    // Immediate first poll
    void this.fetchAllUsage();

    // Set up interval
    this.pollTimer = setInterval(() => {
      void this.fetchAllUsage();
      this.markStaleData();
    }, this.pollInterval);
  }

  /**
   * Stop polling and clean up
   *
   * Clears interval timer and removes all event listeners.
   */
  public stop(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.removeAllListeners();
  }

  /**
   * Check usage thresholds and emit appropriate events
   *
   * Checks BOTH 5-hour and 7-day utilization limits. Rotation is triggered
   * if EITHER limit is exceeded.
   *
   * Emits:
   * - 'limit-reached': When any account hits 95%+ utilization (5h OR 7d)
   * - 'limit-warning': When any account hits 80%+ utilization (but below 95%)
   * - 'rotation-needed': When active account hits 95% AND autoRotation is enabled
   *
   * @private
   * @param usageMap - Map of account usage metrics
   */
  private checkThresholdsAndEmit(
    usageMap: Map<string, AccountUsageMetrics>
  ): void {
    for (const [accountId, usage] of usageMap) {
      const fiveHourUtilization = usage.fiveHour.percentage;
      const sevenDayUtilization = usage.sevenDay.percentage;
      const maxUtilization = Math.max(fiveHourUtilization, sevenDayUtilization);

      // Determine which limit was breached (if any)
      const breachedLimit: "5h" | "7d" | undefined =
        fiveHourUtilization >= this.limitThreshold ? "5h" :
          (sevenDayUtilization >= this.limitThreshold ? "7d" :
            undefined);

      if (maxUtilization >= this.limitThreshold) {
        this.emit("limit-reached", { accountId, usage } satisfies UsageThresholdEvent);

        // Check if this is the active account and auto-rotation is enabled
        if (this.autoRotation && this.activeAccountId === accountId) {
          this.triggerRotationIfNeeded(accountId, usage, breachedLimit ?? "5h");
        }
      } else if (maxUtilization >= this.warningThreshold) {
        this.emit("limit-warning", { accountId, usage } satisfies UsageThresholdEvent);
      } else {
        // Usage is below warning threshold - clear rate_limited status if set
        // This handles the case where cache data reset and account is now available
        void this.clearRateLimitedStatusIfNeeded(accountId);
      }
    }
  }

  /**
   * Clear rate_limited status if usage has dropped below threshold
   *
   * @private
   */
  private async clearRateLimitedStatusIfNeeded(accountId: string): Promise<void> {
    try {
      const account = await this.accountManager.getAccount(accountId);
      if (account?.metadata.status === "rate_limited") {
        await this.accountManager.updateAccount(accountId, {
          metadata: { status: "active" },
        });
        systemLogger.info("UsageMonitor", `Cleared rate_limited status for account ${accountId} (usage below threshold)`);
      }
    } catch {
      // Ignore update errors - non-critical
    }
  }

  /**
   * Trigger rotation-needed event if a suitable replacement account exists
   *
   * Uses getBestAccountForRotation() to find the best replacement account,
   * excluding the current account. Emits rotation-needed event with full
   * context for the rotation handler.
   *
   * @private
   * @param currentAccountId - The account that hit the threshold
   * @param usage - Current usage metrics for the breaching account
   * @param breachedLimit - Which limit was breached ("5h" or "7d")
   */
  private triggerRotationIfNeeded(
    currentAccountId: string,
    usage: AccountUsageMetrics,
    breachedLimit: "5h" | "7d"
  ): void {
    // Get best replacement account (excludes current account)
    const candidate = this.getBestAccountForRotation(currentAccountId);

    // Get utilization and reset info for the breached limit
    const breachedUsage = breachedLimit === "5h" ? usage.fiveHour : usage.sevenDay;

    if (candidate === undefined) {
      // Log but don't emit - no suitable replacement available
      systemLogger.warn("UsageMonitor", `Active account ${currentAccountId} hit ${breachedUsage.percentage}% ${breachedLimit} threshold, but no replacement accounts available`);
      return;
    }

    // Determine reason based on candidate selection
    const reason: RotationNeededEvent["reason"] =
      candidate.selectionReason === "lowest_utilization"
        ? "threshold_breach"
        : "soonest_reset";

    const event: RotationNeededEvent = {
      currentAccountId,
      recommendedAccountId: candidate.accountId,
      reason,
      resetsAt: breachedUsage.resetsAt,
      utilization: breachedUsage.percentage,
      breachedLimit,
    };

    // Log rotation event
    systemLogger.info("UsageMonitor", `Rotation needed: ${currentAccountId} -> ${candidate.accountId}`, {
      reason,
      breachedLimit,
      currentUtilization: breachedUsage.percentage,
      recommendedUtilization: candidate.utilization,
    });

    this.emit("rotation-needed", event);
  }

  /**
   * Format time until usage reset
   *
   * @private
   */
  private formatTimeUntilReset(resetAt: string): string {
    if (!resetAt) return "unknown";

    const now = new Date();
    const reset = new Date(resetAt);
    const diffMs = reset.getTime() - now.getTime();

    if (diffMs <= 0) return "now";

    const msPerHour = 1000 * 60 * 60;
    const msPerMinute = 1000 * 60;
    const hours = Math.floor(diffMs / msPerHour);
    const minutes = Math.floor((diffMs % msPerHour) / msPerMinute);

    if (hours === 0) return `${String(minutes)}m`;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${String(days)}d ${String(remainingHours)}h`;
    }
    return `${String(hours)}h ${String(minutes)}m`;
  }

  /**
   * Calculate milliseconds until reset time
   *
   * @private
   * @param resetsAt - ISO 8601 timestamp for reset
   * @returns Milliseconds until reset (0 if already passed)
   */
  private calculateResetTimeMs(resetsAt: string): number {
    if (!resetsAt) {
      return Number.POSITIVE_INFINITY;
    }

    const now = Date.now();
    const resetTime = new Date(resetsAt).getTime();
    const diffMs = resetTime - now;

    // Return 0 if reset time has passed
    return Math.max(diffMs, 0);
  }

  /**
   * Get human-readable account name
   *
   * @private
   */
  private getAccountName(account: Account): string {
    return (
      account.metadata.alias ??
      account.metadata.email ??
      account.id.slice(0, 8)
    );
  }

  /**
   * Mark cached data as stale if older than threshold
   *
   * @private
   */
  private markStaleData(): void {
    const now = Date.now();

    for (const [accountId, usage] of this.usageCache) {
      const age = now - usage.lastUpdated.getTime();
      if (age > STALE_THRESHOLD_MS) {
        // Create new object with isStale: true
        this.usageCache.set(accountId, {
          ...usage,
          isStale: true,
        });
      }
    }
  }

  /**
   * Parse OAuth usage response into user-friendly metrics
   *
   * @private
   */
  private parseUsageMetrics(
    response: OAuthUsageResponse,
    isStale: boolean
  ): Omit<AccountUsageMetrics, "accountId" | "accountName"> {
    // API returns utilization as percentage (0-100), not decimal
    return {
      fiveHour: {
        percentage: Math.round(response.five_hour.utilization),
        resetsAt: response.five_hour.resets_at,
        resetsIn: this.formatTimeUntilReset(response.five_hour.resets_at),
      },
      isStale,
      lastUpdated: new Date(),
      sevenDay: {
        percentage: Math.round(response.seven_day.utilization),
        resetsAt: response.seven_day.resets_at,
        resetsIn: this.formatTimeUntilReset(response.seven_day.resets_at),
      },
    };
  }
}
