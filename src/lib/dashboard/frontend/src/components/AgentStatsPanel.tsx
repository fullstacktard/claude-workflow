/**
 * AgentStatsPanel component for displaying agent performance metrics.
 *
 * Shows agent statistics in terminal-like log entry format consistent
 * with the rest of the dashboard.
 */

import { useMemo, useState } from "react";
import { useAgentStats, type AgentMetrics, type McpToolMetric, type SkillMetric } from "../hooks/useAgentStats";
import { getAgentColorClass } from "../utils/agentColors";

/**
 * Formats duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Formats large numbers with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Groups MCP tools by server name
 */
interface McpServerGroup {
  server: string;
  tools: McpToolMetric[];
  totalCalls: number;
  avgTokensPerCall: number;
}

/**
 * Collapsible section types
 */
type SectionType = "agents" | "skills" | "mcp";

/**
 * AgentStatsPanel displays agent performance metrics in terminal-style log entries.
 */
export function AgentStatsPanel(): JSX.Element {
  const { stats, loading, error, refresh } = useAgentStats();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  // Agents expanded by default, others collapsed
  const [expandedSections, setExpandedSections] = useState<Set<SectionType>>(new Set(["agents"]));

  // Sort agents by invocation count for display
  const sortedAgents = useMemo((): AgentMetrics[] => {
    if (!stats?.agents) return [];
    return [...stats.agents].sort((a, b) => b.invocationCount - a.invocationCount);
  }, [stats?.agents]);

  // Group and sort MCP tools by server
  const mcpServerGroups = useMemo((): McpServerGroup[] => {
    if (!stats?.mcpTools) return [];

    const groups = new Map<string, McpToolMetric[]>();
    for (const tool of stats.mcpTools) {
      const existing = groups.get(tool.server) ?? [];
      existing.push(tool);
      groups.set(tool.server, existing);
    }

    return Array.from(groups.entries())
      .map(([server, tools]) => {
        const totalCalls = tools.reduce((sum, t) => sum + t.count, 0);
        // Calculate avg tokens per call if we have token data
        // For now, we don't have per-MCP token data, so set to 0
        const avgTokensPerCall = 0;
        return {
          server,
          tools: tools.sort((a, b) => b.count - a.count),
          totalCalls,
          avgTokensPerCall,
        };
      })
      .sort((a, b) => b.totalCalls - a.totalCalls);
  }, [stats?.mcpTools]);

  // Sort skills by count
  const sortedSkills = useMemo((): SkillMetric[] => {
    if (!stats?.topSkills) return [];
    return [...stats.topSkills].sort((a, b) => b.count - a.count).slice(0, 10);
  }, [stats?.topSkills]);

  const toggleServer = (server: string): void => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(server)) {
        next.delete(server);
      } else {
        next.add(server);
      }
      return next;
    });
  };

  const toggleSection = (section: SectionType): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="spinner w-8 h-8 mb-4" />
        <p className="text-gray-400">Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400">
        <p className="mb-4">Failed to load stats: {error}</p>
        <button
          onClick={refresh}
          className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>No statistics available</p>
      </div>
    );
  }

  const isAgentsExpanded = expandedSections.has("agents");
  const isSkillsExpanded = expandedSections.has("skills");
  const isMcpExpanded = expandedSections.has("mcp");

  return (
    <div className="font-mono text-sm">
      {/* Section: Agents */}
      <div
        className="font-mono text-sm py-1 px-2 border-l-2 border-transparent bg-gray-900/30 py-1.5 cursor-pointer hover:bg-gray-800/50"
        onClick={() => toggleSection("agents")}
      >
        <span className="text-gray-500 mr-2">{isAgentsExpanded ? "−" : "+"}</span>
        <span className="text-purple-400">AGENTS</span>
        <span className="text-gray-600"> :: </span>
        <span className="text-gray-500">{sortedAgents.length} agents</span>
      </div>

      {isAgentsExpanded && (
        <>
          {sortedAgents.length === 0 ? (
            <div className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4">
              <span className="text-gray-500">No agent data available</span>
            </div>
          ) : (
            sortedAgents.map((agent) => (
              <div key={agent.name} className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4">
                <span className={getAgentColorClass(agent.name)}>{agent.name}</span>
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-green-400">{agent.invocationCount}</span>
                <span className="text-gray-600 ml-1">calls</span>
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-blue-400">{formatDuration(agent.completionTime.avg)}</span>
                <span className="text-gray-600 ml-1">avg</span>
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-purple-400">{formatNumber(agent.tokens.avg)}</span>
                <span className="text-gray-600 ml-1">avg</span>
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-yellow-400">{formatNumber(agent.tokens.total)}</span>
                <span className="text-gray-600 ml-1">total</span>
              </div>
            ))
          )}
        </>
      )}

      {/* Section: Skills */}
      <div
        className="font-mono text-sm py-1 px-2 border-l-2 border-transparent bg-gray-900/30 py-1.5 cursor-pointer hover:bg-gray-800/50 mt-1"
        onClick={() => toggleSection("skills")}
      >
        <span className="text-gray-500 mr-2">{isSkillsExpanded ? "−" : "+"}</span>
        <span className="text-cyan-400">SKILLS</span>
        <span className="text-gray-600"> :: </span>
        <span className="text-gray-500">{sortedSkills.length} skills</span>
      </div>

      {isSkillsExpanded && (
        <>
          {sortedSkills.length === 0 ? (
            <div className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4">
              <span className="text-gray-500">No skill data available</span>
            </div>
          ) : (
            sortedSkills.map((skill) => (
              <div key={skill.name || `skill-${skill.count}`} className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4">
                <span className="text-cyan-400">{skill.name || "(unnamed)"}</span>
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-green-400">{skill.count}</span>
                <span className="text-gray-600 ml-1">invocations</span>
              </div>
            ))
          )}
        </>
      )}

      {/* Section: MCP Tools - Grouped by Server */}
      <div
        className="font-mono text-sm py-1 px-2 border-l-2 border-transparent bg-gray-900/30 py-1.5 cursor-pointer hover:bg-gray-800/50 mt-1"
        onClick={() => toggleSection("mcp")}
      >
        <span className="text-gray-500 mr-2">{isMcpExpanded ? "−" : "+"}</span>
        <span className="text-purple-400">MCP</span>
        <span className="text-gray-600"> :: </span>
        <span className="text-gray-500">{mcpServerGroups.length} servers</span>
      </div>

      {isMcpExpanded && (
        <>
          {mcpServerGroups.length === 0 ? (
            <div className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4">
              <span className="text-gray-500">No MCP tool data available</span>
            </div>
          ) : (
            mcpServerGroups.map((group) => {
              const isServerExpanded = expandedServers.has(group.server);
              return (
                <div key={group.server}>
                  {/* Server header - clickable */}
                  <div
                    className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-4 cursor-pointer hover:bg-gray-800/50"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleServer(group.server);
                    }}
                  >
                    <span className="text-gray-500 mr-2">{isServerExpanded ? "−" : "+"}</span>
                    <span className="text-purple-300">{group.server}</span>
                    <span className="ml-2 text-gray-600">|</span>
                    <span className="ml-2 text-green-400">{group.totalCalls}</span>
                    <span className="text-gray-600 ml-1">calls</span>
                    <span className="ml-2 text-gray-600">|</span>
                    <span className="ml-2 text-gray-500">{group.tools.length} tools</span>
                  </div>
                  {/* Expanded tools list */}
                  {isServerExpanded && group.tools.map((tool) => (
                    <div key={`${group.server}-${tool.tool}`} className="font-mono text-sm py-1 px-2 border-l-2 border-transparent pl-8">
                      <span className="text-purple-400">{tool.tool}</span>
                      <span className="ml-2 text-gray-600">|</span>
                      <span className="ml-2 text-green-400">{tool.count}</span>
                      <span className="text-gray-600 ml-1">calls</span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
