/**
 * useRotationEvents Hook
 * Listens for account rotation events via WebSocket and maintains rotation history
 */

import { useEffect, useState } from "react";

import type { AccountRotatedPayload } from "../types";
import { useWebSocket } from "./useWebSocket";

/**
 * Account rotation event with complete metadata
 */
export interface RotationEvent {
  /** ISO timestamp when rotation occurred */
  timestamp: string;
  /** Previous active account ID (null if first-time activation) */
  previousAccountId: string | null;
  /** New active account ID */
  newAccountId: string;
  /** Rotation reason */
  reason: "rate_limit_5h" | "rate_limit_7d" | "manual" | "scheduled";
  /** Human-readable explanation for account selection */
  selectionReason: string;
  /** Current utilization of newly activated account */
  utilization: {
    /** 5-hour utilization percentage (0-100) */
    fiveHour: number;
    /** 7-day utilization percentage (0-100) */
    sevenDay: number;
  };
}

/**
 * Result of the useRotationEvents hook
 */
interface UseRotationEventsResult {
  /** All rotation events in chronological order (newest first) */
  rotationHistory: RotationEvent[];
  /** Most recent rotation event (triggers toast) */
  latestRotation: RotationEvent | null;
}

/**
 * Custom hook for tracking account rotation events
 *
 * Subscribes to WebSocket 'account_rotated' events and maintains:
 * - Full rotation history (chronological order, newest first)
 * - Latest rotation event (for triggering toast notifications)
 *
 * @returns {UseRotationEventsResult} Rotation history and latest event
 *
 * @example
 * const { rotationHistory, latestRotation } = useRotationEvents();
 *
 * // Show toast when new rotation occurs
 * useEffect(() => {
 *   if (latestRotation) {
 *     showToast(`Switched to account ${latestRotation.newAccountId}`);
 *   }
 * }, [latestRotation]);
 */
export function useRotationEvents(): UseRotationEventsResult {
  const { lastMessage } = useWebSocket();
  const [rotationHistory, setRotationHistory] = useState<RotationEvent[]>([]);
  const [latestRotation, setLatestRotation] = useState<RotationEvent | null>(null);

  useEffect(() => {
    // Filter for account_rotated events
    if (lastMessage?.type === "account_rotated") {
      const payload = lastMessage.payload as AccountRotatedPayload | undefined;

      if (payload) {
        const event: RotationEvent = {
          timestamp: payload.timestamp,
          previousAccountId: payload.previousAccountId,
          newAccountId: payload.newAccountId,
          reason: payload.reason,
          selectionReason: payload.selectionReason,
          utilization: payload.utilization,
        };

        // Update history (newest first)
        setRotationHistory((prev) => [event, ...prev]);

        // Update latest rotation (triggers toast)
        setLatestRotation(event);
      }
    }
  }, [lastMessage]);

  return {
    rotationHistory,
    latestRotation,
  };
}
