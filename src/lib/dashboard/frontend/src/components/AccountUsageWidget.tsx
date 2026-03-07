/**
 * AccountUsageWidget Component
 * Displays OAuth accounts with visual usage bars for 5h and 7d periods
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreVertical, Pin } from "lucide-react";

import { TerminalCard } from "./TerminalCard";
import type { Account } from "../types";

interface AccountUsageWidgetProps {
  /** API endpoint for accounts data */
  apiEndpoint?: string;
  /** Refresh interval in milliseconds (default: 60000) */
  refreshInterval?: number;
  /** Callback when Add Account is clicked */
  onAddAccount?: () => void;
  /** Callback when Set Active is clicked */
  onSetActive?: (accountId: string) => void;
  /** Callback when Refresh Token is clicked */
  onRefresh?: (accountId: string) => void;
  /** Callback when Remove is clicked */
  onRemove?: (accountId: string) => void;
  /** Callback when Pin/Unpin is clicked */
  onTogglePin?: (accountId: string) => void;
  /** Additional CSS classes */
  className?: string;
}

const DEFAULT_ENDPOINT = "/api/accounts";
const DEFAULT_REFRESH_INTERVAL = 60000;
const STALE_THRESHOLD_MS = 120000; // 2 minutes
const ACCOUNTS_FILE_PATH = "~/.claude-workflow/claude-accounts.json";

/**
 * Get usage bar color class based on percentage
 */
function getUsageColorClass(): string {
  return "bg-red-600";
}

/**
 * Format large numbers with K/M/B abbreviations
 * Removes trailing .0 but keeps other decimals (e.g., 50.0 → 50, 50.1 → 50.1)
 */
function formatNumber(num: number): string {
  const formatDecimal = (value: number): string => {
    const fixed = value.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
  };

  if (num >= 1_000_000_000) {
    return `${formatDecimal(num / 1_000_000_000)}B`;
  }
  if (num >= 1_000_000) {
    return `${formatDecimal(num / 1_000_000)}M`;
  }
  if (num >= 1_000) {
    return `${formatDecimal(num / 1_000)}K`;
  }
  return num.toString();
}

/**
 * Format reset time from ISO date string
 */
