/**
 * useActiveAgentCount Hook
 *
 * Fetches real active agent count from the projects API.
 * This represents actual running Claude processes across all projects,
 * not accumulated log entries.
 *
 * @module hooks/useActiveAgentCount
 */

import { useCallback, useEffect, useState } from "react";

/**
 * Project data with active counts
 */
interface ProjectWithCounts {
  /** Number of active main Claude sessions */
  activeSessions: number;
  /** Number of active agent subprocesses */
  activeAgents: number;
  /** Project name */
  name: string;
}

/**
 * Project info for visualization
 */
export interface ProjectInfo {
  /** Project name */
  name: string;
  /** Number of active main Claude sessions */
  activeSessions: number;
  /** Number of active agent subprocesses */
  activeAgents: number;
}

/**
 * Result of the useActiveAgentCount hook
 */
export interface UseActiveAgentCountResult {
  /** Total active sessions across all projects */
  totalSessions: number;
  /** Total active agents across all projects */
  totalAgents: number;
  /** All projects (for rendering residences) */
  projects: ProjectInfo[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refresh the counts */
  refresh: () => void;
}

/** Refresh interval: 5 seconds */
const REFRESH_INTERVAL_MS = 5000;

/**
 * Hook for fetching real active agent/session counts from process detection
 *
 * @returns Active counts, loading state, and error
 *
 * @example
 * ```tsx
 * function StatsPanel() {
 *   const { totalSessions, totalAgents, isLoading } = useActiveAgentCount();
 *
 *   return (
 *     <div>
 *       <div>Sessions: {totalSessions}</div>
 *       <div>Agents: {totalAgents}</div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useActiveAgentCount(): UseActiveAgentCountResult {
  const [totalSessions, setTotalSessions] = useState(0);
  const [totalAgents, setTotalAgents] = useState(0);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const response = await fetch("/api/projects");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const projectsData = (await response.json()) as ProjectWithCounts[];

      // Sum up all active sessions and agents across projects
      let sessions = 0;
      let agents = 0;

      const projectInfos: ProjectInfo[] = [];
      for (const project of projectsData) {
        sessions += project.activeSessions || 0;
        agents += project.activeAgents || 0;
        projectInfos.push({
          name: project.name,
          activeSessions: project.activeSessions || 0,
          activeAgents: project.activeAgents || 0,
        });
      }

      setTotalSessions(sessions);
      setTotalAgents(agents);
      setProjects(projectInfos);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and periodic refresh
  useEffect(() => {
    void fetchCounts();

    const interval = setInterval(() => {
      void fetchCounts();
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [fetchCounts]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    void fetchCounts();
  }, [fetchCounts]);

  return {
    totalSessions,
    totalAgents,
    projects,
    isLoading,
    error,
    refresh,
  };
}

export default useActiveAgentCount;
