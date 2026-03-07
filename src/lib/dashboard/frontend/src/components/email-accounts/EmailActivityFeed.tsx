/**
 * EmailActivityFeed Component
 *
 * Scrollable chronological log of email account operations.
 * Auto-scrolls to bottom on new entries (newest at bottom),
 * following the LiveLogFeed pattern for terminal-like behavior.
 *
 * @module components/email-accounts/EmailActivityFeed
 */

import { useEffect, useRef } from "react";
import type { EmailActivityEntry } from "../../types/email-accounts";

/** Props for the EmailActivityFeed component */
interface EmailActivityFeedProps {
  /** Activity entries to display (chronological order, oldest first) */
  entries: EmailActivityEntry[];
}

/** Background + text color classes for status indicators */
const STATUS_CLASSES: Record<string, string> = {
  true: "bg-green-600 text-white",
  false: "bg-red-600 text-white",
};

/** Human-readable labels for each action type */
const ACTION_LABELS: Record<string, string> = {
  health_checked: "Health",
  inbox_read: "Inbox",
  details_viewed: "Detail",
  account_created: "Create",
  account_deleted: "Delete",
  code_waited: "Code",
};

/**
 * EmailActivityFeed renders a scrollable log of email account operations
 * with auto-scroll to bottom on new entries.
 */
export function EmailActivityFeed({
  entries,
}: EmailActivityFeedProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries (newest at bottom, matching LiveLogFeed)
  useEffect(() => {
    if (containerRef.current !== null) {
      requestAnimationFrame(() => {
        if (containerRef.current !== null) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-500 text-sm p-4">
        No activity yet
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-48 overflow-y-auto scrollbar-hide p-2 space-y-0.5"
      role="log"
      aria-label="Email account activity feed"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-gray-800/50"
        >
          {/* Timestamp */}
          <span className="text-gray-600 shrink-0 w-16 font-mono">
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>

          {/* Action Type */}
          <span className="text-gray-400 shrink-0 w-14 truncate">
            {ACTION_LABELS[entry.action] ?? entry.action}
          </span>

          {/* Status Badge */}
          <span
            className={`shrink-0 text-[10px] px-1.5 py-px rounded-full ${
              STATUS_CLASSES[String(entry.success)] ?? "bg-gray-600 text-white"
            }`}
          >
            {entry.success ? "ok" : "fail"}
          </span>

          {/* Message */}
          <span className="text-gray-300 truncate flex-1">
            {entry.details ?? entry.action}
          </span>

          {/* Email */}
          <span className="text-gray-600 shrink-0 truncate max-w-24">
            {entry.email}
          </span>
        </div>
      ))}
    </div>
  );
}
