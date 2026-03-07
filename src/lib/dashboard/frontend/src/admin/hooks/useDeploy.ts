/**
 * useDeploy - Hook for triggering deploys and polling status.
 *
 * Provides:
 * - triggerDeploy() to start a new deploy
 * - pollStatus() called automatically at 5s intervals when a deploy is active
 * - fetchHistory() to load recent deploy runs
 * - State: deployStatus, history, isTriggering, error
 */

import { useCallback, useEffect, useRef, useState } from "react";

type DeployTarget = "worker" | "npm" | "landing";
type BumpType = "none" | "patch" | "minor" | "major";

interface JobStatus {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface DeployRunStatus {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  jobs: JobStatus[];
  createdAt: string;
  updatedAt: string;
}

interface DeployHistoryEntry {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  displayTitle: string;
  actor: string;
}

interface TriggerDeployParams {
  targets: DeployTarget[];
  bumpType: BumpType;
  dryRun: boolean;
  changeSummary: string;
}

interface TriggerResponse {
  message: string;
  runId: number | null;
  targets: DeployTarget[];
  bumpType: BumpType;
  dryRun: boolean;
}

export interface UseDeployState {
  /** Current deploy run status (null if no active deploy) */
  deployStatus: DeployRunStatus | null;
  /** Whether a deploy trigger request is in flight */
  isTriggering: boolean;
  /** Whether status polling is active */
  isPolling: boolean;
  /** Deploy history entries */
  history: DeployHistoryEntry[];
  /** Whether history is being loaded */
  isLoadingHistory: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Trigger a new deploy */
  triggerDeploy: (params: TriggerDeployParams) => Promise<void>;
  /** Manually refresh history */
  refreshHistory: () => Promise<void>;
  /** Clear current deploy status */
  clearStatus: () => void;
}

const POLL_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function useDeploy(): UseDeployState {
  const [deployStatus, setDeployStatus] = useState<DeployRunStatus | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [history, setHistory] = useState<DeployHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRunIdRef = useRef<number | null>(null);

  /** Stop polling */
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  /** Poll status for a specific run ID */
  const pollStatus = useCallback(
    async (runId: number): Promise<void> => {
      try {
        const response = await fetchWithTimeout(`/api/deploy/status/${String(runId)}`);
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? `HTTP ${String(response.status)}`);
          return;
        }

        const status = (await response.json()) as DeployRunStatus;
        setDeployStatus(status);
        setError(null);

        // Stop polling when run completes
        if (status.status === "completed") {
          stopPolling();
          activeRunIdRef.current = null;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Poll failed";
        setError(message);
      }
    },
    [stopPolling],
  );

  /** Start polling for a run ID */
  const startPolling = useCallback(
    (runId: number) => {
      stopPolling();
      activeRunIdRef.current = runId;
      setIsPolling(true);

      // Initial poll
      void pollStatus(runId);

      // Set up interval
      pollIntervalRef.current = setInterval(() => {
        void pollStatus(runId);
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, pollStatus],
  );

  /** Trigger a new deploy */
  const triggerDeploy = useCallback(
    async (params: TriggerDeployParams): Promise<void> => {
      setIsTriggering(true);
      setError(null);
      setDeployStatus(null);

      try {
        const response = await fetchWithTimeout("/api/deploy/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string; details?: string };
          setError(data.error ?? `HTTP ${String(response.status)}`);
          return;
        }

        const result = (await response.json()) as TriggerResponse;

        if (result.runId !== null) {
          startPolling(result.runId);
        } else {
          setError("Deploy triggered but run ID not found. Check GitHub Actions manually.");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Trigger failed";
        setError(message);
      } finally {
        setIsTriggering(false);
      }
    },
    [startPolling],
  );

  /** Fetch deploy history */
  const refreshHistory = useCallback(async (): Promise<void> => {
    setIsLoadingHistory(true);
    try {
      const response = await fetchWithTimeout("/api/deploy/history?limit=15");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? `HTTP ${String(response.status)}`);
        return;
      }

      const entries = (await response.json()) as DeployHistoryEntry[];
      setHistory(entries);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  /** Clear current status */
  const clearStatus = useCallback(() => {
    stopPolling();
    setDeployStatus(null);
    setError(null);
    activeRunIdRef.current = null;
  }, [stopPolling]);

  // Load history on mount
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  return {
    deployStatus,
    isTriggering,
    isPolling,
    history,
    isLoadingHistory,
    error,
    triggerDeploy,
    refreshHistory,
    clearStatus,
  };
}
