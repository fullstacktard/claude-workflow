/**
 * EmailAccountCard Component
 *
 * Individual selectable account card showing email address, provider badge,
 * health status dot, and last-checked timestamp.
 *
 * Visual structure:
 * +--------------------------------------+
 * | user@mail.com              [mail.com]|
 * | * Healthy                     2h ago |
 * +--------------------------------------+
 *
 * @module components/email-accounts/EmailAccountCard
 */

import type {
  DashboardEmailAccount,
  EmailProvider,
  EmailHealthStatus,
} from "../../types/email-accounts";

/** Props for the EmailAccountCard component */
interface EmailAccountCardProps {
  /** Account data */
  account: DashboardEmailAccount;
  /** Whether this card is currently selected */
  isSelected: boolean;
  /** Click handler for selection */
  onClick: () => void;
}

/** Provider badge color mapping */
const PROVIDER_BADGE_MAP: Record<EmailProvider, { bg: string; label: string }> =
  {
    "mail.com": { bg: "bg-blue-600", label: "mail.com" },
    "gmx.com": { bg: "bg-orange-600", label: "GMX" },
  };

/** Health status dot color mapping */
const HEALTH_DOT_MAP: Record<
  EmailHealthStatus,
  { color: string; label: string }
> = {
  healthy: { color: "bg-green-500", label: "Healthy" },
  unhealthy: { color: "bg-red-500", label: "Unhealthy" },
  unknown: { color: "bg-gray-600", label: "Unknown" },
};

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
 * EmailAccountCard renders a single selectable email account card.
 * Follows the XAccountCard pattern with button element, selection border,
 * and provider/health indicators.
 */
export function EmailAccountCard({
  account,
  isSelected,
  onClick,
}: EmailAccountCardProps): JSX.Element {
  const badge = PROVIDER_BADGE_MAP[account.provider];
  const health = HEALTH_DOT_MAP[account.health_status];
  const borderClass = isSelected ? "border-green-600" : "border-gray-800/50";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`w-full text-left bg-gray-900/50 rounded-md p-3 border ${borderClass} hover:border-gray-600 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-600`}
    >
      {/* Row 1: Email address + Provider badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-white text-sm font-medium truncate min-w-0">
          {account.email}
        </span>
        <span
          className={`text-xs px-1.5 py-px rounded-full ${badge.bg} text-white shrink-0`}
        >
          {badge.label}
        </span>
      </div>

      {/* Row 2: Health dot + label + last checked timestamp */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${health.color}`}
            aria-label={`Health: ${health.label}`}
          />
          <span className="text-gray-400 text-xs">{health.label}</span>
        </div>
        {account.last_health_check_at ? (
          <span className="text-gray-500 text-xs">
            {formatRelativeTime(account.last_health_check_at)}
          </span>
        ) : (
          <span className="text-gray-600 text-xs">Never checked</span>
        )}
      </div>
    </button>
  );
}
