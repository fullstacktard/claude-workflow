/**
 * Hook for handling credential update WebSocket messages
 *
 * Listens for credentials_updated messages from WebSocket and shows toast notifications
 * when accounts are synced from the CLI credential watcher.
 *
 * @example
 * ```tsx
 * const { lastMessage } = useWebSocket();
 * useCredentialUpdates({
 *   lastMessage,
 *   onAccountsUpdated: () => setAccountRefreshKey((prev) => prev + 1),
 * });
 * ```
 */

import { useCallback, useEffect, useRef } from "react";

import { useToast } from "../contexts/ToastContext";
import type {
  CredentialsUpdatedPayload,
  WSServerMessage,
} from "../types/websocket";

/** Dedupe window in milliseconds - ignore duplicate updates within this time */
const DEDUPE_WINDOW_MS = 5000;

interface UseCredentialUpdatesOptions {
  /** Last WebSocket message received */
  lastMessage: WSServerMessage | null;
  /** Optional callback to trigger when accounts are updated */
  onAccountsUpdated?: () => void;
}

/**
 * Type guard to check if payload is CredentialsUpdatedPayload
 */
function isCredentialsUpdatedPayload(
  payload: unknown
): payload is CredentialsUpdatedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "action" in payload &&
    "email" in payload &&
    "accountId" in payload
  );
}

/**
 * Hook for handling credential update WebSocket messages
 *
 * @param options - Hook options including lastMessage and optional callback
 */
export function useCredentialUpdates({
  lastMessage,
  onAccountsUpdated,
}: UseCredentialUpdatesOptions): void {
  const { addToast } = useToast();

  // Track last processed update to prevent toast spam
  const lastProcessedRef = useRef<{ accountId: string; timestamp: number } | null>(null);

  const handleCredentialsUpdated = useCallback(
    (payload: CredentialsUpdatedPayload) => {
      const { action, email } = payload;

      const message =
        action === "added"
          ? `Account synced from CLI: ${email}`
          : `Account updated from CLI: ${email}`;

      addToast(message, "info", { duration: 5000 });

      if (onAccountsUpdated !== undefined) {
        onAccountsUpdated();
      }
    },
    [addToast, onAccountsUpdated]
  );

  useEffect(() => {
    if (lastMessage === null) {
      return;
    }

    // Only process credentials_updated messages
    if (lastMessage.type !== "credentials_updated") {
      return;
    }

    const payload = lastMessage.payload;

    // Validate payload structure
    if (!isCredentialsUpdatedPayload(payload)) {
      return;
    }

    // Deduplicate: skip if same account was just processed within the window
    const now = Date.now();
    const lastProcessed = lastProcessedRef.current;
    if (
      lastProcessed !== null &&
      lastProcessed.accountId === payload.accountId &&
      now - lastProcessed.timestamp < DEDUPE_WINDOW_MS
    ) {
      return;
    }

    // Update last processed tracker
    lastProcessedRef.current = { accountId: payload.accountId, timestamp: now };

    handleCredentialsUpdated(payload);
  }, [lastMessage, handleCredentialsUpdated]);
}
