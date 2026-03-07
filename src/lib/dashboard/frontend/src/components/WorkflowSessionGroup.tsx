/**
 * WorkflowSessionGroup Component
 * Collapsible group for workflow events from a specific session
 * with blocked task indicators and dependency visualization.
 */

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { getAgentColorClass } from "../utils/agentColors";
import { BlockedTaskBadge } from "./BlockedTaskBadge";
import {
  BlockedAgentsList,
  type BlockedAgent,
  type BlockingDependency,
} from "./BlockedAgentsList";
import { CriticalPathAlert } from "./CriticalPathAlert";
import { useSkipAgent } from "../hooks/useSkipAgent";

/**
 * Workflow event interface (matches LiveLogFeed.tsx)
 */
export interface WorkflowEvent {
  ts: string;
  type:
    | "workflow_start"
    | "workflow_stage"
    | "workflow_trigger"
    | "workflow_complete"
    | "workflow_resumed";
  session: string;
  message: string;
  project: string;
  stage?: string;
  action?: string;
  agentType?: string;
  toolName?: string;
  reason?: string;
  stageProgress?: { completed: number; total: number };
  taskId?: number;
  completedAgent?: string;
  nextAgent?: string;
  stagesCompleted?: string[];
  workflowName?: string;
  promptPreview?: string;
  previousSessionId?: string;
  currentPhase?: string;
  staleAgentCount?: number;
}

/**
 * Per-session workflow status
 */
export interface SessionWorkflowStatus {
  /** Session identifier (timestamp-pid format) */
  session: string;
  /** Project name where workflow runs */
  project: string;
  /** Whether this session has an active workflow */
  active: boolean;
  /** Current stage if active */
  currentStage?: string;
  /** Number of active tasks */
  activeTasks: number;
  /** Total event count for this session */
  eventCount: number;
  /** Last event timestamp */
  lastEventTime?: string;
  /** Human-readable workflow name from workflow_start event */
  workflowName?: string;
  /** Blocked agents waiting for dependencies */
  blockedAgents?: BlockedAgent[];
}

/**
 * Props for WorkflowSessionGroup component
 */
export interface WorkflowSessionGroupProps {
  /** Session status info */
  status: SessionWorkflowStatus;
  /** Events for this session */
  events: WorkflowEvent[];
  /** Default expanded state */
  defaultExpanded?: boolean;
}

/**
 * Map workflow stage to its primary agent
 */
function getStageAgent(stage: string): string {
  switch (stage) {
    case "feature_planning":
      return "feature-planner";
    case "task_creation":
      return "task-maker";
    case "implementation":
      return "engineer";
    case "code_review":
      return "code-reviewer";
    case "complete":
      return "complete";
    default:
      return "";
  }
}

/**
 * Strip emojis from text
 */
function stripEmojis(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F000}-\u{1F02F}]/gu, "")
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, "")
    .replace(/[✓✗✔✘→←↑↓]/g, "")
    .trim();
}

/**
 * Workflow log entry display (inline to avoid circular deps)
 */
