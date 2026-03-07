/**
 * Hook for managing project update operations with SSE progress tracking
 *
 * Protocol:
 * 1. POST /api/projects/update returns JSON { status: "started", jobId: "..." }
 * 2. Connect to GET /api/projects/update/:jobId/stream for SSE events
 * 3. SSE events: status, output, complete, error
 */

import { useCallback, useRef, useState } from "react";

/**
 * Update progress state from SSE stream
 */
export interface UpdateProgress {
  /** Progress message describing current operation */
  message: string;
  /** Completion percentage (0-100) */
  percent: number;
  /** Current operation status */
  status: "idle" | "running" | "success" | "error";
}

/**
 * Return type for useProjectUpdate hook
 */
export interface UseProjectUpdateResult {
  /** Error if update failed */
  error: Error | null;
  /** Current progress state */
  progress: UpdateProgress;
  /** Start update operation for a project */
  startUpdate: (projectPath: string) => Promise<void>;
}

/**
 * Default idle progress state
 */
const IDLE_PROGRESS: UpdateProgress = {
  message: "",
  percent: 0,
  status: "idle",
};

/**
 * Response from POST /api/projects/update
 */
interface UpdateStartResponse {
  status: "started";
  jobId: string;
}

/**
 * SSE output event payload
 */
interface OutputEvent {
  line: string;
  stream: "stdout" | "stderr";
}

/**
 * SSE complete event payload
 */
interface CompleteEvent {
  exitCode: number;
}

/**
 * SSE error event payload
 */
interface ErrorEvent {
  error: string;
}

/**
 * Hook for managing project update operations with SSE progress streaming
 *
 * @returns Update state, error, and startUpdate function
 */
export function useProjectUpdate(): UseProjectUpdateResult {
  const [progress, setProgress] = useState<UpdateProgress>(IDLE_PROGRESS);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const outputLinesRef = useRef<number>(0);

  const startUpdate = useCallback(async (projectPath: string): Promise<void> => {
    // Clean up any existing EventSource
    if (eventSourceRef.current !== null) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setError(null);
    setProgress({ message: "Starting update...", percent: 0, status: "running" });
    outputLinesRef.current = 0;

    try {
      // Step 1: POST to start the update job
      const response = await fetch("/api/projects/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(errorData.message ?? errorData.error ?? `Update failed: ${response.statusText}`);
      }

      // Step 2: Parse JSON response to get jobId
      const data = await response.json() as UpdateStartResponse;
      if (data.status !== "started" || !data.jobId) {
        throw new Error("Invalid response from update endpoint");
      }

      setProgress({ message: "Update started, connecting to stream...", percent: 5, status: "running" });

      // Step 3: Connect to SSE endpoint for real-time updates
      const eventSource = new EventSource(`/api/projects/update/${data.jobId}/stream`);
      eventSourceRef.current = eventSource;

      // Handle status events
      eventSource.addEventListener("status", (event: MessageEvent<string>) => {
        try {
          const status = JSON.parse(event.data) as { status: string };
          setProgress((prev) => ({
            ...prev,
            message: `Status: ${status.status}`,
            percent: 10,
          }));
        } catch {
          // Ignore parse errors
        }
      });

      // Handle output events (stdout/stderr from update command)
      eventSource.addEventListener("output", (event: MessageEvent<string>) => {
        try {
          const output = JSON.parse(event.data) as OutputEvent;
          outputLinesRef.current += 1;
          // Calculate progress based on output lines (estimate ~50 lines for full update)
          const lineProgress = Math.min(90, 10 + (outputLinesRef.current / 50) * 80);
          setProgress({
            message: output.line,
            percent: lineProgress,
            status: "running",
          });
        } catch {
          // Ignore parse errors
        }
      });

      // Handle completion event
      eventSource.addEventListener("complete", (event: MessageEvent<string>) => {
        try {
          const complete = JSON.parse(event.data) as CompleteEvent;
          eventSource.close();
          eventSourceRef.current = null;

          if (complete.exitCode === 0) {
            setProgress({ message: "Update completed successfully", percent: 100, status: "success" });
          } else {
            setError(new Error(`Update failed with exit code ${complete.exitCode}`));
            setProgress({ message: `Update failed (exit code ${complete.exitCode})`, percent: 100, status: "error" });
          }
        } catch {
          eventSource.close();
          eventSourceRef.current = null;
          setProgress({ message: "Update completed", percent: 100, status: "success" });
        }
      });

      // Handle error events
      eventSource.addEventListener("error", (event: Event) => {
        // Check if this is an SSE error event with data
        if (event instanceof MessageEvent) {
          try {
            const errorData = JSON.parse(event.data as string) as ErrorEvent;
            setError(new Error(errorData.error));
            setProgress({ message: errorData.error, percent: 0, status: "error" });
          } catch {
            // Not a JSON error event
          }
        }
        eventSource.close();
        eventSourceRef.current = null;
      });

      // Handle EventSource connection errors
      eventSource.onerror = () => {
        // EventSource automatically reconnects, but if we get here repeatedly
        // it means the connection failed. Check if we already completed successfully.
        if (progress.status !== "success" && progress.status !== "error") {
          // Only set error if we haven't already completed
          setTimeout(() => {
            if (eventSourceRef.current === eventSource && eventSource.readyState === EventSource.CLOSED) {
              setError(new Error("Connection to update stream lost"));
              setProgress((prev) => ({
                ...prev,
                message: "Connection to update stream lost",
                status: "error",
              }));
            }
          }, 1000);
        }
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(new Error(message));
      setProgress({ message, percent: 0, status: "error" });
    }
  }, [progress.status]);

  return { error, progress, startUpdate };
}
