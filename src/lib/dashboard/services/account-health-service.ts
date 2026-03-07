/**
 * AccountHealthService - Proactive health monitoring for X automation accounts
 *
 * Computes per-account health scores using a weighted composite formula,
 * detects shadow bans via self-search, and provides a 3-tier alerting system
 * (dashboard banners, toast notifications, browser Notification API) via
 * WebSocket event broadcasting.
 *
 * Features:
 * - 15-minute health check cycle via croner with overrun protection
 * - Daily shadow ban detection at 03:00 UTC using a checker account
 * - JSONL audit log for health check results (~/.claude-workflow/health/)
 * - Emergency auto-pause of ContentSchedulerService when health_score < 25
 * - Public recordSuccess/recordFailure API for other services to feed data
 *
 * Events:
 * - 'account_health_update': { accountId, handle, metrics } - Per-account health computed
 * - 'health_alert': HealthAlert - Alert generated for unhealthy account
 * - 'critical_health': { accountId, handle, healthScore, alert } - Emergency threshold breached
 *
 * @example
 * const healthService = new AccountHealthService(mcpToolClient, {
 *   checkerAccountId: process.env.HEALTH_CHECKER_ACCOUNT_ID,
 * });
 * healthService.start();
 *
 * // Wire to ContentSchedulerService for auto-pause
 * healthService.on('critical_health', (event) => {
 *   contentScheduler.stop();
 * });
 *
 * @module account-health-service
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

import { Cron } from "croner";

import type { McpToolClient } from "./mcp-tool-client.js";
import { systemLogger } from "./system-logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shadow ban detection status */
export type ShadowBanStatus =
  | "clear"
  | "search_ban"
  | "suggestion_ban"
  | "ghost_ban"
  | "unknown";

/** Shadow ban sub-metric */
export interface ShadowBanMetric {
  status: ShadowBanStatus;
  checked_at: string | null;
  search_visible: boolean;
}

/** Per-account health metrics computed each check cycle */
export interface AccountHealthMetrics {
  /** Error count in the last 24h rolling window */
  errors_24h: number;
  /** Success count in the last 24h rolling window */
  successes_24h: number;
  /** Error rate (0-1) */
  error_rate: number;
  /** ISO timestamp of last successful action */
  last_successful_action_at: string | null;
  /** ISO timestamp of last failed action */
  last_failed_action_at: string | null;
  /** Last error message */
  last_error_message: string | null;
  /** Cookie age in hours since harvest */
  cookie_age_hours: number;
  /** Shadow ban detection results */
  shadow_ban: ShadowBanMetric;
  /** Engagement velocity (likes per tweet, null until data available) */
  engagement_velocity: number | null;
  /** Composite health score 0-100 */
  health_score: number;
  /** ISO timestamp when metrics were computed */
  computed_at: string;
}

/** Health alert for dashboard notification */
export interface HealthAlert {
  /** Unique alert ID */
  id: string;
  /** Alert severity */
  severity: "critical" | "warning" | "info";
  /** Alert category */
  category:
    | "account_health"
    | "cookie_expiry"
    | "shadow_ban"
    | "rate_limit"
    | "system";
  /** Short title for dashboard banner */
  title: string;
  /** Detailed message */
  message: string;
  /** Account ID (if account-specific) */
  accountId?: string;
  /** X handle (if account-specific) */
  handle?: string;
  /** Optional action button for the alert */
  action?: {
    label: string;
    target: string;
  };
  /** Whether the user has acknowledged this alert */
  acknowledged: boolean;
  /** ISO timestamp when alert was created */
  created_at: string;
  /** Auto-dismiss timeout in ms, null = persistent */
  auto_dismiss_ms: number | null;
}

/** Configuration options for AccountHealthService */
export interface AccountHealthServiceOptions {
  /** Cron expression for health checks (default: every 15 min) */
  healthCheckExpression?: string;
  /** Cron expression for shadow ban checks (default: daily 03:00 UTC) */
  shadowBanExpression?: string;
  /** Directory for JSONL audit logs */
  logDirectory?: string;
  /** Account ID to use as the checker for shadow ban detection */
  checkerAccountId?: string;
}

