/**
 * Type definitions for multi-account usage monitoring
 */

import type { UsageMetrics } from "../../oauth-usage-client.js";

/**
 * Extended usage metrics with account identification
 */
export interface AccountUsageMetrics extends UsageMetrics {
  /** Unique account identifier */
  accountId: string;
  /** Human-readable account name (alias or email or ID) */
  accountName: string;
}

/**
 * Event payload for usage threshold events
 */
export interface UsageThresholdEvent {
  accountId: string;
  usage: AccountUsageMetrics;
}

/**
 * Event payload for rotation-needed events
 *
 * Emitted when the active account breaches the usage threshold (95%+)
 * and a rotation to another account is recommended.
 */
export interface RotationNeededEvent {
  /** Currently active account that hit the threshold */
  currentAccountId: string;
  /** Recommended account to rotate to (from getBestAccountForRotation) */
  recommendedAccountId: string;
  /** Reason for rotation: threshold breach or soonest reset fallback */
  reason: "threshold_breach" | "soonest_reset";
  /** ISO 8601 timestamp when current account's usage resets */
  resetsAt: string;
  /** Utilization percentage that triggered the rotation */
  utilization: number;
  /** Which limit was breached: 5-hour or 7-day */
  breachedLimit: "5h" | "7d";
}

/**
 * Configuration options for UsageMonitor
 */
export interface UsageMonitorOptions {
  /** Warning threshold percentage (default: 80) */
  warningThreshold?: number;
  /** Limit threshold percentage (default: 95) */
  limitThreshold?: number;
  /** Polling interval in milliseconds (default: 60000) */
  pollInterval?: number;
  /** Enable automatic rotation triggering when active account hits limit (default: true) */
  autoRotation?: boolean;
}

/**
 * Events emitted by UsageMonitor
 */
export interface UsageMonitorEvents {
  /** Emitted after each successful poll */
  "usage-updated": (usageMap: Map<string, AccountUsageMetrics>) => void;
  /** Emitted when account reaches 80% utilization */
  "limit-warning": (event: UsageThresholdEvent) => void;
  /** Emitted when account reaches 95% utilization */
  "limit-reached": (event: UsageThresholdEvent) => void;
  /** Emitted when active account hits threshold and rotation is recommended */
  "rotation-needed": (event: RotationNeededEvent) => void;
}

/**
 * Candidate account for rotation with selection metadata
 *
 * Returned by getBestAccountForRotation() to provide comprehensive
 * information about why an account was selected for rotation.
 */
export interface RotationCandidate {
  /** Unique account identifier */
  accountId: string;
  /** Current 5-hour utilization percentage (0-100) */
  utilization: number;
  /** ISO 8601 timestamp when usage resets */
  resetsAt: string;
  /** Milliseconds until usage resets */
  resetsInMs: number;
  /** Reason this account was selected */
  selectionReason: "lowest_utilization" | "soonest_reset";
}
