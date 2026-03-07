/**
 * WorkflowProjectGroup Component
 * Collapsible group for workflow events from a specific project
 */

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";

import { getAgentColorClass } from "../utils/agentColors";

/** Workflow status type for UI grouping */
export type WorkflowStatusType = "active" | "paused" | "complete";

/**
 * Workflow event interface (matches LiveLogFeed.tsx)
 */
export interface WorkflowEvent {
  ts: string;
  type: "workflow_start" | "workflow_stage" | "workflow_trigger" | "workflow_complete" | "workflow_resumed";
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
 * Per-project workflow status
 */
export interface ProjectWorkflowStatus {
  project: string;
  active: boolean;
  /** Workflow status for UI grouping */
  workflowStatus: WorkflowStatusType;
  currentStage?: string;
  /** Current agent being executed (from most recent agent_invocation) */
  currentAgent?: string;
  activeTasks: number;
  eventCount: number;
  lastEventTime?: string;
  workflowName?: string;
  /** Whether workflow was manually marked complete */
  manuallyCompleted?: boolean;
  /** Session ID for resuming workflow (claude --resume <sessionId>) */
  sessionId?: string;
}

/**
 * Props for WorkflowProjectGroup component
 */
export interface WorkflowProjectGroupProps {
  /** Project status info */
  status: ProjectWorkflowStatus;
  /** Events for this project */
  events: WorkflowEvent[];
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Callback when complete button is clicked (only for paused workflows) */
  onMarkComplete?: (projectName: string) => void;
  /** Whether complete action is in progress */
  isCompleting?: boolean;
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
    .replace(/- workflow -/g, "")
    .trim();
}

/**
 * Map workflow stage to its primary agent
 */
function getStageAgent(stage: string): string {
  switch (stage) {
    case "feature_planning": return "feature-planner";
    case "task_creation": return "task-maker";
    case "implementation": return "engineer";
    case "code_review": return "code-reviewer";
    case "complete": return "complete";
    default: return "";
  }
}

/**
 * Workflow log entry display (inline to avoid circular deps)
 */
function WorkflowLogRow({ event }: { event: WorkflowEvent }): JSX.Element {
  const getStageDisplay = (): { agent: string; stage: string } => {
    if (event.stage) {
      const stageAgent = getStageAgent(event.stage);
      const stageLabel = event.stage.replace(/_/g, " ");
      return { agent: stageAgent, stage: stageLabel };
    }
    // Fallback based on event type
    switch (event.type) {
      case "workflow_start": return { agent: "", stage: "start" };
      case "workflow_stage": return { agent: "", stage: "workflow" };
      case "workflow_trigger": return { agent: "", stage: "trigger" };
      case "workflow_complete": return { agent: "", stage: "complete" };
      case "workflow_resumed": return { agent: "", stage: "resumed" };
      default: return { agent: "", stage: "workflow" };
    }
  };

  const renderDetails = (): JSX.Element => {
    // workflow_start: show the workflow name
    if (event.type === "workflow_start") {
      const workflowName = event.workflowName || "Unnamed Workflow";
      return (
        <span className="text-green-400">{stripEmojis(workflowName)}</span>
      );
    }

    // workflow_trigger: show agent handoff
    if (event.type === "workflow_trigger") {
      const completedAgent = event.completedAgent || "agent";
      const nextAgent = event.nextAgent || "next";
      return (
        <>
          <span className={getAgentColorClass(completedAgent)}>{stripEmojis(completedAgent)}</span>
          <span className="text-gray-300"> triggered </span>
          <span className={getAgentColorClass(nextAgent)}>{stripEmojis(nextAgent)}</span>
          <span className="text-gray-500 ml-1">task-{event.taskId}</span>
        </>
      );
    }

    // workflow_resumed: show workflow name, phase, and stale agents
    if (event.type === "workflow_resumed") {
      const workflowName = event.workflowName || "Unnamed";
      const phase = event.currentPhase || "unknown";
      const staleCount = event.staleAgentCount || 0;
      return (
        <>
          <span className="text-amber-400">{stripEmojis(workflowName)}</span>
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
          <span className="text-gray-400">task-{event.taskId} completed</span>
          {stages.length > 0 && (
            <>
              <span className="text-gray-500"> (</span>
              {stages.map((stage, idx) => (
                <span key={idx}>
                  {idx > 0 && <span className="text-gray-600"> &gt; </span>}
                  <span className={getAgentColorClass(stage)}>{stripEmojis(stage)}</span>
                </span>
              ))}
              <span className="text-gray-500">)</span>
            </>
          )}
        </>
      );
    }

    // workflow_stage: show actor (agentType > toolName), action
    // Skip actor if it matches the stage's expected agent (avoid duplication)
    // Skip "allowed" action (only show blocked/override which are meaningful)
    const actor = event.agentType || event.toolName || "";
    const expectedAgent = event.stage ? getStageAgent(event.stage) : "";
    const showActor = actor && actor !== expectedAgent;
    const action = event.action || "";
    const showAction = action && action !== "allowed";

    // If we have actor or action to show, display them
    if (showActor || showAction) {
      return (
        <>
          {showActor && <span className={getAgentColorClass(actor)}>{stripEmojis(actor)}</span>}
          {showAction && <span className="text-gray-400 ml-2">{stripEmojis(action)}</span>}
        </>
      );
    }

    // Fallback: use the event's message field (backend generates this)
    if (event.message) {
      return <span className="text-gray-300">{stripEmojis(event.message)}</span>;
    }

    // Ultimate fallback: show event type
    return <span className="text-gray-500">{event.type.replace("workflow_", "")}</span>;
  };

  const stageDisplay = getStageDisplay();

  return (
    // Pure Tailwind: Combined log-entry base + workflow-project-group__event
    // log-entry: font-mono text-sm py-1 px-2 border-l-2 border-transparent
    // event: border-l-2 border-gray-700/50 hover:bg-gray-800/20 hover:border-l-purple-500/50
    <div className="font-mono text-sm py-1 px-2 border-l-2 border-gray-700/50 hover:bg-gray-800/20 hover:border-l-purple-500/50 pl-6">
      <span className="text-gray-500">{new Date(event.ts).toLocaleTimeString()}</span>
      <span className="ml-2">
        {stageDisplay.agent && (
          <>
            <span className={getAgentColorClass(stageDisplay.agent)}>{stageDisplay.agent}</span>
            <span className="text-gray-600">/</span>
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
 * Get status color class based on workflow status
 */
function getStatusColorClass(workflowStatus: WorkflowStatusType): string {
  switch (workflowStatus) {
    case "active": return "text-yellow-400";
    case "paused": return "text-orange-400";
    case "complete": return "text-green-400";
  }
}

/**
 * Get status display label
 */
function getStatusLabel(workflowStatus: WorkflowStatusType): string {
  switch (workflowStatus) {
    case "active": return "active";
    case "paused": return "paused";
    case "complete": return "complete";
  }
}

/**
 * WorkflowProjectGroup component
 * Displays a collapsible group of workflow events for a specific project
 */
export function WorkflowProjectGroup({
  status,
  events,
  defaultExpanded,
  onMarkComplete,
  isCompleting,
}: WorkflowProjectGroupProps): JSX.Element {
  // Default: active projects expanded, others collapsed
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? status.workflowStatus === "active");
  const [copiedSessionId, setCopiedSessionId] = useState(false);

  const handleToggle = (): void => {
    setIsExpanded(!isExpanded);
  };

  const handleComplete = (e: React.MouseEvent): void => {
    e.stopPropagation(); // Don't toggle expand when clicking complete
    // Pass session-aware completion key (project::sessionId) for per-session completion
    const completionKey = status.sessionId ? `${status.project}::${status.sessionId}` : status.project;
    onMarkComplete?.(completionKey);
  };

  const handleCopySessionId = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (status.sessionId) {
      void navigator.clipboard.writeText(status.sessionId).then(() => {
        setCopiedSessionId(true);
        setTimeout(() => setCopiedSessionId(false), 2000);
      });
    }
  };

  // Status badge color based on workflow status
  const statusColorClass = getStatusColorClass(status.workflowStatus);
  const statusLabel = getStatusLabel(status.workflowStatus);

  // Show complete button only for paused workflows
  const showCompleteButton = status.workflowStatus === "paused" && onMarkComplete !== undefined;

  return (
    // Pure Tailwind: workflow-project-group -> border-b border-gray-800/50 last:border-b-0
    <section className="border-b border-gray-800/50 last:border-b-0">
      {/* Clickable Header */}
      {/* Pure Tailwind: workflow-project-group__header -> font-mono text-sm hover:bg-gray-800/30 */}
      <div className="font-mono text-sm hover:bg-gray-800/30 w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-800/50 transition-colors">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left"
          onClick={handleToggle}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
          )}

          <span className="text-purple-400 font-medium">{status.project}</span>

          {/* Workflow name display */}
          {status.workflowName && (
            <>
              <span className="text-gray-600">-</span>
              <span
                className={`max-w-[200px] truncate ${
                  status.workflowName === "Unnamed Workflow"
                    ? "text-gray-500 italic"
                    : "text-cyan-400"
                }`}
                title={status.workflowName}
              >
                {status.workflowName}
              </span>
            </>
          )}

          <span className="text-gray-600">::</span>
          <span className={statusColorClass}>
            {statusLabel}
          </span>

          {status.workflowStatus === "active" && status.currentAgent && (
            <>
              <span className="text-gray-600">|</span>
              <span className={getAgentColorClass(status.currentAgent)}>{status.currentAgent}</span>
            </>
          )}

          {status.workflowStatus === "active" && status.currentStage && !status.currentAgent && (
            <>
              <span className="text-gray-600">|</span>
              <span className="text-blue-400">{status.currentStage}</span>
            </>
          )}

          {status.workflowStatus === "active" && status.activeTasks > 0 && (
            <>
              <span className="text-gray-600">|</span>
              <span className="text-green-400">{status.activeTasks} task{status.activeTasks !== 1 ? "s" : ""}</span>
            </>
          )}

          {status.workflowStatus !== "active" && (
            <span className="text-gray-500 text-sm">
              ({events.length} event{events.length !== 1 ? "s" : ""})
            </span>
          )}
        </button>

        {/* Session ID for resuming workflow */}
        {status.sessionId && (
          <button
            type="button"
            className="h-7 px-2 text-xs bg-transparent border border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors flex items-center gap-1 font-mono"
            onClick={handleCopySessionId}
            title={`Click to copy session ID: ${status.sessionId}\nResume with: claude --resume ${status.sessionId}`}
          >
            <Copy className="w-3 h-3" />
            <span className="truncate max-w-[100px]">
              {copiedSessionId ? "Copied!" : status.sessionId.substring(0, 8)}
            </span>
          </button>
        )}

        {/* Complete button for paused workflows */}
        {showCompleteButton && (
          <button
            type="button"
            className="h-7 px-2 text-xs bg-transparent border border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleComplete}
            disabled={isCompleting}
            title="Mark workflow as complete"
          >
            <Check className="w-3 h-3" />
            {isCompleting ? "..." : "Complete"}
          </button>
        )}
      </div>

      {/* Expandable Content */}
      {isExpanded && events.length > 0 && (
        // Pure Tailwind: workflow-project-group__events -> border-t border-gray-800/30
        <div className="border-t border-gray-800/30">
          {events.map((event) => (
            <WorkflowLogRow
              key={`${event.ts}-${event.type}-${event.session}`}
              event={event}
            />
          ))}
        </div>
      )}

      {isExpanded && events.length === 0 && (
        // Pure Tailwind: workflow-project-group__empty -> font-mono text-xs
        <div className="font-mono text-xs pl-6 py-1 text-gray-500 text-sm">
          No events in last 24h
        </div>
      )}
    </section>
  );
}
