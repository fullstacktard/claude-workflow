/**
 * EmailAccountList Component
 *
 * Left panel with searchable, scrollable list of EmailAccountCards.
 * Header shows account count and "Create Account" button.
 * Includes loading skeleton, error state, and empty state.
 *
 * Pattern mirrors XAccountList.tsx (TerminalCard wrapper, search,
 * loading/error/empty states).
 *
 * @module components/email-accounts/EmailAccountList
 */

import { useState, useMemo } from "react";
import { Search, Plus } from "lucide-react";

import { TerminalCard } from "../TerminalCard";
import { EmailAccountCard } from "./EmailAccountCard";
import type { DashboardEmailAccount } from "../../types/email-accounts";

/** Props for the EmailAccountList component */
interface EmailAccountListProps {
  /** Account list from useEmailAccounts */
  accounts: DashboardEmailAccount[];
  /** Whether initial data is loading */
  loading: boolean;
  /** Fetch error */
  error: Error | null;
  /** Currently selected account ID */
  selectedId: string | null;
  /** Callback when an account card is clicked */
  onSelect: (accountId: string) => void;
  /** Callback when "Create Account" button is clicked */
  onCreateClick: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * EmailAccountList renders the account list panel with:
 * - Loading skeleton (animated pulse, 6 placeholder cards)
 * - Error state ("Failed to load accounts. Is MCP Proxy running?")
 * - Empty state with Create Account button
 * - Data state (search input + scrollable card list + header Create button)
 */
export function EmailAccountList({
  accounts,
  loading,
  error,
  selectedId,
  onSelect,
  onCreateClick,
  className = "",
}: EmailAccountListProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.toLowerCase();
    return accounts.filter((a) => a.email.toLowerCase().includes(q));
  }, [accounts, searchQuery]);

  // -- Loading skeleton --
  if (loading && accounts.length === 0) {
    return (
      <TerminalCard
        command="ls"
        filename="~/.email-vault/accounts"
        noPadding
        className={className}
      >
        <div className="p-3 animate-pulse flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="bg-gray-900/50 rounded-md p-3 border border-gray-800/50"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-4 w-32 bg-gray-800/50 rounded-full" />
                <div className="h-3.5 bg-gray-800/35 rounded flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-16 bg-gray-800/35 rounded" />
                <div className="h-3 w-12 bg-gray-800/20 rounded" />
              </div>
            </div>
          ))}
        </div>
      </TerminalCard>
    );
  }

  // -- Error state --
  if (error !== null && accounts.length === 0) {
    return (
      <TerminalCard
        command="ls"
        filename="~/.email-vault/accounts"
        noPadding
        className={className}
      >
        <div className="flex items-center justify-center h-full p-6">
          <p className="text-gray-500 text-sm">
            Failed to load accounts. Is MCP Proxy running?
          </p>
        </div>
      </TerminalCard>
    );
  }

  // -- Empty state --
  if (accounts.length === 0) {
    return (
      <TerminalCard
        command="ls"
        filename="~/.email-vault/accounts"
        noPadding
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full p-6 gap-3">
          <p className="text-gray-500 text-sm">No email accounts found.</p>
          <button
            type="button"
            onClick={onCreateClick}
            className="h-8 px-3 text-xs rounded-md border border-red-800 bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Account
          </button>
        </div>
      </TerminalCard>
    );
  }

  // Create Account button for header
  const createButton = (
    <button
      type="button"
      onClick={onCreateClick}
      className="h-7 px-2 text-xs rounded-md border border-red-800 bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1"
      aria-label="Create new email account"
    >
      <Plus className="w-3 h-3" />
      Create
    </button>
  );

  // -- Data state --
  return (
    <TerminalCard
      command="ls"
      filename="~/.email-vault/accounts"
      noPadding
      headerText={`${accounts.length} Account${accounts.length !== 1 ? "s" : ""}`}
      headerActions={createButton}
      className={className}
    >
      {/* Search input */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter accounts by email"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pb-3">
        <div
          className="flex flex-col gap-2"
          role="listbox"
          aria-label="Email accounts"
        >
          {filteredAccounts.map((account) => (
            <EmailAccountCard
              key={account.id}
              account={account}
              isSelected={account.id === selectedId}
              onClick={() => onSelect(account.id)}
            />
          ))}
          {filteredAccounts.length === 0 && searchQuery.trim() !== "" && (
            <p className="text-gray-500 text-xs text-center py-4">
              No accounts matching &quot;{searchQuery}&quot;
            </p>
          )}
        </div>
      </div>
    </TerminalCard>
  );
}
