/**
 * Hook for fetching claude-proxy container logs
 *
 * Provides polling-based updates for claude-proxy Docker container logs.
 * Uses REST API endpoint that fetches logs from the container.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Poll interval for log refresh (5 seconds) */
const POLL_INTERVAL = 5000;

/** Maximum log entries to keep */
const MAX_LOG_ENTRIES = 500;

/**
 * claude-proxy log entry
 */
export interface ClaudeProxyLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  raw: string;
}

/**
 * Connection status type
 */
export type ClaudeProxyLogStatus = "loading" | "connected" | "error" | "unavailable";

/**
 * Result of useClaudeProxyLogs hook
 */
export interface UseClaudeProxyLogsResult {
  /** Log entries received */
  entries: ClaudeProxyLogEntry[];
  /** Current status */
  status: ClaudeProxyLogStatus;
  /** Error message if any */
  error: string | null;
  /** Clear all entries */
  clearEntries: () => void;
  /** Manually refresh logs */
  refresh: () => Promise<void>;
}

/**
 * Parse a log line into structured entry
 */
function parseLogLine(line: string): ClaudeProxyLogEntry | null {
  if (!line.trim()) return null;

  // Try to parse common log formats
  // Format 1: ISO timestamp prefix (e.g., "2024-01-15T10:30:45.123Z INFO message")
  // Format 2: Docker-style (e.g., "INFO:module:message")
  // Format 3: Plain text

  let level: ClaudeProxyLogEntry["level"] = "info";
  let timestamp = new Date().toISOString();
  let message = line;

  // Check for ISO timestamp at start
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*(.*)/);
  if (isoMatch) {
    timestamp = isoMatch[1];
    message = isoMatch[2];
  }

  // Detect log level
  const lowerLine = line.toLowerCase();
  if (lowerLine.includes("error") || lowerLine.includes("exception") || lowerLine.includes("failed")) {
    level = "error";
  } else if (lowerLine.includes("warn")) {
    level = "warn";
  } else if (lowerLine.includes("debug")) {
    level = "debug";
  }

  return {
    timestamp,
    level,
    message: message.trim(),
    raw: line,
  };
}

/**
 * Custom hook for claude-proxy logs
 */
export function useClaudeProxyLogs(): UseClaudeProxyLogsResult {
  const [entries, setEntries] = useState<ClaudeProxyLogEntry[]>([]);
  const [status, setStatus] = useState<ClaudeProxyLogStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimestampRef = useRef<string | null>(null);

  /**
   * Fetch logs from API
   */
  const fetchLogs = useCallback(async (): Promise<void> => {
    try {
      const params = new URLSearchParams({ tail: "200" });
      if (lastTimestampRef.current) {
        params.set("since", lastTimestampRef.current);
      }

      const response = await fetch(`/api/claude-proxy/logs?${params.toString()}`);

      if (response.status === 503) {
        // Container not running
        setStatus("unavailable");
        setError("claude-proxy container is not running");
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { logs: string[]; containerRunning: boolean };

      if (!data.containerRunning) {
        setStatus("unavailable");
        setError("claude-proxy container is not running");
        return;
      }

      const newEntries = data.logs
        .map(parseLogLine)
        .filter((e): e is ClaudeProxyLogEntry => e !== null);

      if (newEntries.length > 0) {
        lastTimestampRef.current = newEntries[newEntries.length - 1].timestamp;

        setEntries((prev) => {
          const combined = [...prev, ...newEntries];
          return combined.slice(-MAX_LOG_ENTRIES);
        });
      }

      setStatus("connected");
      setError(null);
    } catch (err) {
      console.error("[useClaudeProxyLogs] Error fetching logs:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    }
  }, []);

  /**
   * Clear all entries
   */
  const clearEntries = useCallback((): void => {
    setEntries([]);
    lastTimestampRef.current = null;
  }, []);

  /**
   * Manual refresh
   */
  const refresh = useCallback(async (): Promise<void> => {
    clearEntries();
    await fetchLogs();
  }, [clearEntries, fetchLogs]);

  /**
   * Start polling on mount
   */
  useEffect(() => {
    // Initial fetch
    void fetchLogs();

    // Start polling
    pollIntervalRef.current = setInterval(() => {
      void fetchLogs();
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchLogs]);

  return {
    entries,
    status,
    error,
    clearEntries,
    refresh,
  };
}
