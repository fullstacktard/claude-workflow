/**
 * Custom hook for fetching agent statistics from the backend API.
 *
 * Provides:
 * - Auto-refresh at configurable interval (default 30s)
 * - Loading and error states
 * - Manual refresh capability
 */

import { useState, useEffect, useCallback } from "react";

/**
 * Agent completion time statistics
 */
interface CompletionTime {
  avg: number;
  min: number;
  max: number;
}

/**
 * Agent token statistics
 */
interface TokenStats {
  total: number;
  avg: number;
}

/**
 * Individual agent metrics
 */
export interface AgentMetrics {
  name: string;
  invocationCount: number;
  completionTime: CompletionTime;
  tokens: TokenStats;
  skillsUsed: string[];
}

/**
 * MCP tool usage metric
 */
export interface McpToolMetric {
  server: string;
  tool: string;
  count: number;
}

/**
 * Skill usage metric
 */
export interface SkillMetric {
  name: string;
  count: number;
}

/**
 * Full agent stats response for 24-hour window
 */
export interface AgentStats24h {
  timeRangeHours: number;
  generatedAt: string;
  agents: AgentMetrics[];
  mcpTools: McpToolMetric[];
  topSkills: SkillMetric[];
}

/**
 * Hook return type
 */
interface UseAgentStatsResult {
  stats: AgentStats24h | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Default refresh interval (30 seconds)
 */
const DEFAULT_REFRESH_INTERVAL = 30000;

/**
 * Custom hook for fetching agent statistics
 *
 * @param refreshInterval - Interval in milliseconds for auto-refresh (default 30000)
 * @returns Object containing stats, loading state, error state, and refresh function
 */
export function useAgentStats(refreshInterval = DEFAULT_REFRESH_INTERVAL): UseAgentStatsResult {
  const [stats, setStats] = useState<AgentStats24h | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/stats/agents");

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as AgentStats24h;
      setStats(data);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      console.error("[useAgentStats] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and setup auto-refresh interval
  useEffect(() => {
    void fetchStats();

    const intervalId = setInterval(() => {
      void fetchStats();
    }, refreshInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchStats, refreshInterval]);

  const refresh = useCallback((): void => {
    setLoading(true);
    void fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refresh };
}
