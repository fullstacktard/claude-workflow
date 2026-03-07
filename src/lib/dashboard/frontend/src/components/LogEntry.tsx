/**
 * LogEntry Component
 * Single log entry display for live log feed
 */

import type { StreamLogEntry, TokenUsage } from "../hooks/useLogStream";
import { getAgentColorClass } from "../utils/agentColors";

/**
 * Props for LogEntry component
 */
export interface LogEntryProps {
  /** Entry timestamp (ISO format) */
  timestamp: string;
  /** Project name */
  projectName: string;
  /** Session number */
  sessionNumber: number;
  /** Entry type (agent_invocation, skill_invocation, agent_with_skill, agent_completion) */
  type: StreamLogEntry["type"];
  /** Agent name if present */
  agent?: string;
  /** Skill name if present */
  skill?: string;
  /** Agent context (agent name when skill is invoked by agent) */
  agentContext?: string;
  /** Confidence score 0-1 for recommendations */
  confidence?: number;
  /** Whether the recommendation was followed */
  followed?: boolean;
  // MCP tool call fields (when type === "mcp_tool_call")
  /** MCP server name (e.g., "serena", "mcp-proxy") */
  mcpServer?: string;
  /** MCP tool name (e.g., "find_symbol", "web_search_exa") */
  mcpTool?: string;
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
  usage?: TokenUsage;
  /** Cumulative context token usage for this session */
  sessionContextTokens?: number;
}

/**
 * Format timestamp for display
 * Shows date for entries older than today
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString();
  }

  // For older entries, show date and time
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Get entry type display text - clearly distinguish recommendations from invocations
 * For follow-through entries, optionally include what was followed/ignored
 */
function getTypeText(type: string, agent?: string, skill?: string): string {
  switch (type) {
    case "agent_invocation":
      return "Agent";
    case "agent_with_skill":
      return "Agent+Skill";
    case "skill_invocation":
      return "Skill";
    case "mcp_tool_call":
      return "mcp";
    case "agent_recommendation":
      return "agent recommendation";
    case "skill_recommendation":
      return "skill recommendation";
    case "recommendation_followed":
      // Show what was followed: "followed agent" or "followed skill"
      if (agent) return "followed agent";
      if (skill) return "followed skill";
      return "followed";
    case "recommendation_ignored":
      // Show what was ignored: "ignored agent" or "ignored skill"
      if (agent) return "ignored agent";
      if (skill) return "ignored skill";
      return "ignored";
    case "agent_completion":
      return "completed";
    default:
      return type;
  }
}

/**
 * Get color class for entry type - visual distinction between recommendations and invocations
 */
