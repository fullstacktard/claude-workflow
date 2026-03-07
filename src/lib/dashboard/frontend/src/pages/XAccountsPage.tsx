/**
 * XAccountsPage Component
 *
 * Master-detail layout for X/Twitter account management.
 * Left panel (lg:col-span-4): XAccountList with search and selection
 * Right panel (lg:col-span-8): XContentPanel with Detail/Actions/Activity/Phones tabs
 *
 * Layout: Responsive 12-column grid -- stacked on mobile, side-by-side on lg+.
 * Uses TerminalCard wrappers matching the dashboard terminal aesthetic.
 *
 * API callbacks for the content panel use dashboardFetch to call the
 * REST endpoints defined in routes/x-accounts.ts:
 * - POST /api/x-accounts/:id/tweet
 * - POST /api/x-accounts/:id/warm
 * - GET  /api/x-accounts/:id/timeline
 * - GET  /api/x-accounts/:id/notifications
 *
 * @module pages/XAccountsPage
 */

import { useCallback, useState } from "react";

import { useXAccounts } from "../hooks/useXAccounts";
import { XAccountList, XContentPanel } from "../components/x-accounts";
import { dashboardFetch } from "../utils/dashboard-fetch";
import type { XActivityAction, XActivityEntry, GeeLarkJob } from "../types/x-accounts";

/**
 * XAccountsPage manages the master-detail layout and selection state.
 * The selected account ID is passed to both left panel (highlight) and
 * right panel (tabbed content with detail, actions, activity, and phones).
 */
