/**
 * XContentPanel Component
 *
 * Tabbed container for the right-side panel of the X Accounts page.
 * Renders four tabs:
 * - Detail: Account metadata (XAccountDetail)
 * - Actions: Tweet composer + operation buttons (XActionsPanel)
 * - Activity: Scrollable operation log (XActivityFeed)
 * - Phones: GeeLark cloud phone management (XGeeLarkPanel)
 *
 * Tab styling follows ClaudeProxyTabbedWidget pattern:
 * - Active: `bg-red-600 text-white`
 * - Inactive: `bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900`
 *
 * When no account is selected, displays a centered "Select an account" placeholder.
 *
 * @module components/x-accounts/XContentPanel
 */

import { useState } from "react";
import { Info, Zap, Activity, Smartphone } from "lucide-react";

import type { DashboardXAccount, XActivityEntry } from "../../types/x-accounts";
import { TerminalCard } from "../TerminalCard";
import { XAccountDetail } from "./XAccountDetail";
import { XActionsPanel } from "./XActionsPanel";
import { XActivityFeed } from "./XActivityFeed";
import { XGeeLarkPanel } from "./XGeeLarkPanel";

/** Tab identifiers for the content panel */
type ContentTab = "detail" | "actions" | "activity" | "phones";

/** Props for the XContentPanel component */
interface XContentPanelProps {
  /** Currently selected account, null when nothing is selected */
  selectedAccount: DashboardXAccount | null;
  /** Activity log entries for the selected account */
  activityLog: XActivityEntry[];
  /** Callback to send a tweet from the selected account */
  onTweet: (text: string) => Promise<void>;
  /** Callback to run a health check on the selected account */
  onHealthCheck: () => Promise<void>;
  /** Callback to execute a warming step on the selected account */
  onWarm: () => Promise<void>;
  /** Callback to fetch timeline data for the selected account */
  onViewTimeline: () => Promise<Array<{ handle: string; text: string; timestamp: string }>>;
  /** Callback to fetch notifications for the selected account */
  onViewNotifications: () => Promise<unknown[]>;
  /** Callback to login via GeeLark cloud phone */
  onGeeLarkLogin?: (phoneId: string) => Promise<void>;
  /** Callback to tweet via GeeLark cloud phone */
  onGeeLarkTweet?: (phoneId: string, text: string) => Promise<void>;
  /** Callback to run deep health check via GeeLark */
  onGeeLarkHealth?: (phoneId: string) => Promise<void>;
  /** Callback to refresh cookies via GeeLark */
  onGeeLarkRefreshCookies?: (phoneId: string) => Promise<void>;
  /** Optional CSS class name */
  className?: string;
}

/** Tab configuration with icon and label */
const TABS: Array<{ id: ContentTab; label: string; icon: typeof Info }> = [
  { id: "detail", label: "Detail", icon: Info },
  { id: "actions", label: "Actions", icon: Zap },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "phones", label: "Phones", icon: Smartphone },
];

/**
 * XContentPanel renders the right-side tabbed content area.
 * Manages active tab state and delegates to the appropriate sub-component.
 */
export function XContentPanel({
  selectedAccount,
  activityLog,
  onTweet,
  onHealthCheck,
  onWarm,
  onViewTimeline,
  onViewNotifications,
  onGeeLarkLogin,
  onGeeLarkTweet,
  onGeeLarkHealth,
  onGeeLarkRefreshCookies,
  className = "",
}: XContentPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ContentTab>("detail");

  // "Select an account" placeholder when nothing is selected
  if (selectedAccount === null) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.x-accounts/detail"
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

  // Tab button row rendered in the TerminalCard header
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
      filename={`~/.x-accounts/${selectedAccount.handle}`}
      headerText={tabButtons}
      className={className}
      noPadding
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {activeTab === "detail" && (
          <div className="flex-1 overflow-y-auto">
            <XAccountDetail account={selectedAccount} />
          </div>
        )}
        {activeTab === "actions" && (
          <div className="flex-1 overflow-y-auto">
            <XActionsPanel
              account={selectedAccount}
              onTweet={onTweet}
              onHealthCheck={onHealthCheck}
              onWarm={onWarm}
              onViewTimeline={onViewTimeline}
              onViewNotifications={onViewNotifications}
              onGeeLarkLogin={onGeeLarkLogin}
              onGeeLarkTweet={onGeeLarkTweet}
              onGeeLarkHealth={onGeeLarkHealth}
              onGeeLarkRefreshCookies={onGeeLarkRefreshCookies}
            />
          </div>
        )}
        {activeTab === "activity" && (
          <XActivityFeed entries={activityLog} />
        )}
        {activeTab === "phones" && (
          <div className="flex-1 overflow-y-auto">
            <XGeeLarkPanel />
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
