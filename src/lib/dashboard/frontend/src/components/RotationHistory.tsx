/**
 * RotationHistory Component
 * Displays table of all account rotation events
 */

import type { RotationEvent } from "../hooks/useRotationEvents";
import type { Account } from "../types";
import { TerminalCard } from "./TerminalCard";

/**
 * Props for RotationHistory component
 */
interface RotationHistoryProps {
  /** List of rotation events (should be sorted newest first) */
  rotationHistory: RotationEvent[];
  /** List of accounts to lookup names */
  accounts: Account[];
  /** Optional CSS classes */
  className?: string;
}

/**
 * Format timestamp as human-readable date/time
 * Example output: "Jan 29, 6:30 PM"
 */
function formatTimestamp(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoDate));
}

/**
 * Format rotation reason as user-friendly text
 */
function formatReason(reason: string): string {
  const reasonMap: Record<string, string> = {
    rate_limit_5h: "5-hour rate limit",
    rate_limit_7d: "Weekly limit",
    manual: "Manual switch",
    scheduled: "Scheduled rotation",
  };

  return reasonMap[reason] ?? reason;
}

/**
 * Lookup account name/email from account ID
 */
function lookupAccountName(accountId: string | null, accounts: Account[]): string {
  if (!accountId) {
    return "—"; // Em dash for null (first-time activation)
  }

  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    return accountId; // Fallback to ID if not found
  }

  return account.email || account.name || accountId;
}

/**
 * RotationHistory Component
 *
 * Displays a table of all account rotation events with:
 * - Timestamp (formatted as "Jan 29, 6:30 PM")
 * - From account (email/name or "—" if first activation)
 * - To account (email/name)
 * - Rotation reason (user-friendly text)
 * - Selection criteria (from selectionReason field)
 *
 * Features:
 * - Responsive table with horizontal scroll on mobile
 * - Empty state message when no history exists
 * - Keyboard navigable (table rows are focusable)
 * - ARIA labels for accessibility
 *
 * @example
 * <RotationHistory
 *   rotationHistory={events}
 *   accounts={accountsList}
 * />
 */
export function RotationHistory({
  rotationHistory,
  accounts,
  className = "",
}: RotationHistoryProps): JSX.Element {
  // Empty state
  if (rotationHistory.length === 0) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.claude-workflow/rotation-history.log"
        allowOverflow={true}
        noPadding
        className={className}
      >
        <div className="flex items-center justify-center h-full p-8">
          <p className="text-gray-500 text-sm">No rotation history</p>
        </div>
      </TerminalCard>
    );
  }

  // Data state
  return (
    <TerminalCard
      command="cat"
      filename="~/.claude-workflow/rotation-history.log"
      allowOverflow={true}
      noPadding
      headerText={`${rotationHistory.length} rotation${rotationHistory.length !== 1 ? "s" : ""}`}
      className={className}
    >
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse min-w-[600px]"
          aria-label="Account rotation history"
        >
          <thead>
            <tr className="bg-gray-800 text-gray-400 text-left text-xs uppercase">
              <th scope="col" className="p-3">
                Timestamp
              </th>
              <th scope="col" className="p-3">
                From Account
              </th>
              <th scope="col" className="p-3">
                To Account
              </th>
              <th scope="col" className="p-3">
                Reason
              </th>
              <th scope="col" className="p-3">
                Selection Criteria
              </th>
            </tr>
          </thead>
          <tbody>
            {rotationHistory.map((event) => (
              <tr
                key={event.timestamp}
                className="border-b border-gray-700 text-gray-300 text-sm hover:bg-gray-800/50 transition-colors"
                tabIndex={0}
              >
                <td className="p-3 font-mono whitespace-nowrap">
                  {formatTimestamp(event.timestamp)}
                </td>
                <td className="p-3 break-words">
                  {lookupAccountName(event.previousAccountId, accounts)}
                </td>
                <td className="p-3 break-words">
                  {lookupAccountName(event.newAccountId, accounts)}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {formatReason(event.reason)}
                </td>
                <td className="p-3">{event.selectionReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TerminalCard>
  );
}
