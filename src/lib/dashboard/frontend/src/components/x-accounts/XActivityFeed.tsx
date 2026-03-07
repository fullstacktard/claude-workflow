/**
 * XActivityFeed Component
 *
 * Scrollable chronological log of operations performed on X accounts.
 * Each entry displays: timestamp | action type | status badge | message | handle.
 *
 * Auto-scrolls to bottom on new entries (newest at bottom), following
 * the LiveLogFeed pattern for terminal-like behavior.
 *
 * @module components/x-accounts/XActivityFeed
 */

import { useEffect, useRef } from "react";
import type { XActivityEntry } from "../../types/x-accounts";

/** Props for the XActivityFeed component */
interface XActivityFeedProps {
  /** Activity entries to display (chronological order, oldest first) */
  entries: XActivityEntry[];
}

/** Background + text color classes for status badges */
const STATUS_CLASSES: Record<string, string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  pending: "bg-yellow-600 text-white",
};

/** Human-readable labels for each action type */
const ACTION_LABELS: Record<string, string> = {
  tweet: "Tweet",
  like: "Like",
  follow: "Follow",
  warming_step: "Warm",
  health_check: "Health",
  import: "Import",
  profile_setup: "Profile",
  timeline: "Timeline",
  notifications: "Notifs",
};

/**
 * XActivityFeed renders a scrollable log of X account operations
 * with auto-scroll to bottom on new entries.
 */
export function XActivityFeed({ entries }: XActivityFeedProps): JSX.Element {
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
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        No activity yet
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto scrollbar-hide p-2 space-y-0.5"
      role="log"
      aria-label="Account activity feed"
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
              STATUS_CLASSES[entry.status] ?? "bg-gray-600 text-white"
            }`}
          >
            {entry.status}
          </span>

          {/* Message */}
          <span className="text-gray-300 truncate flex-1">{entry.message}</span>

          {/* Handle */}
          <span className="text-gray-600 shrink-0">@{entry.handle}</span>
        </div>
      ))}
    </div>
  );
}
