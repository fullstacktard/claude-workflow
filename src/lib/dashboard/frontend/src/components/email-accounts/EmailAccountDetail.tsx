/**
 * EmailAccountDetail Component
 *
 * Displays account metadata in terminal-style sections.
 * Password reveal: calls POST /api/email-accounts/:id/reveal-password,
 * shows password for 30s with Copy button, then auto-hides.
 *
 * Sections:
 * - Account (email, provider, domain, created)
 * - Personal (first name, last name, date of birth)
 * - Health (status, last checked)
 * - Password (reveal/copy/hide with 30s auto-hide timer)
 *
 * @module components/email-accounts/EmailAccountDetail
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Eye, EyeOff, Copy, Check, Loader2, ShieldCheck, ShieldX, ShieldQuestion } from "lucide-react";

import { useToast } from "../../contexts/ToastContext";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type {
  DashboardEmailAccount,
  EmailProvider,
} from "../../types/email-accounts";

/** Props for the EmailAccountDetail component */
interface EmailAccountDetailProps {
  /** Account to display metadata for */
  account: DashboardEmailAccount;
  /** Callback to log activity entries */
  onActivity: (action: string, success: boolean, details: string) => void;
  /** Callback after health check completes (to refresh list with cached status) */
  onHealthChecked?: () => void;
}

/** Human-readable provider labels */
const PROVIDER_LABELS: Record<EmailProvider, string> = {
  "mail.com": "Mail.com",
  "gmx.com": "GMX",
};

/** Duration to show revealed password before auto-hiding */
const PASSWORD_REVEAL_DURATION_MS = 30_000;

/**
 * Format a date_of_birth object { day, month, year } into a human-readable string.
 */
function formatDateOfBirth(dob: {
  day: number;
  month: number;
  year: number;
}): string {
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthLabel = monthNames[dob.month - 1] ?? String(dob.month);
  return `${monthLabel} ${dob.day}, ${dob.year}`;
}

/**
 * EmailAccountDetail renders the full detail view for a selected email account.
 * Includes password reveal functionality with 30-second auto-hide timer.
 */
