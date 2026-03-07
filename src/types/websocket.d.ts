/**
 * WebSocket Message Protocol Types
 *
 * Defines the message protocol for real-time log streaming via WebSocket.
 * Used by dashboard server to stream RealTimeLogMonitor events to clients.
 */


// ============================================================================
// Client to Server Messages
// ============================================================================

/**
 * Message types that clients can send to server
 */
export type WSClientMessageType = "ping" | "subscribe" | "subscribe_all" | "unsubscribe" | "unsubscribe_all";

/**
 * Messages sent from client to server
 */
export interface WSClientMessage {
  /** Message type */
  type: WSClientMessageType;
  /** Session ID to subscribe/unsubscribe from. Required for subscribe/unsubscribe types */
  sessionId?: string;
}

// ============================================================================
// Server to Client Messages
// ============================================================================

/**
 * CLI login URL payload (for type: 'cli_login_url')
 */
export interface CliLoginUrlPayload {
  /** OAuth authorization URL */
  authUrl: string;
  /** Session ID */
  sessionId: string;
}

/**
 * CLI login completion payload (for type: 'cli_login_complete')
 */
export interface CliLoginCompletePayload {
  /** Whether login completed */
  completed: boolean;
  /** Session ID */
  sessionId: string;
}

/**
 * CLI login error payload (for type: 'cli_login_error')
 */
export interface CliLoginErrorPayload {
  /** Error message */
  error: string;
  /** Session ID */
  sessionId: string;
}

/**
 * CLI login output payload (for type: 'cli_login_output')
 */
export interface CliLoginOutputPayload {
  /** Output line from CLI */
  line: string;
  /** Session ID */
  sessionId: string;
}

/**
 * Email account updated payload (for type: 'email_account_updated')
 * Sent when the email vault file changes externally
 */
