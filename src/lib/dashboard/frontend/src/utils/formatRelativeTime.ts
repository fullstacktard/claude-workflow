/**
 * Format relative time utility
 * Converts ISO timestamps to human-readable relative time
 */

/**
 * Format an ISO timestamp as relative time (e.g., "2m ago", "5h ago")
 *
 * @param isoTimestamp - ISO 8601 timestamp string
 * @returns Human-readable relative time string
 *
 * @example
 * formatRelativeTime("2024-01-29T12:30:00Z") // "2m ago" (if 2 minutes have passed)
 * formatRelativeTime("2024-01-29T10:00:00Z") // "2h ago" (if 2 hours have passed)
 */
export function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;

  // Handle future dates (should not happen in practice)
  if (diffMs < 0) {
    return "just now";
  }

  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return "just now";
  }

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
