/**
 * EmailContentPanel Component
 *
 * Tabbed container for the right-side panel:
 * - Inbox (default): EmailInboxPanel
 * - Detail: EmailAccountDetail
 * - Settings: EmailActionsPanel + EmailActivityFeed
 *
 * @module components/email-accounts/EmailContentPanel
 */

import { useState } from "react";
import { Inbox, Info, Settings } from "lucide-react";

import type { EmailActivityEntry } from "../../types/email-accounts";
import type { DashboardEmailAccount } from "../../types/email-accounts";
import { TerminalCard } from "../TerminalCard";
import { EmailInboxPanel } from "./EmailInboxPanel";
import { EmailAccountDetail } from "./EmailAccountDetail";
import { EmailActionsPanel } from "./EmailActionsPanel";
import { EmailActivityFeed } from "./EmailActivityFeed";

/** Available tabs for the content panel */
type ContentTab = "inbox" | "detail" | "settings";

/** Props for the EmailContentPanel component */
interface EmailContentPanelProps {
  /** Currently selected account, or null if none */
  selectedAccount: DashboardEmailAccount | null;
  /** Activity log entries for the feed */
  activityLog: EmailActivityEntry[];
  /** Callback to log activity entries */
  onActivity: (action: string, success: boolean, details: string) => void;
  /** Callback after successful account deletion */
  onAccountDeleted: () => void;
  /** Callback after a health check completes (to refresh list) */
  onHealthChecked?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/** Tab configuration with icon component */
const TABS: Array<{ id: ContentTab; label: string; icon: typeof Info }> = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "detail", label: "Detail", icon: Info },
  { id: "settings", label: "Settings", icon: Settings },
];

/**
 * EmailContentPanel renders the right-side tabbed panel.
 * Shows a placeholder when no account is selected, otherwise renders
 * tab content (Inbox, Detail, or Settings+Activity).
 */
export function EmailContentPanel({
  selectedAccount,
  activityLog,
  onActivity,
  onAccountDeleted,
  onHealthChecked,
  className = "",
}: EmailContentPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ContentTab>("detail");

  if (selectedAccount === null) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.email-vault/detail"
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-gray-500 text-sm">
            Select an account to view details
          </p>
          <p className="text-gray-600 text-xs mt-1">
            Choose an account from the list on the left
          </p>
        </div>
      </TerminalCard>
    );
  }

  const tabButtons = (
    <div className="flex items-center gap-1.5">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`h-7 px-2 sm:px-3 text-xs rounded-md transition-colors border border-red-800 whitespace-nowrap flex items-center gap-1.5 ${
              isActive
                ? "bg-red-600 text-white"
                : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
            }`}
            aria-pressed={isActive}
            role="tab"
            aria-selected={isActive}
          >
            <Icon className="w-3 h-3" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <TerminalCard
      command="cat"
      filename={`~/.email-vault/${selectedAccount.email}`}
      headerText={tabButtons}
      className={className}
      noPadding
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {activeTab === "inbox" && (
          <EmailInboxPanel
            accountId={selectedAccount.id}
            accountEmail={selectedAccount.email}
            onActivity={onActivity}
          />
        )}
        {activeTab === "detail" && (
          <div className="flex-1 overflow-y-auto">
            <EmailAccountDetail
              account={selectedAccount}
              onActivity={onActivity}
              onHealthChecked={onHealthChecked}
            />
          </div>
        )}
        {activeTab === "settings" && (
          <div className="flex-1 overflow-y-auto space-y-0">
            <EmailActionsPanel
              account={selectedAccount}
              onActivity={onActivity}
              onDeleted={onAccountDeleted}
            />
            <div className="border-t border-red-800/30">
              <div className="px-4 py-2">
                <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Activity
                </h3>
              </div>
              <EmailActivityFeed entries={activityLog} />
            </div>
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
