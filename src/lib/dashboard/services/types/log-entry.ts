/**
 * Standardized Log Entry Types for Agent and Skill Invocations
 *
 * Provides type definitions for log entries used by dashboard for consistent
 * display across all log sources.
 */

// ============================================================================
// Event Types for event-sourcing architecture (logging consolidation feature)
// ============================================================================

/**
 * All possible event types in events.jsonl
 */
export type EventType =
  | "session_start"
  | "session_end"
  | "recommendation"
  | "agent_invocation"
  | "skill_invocation"
  | "follow_through"
  | "compliance"
  | "tokens"
  | "agent_start"
  | "agent_end"
  | "agent_completion"
  | "mcp_tool_call"
  | "workflow_start"
  | "workflow_stage"
  | "workflow_trigger"
  | "workflow_complete"
  | "workflow_resumed";

/**
 * Alias for EventType - used for consistency with naming conventions
 */
export type LogEventType = EventType;

/**
 * Base event interface - all events extend this
 */
export interface LogEvent {
  /** ISO timestamp */
  ts: string;
  /** Event type */
  type: EventType;
  /** Session identifier (timestamp-pid format) */
  session: string;
}

/**
 * Session start event - written when Claude session begins
 */
export interface SessionStartEvent extends LogEvent {
  type: "session_start";
  pid: number;
  projectPath: string;
  projectName: string;
}

/**
 * Session end event - detected via timeout or process exit
 */
export interface SessionEndEvent extends LogEvent {
  type: "session_end";
  endReason?: "timeout" | "process_exit" | "explicit";
}

/**
 * Recommendation event - routing recommendation made by hooks
 */
export interface RecommendationEvent extends LogEvent {
  type: "recommendation";
  /** Unique recommendation ID for correlation */
  id: string;
  /** Recommended agent (if agent recommendation) */
  agent?: string;
  /** Recommended skills (if skill recommendation) */
  skills?: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Agent context if recommendation made inside an agent */
  agentContext?: string;
}

/**
 * Follow-through event - tracks whether recommendation was followed
 */
export interface FollowThroughEvent extends LogEvent {
  type: "follow_through";
  /** ID of the recommendation being resolved */
  recommendationId: string;
  /** Whether the recommendation was followed */
  followed: boolean;
  /** What type was invoked */
  invokedType?: "agent" | "skill";
  /** Name of what was invoked */
  invokedName?: string;
  /** True if recommendation expired without any tool use */
  expired?: boolean;
  /** Agent context if inside an agent */
  agentContext?: string;
}

/**
 * Agent invocation event - agent spawned via Task tool
 */
export interface AgentInvocationEvent extends LogEvent {
  type: "agent_invocation";
  /** Agent type being spawned */
  agent: string;
  /** Tool use ID from Claude */
  toolUseId: string;
  /** Skills expected from agent */
  expectedSkills?: string[];
  /** Recommendation ID if following a recommendation */
  recommendationId?: string;
}

/**
 * Skill invocation event - skill invoked via Skill tool
 */
export interface SkillInvocationEvent extends LogEvent {
  type: "skill_invocation";
  /** Skill name */
  skill: string;
  /** Agent context if invoked inside an agent */
  agentContext?: string;
}

/**
 * Tokens event - token usage tracking (placeholder for future API)
 */
export interface TokensEvent extends LogEvent {
  type: "tokens";
  /** Input tokens (non-cached) */
  input: number;
  /** Output tokens */
  output: number;
  /** Cache creation input tokens */
  cacheCreation?: number;
  /** Cache read input tokens */
  cacheRead?: number;
  /** Optional agent context for attribution */
  agentContext?: string;
}

/**
 * Agent start event - agent process actually started
 */
export interface AgentStartEvent extends LogEvent {
  type: "agent_start";
  /** Agent process PID */
  agentPid: number;
  /** Tool use ID for correlation */
  toolUseId: string;
  /** Agent type */
  agentType: string;
}

/**
 * Agent end event - agent process completed
 */