function WorkflowLogRow({ event }: { event: WorkflowEvent }): JSX.Element {
  const getStageDisplay = (): { agent: string; stage: string } => {
    switch (event.type) {
      case "workflow_start":
        return { agent: "", stage: "start" };
      case "workflow_stage": {
        const stage = event.stage || "stage";
        const stageAgent = getStageAgent(stage);
        const stageLabel = stage.replace(/_/g, " ");
        return { agent: stageAgent, stage: stageLabel };
      }
      case "workflow_trigger":
        return { agent: "", stage: "trigger" };
      case "workflow_complete":
        return { agent: "", stage: "complete" };
      case "workflow_resumed":
        return { agent: "", stage: "resumed" };
      default:
        return { agent: "", stage: "event" };
    }
  };

  const renderDetails = (): JSX.Element => {
    // workflow_start: show workflow name
    if (event.type === "workflow_start") {
      const workflowName = event.workflowName || "Unnamed";
      return (
        <span className="text-cyan-400">
          &quot;{stripEmojis(workflowName)}&quot;
        </span>
      );
    }

    // workflow_trigger: show agent pipeline
    if (event.type === "workflow_trigger") {
      const completedAgent = event.completedAgent || "unknown";
      const nextAgent = event.nextAgent || "unknown";
      return (
        <>
          <span className={getAgentColorClass(completedAgent)}>
            {stripEmojis(completedAgent)}
          </span>
          <span className="text-gray-300"> - </span>
          <span className={getAgentColorClass(nextAgent)}>
            {stripEmojis(nextAgent)}
          </span>
          <span className="text-gray-500 ml-1">task-{event.taskId}</span>
        </>
      );
    }

    // workflow_resumed: show workflow name, phase, and stale agent count
    if (event.type === "workflow_resumed") {
      const workflowName = event.workflowName || "Unnamed";
      const phase = event.currentPhase || "unknown";
      const staleCount = event.staleAgentCount || 0;
      return (
        <>
          <span className="text-amber-400">
            &quot;{stripEmojis(workflowName)}&quot;
          </span>
          <span className="text-gray-400"> phase: </span>
          <span className="text-cyan-400">{phase}</span>
          {staleCount > 0 && (
            <span className="text-amber-500 ml-2">
              ({staleCount} stale agent{staleCount !== 1 ? "s" : ""})
            </span>
          )}
        </>
      );
    }

    // workflow_complete: show completed stages
    if (event.type === "workflow_complete") {
      const stages = event.stagesCompleted || [];
      return (
        <>
          <span className="text-gray-400">task-{event.taskId} </span>
          <span className="text-gray-500">(</span>
          {stages.map((stage, idx) => (
            <span key={`${stage}-${idx}`}>
              {idx > 0 && <span className="text-gray-600"> &gt; </span>}
              <span className={getAgentColorClass(stage)}>
                {stripEmojis(stage)}
              </span>
            </span>
          ))}
          <span className="text-gray-500">)</span>
        </>
      );
    }

    // workflow_stage: show actor (agentType > toolName), action, and reason
    const actor = event.agentType || event.toolName || "";
    const action = event.action || "";
    const reason = event.reason || "";

    return (
      <>
        {actor && (
          <span className={getAgentColorClass(actor)}>{stripEmojis(actor)}</span>
        )}
        {action && (
          <span className="text-yellow-400 ml-2">{stripEmojis(action)}</span>
        )}
        {reason && (
          <span className="text-gray-500 ml-2 text-xs">
            ({stripEmojis(reason.slice(0, 50))})
          </span>
        )}
        {!actor && !action && <span className="text-gray-500">-</span>}
      </>
    );
  };

  const stageDisplay = getStageDisplay();

  return (
    // Pure Tailwind: Combined log-entry base + workflow-session-group__event
    // log-entry: font-mono text-sm py-1 px-2 border-l-2 border-transparent
    // event: border-l-2 border-gray-700/50 hover:bg-gray-800/20 hover:border-l-purple-500/50
    <div className="font-mono text-sm py-1 px-2 border-l-2 border-gray-700/50 hover:bg-gray-800/20 hover:border-l-purple-500/50 pl-6">
      <span className="text-gray-500">
        {new Date(event.ts).toLocaleTimeString()}
      </span>
      <span className="ml-2">
        {stageDisplay.agent && (
          <>
            <span className={getAgentColorClass(stageDisplay.agent)}>
              {stageDisplay.agent}
            </span>
            <span className="text-gray-600 mx-1">/</span>
          </>
        )}
        <span className="text-blue-400">{stageDisplay.stage}</span>
      </span>
      <span className="text-gray-600 ml-1">-</span>
      <span className="ml-1">{renderDetails()}</span>
      {event.stageProgress && (
        <span className="ml-2 text-gray-500">
          [{event.stageProgress.completed}/{event.stageProgress.total}]
        </span>
      )}
    </div>
  );
}

/**
 * Critical blocker information for alert display.
 */
interface CriticalBlockerInfo {
  agentType: string;
  taskId: string;
  status: string;
  blockingCount: number;
}

