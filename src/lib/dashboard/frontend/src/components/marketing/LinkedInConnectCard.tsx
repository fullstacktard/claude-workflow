/**
 * LinkedInConnectCard Component
 *
 * Displays LinkedIn connection status with connect/disconnect actions.
 * Shows profile info (name, email, picture, token expiry) when connected,
 * loading skeleton during fetch, and connect button when disconnected.
 *
 * Follows TerminalCard aesthetic from x-accounts/ components.
 *
 * @module components/marketing/LinkedInConnectCard
 */

import { useState } from "react";
import { Linkedin, LogOut, ExternalLink, AlertTriangle } from "lucide-react";

import type { UseLinkedInStatusResult } from "../../hooks/useLinkedInStatus";
import { TOKEN_STATUS_COLORS, TOKEN_STATUS_LABELS } from "../../types/marketing";
import type { LinkedInTokenStatus } from "../../types/marketing";

interface LinkedInConnectCardProps {
  linkedIn: UseLinkedInStatusResult;
}

/**
 * Format an ISO date string to a human-readable date.
 */
function formatExpiryDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function LinkedInConnectCard({ linkedIn }: LinkedInConnectCardProps): JSX.Element {
  const { connection, loading, error, startOAuth, disconnect, refetch } = linkedIn;
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConnect = async (): Promise<void> => {
    setIsConnecting(true);
    try {
      const url = await startOAuth();
      if (url) {
        window.open(url, "_blank", "width=600,height=700");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnect();
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-gray-500" />
          <span className="text-sm text-gray-400">Checking LinkedIn connection...</span>
        </div>
        <div className="mt-4 space-y-3">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-800" />
          <div className="h-3 w-32 animate-pulse rounded bg-gray-800" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-red-800/50 bg-red-900/20 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <p className="text-sm text-red-400">Failed to load LinkedIn status</p>
          </div>
          <p className="mt-1 text-xs text-gray-500">{error.message}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 h-7 rounded-md border border-red-800 px-3 text-xs text-gray-400 transition-colors hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isConnected = connection?.connected ?? false;
  const account = connection?.account;
  const tokenStatus: LinkedInTokenStatus = connection?.tokenStatus ?? "no_token";
  const statusColor = TOKEN_STATUS_COLORS[tokenStatus];
  const statusLabel = TOKEN_STATUS_LABELS[tokenStatus];

  return (
    <div className="p-4">
      {/* Status header with action button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
          <div>
            <div className="flex items-center gap-2">
              <Linkedin className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-100">LinkedIn</h3>
            </div>
            <p className="text-xs text-gray-400">{statusLabel}</p>
          </div>
        </div>

        {isConnected ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={isDisconnecting}
            className="flex h-7 items-center gap-1.5 rounded-md border border-red-600 px-3 text-xs text-red-400 transition-colors hover:bg-red-900/30 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label="Disconnect LinkedIn account"
          >
            <LogOut className="h-3 w-3" />
            {isDisconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={isConnecting}
            className="flex h-7 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs text-white transition-colors hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label="Connect LinkedIn account"
          >
            <ExternalLink className="h-3 w-3" />
            {isConnecting ? "Connecting..." : "Connect LinkedIn"}
          </button>
        )}
      </div>

      {/* Token expiry warning */}
      {tokenStatus === "expiring_soon" && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-yellow-800/50 bg-yellow-900/20 p-2">
          <AlertTriangle className="h-3 w-3 text-yellow-400" />
          <span className="text-xs text-yellow-400">
            Your LinkedIn token is expiring soon. Reconnect to refresh.
          </span>
        </div>
      )}

      {tokenStatus === "expired" && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-red-800/50 bg-red-900/20 p-2">
          <AlertTriangle className="h-3 w-3 text-red-400" />
          <span className="text-xs text-red-400">
            Your LinkedIn token has expired. Reconnect to continue posting.
          </span>
        </div>
      )}

      {/* Connected profile details */}
      {isConnected && account && (
        <div className="mt-3 flex items-center gap-3 border-t border-gray-800 pt-3">
          {account.picture ? (
            <img
              src={account.picture}
              alt={`${account.name} profile picture`}
              className="h-10 w-10 rounded-full"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900 text-sm font-bold text-blue-300">
              {account.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-200">{account.name}</p>
            <p className="truncate text-xs text-gray-500">{account.email}</p>
            <p className="text-xs text-gray-600">
              Token expires: {formatExpiryDate(account.accessTokenExpiresAt)}
            </p>
          </div>
        </div>
      )}

      {/* Empty state when not connected */}
      {!isConnected && (
        <div className="mt-4 flex flex-col items-center py-6">
          <Linkedin className="mb-2 h-8 w-8 text-gray-600" />
          <p className="text-sm text-gray-500">No LinkedIn account connected</p>
          <p className="mt-1 text-xs text-gray-600">
            Connect your LinkedIn to publish content directly
          </p>
        </div>
      )}
    </div>
  );
}
