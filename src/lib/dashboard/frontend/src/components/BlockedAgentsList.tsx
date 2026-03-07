/**
 * BlockedAgentsList displays agents waiting for dependencies.
 *
 * Shows a collapsible list of blocked agents with their dependencies
 * and status. Each agent can be expanded to see dependency details.
 */

import { useState } from "react";

import { getAgentColorClass } from "../utils/agentColors";
import { estimateRemainingTime } from "../utils/timeEstimates";

/**
 * Status types for blocking dependencies.
 */
export type BlockingStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * A dependency that is blocking an agent.
 */
export interface BlockingDependency {
  taskId: string;
  agentType: string;
  status: BlockingStatus;
  startedAt?: string;
  estimatedCompletion?: string;
}

/**
 * An agent that is blocked waiting for dependencies.
 */
export interface BlockedAgent {
  agentId: string;
  agentType: string;
  taskId?: string;
  blockedBy: BlockingDependency[];
}

interface BlockedAgentsListProps {
  /** List of blocked agents to display */
  agents: BlockedAgent[];
  /** Callback when skip button is clicked */
  onSkip: (agentId: string) => void;
  /** Whether the list should start expanded */
  expanded?: boolean;
}

/**
 * Color classes for dependency status.
 */
const STATUS_COLORS: Record<BlockingStatus, string> = {
  pending: "text-gray-500",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
  skipped: "text-yellow-500",
};

/**
 * BlockedAgentsList component - collapsible list of blocked agents.
 */
export function BlockedAgentsList({
  agents,
  onSkip,
  expanded: initialExpanded = false,
}: BlockedAgentsListProps): JSX.Element {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const toggleAgent = (agentId: string): void => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  if (agents.length === 0) {
    return (
      <div className="py-0.5 text-gray-500">No blocked agents</div>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Section header */}
      <button
        type="button"
        className="py-0.5 px-2 rounded cursor-pointer hover:bg-gray-800/50 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-gray-500 mr-2">{expanded ? "-" : "+"}</span>
        <span className="text-amber-400">BLOCKED</span>
        <span className="text-gray-600"> :: </span>
        <span className="text-amber-500">
          {agents.length} agent{agents.length > 1 ? "s" : ""} waiting
        </span>
      </button>

      {expanded &&
        agents.map((agent) => {
          const isAgentExpanded = expandedAgents.has(agent.agentId);
          return (
            <div key={agent.agentId} className="border-l border-amber-800/30 ml-2">
              {/* Agent row */}
              <div
                className="py-0.5 pl-4 cursor-pointer hover:bg-gray-800/50 flex items-center"
                onClick={() => toggleAgent(agent.agentId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleAgent(agent.agentId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="text-gray-500 mr-2">
                  {isAgentExpanded ? "-" : "+"}
                </span>
                <span className={getAgentColorClass(agent.agentType)}>
                  {agent.agentType}
                </span>
                {agent.taskId && (
                  <>
                    <span className="text-gray-600 ml-1">(</span>
                    <span className="text-gray-400">{agent.taskId}</span>
                    <span className="text-gray-600">)</span>
                  </>
                )}
                <span className="ml-2 text-gray-600">|</span>
                <span className="ml-2 text-amber-500">
                  waiting for {agent.blockedBy.length} dep
                  {agent.blockedBy.length > 1 ? "s" : ""}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSkip(agent.agentId);
                  }}
                  className="ml-3 px-1.5 py-0.5 text-xs text-red-400/80 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                  title="Skip this agent"
                  type="button"
                >
                  skip
                </button>
              </div>

              {/* Dependencies list */}
              {isAgentExpanded &&
                agent.blockedBy.map((dep) => (
                  <DependencyRow key={dep.taskId} dependency={dep} />
                ))}
            </div>
          );
        })}
    </div>
  );
}

interface DependencyRowProps {
  dependency: BlockingDependency;
}

/**
 * Renders a single dependency row with status and time estimate.
 */
function DependencyRow({ dependency }: DependencyRowProps): JSX.Element {
  const estimate = estimateRemainingTime(
    dependency.agentType,
    dependency.startedAt
  );

  return (
    <div className="py-0.5 pl-8">
      <span className="text-gray-500">L-</span>
      <span className={`ml-1 ${getAgentColorClass(dependency.agentType)}`}>
        {dependency.agentType}
      </span>
      <span className="text-gray-600 ml-1">(</span>
      <span className="text-gray-400">{dependency.taskId}</span>
      <span className="text-gray-600">)</span>
      <span className="ml-2 text-gray-600">|</span>
      <span
        className={`ml-2 ${STATUS_COLORS[dependency.status] || "text-gray-400"}`}
      >
        {dependency.status}
      </span>
      {dependency.status === "running" && estimate && (
        <>
          <span className="text-gray-600 ml-2">|</span>
          <span className="ml-2 text-cyan-400">{estimate}</span>
        </>
      )}
    </div>
  );
}
