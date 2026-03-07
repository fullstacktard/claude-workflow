/**
 * WebSocket Types for Dashboard Frontend
 */

/**
 * Client to server message types
 */
export type WSClientMessageType = "ping" | "subscribe" | "unsubscribe";

/**
 * Client to server message
 */
export interface WSClientMessage {
  sessionId?: string;
  type: WSClientMessageType;
}

/**
 * Server to client message types
 */
export type WSServerMessageType =
  | "account_health_update"
  | "account_rotated"
  | "active_agents"
  | "agent_completion"
  | "api_log"
  | "cli_login_complete"
  | "cli_login_error"
  | "cli_login_progress"
  | "cli_login_url"
  | "content_calendar_event"
  | "content_scheduler_event"
  | "credentials_updated"
  | "docker_log"
  | "draft_published"
  | "draft_updated"
  | "drafts_snapshot"
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
 * Log event payload
 */
export interface LogEventPayload {
  data: unknown;
  eventType: "routing-decision" | "token-update" | "tool-call";
}

/**
 * Session update payload
 */
export interface SessionUpdatePayload {
  status: "ended" | "started";
}

/**
 * Error payload
 */
export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

/**
 * Warning payload
 */
export interface WarningPayload {
  code: string;
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
 * Account rotated payload (for type: 'account_rotated')
 * Sent when the proxy rotates to a different OAuth account
 */
export interface AccountRotatedPayload {
  /** ISO timestamp when rotation occurred */
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
 * Session state change payload (for type: 'session_state_change')
 * Broadcast when a session's activity state changes
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
  /** Error message (when state is error, e.g. rate limit or compact error) */
  errorMessage?: string;
  /** Cumulative tokens used in this session */
  cumulativeTokens?: number;
  /** Project name derived from CWD */
  projectName?: string;
}

/**
 * Activity log entry payload (for type: 'log_entry')
 * Used by LiveLogStreamService to broadcast activity logs via WebSocket
 */
export interface LogEntryPayload {
  /** Agent name if agent invocation */
  agent?: string;
  /** Agent context when skill invoked from agent */
  agentContext?: string;
  /** Confidence score 0-1 */
  confidence?: number;
  /** Routing decision made */
  decision?: string;
  /** Human-readable message for dashboard display */
  message?: string;
  /** Whether recommendation was followed */
  followed?: boolean;
  /** Recommendation ID for correlating with follow-through events */
  recommendationId?: string;
  /** MCP server name (for mcp_tool_call type) */
  mcpServer?: string;
  /** MCP tool name (for mcp_tool_call type) */
  mcpTool?: string;
  /** Project display name */
  projectName: string;
  /** Session number */
  sessionNumber: number;
  /** Skill name if skill invocation */
  skill?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Entry type (agent_invocation, skill_invocation, etc.) */
  type: string;
  // Agent completion fields (when type === "agent_completion")
  /** Agent ID from Claude Code */
  agentId?: string;
  /** Agent type (subagent_type) */
  agentType?: string;
  /** Completion status */
  status?: string;
  /** Total tokens used */
  totalTokens?: number;
  /** Execution duration in ms */
  totalDurationMs?: number;
  /** Number of tool calls */
  totalToolUseCount?: number;
  /** Detailed token usage */
  usage?: TokenUsageBreakdown;
  /** Cumulative context token usage for this session */
  sessionContextTokens?: number;
}

/**
 * X account state type for WebSocket payloads
 * Note: This is the WS-specific state enum (broader than the DashboardXAccount state)
 */
export type WSXAccountState = "active" | "warming" | "suspended" | "locked" | "profile_setup" | "created" | "purged";

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
  previousState?: WSXAccountState;
  /** Current account state after change */
  currentState: WSXAccountState;
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
    state: WSXAccountState;
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
 * Draft updated payload (for type: 'draft_updated')
 * Sent when a single draft changes (edit, approve, reject)
 */
export interface DraftUpdatedPayload {
  /** Draft ID */
  draftId: string;
  /** New status (if changed) */
  status?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Draft published payload (for type: 'draft_published')
 * Sent when a draft is published to X
 */
export interface DraftPublishedPayload {
  /** Draft ID */
  draftId: string;
  /** Published tweet ID */
  tweetId?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Drafts snapshot payload (for type: 'drafts_snapshot')
 * Sent on initial subscribe_all to seed the frontend with current drafts
 */
export interface DraftsSnapshotPayload {
  /** Draft IDs currently in the system */
  draftIds: string[];
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
 * Server to client message
 */
export interface WSServerMessage {
  payload?:
    | AccountHealthUpdatePayload
    | AccountRotatedPayload
    | ActiveAgentsPayload
    | AgentCompletionPayload
    | ApiLogPayload
    | CliLoginCompletePayload
    | CliLoginErrorPayload
    | CliLoginProgressPayload
    | CliLoginUrlPayload
    | CredentialsUpdatedPayload
    | DockerLogPayload
    | DraftPublishedPayload
    | DraftUpdatedPayload
    | DraftsSnapshotPayload
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
  sessionId?: string;
  timestamp: string;
  type: WSServerMessageType;
}

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
 * CLI login progress payload (for type: 'cli_login_progress')
 */
export interface CliLoginProgressPayload {
  /** Elapsed time in milliseconds */
  elapsedTime: number;
  /** Progress message */
  message: string;
  /** Session ID */
  sessionId: string;
}

/**
 * Credentials updated payload (for type: 'credentials_updated')
 * Sent when CLI credential sync detects account changes
 */
export interface CredentialsUpdatedPayload {
  /** Account ID */
  accountId: string;
  /** Action type: account was added or updated */
  action: "added" | "updated";
  /** Email of the synced account */
  email: string;
  /** Source of the sync */
  source: "cli";
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
 * Log entry for display
 */
export interface LogEntry {
  data: unknown;
  eventType: string;
  sessionId: string;
  timestamp: string;
}

/**
 * Session info
 */
export interface Session {
  id: string;
  inputTokens?: number;
  outputTokens?: number;
  startTime?: string;
  status: "active" | "ended" | "paused";
  /** Project name from session discovery */
  projectName?: string;
  /** Elapsed time string (e.g., "10m 30s") */
  elapsedTime?: string;
}
