/**
 * ProjectListWidget Component
 * Displays list of discovered claude-workflow projects with token usage
 * Uses row layout instead of cards for terminal aesthetic
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalCard } from "./TerminalCard";

/**
 * Extended ProjectInfo with token usage, active sessions, agents, and version info for frontend
 */
interface ProjectWithTokens {
  /** Whether project has routing logs */
  hasRoutingLogs: boolean;
  /** Last activity ISO timestamp */
  lastActivity: string;
  /** Path to log directory */
  logDirectory: string;
  /** Project display name */
  name: string;
  /** Full path to project */
  path: string;
  /** Number of currently active main Claude sessions */
  activeSessions: number;
  /** Number of currently active agent subprocesses */
  activeAgents: number;
  /** Token usage statistics */
  tokenUsage?: {
    day: number;
    month: number;
    week: number;
  };
  /** Installed claude-workflow version in this project */
  installedVersion: string | null;
  /** Latest available version (globally installed) */
  latestVersion: string;
  /** Whether the project's version is outdated */
  isOutdated: boolean;
}

/**
 * Props for ProjectListWidget
 */
interface ProjectListWidgetProps {
  /** API endpoint for project data */
  apiEndpoint?: string;
  /** Refresh interval in milliseconds */
  refreshInterval?: number;
  /** Toast success callback */
  onToastSuccess?: (message: string, projectName: string) => void;
  /** Toast error callback */
  onToastError?: (message: string, projectName: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/** Default values */
const DEFAULT_ENDPOINT = "/api/projects";
const DEFAULT_REFRESH_INTERVAL = 60000; // 1 minute
const FETCH_TIMEOUT_MS = 30000; // 30 seconds timeout for API requests (project scan can be slow on first load)

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: string): string {
  // Handle empty/undefined/invalid timestamps
  if (!timestamp || timestamp === "") {
    return "-";
  }

  const now = new Date();
  const date = new Date(timestamp);

  // Check if date is invalid
  if (isNaN(date.getTime())) {
    return "-";
  }

  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
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
 * ProjectListWidget - Main component
 */
export function ProjectListWidget({
  apiEndpoint = DEFAULT_ENDPOINT,
  refreshInterval = DEFAULT_REFRESH_INTERVAL,
  onToastSuccess,
  onToastError,
  className = "",
}: ProjectListWidgetProps): JSX.Element {
  // className is used in TerminalCard components - TS false positive workaround
  void className;
  const [projects, setProjects] = useState<ProjectWithTokens[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Track which projects are currently being updated (path -> status)
  const [updating, setUpdating] = useState<Record<string, "pending" | "success" | "error">>({});
  // Track Update All progress state
  const [updateAllStatus, setUpdateAllStatus] = useState<{
    isRunning: boolean;
    current: number;
    total: number;
    errors: string[];
  } | null>(null);

  // Refs for cleanup - prevents memory leaks from setTimeout/EventSource
  const statusTimeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const updateAllTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map());
  // AbortController ref for fetch cancellation on unmount or re-fetch
  const fetchAbortControllerRef = useRef<AbortController | null>(null);

  /**
   * Clear project status after delay - reusable helper to avoid code duplication
   * Manages timeout cleanup to prevent memory leaks
   */
  const clearProjectStatusAfterDelay = useCallback((projectPath: string, delayMs = 3000): void => {
    // Clear any existing timeout for this project
    const existingTimeout = statusTimeoutRefs.current.get(projectPath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      setUpdating((prev) => {
        const next = { ...prev };
        delete next[projectPath];
        return next;
      });
      statusTimeoutRefs.current.delete(projectPath);
    }, delayMs);

    statusTimeoutRefs.current.set(projectPath, timeout);
  }, []);

  /**
   * Cleanup all timeouts, event sources, and abort controllers on unmount
   */
  useEffect(() => {
    // Capture refs at effect creation time to avoid stale closure in cleanup
    const statusTimeouts = statusTimeoutRefs;
    const updateAllTimeout = updateAllTimeoutRef;
    const fetchAbortController = fetchAbortControllerRef;
    const eventSources = eventSourceRefs;

    return () => {
      // Clear all project status timeouts
      statusTimeouts.current.forEach((timeout) => clearTimeout(timeout));
      statusTimeouts.current.clear();

      // Clear update all timeout
      if (updateAllTimeout.current) {
        clearTimeout(updateAllTimeout.current);
      }

      // Abort any pending fetch requests
      if (fetchAbortController.current) {
        fetchAbortController.current.abort();
      }

      // Close all event sources
      eventSources.current.forEach((es) => es.close());
      eventSources.current.clear();
    };
  }, []);

  /**
   * Fetch projects from API with timeout handling
   * Uses AbortController to cancel requests after FETCH_TIMEOUT_MS
   * Prevents memory leaks by tracking controller in ref and aborting on re-fetch or unmount
   */
  const fetchProjects = useCallback(async (): Promise<void> => {
    // Abort any previous pending request
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    fetchAbortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      setLoading(true);
      const response = await fetch(apiEndpoint, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ProjectWithTokens[];
      setProjects(data);
      setError(null);
    } catch (err) {
      // Only update error state if this controller is still the active one
      // (prevents stale state updates from aborted requests)
      if (fetchAbortControllerRef.current === controller) {
        if (err instanceof Error && err.name === "AbortError") {
          setError(new Error("Request timed out. The server may be busy scanning projects."));
        } else {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      clearTimeout(timeoutId);
      // Only update loading state if this controller is still the active one
      if (fetchAbortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [apiEndpoint]);

  /**
   * Trigger claude-workflow update for a project
   */
  const handleUpdate = useCallback(async (projectPath: string): Promise<void> => {
    const project = projects.find((p) => p.path === projectPath);
    if (!project) return;

    setUpdating((prev) => ({ ...prev, [projectPath]: "pending" }));

    try {
      const response = await fetch("/api/projects/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string; message?: string };
        const errorMessage = errorData.message || errorData.error || `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as { jobId: string };

      // Close any existing event source for this project
      const existingEs = eventSourceRefs.current.get(projectPath);
      if (existingEs) {
        existingEs.close();
      }

      // Subscribe to SSE stream for job completion
      const eventSource = new EventSource(`/api/projects/update/${data.jobId}/stream`);
      eventSourceRefs.current.set(projectPath, eventSource);

      // Track if we've already handled completion (prevents double-handling)
      let hasCompleted = false;

      eventSource.addEventListener("complete", (event: MessageEvent<string>) => {
        if (hasCompleted) return;
        hasCompleted = true;

        const { exitCode } = JSON.parse(event.data) as { exitCode: number };
        if (exitCode === 0) {
          if (typeof onToastSuccess === "function") {
            onToastSuccess(`${project.name} updated successfully`, project.name);
          }
        } else {
          if (typeof onToastError === "function") {
            onToastError(`Failed to update ${project.name}`, project.name);
          }
        }
        setUpdating((prev) => ({
          ...prev,
          [projectPath]: exitCode === 0 ? "success" : "error",
        }));
        eventSource.close();
        eventSourceRefs.current.delete(projectPath);
        // Clear status after 3 seconds using cleanup-safe helper
        clearProjectStatusAfterDelay(projectPath);
      });

      // Note: SSE native error event can fire on connection close
      // Only treat it as an error if we haven't received a complete event
      eventSource.addEventListener("error", () => {
        if (hasCompleted) return;
        hasCompleted = true;

        if (typeof onToastError === "function") {
          onToastError(`Error updating ${project.name}`, project.name);
        }
        setUpdating((prev) => ({ ...prev, [projectPath]: "error" }));
        eventSource.close();
        eventSourceRefs.current.delete(projectPath);
        clearProjectStatusAfterDelay(projectPath);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      if (typeof onToastError === "function") {
        onToastError(errorMessage, project.name);
      }
      setUpdating((prev) => ({ ...prev, [projectPath]: "error" }));
      clearProjectStatusAfterDelay(projectPath);
    }
  }, [projects, onToastSuccess, onToastError, clearProjectStatusAfterDelay]);

  /**
   * Sort projects by active sessions (most first), then by last activity
   */
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      // Primary sort: active sessions (descending)
      if (b.activeSessions !== a.activeSessions) {
        return b.activeSessions - a.activeSessions;
      }
      // Secondary sort: last activity (most recent first)
      const dateA = new Date(a.lastActivity).getTime();
      const dateB = new Date(b.lastActivity).getTime();
      return dateB - dateA;
    });
  }, [projects]);

  /**
   * Trigger batched updates for all projects
   * Processes projects in batches of 5 to respect backend rate limits
   */
  const handleUpdateAll = useCallback(async (): Promise<void> => {
    if (updateAllStatus?.isRunning) return;

    const total = sortedProjects.length;
    let completedCount = 0;
    const errors: string[] = [];
    const BATCH_SIZE = 5; // Match backend MAX_CONCURRENT_TOTAL

    setUpdateAllStatus({ isRunning: true, current: 0, total, errors: [] });

    // Set all projects to pending initially
    setUpdating((prev) => {
      const next = { ...prev };
      sortedProjects.forEach((p) => {
        next[p.path] = "pending";
      });
      return next;
    });

    /**
     * Update a single project and return a promise that resolves when complete
     */
    const updateProject = (project: ProjectWithTokens): Promise<void> => {
      return new Promise<void>((resolve) => {
        const projectPath = project.path;

        const startUpdate = async (): Promise<void> => {
          try {
            const response = await fetch("/api/projects/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectPath }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({})) as { message?: string };
              throw new Error(errorData.message || `HTTP ${response.status}`);
            }

            const data = (await response.json()) as { jobId: string };
            const eventSource = new EventSource(`/api/projects/update/${data.jobId}/stream`);

            // Track if we've already resolved (to handle both complete and error events)
            let hasResolved = false;

            eventSource.addEventListener("complete", (event: MessageEvent<string>) => {
              if (hasResolved) return;
              hasResolved = true;

              const { exitCode } = JSON.parse(event.data) as { exitCode: number };
              if (exitCode === 0) {
                if (typeof onToastSuccess === "function") {
                  onToastSuccess(`${project.name} updated successfully`, project.name);
                }
              } else {
                if (typeof onToastError === "function") {
                  onToastError(`Failed to update ${project.name}`, project.name);
                }
                errors.push(projectPath);
              }
              setUpdating((prev) => ({
                ...prev,
                [projectPath]: exitCode === 0 ? "success" : "error",
              }));
              eventSource.close();
              eventSourceRefs.current.delete(projectPath);

              // Update completion count
              completedCount++;
              setUpdateAllStatus((prev) => prev ? { ...prev, current: completedCount } : null);
              resolve();
            });

            // Note: SSE native error event can fire on connection close
            // Only treat it as an error if we haven't received a complete event
            eventSource.addEventListener("error", () => {
              if (hasResolved) return;
              hasResolved = true;

              if (typeof onToastError === "function") {
                onToastError(`Error updating ${project.name}`, project.name);
              }
              setUpdating((prev) => ({ ...prev, [projectPath]: "error" }));
              eventSource.close();
              eventSourceRefs.current.delete(projectPath);
              errors.push(projectPath);

              // Update completion count even on error
              completedCount++;
              setUpdateAllStatus((prev) => prev ? { ...prev, current: completedCount } : null);
              resolve();
            });

            eventSourceRefs.current.set(projectPath, eventSource);
          } catch (err) {
            if (typeof onToastError === "function") {
              const msg = err instanceof Error ? err.message : "Unknown error";
              onToastError(`${project.name}: ${msg}`, project.name);
            }
            setUpdating((prev) => ({ ...prev, [projectPath]: "error" }));
            errors.push(projectPath);

            // Update completion count even on error
            completedCount++;
            setUpdateAllStatus((prev) => prev ? { ...prev, current: completedCount } : null);
            resolve();
          }
        };

        void startUpdate();
      });
    };

    // Process projects in batches to avoid rate limiting
    for (let i = 0; i < sortedProjects.length; i += BATCH_SIZE) {
      const batch = sortedProjects.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(updateProject));
    }

    // Clear update all status
    setUpdateAllStatus(null);

    // Clear individual statuses after 3 seconds using cleanup-safe ref
    if (updateAllTimeoutRef.current) {
      clearTimeout(updateAllTimeoutRef.current);
    }
    updateAllTimeoutRef.current = setTimeout(() => {
      setUpdating({});
      updateAllTimeoutRef.current = null;
    }, 3000);
  }, [sortedProjects, updateAllStatus, onToastSuccess, onToastError]);

  /**
   * Initial fetch and periodic refresh
   */
  useEffect(() => {
    void fetchProjects();
    const interval = setInterval(() => void fetchProjects(), refreshInterval);
    return () => clearInterval(interval);
  }, [fetchProjects, refreshInterval]);

  /**
   * Get visible projects based on expansion state
   */
  const visibleProjects = useMemo(() => {
    return sortedProjects;
  }, [sortedProjects]);

  // Loading state - skeleton matching project row layout
  if (loading && projects.length === 0) {
    return (
      <TerminalCard command="ls -la" filename="~/projects" className={className}>
        <div className="flex flex-col flex-1 min-h-0 h-full -mx-4 -my-4 [&>*+*]:border-t [&>*+*]:border-red-800/50 animate-pulse overflow-hidden">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* Project name */}
                <div className="h-4 bg-gray-800/50 rounded" style={{ width: `${90 + (i % 3) * 30}px` }} />
                {/* Sessions count */}
                <div className="h-3.5 w-20 bg-gray-800/35 rounded shrink-0" />
                {/* Activity time */}
                <div className="h-3.5 w-14 bg-gray-800/35 rounded shrink-0" />
                {/* Token usage */}
                <div className="h-3.5 w-20 bg-gray-800/35 rounded shrink-0" />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-7 w-16 bg-gray-800/20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </TerminalCard>
    );
  }

  // Error state - retry button
  if (error !== null && projects.length === 0) {
    return (
      <TerminalCard command="ls -la" filename="~/projects" className={className}>
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <p className="text-gray-500 text-sm">Failed to load projects</p>
          <button
            type="button"
            className="text-xs text-gray-400 hover:text-white border border-red-800 px-3 py-1 rounded transition-colors"
            onClick={() => void fetchProjects()}
          >
            Retry
          </button>
        </div>
      </TerminalCard>
    );
  }

  // Empty state
  if (projects.length === 0) {
    return (
      <TerminalCard command="ls -la" filename="~/projects" className={className}>
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">No projects found</p>
        </div>
      </TerminalCard>
    );
  }

  // Data state - rows layout
  return (
    <TerminalCard
      command="ls -la"
      filename="~/projects"
      className={className}
      headerText={`${sortedProjects.length} project${sortedProjects.length !== 1 ? "s" : ""}`}
      headerActions={
        <button
          className={`h-7 px-2 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors border border-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 ${
            updateAllStatus?.isRunning
              ? "bg-red-700 text-white cursor-not-allowed opacity-70"
              : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
          }`}
          disabled={updateAllStatus?.isRunning || sortedProjects.length === 0}
          onClick={() => void handleUpdateAll()}
          title="Update all projects in parallel"
          type="button"
          aria-label={updateAllStatus?.isRunning ? `Updating ${updateAllStatus.current} of ${updateAllStatus.total} projects` : "Update all projects"}
          aria-live="polite"
        >
          {updateAllStatus?.isRunning ? (
            <span className="inline-flex items-center gap-2">
              <span className="spinner spinner-white w-3 h-3" />
              <span>Updating {updateAllStatus.current}/{updateAllStatus.total}...</span>
            </span>
          ) : (
            "Update All"
          )}
        </button>
      }
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-slim -mx-4 -my-4 [&>*+*]:border-t [&>*+*]:border-red-800">
        {visibleProjects.map((project) => (
          <div
            key={project.path}
            className="px-4 py-3 flex items-center justify-between gap-4"
            title={project.path}
          >
            {/* Left side: Project info */}
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              {/* Project name */}
              <span className="text-white text-xs sm:text-sm font-medium truncate min-w-0">{project.name}</span>

              {/* Active sessions and agents indicator - colored text */}
              <span
                className={`text-xs sm:text-sm shrink-0 ${
                  project.activeSessions > 0 || project.activeAgents > 0
                    ? "text-green-400"
                    : "text-gray-500"
                }`}
              >
                {project.activeSessions}<span className="hidden sm:inline"> session{project.activeSessions !== 1 ? "s" : ""}</span>
                {project.activeAgents > 0 && (
                  <span className="text-blue-400">
                    <span className="hidden sm:inline">, </span><span className="sm:hidden">/</span>{project.activeAgents}<span className="hidden sm:inline"> agent{project.activeAgents !== 1 ? "s" : ""}</span>
                  </span>
                )}
              </span>

              {/* Activity indicator - hidden on mobile */}
              <span className="hidden sm:inline text-gray-400 text-sm shrink-0">
                {project.lastActivity !== undefined
                  ? formatRelativeTime(project.lastActivity)
                  : "-"}
              </span>

              {/* Token usage - hidden on mobile */}
              <span className="hidden sm:inline text-gray-400 text-sm shrink-0">
                {formatTokens(project.tokenUsage?.day)} tokens
              </span>
            </div>

            {/* Right side: Outdated indicator + Update button */}
            <div className="flex items-center gap-2 shrink-0">
              {project.isOutdated && (
                <span className="text-gray-400 text-xs">(outdated)</span>
              )}
              <button
              className={`h-7 px-3 text-xs rounded-md transition-colors shrink-0 border-1 border-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 ${
                updating[project.path] === "pending"
                  ? "bg-red-700 text-white cursor-not-allowed opacity-70"
                  : updating[project.path] === "success"
                  ? "bg-red-600 text-white border-red-600"
                  : updating[project.path] === "error"
                  ? "bg-red-800 text-white border-red-800"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
              disabled={updating[project.path] === "pending"}
              onClick={() => void handleUpdate(project.path)}
              title="Run claude-workflow update"
              type="button"
            >
              {updating[project.path] === "pending" && (
                <span className="inline-flex items-center gap-2">
                  <span className="spinner spinner-white w-3 h-3" />
                  <span>Updating...</span>
                </span>
              )}
              {updating[project.path] === "success" && <span className="inline-flex items-center gap-1">✓ Done</span>}
              {updating[project.path] === "error" && <span className="inline-flex items-center gap-1">✗ Failed</span>}
              {!updating[project.path] && "Update"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </TerminalCard>
  );
}
