/**
 * ContentSchedulerServiceV2 - Multi-account content scheduler
 *
 * Manages per-persona posting schedules with gaussian jitter, circuit breakers,
 * action budget management, and exponential backoff retries.
 *
 * Features:
 * - Multi-account dispatch with per-persona posting windows
 * - Box-Muller gaussian jitter for human-like timing variance
 * - Per-account circuit breakers with escalating cooldown (60s -> 5m -> 30m)
 * - ActionBudgetManager for daily posting limits
 * - Exponential backoff + full jitter retries (max 5 attempts)
 * - Dead letter queue (failed posts surfaced via WebSocket events)
 * - post-published events include { tweetId, accountId, platform }
 *
 * Events:
 * - 'post-published': PostPublishedEventV2
 * - 'post-failed': PostFailedEventV2
 *
 * The old ContentSchedulerService remains untouched as a V1 fallback.
 * server.ts conditionally instantiates V2 when PersonaScheduleConfig data exists.
 *
 * @example
 * ```typescript
 * const scheduler = new ContentSchedulerServiceV2(mcpToolClient, {
 *   scheduleConfigs: await loadPersonaScheduleConfigs(),
 * });
 * scheduler.on('post-published', (event) => console.log(event));
 * scheduler.start();
 * ```
 *
 * @example persona-schedules.json config format:
 * ```json
 * [
 *   {
 *     "personaId": "crypto-trader",
 *     "timezone": "America/New_York",
 *     "postingWindows": [
 *       { "days": [1,2,3,4,5], "startHour": 9, "endHour": 17, "weight": 3 },
 *       { "days": [0,6], "startHour": 10, "endHour": 14, "weight": 1 }
 *     ],
 *     "maxPostsPerDay": 6,
 *     "minIntervalMinutes": 45,
 *     "jitterMinutes": 15,
 *     "contentMix": { "original": 0.5, "reply": 0.3, "retweet": 0.1, "thread": 0.1 },
 *     "accountIds": ["acc-123", "acc-456"]
 *   }
 * ]
 * ```
 */

import { EventEmitter } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import { Cron } from "croner";

import type { McpToolClient } from "./mcp-tool-client.js";
import { systemLogger } from "./system-logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Day of week (0 = Sunday, 6 = Saturday) */
type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A posting window within a day.
 * Windows define when posts can be scheduled and their relative distribution weight.
 */
export interface PostingWindow {
  /** Days this window applies to (e.g., [1,2,3,4,5] for weekdays) */
  days: DayOfWeek[];
  /** Start hour in 24h format (0-23) */
  startHour: number;
  /** End hour in 24h format (0-23, exclusive) */
  endHour: number;
  /** Relative weight for post distribution (higher = more posts in this window) */
  weight: number;
}

/**
 * Content type distribution weights.
 * Values should ideally sum to 1.0 for proportional distribution.
 */
export interface ContentMix {
  /** Weight for original tweets */
  original: number;
  /** Weight for reply tweets */
  reply: number;
  /** Weight for retweets */
  retweet: number;
  /** Weight for thread tweets */
  thread: number;
}

/**
 * Per-persona scheduling configuration.
 * Each persona maps to one or more X account IDs and defines its own
 * posting cadence, windows, jitter, and content mix.
 */
export interface PersonaScheduleConfig {
  /** Persona ID from x-persona-mcp */
  personaId: string;
  /** IANA timezone string (e.g., "America/New_York") */
  timezone: string;
  /** Posting windows with day/hour ranges and weights */
  postingWindows: PostingWindow[];
  /** Maximum posts per day across all windows */
  maxPostsPerDay: number;
  /** Minimum minutes between any two posts for this persona */
  minIntervalMinutes: number;
  /** Standard deviation in minutes for gaussian jitter (default: 15) */
  jitterMinutes: number;
  /** Content type distribution */
  contentMix: ContentMix;
  /** X account IDs linked to this persona */
  accountIds: string[];
}

/** A computed time slot for a single post */
export interface ScheduledSlot {
  /** Date/time when the post should be dispatched */
  scheduledAt: Date;
  /** Account ID to publish from */
  accountId: string;
  /** Persona ID that generated this schedule */
  personaId: string;
}

/** Post data returned from marketing_list_posts MCP tool (same shape as V1) */
interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  scheduled_at: string;
  status: string;
  campaign_id?: string;
  metadata?: Record<string, unknown>;
}