/** Account shape returned by x_list_accounts MCP tool */
interface VaultAccount {
  id: string;
  handle: string;
  state: string;
  cookies?: {
    auth_token: string;
    ct0: string;
    harvested_at: string;
  };
  warming?: {
    day: number;
    started_at: string;
    actions_today: number;
    last_action_at: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH_CHECK_EXPRESSION = "*/15 * * * *";
const DEFAULT_SHADOW_BAN_EXPRESSION = "0 3 * * *";
const CRITICAL_HEALTH_THRESHOLD = 25;
const WARNING_HEALTH_THRESHOLD = 50;
const COOKIE_WARNING_AGE_HOURS = 168; // 7 days
const COOKIE_CRITICAL_AGE_HOURS = 720; // 30 days
const SHADOW_BAN_SEARCH_DELAY_MIN_MS = 3000;
const SHADOW_BAN_SEARCH_DELAY_RANGE_MS = 2000;

// Health score weights (must sum to 1.0)
const WEIGHT_ERROR_RATE = 0.3;
const WEIGHT_COOKIE_FRESHNESS = 0.2;
const WEIGHT_SHADOW_BAN = 0.25;
const WEIGHT_ACTIVITY = 0.15;
const WEIGHT_ENGAGEMENT = 0.1;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * AccountHealthService monitors X automation account health proactively.
 *
 * Extends EventEmitter following the XVaultWatcher/ContentSchedulerService
 * lifecycle pattern: constructor + start()/stop() + isActive().
 */
export class AccountHealthService extends EventEmitter {
  private readonly mcpToolClient: McpToolClient;
  private readonly healthCheckExpression: string;
  private readonly shadowBanExpression: string;
  private readonly logDirectory: string;
  private readonly checkerAccountId: string | undefined;
  private healthCheckJob: Cron | undefined;
  private shadowBanJob: Cron | undefined;
  private readonly healthStore: Map<string, AccountHealthMetrics> = new Map();

  constructor(
    mcpToolClient: McpToolClient,
    options: AccountHealthServiceOptions = {},
  ) {
    super();
    this.mcpToolClient = mcpToolClient;
    this.healthCheckExpression =
      options.healthCheckExpression ?? DEFAULT_HEALTH_CHECK_EXPRESSION;
    this.shadowBanExpression =
      options.shadowBanExpression ?? DEFAULT_SHADOW_BAN_EXPRESSION;
    this.checkerAccountId = options.checkerAccountId;

    const home =
      process.env["CLAUDE_HOME"] ?? process.env["HOME"] ?? "/tmp";
    this.logDirectory =
      options.logDirectory ??
      path.join(home, ".claude-workflow", "health");
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start health monitoring. Safe to call multiple times (stops existing jobs first).
   */
  public start(): void {
    if (this.healthCheckJob !== undefined) {
      this.stop();
    }

    // Ensure log directory exists
    if (!existsSync(this.logDirectory)) {
      mkdirSync(this.logDirectory, { recursive: true });
    }

    systemLogger.info("AccountHealthService", "Starting health monitoring", {
      healthCheckExpression: this.healthCheckExpression,
      shadowBanExpression: this.shadowBanExpression,
      checkerAccountConfigured: this.checkerAccountId !== undefined,
    });

    // Health check every 15 minutes with overrun protection
    this.healthCheckJob = new Cron(
      this.healthCheckExpression,
      { protect: true },
      () => {
        void this.runHealthChecks();
      },
    );

    // Shadow ban check daily at 03:00 UTC with overrun protection
    this.shadowBanJob = new Cron(
      this.shadowBanExpression,
      { protect: true },
      () => {
        void this.runShadowBanChecks();
      },
    );
  }

  /**
   * Stop health monitoring and clean up all resources.
   */
  public stop(): void {
    if (this.healthCheckJob !== undefined) {
      this.healthCheckJob.stop();
      this.healthCheckJob = undefined;
    }
    if (this.shadowBanJob !== undefined) {
      this.shadowBanJob.stop();
      this.shadowBanJob = undefined;
    }
    this.removeAllListeners();
    systemLogger.info("AccountHealthService", "Stopped health monitoring");
  }

  /**
   * Check if the service is currently running.
   */
  public isActive(): boolean {
    return this.healthCheckJob !== undefined;
  }

  // -------------------------------------------------------------------------
  // Public API - Query
  // -------------------------------------------------------------------------

  /**
   * Get the latest health metrics for a specific account.
   * @param accountId - The account ID to query
   * @returns Health metrics or undefined if no data yet
   */
  public getHealthMetrics(
    accountId: string,
  ): AccountHealthMetrics | undefined {
    return this.healthStore.get(accountId);
  }

  /**
   * Get health metrics for all monitored accounts.
   * @returns A copy of the internal health store
   */
  public getAllHealthMetrics(): Map<string, AccountHealthMetrics> {
    return new Map(this.healthStore);
  }

  // -------------------------------------------------------------------------
  // Public API - Error/Success Tracking
  // -------------------------------------------------------------------------

  /**
   * Record a successful action for an account.
   * Call from warming scheduler, tweet poster, or other services.
   * @param accountId - The account that performed the action
   */
  public recordSuccess(accountId: string): void {
    const existing = this.healthStore.get(accountId);
    if (existing) {
      existing.successes_24h += 1;
      existing.last_successful_action_at = new Date().toISOString();
    }
  }

  /**
   * Record a failed action for an account.
   * Call from warming scheduler, tweet poster, or other services.
   * @param accountId - The account that failed
   * @param errorMessage - Human-readable error description
   */
  public recordFailure(accountId: string, errorMessage: string): void {
    const existing = this.healthStore.get(accountId);
    if (existing) {
      existing.errors_24h += 1;
      existing.last_failed_action_at = new Date().toISOString();
      existing.last_error_message = errorMessage;
    }
  }

  /**
   * Reset 24h rolling window counters.
   * Call at midnight UTC or on a 24h rolling window expiry.
   */
  public resetDailyCounters(): void {
    for (const metrics of this.healthStore.values()) {
      metrics.errors_24h = 0;
      metrics.successes_24h = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Health Check Cycle
  // -------------------------------------------------------------------------

  /**
   * Run health checks for all active/warming accounts.
   * Called by croner every 15 minutes with overrun protection.
   */
  private async runHealthChecks(): Promise<void> {
    try {
      // Fetch all accounts from vault via MCP tool
      const result = await this.mcpToolClient.callTool<{
        accounts: VaultAccount[];
      }>("x_list_accounts");

      const checkableAccounts = result.accounts.filter(
        (a) => a.state === "active" || a.state === "warming",
      );

      if (checkableAccounts.length === 0) {
        return;
      }

      systemLogger.info(
        "AccountHealthService",
        `Running health checks for ${String(checkableAccounts.length)} accounts`,
      );

      for (const account of checkableAccounts) {
        const metrics = this.computeMetrics(account);
        this.healthStore.set(account.id, metrics);

        // Emit per-account health update
        this.emit("account_health_update", {
          accountId: account.id,
          handle: account.handle,
          metrics,
        });

        // Write to JSONL audit log
        this.writeAuditLog(account.id, account.handle, metrics);

        // Check thresholds and emit alerts
        if (metrics.health_score < CRITICAL_HEALTH_THRESHOLD) {
          const alert = this.buildAlert("critical", account, metrics);
          this.emit("health_alert", alert);
          // Emergency: emit critical_health for auto-pause
          this.emit("critical_health", {
            accountId: account.id,
            handle: account.handle,
            healthScore: metrics.health_score,
            alert,
          });
        } else if (metrics.health_score < WARNING_HEALTH_THRESHOLD) {
          const alert = this.buildAlert("warning", account, metrics);
          this.emit("health_alert", alert);
        }

        // Check cookie expiry specifically
        if (metrics.cookie_age_hours > COOKIE_WARNING_AGE_HOURS) {
          const cookieAlert: HealthAlert = {
            id: `cookie-expiry-${account.id}-${String(Date.now())}`,
            severity:
              metrics.cookie_age_hours > COOKIE_CRITICAL_AGE_HOURS
                ? "critical"
                : "warning",
            category: "cookie_expiry",
            title: `Cookie expiry: @${account.handle}`,
            message: `Cookies are ${String(Math.round(metrics.cookie_age_hours))}h old. Refresh recommended.`,
            accountId: account.id,
            handle: account.handle,
            action: {
              label: "Refresh Cookies",
              target: `/x-accounts/${account.id}`,
            },
            acknowledged: false,
            created_at: new Date().toISOString(),
            auto_dismiss_ms: null,
          };
          this.emit("health_alert", cookieAlert);
        }
      }
    } catch (error) {
      systemLogger.error(
        "AccountHealthService",
        "Error during health check cycle",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Health Score Computation
  // -------------------------------------------------------------------------

  /**
   * Compute health metrics for a single account using weighted composite formula:
   * - error_rate:        0.30
   * - cookie_freshness:  0.20
   * - shadow_ban:        0.25
   * - activity:          0.15
   * - engagement:        0.10
   *
   * @param account - Account data from vault
   * @returns Computed health metrics
   */
  private computeMetrics(account: VaultAccount): AccountHealthMetrics {
    const now = new Date();

    // --- Sub-score 1: Error rate (weight 0.30) ---
    const existing = this.healthStore.get(account.id);
    const errors24h = existing?.errors_24h ?? 0;
    const successes24h = existing?.successes_24h ?? 0;
    const total = errors24h + successes24h;
    const errorRate = total > 0 ? errors24h / total : 0;
    let errorRateScore: number;
    if (errorRate < 0.05) errorRateScore = 100;
    else if (errorRate < 0.15) errorRateScore = 75;
    else if (errorRate < 0.3) errorRateScore = 50;
    else if (errorRate < 0.5) errorRateScore = 25;
    else errorRateScore = 0;

    // --- Sub-score 2: Cookie freshness (weight 0.20) ---
    let cookieAgeHours = 0;
    let cookieFreshnessScore = 0;
    if (account.cookies?.harvested_at) {
      const harvestedAt = new Date(account.cookies.harvested_at);
      cookieAgeHours =
        (now.getTime() - harvestedAt.getTime()) / (1000 * 60 * 60);
      if (cookieAgeHours < 24) cookieFreshnessScore = 100;
      else if (cookieAgeHours < 72) cookieFreshnessScore = 85;
      else if (cookieAgeHours < 168) cookieFreshnessScore = 50;
      else if (cookieAgeHours < 720) cookieFreshnessScore = 25;
      else cookieFreshnessScore = 0;
    }

    // --- Sub-score 3: Shadow ban (weight 0.25) ---
    const shadowBan: ShadowBanMetric = existing?.shadow_ban ?? {
      status: "unknown",
      checked_at: null,
      search_visible: true,
    };
    let shadowBanScore: number;
    if (shadowBan.status === "clear") shadowBanScore = 100;
    else if (shadowBan.status === "unknown") shadowBanScore = 75;
    else shadowBanScore = 0;

    // --- Sub-score 4: Activity recency (weight 0.15) ---
    const lastAction =
      existing?.last_successful_action_at ??
      account.warming?.last_action_at ??
      null;
    let activityScore = 0;
    if (lastAction) {
      const hoursSinceAction =
        (now.getTime() - new Date(lastAction).getTime()) / (1000 * 60 * 60);
      if (hoursSinceAction < 4) activityScore = 100;
      else if (hoursSinceAction < 12) activityScore = 75;
      else if (hoursSinceAction < 24) activityScore = 50;
      else if (hoursSinceAction < 48) activityScore = 25;
      else activityScore = 0;
    }

    // --- Sub-score 5: Engagement velocity (weight 0.10) ---
    const engagementVelocity = existing?.engagement_velocity ?? null;
    // Normalize: assume baseline of 2 likes/tweet is "healthy" for warming accounts
    let engagementScore = 50; // default mid-score when no data
    if (engagementVelocity !== null) {
      if (engagementVelocity >= 5) engagementScore = 100;
      else if (engagementVelocity >= 2) engagementScore = 75;
      else if (engagementVelocity >= 0.5) engagementScore = 50;
      else engagementScore = 25;
    }

    // --- Composite health score ---
    const healthScore = Math.round(
      errorRateScore * WEIGHT_ERROR_RATE +
        cookieFreshnessScore * WEIGHT_COOKIE_FRESHNESS +
        shadowBanScore * WEIGHT_SHADOW_BAN +
        activityScore * WEIGHT_ACTIVITY +
        engagementScore * WEIGHT_ENGAGEMENT,
    );

    return {
      errors_24h: errors24h,
      successes_24h: successes24h,
      error_rate: Math.round(errorRate * 1000) / 1000,
      last_successful_action_at:
        existing?.last_successful_action_at ?? null,
      last_failed_action_at: existing?.last_failed_action_at ?? null,
      last_error_message: existing?.last_error_message ?? null,
      cookie_age_hours: Math.round(cookieAgeHours * 10) / 10,
      shadow_ban: shadowBan,
      engagement_velocity: engagementVelocity,
      health_score: healthScore,
      computed_at: now.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Shadow Ban Detection
  // -------------------------------------------------------------------------

  /**
   * Run shadow ban detection for all active/warming accounts.
   * Uses a checker account to search `from:{handle}` for each target account.
   * Runs daily at 03:00 UTC with 3-5s delay between searches.
   */
  private async runShadowBanChecks(): Promise<void> {
    if (!this.checkerAccountId) {
      systemLogger.warn(
        "AccountHealthService",
        "Shadow ban check skipped: no checker account configured",
      );
      return;
    }

    try {
      const result = await this.mcpToolClient.callTool<{
        accounts: Array<{ id: string; handle: string; state: string }>;
      }>("x_list_accounts");

      const targets = result.accounts.filter(
        (a) =>
          a.id !== this.checkerAccountId &&
          (a.state === "active" || a.state === "warming"),
      );

      systemLogger.info(
        "AccountHealthService",
        `Running shadow ban checks for ${String(targets.length)} accounts using checker ${this.checkerAccountId}`,
      );

      for (const target of targets) {
        try {
          // Attempt to search for target's tweets using checker account.
          // Note: x_search_tweets may not exist yet in x-client-mcp.
          // If it fails, we log a warning and skip gracefully.
          const searchResult = await this.mcpToolClient.callTool<{
            tweets: Array<{ id: string; text: string }>;
            error?: string;
          }>("x_search_tweets", {
            account_id: this.checkerAccountId,
            query: `from:${target.handle}`,
            count: 5,
          });

          // If search returns empty but account is active, likely shadow banned
          const searchVisible =
            !searchResult.error && searchResult.tweets.length > 0;

          const existing = this.healthStore.get(target.id);
          if (existing) {
            existing.shadow_ban = {
              status: searchVisible ? "clear" : "search_ban",
              checked_at: new Date().toISOString(),
              search_visible: searchVisible,
            };
            this.healthStore.set(target.id, existing);

            // Emit alert if shadow ban detected
            if (!searchVisible) {
              const alert: HealthAlert = {
                id: `shadow-ban-${target.id}-${String(Date.now())}`,
                severity: "critical",
                category: "shadow_ban",
                title: `Shadow ban detected: @${target.handle}`,
                message: `Tweets from @${target.handle} are not appearing in search results.`,
                accountId: target.id,
                handle: target.handle,
                action: {
                  label: "Investigate",
                  target: `/x-accounts/${target.id}`,
                },
                acknowledged: false,
                created_at: new Date().toISOString(),
                auto_dismiss_ms: null,
              };
              this.emit("health_alert", alert);
            }
          }

          // Rate limit courtesy: wait 3-5s between searches
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              SHADOW_BAN_SEARCH_DELAY_MIN_MS +
                Math.random() * SHADOW_BAN_SEARCH_DELAY_RANGE_MS,
            ),
          );
        } catch (error) {
          // Gracefully handle missing x_search_tweets tool or other errors
          systemLogger.warn(
            "AccountHealthService",
            `Shadow ban check failed for @${target.handle}`,
            {
              error:
                error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    } catch (error) {
      systemLogger.error(
        "AccountHealthService",
        "Error during shadow ban check cycle",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Alerting
  // -------------------------------------------------------------------------

  /**
   * Build a health alert from account metrics.
   * Collects relevant issue reasons into the alert message.
   */
  private buildAlert(
    severity: "critical" | "warning",
    account: { id: string; handle: string },
    metrics: AccountHealthMetrics,
  ): HealthAlert {
    const reasons: string[] = [];
    if (metrics.error_rate > 0.3) {
      reasons.push(
        `high error rate (${String(Math.round(metrics.error_rate * 100))}%)`,
      );
    }
    if (metrics.cookie_age_hours > COOKIE_WARNING_AGE_HOURS) {
      reasons.push(
        `stale cookies (${String(Math.round(metrics.cookie_age_hours))}h)`,
      );
    }
    if (
      metrics.shadow_ban.status !== "clear" &&
      metrics.shadow_ban.status !== "unknown"
    ) {
      reasons.push(
        `shadow ban detected (${metrics.shadow_ban.status})`,
      );
    }
    if (metrics.last_successful_action_at) {
      const hoursSince =
        (Date.now() -
          new Date(metrics.last_successful_action_at).getTime()) /
        (1000 * 60 * 60);
      if (hoursSince > 48) {
        reasons.push(`inactive for ${String(Math.round(hoursSince))}h`);
      }
    }

    return {
      id: `health-${account.id}-${String(Date.now())}`,
      severity,
      category: "account_health",
      title: `${severity === "critical" ? "CRITICAL" : "Warning"}: @${account.handle} health ${String(metrics.health_score)}/100`,
      message:
        reasons.length > 0
          ? `Issues: ${reasons.join(", ")}`
          : `Health score dropped to ${String(metrics.health_score)}`,
      accountId: account.id,
      handle: account.handle,
      action: {
        label: "View Details",
        target: `/x-accounts/${account.id}`,
      },
      acknowledged: false,
      created_at: new Date().toISOString(),
      auto_dismiss_ms: severity === "critical" ? null : 300_000,
    };
  }

  // -------------------------------------------------------------------------
  // JSONL Audit Logging
  // -------------------------------------------------------------------------

  /**
   * Write a single health check result to the JSONL audit log.
   * One line per account per check cycle, daily rotation by filename.
   *
   * @param accountId - Account ID
   * @param handle - X handle
   * @param metrics - Computed health metrics
   */
  private writeAuditLog(
    accountId: string,
    handle: string,
    metrics: AccountHealthMetrics,
  ): void {
    try {
      const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const logFile = path.join(
        this.logDirectory,
        `health-checks-${date ?? "unknown"}.jsonl`,
      );

      const entry = JSON.stringify({
        timestamp: metrics.computed_at,
        account_id: accountId,
        handle,
        health_score: metrics.health_score,
        error_rate: metrics.error_rate,
        cookie_age_hours: metrics.cookie_age_hours,
        shadow_ban_status: metrics.shadow_ban.status,
        engagement_velocity: metrics.engagement_velocity,
        last_successful_action_at: metrics.last_successful_action_at,
      });

      appendFileSync(logFile, entry + "\n", "utf8");
    } catch (error) {
      // Never let audit logging crash the health check cycle
      systemLogger.warn(
        "AccountHealthService",
        "Failed to write audit log",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
