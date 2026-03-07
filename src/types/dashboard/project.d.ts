/**
 * TypeScript type definitions for Project Detail Screen
 * Used by ProjectDataAggregator and DetailScreen
 */

/**
 * Compliance metrics from hook and validation logs
 */
export interface ComplianceMetrics {
  /** Number of code review violations */
  codeReviewViolations: number;
  /** Hook execution success rate (0-100) */
  hookExecutionSuccessRate: number;
  /** Timestamp of last compliance scan */
  lastComplianceScan: Date;
  /** Task validation pass rate (0-100) */
  taskValidationPassRate: number;
}

/**
 * Model distribution showing usage by model
 * Maps model name to request count
 */
export type ModelDistribution = Record<string, number>;

/**
 * Project metadata for overview widget
 */
export interface ProjectMetadata {
  /** Number of active sessions for this project */
  activeSessions: number;
  /** Timestamp of last activity in project */
  lastActivity: Date;
  /** Absolute path to project directory */
  path: string;
}

/**
 * Project settings configuration
 */
export interface ProjectSettings {
  /** Additional settings */
  [key: string]: boolean | number | string | undefined;
  /** Fallback behavior on errors */
  fallback?: string;
  /** Output style preference */
  output_style?: string;
  /** Enable request routing */
  routing?: boolean;
  /** Enable thinking mode */
  thinking_mode?: boolean;
}

/**
 * Routing statistics and cost savings
 */
export interface RoutingStats {
  /** Total cost savings from routing in USD */
  costSavings: number;
  /** Requests routed to alternative models */
  routedRequests: number;
  /** Breakdown of routing targets */
  routingBreakdown: Record<string, number>;
  /** Total API requests made */
  totalRequests: number;
}

/**
 * Session log data parsed from session directory
 */
export interface SessionLogData {
  /** Total cost for session in USD */
  cost: number;
  /** Model usage breakdown */
  modelUsage: Record<string, number>;
  /** Session timestamp */
  timestamp: Date;
  /** Total tokens used in session */
  tokens: number;
}

/**
 * Token usage data aggregated by time period
 */
export interface TokenUsageData {
  /** Total tokens used in last 7 days */
  last7d: number;
  /** Total tokens used in last 24 hours */
  last24h: number;
  /** Total tokens used in last 30 days */
  last30d: number;
  /** Total cost for last 30 days in USD */
  totalCost30d: number;
}
