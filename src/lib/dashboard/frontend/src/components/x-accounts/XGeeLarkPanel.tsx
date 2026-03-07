/**
 * XGeeLarkPanel - Main GeeLark cloud phone management panel.
 *
 * Composes the PhoneFleetTable (left/main) and JobQueuePanel (right/side)
 * into a single TerminalCard. Provides billing confirmation dialog for
 * launching phones and creating accounts. Handles screenshot capture
 * with blob URL caching and cleanup.
 *
 * Layout:
 * - Mobile: stacked vertically (fleet table on top, job queue below)
 * - Desktop: 60/40 split with vertical divider
 */
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../../contexts/ToastContext";
import { useGeeLarkJobs } from "../../hooks/useGeeLarkJobs";
import { useGeeLarkPhones } from "../../hooks/useGeeLarkPhones";
import type { GeeLarkJob } from "../../types/x-accounts";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import { TerminalCard } from "../TerminalCard";
import { JobQueuePanel } from "./JobQueuePanel";
import { PhoneFleetTable } from "./PhoneFleetTable";

/* ============================================
 * Billing Confirmation Dialog
 * ============================================ */

interface BillingConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  action: "launch" | "create";
}

function BillingConfirmDialog({
  open,
  onConfirm,
  onCancel,
  action,
}: BillingConfirmDialogProps): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus the cancel button when dialog opens (safer default)
    cancelRef.current?.focus();

    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        className="relative mx-4 w-full max-w-md rounded-lg border border-red-800 bg-gray-950 p-6 shadow-xl"
        role="alertdialog"
        aria-labelledby="billing-dialog-title"
        aria-describedby="billing-dialog-desc"
      >
        <h3
          id="billing-dialog-title"
          className="mb-3 text-lg font-semibold text-white"
        >
          {action === "launch" ? "Launch Cloud Phone" : "Create X Account"}
        </h3>
        <div
          id="billing-dialog-desc"
          className="mb-6 space-y-2 text-sm text-gray-400"
        >
          <p>
            This will start billing at approximately{" "}
            <span className="font-medium text-white">
              $0.06/min ($3.60/hr)
            </span>
            .
          </p>
          {action === "create" && (
            <p>
              Account creation typically takes 3-5 minutes{" "}
              <span className="text-gray-500">
                (~$0.18-$0.30 per attempt)
              </span>
              . Phone will be stopped automatically after creation completes.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-700 bg-transparent px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            {action === "launch"
              ? "Launch & Start Billing"
              : "Create & Start Billing"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================
 * XGeeLarkPanel Component
 * ============================================ */

export function XGeeLarkPanel(): JSX.Element {
  const { addToast } = useToast();
  const {
    phones,
    loading: phonesLoading,
    error: phonesError,
    refresh: refreshPhones,
  } = useGeeLarkPhones();
  const { jobs, addJob, removeJob } = useGeeLarkJobs();

  // Dialog state
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingAction, setBillingAction] = useState<"launch" | "create">(
    "launch"
  );
  const [pendingPhoneId, setPendingPhoneId] = useState<string | null>(null);

  // Action loading state (tracks which phone IDs have pending actions)
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());

  // Screenshot state
  const [screenshots, setScreenshots] = useState<Map<string, string>>(
    new Map()
  );
  const screenshotsRef = useRef(screenshots);
  screenshotsRef.current = screenshots;

  // ---- Action Helpers ----

  /** Add a phone ID to the loading set */
  const addLoading = useCallback((phoneId: string): void => {
    setLoadingActions((prev) => new Set(prev).add(phoneId));
  }, []);

  /** Remove a phone ID from the loading set */
  const removeLoading = useCallback((phoneId: string): void => {
    setLoadingActions((prev) => {
      const next = new Set(prev);
      next.delete(phoneId);
      return next;
    });
  }, []);

  // ---- Phone Actions ----

  /** Start a stopped phone (called after billing confirmation) */
  const handleStart = useCallback(
    async (phoneId: string): Promise<void> => {
      addLoading(phoneId);
      try {
        const res = await dashboardFetch("/api/geelark/phones/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_id: phoneId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        addToast("Phone starting...", "success");
        void refreshPhones();
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to start phone",
          "error"
        );
      } finally {
        removeLoading(phoneId);
      }
    },
    [addLoading, removeLoading, addToast, refreshPhones]
  );

  /** Stop a running phone */
  const handleStop = useCallback(
    async (phoneId: string): Promise<void> => {
      addLoading(phoneId);
      try {
        const res = await dashboardFetch(`/api/geelark/phones/${phoneId}/stop`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        addToast("Phone stopping...", "success");
        void refreshPhones();
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to stop phone",
          "error"
        );
      } finally {
        removeLoading(phoneId);
      }
    },
    [addLoading, removeLoading, addToast, refreshPhones]
  );

  /** Destroy a stopped/expired phone */
  const handleDestroy = useCallback(
    async (phoneId: string): Promise<void> => {
      addLoading(phoneId);
      try {
        const res = await dashboardFetch(`/api/geelark/phones/${phoneId}/destroy`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        addToast("Phone destroyed", "success");
        void refreshPhones();
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to destroy phone",
          "error"
        );
      } finally {
        removeLoading(phoneId);
      }
    },
    [addLoading, removeLoading, addToast, refreshPhones]
  );

  // ---- Screenshot ----

  /** Capture a screenshot: request -> poll -> fetch blob -> cache */
  const handleScreenshot = useCallback(
    async (phoneId: string): Promise<void> => {
      addLoading(phoneId);
      try {
        // Step 1: Request screenshot (returns taskId)
        const initRes = await dashboardFetch(
          `/api/geelark/phones/${phoneId}/screenshot`,
          { method: "POST", timeoutMs: 30_000 }
        );
        if (!initRes.ok) throw new Error(`Screenshot request failed: ${initRes.status}`);
        const { taskId } = (await initRes.json()) as { taskId: string };

        // Step 2: Poll for completion (max 30s, every 2s)
        let downloadLink: string | undefined;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const pollRes = await dashboardFetch(
            `/api/geelark/screenshots/${taskId}`,
            { skipErrorEvents: true }
          );
          if (!pollRes.ok) continue;
          const result = (await pollRes.json()) as {
            status: number;
            downloadLink?: string;
          };
          if (result.status === 2 && result.downloadLink) {
            downloadLink = result.downloadLink;
            break;
          }
          // status 0 = init failed, status 3 = capture failed
          if (result.status === 0 || result.status === 3) {
            throw new Error("Screenshot capture failed on device");
          }
        }

        if (!downloadLink) throw new Error("Screenshot timed out");

        // Step 3: Eagerly fetch and cache as blob URL
        const imgRes = await fetch(downloadLink);
        const blob = await imgRes.blob();
        const blobUrl = URL.createObjectURL(blob);

        setScreenshots((prev) => {
          const next = new Map(prev);
          // Revoke old blob URL if exists
          const old = next.get(phoneId);
          if (old) URL.revokeObjectURL(old);
          next.set(phoneId, blobUrl);
          return next;
        });

        addToast("Screenshot captured", "success");
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Screenshot failed",
          "error"
        );
      } finally {
        removeLoading(phoneId);
      }
    },
    [addLoading, removeLoading, addToast]
  );

  // ---- Account Creation ----

  /** Start account creation pipeline (called after billing confirmation) */
  const handleCreateAccount = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch("/api/geelark/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        timeoutMs: 30_000,
      });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? `HTTP ${res.status}`);
      }
      const job = (await res.json()) as GeeLarkJob;
      addJob(job);
      addToast(
        `Account creation started (Job ${job.id.slice(0, 8)})`,
        "success"
      );
    } catch (err) {
      addToast(
        err instanceof Error
          ? err.message
          : "Failed to start account creation",
        "error"
      );
    }
  }, [addJob, addToast]);

  // ---- Job Retry ----

  const handleRetry = useCallback(
    async (jobId: string): Promise<void> => {
      try {
        const res = await dashboardFetch(`/api/geelark/jobs/${jobId}/retry`, {
          method: "POST",
          timeoutMs: 30_000,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const job = (await res.json()) as GeeLarkJob;
        addJob(job);
        addToast("Job retrying...", "success");
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to retry job",
          "error"
        );
      }
    },
    [addJob, addToast]
  );

  // ---- Dialog Triggers ----

  const handleStartRequest = useCallback((phoneId: string): void => {
    setPendingPhoneId(phoneId);
    setBillingAction("launch");
    setBillingDialogOpen(true);
  }, []);

  const handleCreateRequest = useCallback((): void => {
    setBillingAction("create");
    setBillingDialogOpen(true);
  }, []);

  const handleDialogCancel = useCallback((): void => {
    setBillingDialogOpen(false);
    setPendingPhoneId(null);
  }, []);

  const handleDialogConfirm = useCallback((): void => {
    setBillingDialogOpen(false);
    if (billingAction === "create") {
      void handleCreateAccount();
    } else if (pendingPhoneId) {
      void handleStart(pendingPhoneId);
    }
    setPendingPhoneId(null);
  }, [billingAction, pendingPhoneId, handleCreateAccount, handleStart]);

  // ---- Computed Values ----

  const runningCount = phones.filter((p) => p.status === 0).length;
  const hourlyRate = runningCount * 3.6;

  // ---- Cleanup blob URLs on unmount ----

  useEffect(() => {
    return () => {
      screenshotsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // ---- Render ----

  return (
    <TerminalCard
      command="geelark"
      filename="cloud-phones"
      headerText={`${phones.length} phones${
        runningCount > 0
          ? ` | ${runningCount} running | ~$${hourlyRate.toFixed(2)}/hr`
          : ""
      }`}
      headerActions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreateRequest}
            className="flex h-7 items-center gap-1.5 rounded-md border border-red-800 bg-transparent px-3 text-xs text-gray-400 transition-colors hover:bg-red-800 hover:text-gray-900"
          >
            <Plus className="h-3 w-3" />
            Create Account
          </button>
          <button
            type="button"
            onClick={() => void refreshPhones()}
            className="p-1.5 text-gray-500 transition-colors hover:text-gray-300"
            title="Refresh phone list"
            aria-label="Refresh phone list"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      }
      allowOverflow
      noPadding
    >
      <div className="flex flex-col divide-y divide-gray-800 lg:flex-row lg:divide-x lg:divide-y-0">
        {/* Phone Fleet Table -- 60% width on desktop */}
        <div className="min-w-0 flex-1 lg:w-3/5">
          {phonesLoading && phones.length === 0 ? (
            <div className="animate-pulse overflow-hidden">
              {/* Skeleton table header */}
              <div className="flex items-center gap-3 border-b border-gray-800 px-3 py-2">
                {["w-24", "w-16", "w-28", "w-16", "w-20", "w-16"].map((w, i) => (
                  <div key={i} className={`h-3 ${w} bg-gray-800/35 rounded`} />
                ))}
              </div>
              {/* Skeleton table rows */}
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-gray-800/30 px-3 py-2.5">
                  <div className="h-3.5 bg-gray-800/50 rounded" style={{ width: `${70 + (i % 3) * 20}px` }} />
                  <div className="h-4 w-16 bg-gray-800/35 rounded-full" />
                  <div className="h-3.5 bg-gray-800/35 rounded" style={{ width: `${90 + (i % 2) * 30}px` }} />
                  <div className="h-3.5 w-12 bg-gray-800/20 rounded" />
                  <div className="h-3.5 w-20 bg-gray-800/20 rounded" />
                  <div className="flex items-center gap-1 ml-auto">
                    <div className="h-6 w-6 bg-gray-800/20 rounded" />
                    <div className="h-6 w-6 bg-gray-800/20 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : phonesError && phones.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <p className="text-sm text-gray-500">Failed to load phones</p>
              <button
                type="button"
                onClick={() => void refreshPhones()}
                className="text-xs text-red-400 transition-colors hover:text-red-300"
              >
                Try again
              </button>
            </div>
          ) : (
            <PhoneFleetTable
              phones={phones}
              onStart={handleStartRequest}
              onStop={handleStop}
              onDestroy={handleDestroy}
              onScreenshot={handleScreenshot}
              loadingActions={loadingActions}
            />
          )}
        </div>

        {/* Job Queue Panel -- 40% width on desktop */}
        <div className="p-3 lg:w-2/5">
          <JobQueuePanel
            jobs={jobs}
            onRetry={handleRetry}
            onClearCompleted={() => {
              jobs
                .filter((j) => j.status !== "running")
                .forEach((j) => removeJob(j.id));
            }}
          />
        </div>
      </div>

      {/* Screenshot preview (shown as overlay when a screenshot exists) */}
      {screenshots.size > 0 && (
        <div className="border-t border-gray-800 p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Screenshots
          </h3>
          <div className="flex flex-wrap gap-2">
            {Array.from(screenshots.entries()).map(([phoneId, blobUrl]) => (
              <div
                key={phoneId}
                className="relative overflow-hidden rounded border border-gray-800"
              >
                <img
                  src={blobUrl}
                  alt={`Screenshot of phone ${phoneId.slice(0, 8)}`}
                  className="h-48 w-auto object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    setScreenshots((prev) => {
                      const next = new Map(prev);
                      const url = next.get(phoneId);
                      if (url) URL.revokeObjectURL(url);
                      next.delete(phoneId);
                      return next;
                    });
                  }}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-gray-300 transition-colors hover:bg-black/80"
                  aria-label={`Dismiss screenshot for phone ${phoneId.slice(0, 8)}`}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing Confirmation Dialog */}
      <BillingConfirmDialog
        open={billingDialogOpen}
        action={billingAction}
        onCancel={handleDialogCancel}
        onConfirm={handleDialogConfirm}
      />
    </TerminalCard>
  );
}
