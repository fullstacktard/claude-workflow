/**
 * ProjectListItem Component
 * Individual project card with terminal-style layout and update functionality
 */

import type { FC } from "react";

import { TerminalCard } from "./TerminalCard";
import { useProjectUpdate } from "../hooks/useProjectUpdate";

/**
 * Project data from API
 */
export interface Project {
  /** Last activity timestamp */
  lastActivity?: string;
  /** Project display name */
  name: string;
  /** Full path to project */
  path: string;
  /** Token usage statistics */
  tokenUsage?: {
    day: number;
    month: number;
    week: number;
  };
}

/**
 * Props for ProjectListItem component
 */
interface ProjectListItemProps {
  /** Callback when update completes */
  onUpdateComplete?: () => void;
  /** Project data to display */
  project: Project;
}

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format token count with locale
 */
function formatTokens(count: number | undefined): string {
  if (count === undefined) return "-";
  return count.toLocaleString();
}

/**
 * ProjectListItem - Individual project row with update functionality
 */
export const ProjectListItem: FC<ProjectListItemProps> = ({
  onUpdateComplete,
  project,
}) => {
  const { error, progress, startUpdate } = useProjectUpdate();

  const handleUpdate = async (): Promise<void> => {
    await startUpdate(project.path);
    onUpdateComplete?.();
  };

  const isUpdating = progress.status === "running";

  return (
    <TerminalCard command="cd" filename={project.path}>
      <div className="border border-red-800 rounded p-4">
        <h4 className="text-white text-sm font-semibold mb-2">{project.name}</h4>
        <p className="text-gray-400 text-sm font-mono mb-3 truncate" title={project.path}>
          {project.path}
        </p>
        <div className="flex flex-col gap-2 mb-4">
          <span className="text-gray-300 text-sm">
            <span className="text-gray-500">Activity:</span>{" "}
            {project.lastActivity !== undefined
              ? formatRelativeTime(project.lastActivity)
              : "-"}
          </span>
          <span className="text-gray-300 text-sm">
            <span className="text-gray-500">Tokens (24h):</span>{" "}
            {formatTokens(project.tokenUsage?.day)}
          </span>
        </div>
        <div className="mb-4">
          {isUpdating && (
            <div className="mb-3">
              <span className="text-gray-400 text-sm mb-2 block">
                {progress.message}
              </span>
              <div className="bg-gray-800 rounded h-2 overflow-hidden">
                <div
                  className="bg-red-500 h-full transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
          {progress.status === "success" && (
            <span className="inline-flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-md text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Updated
            </span>
          )}
          {error && (
            <span className="text-red-400">{error.message}</span>
          )}
        </div>
        <button
          className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-md transition-colors w-full"
          disabled={isUpdating}
          onClick={() => void handleUpdate()}
          type="button"
          aria-label={`Update ${project.name}`}
        >
          {isUpdating ? "Updating..." : "Update"}
        </button>
      </div>
    </TerminalCard>
  );
};
