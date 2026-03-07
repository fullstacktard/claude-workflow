/**
 * useThrottledCallback.ts
 * Prevents rapid re-invocations of a callback within a specified delay.
 *
 * Uses useRef internally -- no external dependencies.
 * Default delay: 5000ms (warming step operations).
 *
 * Research: docs/research/x-dashboard-error-handling-patterns.md (Finding 4)
 */

import { useCallback, useRef } from "react";

/**
 * Returns a throttled version of the callback that ignores invocations
 * occurring within `delayMs` of the last successful invocation.
 *
 * @param callback - The function to throttle
 * @param delayMs - Minimum milliseconds between invocations (default: 5000)
 * @returns Throttled callback with same signature
 *
 * @example
 * ```tsx
 * const handleWarm = useThrottledCallback(async (accountId: string) => {
 *   await fetch(`/api/x/accounts/${accountId}/warm`, { method: "POST" });
 * }, 5000);
 * ```
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delayMs: number = 5000
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  const lastCallRef = useRef<number>(0);
  const callbackRef = useRef<T>(callback);

  // Always keep the latest callback reference (avoids stale closures)
  callbackRef.current = callback;

  return useCallback(
    (...args: Parameters<T>): ReturnType<T> | undefined => {
      const now = Date.now();
      if (now - lastCallRef.current >= delayMs) {
        lastCallRef.current = now;
        return callbackRef.current(...args) as ReturnType<T>;
      }
      return undefined;
    },
    [delayMs]
  ) as (...args: Parameters<T>) => ReturnType<T> | undefined;
}
