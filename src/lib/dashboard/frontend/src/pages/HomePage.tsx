/**
 * HomePage Component
 * Main dashboard with accounts, projects, config, and live logs
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import {
  AccountUsageWidget,
  AddAccountModal,
  AddExternalModelModal,
  ClaudeProxyTabbedWidget,
  LiveLogFeed,
  McpProxyWidget,
  ProjectListWidget,
} from "../components";
import type { ExternalModel } from "../components";
import { useToast } from "../contexts/ToastContext";
import { useCredentialUpdates } from "../hooks/useCredentialUpdates";
import { useWebSocket } from "../hooks/useWebSocket";

export function HomePage(): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);
  const [externalModelRefreshKey, setExternalModelRefreshKey] = useState(0);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAddExternalModelModal, setShowAddExternalModelModal] = useState(false);
  const [editingExternalModel, setEditingExternalModel] = useState<ExternalModel | undefined>(undefined);
  // Track account ID for re-authentication flow (when token refresh fails)
  const [reAuthAccountId, setReAuthAccountId] = useState<string | undefined>(undefined);
  const { connected, error, lastMessage } = useWebSocket();
  const { addToast, removeToast } = useToast();
  const wsErrorToastIdRef = useRef<string | null>(null);

  // React Router hooks for navigation monitoring
  const location = useLocation();
  const navigationType = useNavigationType();

  // Routing state coordination for mutual exclusivity
  const [agentRoutingEnabled, setAgentRoutingEnabled] = useState(false);
  const [modelRoutingEnabled, setModelRoutingEnabled] = useState(false);

  /**
   * Diagnostic: Detect unexpected navigation away from homepage
   * This helps identify if/when auto-redirect occurs and captures stack trace
   * for debugging. Can be removed once the redirect issue is resolved.
   */
  useEffect(() => {
    if (location.pathname !== "/") {
      // Log unexpected navigation for debugging
      console.error("[HomePage] Unexpected navigation detected:", {
        from: "/",
        to: location.pathname,
        navigationType,
        timestamp: new Date().toISOString(),
      });
      // Capture stack trace to identify caller
      console.trace("[HomePage] Navigation stack trace");
    }
  }, [location.pathname, navigationType]);

  // Handle credential updates from CLI sync
  const handleCredentialsRefresh = useCallback((): void => {
    setAccountRefreshKey((prev) => prev + 1);
  }, []);

  useCredentialUpdates({
    lastMessage,
    onAccountsUpdated: handleCredentialsRefresh,
  });

  // Simulate initial data loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Show persistent toast when WebSocket connection is lost (debounced to avoid spam)
  const wsDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected && error !== null) {
      // Delay showing the toast to avoid spam during brief reconnect cycles
      if (wsErrorToastIdRef.current === null && wsDisconnectTimerRef.current === null) {
        wsDisconnectTimerRef.current = setTimeout(() => {
          wsDisconnectTimerRef.current = null;
          // Re-check: only show if still disconnected
          if (wsErrorToastIdRef.current === null) {
            const toastId = addToast(
              "WebSocket connection lost. Attempting to reconnect...",
              "warning",
              { persistent: true }
            );
            wsErrorToastIdRef.current = toastId;
          }
        }, 3000);
      }
    } else if (connected) {
      // Cancel pending disconnect toast if we reconnected quickly
      if (wsDisconnectTimerRef.current !== null) {
        clearTimeout(wsDisconnectTimerRef.current);
        wsDisconnectTimerRef.current = null;
      }
      // Remove existing disconnect toast
      if (wsErrorToastIdRef.current !== null) {
        removeToast(wsErrorToastIdRef.current);
        wsErrorToastIdRef.current = null;
        addToast("WebSocket connection restored", "success");
      }
    }
  }, [connected, error, addToast, removeToast]);

  // Fetch initial routing state on mount
  useEffect(() => {
    async function fetchRoutingState(): Promise<void> {
      try {
        const response = await fetch("/api/claude-proxy/config");
        if (!response.ok) return;
        const data = (await response.json()) as {
          config: {
            agentRouting: { enabled: boolean };
            modelRouting: { enabled: boolean };
          };
        };
        setAgentRoutingEnabled(data.config.agentRouting.enabled);
        setModelRoutingEnabled(data.config.modelRouting.enabled);
      } catch {
        // Ignore errors on initial load
      }
    }
    void fetchRoutingState();
  }, []);

  /** Handler when agent routing is toggled - updates state and triggers mutual exclusivity */
  function handleAgentRoutingToggle(enabled: boolean): void {
    setAgentRoutingEnabled(enabled);
    if (enabled) {
      // Backend automatically disables model routing
      setModelRoutingEnabled(false);
    }
  }

  /** Handler when model routing is toggled - updates state and triggers mutual exclusivity */
  function handleModelRoutingToggle(enabled: boolean): void {
    setModelRoutingEnabled(enabled);
    if (enabled) {
      // Backend automatically disables agent routing
      setAgentRoutingEnabled(false);
    }
  }

  function handleAddAccount(): void {
    setShowAddAccountModal(true);
  }

  function handleAccountAdded(email?: string): void {
    addToast(
      `Account ${email ?? ""} successfully connected!`,
      "success"
    );
    setAccountRefreshKey((prev) => prev + 1);
  }

  function handleAccountError(errorMsg: string): void {
    addToast(errorMsg, "error");
  }

  async function handleSetActive(accountId: string): Promise<void> {
    try {
      const response = await fetch(`/api/accounts/${accountId}/activate`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      addToast("Account set as active", "success");
      setAccountRefreshKey((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to set active account";
      addToast(message, "error");
    }
  }

  async function handleRemove(accountId: string): Promise<void> {
    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 204) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      addToast("Account removed", "success");
      setAccountRefreshKey((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove account";
      addToast(message, "error");
    }
  }

  async function handleRefresh(accountId: string): Promise<void> {
    try {
      const response = await fetch(`/api/accounts/${accountId}/refresh`, {
        method: "POST",
      });

      if (!response.ok) {
        if (response.status === 401) {
          addToast("Token expired. Please re-authenticate.", "warning");
          // Set accountId for re-auth flow so modal can update existing account
          setReAuthAccountId(accountId);
          setShowAddAccountModal(true);
          return;
        }

        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      addToast("Token refreshed successfully", "success");
      setAccountRefreshKey((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh token";
      addToast(message, "error");
    }
  }

  async function handleTogglePin(accountId: string): Promise<void> {
    try {
      const response = await fetch(`/api/accounts/${accountId}/pin`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const data = await response.json() as { isPinned: boolean };
      addToast(data.isPinned ? "Account pinned" : "Account unpinned", "success");
      setAccountRefreshKey((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to toggle pin";
      addToast(message, "error");
    }
  }

  // External Model handlers
  function handleAddExternalModel(): void {
    setEditingExternalModel(undefined);
    setShowAddExternalModelModal(true);
  }

  function handleEditExternalModel(model: ExternalModel): void {
    setEditingExternalModel(model);
    setShowAddExternalModelModal(true);
  }

  function handleExternalModelSuccess(): void {
    addToast(
      editingExternalModel ? "External model updated" : "External model added",
      "success"
    );
    setExternalModelRefreshKey((prev) => prev + 1);
  }

  function handleExternalModelError(errorMsg: string): void {
    addToast(errorMsg, "error");
  }

  async function handleRemoveExternalModel(modelId: string): Promise<void> {
    try {
      const response = await fetch(`/api/external-models/${modelId}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 204) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      addToast("External model removed", "success");
      setExternalModelRefreshKey((prev) => prev + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove external model";
      addToast(message, "error");
    }
  }

  if (isLoading) {
    return (
      <div className="dashboard-layout">
        <div className="dashboard-loading">
          <div className="flex flex-col items-center justify-center">
            <div className="spinner w-8 h-8 mb-4" />
            <p className="text-gray-400">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Top row - accounts and logs side by side */}
      <section className="dashboard-row dashboard-row--top">
        <div className="grid grid-cols-1 lg:grid-cols-5 2xl:grid-cols-12 gap-3 h-full">
          <AccountUsageWidget
            key={accountRefreshKey}
            className="dashboard-widget-container lg:col-span-2 2xl:col-span-6"
            onAddAccount={handleAddAccount}
            onSetActive={(id: string) => void handleSetActive(id)}
            onRefresh={(id: string) => void handleRefresh(id)}
            onRemove={(id: string) => void handleRemove(id)}
            onTogglePin={(id: string) => void handleTogglePin(id)}
          />
          <LiveLogFeed className="dashboard-widget-container lg:col-span-3 2xl:col-span-6" />
        </div>
      </section>

      {/* Bottom row - 3-column grid */}
      <section className="dashboard-row dashboard-row--bottom">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-full">
          <McpProxyWidget
            className="dashboard-widget-container"
            onToastSuccess={(message: string) => addToast(message, "success")}
            onToastError={(message: string) => addToast(message, "error")}
          />
          <ProjectListWidget
            className="dashboard-widget-container"
            onToastSuccess={(message: string, projectName: string) => {
              addToast(message, "success", { projectName });
            }}
            onToastError={(message: string, projectName: string) => {
              addToast(message, "error", { projectName });
            }}
          />
          <ClaudeProxyTabbedWidget
            key={externalModelRefreshKey}
            className="dashboard-widget-container"
            onToastSuccess={(message: string) => addToast(message, "success")}
            onToastError={(message: string) => addToast(message, "error")}
            onAgentRoutingToggle={handleAgentRoutingToggle}
            agentRoutingEnabled={agentRoutingEnabled}
            onAddExternalModel={handleAddExternalModel}
            onEditExternalModel={handleEditExternalModel}
            onRemoveExternalModel={(id: string) => void handleRemoveExternalModel(id)}
          />
        </div>
      </section>

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={showAddAccountModal}
        onClose={() => {
          setShowAddAccountModal(false);
          setReAuthAccountId(undefined);
        }}
        onSuccess={handleAccountAdded}
        onError={handleAccountError}
        reAuthAccountId={reAuthAccountId}
      />

      {/* Add/Edit External Model Modal */}
      <AddExternalModelModal
        isOpen={showAddExternalModelModal}
        onClose={() => {
          setShowAddExternalModelModal(false);
          setEditingExternalModel(undefined);
        }}
        onSuccess={handleExternalModelSuccess}
        onError={handleExternalModelError}
        editModel={editingExternalModel}
      />
    </div>
  );
}
