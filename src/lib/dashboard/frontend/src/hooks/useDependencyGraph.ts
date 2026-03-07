/**
 * useDependencyGraph Hook
 *
 * Fetches and polls dependency graph data from the workflow API.
 * Provides real-time updates of agent dependencies and execution status.
 *
 * @example
 * const { data, isLoading, error, refetch } = useDependencyGraph({
 *   sessionId: 'session-123',
 *   pollInterval: 3000,
 * });
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Agent status values from the API */
export type AgentStatus =
  | "completed"
  | "running"
  | "waiting"
  | "blocked"
  | "error"
  | "pending"
  | "queued";

/** Agent node data from API */
export interface AgentNodeData {
  agent_id: string;
  agent_type: string;
  status: AgentStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

/** Edge representing a dependency between agents */
export interface DependencyEdge {
  source: string;
  target: string;
}

/** Complete dependency graph response from API */
export interface DependencyGraphData {
  session_id: string;
  nodes: AgentNodeData[];
  edges: DependencyEdge[];
  pending_spawn_queue: string[];
  max_concurrent_agents: number;
  active_agents: number;
}

/** Options for the useDependencyGraph hook */
export interface UseDependencyGraphOptions {
  /** Session ID to fetch graph for */
  sessionId: string;
  /** Polling interval in milliseconds (default: 3000) */
  pollInterval?: number;
  /** Whether to enable fetching (default: true) */
  enabled?: boolean;
  /** Callback for error handling */
  onError?: (error: Error) => void;
}

/** Return type for the useDependencyGraph hook */
export interface UseDependencyGraphResult {
  /** Dependency graph data or null if not loaded */
  data: DependencyGraphData | null;
  /** Whether the initial fetch is in progress */
  isLoading: boolean;
  /** Error from the last fetch attempt */
  error: Error | null;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
  /** Timestamp of last successful fetch */
  lastFetched: Date | null;
}

/**
 * Hook for fetching and polling dependency graph data
 *
 * @param options - Configuration options
 * @returns Dependency graph state and controls
 */
export function useDependencyGraph({
  sessionId,
  pollInterval = 3000,
  enabled = true,
  onError,
}: UseDependencyGraphOptions): UseDependencyGraphResult {
  const [data, setData] = useState<DependencyGraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async (): Promise<void> => {
    if (!sessionId || !enabled) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/workflow/${encodeURIComponent(sessionId)}/dependencies`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as DependencyGraphData;

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setData(result);
        setError(null);
        setLastFetched(new Date());
      }
    } catch (err) {
      const fetchError =
        err instanceof Error ? err : new Error("Failed to fetch dependency graph");

      if (isMountedRef.current) {
        setError(fetchError);
        onError?.(fetchError);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId, enabled, onError]);

  // Track mounted state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    if (enabled && sessionId) {
      void fetchData();
    } else {
      setIsLoading(false);
    }
  }, [fetchData, enabled, sessionId]);

  // Polling
  useEffect(() => {
    if (!enabled || pollInterval <= 0 || !sessionId) {
      return;
    }

    const interval = setInterval(() => {
      void fetchData();
    }, pollInterval);

    return () => {
      clearInterval(interval);
    };
  }, [fetchData, enabled, pollInterval, sessionId]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    lastFetched,
  };
}