export interface AgentEndEvent extends LogEvent {
  type: "agent_end";
  /** Agent process PID */
  agentPid: number;
  /** Exit code if available */
  exitCode?: number;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * Agent completion event - from AgentCompletionStream
 * More complete than agent_end - includes tokens and duration with agent type
 */
export interface AgentCompletionEvent extends LogEvent {
  type: "agent_completion";
  /** Agent type (e.g., "backend-engineer", "frontend-engineer") */
  agentType: string;
  /** Completion status */
  status: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Total tokens used */
  totalTokens?: number;
  /** Input tokens */
  inputTokens?: number;
  /** Output tokens */
  outputTokens?: number;
}

/**
 * Compliance event - blocked/allowed action by compliance hooks
 */
export interface ComplianceEvent extends LogEvent {
  type: "compliance";
  /** Tool that was checked */
  tool: string;
  /** Decision made */
  decision: "blocked" | "allowed";
  /** Reason for decision */
  reason: string;
  /** Hook that made the decision */
  hookName: string;
}

/**
 * MCP tool call event - tracks MCP server tool invocations
 * Written by skill-tracker hook when MCP tools are used
 */
export interface McpToolCallEvent extends LogEvent {
  type: "mcp_tool_call";
  /** MCP server name (e.g., "serena", "mcp-proxy", "playwright") */
  mcpServer: string;
  /** MCP tool name (e.g., "find_symbol", "web_search_exa", "browser_snapshot") */
  mcpTool: string;
  /** Agent context if invoked inside an agent */
  agentContext?: string;
  /** Tool use ID from Claude for correlation */
  toolUseId?: string;
}

// ============================================================================
// Workflow Event Types
// ============================================================================

/**
 * Workflow start event - emitted when /workflow command is invoked
 * Captures the workflow name extracted from the user's prompt
 */
export interface WorkflowStartEvent extends LogEvent {
  type: "workflow_start";
  /** Human-readable workflow name extracted from prompt */
  workflowName: string;
  /** Preview of the original prompt (truncated to 200 chars) */
  promptPreview: string;
  /** Project path where workflow was initiated */
  projectPath?: string;
  /** Optional workflow ID for tracking */
  workflowId?: string;
}

/**
 * Workflow stages in order
 */
export type WorkflowStage =
  | "feature_planning"
  | "task_creation"
  | "implementation"
  | "code_review"
  | "complete";

/**
 * Workflow stage event - tracks workflow stage transitions and enforcement
 */
export interface WorkflowStageEvent extends LogEvent {
  type: "workflow_stage";
  /** Current workflow stage */
  stage: WorkflowStage;
  /** Action taken (allowed, blocked, override) */
  action: "allowed" | "blocked" | "override";
  /** Agent type that was checked */
  agentType?: string;
  /** Tool name that was checked */
  toolName?: string;
  /** Stage description for display */
  stageDescription: string;
  /** Reason for block/allow decision */
  reason?: string;
  /** Number of completed agents in current stage */
  stageProgress?: {
    completed: number;
    total: number;
  };
}

/**
 * Workflow trigger event - tracks pipeline handoffs between agents
 */
export interface WorkflowTriggerEvent extends LogEvent {
  type: "workflow_trigger";
  /** Task ID for which the trigger occurred */
  taskId: number;
  /** Agent type that just completed */
  completedAgent: string;
  /** Next agent to be spawned */
  nextAgent: string;
  /** Prompt for next agent */
  nextPrompt?: string;
}

/**
 * Workflow complete event - marks task completion through the pipeline
 */
export interface WorkflowCompleteEvent extends LogEvent {
  type: "workflow_complete";
  /** Task ID that was completed */
  taskId: number;
  /** Stages completed (task-maker → implementation → code-review) */
  stagesCompleted: string[];
}

/**
 * Workflow resumed event - emitted when an orphaned workflow is recovered
 */
export interface WorkflowResumedEvent extends LogEvent {
  type: "workflow_resumed";
  /** Workflow identifier */
  workflowId: string;
  /** Display name of the workflow */
  workflowName: string;
  /** Session ID from the previous (dead) session */
  previousSessionId: string;
  /** Current phase ID the workflow was in when resumed */
  currentPhase: string;
  /** Number of agents marked as stale during resume */
  staleAgentCount: number;
}

// ============================================================================
// Log Aggregator Types
// ============================================================================

/**
 * Status of a recommendation after follow-through tracking
 */
export type RecommendationStatus = "pending" | "followed" | "ignored" | "expired";

/**
 * Recommendation with derived follow-through status
 */
export interface RecommendationWithStatus extends RecommendationEvent {
  /** Derived status from follow-through correlation */
  status: RecommendationStatus;
  /** What type was invoked (from follow_through event) */
  invokedType?: "agent" | "skill";
  /** Name of what was invoked (from follow_through event) */
  invokedName?: string;
  /** Timestamp of follow-through event */
  followThroughTimestamp?: string;
}

/**
 * Filter options for log queries
 * Extended for new event types
 */
export interface LogFilterOptions {
  /** Filter by recommendation type */
  type?: "agent" | "skill";
  /** Filter by specific event types */
  eventTypes?: LogEventType[];
  /** Filter by follow-through status */
  followed?: boolean;
  /** Filter by project path (substring match) */
  project?: string;
  /** Filter by session ID */
  session?: string;
  /** Filter events within agent context */
  agentContext?: string;
  /** Filter by time range */
  timeRange?: { start: Date; end: Date };
}

/**
 * Pagination options for queries
 */
export interface PaginationOptions {
  /** Maximum number of entries to return */
  limit: number;
  /** Number of entries to skip */
  offset: number;
}

/**
 * Query result with pagination info
 */
export interface QueryResult<T> {
  /** Matching entries */
  entries: T[];
  /** Total count before pagination */
  total: number;
  /** Page size */
  limit: number;
  /** Current offset */
  offset: number;
  /** Whether more results exist */
  hasMore: boolean;
}

/**
 * Log entry format for backward compatibility with existing routes
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Project name */
  project: string;
  /** Entry type */
  type: "agent" | "skill";
  /** Agent name (when type is agent) */
  agent?: string;
  /** Skill name (when type is skill) */
  skill?: string;
  /** Confidence score */
  confidence?: number;
  /** Whether recommendation was followed */
  followed: boolean;
  /** Tool use ID */
  tool_use_id?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent invocation summary for session display
 */
export interface AgentInvocationSummary {
  /** Agent type */
  agent: string;
  /** Tool use ID */
  toolUseId: string;
  /** Start time */
  startTime: Date;
  /** Expected skills */
  expectedSkills: string[];
  /** Skills actually used */
  usedSkills: string[];
}

/**
 * Session summary for dashboard display
 */
export interface SessionSummary {
  /** Session ID (timestamp-pid format) */
  sessionId: string;
  /** Project path */
  projectPath: string;
  /** Project name */
  projectName: string;
  /** Claude process PID */
  pid: number;
  /** Session start time */
  startTime: Date;
  /** Session end time (if ended) */
  endTime?: Date;
  /** End reason (if ended) */
  endReason?: "timeout" | "process_exit" | "explicit";
  /** Timestamp of last event (for 24-hour filtering) */
  lastEventTime: Date;
  /** Whether session is still active */
  isActive: boolean;
  /** Number of events in session */
  eventCount: number;
  /** Number of recommendations made */
  recommendationCount: number;
  /** Number of followed recommendations */
  followedCount: number;
  /** Number of ignored recommendations */
  ignoredCount: number;
  /** Number of expired recommendations */
  expiredCount: number;
  /** Agent invocations in this session */
  agentInvocations: AgentInvocationSummary[];
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
}

/**
 * Session detail including all events
 */
export interface SessionDetail extends SessionSummary {
  /** All events in session */
  events: LogEvent[];
  /** All recommendations with status */
  recommendations: RecommendationWithStatus[];
}

/**
 * Aggregated statistics from LogAggregator
 */
export interface LogAggregatorStats {
  /** Total number of sessions */
  totalSessions: number;
  /** Number of active sessions */
  activeSessions: number;
  /** Total routing decisions */
  totalDecisions: number;
  /** Number of followed recommendations */
  followedCount: number;
  /** Number of ignored recommendations */
  ignoredCount: number;
  /** Number of expired recommendations */
  expiredCount: number;
  /** Agent usage counts */
  agentCounts: { name: string; count: number }[];
  /** Skill usage counts */
  skillCounts: { name: string; count: number }[];
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
}

// ============================================================================
// Supporting Types
// ============================================================================

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
 * Standardized log entry for agent and skill invocations
 * Used by dashboard for consistent display across all log sources.
 */
export interface StandardLogEntry {
  /** ISO timestamp of log entry */
  timestamp: string;