function formatResetTime(isoDate: string): string {
  const resetDate = new Date(isoDate);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return "now";

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`;
  }
  return `${diffMins}m`;
}

/**
 * Check if data is stale (older than 2 minutes)
 */
function isDataStale(lastUpdated: string): boolean {
  const lastUpdateTime = new Date(lastUpdated).getTime();
  return Date.now() - lastUpdateTime > STALE_THRESHOLD_MS;
}

interface UsageBarProps {
  label: string;
  current: number;
  limit: number;
  resetsAt: string;
}

/**
 * UsageBar Component
 * Displays a single usage progress bar with label, percentage, and reset time
 */
function UsageBar({ label, current, limit, resetsAt }: UsageBarProps): JSX.Element {
  const percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const colorClass = getUsageColorClass();

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 text-sm w-5 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-800/50 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-gray-400 text-sm font-mono whitespace-nowrap">
        {formatNumber(current)}/{formatNumber(limit)}
      </span>
      <span className="text-gray-600 text-sm whitespace-nowrap">
        {formatResetTime(resetsAt)}
      </span>
    </div>
  );
}

interface AccountCardProps {
  account: Account;
  onRefresh?: (accountId: string) => void;
  onRemove?: (accountId: string) => void;
  onSetActive?: (accountId: string) => void;
  onTogglePin?: (accountId: string) => void;
}

/**
 * AccountCard Component
 * Individual account card with dropdown menu
 */
function AccountCard({
  account,
  onRefresh,
  onRemove,
  onSetActive,
  onTogglePin,
}: AccountCardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside handler to close menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  // Check if 7d weekly limit specifically is hit (treated as expired for switching purposes)
  const isWeeklyLimitHit = account.usage7d.current >= account.usage7d.limit;

  // Check if 5h limit is hit (warning state only)
  const is5hLimitHit = account.usage5h.current >= account.usage5h.limit;

  // Weekly limit hit should be treated as "effectively expired" for switching purposes
  const isEffectivelyExpired = account.isExpired === true || isWeeklyLimitHit;

  // Card styling: expired/weekly-limit-hit (red+opacity), active (green), 5h-limit (yellow), inactive (red)
  // Weekly limit hit is now treated as expired visually and behaviorally
  // Grid cards - compact styling for 2-column layout, overflow hidden to contain content
  const baseClasses = "bg-gray-900/50 rounded-md p-3 relative flex flex-col";
  let cardClasses: string;
  if (isEffectivelyExpired && account.isActive) {
    cardClasses = `${baseClasses} border border-green-600 opacity-75`;
  } else if (isEffectivelyExpired) {
    cardClasses = `${baseClasses} border border-red-600 opacity-75`;
  } else if (account.isActive) {
    cardClasses = `${baseClasses} border border-green-600`;
  } else if (is5hLimitHit) {
    cardClasses = `${baseClasses} border border-yellow-500`;
  } else {
    cardClasses = `${baseClasses} border border-red-600`;
  }

  return (
    <div className={`${cardClasses}${menuOpen ? " z-50" : ""}`}>
      {/* 3-dot menu button */}
      <div className="absolute top-1 right-1" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="p-0.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
          aria-label="Account actions"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-gray-950 border-1 border-red-800 rounded-md shadow-xl z-[9999] py-1 min-w-40">
            {/* Conditional Set Active - only show if NOT active */}
            {!account.isActive && onSetActive && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-red-900/20 transition-colors"
                onClick={() => {
                  onSetActive(account.id);
                  setMenuOpen(false);
                }}
              >
                Set Active
              </button>
            )}
            {onTogglePin && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-red-900/20 transition-colors flex items-center gap-1.5"
                onClick={() => {
                  onTogglePin(account.id);
                  setMenuOpen(false);
                }}
              >
                <Pin className="w-3 h-3" />
                {account.isPinned ? "Unpin Account" : "Pin Account"}
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-red-900/20 transition-colors"
                onClick={() => {
                  onRefresh(account.id);
                  setMenuOpen(false);
                }}
              >
                Refresh Token
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                onClick={() => {
                  onRemove(account.id);
                  setMenuOpen(false);
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      {/* Account header */}
      <div className="pr-6">
        <div className="flex items-center gap-1.5 flex-wrap">
          {account.isActive && !isEffectivelyExpired && (
            <span className="text-xs px-1.5 py-px rounded-full bg-green-600 text-white shrink-0">
              Active
            </span>
          )}
          {account.isPinned === true && (
            <span className="text-xs px-1.5 py-px rounded-full bg-blue-600 text-white shrink-0 flex items-center gap-0.5">
              <Pin className="w-2.5 h-2.5" />
              Pin
            </span>
          )}
          {isEffectivelyExpired && (
            <span className="text-xs px-1.5 py-px rounded-full bg-red-600 text-white shrink-0">
              {account.expiredReason === "needs_reauth"
                ? "Re-auth"
                : account.isExpired === true
                ? "Expired"
                : "Weekly"}
            </span>
          )}
          {account.isLongLived === true && (
            <span className="text-xs px-1.5 py-px rounded-full border border-red-600 text-red-500 shrink-0">
              Long-lived
            </span>
          )}
          <span className="text-white text-sm font-medium truncate">
            {account.email ?? `Claude ${account.subscriptionType.charAt(0).toUpperCase() + account.subscriptionType.slice(1)}`}
          </span>
        </div>
      </div>

      {/* Usage bars */}
      <div className="flex flex-col gap-2.5 mt-2">
        <UsageBar
          label="5h"
          current={account.usage5h.current}
          limit={account.usage5h.limit}
          resetsAt={account.usage5h.resetsAt}
        />
        <UsageBar
          label="7d"
          current={account.usage7d.current}
          limit={account.usage7d.limit}
          resetsAt={account.usage7d.resetsAt}
        />
      </div>

      {/* Stale indicator */}
      {isDataStale(account.lastUpdated) && (
        <span className="text-xs text-yellow-400 mt-1 block">(stale data)</span>
      )}
    </div>
  );
}

/**
 * AccountUsageWidget component
 */
export function AccountUsageWidget({
  apiEndpoint = DEFAULT_ENDPOINT,
  refreshInterval = DEFAULT_REFRESH_INTERVAL,
  onAddAccount,
  onSetActive,
  onRefresh,
  onRemove,
  onTogglePin,
  className = "",
}: AccountUsageWidgetProps): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAccounts = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(apiEndpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = (await response.json()) as Account[];
      setAccounts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    void fetchAccounts();
    const interval = setInterval(() => {
      fetchAccounts().catch((err) => {
        console.error("[AccountUsageWidget] Periodic refresh failed:", err);
      });
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchAccounts, refreshInterval]);

  // Loading state - skeleton matching 2-column account card grid
  if (loading && accounts.length === 0) {
    return (
      <TerminalCard
        command="cat"
        filename={ACCOUNTS_FILE_PATH}
        allowOverflow={true}
        noPadding
        className={className}
      >
        <div className="p-3.5 flex-1 min-h-0 animate-pulse flex flex-col overflow-hidden">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="bg-gray-900/50 rounded-md p-3 border border-gray-800/50">
                {/* Account header: badge + email */}
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="h-4 w-12 bg-gray-800/50 rounded-full" />
                  <div className="h-3.5 bg-gray-800/35 rounded flex-1" />
                </div>
                {/* 5h usage bar */}
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-3 w-5 bg-gray-800/50 rounded" />
                  <div className="flex-1 bg-gray-800/20 rounded-full h-2" />
                  <div className="h-3 w-16 bg-gray-800/35 rounded" />
                  <div className="h-3 w-10 bg-gray-800/20 rounded" />
                </div>
                {/* 7d usage bar */}
                <div className="flex items-center gap-2">
                  <div className="h-3 w-5 bg-gray-800/50 rounded" />
                  <div className="flex-1 bg-gray-800/20 rounded-full h-2" />
                  <div className="h-3 w-16 bg-gray-800/35 rounded" />
                  <div className="h-3 w-10 bg-gray-800/20 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </TerminalCard>
    );
  }

  // Error state - minimal single line
  if (error !== null && accounts.length === 0) {
    return (
      <TerminalCard
        command="cat"
        filename={ACCOUNTS_FILE_PATH}
        allowOverflow={true}
        noPadding
        className={className}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">Failed to fetch accounts</p>
        </div>
      </TerminalCard>
    );
  }

  // Empty state
  if (accounts.length === 0 && !loading) {
    return (
      <TerminalCard
        command="cat"
        filename={ACCOUNTS_FILE_PATH}
        allowOverflow={true}
        noPadding
        headerActions={
          onAddAccount ? (
            <button
              className="bg-transparent border-1 border-red-800 text-gray-400 hover:bg-red-800 hover:text-gray-900 h-7 px-3 text-xs rounded-md transition-colors"
              onClick={onAddAccount}
              type="button"
            >
              Add Claude Account
            </button>
          ) : undefined
        }
        className={className}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">No accounts configured</p>
        </div>
      </TerminalCard>
    );
  }

  // Data state - 2-column grid with scroll when needed
  return (
    <TerminalCard
      command="cat"
      filename={ACCOUNTS_FILE_PATH}
      allowOverflow={true}
      noPadding
      headerText={`${accounts.length} Account${accounts.length !== 1 ? 's' : ''}`}
      headerActions={
        onAddAccount ? (
          <button
            className="bg-transparent border-1 border-red-800 text-gray-400 hover:bg-red-800 hover:text-gray-900 h-7 px-2 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors"
            onClick={onAddAccount}
            type="button"
          >
            <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">Add Claude Account</span>
          </button>
        ) : undefined
      }
      className={className}
    >
      <div className="p-3.5 flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onSetActive={onSetActive}
              onRefresh={onRefresh}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      </div>
    </TerminalCard>
  );
}
