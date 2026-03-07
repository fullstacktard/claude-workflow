/**
 * useAdminFetch
 *
 * Custom fetch wrapper for admin API calls.
 * Automatically attaches the Bearer token from AdminAuthContext.
 * Handles 401 responses by logging out (clearing sessionStorage).
 */

import { useCallback } from "react";

import { useAdminAuth } from "../contexts/AdminAuthContext";

/* -- Types --------------------------------------------------------------- */

interface AdminFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to merge with the default auth header */
  headers?: Record<string, string>;
}

interface AdminFetchResult<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/* -- Hook ---------------------------------------------------------------- */

/**
 * Returns a fetch function that automatically includes the admin Bearer token.
 *
 * @example
 * ```tsx
 * const adminFetch = useAdminFetch();
 *
 * const result = await adminFetch<{ users: User[] }>("/api/admin/users");
 * if (result.error) {
 *   console.error(result.error);
 * } else {
 *   console.log(result.data);
 * }
 * ```
 */
export function useAdminFetch(): <T = unknown>(
  url: string,
  options?: AdminFetchOptions,
) => Promise<AdminFetchResult<T>> {
  const { token, logout } = useAdminAuth();

  const adminFetch = useCallback(
    async <T = unknown>(
      url: string,
      options: AdminFetchOptions = {},
    ): Promise<AdminFetchResult<T>> => {
      const { headers: extraHeaders, ...restOptions } = options;

      const mergedHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      };

      try {
        const response = await fetch(url, {
          ...restOptions,
          headers: mergedHeaders,
        });

        // Handle 401 -- token expired or invalid
        if (response.status === 401) {
          logout();
          return {
            data: null,
            error: "Authentication expired. Please log in again.",
            status: 401,
          };
        }

        // Handle non-OK responses
        if (!response.ok) {
          let errorMessage = `Request failed with status ${String(response.status)}`;
          try {
            const errorBody = (await response.json()) as {
              message?: string;
              error?: string;
            };
            errorMessage =
              errorBody.message ?? errorBody.error ?? errorMessage;
          } catch {
            // Response body is not JSON, use default message
          }
          return {
            data: null,
            error: errorMessage,
            status: response.status,
          };
        }

        // Parse successful JSON response
        const data = (await response.json()) as T;
        return {
          data,
          error: null,
          status: response.status,
        };
      } catch (err) {
        // Network error or other fetch failure
        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        return {
          data: null,
          error: message,
          status: 0,
        };
      }
    },
    [token, logout],
  );

  return adminFetch;
}