function getTypeColorClass(type: string): string {
  switch (type) {
    // Recommendations in yellow/amber - indicates suggestion, not action
    case "agent_recommendation":
    case "skill_recommendation":
      return "text-yellow-400";
    // Invocations in green - indicates action taken
    case "agent_invocation":
    case "agent_with_skill":
    case "skill_invocation":
      return "text-green-400";
    // MCP tool calls in purple - indicates MCP server interaction
    case "mcp_tool_call":
      return "text-purple-400";
    // Follow-through states
    case "recommendation_followed":
      return "text-green-400";
    case "recommendation_ignored":
      return "text-orange-400";
    // Completions in blue - indicates finished
    case "agent_completion":
      return "text-blue-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Check if entry type is a recommendation
 */
function isRecommendationType(type: string): boolean {
  return type === "agent_recommendation" || type === "skill_recommendation";
}

/**
 * Check if entry type is an agent completion
 */
function isAgentCompletion(type: string): boolean {
  return type === "agent_completion";
}

/**
 * Check if entry type is an MCP tool call
 */
function isMcpToolCall(type: string): boolean {
  return type === "mcp_tool_call";
}

/**
 * Format token count for display (e.g., 100429 -> "100.4k")
 */
function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "";
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Format duration for display (e.g., 143347ms -> "2m 23s")
 */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Strip " invoked" or " recommended" suffix from agent/skill names
 */
function normalizeDisplayName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.replace(/ (invoked|recommended)$/i, '').trim();
}

/**
 * LogEntry component
 */
/**
 * Format confidence as percentage for display
 */
function formatConfidence(confidence: number | undefined): string {
  if (confidence === undefined) return "";
  return `${Math.round(confidence * 100)}%`;
}

/** Base Tailwind classes for log entry */
const LOG_ENTRY_BASE = "font-mono text-sm py-1 px-2 border-l-2 border-transparent";

export function LogEntry({
  timestamp,
  projectName,
  sessionNumber,
  type,
  agent,
  skill,
  agentContext,
  confidence,
  followed,
  mcpServer,
  mcpTool,
  agentId,
  agentType,
  status,
  totalTokens,
  totalDurationMs,
  totalToolUseCount,
  sessionContextTokens,
}: LogEntryProps): JSX.Element {
  const displayAgent = normalizeDisplayName(agent ?? agentContext);
  const displaySkill = normalizeDisplayName(skill);
  const agentColorClass = getAgentColorClass(agent ?? agentContext ?? agentType);
  const skillColorClass = "text-cyan-400";
  const showAgentInfo = displayAgent !== undefined || displaySkill !== undefined;
  const isRecommendation = isRecommendationType(type);
  const isCompletion = isAgentCompletion(type);
  const isMcp = isMcpToolCall(type);

  // For recommendations: use actual agent color but with font-semibold
  // Agent color is derived from the agent name for consistency
  const recommendationAgentClass = `${agentColorClass} font-semibold`;
  const recommendationSkillClass = "text-cyan-400 font-semibold";

  // MCP tool call entry - special display with server and tool
  if (isMcp && (mcpServer !== undefined || mcpTool !== undefined)) {
    // Skip tool name when it's redundant with server name (e.g. sequential-thinking / sequentialthinking)
    const normalizedServer = mcpServer?.replace(/[-_]/g, "").toLowerCase();
    const normalizedTool = mcpTool?.replace(/[-_]/g, "").toLowerCase();
    const toolIsRedundant = normalizedServer && normalizedTool && normalizedServer === normalizedTool;

    return (
      <div className={LOG_ENTRY_BASE}>
        <span className="text-gray-500">{formatTimestamp(timestamp)}</span>
        <span className="ml-2">
          {projectName} <span className="text-gray-600">::</span> Session #{sessionNumber}
        </span>
        <span className="ml-2 font-mono text-purple-400">mcp</span>
        <span className="ml-1 text-gray-600">-</span>
        {mcpServer && (
          <span className="ml-1 text-purple-300">{mcpServer}</span>
        )}
        {mcpServer && mcpTool && !toolIsRedundant && (
          <span className="text-gray-500">::</span>
        )}
        {mcpTool && !toolIsRedundant && (
          <span className="text-purple-400">{mcpTool}</span>
        )}
        {/* Show agent context if inside an agent */}
        {agentContext && (
          <span className="ml-2 text-gray-500">
            (via <span className={getAgentColorClass(agentContext)}>{agentContext}</span>)
          </span>
        )}
      </div>
    );
  }

  // Agent completion entry - special display with metrics
  // Format: project :: Session #N - completed/exited - agent - tokens - duration - tools
  if (isCompletion) {
    const agentDisplayName = agentType ?? agentId ?? "agent";
    const completionColorClass = getAgentColorClass(agentDisplayName);
    const isSuccess = status === "completed";
    const statusText = isSuccess ? "completed" : "exited";
    const statusColor = isSuccess ? "text-green-400" : "text-red-400";

    return (
      <div className={LOG_ENTRY_BASE}>
        <span className="text-gray-500">{formatTimestamp(timestamp)}</span>
        <span className="ml-2">
          {projectName} <span className="text-gray-600">::</span> Session #{sessionNumber}
        </span>
        <span className="text-gray-600 ml-1">-</span>
        <span className={`ml-1 font-mono ${statusColor}`}>
          {statusText}
        </span>
        <span className="text-gray-600 ml-1">-</span>
        <span className={`ml-1 ${completionColorClass}`}>
          {agentDisplayName}
        </span>
        {/* Token usage */}
        {totalTokens !== undefined && (
          <>
            <span className="text-gray-600 ml-1">-</span>
            <span className="ml-1 text-purple-400" title={`${totalTokens} tokens`}>
              {formatTokens(totalTokens)} tokens
            </span>
          </>
        )}
        {/* Duration */}
        {totalDurationMs !== undefined && (
          <>
            <span className="text-gray-600 ml-1">-</span>
            <span className="ml-1 text-blue-400" title={`${totalDurationMs}ms`}>
              {formatDuration(totalDurationMs)}
            </span>
          </>
        )}
        {/* Tool count */}
        {totalToolUseCount !== undefined && (
          <>
            <span className="text-gray-600 ml-1">-</span>
            <span className="ml-1 text-gray-400" title={`${totalToolUseCount} tool calls`}>
              {totalToolUseCount} tools
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={LOG_ENTRY_BASE}>
      <span className="text-gray-500">{formatTimestamp(timestamp)}</span>
      <span className="ml-2">
        {projectName} <span className="text-gray-600">::</span> Session #{sessionNumber}
        {sessionContextTokens !== undefined && sessionContextTokens > 0 && (
          <span className="text-purple-400 ml-1" title={`${sessionContextTokens} context tokens`}>
            ({formatTokens(sessionContextTokens)})
          </span>
        )}
      </span>
      {/* Hide type text when showing agent + skill format (it's redundant) */}
      {!(displayAgent && displaySkill) && (
        <span className={`ml-2 font-mono ${getTypeColorClass(type)}${isRecommendation ? " font-semibold" : ""}`}>
          {getTypeText(type, agent, skill)}
        </span>
      )}
      {showAgentInfo && (
        <span className="ml-1">
          {/* Only show hyphen separator for non-recommendation entries */}
          {!isRecommendation && (
            <>
              <span className="text-gray-600">-</span>{" "}
            </>
          )}
          {isRecommendation ? (
            // Recommendation: show arrow icon in yellow (indicating suggestion, not action)
            <>
              {displayAgent && displaySkill ? (
                // Both agent and skill - use agent color + skill color
                <>
                  <span className="text-yellow-400 font-semibold">&rarr;</span>{" "}
                  <span className={recommendationAgentClass}>{displayAgent}</span>
                  <span className="text-gray-500"> &gt; </span>
                  <span className={recommendationSkillClass}>{displaySkill}</span>
                </>
              ) : displayAgent ? (
                <>
                  <span className="text-yellow-400 font-semibold">&rarr;</span>{" "}
                  <span className={recommendationAgentClass}>{displayAgent}</span>
                </>
              ) : displaySkill ? (
                <>
                  <span className="text-yellow-400 font-semibold">&rarr;</span>{" "}
                  <span className={recommendationSkillClass}>{displaySkill}</span>
                </>
              ) : null}
              {/* Show confidence percentage for recommendations (always shown with same font size as rest) */}
              {confidence !== undefined && (
                <span className="ml-2 text-yellow-400 font-mono" title={`Confidence: ${formatConfidence(confidence)}`}>
                  ({formatConfidence(confidence)})
                </span>
              )}
              {/* Show followed indicator if known */}
              {followed !== undefined && (
                <span className={`ml-2 text-xs font-mono ${followed ? "text-green-500" : "text-red-400"}`} title={followed ? "Recommendation was followed" : "Recommendation was not followed"}>
                  {followed ? "\u2713 followed" : "\u2717 ignored"}
                </span>
              )}
            </>
          ) : displayAgent && displaySkill ? (
            // Agent with skill: show both agent and skill names
            <>
              <span className={agentColorClass}>{displayAgent}</span>
              <span className="text-gray-500"> &gt; </span>
              <span className={skillColorClass}>{displaySkill}</span>
            </>
          ) : displayAgent ? (
            // Agent only
            <span className={agentColorClass}>{displayAgent}</span>
          ) : displaySkill ? (
            // Skill only
            <span className={skillColorClass}>{displaySkill}</span>
          ) : (
            // Fallback
            <span className="text-gray-400">system</span>
          )}
        </span>
      )}
    </div>
  );
}
