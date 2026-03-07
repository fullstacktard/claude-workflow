/**
 * admin-fetch.ts
 *
 * Fetch wrapper for admin API calls that automatically attaches the
 * Bearer token from sessionStorage. Works as a plain function (not a hook)
 * so it can be used in any admin hook without requiring React context.
 *
 * The token is stored in sessionStorage by AdminAuthProvider during auto-auth.
 */

const SESSION_KEY = "claude-workflow-admin-token";
const DEFAULT_TIMEOUT_MS = 15_000;

interface AdminFetchOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
}

/**
 * Fetch wrapper that auto-attaches the admin Bearer token.
 *
 * @example
 * ```ts
 * const response = await adminFetch("/api/admin/config");
 * const data = await response.json();
 * ```
 */
export async function adminFetch(
  url: string,
  options?: AdminFetchOptions,
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders, ...fetchOptions } = options ?? {};

  const token = sessionStorage.getItem(SESSION_KEY);

  const mergedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders as Record<string, string> ?? {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: mergedHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