/**
 * WorkflowSessionGroup component
 * Displays a collapsible group of workflow events for a specific session
 * with blocked task indicators and dependency management.
 */
export function WorkflowSessionGroup({
  status,
  events,
  defaultExpanded,
}: WorkflowSessionGroupProps): JSX.Element {
  // Default: active sessions expanded, idle collapsed
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? status.active);
  const [showOnlyBlocked, setShowOnlyBlocked] = useState(false);
  const [blockedAgents, setBlockedAgents] = useState<BlockedAgent[]>(
    status.blockedAgents || []
  );
  const [alertDismissed, setAlertDismissed] = useState(false);

  // Skip agent hook with optimistic update
  const { skip, skipping } = useSkipAgent((agentId) => {
    // Remove from blocked list on successful skip
    setBlockedAgents((prev) => prev.filter((a) => a.agentId !== agentId));
  });

  // Filter out currently-skipping agents for display
  const visibleBlockedAgents = useMemo(
    () => blockedAgents.filter((a) => !skipping.has(a.agentId)),
    [blockedAgents, skipping]
  );

  // Find critical blocker (agent blocking the most downstream tasks)
  const criticalBlocker = useMemo((): CriticalBlockerInfo | undefined => {
    if (visibleBlockedAgents.length < 3) return undefined;

    // Count how many agents each dependency is blocking
    const blockingCounts = new Map<string, number>();
    for (const agent of visibleBlockedAgents) {
      for (const dep of agent.blockedBy) {
        const count = blockingCounts.get(dep.taskId) || 0;
        blockingCounts.set(dep.taskId, count + 1);
      }
    }

    // Find the one blocking the most
    let maxBlocker: { taskId: string; count: number } | undefined;
    for (const [taskId, count] of blockingCounts) {
      if (!maxBlocker || count > maxBlocker.count) {
        maxBlocker = { taskId, count };
      }
    }

    if (!maxBlocker) return undefined;

    // Find the full dependency info
    for (const agent of visibleBlockedAgents) {
      const dep = agent.blockedBy.find(
        (d: BlockingDependency) => d.taskId === maxBlocker?.taskId
      );
      if (dep) {
        return {
          agentType: dep.agentType,
          taskId: dep.taskId,
          status: dep.status,
          blockingCount: maxBlocker.count,
        };
      }
    }

    return undefined;
  }, [visibleBlockedAgents]);

  const handleToggle = (): void => {
    setIsExpanded(!isExpanded);
  };

  const handleSkip = (agentId: string): void => {
    void skip(agentId);
  };

  const handleBadgeClick = (): void => {
    // Expand the session and ensure blocked section is visible
    setIsExpanded(true);
  };

  const handleFilterToggle = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowOnlyBlocked(!showOnlyBlocked);
  };

  // Status badge and container styling based on active state
  const statusColorClass = status.active ? "text-yellow-400" : "text-gray-600";
  // Pure Tailwind: workflow-session-group -> border-b border-gray-800/50 last:border-b-0
  const containerClass = status.active
    ? "border-b border-gray-800/50 last:border-b-0"
    : "border-b border-gray-800/50 last:border-b-0 opacity-60";

  return (
    <section className={containerClass}>
      {/* Critical path alert - shown above header when 3+ blocked */}
      {status.active && !alertDismissed && (
        <CriticalPathAlert
          blockedCount={visibleBlockedAgents.length}
          criticalBlocker={criticalBlocker}
          onDismiss={() => setAlertDismissed(true)}
        />
      )}

      {/* Clickable Header */}
      {/* Pure Tailwind: workflow-session-group__header -> font-mono text-sm hover:bg-gray-800/30 */}
      <button
        type="button"
        className="font-mono text-sm hover:bg-gray-800/30 w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-800/50 transition-colors text-left"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        {/* Chevron icon */}
        {isExpanded ? (
          <ChevronDown
            className={`w-3 h-3 flex-shrink-0 ${status.active ? "text-gray-500" : "text-gray-700"}`}
          />
        ) : (
          <ChevronRight
            className={`w-3 h-3 flex-shrink-0 ${status.active ? "text-gray-500" : "text-gray-700"}`}
          />
        )}

        {/* Project name */}
        <span
          className={
            status.active
              ? "text-purple-400 font-medium"
              : "text-purple-400/60 font-medium"
          }
        >
          {status.project}
        </span>

        {/* Workflow name display */}
        {status.workflowName && (
          <>
            <span className="text-gray-600">-</span>
            <span
              className={`max-w-[200px] truncate ${
                status.workflowName === "Unnamed Workflow"
                  ? "text-gray-600 italic"
                  : status.active
                    ? "text-cyan-400"
                    : "text-cyan-400/60"
              }`}
              title={status.workflowName}
            >
              {status.workflowName}
            </span>
          </>
        )}

        <span className="text-gray-600">::</span>
        <span className={statusColorClass}>
          {status.active ? "active" : "idle"}
        </span>

        {/* Controls section - right aligned */}
        {/* Pure Tailwind: workflow-session-group__controls -> flex items-center gap-2 */}
        <div className="ml-auto flex items-center gap-2">
          {/* Blocked task badge */}
          {status.active && visibleBlockedAgents.length > 0 && (
            <BlockedTaskBadge
              count={visibleBlockedAgents.length}
              onClick={handleBadgeClick}
            />
          )}

          {/* Filter toggle for blocked agents */}
          {status.active && visibleBlockedAgents.length > 0 && (
            <button
              type="button"
              onClick={handleFilterToggle}
              className={`filter-toggle ${showOnlyBlocked ? "filter-toggle--active" : ""}`}
              title={
                showOnlyBlocked ? "Show all agents" : "Show only blocked agents"
              }
            >
              <span className="filter-toggle__icon">*</span>
              <span>{showOnlyBlocked ? "Blocked" : "All"}</span>
            </button>
          )}

          {/* Session ID (truncated) for identification */}
          <span className="text-gray-600 text-xs" title={status.session}>
            {status.session.slice(0, 16)}...
          </span>
        </div>

        {status.active && status.currentStage && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-blue-400">{status.currentStage}</span>
          </>
        )}

        {status.active && status.activeTasks > 0 && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-green-400">
              {status.activeTasks} task{status.activeTasks !== 1 ? "s" : ""}
            </span>
          </>
        )}

        {!status.active && (
          <span className="text-gray-600 text-sm">
            ({status.eventCount} event{status.eventCount !== 1 ? "s" : ""})
          </span>
        )}
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <>
          {/* Blocked agents section - shown when there are blocked agents */}
          {visibleBlockedAgents.length > 0 && (
            <BlockedAgentsList
              agents={visibleBlockedAgents}
              onSkip={handleSkip}
              expanded={visibleBlockedAgents.length <= 5}
            />
          )}

          {/* Events list - filtered if showOnlyBlocked is enabled */}
          {/* Pure Tailwind: workflow-session-group__events -> border-t border-gray-800/30 */}
          {events.length > 0 && !showOnlyBlocked && (
            <div
              className={`border-t border-gray-800/30 ${!status.active ? "opacity-70" : ""}`}
            >
              {events.map((event) => (
                <WorkflowLogRow
                  key={`${event.ts}-${event.type}-${event.session}`}
                  event={event}
                />
              ))}
            </div>
          )}

          {/* Empty state when showing only blocked but list is empty */}
          {/* Pure Tailwind: workflow-session-group__empty -> font-mono text-xs */}
          {showOnlyBlocked && visibleBlockedAgents.length === 0 && (
            <div className="font-mono text-xs pl-6 py-1 text-gray-600 text-sm">
              No blocked agents
            </div>
          )}

          {/* Empty state for events */}
          {/* Pure Tailwind: workflow-session-group__empty -> font-mono text-xs */}
          {events.length === 0 && !showOnlyBlocked && (
            <div className="font-mono text-xs pl-6 py-1 text-gray-600 text-sm">
              No events in last 24h
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Re-export types for consumers
export type { BlockedAgent, BlockingDependency };