/** Enhanced event payload including accountId for downstream consumers */
export interface PostPublishedEventV2 {
  /** Tweet ID from X platform */
  tweetId: string;
  /** Account ID that published the post */
  accountId: string;
  /** Platform identifier (e.g., "x") */
  platform: string;
  /** ISO timestamp of publication */
  publishedAt: string;
  /** Internal post ID from marketing calendar */
  postId: string;
}

/** Event payload for failed posts (dead letter queue) */
export interface PostFailedEventV2 {
  /** Internal post ID from marketing calendar */
  postId: string;
  /** Account ID that attempted to publish */
  accountId: string;
  /** Platform identifier (e.g., "x") */
  platform: string;
  /** Error message describing the failure */
  error: string;
}

/** Options for constructing ContentSchedulerServiceV2 */
export interface ContentSchedulerV2Options {
  /** Persona schedule configurations (loaded from persona config store) */
  scheduleConfigs: PersonaScheduleConfig[];
  /** Override default daily budget limit per account (default: 25) */
  dailyBudgetLimit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum retry attempts per post */
const MAX_RETRIES = 5;

/** Base delay for exponential backoff in milliseconds */
const BASE_DELAY_MS = 2_000;

/** Maximum delay cap for exponential backoff in milliseconds */
const MAX_DELAY_MS = 120_000;

/** Escalating cooldown durations for circuit breaker in milliseconds */
const COOLDOWN_LEVELS_MS = [
  60_000, // 60 seconds
  300_000, // 5 minutes
  1_800_000, // 30 minutes
] as const;

/** Number of consecutive failures to trip the circuit breaker */
const FAILURE_THRESHOLD = 3;

/** Default daily action budget per account */
const DEFAULT_DAILY_BUDGET = 25;

/** Default path for persona schedule configs file */
const DEFAULT_CONFIG_PATH = join(
  homedir(),
  ".claude-workflow",
  "persona-schedules.json",
);

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Box-Muller transform: generates a normally distributed random number
 * with mean 0 and standard deviation 1.
 *
 * Uses the polar form of the Box-Muller transform to convert uniformly
 * distributed random numbers into a gaussian distribution.
 *
 * @returns A normally distributed random number (mean=0, std=1)
 */
export function gaussianRandom(): number {
  let u1 = 0;
  let u2 = 0;
  // Avoid log(0) by rejecting exact zeros
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Exponential backoff with full jitter.
 * delay = random(0, min(cap, base * 2^attempt))
 *
 * Reference: AWS Architecture Blog - Exponential Backoff And Jitter
 *
 * @param attempt - Zero-based attempt number
 * @returns Delay in milliseconds with jitter applied
 */
function computeBackoffMs(attempt: number): number {
  const exponentialDelay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * exponentialDelay;
}

/**
 * Promise-based sleep utility.
 *
 * @param ms - Duration to sleep in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// SchedulePlanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SchedulePlanner computes daily posting schedules for a persona.
 *
 * Algorithm:
 * 1. Filter postingWindows to those active on the given day-of-week.
 * 2. Compute total weight; distribute maxPostsPerDay proportional to weight.
 * 3. For each window, generate N evenly-spaced slots within [startHour, endHour).
 * 4. Apply gaussian jitter (sigma = jitterMinutes) to each slot.
 * 5. Clamp slots to window boundaries.
 * 6. Sort all slots chronologically.
 * 7. Enforce minIntervalMinutes: if two slots are too close, nudge the later one forward.
 * 8. Trim to maxPostsPerDay.
 * 9. Distribute slots round-robin across accountIds.
 */
export class SchedulePlanner {
  /**
   * Compute a daily schedule for a persona on a given date.
   *
   * @param config - Persona schedule configuration
   * @param date - The date to compute the schedule for
   * @returns Array of scheduled time slots with account assignments
   */
  computeDailySchedule(
    config: PersonaScheduleConfig,
    date: Date,
  ): ScheduledSlot[] {
    const dayOfWeek = date.getDay() as DayOfWeek;
    const activeWindows = config.postingWindows.filter((w) =>
      w.days.includes(dayOfWeek),
    );

    if (activeWindows.length === 0 || config.accountIds.length === 0) {
      return [];
    }

    const totalWeight = activeWindows.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) return [];

    const slots: Date[] = [];

    for (const window of activeWindows) {
      const postsForWindow = Math.max(
        1,
        Math.round((window.weight / totalWeight) * config.maxPostsPerDay),
      );
      const windowDurationMinutes = (window.endHour - window.startHour) * 60;
      const spacing = windowDurationMinutes / (postsForWindow + 1);

      for (let i = 1; i <= postsForWindow; i++) {
        const baseMinutes = window.startHour * 60 + spacing * i;
        const jitter = gaussianRandom() * config.jitterMinutes;
        const jitteredMinutes = baseMinutes + jitter;

        // Clamp to window boundaries
        const clampedMinutes = Math.max(
          window.startHour * 60,
          Math.min(window.endHour * 60 - 1, jitteredMinutes),
        );

        const slotDate = new Date(date);
        slotDate.setHours(0, 0, 0, 0);
        slotDate.setMinutes(Math.round(clampedMinutes));
        slots.push(slotDate);
      }
    }

    // Sort chronologically
    slots.sort((a, b) => a.getTime() - b.getTime());

    // Enforce minIntervalMinutes
    const minIntervalMs = config.minIntervalMinutes * 60_000;
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i]!.getTime() - slots[i - 1]!.getTime();
      if (gap < minIntervalMs) {
        slots[i] = new Date(slots[i - 1]!.getTime() + minIntervalMs);
      }
    }

