/**
 * Dashboard Types
 */

// Re-export WebSocket types
export type {
  AccountRotatedPayload,
  ActiveAgentEntry,
  ActiveAgentsPayload,
  AgentCompletionPayload,
  ApiLogPayload,
  CliLoginCompletePayload,
  CliLoginErrorPayload,
  CliLoginUrlPayload,
  CredentialsUpdatedPayload,
  DockerLogPayload,
  ErrorPayload,
  LogEntry,
  LogEntryPayload,
  LogEventPayload,
  Session,
  SessionUpdatePayload,
  SystemLogPayload,
  TokenUsageBreakdown,
  WarningPayload,
  WSClientMessage,
  WSClientMessageType,
  WSServerMessage,
  WSServerMessageType,
} from "./websocket";

// Re-export Graph types
export type {
  EdgeData,
  GraphData,
  GraphEdge,
  GraphMetadata,
  GraphNode,
  NodePosition,
  WorkflowPhaseNodeData,
} from "./graph";

/**
 * Routing log entry from the backend API
 */
export interface RoutingLog {
  /** Agent name (when type is agent) */
  agent?: string;
  /** Confidence score 0-1 */
  confidence?: number;
  /** The routing decision made */
  decision: string;
  /** Whether user followed the recommendation */
  followed: boolean;
  /** Unique identifier */
  id?: string;
  /** Project name where log originated */
  project: string;
  /** Skill name (when type is skill) */
  skill?: string;
  /** ISO timestamp of decision */
  timestamp: string;
  /** Type of routing decision */
  type: "agent" | "skill";
}

/**
 * Filter state for dashboard queries
 */
export interface FilterState {
  /** Filter by followed status */
  followed?: "all" | "followed" | "unfollowed";
  /** Filter by project name */
  project: string;
  /** Time range filter */
  timeRange: "1h" | "24h" | "7d" | "30d" | "all";
  /** Filter by decision type */
  type: "agent" | "all" | "skill";
}

/**
 * Usage breakdown data for pie chart
 */
export interface UsageBreakdown {
  /** Display color */
  color: string;
  /** Category name */
  name: string;
  /** Count value */
  value: number;
}

/**
 * Agent/Skill usage data for bar chart
 */
export interface AgentUsage {
  /** Usage count */
  count: number;
  /** Agent or skill name */
  name: string;
  /** Type indicator */
  type: "agent" | "skill";
}

/**
 * Time series data point for line chart
 */
export interface TimeSeriesDataPoint {
  /** Agent decision count */
  agents: number;
  /** Date string */
  date: string;
  /** Skill decision count */
  skills: number;
  /** Total decisions */
  total: number;
}

/**
 * Aggregated routing data from API
 */
export interface RoutingData {
  /** Follow-through rate percentage */
  followThroughRate: number;
  /** Recent routing logs */
  recentLogs: RoutingLog[];
  /** Time series data */
  timeSeriesData: TimeSeriesDataPoint[];
  /** Top agents/skills */
  topAgents: AgentUsage[];
  /** Agent vs skill breakdown */
  usageBreakdown: UsageBreakdown[];
}

/**
 * Project info from discovery API
 */
export interface ProjectInfo {
  /** Whether project has routing logs */
  hasRoutingLogs: boolean;
  /** Last activity timestamp */
  lastActivity: string;
  /** Path to log directory */
  logDirectory: string;
  /** Project display name */
  name: string;
  /** Full path to project */
  path: string;
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> {
  /** Response data */
  data: T[];
  /** Pagination metadata */
  pagination: {
    /** Whether more data is available */
    hasMore: boolean;
    /** Current limit */
    limit: number;
    /** Current offset */
    offset: number;
    /** Total count */
    total: number;
  };
}

/**
 * Stats API response
 */
export interface StatsResponse {
  /** Follow-through rate percentage */
  followRate: number;
  /** Top agents by usage */
  topAgents: Array<{ count: number; name: string }>;
  /** Top skills by usage */
  topSkills: Array<{ count: number; name: string }>;
  /** Total routing decisions */
  totalDecisions: number;
}

/**
 * claude-proxy status data from API
 */
export interface ClaudeProxyStatus {
  /** Number of errors encountered */
  errors: number;
  /** Process ID of claude-proxy (if available) */
  pid?: number;
  /** Port claude-proxy is listening on */
  port: number;
  /** Number of requests processed */
  requests: number;
  /** Whether claude-proxy is currently running */
  running: boolean;
  /** Time claude-proxy has been running in milliseconds */
  uptime?: number;
}

/**
 * Activity entry from API
 */
export interface Activity {
  /** Input tokens used */
  inputTokens: number;
  /** Model used for the request */
  model: string;
  /** Output tokens used */
  outputTokens: number;
  /** Session ID */
  sessionId: string;
  /** Request status */
  status: "error" | "success";
  /** ISO timestamp */
  timestamp: string;
  /** Activity type */
  type: "agent" | "skill";
}

/**
 * Usage data for a time period
 */
export interface UsageData {
  /** Current usage count/amount */
  current: number;
  /** Maximum allowed in period */
  limit: number;
  /** ISO timestamp when usage resets */
  resetsAt: string;
}

/**
 * OAuth account from API
 */
export interface Account {
  /** Unique account identifier */
  id: string;
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Subscription type (Free, Pro, Team, etc.) */
  subscriptionType: string;
  /** Whether this is the active account */
  isActive: boolean;
  /** Whether OAuth token is expired or needs re-authentication */
  isExpired?: boolean;
  /** Reason for expiration (if isExpired is true) */
  expiredReason?: "token_expired" | "needs_reauth";
  /** Whether this is a long-lived token (no refresh token) */
  isLongLived?: boolean;
  /** Whether this account is pinned (prevents auto-rotation away) */
  isPinned?: boolean;
  /** 5-hour usage data */
  usage5h: UsageData;
  /** 7-day usage data */
  usage7d: UsageData;
  /** Last updated timestamp */
  lastUpdated: string;
}
