/**
 * Hook for skipping blocked agents via API.
 * Provides optimistic updates with rollback on error.
 */

import { useState, useCallback } from "react";

/**
 * Result object returned by useSkipAgent hook.
 */
interface UseSkipAgentResult {
  /** Function to skip an agent by ID */
  skip: (agentId: string) => Promise<boolean>;
  /** Set of agent IDs currently being skipped */
  skipping: Set<string>;
  /** Error message if last skip failed */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Hook for skipping blocked agents.
 *
 * Provides optimistic updates - the agent is immediately added to the
 * `skipping` set, and removed on error (rollback) or kept out on success.
 *
 * @param onSkipped - Callback invoked when an agent is successfully skipped
 * @returns Object with skip function, skipping state, and error handling
 */
export function useSkipAgent(
  onSkipped?: (agentId: string) => void
): UseSkipAgentResult {
  const [skipping, setSkipping] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const skip = useCallback(
    async (agentId: string): Promise<boolean> => {
      // Optimistic update - add to skipping set immediately
      setSkipping((prev) => new Set(prev).add(agentId));
      setError(null);

      try {
        const response = await fetch("/api/workflow/skip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || "Failed to skip agent");
        }

        // Success - notify parent and remove from skipping set
        setSkipping((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
        onSkipped?.(agentId);
        return true;
      } catch (err) {
        // Rollback optimistic update
        setSkipping((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
        setError(err instanceof Error ? err.message : "Unknown error");
        return false;
      }
    },
    [onSkipped]
  );

  return { skip, skipping, error, clearError };
}
