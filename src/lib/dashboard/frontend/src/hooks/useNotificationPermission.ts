/**
 * useNotificationPermission -- manages Chrome Web Notification permission
 *
 * Requests notification permission on mount (once), tracks the current
 * permission state, and provides a manual request function for retry.
 *
 * The permission prompt is only shown by the browser once -- subsequent
 * calls to Notification.requestPermission() resolve instantly with the
 * cached permission value (granted/denied).
 */

import { useCallback, useEffect, useState } from "react";

export type NotificationPermissionState = "default" | "denied" | "granted" | "unsupported";

export interface UseNotificationPermissionResult {
  /** Current permission state */
  permission: NotificationPermissionState;
  /** Manually request permission (e.g., from a button click) */
  requestPermission: () => Promise<void>;
}

export function useNotificationPermission(): UseNotificationPermissionResult {
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission as NotificationPermissionState;
  });

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
    } catch {
      // Safari older versions use callback-based API
      setPermission(Notification.permission as NotificationPermissionState);
    }
  }, []);

  // Request permission on first mount
  useEffect(() => {
    if (permission === "default") {
      void requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { permission, requestPermission };
}