  /** Project name where log originated */
  projectName: string;

  /** Full path to project */
  projectPath: string;

  /** Session identifier for grouping related logs */
  sessionId: string;

  /** Incrementing session number per project (for display) */
  sessionNumber: number;

  /** Type of invocation or recommendation */
  type: "agent_invocation" | "skill_invocation" | "agent_with_skill" | "mcp_tool_call" | "agent_completion" | "workflow_start" | "workflow_stage" | "workflow_trigger" | "workflow_complete" | "workflow_resumed";

  /** Agent name (required for agent_invocation and agent_with_skill) */
  agent?: string;

  /** Skill name (required for skill_invocation and agent_with_skill) */
  skill?: string;

  /** Parent agent context when skill invoked inside an agent */
  agentContext?: string;

  /** Skills expected from agent (for agent_invocation type) */
  expectedSkills?: string[];

  /** MCP server name (for mcp_tool_call type, e.g., "serena", "mcp-proxy") */
  mcpServer?: string;

  /** MCP tool name (for mcp_tool_call type, e.g., "find_symbol", "web_search_exa") */
  mcpTool?: string;

  /** Human-readable message for dashboard display */
  message: string;

  /** Recommendation ID for correlating recommendations with follow-through events */
  recommendationId?: string;

  /** Whether user followed recommendation (updated when follow_through event arrives) */
  followed?: boolean;