export interface EmailAccountUpdatedPayload {
  /** Account ID in the vault (or "vault" for bulk file changes) */
  accountId: string;
  /** Email address */
  email: string;
  /** Email provider (mail.com, gmx.com) */
  provider: string;
  /** What triggered this update */
  changeSource:
    | "account_created"
    | "account_deleted"
    | "vault_file_change";
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Email accounts snapshot payload (for type: 'email_accounts_snapshot')
 * Sent on initial subscribe_all to seed the frontend with current email account list
 */
export interface EmailAccountsSnapshotPayload {
  /** All email accounts currently in the vault */
  accounts: Array<{
    /** Account ID */
    id: string;
    /** Email address */
    email: string;
    /** Email provider (mail.com, gmx.com) */
    provider: string;
    /** Email domain */
    domain?: string;
    /** ISO timestamp of account creation */
    createdAt: string;
  }>;
}

/**
 * Message types that server sends to clients
 */
export type WSServerMessageType =
  | "account_health_update"
  | "account_rotated"
  | "active_agents"
  | "agent_completion"
  | "api_log"
  | "cli_login_complete"
  | "cli_login_error"
  | "cli_login_output"
  | "cli_login_url"
  | "content_calendar_event"
  | "content_scheduler_event"
  | "credentials_updated"
  | "docker_log"
  | "email_account_updated"
  | "email_accounts_snapshot"
  | "error"
  | "health_alert"
  | "log"
  | "log_entry"
  | "pong"
  | "session-update"
  | "session_state_change"
  | "subscribed"
  | "subscribed_all"
  | "system_log"
  | "unsubscribed"
  | "unsubscribed_all"
  | "warning"
  | "x_account_updated"
  | "x_accounts_snapshot"
  | "x_operation_progress";

/**
 * Account rotated payload (for type: 'account_rotated')
 * Sent when the proxy rotates to a different OAuth account
 */
export interface AccountRotatedPayload {
  /** ISO 8601 timestamp when rotation occurred */
  timestamp: string;
  /** Previous active account ID (null if first-time activation) */
  previousAccountId: string | null;
  /** New active account ID */
  newAccountId: string;
  /** Rotation reason */
  reason: "rate_limit_5h" | "rate_limit_7d" | "manual" | "scheduled";
  /** Human-readable explanation for account selection */
  selectionReason: string;
  /** Current utilization of newly activated account */
  utilization: {
    /** 5-hour utilization percentage (0-100) */
    fiveHour: number;
    /** 7-day utilization percentage (0-100) */
    sevenDay: number;
  };
}

/**
 * Account health update payload (for type: 'account_health_update')
 * Sent every 15 minutes per account with computed health metrics
 */
export interface AccountHealthUpdatePayload {
  /** Account ID in the vault */
  accountId: string;
  /** X handle (without @) */
  handle: string;
  /** Computed health metrics */
  metrics: {
    errors_24h: number;
    successes_24h: number;
    error_rate: number;
    last_successful_action_at: string | null;
    last_failed_action_at: string | null;
    last_error_message: string | null;
    cookie_age_hours: number;
    shadow_ban: {
      status: "clear" | "search_ban" | "suggestion_ban" | "ghost_ban" | "unknown";
      checked_at: string | null;
      search_visible: boolean;
    };
    engagement_velocity: number | null;
    health_score: number;
    computed_at: string;
  };
}

/**
 * Health alert payload (for type: 'health_alert')
 * Sent when an account crosses a health threshold or shadow ban is detected
 */
export interface HealthAlertPayload {
  /** The alert details */
  alert: {
    id: string;
    severity: "critical" | "warning" | "info";
    category: "account_health" | "cookie_expiry" | "shadow_ban" | "rate_limit" | "system";
    title: string;
    message: string;
    accountId?: string;
    handle?: string;
    action?: {
      label: string;
      target: string;
    };
    acknowledged: boolean;
    created_at: string;
    auto_dismiss_ms: number | null;
  };
  /** Whether this is a new alert or an update to existing */
  action: "created" | "resolved" | "escalated";
}

/**
 * X account state type for WebSocket payloads
 */
export type XAccountState = "active" | "warming" | "suspended" | "locked" | "profile_setup" | "created" | "purged";

/**
 * Warming progress summary for WebSocket payloads
 */
export interface XWarmingProgress {
  /** Current warming day (1-14) */
  currentDay: number;
  /** Total warming days */
  totalDays: number;
  /** Actions completed today */
  actionsToday: number;
  /** Max actions allowed today */
  maxActionsToday: number;
}

/**
 * X account updated payload (for type: 'x_account_updated')
 * Sent when a single X account's state changes (warming step, suspension, import, etc.)
 */
export interface XAccountUpdatedPayload {
  /** Account ID in the vault */
  accountId: string;
  /** X handle (without @) */
  handle: string;
  /** Previous account state (if known) */
  previousState?: XAccountState;
  /** Current account state after change */
  currentState: XAccountState;
  /** Warming progress (if account is in warming state) */
  warming?: XWarmingProgress;
  /** What triggered this update */
  changeSource:
    | "warming_step"
    | "health_check"
    | "suspension_detected"
    | "account_created"
    | "profile_updated"
    | "manual_import"
    | "vault_file_change";
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * X accounts snapshot payload (for type: 'x_accounts_snapshot')
 * Sent on initial subscribe_all to seed the frontend with current account list
 */
export interface XAccountsSnapshotPayload {
  /** All accounts currently in the vault */
  accounts: Array<{
    /** Account ID */
    id: string;
    /** X handle */
    handle: string;
    /** Current state */
    state: XAccountState;
    /** How account was created */
    creationMethod?: string;
    /** Warming progress (if warming) */
    warming?: XWarmingProgress;
    /** ISO timestamp of account creation */
    createdAt: string;
    /** ISO timestamp of last update */
    updatedAt: string;
  }>;
}

/**
 * X operation progress payload (for type: 'x_operation_progress')
 * Streamed during long-running operations (warming steps, cookie harvesting, etc.)
 * Follows the CLI login progress pattern for multi-stage updates.
 */
export interface XOperationProgressPayload {
  /** Unique operation identifier */
  operationId: string;
  /** Account being operated on (if applicable) */
  accountId?: string;
  /** Type of operation */
  operationType:
    | "warming_step"
    | "health_check"
    | "profile_setup"
    | "cookie_harvest"
    | "tweet_post"
    | "account_import";
  /** Human-readable stage description */
  stage: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable status message */
  message: string;
  /** Operation status */
  status: "running" | "completed" | "failed";
  /** Error message (when status is 'failed') */
  error?: string;
  /** Operation result data (when status is 'completed') */
  result?: unknown;
}

/**
 * Log event payload (for type: 'log')
 */
export interface LogEventPayload {
  /** Type of log event */
  eventType: "routing-decision" | "token-update" | "tool-call";
  /** Event data - varies by eventType */
  data: unknown;
}

/**
 * Log entry payload (for type: 'log_entry')
 * Used by LiveLogStream to broadcast routing decision logs via WebSocket
 */
export interface LogEntryPayload {
  /** Timestamp of the routing decision */
  timestamp: string;
  /** Project name for display */
  projectName: string;
  /** Session number (0 for routing logs) */
  sessionNumber: number;
  /** Entry type (e.g., 'routing-decision') */
  type: string;
  /** Agent or skill name that was selected */
  agent?: string;
  /** Skill name (if applicable) */
  skill?: string;
  /** Agent context when skill invoked from agent */
  agentContext?: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Whether recommendation was followed */
  followed?: boolean;
  /** MCP server name (for mcp_tool_call type) */
  mcpServer?: string;
  /** MCP tool name (for mcp_tool_call type) */
  mcpTool?: string;
}

/**
 * Session lifecycle payload (for type: 'session-update')
 */
export interface SessionUpdatePayload {
  /** Session lifecycle status */
  status: "ended" | "started";
}

/**
 * Error payload (for type: 'error')
 */
export interface ErrorPayload {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether client should remain connected */
  recoverable: boolean;
}

/**
 * Warning payload (for type: 'warning')
 */
export interface WarningPayload {
  /** Warning code for programmatic handling */
  code: string;
  /** Human-readable warning message */
  message: string;
}

/**
 * Docker log payload (for type: 'docker_log')
 * Used by DockerLogStreamService to broadcast container logs via WebSocket
 */
export interface DockerLogPayload {
  /** Container name (claude-proxy, mcp-proxy, claude-dashboard) */
  container: string;
  /** Log level inferred from content */
  level: "debug" | "error" | "info" | "warn";
  /** Log message content */
  message: string;
  /** Stream source (stdout or stderr) */
  stream: "stderr" | "stdout";
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Token usage breakdown from Claude API
 */
export interface TokenUsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Agent completion payload (for type: 'agent_completion')
 * Used by AgentCompletionStream to broadcast agent completion metrics via WebSocket
 */
export interface AgentCompletionPayload {
  /** ISO timestamp of completion */
  timestamp: string;
  /** Project name where agent ran */
  projectName: string;
  /** Session ID (UUID from JSONL filename) */
  sessionId: string;
  /** Agent ID assigned by Claude Code */
  agentId?: string;
  /** Agent type (subagent_type) if known */
  agentType?: string;
  /** Completion status */
  status: string;
  /** Total tokens used by agent */
  totalTokens?: number;
  /** Execution duration in milliseconds */
  totalDurationMs?: number;
  /** Number of tool calls made by agent */
  totalToolUseCount?: number;
  /** Detailed token usage breakdown */
  usage?: TokenUsageBreakdown;
}

/**
 * Active agent entry (used in ActiveAgentsPayload)
 * Represents an agent currently working on a task
 */
export interface ActiveAgentEntry {
  /** Unique identifier for the agent */
  agentId: string;
  /** Agent type (e.g., 'backend-engineer', 'frontend-engineer') */
  agentType: string;
  /** Parent project name */
  projectName: string;
  /** Session ID for correlation */
  sessionId: string;
  /** ISO timestamp when agent was spawned */
  spawnedAt: string;
}

/**
 * Active agents payload (for type: 'active_agents')
 * Sent when a client subscribes to provide currently in-progress agents
 * Enables visualization to seed with existing agents on page load
 */
export interface ActiveAgentsPayload {
  /** List of currently active agents */
  agents: ActiveAgentEntry[];
}

/**
 * Credential updated payload (for type: 'credentials_updated')
 * Sent when CLI credentials are synced to dashboard via CliCredentialWatcher.
 * Enables frontend to auto-refresh account list when user logs in via Claude CLI.
 */
export interface CredentialUpdatedPayload {
  /** Unique account identifier (SHA256 hash of email) */
  accountId: string;
  /** User's email address */
  email: string;
  /** Subscription type (free, pro, team, etc.) */
  subscriptionType: string;
  /** Whether account was added new or updated existing */
  action: "added" | "updated";
  /** ISO timestamp of when credentials were synced */
  syncedAt: string;
}

/**
 * Session state change payload (for type: 'session_state_change')
 * Broadcast when a session's activity state changes (working, idle, waiting_permission)
 */
export interface SessionStateChangePayload {
  /** Tmux session name */
  sessionName: string;
  /** New activity state */
  state: "error" | "idle" | "working" | "waiting_permission";
  /** ISO 8601 timestamp of the state change */
  timestamp: string;
  /** Tool name requiring permission (when state is waiting_permission) */
  toolName?: string;
  /** Error message (when state is error) */
  errorMessage?: string;
  /** Cumulative tokens used in this session */
  cumulativeTokens?: number;
  /** Project name derived from CWD */
  projectName?: string;
}

/**
 * API log payload (for type: 'api_log')
 * Used by API request logging middleware to broadcast request/response data
 */
export interface ApiLogPayload {
  /** ISO timestamp */
  timestamp: string;
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string;
  /** Request path */
  path: string;
  /** HTTP status code */
  statusCode: number;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Error message if status >= 400 */
  error?: string;
  /** Additional context (e.g., project name for update requests) */
  detail?: string;
}

/**
 * System log payload (for type: 'system_log')
 * Used by account management services to broadcast logs to dashboard
 */
export interface SystemLogPayload {
  /** ISO timestamp */
  timestamp: string;
  /** Log source/service (AccountManager, UsageMonitor, CredentialSync, etc.) */
  source: string;
  /** Log level */
  level: "debug" | "error" | "info" | "warn";
  /** Log message */
  message: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
}

/**
 * Messages sent from server to client
 */
export interface WSServerMessage {
  /** Message type */
  type: WSServerMessageType;
  /** Session ID message relates to (for log/session-update types) */
  sessionId?: string;
  /** Message payload - varies by type */
  payload?:
    | AccountHealthUpdatePayload
    | AccountRotatedPayload
    | ActiveAgentsPayload
    | AgentCompletionPayload
    | ApiLogPayload
    | CliLoginCompletePayload
    | CliLoginErrorPayload
    | CliLoginOutputPayload
    | CliLoginUrlPayload
    | CredentialUpdatedPayload
    | DockerLogPayload
    | EmailAccountUpdatedPayload
    | EmailAccountsSnapshotPayload
    | ErrorPayload
    | HealthAlertPayload
    | LogEntryPayload
    | LogEventPayload
    | SessionStateChangePayload
    | SessionUpdatePayload
    | SystemLogPayload
    | WarningPayload
    | XAccountUpdatedPayload
    | XAccountsSnapshotPayload
    | XOperationProgressPayload;
  /** ISO 8601 timestamp when message was created */
  timestamp: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Backpressure configuration for managing slow clients
 */
export interface BackpressureConfig {
  /** Maximum messages to buffer per client (default: 1000) */
  bufferSize: number;
  /** Percentage at which to send warning (default: 0.8 = 80%) */
  warningThreshold: number;
  /** Strategy when buffer full */
  overflowStrategy: "disconnect" | "drop-newest" | "drop-oldest";
}

/**
 * WebSocket server configuration
 */
export interface WebSocketServerConfig {
  /** Maximum connections per IP (default: 10) */
  maxConnectionsPerIp?: number;
  /** Maximum total connections (default: 100) */
  maxTotalConnections?: number;
  /** Maximum subscriptions per connection (default: 20) */
  maxSubscriptionsPerConnection?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Heartbeat timeout in ms (default: 10000) */
  heartbeatTimeout?: number;
  /** Backpressure configuration */
  backpressure?: Partial<BackpressureConfig>;
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * WebSocket error codes for programmatic handling
 */
export type WSErrorCode =
  | "CONNECTION_LIMIT"
  | "INTERNAL_ERROR"
  | "INVALID_MESSAGE"
  | "INVALID_SESSION_ID"
  | "PARSE_ERROR"
  | "SESSION_NOT_FOUND"
  | "SUBSCRIPTION_LIMIT";

/**
 * WebSocket warning codes for programmatic handling
 */
export type WSWarningCode = "BUFFER_NEAR_CAPACITY";

// ============================================================================
// Internal Types (used by implementation)
// ============================================================================

/**
 * Connection metadata tracked per WebSocket client
 */
export interface ConnectionMetadata {
  /** Client IP address */
  ip: string;
  /** Session IDs this connection is subscribed to */
  subscriptions: Set<string>;
  /** Message buffer for backpressure handling */
  messageBuffer: WSServerMessage[];
  /** Whether warning has been sent for buffer capacity */
  bufferWarningActive: boolean;
  /** Last activity timestamp for heartbeat tracking */
  lastActivity: number;
  /** Heartbeat timeout timer reference */
  heartbeatTimeout?: ReturnType<typeof setTimeout>;
  /** Whether connection is alive (for ping/pong tracking) */
  isAlive: boolean;
}