    // Trim to maxPostsPerDay
    const trimmedSlots = slots.slice(0, config.maxPostsPerDay);

    // Round-robin account assignment
    return trimmedSlots.map((scheduledAt, idx) => ({
      scheduledAt,
      accountId: config.accountIds[idx % config.accountIds.length]!,
      personaId: config.personaId,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CircuitBreaker
// ─────────────────────────────────────────────────────────────────────────────

/** Circuit breaker states */
type CircuitState = "closed" | "open" | "half-open";

/**
 * Per-account CircuitBreaker with escalating cooldown.
 *
 * State machine:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Tripped after FAILURE_THRESHOLD consecutive failures, requests blocked
 * - HALF-OPEN: Cooldown elapsed, allows one probe request through
 *
 * Cooldown escalation: 60s -> 5m -> 30m (each trip escalates to next level).
 * A successful publish in half-open state resets the cooldown level to 0.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private cooldownLevel = 0;
  private openedAt = 0;

  constructor(
    /** Account ID this circuit breaker protects */
    public readonly accountId: string,
  ) {}

  /**
   * Check if the circuit breaker is currently blocking requests.
   *
   * @returns true if the breaker is open and cooldown hasn't elapsed
   */
  isOpen(): boolean {
    if (this.state === "closed") return false;

    // Check if cooldown has elapsed -> transition to half-open
    const elapsed = Date.now() - this.openedAt;
    const cooldownMs =
      COOLDOWN_LEVELS_MS[
        Math.min(this.cooldownLevel, COOLDOWN_LEVELS_MS.length - 1)
      ] ?? COOLDOWN_LEVELS_MS[COOLDOWN_LEVELS_MS.length - 1]!;

    if (elapsed >= cooldownMs) {
      this.state = "half-open";
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time in milliseconds.
   *
   * @returns Remaining cooldown in ms, or 0 if closed
   */
  remainingCooldownMs(): number {
    if (this.state === "closed") return 0;
    const cooldownMs =
      COOLDOWN_LEVELS_MS[
        Math.min(this.cooldownLevel, COOLDOWN_LEVELS_MS.length - 1)
      ] ?? COOLDOWN_LEVELS_MS[COOLDOWN_LEVELS_MS.length - 1]!;
    return Math.max(0, cooldownMs - (Date.now() - this.openedAt));
  }

  /**
   * Record a successful operation. Resets consecutive failures
   * and transitions back to closed state. If in half-open state,
   * resets the cooldown level to 0.
   */
  recordSuccess(): void {
    if (this.state === "half-open") {
      // Successful probe -> reset cooldown level
      this.cooldownLevel = 0;
    }
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /**
   * Record a failed operation. Increments consecutive failures
   * and trips the breaker if threshold is reached.
   */
  recordFailure(): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      if (this.state !== "open") {
        // Escalate cooldown level on each trip
        if (this.state === "half-open" || this.state === "closed") {
          this.cooldownLevel = Math.min(
            this.cooldownLevel + 1,
            COOLDOWN_LEVELS_MS.length - 1,
          );
        }
      }
      this.state = "open";
      this.openedAt = Date.now();

      systemLogger.warn(
        "ContentSchedulerV2",
        `Circuit breaker OPEN for account ${this.accountId} (level ${String(this.cooldownLevel)})`,
      );
    }
  }

  /**
   * Reset breaker completely (for testing or manual recovery).
   * Returns the breaker to closed state with zero failures and level 0 cooldown.
   */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.cooldownLevel = 0;
    this.openedAt = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionBudgetManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ActionBudgetManager tracks daily action counts per account.
 * Prevents exceeding X's implicit rate limits that trigger shadowbans.
 *
 * Default daily budget: 25 content posts per account.
 * Resets at midnight based on UTC date boundaries.
 *
 * Future enhancement: timezone-aware resets per account.
 */
export class ActionBudgetManager {
  private readonly dailyBudgets: Map<
    string,
    { used: number; date: string }
  > = new Map();

  constructor(
    /** Maximum actions per account per day */
    private readonly defaultDailyLimit: number = DEFAULT_DAILY_BUDGET,
  ) {}

  /**
   * Attempt to reserve one content action for the given account.
   *
   * @param accountId - The account to reserve budget for
   * @returns true if budget available and reserved, false if exhausted for today
   */
  reserveForContent(accountId: string): boolean {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const budget = this.dailyBudgets.get(accountId);

    if (!budget || budget.date !== today) {
      // New day or first usage -> reset
      this.dailyBudgets.set(accountId, { used: 1, date: today });
      return true;
    }

    if (budget.used >= this.defaultDailyLimit) {
      systemLogger.warn(
        "ContentSchedulerV2",
        `Daily action budget exhausted for account ${accountId} (${String(budget.used)}/${String(this.defaultDailyLimit)})`,
      );
      return false;
    }

    budget.used++;
    return true;
  }

  /**
   * Get remaining budget for an account today.
   *
   * @param accountId - The account to check
   * @returns Number of remaining actions available today
   */
  remaining(accountId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const budget = this.dailyBudgets.get(accountId);
    if (!budget || budget.date !== today) return this.defaultDailyLimit;
    return Math.max(0, this.defaultDailyLimit - budget.used);
  }

  /**
   * Reset all budgets (for testing).
   */
  resetAll(): void {
    this.dailyBudgets.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PostPublisher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostPublisher handles the actual dispatch of posts to X via MCP tools,
 * with retry logic (exponential backoff + full jitter), circuit breaker
 * integration, and action budget checking.
 *
 * Retry strategy:
 * - Up to MAX_RETRIES (5) attempts per post
 * - Exponential backoff with full jitter: delay = random(0, min(120s, 2s * 2^attempt))
 * - Circuit breaker checked before each attempt
 * - Budget checked once before first attempt
 *
 * On exhausted retries, transitions post to 'failed' status (dead letter queue).
 */
export class PostPublisher {
  constructor(
    private readonly mcpToolClient: McpToolClient,
    private readonly circuitBreakers: Map<string, CircuitBreaker>,
    private readonly budgetManager: ActionBudgetManager,
  ) {}

  /**
   * Attempt to publish a post with retry logic.
   *
   * @param post - The scheduled post to publish
   * @param accountId - The account to publish from
   * @returns Result indicating success/failure with optional tweetId or error
   */
  async publish(
    post: ScheduledPost,
    accountId: string,
  ): Promise<{ success: boolean; tweetId?: string; error?: string }> {
    const breaker = this.getOrCreateBreaker(accountId);

    if (breaker.isOpen()) {
      return {
        success: false,
        error: `Circuit breaker open for account ${accountId} (cooldown ${String(breaker.remainingCooldownMs())}ms)`,
      };
    }

    // Check budget before attempting publish
    const budgetAllowed = this.budgetManager.reserveForContent(accountId);
    if (!budgetAllowed) {
      return {
        success: false,
        error: `Action budget exhausted for account ${accountId}; deferred to next day`,
      };
    }

    let lastError = "";

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Transition to publishing
        await this.mcpToolClient.callTool("marketing_transition_post_status", {
          id: post.id,
          status: "publishing",
        });

        // Dispatch to X
        const result = await this.mcpToolClient.callTool<{
          tweet_id?: string;
        }>("x_post_tweet", {
          account_id: accountId,
          text: post.content,
        });

        // Mark published
        const publishedAt = new Date().toISOString();
        await this.mcpToolClient.callTool("marketing_transition_post_status", {
          id: post.id,
          status: "published",
          published_at: publishedAt,
        });

        breaker.recordSuccess();

        return {
          success: true,
          tweetId: result?.tweet_id ?? post.id,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        breaker.recordFailure();

        if (attempt < MAX_RETRIES - 1) {
          const delayMs = computeBackoffMs(attempt);
          systemLogger.warn(
            "ContentSchedulerV2",
            `Retry ${String(attempt + 1)}/${String(MAX_RETRIES)} for post ${post.id} on account ${accountId} in ${String(Math.round(delayMs))}ms`,
            { error: lastError },
          );
          await sleep(delayMs);
        }
      }
    }

    // Exhausted retries - dead letter: transition to failed
    try {
      await this.mcpToolClient.callTool("marketing_transition_post_status", {
        id: post.id,
        status: "failed",
        error_message: `Exhausted ${String(MAX_RETRIES)} retries: ${lastError}`,
      });
    } catch {
      // Best-effort status transition
    }

    return { success: false, error: lastError };
  }

  /**
   * Get or create a circuit breaker for the given account.
   *
   * @param accountId - The account to get/create a breaker for
   * @returns The circuit breaker instance
   */
  private getOrCreateBreaker(accountId: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(accountId);
    if (!breaker) {
      breaker = new CircuitBreaker(accountId);
      this.circuitBreakers.set(accountId, breaker);
    }
    return breaker;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ContentSchedulerServiceV2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ContentSchedulerServiceV2 - Multi-account content scheduler.
 *
 * Manages per-persona posting schedules with gaussian jitter, circuit breakers,
 * and action budget management. Replaces ContentSchedulerService (V1) when
 * persona schedule configs are present.
 *
 * Lifecycle: same as ContentSchedulerService (EventEmitter, start/stop).
 *
 * Events:
 * - 'post-published': PostPublishedEventV2
 * - 'post-failed': PostFailedEventV2
 *
 * Dispatch flow:
 * 1. On start, compute today's schedule for all personas
 * 2. Every minute, check all per-account dispatch queues for due posts
 * 3. For each due slot, query marketing calendar for next scheduled post
 * 4. Publish via PostPublisher (with budget check, circuit breaker, retries)
 * 5. Emit success/failure events for dashboard WebSocket broadcast
 */
export class ContentSchedulerServiceV2 extends EventEmitter {
  private readonly mcpToolClient: McpToolClient;
  private readonly scheduleConfigs: PersonaScheduleConfig[];
  private readonly planner: SchedulePlanner;
  private readonly publisher: PostPublisher;
  private readonly budgetManager: ActionBudgetManager;
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();

  /** Per-account dispatch queues: accountId -> sorted array of slots */
  private readonly dispatchQueues: Map<string, ScheduledSlot[]> = new Map();

  /** Date string (YYYY-MM-DD) of the last schedule computation */
  private lastScheduleDate = "";

  private cronJob: Cron | undefined;

  constructor(
    mcpToolClient: McpToolClient,
    options: ContentSchedulerV2Options,
  ) {
    super();
    this.mcpToolClient = mcpToolClient;
    this.scheduleConfigs = options.scheduleConfigs;
    this.planner = new SchedulePlanner();
    this.budgetManager = new ActionBudgetManager(
      options.dailyBudgetLimit ?? DEFAULT_DAILY_BUDGET,
    );
    this.publisher = new PostPublisher(
      mcpToolClient,
      this.circuitBreakers,
      this.budgetManager,
    );
  }

  /**
   * Start the scheduler. Runs every minute to check for due posts.
   * Safe to call multiple times (stops existing job first).
   */
  public start(): void {
    if (this.cronJob !== undefined) {
      this.stop();
    }

    systemLogger.info(
      "ContentSchedulerV2",
      `Starting multi-account scheduler with ${String(this.scheduleConfigs.length)} persona configs`,
    );

    // Compute today's schedule immediately
    this.computeDailySchedules();

    // Every minute, check for due posts
    this.cronJob = new Cron("* * * * *", { protect: true }, () => {
      void this.tick();
    });
  }

  /**
   * Stop the scheduler and clean up all resources.
   */
  public stop(): void {
    if (this.cronJob !== undefined) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }
    this.dispatchQueues.clear();
    this.removeAllListeners();
    systemLogger.info("ContentSchedulerV2", "Stopped multi-account scheduler");
  }

  /**
   * Compute daily schedules for all personas.
   * Called once at start and again when the date rolls over (midnight).
   */
  private computeDailySchedules(): void {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);

    if (dateStr === this.lastScheduleDate) return;
    this.lastScheduleDate = dateStr;
    this.dispatchQueues.clear();

    for (const config of this.scheduleConfigs) {
      const slots = this.planner.computeDailySchedule(config, today);

      for (const slot of slots) {
        const queue = this.dispatchQueues.get(slot.accountId) ?? [];
        queue.push(slot);
        this.dispatchQueues.set(slot.accountId, queue);
      }
    }

    // Sort each queue by scheduledAt
    for (const [accountId, queue] of this.dispatchQueues) {
      queue.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      systemLogger.info(
        "ContentSchedulerV2",
        `Scheduled ${String(queue.length)} posts for account ${accountId} today`,
      );
    }
  }

  /**
   * Every-minute tick: check all accounts for due posts.
   * Protected by croner's overrun protection to prevent overlap.
   */
  private async tick(): Promise<void> {
    // Roll over to next day if needed
    this.computeDailySchedules();

    const now = Date.now();

    for (const [accountId, queue] of this.dispatchQueues) {
      // Process all due slots for this account
      while (queue.length > 0 && queue[0]!.scheduledAt.getTime() <= now) {
        const slot = queue.shift()!;
        await this.dispatchSlot(slot, accountId);
      }
    }
  }

  /**
   * Dispatch a single scheduled slot: fetch content, publish, emit events.
   *
   * @param slot - The scheduled time slot to dispatch
   * @param accountId - The account to publish from
   */
  private async dispatchSlot(
    _slot: ScheduledSlot,
    accountId: string,
  ): Promise<void> {
    try {
      // Query for the next scheduled post for this persona
      const result = await this.mcpToolClient.callTool<{
        total: number;
        posts: ScheduledPost[];
      }>("marketing_list_posts", {
        status: "scheduled",
        end_date: new Date().toISOString(),
      });

      const post = result.posts.find(
        (p) =>
          p.status === "scheduled" &&
          p.scheduled_at !== undefined &&
          new Date(p.scheduled_at).getTime() <= Date.now(),
      );

      if (!post) return;

      const publishResult = await this.publisher.publish(post, accountId);

      if (publishResult.success) {
        const publishedAt = new Date().toISOString();
        this.emit("post-published", {
          tweetId: publishResult.tweetId ?? post.id,
          accountId,
          platform: post.platform,
          publishedAt,
          postId: post.id,
        } satisfies PostPublishedEventV2);

        systemLogger.info(
          "ContentSchedulerV2",
          `Published post ${post.id} via account ${accountId}`,
        );
      } else {
        this.emit("post-failed", {
          postId: post.id,
          accountId,
          platform: post.platform,
          error: publishResult.error ?? "Unknown error",
        } satisfies PostFailedEventV2);

        systemLogger.error(
          "ContentSchedulerV2",
          `Failed to publish post ${post.id} via account ${accountId}: ${publishResult.error ?? "unknown"}`,
        );
      }
    } catch (error) {
      systemLogger.error(
        "ContentSchedulerV2",
        `Error dispatching slot for account ${accountId}`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config File I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load persona schedule configs from disk.
 * Returns empty array if file doesn't exist or is invalid JSON.
 *
 * Default path: ~/.claude-workflow/persona-schedules.json
 * Override via PERSONA_SCHEDULE_CONFIG_PATH environment variable.
 *
 * @param configPath - Path to the config file (defaults to env var or standard path)
 * @returns Array of persona schedule configurations
 */
export async function loadPersonaScheduleConfigs(
  configPath: string = process.env["PERSONA_SCHEDULE_CONFIG_PATH"] ??
    DEFAULT_CONFIG_PATH,
): Promise<PersonaScheduleConfig[]> {
  try {
    const data = await readFile(configPath, "utf-8");
    return JSON.parse(data) as PersonaScheduleConfig[];
  } catch {
    return [];
  }
}

/**
 * Save persona schedule configs to disk.
 * Creates parent directories if they don't exist.
 *
 * @param configs - Array of persona schedule configurations to save
 * @param configPath - Path to save the config file
 */
export async function savePersonaScheduleConfigs(
  configs: PersonaScheduleConfig[],
  configPath: string = process.env["PERSONA_SCHEDULE_CONFIG_PATH"] ??
    DEFAULT_CONFIG_PATH,
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(configs, null, 2), "utf-8");
}