export function XAccountsPage(): JSX.Element {
  const { accounts, loading, error } = useXAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<XActivityEntry[]>([]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  /** Append an entry to the activity log */
  function addActivity(
    action: XActivityAction,
    status: XActivityEntry["status"],
    message: string,
  ): void {
    if (selectedAccount === null) return;
    const entry: XActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accountId: selectedAccount.id,
      handle: selectedAccount.handle,
      action,
      status,
      message,
      timestamp: new Date().toISOString(),
    };
    setActivityLog((prev) => [...prev, entry]);
  }

  /** POST /api/x-accounts/:id/tweet */
  const handleTweet = useCallback(
    async (text: string): Promise<void> => {
      if (selectedAccount === null) return;
      addActivity("tweet", "pending", "Sending tweet...");
      const response = await dashboardFetch(
        `/api/x-accounts/${selectedAccount.id}/tweet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        addActivity("tweet", "error", body.message ?? "Tweet failed");
        throw new Error(body.message ?? "Failed to send tweet");
      }
      addActivity("tweet", "success", `Tweet sent: "${text.slice(0, 50)}..."`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAccount],
  );

  /** POST /api/x-accounts/:id/warm */
  const handleWarm = useCallback(async (): Promise<void> => {
    if (selectedAccount === null) return;
    addActivity("warming_step", "pending", "Running warming step...");
    const response = await dashboardFetch(
      `/api/x-accounts/${selectedAccount.id}/warm`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      addActivity("warming_step", "error", body.message ?? "Warming failed");
      throw new Error(body.message ?? "Warming step failed");
    }
    addActivity("warming_step", "success", "Warming step complete");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  /** Health check -- no dedicated endpoint yet, uses a placeholder */
  const handleHealthCheck = useCallback(async (): Promise<void> => {
    if (selectedAccount === null) return;
    addActivity("health_check", "pending", "Checking account health...");
    // No dedicated health check REST endpoint in routes/x-accounts.ts yet.
    // Fire a timeline fetch as a lightweight connectivity check.
    const response = await dashboardFetch(
      `/api/x-accounts/${selectedAccount.id}/timeline?count=1`,
    );
    if (!response.ok) {
      addActivity("health_check", "error", "Health check failed");
      throw new Error("Health check failed -- account may be suspended or cookies expired");
    }
    addActivity("health_check", "success", "Account is healthy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  /** GET /api/x-accounts/:id/timeline */
  const handleViewTimeline = useCallback(async (): Promise<
    Array<{ handle: string; text: string; timestamp: string }>
  > => {
    if (selectedAccount === null) return [];
    addActivity("timeline", "pending", "Loading timeline...");
    const response = await dashboardFetch(
      `/api/x-accounts/${selectedAccount.id}/timeline`,
    );
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      addActivity("timeline", "error", body.message ?? "Timeline fetch failed");
      throw new Error(body.message ?? "Failed to load timeline");
    }
    const data = (await response.json()) as Array<{
      handle: string;
      text: string;
      timestamp: string;
    }>;
    addActivity("timeline", "success", `Loaded ${data.length} tweets`);
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  /** GET /api/x-accounts/:id/notifications */
  const handleViewNotifications = useCallback(async (): Promise<unknown[]> => {
    if (selectedAccount === null) return [];
    addActivity("notifications", "pending", "Loading notifications...");
    const response = await dashboardFetch(
      `/api/x-accounts/${selectedAccount.id}/notifications`,
    );
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      addActivity("notifications", "error", body.message ?? "Notifications fetch failed");
      throw new Error(body.message ?? "Failed to load notifications");
    }
    const data = (await response.json()) as unknown[];
    addActivity("notifications", "success", `Loaded ${data.length} notifications`);
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  /** POST /api/geelark/accounts/:id/login */
  const handleGeeLarkLogin = useCallback(
    async (phoneId: string): Promise<void> => {
      if (selectedAccount === null) return;
      addActivity("geelark_login", "pending", "Logging in via GeeLark...");
      const response = await dashboardFetch(
        `/api/geelark/accounts/${selectedAccount.id}/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_id: phoneId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        addActivity("geelark_login", "error", body.message ?? "GeeLark login failed");
        throw new Error(body.message ?? "Failed to start GeeLark login");
      }
      const job = (await response.json()) as GeeLarkJob;
      addActivity("geelark_login", "success", `Login job started (${job.id.slice(0, 8)})`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAccount],
  );

  /** POST /api/geelark/accounts/:id/tweet */
  const handleGeeLarkTweet = useCallback(
    async (phoneId: string, text: string): Promise<void> => {
      if (selectedAccount === null) return;
      addActivity("geelark_tweet", "pending", "Posting tweet via GeeLark...");
      const response = await dashboardFetch(
        `/api/geelark/accounts/${selectedAccount.id}/tweet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_id: phoneId, text }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        addActivity("geelark_tweet", "error", body.message ?? "GeeLark tweet failed");
        throw new Error(body.message ?? "Failed to post tweet via GeeLark");
      }
      const job = (await response.json()) as GeeLarkJob;
      addActivity("geelark_tweet", "success", `Tweet job started (${job.id.slice(0, 8)})`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAccount],
  );

  /** POST /api/geelark/accounts/:id/health */
  const handleGeeLarkHealth = useCallback(
    async (phoneId: string): Promise<void> => {
      if (selectedAccount === null) return;
      addActivity("geelark_health", "pending", "Running deep health check via GeeLark...");
      const response = await dashboardFetch(
        `/api/geelark/accounts/${selectedAccount.id}/health`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_id: phoneId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        addActivity("geelark_health", "error", body.message ?? "GeeLark health check failed");
        throw new Error(body.message ?? "Failed to start GeeLark health check");
      }
      const job = (await response.json()) as GeeLarkJob;
      addActivity("geelark_health", "success", `Health check job started (${job.id.slice(0, 8)})`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAccount],
  );

  /** POST /api/geelark/accounts/:id/refresh-cookies */
  const handleGeeLarkRefreshCookies = useCallback(
    async (phoneId: string): Promise<void> => {
      if (selectedAccount === null) return;
      addActivity("geelark_cookie_refresh", "pending", "Refreshing cookies via GeeLark...");
      const response = await dashboardFetch(
        `/api/geelark/accounts/${selectedAccount.id}/refresh-cookies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_id: phoneId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        addActivity("geelark_cookie_refresh", "error", body.message ?? "Cookie refresh failed");
        throw new Error(body.message ?? "Failed to refresh cookies via GeeLark");
      }
      addActivity("geelark_cookie_refresh", "success", "Cookies refreshed successfully");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAccount],
  );

  return (
    <div className="flex h-full flex-col bg-gray-950 p-3 sm:p-6 gap-3 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left Panel: Account list */}
        <div className="lg:col-span-4 flex flex-col min-h-0">
          <XAccountList
            accounts={accounts}
            loading={loading}
            error={error}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
            className="flex-1 min-h-0"
          />
        </div>

        {/* Right Panel: Tabbed content */}
        <div className="lg:col-span-8 flex flex-col min-h-0">
          <XContentPanel
            selectedAccount={selectedAccount}
            activityLog={activityLog}
            onTweet={handleTweet}
            onHealthCheck={handleHealthCheck}
            onWarm={handleWarm}
            onViewTimeline={handleViewTimeline}
            onViewNotifications={handleViewNotifications}
            onGeeLarkLogin={handleGeeLarkLogin}
            onGeeLarkTweet={handleGeeLarkTweet}
            onGeeLarkHealth={handleGeeLarkHealth}
            onGeeLarkRefreshCookies={handleGeeLarkRefreshCookies}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    </div>
  );
}