export function EmailAccountDetail({
  account,
  onActivity,
  onHealthChecked,
}: EmailAccountDetailProps): JSX.Element {
  const { addToast } = useToast();
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-health-check state
  const [healthStatus, setHealthStatus] = useState<"unknown" | "checking" | "healthy" | "unhealthy">(
    account.health_status === "healthy" ? "healthy" :
    account.health_status === "unhealthy" ? "unhealthy" : "unknown"
  );
  const [healthError, setHealthError] = useState<string | null>(null);
  const healthCheckedRef = useRef<Set<string>>(new Set());

  // Stable refs for callbacks to avoid effect re-triggers
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onHealthCheckedRef = useRef(onHealthChecked);
  onHealthCheckedRef.current = onHealthChecked;

  // Auto-trigger health check when account is selected and status is unknown
  useEffect(() => {
    if (healthCheckedRef.current.has(account.id)) return;
    if (account.health_status === "healthy" || account.health_status === "unhealthy") {
      setHealthStatus(account.health_status);
      return;
    }

    healthCheckedRef.current.add(account.id);
    setHealthStatus("checking");
    setHealthError(null);

    const controller = new AbortController();
    void (async () => {
      try {
        const res = await dashboardFetch(
          `/api/email-accounts/${account.id}/health`,
          { method: "POST", signal: controller.signal, timeoutMs: 30_000 },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setHealthStatus("unhealthy");
          setHealthError("Health check request failed");
          onHealthCheckedRef.current?.();
          return;
        }
        const data = (await res.json()) as { email: string; healthy: boolean; error?: string };
        setHealthStatus(data.healthy ? "healthy" : "unhealthy");
        setHealthError(data.error ?? null);
        onActivityRef.current("health_check", data.healthy, data.error ?? `${account.email}: ${data.healthy ? "healthy" : "unhealthy"}`);
        onHealthCheckedRef.current?.();
      } catch {
        if (!controller.signal.aborted) {
          setHealthStatus("unhealthy");
          setHealthError("Health check timed out");
          onHealthCheckedRef.current?.();
        }
      }
    })();

    return () => controller.abort();
  }, [account.id, account.health_status, account.email]);

  // Reset health state when account changes
  useEffect(() => {
    setHealthStatus(
      account.health_status === "healthy" ? "healthy" :
      account.health_status === "unhealthy" ? "unhealthy" : "unknown"
    );
    setHealthError(null);
  }, [account.id, account.health_status]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Reset revealed password when account changes
  useEffect(() => {
    setRevealedPassword(null);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, [account.id]);

  /** Reveal password via API call with auto-hide timer */
  const handleRevealPassword = useCallback(async (): Promise<void> => {
    if (isRevealing) return;
    setIsRevealing(true);
    try {
      const response = await dashboardFetch(
        `/api/email-accounts/${account.id}/reveal-password`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to reveal password");
      }
      const data = (await response.json()) as { password: string };
      setRevealedPassword(data.password);
      onActivity(
        "details_viewed",
        true,
        `Password revealed for ${account.email}`,
      );

      // Auto-hide after 30 seconds
      hideTimerRef.current = setTimeout(() => {
        setRevealedPassword(null);
      }, PASSWORD_REVEAL_DURATION_MS);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Failed to reveal password";
      addToast(msg, "error");
      onActivity("details_viewed", false, msg);
    } finally {
      setIsRevealing(false);
    }
  }, [account.id, account.email, isRevealing, addToast, onActivity]);

  /** Manually hide the revealed password */
  const handleHidePassword = useCallback((): void => {
    setRevealedPassword(null);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  /** Copy revealed password to clipboard */
  const handleCopyPassword = useCallback(async (): Promise<void> => {
    if (!revealedPassword) return;
    try {
      await navigator.clipboard.writeText(revealedPassword);
      setPasswordCopied(true);
      addToast("Password copied", "success");
      setTimeout(() => setPasswordCopied(false), 2000);
    } catch {
      addToast("Failed to copy password", "error");
    }
  }, [revealedPassword, addToast]);

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Account Info */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">
          Account
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">Email</span>
            <p className="text-white font-medium truncate">{account.email}</p>
          </div>
          <div>
            <span className="text-gray-500">Provider</span>
            <p className="text-gray-300">
              {PROVIDER_LABELS[account.provider]}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Domain</span>
            <p className="text-gray-300">{account.domain}</p>
          </div>
          <div>
            <span className="text-gray-500">Created</span>
            <p className="text-gray-300">
              {new Date(account.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </section>

      {/* Personal Info */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">
          Personal
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">First Name</span>
            <p className="text-gray-300">{account.first_name || "N/A"}</p>
          </div>
          <div>
            <span className="text-gray-500">Last Name</span>
            <p className="text-gray-300">{account.last_name || "N/A"}</p>
          </div>
          <div className="col-span-2">
            <span className="text-gray-500">Date of Birth</span>
            <p className="text-gray-300">
              {account.date_of_birth
                ? formatDateOfBirth(account.date_of_birth)
                : "N/A"}
            </p>
          </div>
        </div>
      </section>

      {/* Health */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">
          Health
        </h3>
        <div className="flex items-center gap-2">
          {healthStatus === "checking" && (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              <span className="text-gray-400 text-xs">Checking health...</span>
            </>
          )}
          {healthStatus === "healthy" && (
            <>
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span className="text-green-400 text-xs font-medium">Healthy</span>
            </>
          )}
          {healthStatus === "unhealthy" && (
            <>
              <ShieldX className="w-4 h-4 text-red-400" />
              <span className="text-red-400 text-xs font-medium">Unhealthy</span>
              {healthError && (
                <span className="text-gray-500 text-xs truncate max-w-xs" title={healthError}>
                  — {healthError.length > 60 ? healthError.slice(0, 60) + "..." : healthError}
                </span>
              )}
            </>
          )}
          {healthStatus === "unknown" && (
            <>
              <ShieldQuestion className="w-4 h-4 text-gray-500" />
              <span className="text-gray-500 text-xs">Not checked</span>
            </>
          )}
        </div>
      </section>

      {/* Password */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">
          Password
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 font-mono text-xs flex-1 truncate">
            {revealedPassword ?? "**********"}
          </span>
          {revealedPassword ? (
            <>
              <button
                type="button"
                onClick={() => void handleCopyPassword()}
                className="h-7 px-2 text-xs rounded-md border border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors flex items-center gap-1"
                aria-label="Copy password"
              >
                {passwordCopied ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                Copy
              </button>
              <button
                type="button"
                onClick={handleHidePassword}
                className="h-7 px-2 text-xs rounded-md border border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors flex items-center gap-1"
                aria-label="Hide password"
              >
                <EyeOff className="w-3 h-3" />
                Hide
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleRevealPassword()}
              disabled={isRevealing}
              className="h-7 px-2 text-xs rounded-md border border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Reveal password"
            >
              {isRevealing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              Reveal
            </button>
          )}
        </div>
      </section>

      {/* Notes */}
      {account.notes && (
        <section className="space-y-2">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide">
            Notes
          </h3>
          <p className="text-gray-300 text-xs">{account.notes}</p>
        </section>
      )}
    </div>
  );
}