  // =========================================================================
  // Agent Completion Metrics (populated for type: "agent_completion")
  // =========================================================================

  /** Agent ID assigned by Claude Code */
  agentId?: string;

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
 * Type guard for StandardLogEntry
 */
export function isStandardLogEntry(obj: unknown): obj is StandardLogEntry {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const entry = obj as Record<string, unknown>;

  return (
    typeof entry.timestamp === "string" &&
    typeof entry.projectName === "string" &&
    typeof entry.projectPath === "string" &&
    typeof entry.sessionId === "string" &&
    typeof entry.sessionNumber === "number" &&
    typeof entry.type === "string" &&
    ["agent_invocation", "skill_invocation", "agent_with_skill", "mcp_tool_call", "agent_completion", "workflow_start", "workflow_stage", "workflow_trigger", "workflow_complete", "workflow_resumed"].includes(entry.type) &&
    typeof entry.message === "string"
  );
}

// ============================================================================
// Type Guards for Event Types
// ============================================================================

/**
 * Union type for all specific event types
 */
export type AnyLogEvent =
  | SessionStartEvent
  | SessionEndEvent
  | RecommendationEvent
  | FollowThroughEvent
  | AgentInvocationEvent
  | SkillInvocationEvent
  | TokensEvent
  | AgentStartEvent
  | AgentEndEvent
  | ComplianceEvent
  | McpToolCallEvent
  | WorkflowStartEvent
  | WorkflowStageEvent
  | WorkflowTriggerEvent
  | WorkflowCompleteEvent;

/**
 * Type guard for LogEvent base structure
 */
export function isLogEvent(obj: unknown): obj is LogEvent {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const event = obj as Record<string, unknown>;
  return (
    typeof event.ts === "string" &&
    typeof event.type === "string" &&
    typeof event.session === "string"
  );
}

/**
 * Type guard for RecommendationEvent
 */
export function isRecommendationEvent(event: LogEvent): event is RecommendationEvent {
  return event.type === "recommendation";
}

/**
 * Type guard for FollowThroughEvent
 */
export function isFollowThroughEvent(event: LogEvent): event is FollowThroughEvent {
  return event.type === "follow_through";
}

/**
 * Type guard for session events (start or end)
 */
export function isSessionEvent(event: LogEvent): event is SessionStartEvent | SessionEndEvent {
  return event.type === "session_start" || event.type === "session_end";
}

/**
 * Type guard for SessionStartEvent specifically
 */
export function isSessionStartEvent(event: LogEvent): event is SessionStartEvent {
  return event.type === "session_start";
}

/**
 * Type guard for SessionEndEvent specifically
 */
export function isSessionEndEvent(event: LogEvent): event is SessionEndEvent {
  return event.type === "session_end";
}

/**
 * Type guard for AgentInvocationEvent
 */
export function isAgentInvocationEvent(event: LogEvent): event is AgentInvocationEvent {
  return event.type === "agent_invocation";
}

/**
 * Type guard for SkillInvocationEvent
 */
export function isSkillInvocationEvent(event: LogEvent): event is SkillInvocationEvent {
  return event.type === "skill_invocation";
}

/**
 * Type guard for ComplianceEvent
 */
export function isComplianceEvent(event: LogEvent): event is ComplianceEvent {
  return event.type === "compliance";
}

/**
 * Type guard for TokensEvent
 */
export function isTokensEvent(event: LogEvent): event is TokensEvent {
  return event.type === "tokens";
}

/**
 * Type guard for agent lifecycle events (start or end)
 */
export function isAgentLifecycleEvent(event: LogEvent): event is AgentStartEvent | AgentEndEvent {
  return event.type === "agent_start" || event.type === "agent_end";
}

/**
 * Type guard for McpToolCallEvent
 */
export function isMcpToolCallEvent(event: LogEvent): event is McpToolCallEvent {
  return event.type === "mcp_tool_call";
}

/**
 * Type guard for WorkflowStartEvent
 */
export function isWorkflowStartEvent(event: LogEvent): event is WorkflowStartEvent {
  return event.type === "workflow_start";
}

/**
 * Type guard for WorkflowStageEvent
 */
export function isWorkflowStageEvent(event: LogEvent): event is WorkflowStageEvent {
  return event.type === "workflow_stage";
}

/**
 * Type guard for WorkflowTriggerEvent
 */
export function isWorkflowTriggerEvent(event: LogEvent): event is WorkflowTriggerEvent {
  return event.type === "workflow_trigger";
}

/**
 * Type guard for WorkflowCompleteEvent
 */
export function isWorkflowCompleteEvent(event: LogEvent): event is WorkflowCompleteEvent {
  return event.type === "workflow_complete";
}

/**
 * Type guard for WorkflowResumedEvent
 */
export function isWorkflowResumedEvent(event: LogEvent): event is WorkflowResumedEvent {
  return event.type === "workflow_resumed";
}

/**
 * Type guard for any workflow event
 */
export function isWorkflowEvent(event: LogEvent): event is WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent {
  return event.type === "workflow_start" || event.type === "workflow_stage" || event.type === "workflow_trigger" || event.type === "workflow_complete" || event.type === "workflow_resumed";
}

/**
 * Type guard for AgentStartEvent
 */
export function isAgentStartEvent(event: LogEvent): event is AgentStartEvent {
  return event.type === "agent_start";
}

/**
 * Type guard for AgentEndEvent
 */
export function isAgentEndEvent(event: LogEvent): event is AgentEndEvent {
  return event.type === "agent_end";
}

/**
 * Type guard for AgentCompletionEvent
 */
export function isAgentCompletionEvent(event: LogEvent): event is AgentCompletionEvent {
  return event.type === "agent_completion";
}

// ============================================================================
// Agent Stats 24h Types
// ============================================================================

/**
 * Metrics for a single agent over 24 hours
 */
export interface AgentMetrics {
  /** Agent type name (e.g., "backend-engineer", "frontend-engineer") */
  name: string;
  /** Number of times this agent was invoked */
  invocationCount: number;
  /** Completion time statistics in milliseconds */
  completionTime: {
    avg: number;
    min: number;
    max: number;
  };
  /** Token usage statistics */
  tokens: {
    total: number;
    avg: number;
  };
  /** Skills used by this agent */
  skillsUsed: string[];
}

/**
 * MCP tool call metric
 */
export interface McpToolMetric {
  /** MCP server name (e.g., "serena", "mcp-proxy") */
  server: string;
  /** MCP tool name (e.g., "find_symbol", "web_search_exa") */
  tool: string;
  /** Number of times this tool was called */
  count: number;
}

/**
 * Aggregated agent statistics for 24-hour period
 */
export interface AgentStats24h {
  /** Time range in hours (always 24) */
  timeRangeHours: number;
  /** ISO timestamp when stats were generated */
  generatedAt: string;
  /** Per-agent metrics sorted by invocation count descending */
  agents: AgentMetrics[];
  /** MCP tool call metrics sorted by count descending */
  mcpTools: McpToolMetric[];
  /** Top skills used across all agents */
  topSkills: { name: string; count: number }[];
}

