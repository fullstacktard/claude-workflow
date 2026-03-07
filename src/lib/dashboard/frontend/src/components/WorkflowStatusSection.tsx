/**
 * WorkflowStatusSection Component
 * Collapsible section for grouping workflows by status (active/paused/complete)
 */

import { useState } from "react";

import { WorkflowProjectGroup, type ProjectWorkflowStatus, type WorkflowEvent, type WorkflowStatusType } from "./WorkflowProjectGroup";

/**
 * Props for WorkflowStatusSection component
 */
export interface WorkflowStatusSectionProps {
  /** The status type this section represents */
  statusType: WorkflowStatusType;
  /** Projects in this status group */
  projects: ProjectWorkflowStatus[];
  /** Events grouped by session ID */
  eventsByProject: Map<string, WorkflowEvent[]>;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Callback when a workflow is marked complete */
  onMarkComplete?: (projectName: string) => void;
  /** Project name currently being completed (for loading state) */
  completingProject?: string | null;
}

/**
 * Get section header styling based on status type
 */
function getSectionStyle(statusType: WorkflowStatusType): { colorClass: string; label: string } {
  switch (statusType) {
    case "active":
      return {
        colorClass: "text-yellow-400",
        label: "ACTIVE",
      };
    case "paused":
      return {
        colorClass: "text-orange-400",
        label: "PAUSED",
      };
    case "complete":
      return {
        colorClass: "text-green-400",
        label: "COMPLETE",
      };
  }
}

/**
 * WorkflowStatusSection component
 * Renders a collapsible section containing workflows of a specific status
 */
export function WorkflowStatusSection({
  statusType,
  projects,
  eventsByProject,
  defaultExpanded,
  onMarkComplete,
  completingProject,
}: WorkflowStatusSectionProps): JSX.Element | null {
  // Default: active expanded, others collapsed
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? statusType === "active");

  // Don't render empty sections
  if (projects.length === 0) {
    return null;
  }

  const handleToggle = (): void => {
    setIsExpanded(!isExpanded);
  };

  const style = getSectionStyle(statusType);

  // Calculate total active tasks for the active section header
  const totalActiveTasks = projects.reduce((sum, p) => sum + p.activeTasks, 0);

  return (
    // Pure Tailwind: workflow-status-section has no styles, just a container
    <div>
      {/* Section Header - matches stats-panel section-header pattern */}
      {/* Pure Tailwind: log-entry -> font-mono text-sm py-1 px-2 border-l-2 border-transparent */}
      {/* Pure Tailwind: section-header -> bg-gray-900/30 py-1.5 */}
      <div
        className="font-mono text-sm py-1.5 px-2 border-l-2 border-transparent bg-gray-900/30 cursor-pointer hover:bg-gray-800/50"
        onClick={handleToggle}
      >
        <span className="text-gray-500 mr-2">{isExpanded ? "−" : "+"}</span>
        <span className={style.colorClass}>{style.label}</span>
        <span className="text-gray-600"> :: </span>

        {/* For active: show project names with task counts inline */}
        {statusType === "active" ? (
          <>
            {projects.map((project, idx) => (
              <span key={project.sessionId ?? project.project}>
                {idx > 0 && <span className="text-gray-600">, </span>}
                <span className="text-purple-400">{project.project}</span>
                {project.activeTasks > 0 && (
                  <span className="text-green-400 ml-1">({project.activeTasks})</span>
                )}
              </span>
            ))}
            {totalActiveTasks > 0 && (
              <>
                <span className="text-gray-600 ml-2">|</span>
                <span className="text-green-400 ml-2">{totalActiveTasks}</span>
                <span className="text-gray-500 ml-1">task{totalActiveTasks !== 1 ? "s" : ""}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-gray-500">{projects.length} workflow{projects.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Section Content */}
      {/* Pure Tailwind: workflow-status-section__content -> pl-4 */}
      {isExpanded && (
        <div className="pl-4">
          {projects.map((projectStatus) => (
            <WorkflowProjectGroup
              key={projectStatus.sessionId ?? projectStatus.project}
              status={projectStatus}
              events={eventsByProject.get(projectStatus.sessionId ?? projectStatus.project) || []}
              onMarkComplete={statusType === "paused" ? onMarkComplete : undefined}
              isCompleting={completingProject === (projectStatus.sessionId ?? projectStatus.project)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
