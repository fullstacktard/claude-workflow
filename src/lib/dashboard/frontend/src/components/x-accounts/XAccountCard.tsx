/**
 * XAccountCard Component
 *
 * Individual selectable account card showing handle, state badge,
 * warming progress bar (compact), health indicator, and last action timestamp.
 *
 * Design follows the AccountCard pattern from AccountUsageWidget.tsx
 * with terminal-aesthetic styling and green selection border.
 *
 * @module components/x-accounts/XAccountCard
 */

import type { DashboardXAccount, XAccountState, CookieFreshness } from "../../types/x-accounts";
import { computeCookieFreshness, getCookieFreshnessLabel } from "../../types/x-accounts";
import { WarmingPhaseBar } from "./WarmingPhaseBar";
import { WarmingHealthIndicator } from "./WarmingHealthIndicator";

/** Props for XAccountCard */
interface XAccountCardProps {
  /** Account data */
  account: DashboardXAccount;
  /** Whether this card is currently selected */
  isSelected: boolean;
  /** Click handler for selection */
  onClick: () => void;
}

/** Map account state to badge styling */
const STATE_BADGE_MAP: Record<XAccountState, { bg: string; label: string }> = {
  created: { bg: "bg-gray-600", label: "Created" },
  email_verified: { bg: "bg-cyan-600", label: "Email OK" },
  phone_verified: { bg: "bg-cyan-700", label: "Phone OK" },
  profile_setup: { bg: "bg-blue-600", label: "Setup" },
  warming: { bg: "bg-amber-600", label: "Warming" },
  active: { bg: "bg-green-600", label: "Active" },
  suspended: { bg: "bg-red-600", label: "Suspended" },
  locked: { bg: "bg-orange-600", label: "Locked" },
};

/** Warming schedule max_actions per phase (mirrors WARMING_SCHEDULES) */
const PHASE_MAX_ACTIONS: Array<{ dayRange: [number, number]; maxActions: number }> = [
  { dayRange: [0, 3], maxActions: 2 },
  { dayRange: [4, 7], maxActions: 5 },
  { dayRange: [8, 14], maxActions: 10 },
  { dayRange: [15, 21], maxActions: 15 },
];

/** Map cookie freshness to Tailwind dot color class */
const COOKIE_FRESHNESS_COLORS: Record<CookieFreshness, string> = {
  fresh: "bg-green-500",
  aging: "bg-yellow-500",
  stale: "bg-orange-500",
  none: "bg-red-500",
  never: "bg-gray-600",
};

/** Get max_actions for the current warming day */
function getMaxActionsForDay(day: number): number {
  const phase = PHASE_MAX_ACTIONS.find(
    (p) => day >= p.dayRange[0] && day <= p.dayRange[1]
  );
  return phase?.maxActions ?? 15;
}

/**
 * Format an ISO timestamp into a human-readable relative time string.
 * Examples: "2s ago", "5m ago", "3h ago", "2d ago", "1mo ago"
 */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (Number.isNaN(then) || diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}

/**
 * XAccountCard renders a single account in the list panel.
 *
 * Visual structure:
 * ┌──────────────────────────────────────┐
 * │ @handle                      [Badge] │
 * │ [===========-----]  (compact bar)    │
 * │ ● On Track                    2h ago │
 * └──────────────────────────────────────┘
 */
export function XAccountCard({
  account,
  isSelected,
  onClick,
}: XAccountCardProps): JSX.Element {
  const badge = STATE_BADGE_MAP[account.state];

  const borderClass = isSelected ? "border-green-600" : "border-gray-800/50";

  // Derive warming data
  const warming = account.warming;
  const lastActionTimestamp = warming?.last_action_at ?? account.updated_at;

  // Cookie freshness indicator
  const cookieFreshness = computeCookieFreshness(account.has_cookies, account.cookie_harvested_at);
  const cookieLabel = getCookieFreshnessLabel(cookieFreshness, account.cookie_harvested_at);
  const cookieDotColor = COOKIE_FRESHNESS_COLORS[cookieFreshness];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`w-full text-left bg-gray-900/50 rounded-md p-3 border ${borderClass} hover:border-gray-600 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-600`}
    >
      {/* Row 1: Handle + Cookie freshness dot + State badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-white text-sm font-medium truncate">
            @{account.handle}
          </span>
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${cookieDotColor}`}
            title={cookieLabel}
            aria-label={`Cookie status: ${cookieLabel}`}
          />
        </div>
        <span
          className={`text-xs px-1.5 py-px rounded-full ${badge.bg} text-white shrink-0`}
        >
          {badge.label}
        </span>
      </div>

      {/* Row 2: Compact warming phase bar (only if warming data exists) */}
      {warming != null && (
        <WarmingPhaseBar day={warming.day} compact className="mt-1.5" />
      )}

      {/* Row 3: Health indicator + Last action timestamp */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        {warming != null ? (
          <WarmingHealthIndicator
            day={warming.day}
            actionsToday={warming.actions_today}
            maxActions={getMaxActionsForDay(warming.day)}
            lastActionAt={warming.last_action_at}
            showLabel
          />
        ) : (
          <span className="text-gray-600 text-xs">--</span>
        )}

        {/* Last action timestamp */}
        {lastActionTimestamp ? (
          <span className="text-gray-500 text-xs">
            {formatRelativeTime(lastActionTimestamp)}
          </span>
        ) : (
          <span className="text-gray-600 text-xs">No activity</span>
        )}
      </div>
    </button>
  );
}
