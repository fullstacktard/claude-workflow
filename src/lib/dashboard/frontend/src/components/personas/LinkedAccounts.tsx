/**
 * LinkedAccounts Component
 *
 * Checkbox list of X accounts that can be linked to a persona.
 * Each toggle calls the link/unlink API endpoint.
 * Shows pending state while API request is in flight.
 *
 * @module components/personas/LinkedAccounts
 */

import { useState, useCallback } from "react";
import { Link2, Unlink } from "lucide-react";
import type { DashboardXAccount } from "../../types/x-accounts";

interface LinkedAccountsProps {
  /** Persona ID for API calls */
  personaId: string;
  /** Currently linked account IDs */
  linkedAccountIds: string[];
  /** All available X accounts */
  accounts: DashboardXAccount[];
  /** Callback to link an account */
  onLink: (personaId: string, accountId: string) => Promise<void>;
  /** Callback to unlink an account */
  onUnlink: (personaId: string, accountId: string) => Promise<void>;
}

export function LinkedAccounts({
  personaId,
  linkedAccountIds,
  accounts,
  onLink,
  onUnlink,
}: LinkedAccountsProps): JSX.Element {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback(
    async (accountId: string, isLinked: boolean): Promise<void> => {
      setPendingIds((prev) => new Set(prev).add(accountId));
      try {
        if (isLinked) {
          await onUnlink(personaId, accountId);
        } else {
          await onLink(personaId, accountId);
        }
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(accountId);
          return next;
        });
      }
    },
    [personaId, onLink, onUnlink],
  );

  if (accounts.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <p className="text-gray-500 text-sm">
          No X accounts available. Import one first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-4">
      <h3 className="text-xs text-gray-400 font-mono mb-2">linked x accounts</h3>
      {accounts.map((account) => {
        const isLinked = linkedAccountIds.includes(account.id);
        const isPending = pendingIds.has(account.id);
        return (
          <label
            key={account.id}
            className={`flex items-center gap-3 p-2.5 rounded-md border transition-colors cursor-pointer ${
              isLinked
                ? "border-red-800/50 bg-red-900/10"
                : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
            } ${isPending ? "opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              checked={isLinked}
              onChange={() => void handleToggle(account.id, isLinked)}
              disabled={isPending}
              className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-red-600 focus:ring-red-600 focus:ring-offset-0"
            />
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isLinked ? (
                <Link2 className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
              ) : (
                <Unlink className="w-3.5 h-3.5 text-gray-600 shrink-0" aria-hidden="true" />
              )}
              <span className="text-sm text-white font-mono truncate">
                @{account.handle}
              </span>
              <span
                className={`px-1.5 py-0.5 text-xs rounded border ${
                  account.state === "active"
                    ? "bg-green-900/50 text-green-400 border-green-700"
                    : "bg-gray-800/50 text-gray-500 border-gray-600"
                }`}
              >
                {account.state}
              </span>
            </div>
          </label>
        );
      })}
    </div>
  );
}
