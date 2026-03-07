/**
 * useTmuxSessions Hook
 *
 * Polls the tmux sessions REST API every 5 seconds and returns the
 * SessionTree data for the sidebar. Uses AbortController for request
 * cleanup on unmount and between polls.
 *
 * @example
 * ```tsx
 * const { data, error, loading } = useTmuxSessions();
 * if (loading) return <Spinner />;
 * if (error) return <ErrorMessage error={error} />;
 * return <SessionTree data={data} />;
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────

/** Serialized TmuxSession from the REST API (Date serialized as ISO string). */
export interface TmuxSessionWithNotification {
  id: string;
  name: string;
  path: string;
  created: string;
  attached: number;
  windows: number;
  hasNotification: boolean;
}

/** A project node with its sessions, as returned by the REST API. */
export interface SerializedProjectNode {
  project: {
    name: string;
    path: string;
    lastActivity?: string;
    installedVersion?: string;
  };
  sessions: TmuxSessionWithNotification[];
}

/**
 * Response shape for GET /api/tmux/sessions.
 * Matches TmuxSessionsResponse from the backend tmux router.
 */
export interface SessionTreeResponse {
  registered: SerializedProjectNode[];
  registeredNoSessions: SerializedProjectNode[];
  unregistered: TmuxSessionWithNotification[];
  totalSessions: number;
  tmuxAvailable: boolean;
}

/** Return value of the useTmuxSessions hook. */
export interface UseTmuxSessionsResult {
  data: SessionTreeResponse | null;
  error: Error | null;
  loading: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

/** Default polling interval (5 seconds). */
const POLL_INTERVAL_MS = 5_000;

/** API endpoint for session tree data. */
const SESSIONS_ENDPOINT = "/api/tmux/sessions";

/** Fetch timeout (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Hook that polls the tmux sessions REST API every 5 seconds.
 * Returns the SessionTree data for the sidebar tree view.
 *
 * - Aborts in-flight requests on unmount
 * - Aborts previous request when a new poll fires
 * - Times out after 10 seconds
 */
export function useTmuxSessions(): UseTmuxSessionsResult {
  const [data, setData] = useState<SessionTreeResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async (): Promise<void> => {
    // Abort any previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(SESSIONS_ENDPOINT, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
      }

      const json = (await response.json()) as SessionTreeResponse;

      // Only update state if this controller is still the active one
      if (abortRef.current === controller) {
        setData(json);
        setError(null);
      }
    } catch (err: unknown) {
      if (abortRef.current === controller) {
        if (err instanceof Error && err.name === "AbortError") {
          // Timeout or intentional abort -- mark as timeout error only
          // if we haven't been superseded by a new request
          setError(new Error("Request timed out"));
        } else {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
    const interval = setInterval(() => void fetchSessions(), POLL_INTERVAL_MS);

    return (): void => {
      clearInterval(interval);
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchSessions]);

  return { data, error, loading };
}
