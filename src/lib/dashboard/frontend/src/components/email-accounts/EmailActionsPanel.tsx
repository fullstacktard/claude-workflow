/**
 * EmailActionsPanel Component
 *
 * Action buttons for the selected email account:
 * - Check Health (HeartPulse icon) -> POST /api/email-accounts/:id/health
 * - Delete Account (Trash2 icon) -> DELETE /api/email-accounts/:id with confirmation
 *
 * @module components/email-accounts/EmailActionsPanel
 */

import { useState, useCallback } from "react";
import { HeartPulse, Trash2, Loader2 } from "lucide-react";

import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmationContext";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type { DashboardEmailAccount } from "../../types/email-accounts";

/** Props for the EmailActionsPanel component */
interface EmailActionsPanelProps {
  /** Account to perform actions on */
  account: DashboardEmailAccount;
  /** Callback to log activity entries */
  onActivity: (action: string, success: boolean, details: string) => void;
  /** Callback after successful account deletion */
  onDeleted: () => void;
}

/**
 * EmailActionsPanel renders health check and delete actions for the selected
 * email account. Uses ConfirmationContext for destructive delete confirmation.
 */
export function EmailActionsPanel({
  account,
  onActivity,
  onDeleted,
}: EmailActionsPanelProps): JSX.Element {
  const { addToast } = useToast();
  const confirm = useConfirm();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [lastHealthResult, setLastHealthResult] = useState<string | null>(null);

  /** Check account health via POST API call */
  const handleHealthCheck = useCallback(async (): Promise<void> => {
    if (loadingAction !== null) return;
    setLoadingAction("health");
    try {
      const response = await dashboardFetch(
        `/api/email-accounts/${account.id}/health`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Health check failed");
      }
      const data = (await response.json()) as { status: string };
      setLastHealthResult(data.status);
      addToast(`Health check: ${data.status}`, "success");
      onActivity("health_checked", true, `Health: ${data.status}`);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Health check failed";
      setLastHealthResult("error");
      addToast(msg, "error");
      onActivity("health_checked", false, msg);
    } finally {
      setLoadingAction(null);
    }
  }, [account.id, loadingAction, addToast, onActivity]);

  /** Delete account with confirmation dialog */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (loadingAction !== null) return;

    const confirmed = await confirm({
      title: "Delete Email Account",
      message: `This will remove ${account.email} from the vault. The actual email account at the provider will NOT be deleted. This action cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "destructive",
    });

    if (!confirmed) return;

    setLoadingAction("delete");
    try {
      const response = await dashboardFetch(
        `/api/email-accounts/${account.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Delete failed");
      }
      addToast(`${account.email} removed from vault`, "success");
      onActivity("account_deleted", true, `Deleted ${account.email}`);
      onDeleted();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Delete failed";
      addToast(msg, "error");
      onActivity("account_deleted", false, msg);
    } finally {
      setLoadingAction(null);
    }
  }, [
    account.id,
    account.email,
    loadingAction,
    confirm,
    addToast,
    onActivity,
    onDeleted,
  ]);

  const isAnyLoading = loadingAction !== null;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Operations
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {/* Health Check */}
          <button
            type="button"
            disabled={isAnyLoading}
            onClick={() => void handleHealthCheck()}
            className={`h-9 px-3 text-xs rounded-md transition-colors border border-red-800 flex items-center justify-center gap-1.5 ${
              isAnyLoading
                ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
                : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
            }`}
            aria-label={
              loadingAction === "health"
                ? "Health check in progress"
                : "Check Health"
            }
          >
            {loadingAction === "health" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <HeartPulse className="w-3.5 h-3.5" />
            )}
            Check Health
          </button>

          {/* Delete Account */}
          <button
            type="button"
            disabled={isAnyLoading}
            onClick={() => void handleDelete()}
            className={`h-9 px-3 text-xs rounded-md transition-colors border flex items-center justify-center gap-1.5 ${
              isAnyLoading
                ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
                : "border-red-800 bg-transparent text-red-400 hover:bg-red-800 hover:text-white"
            }`}
            aria-label={
              loadingAction === "delete"
                ? "Deleting account"
                : "Delete Account"
            }
          >
            {loadingAction === "delete" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Delete
          </button>
        </div>
      </div>

      {/* Last health check result */}
      {lastHealthResult && (
        <div className="text-xs text-gray-500">
          Last result:{" "}
          <span
            className={
              lastHealthResult === "error" ? "text-red-400" : "text-green-400"
            }
          >
            {lastHealthResult}
          </span>
        </div>
      )}
    </div>
  );
}
