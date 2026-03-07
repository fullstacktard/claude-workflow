/**
 * dashboard-fetch.ts
 * Centralized fetch wrapper for consistent error handling across the dashboard.
 *
 * Handles:
 * - Network errors: emits toast warning with category 'network-error'
 * - 401 responses: emits 'token-expired' event (decoupled via EventTarget)
 * - 503 responses: emits 'service-unavailable' event
 * - Timeout (10s default): emits toast with retry message
 *
 * Research: docs/research/x-dashboard-error-handling-patterns.md (Finding 7)
 */

/** Custom event types emitted by dashboardFetch */
export type DashboardFetchEventType =
  | "token-expired"
  | "service-unavailable"
  | "network-error"
  | "request-timeout";

export interface DashboardFetchEventDetail {
  url: string;
  status?: number;
  message: string;
}

/**
 * Global event emitter for dashboardFetch events.
 * Components subscribe via dashboardFetchEvents.addEventListener().
 * This decouples error handling from the fetch call site.
 *
 * @example
 * ```tsx
 * dashboardFetchEvents.addEventListener("token-expired", (event) => {
 *   const detail = (event as CustomEvent<DashboardFetchEventDetail>).detail;
 *   console.log("Token expired:", detail.message);
 * });
 * ```
 */
export const dashboardFetchEvents = new EventTarget();

function emitFetchEvent(type: DashboardFetchEventType, detail: DashboardFetchEventDetail): void {
  dashboardFetchEvents.dispatchEvent(
    new CustomEvent<DashboardFetchEventDetail>(type, { detail })
  );
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface DashboardFetchOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Skip automatic error event emission (for manual handling) */
  skipErrorEvents?: boolean;
}

/**
 * Fetch wrapper with centralized error handling.
 *
 * Returns a Response object in all cases (including network errors and timeouts)
 * so callers can use a consistent `.ok` / `.status` check pattern without try/catch.
 *
 * Events are emitted via `dashboardFetchEvents` EventTarget for decoupled handling.
 * Use `subscribeDashboardFetchEvents()` in React components with `useEffect`.
 *
 * @example
 * ```tsx
 * // Basic usage -- errors automatically emit events
 * const response = await dashboardFetch("/api/x/accounts");
 * const data = await response.json();
 *
 * // With timeout override
 * const response = await dashboardFetch("/api/x/accounts/warm", {
 *   method: "POST",
 *   timeoutMs: 30000,
 * });
 * ```
 */
export async function dashboardFetch(
  url: string,
  options?: DashboardFetchOptions
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, skipErrorEvents = false, ...fetchOptions } = options ?? {};

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Merge signal -- if caller provided their own signal, race both
  if (fetchOptions.signal) {
    const callerSignal = fetchOptions.signal;
    callerSignal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (skipErrorEvents) {
      return response;
    }

    // 401 -- token expired
    if (response.status === 401) {
      emitFetchEvent("token-expired", {
        url,
        status: 401,
        message: "Authentication token expired. Please re-authenticate.",
      });
      return response;
    }

    // 503 -- service unavailable
    if (response.status === 503) {
      emitFetchEvent("service-unavailable", {
        url,
        status: 503,
        message: "Service is temporarily unavailable. Please try again later.",
      });
      return response;
    }

    return response;
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (skipErrorEvents) {
      throw err;
    }

    // AbortError from timeout
    if (err instanceof DOMException && err.name === "AbortError") {
      emitFetchEvent("request-timeout", {
        url,
        message: `Request timed out after ${timeoutMs / 1000}s. Please try again.`,
      });
      // Return a synthetic 408 response so callers don't need try/catch
      return new Response(JSON.stringify({ error: "Request timeout" }), {
        status: 408,
        statusText: "Request Timeout",
        headers: { "Content-Type": "application/json" },
      });
    }

    // Network error (DNS failure, connection refused, etc.)
    emitFetchEvent("network-error", {
      url,
      message: err instanceof Error ? err.message : "Network error. Check your connection.",
    });

    // Return a synthetic 0 response for network errors
    return new Response(JSON.stringify({ error: "Network error" }), {
      status: 0,
      statusText: "Network Error",
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * React hook helper -- subscribe to dashboardFetch events and show toasts.
 * Import this in a component that has access to useToast().
 *
 * Returns an unsubscribe function for useEffect cleanup.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { addToast } = useToast();
 *
 *   useEffect(() => {
 *     return subscribeDashboardFetchEvents((type, detail) => {
 *       switch (type) {
 *         case "network-error":
 *           addToast(detail.message, "warning", { category: "network-error" });
 *           break;
 *         case "request-timeout":
 *           addToast(detail.message, "warning", { category: "request-timeout" });
 *           break;
 *         case "token-expired":
 *           addToast(detail.message, "warning", { category: "token-expired" });
 *           break;
 *         case "service-unavailable":
 *           addToast(detail.message, "warning", { category: "service-unavailable" });
 *           break;
 *       }
 *     });
 *   }, [addToast]);
 * }
 * ```
 */
export function subscribeDashboardFetchEvents(
  handler: (type: DashboardFetchEventType, detail: DashboardFetchEventDetail) => void
): () => void {
  const eventTypes: DashboardFetchEventType[] = [
    "token-expired",
    "service-unavailable",
    "network-error",
    "request-timeout",
  ];

  const listeners = eventTypes.map((type) => {
    const listener = (event: Event): void => {
      const customEvent = event as CustomEvent<DashboardFetchEventDetail>;
      handler(type, customEvent.detail);
    };
    dashboardFetchEvents.addEventListener(type, listener);
    return { type, listener };
  });

  // Return cleanup function
  return () => {
    for (const { type, listener } of listeners) {
      dashboardFetchEvents.removeEventListener(type, listener);
    }
  };
}
