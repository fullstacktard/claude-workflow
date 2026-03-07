/**
 * WarmingHealthIndicator - Traffic-light health status for warming accounts
 *
 * Statuses:
 * - On Track (green): actions_today >= 50% of max AND activity in last 24h
 * - Behind (amber): no activity 24-48h OR actions < 25% of max
 * - Stalled (gray): no activity 48+ hours
 * - Error (red): explicit error flag
 * - Completed (green+badge): day >= 22
 *
 * @module components/x-accounts/WarmingHealthIndicator
 */

import { CheckCircle, AlertTriangle, PauseCircle, XCircle, Award } from "lucide-react";
import type { ComponentType } from "react";

/** Possible warming health statuses */
export type WarmingHealthStatus =
  | "on_track"
  | "behind"
  | "stalled"
  | "error"
  | "completed";

/** Props for WarmingHealthIndicator */
interface WarmingHealthIndicatorProps {
  /** Current warming day */
  day: number;
  /** Actions performed today */
  actionsToday: number;
  /** Maximum actions for current phase */
  maxActions: number;
  /** ISO timestamp of last warming action */
  lastActionAt: string;
  /** Whether last warming step had an error */
  hasError?: boolean;
  /** Show label text next to dot */
  showLabel?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const FULL_ACCESS_DAY = 21;

/**
 * Compute the warming health status from account warming data.
 *
 * Decision priority:
 * 1. day > 21 -> completed
 * 2. hasError -> error
 * 3. hours since action > 48 -> stalled
 * 4. hours since action > 24 OR ratio < 25% -> behind
 * 5. ratio >= 50% -> on_track
 * 6. Default -> on_track (has recent activity)
 */
export function computeWarmingHealth(
  day: number,
  actionsToday: number,
  maxActions: number,
  lastActionAt: string,
  hasError?: boolean
): WarmingHealthStatus {
  if (day > FULL_ACCESS_DAY) return "completed";
  if (hasError) return "error";

  const hoursSinceAction = lastActionAt
    ? (Date.now() - new Date(lastActionAt).getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceAction > 48) return "stalled";
  if (
    hoursSinceAction > 24 ||
    (maxActions > 0 && actionsToday / maxActions < 0.25)
  )
    return "behind";
  if (maxActions > 0 && actionsToday / maxActions >= 0.5) return "on_track";
  return "on_track"; // Default: has recent activity
}

/** Visual configuration per health status */
const HEALTH_CONFIG: Record<
  WarmingHealthStatus,
  {
    label: string;
    dotClass: string;
    textClass: string;
    icon: ComponentType<{ className?: string }>;
  }
> = {
  on_track: {
    label: "On Track",
    dotClass: "bg-green-500",
    textClass: "text-gray-400",
    icon: CheckCircle,
  },
  behind: {
    label: "Behind",
    dotClass: "bg-yellow-500",
    textClass: "text-yellow-400",
    icon: AlertTriangle,
  },
  stalled: {
    label: "Stalled",
    dotClass: "bg-gray-500",
    textClass: "text-gray-500",
    icon: PauseCircle,
  },
  error: {
    label: "Error",
    dotClass: "bg-red-500",
    textClass: "text-red-400",
    icon: XCircle,
  },
  completed: {
    label: "Completed",
    dotClass: "bg-green-500",
    textClass: "text-gray-400",
    icon: Award,
  },
};

/**
 * WarmingHealthIndicator renders a traffic-light color dot with label
 * representing the account's warming health status.
 */
export function WarmingHealthIndicator({
  day,
  actionsToday,
  maxActions,
  lastActionAt,
  hasError = false,
  showLabel = true,
  className = "",
}: WarmingHealthIndicatorProps): JSX.Element {
  const status = computeWarmingHealth(
    day,
    actionsToday,
    maxActions,
    lastActionAt,
    hasError
  );
  const config = HEALTH_CONFIG[status];
  const IconComponent = config.icon;

  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      role="status"
      aria-label={`Warming health: ${config.label}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass}`}
        aria-hidden="true"
      />
      {status === "completed" && (
        <IconComponent className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
      )}
      {showLabel && (
        <span className={`text-xs ${config.textClass}`}>
          {config.label}
        </span>
      )}
    </div>
  );
}
