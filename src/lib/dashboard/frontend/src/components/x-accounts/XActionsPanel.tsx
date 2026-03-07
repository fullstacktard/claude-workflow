/**
 * XActionsPanel Component
 *
 * Combines the TweetComposer with a 2-column grid of action buttons,
 * plus a GeeLark Operations section for cloud-phone-based actions.
 *
 * Each action button has an independent loading state (only one action
 * at a time) and triggers success/error toasts on completion.
 *
 * HTTP API Operations:
 * - Check Health (HeartPulse icon) -- runs health check via API
 * - Warm (Flame icon) -- executes a warming step
 * - Timeline (ScrollText icon) -- fetches and displays timeline tweets
 * - Notifications (Bell icon) -- fetches notification data
 *
 * GeeLark Operations (amber-themed, billing confirmation required):
 * - Login (LogIn icon) -- login via cloud phone
 * - Tweet (Send icon) -- post tweet via cloud phone
 * - Deep Health Check (ShieldCheck icon) -- deep health check via cloud phone
 * - Refresh Cookies (Cookie icon) -- refresh cookies via cloud phone
 *
 * Timeline data renders below the button grid as a scrollable list
 * showing handle, tweet text, and timestamp per tweet.
 *
 * @module components/x-accounts/XActionsPanel
 */

import { useState } from "react";
import {
  HeartPulse,
  Flame,
  ScrollText,
  Bell,
  Loader2,
  LogIn,
  Send,
  ShieldCheck,
  Cookie,
  ChevronDown,
  Smartphone,
} from "lucide-react";

import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmationContext";
import { useGeeLarkPhones } from "../../hooks/useGeeLarkPhones";
import type { DashboardXAccount } from "../../types/x-accounts";
import { TweetComposer } from "./TweetComposer";

/** Props for the XActionsPanel component */
interface XActionsPanelProps {
  /** The account to perform actions on */
  account: DashboardXAccount;
  /** Callback to send a tweet */
  onTweet: (text: string) => Promise<void>;
  /** Callback to run a health check */
  onHealthCheck: () => Promise<void>;
  /** Callback to execute a warming step */
  onWarm: () => Promise<void>;
  /** Callback to fetch timeline data, returns array of tweet objects */
  onViewTimeline: () => Promise<Array<{ handle: string; text: string; timestamp: string }>>;
  /** Callback to fetch notifications */
  onViewNotifications: () => Promise<unknown[]>;
  /** GeeLark: login via cloud phone */
  onGeeLarkLogin?: (phoneId: string) => Promise<void>;
  /** GeeLark: post tweet via cloud phone */
  onGeeLarkTweet?: (phoneId: string, text: string) => Promise<void>;
  /** GeeLark: check account health via cloud phone */
  onGeeLarkHealth?: (phoneId: string) => Promise<void>;
  /** GeeLark: refresh cookies via cloud phone */
  onGeeLarkRefreshCookies?: (phoneId: string) => Promise<void>;
}

/** Configuration for an action button in the grid */
interface ActionButtonConfig {
  /** Unique identifier for the action */
  id: string;
  /** Display label for the button */
  label: string;
  /** Lucide icon component */
  icon: typeof HeartPulse;
  /** Handler invoked on click */
  action: () => Promise<void>;
}

/** Configuration for a GeeLark action button */
interface GeeLarkActionConfig {
  /** Unique identifier for the action */
  id: string;
  /** Display label for the button */
  label: string;
  /** Lucide icon component */
  icon: typeof LogIn;
  /** Handler invoked on click (receives phoneId) */
  action: (phoneId: string) => Promise<void>;
  /** Confirmation dialog message */
  confirmMessage: string;
}

/**
 * XActionsPanel renders the tweet composer, action button grid,
 * and GeeLark operations section for the selected X account.
 */
