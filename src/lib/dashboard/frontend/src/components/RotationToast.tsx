/**
 * RotationToast Component
 * Displays toast notification when account rotation occurs
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RotationEvent } from "../hooks/useRotationEvents";
import type { Account } from "../types";

/**
 * Props for RotationToast component
 */
interface RotationToastProps {
  /** Rotation event data */
  event: RotationEvent;
  /** List of accounts to lookup names */
  accounts: Account[];
  /** Callback when toast is dismissed */
  onDismiss: () => void;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

/**
 * Format rotation reason as user-friendly text
 */
function formatReason(reason: string): string {
  const reasonMap: Record<string, string> = {
    rate_limit_5h: "5-hour rate limit",
    rate_limit_7d: "weekly limit",
    manual: "manual switch",
    scheduled: "scheduled rotation",
  };

  return reasonMap[reason] ?? reason;
}

/**
 * Get background color class based on rotation reason
 */
function getBackgroundClass(reason: string): string {
  if (reason === "manual") {
    return "bg-green-600";
  }
  return "bg-blue-600";
}

/**
 * Lookup account name/email from account ID
 */
function lookupAccountName(accountId: string, accounts: Account[]): string {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    return accountId; // Fallback to ID if not found
  }

  return account.email || account.name || accountId;
}

/**
 * RotationToast Component
 *
 * Displays a toast notification when an account rotation occurs.
 * Shows the new account, reason for rotation, utilization, and selection criteria.
 *
 * Features:
 * - Auto-dismisses after 5 seconds
 * - Slide-in/out animations (defined in globals.css)
 * - Color-coded by rotation reason (blue for rate limits, green for manual)
 * - ARIA live region for screen reader accessibility
 * - Keyboard dismissible with Escape key
 *
 * @example
 * <RotationToast
 *   event={rotationEvent}
 *   accounts={accountsList}
 *   onDismiss={() => console.log('Toast dismissed')}
 * />
 */
export function RotationToast({
  event,
  accounts,
  onDismiss,
  style,
}: RotationToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false);
  const hasDismissedRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = useCallback(() => {
    // Prevent multiple dismissals (race condition)
    if (hasDismissedRef.current) {
      return;
    }

    hasDismissedRef.current = true;
    setIsExiting(true);

    // Track timer for cleanup on unmount
    dismissTimerRef.current = setTimeout(() => {
      onDismiss();
    }, 200); // Match exit animation duration
  }, [onDismiss]);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const autoTimer = setTimeout(handleDismiss, 5000);

    return () => {
      clearTimeout(autoTimer);

      // Clean up dismiss timer if component unmounts during exit animation
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [handleDismiss]);

  // Keyboard handler for Escape key dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDismiss]);

  // Format message content
  const accountName = lookupAccountName(event.newAccountId, accounts);
  const avgUtilization = Math.round(
    (event.utilization.fiveHour + event.utilization.sevenDay) / 2
  );
  const reasonText = formatReason(event.reason);
  const bgClass = getBackgroundClass(event.reason);

  // Animation classes defined in globals.css (requires @keyframes)
  const animationClass = isExiting
    ? "animate-toast-slide-out"
    : "animate-toast-slide-in";

  return (
    <div
      className={`${bgClass} rounded-lg p-4 shadow-xl backdrop-blur-sm flex items-start gap-3 min-w-[320px] max-w-md ${animationClass}`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      style={style}
    >
      {/* Icon */}
      <RefreshCw className="w-5 h-5 text-white shrink-0 mt-0.5" aria-hidden="true" />

      {/* Content */}
      <div className="flex-1 text-white">
        {/* Screen reader announcement */}
        <span className="sr-only">Account rotation notification:</span>

        {/* Main message */}
        <p className="text-sm font-medium leading-snug">
          Switched to <span className="font-bold">{accountName}</span> (
          {avgUtilization}% utilization) due to {reasonText}
        </p>

        {/* Selection reason subtitle */}
        <p className="text-xs opacity-90 mt-1">{event.selectionReason}</p>
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="text-white hover:text-gray-200 transition-colors shrink-0"
        aria-label="Dismiss notification"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
