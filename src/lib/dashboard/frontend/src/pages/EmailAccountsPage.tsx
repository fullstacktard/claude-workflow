/**
 * EmailAccountsPage Component
 *
 * Master-detail layout for email account management.
 * Left panel (lg:col-span-4): EmailAccountList with search and selection
 * Right panel (lg:col-span-8): EmailContentPanel with Inbox/Detail/Settings tabs
 *
 * Layout: Responsive 12-column grid -- stacked on mobile, side-by-side on lg+.
 * Uses TerminalCard wrappers matching the dashboard terminal aesthetic.
 *
 * @module pages/EmailAccountsPage
 */

import { useState, useCallback } from "react";

import { useEmailAccounts } from "../hooks/useEmailAccounts";
import {
  EmailAccountList,
  EmailContentPanel,
  CreateEmailDialog,
} from "../components/email-accounts";
import type {
  EmailActivityAction,
  EmailActivityEntry,
} from "../types/email-accounts";

/**
 * EmailAccountsPage manages the master-detail layout and selection state.
 * The selected account ID is passed to both left panel (highlight) and
 * right panel (tabbed content with detail, inbox, and activity).
 */
export function EmailAccountsPage(): JSX.Element {
  const { accounts, loading, error, refetch } = useEmailAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [activityLog, setActivityLog] = useState<EmailActivityEntry[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ?? null;

  /** Append an entry to the activity log */
  const addActivity = useCallback(
    (action: string, success: boolean, details: string): void => {
      const entry: EmailActivityEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        action: action as EmailActivityAction,
        accountId: selectedAccountId ?? "",
        email: selectedAccount?.email ?? "",
        details,
        success,
      };
      setActivityLog((prev) => [...prev, entry]);
    },
    [selectedAccountId, selectedAccount],
  );

  /** Handle account deletion -- clear selection and refetch list */
  const handleAccountDeleted = useCallback((): void => {
    setSelectedAccountId(null);
    void refetch();
  }, [refetch]);

  /** Handle account creation -- refetch list to show new account */
  const handleAccountCreated = useCallback((): void => {
    void refetch();
  }, [refetch]);

  /** Handle health check completed -- refetch list for cache enrichment */
  const handleHealthChecked = useCallback((): void => {
    void refetch();
  }, [refetch]);

  return (
    <div className="flex h-full flex-col bg-gray-950 p-3 sm:p-6 gap-3 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left Panel: Account list */}
        <div className="lg:col-span-4 flex flex-col min-h-0">
          <EmailAccountList
            accounts={accounts}
            loading={loading}
            error={error}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
            onCreateClick={() => setShowCreateDialog(true)}
            className="flex-1 min-h-0"
          />
        </div>

        {/* Right Panel: Tabbed content */}
        <div className="lg:col-span-8 flex flex-col min-h-0">
          <EmailContentPanel
            selectedAccount={selectedAccount}
            activityLog={activityLog}
            onActivity={addActivity}
            onAccountDeleted={handleAccountDeleted}
            onHealthChecked={handleHealthChecked}
            className="flex-1 min-h-0"
          />
        </div>
      </div>

      {/* Create Account Dialog */}
      <CreateEmailDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={handleAccountCreated}
        onActivity={addActivity}
      />
    </div>
  );
}