export function XActionsPanel({
  account,
  onTweet,
  onHealthCheck,
  onWarm,
  onViewTimeline,
  onViewNotifications,
  onGeeLarkLogin,
  onGeeLarkTweet,
  onGeeLarkHealth,
  onGeeLarkRefreshCookies,
}: XActionsPanelProps): JSX.Element {
  const { addToast } = useToast();
  const confirm = useConfirm();
  const { phones } = useGeeLarkPhones();

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<Array<{
    handle: string;
    text: string;
    timestamp: string;
  }> | null>(null);

  // GeeLark state
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);
  const [showGeeLarkTweetComposer, setShowGeeLarkTweetComposer] = useState(false);

  // Filter to running phones only (status 0 = Running)
  const runningPhones = phones.filter((p) => p.status === 0);
  const hasRunningPhones = runningPhones.length > 0;
  const effectivePhoneId = selectedPhoneId ?? runningPhones[0]?.id ?? null;

  /**
   * Executes an action with loading state management and toast feedback.
   * Only one action can run at a time.
   */
  async function executeAction(
    id: string,
    action: () => Promise<void>,
    successMsg: string,
  ): Promise<void> {
    if (loadingAction !== null) return;
    setLoadingAction(id);
    try {
      await action();
      addToast(successMsg, "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Operation failed";
      addToast(message, "error");
    } finally {
      setLoadingAction(null);
    }
  }

  /** Fetches timeline data and stores it in local state */
  async function handleViewTimeline(): Promise<void> {
    if (loadingAction !== null) return;
    setLoadingAction("timeline");
    try {
      const data = await onViewTimeline();
      setTimelineData(data);
      addToast("Timeline loaded", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load timeline";
      addToast(message, "error");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Executes a GeeLark action with billing confirmation dialog.
   * GeeLark operations incur ~$0.06/min billing, so we require explicit confirmation.
   */
  async function executeGeeLarkAction(
    id: string,
    action: (phoneId: string) => Promise<void>,
    confirmMessage: string,
    successMsg: string,
  ): Promise<void> {
    if (loadingAction !== null || effectivePhoneId === null) return;

    const confirmed = await confirm({
      title: "GeeLark Billing Confirmation",
      message: confirmMessage,
      confirmLabel: "Proceed",
      cancelLabel: "Cancel",
      variant: "default",
    });

    if (!confirmed) return;

    setLoadingAction(id);
    try {
      await action(effectivePhoneId);
      addToast(successMsg, "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "GeeLark operation failed";
      addToast(message, "error");
    } finally {
      setLoadingAction(null);
    }
  }

  /** Handles GeeLark tweet with billing confirmation */
  async function handleGeeLarkTweetSend(text: string): Promise<void> {
    if (effectivePhoneId === null || onGeeLarkTweet === undefined) return;

    await executeGeeLarkAction(
      "geelark_tweet",
      async (phoneId: string) => {
        await onGeeLarkTweet(phoneId, text);
      },
      `This will post a tweet via GeeLark cloud phone. Cloud phone usage is billed at ~$0.06/min. Proceed?`,
      `GeeLark tweet sent for @${account.handle}`,
    );
  }

  const actions: ActionButtonConfig[] = [
    {
      id: "health",
      label: "Check Health",
      icon: HeartPulse,
      action: () =>
        executeAction(
          "health",
          onHealthCheck,
          `Health check complete for @${account.handle}`,
        ),
    },
    {
      id: "warm",
      label: "Warm",
      icon: Flame,
      action: () =>
        executeAction(
          "warm",
          onWarm,
          `Warming step complete for @${account.handle}`,
        ),
    },
    {
      id: "timeline",
      label: "Timeline",
      icon: ScrollText,
      action: handleViewTimeline,
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      action: () =>
        executeAction(
          "notifications",
          async () => {
            await onViewNotifications();
          },
          `Notifications loaded for @${account.handle}`,
        ),
    },
  ];

  // GeeLark action configurations
  const geelarkActions: GeeLarkActionConfig[] = [
    ...(onGeeLarkLogin
      ? [
          {
            id: "geelark_login",
            label: "Login",
            icon: LogIn,
            action: onGeeLarkLogin,
            confirmMessage:
              "This will login to X via GeeLark cloud phone. Cloud phone usage is billed at ~$0.06/min. Proceed?",
          } as GeeLarkActionConfig,
        ]
      : []),
    ...(onGeeLarkTweet
      ? [
          {
            id: "geelark_tweet",
            label: "Tweet",
            icon: Send,
            action: onGeeLarkTweet as (phoneId: string) => Promise<void>,
            confirmMessage:
              "This will post a tweet via GeeLark cloud phone. Cloud phone usage is billed at ~$0.06/min. Proceed?",
          } as GeeLarkActionConfig,
        ]
      : []),
    ...(onGeeLarkHealth
      ? [
          {
            id: "geelark_health",
            label: "Deep Check",
            icon: ShieldCheck,
            action: onGeeLarkHealth,
            confirmMessage:
              "This will run a deep health check via GeeLark cloud phone. Cloud phone usage is billed at ~$0.06/min. Proceed?",
          } as GeeLarkActionConfig,
        ]
      : []),
    ...(onGeeLarkRefreshCookies
      ? [
          {
            id: "geelark_cookies",
            label: "Refresh Cookies",
            icon: Cookie,
            action: onGeeLarkRefreshCookies,
            confirmMessage:
              "This will refresh session cookies via GeeLark cloud phone. Cloud phone usage is billed at ~$0.06/min. Proceed?",
          } as GeeLarkActionConfig,
        ]
      : []),
  ];

  const hasGeeLarkActions = geelarkActions.length > 0;

  return (
    <div className="p-4 space-y-4">
      {/* Tweet Composer */}
      <TweetComposer handle={account.handle} onSend={onTweet} />

      {/* HTTP API Action Button Grid */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Operations
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((actionConfig) => {
            const Icon = actionConfig.icon;
            const isLoading = loadingAction === actionConfig.id;
            const isAnyLoading = loadingAction !== null;
            return (
              <button
                key={actionConfig.id}
                type="button"
                disabled={isAnyLoading}
                onClick={() => void actionConfig.action()}
                className={`h-9 px-3 text-xs rounded-md transition-colors border border-red-800 flex items-center justify-center gap-1.5 ${
                  isAnyLoading
                    ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
                    : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
                }`}
                aria-label={
                  isLoading
                    ? `${actionConfig.label} in progress`
                    : actionConfig.label
                }
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
                {actionConfig.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* GeeLark Operations Section */}
      {hasGeeLarkActions && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Smartphone className="w-3.5 h-3.5 text-amber-500" />
            <h3 className="text-xs text-amber-500 uppercase tracking-wide">
              GeeLark Operations
            </h3>
          </div>

          {/* No running phones message */}
          {!hasRunningPhones && (
            <p className="text-xs text-gray-500 mb-2">
              No running phones. Start a phone in the Phones tab first.
            </p>
          )}

          {/* Phone selector (when multiple running phones) */}
          {runningPhones.length > 1 && (
            <div className="relative mb-2">
              <label htmlFor="geelark-phone-select" className="sr-only">
                Select cloud phone
              </label>
              <select
                id="geelark-phone-select"
                value={effectivePhoneId ?? ""}
                onChange={(e) => setSelectedPhoneId(e.target.value || null)}
                className="w-full h-8 px-2 pr-8 text-xs bg-gray-900 border border-amber-800/50 rounded-md text-gray-300 appearance-none focus:outline-none focus:ring-1 focus:ring-amber-600"
              >
                {runningPhones.map((phone) => (
                  <option key={phone.id} value={phone.id}>
                    {phone.serialName || phone.serialNo}
                    {phone.associatedHandle ? ` (@${phone.associatedHandle})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            </div>
          )}

          {/* GeeLark action button grid (amber-themed) */}
          <div className="grid grid-cols-2 gap-2">
            {geelarkActions.map((actionConfig) => {
              const Icon = actionConfig.icon;
              const isLoading = loadingAction === actionConfig.id;
              const isAnyLoading = loadingAction !== null;
              const isDisabled = isAnyLoading || !hasRunningPhones;

              // Tweet button opens the GeeLark tweet composer instead of direct action
              const handleClick = (): void => {
                if (actionConfig.id === "geelark_tweet") {
                  setShowGeeLarkTweetComposer((prev) => !prev);
                  return;
                }
                void executeGeeLarkAction(
                  actionConfig.id,
                  actionConfig.action,
                  actionConfig.confirmMessage,
                  `${actionConfig.label} complete for @${account.handle}`,
                );
              };

              return (
                <button
                  key={actionConfig.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={handleClick}
                  className={`h-9 px-3 text-xs rounded-md transition-colors border flex items-center justify-center gap-1.5 ${
                    isDisabled
                      ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
                      : "border-amber-800 bg-transparent text-amber-400 hover:bg-amber-800 hover:text-gray-900"
                  }`}
                  aria-label={
                    isLoading
                      ? `${actionConfig.label} in progress`
                      : `GeeLark: ${actionConfig.label}`
                  }
                >
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  {actionConfig.label}
                </button>
              );
            })}
          </div>

          {/* GeeLark Tweet Composer (toggled by the Tweet button) */}
          {showGeeLarkTweetComposer && onGeeLarkTweet && hasRunningPhones && (
            <div className="mt-2">
              <TweetComposer
                handle={`${account.handle} (GeeLark)`}
                onSend={handleGeeLarkTweetSend}
              />
            </div>
          )}
        </div>
      )}

      {/* Timeline Data Display */}
      {timelineData !== null && (
        <div>
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            Timeline
          </h3>
          <div className="max-h-60 overflow-y-auto scrollbar-hide space-y-1">
            {timelineData.length === 0 ? (
              <p className="text-gray-500 text-xs">No tweets found</p>
            ) : (
              timelineData.map((tweet, i) => (
                <div
                  key={`${tweet.handle}-${tweet.timestamp}-${i}`}
                  className="border border-red-800/30 rounded p-2 bg-gray-900/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      @{tweet.handle}
                    </span>
                    <span className="text-xs text-gray-600">
                      {new Date(tweet.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mt-1">{tweet.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
