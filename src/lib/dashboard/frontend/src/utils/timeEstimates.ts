/**
 * Time estimation utilities for blocked task display.
 */

/**
 * Estimated total durations by agent type (in milliseconds).
 * Based on typical completion patterns.
 */
const ESTIMATED_DURATIONS: Record<string, number> = {
  "task-maker": 60000, // ~1 minute
  "frontend-engineer": 180000, // ~3 minutes
  "backend-engineer": 180000, // ~3 minutes
  "code-reviewer": 120000, // ~2 minutes
  "feature-planner": 90000, // ~1.5 minutes
  "qa-engineer": 120000, // ~2 minutes
  "devops-engineer": 150000, // ~2.5 minutes
  default: 120000, // ~2 minutes
};

/**
 * Estimates remaining time for an agent based on type and elapsed time.
 * Returns human-readable string like "~2m", "~30s", "<1m"
 */
export function estimateRemainingTime(
  agentType: string,
  startedAt: string | undefined
): string | undefined {
  if (!startedAt) return undefined;

  const started = new Date(startedAt);
  const elapsed = Date.now() - started.getTime();

  const totalEstimate =
    ESTIMATED_DURATIONS[agentType] ?? ESTIMATED_DURATIONS.default;
  const remaining = Math.max(0, totalEstimate - elapsed);

  if (remaining <= 0) return "<1m";
  if (remaining < 60000) return `~${Math.ceil(remaining / 1000)}s`;
  return `~${Math.ceil(remaining / 60000)}m`;
}

/**
 * Formats a duration in milliseconds to human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Calculates elapsed time since a given timestamp.
 * Returns human-readable string like "2m ago", "30s ago"
 */
export function formatElapsedTime(startedAt: string | undefined): string {
  if (!startedAt) return "unknown";

  const started = new Date(startedAt);
  const elapsed = Date.now() - started.getTime();

  if (elapsed < 1000) return "just now";
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s ago`;
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
  return `${Math.floor(elapsed / 3600000)}h ago`;
}
