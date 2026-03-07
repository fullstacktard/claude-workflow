/**
 * McpProxyWidget Component
 * Displays MCP Proxy container status and MCP servers list.
 * API keys are managed via environment variables in each server's edit modal.
 * Matches dashboard aesthetic with TerminalCard and row-based display.
 */

import { useCallback, useEffect, useState } from "react";

import { AddMcpServerModal, type McpServerConfig } from "./AddMcpServerModal";
import { TerminalCard } from "./TerminalCard";

/** MCP Proxy container status from API (HTTP health check based) */
interface McpProxyStatus {
  containerRunning: boolean;
  message: string;
  port: number;
}

interface McpProxyWidgetProps {
  className?: string;
  onToastSuccess?: (message: string) => void;
  onToastError?: (message: string) => void;
}

export function McpProxyWidget({
  className = "",
  onToastSuccess,
  onToastError,
}: McpProxyWidgetProps): JSX.Element {
  const [status, setStatus] = useState<McpProxyStatus | null>(null);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  /** Fetch container status via HTTP health check */
  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/mcpproxy/status");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as McpProxyStatus;
      setStatus(data);
    } catch (error) {
      console.error("[McpProxyWidget] Error fetching status:", error);
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Fetch MCP servers list */
  const fetchServers = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/mcpproxy/servers");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { servers: McpServerConfig[] };
      setServers(data.servers || []);
    } catch (error) {
      console.error("[McpProxyWidget] Error fetching servers:", error);
      setServers([]);
    }
  }, []);

  // Initial load and periodic refresh
  useEffect(() => {
    void fetchStatus();
    void fetchServers();

    // Refresh every 10 seconds
    const interval = setInterval(() => {
      void fetchStatus();
      void fetchServers();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchServers]);

  /** Rebuild and restart mcp-proxy container */
  async function handleRebuild(): Promise<void> {
    setIsRebuilding(true);
    try {
      const response = await fetch("/api/mcpproxy/rebuild", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      onToastSuccess?.("mcp-proxy rebuilt and restarted");
      // Refresh status after rebuild
      setTimeout(() => void fetchStatus(), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rebuild";
      onToastError?.(message);
      console.error("[McpProxyWidget] Error rebuilding:", error);
    } finally {
      setIsRebuilding(false);
    }
  }

  /** Reload mcp-proxy to pick up config changes */
  async function handleReload(): Promise<void> {
    setIsReloading(true);
    try {
      const response = await fetch("/api/mcpproxy/reload", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      onToastSuccess?.("mcp-proxy reloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reload";
      onToastError?.(message);
      console.error("[McpProxyWidget] Error reloading:", error);
    } finally {
      setIsReloading(false);
    }
  }

  /** Open add server modal */
  function handleAddServer(): void {
    setEditingServer(null);
    setIsAddModalOpen(true);
  }

  /** Open edit server modal */
  function handleEditServer(server: McpServerConfig): void {
    setEditingServer(server);
    setIsAddModalOpen(true);
  }

  /** Delete a server */
  async function handleDeleteServer(serverName: string): Promise<void> {
    if (!confirm(`Remove MCP server "${serverName}"? This will also reload the proxy.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/mcpproxy/servers/${serverName}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      onToastSuccess?.(`Server "${serverName}" removed`);
      await fetchServers();
      await handleReload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete server";
      onToastError?.(message);
      console.error("[McpProxyWidget] Error deleting server:", error);
    }
  }

  /** Close modal */
  function handleModalClose(): void {
    setIsAddModalOpen(false);
    setEditingServer(null);
  }

  /** Handle successful add/edit */
  async function handleModalSuccess(): Promise<void> {
    try {
      // Server CRUD endpoints auto-sync mcp-config.json, so just refresh the list
      await fetchServers();
      // Reload the proxy with new config
      await handleReload();
    } catch (error) {
      onToastError?.("Failed to apply changes. Please try reloading manually.");
      console.error("[McpProxyWidget] Error in handleModalSuccess:", error);
    }
  }

  const headerActions = (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        onClick={handleAddServer}
        className="h-7 px-2 sm:px-3 text-[10px] sm:text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
        type="button"
        title="Add a new MCP server"
      >
        <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">Add Server</span>
      </button>
      <button
        onClick={() => void handleRebuild()}
        disabled={isRebuilding}
        className={
          isRebuilding
            ? "h-7 px-2 sm:px-3 text-[10px] sm:text-xs bg-red-700 border-1 border-red-800 text-white rounded-md cursor-not-allowed opacity-70"
            : "h-7 px-2 sm:px-3 text-[10px] sm:text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
        }
        type="button"
        title="Rebuild and restart mcp-proxy Docker container"
      >
        {isRebuilding ? "..." : <><span className="sm:hidden">RB</span><span className="hidden sm:inline">Rebuild</span></>}
      </button>
    </div>
  );

  if (isLoading && !status) {
    return (
      <TerminalCard
        command="docker ps"
        filename="mcp-proxy"
        className={className}
        noPadding
      >
        <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50 flex flex-col flex-1 h-full animate-pulse overflow-hidden">
          {/* Section header skeleton */}
          <div className="px-4 py-2 bg-gray-900/50 shrink-0">
            <div className="h-3 w-28 bg-gray-800/35 rounded" />
          </div>
          {/* Server row skeletons */}
          {Array.from({ length: 25 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                <div className="h-4 bg-gray-800/50 rounded" style={{ width: `${80 + (i % 3) * 30}px` }} />
                <div className="h-3 bg-gray-800/35 rounded" style={{ width: `${120 + (i % 2) * 60}px` }} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-7 w-12 bg-gray-800/20 rounded-md" />
                <div className="h-7 w-14 bg-gray-800/20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </TerminalCard>
    );
  }

  return (
    <TerminalCard
      command="docker ps"
      filename="mcp-proxy"
      headerText="mcp-proxy"
      headerActions={headerActions}
      className={className}
      noPadding
    >
      <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50 flex flex-col flex-1 h-full">
        {/* Not reachable message */}
        {status && !status.containerRunning && (
          <div className="px-4 py-4 text-center">
            <p className="text-red-400 text-sm">{status.message}</p>
            <p className="text-gray-500 text-xs mt-2">
              docker compose up mcp-proxy
            </p>
          </div>
        )}

        {/* MCP Servers Section */}
        {servers.length > 0 ? (
          <>
            <div className="px-4 py-2 bg-gray-900/50">
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                MCP Servers ({servers.length})
              </span>
            </div>
            {servers.map((server) => (
              <div
                key={server.name}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-white font-medium">{server.name}</span>
                  <span className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                    {server.command} {(server.args || []).join(" ")}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleEditServer(server)}
                    className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
                    type="button"
                    title={`Edit ${server.name}`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDeleteServer(server.name)}
                    className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-red-400 rounded-md hover:bg-red-800 hover:text-red-300 transition-colors"
                    type="button"
                    title={`Delete ${server.name}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">No MCP servers configured</p>
          </div>
        )}


        {/* Reload indicator */}
        {isReloading && (
          <div className="px-4 py-2 bg-red-900/20 text-center">
            <span className="text-xs text-red-400">Reloading proxy configuration...</span>
          </div>
        )}
      </div>

      {/* Add/Edit Server Modal */}
      <AddMcpServerModal
        isOpen={isAddModalOpen}
        onClose={handleModalClose}
        onSuccess={() => void handleModalSuccess()}
        onError={(error) => onToastError?.(error)}
        editServer={editingServer ?? undefined}
      />
    </TerminalCard>
  );
}
