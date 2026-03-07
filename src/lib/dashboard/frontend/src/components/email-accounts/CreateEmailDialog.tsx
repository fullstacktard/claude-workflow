/**
 * CreateEmailDialog Component
 *
 * Modal dialog for creating new email accounts.
 * Form: provider (select), optional first/last name, username, domain.
 * On submit: POST /api/email-accounts -> returns job_id.
 * Polls GET /api/email-accounts/jobs/:jobId every 10s until completed/failed.
 *
 * @module components/email-accounts/CreateEmailDialog
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";

import { useToast } from "../../contexts/ToastContext";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type { EmailJobStatus } from "../../types/email-accounts";

/** Props for the CreateEmailDialog component */
interface CreateEmailDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback to close the dialog */
  onClose: () => void;
  /** Callback after successful account creation */
  onCreated: () => void;
  /** Callback to log activity entries */
  onActivity: (action: string, success: boolean, details: string) => void;
}

/** Interval between job status polls */
const POLL_INTERVAL_MS = 10_000;

/**
 * Extract a human-readable result from the completed job result.
 * The EmailJobStatus union has `result: unknown` for completed status,
 * so we safely extract email or error strings from it.
 */
function extractResultEmail(result: unknown): string {
  if (
    result !== null &&
    typeof result === "object" &&
    "email" in (result as Record<string, unknown>)
  ) {
    return String((result as Record<string, unknown>).email);
  }
  return "unknown";
}

/** Extract error string from a failed job result */
function extractResultError(result: unknown): string {
  if (typeof result === "string") return result;
  if (
    result !== null &&
    typeof result === "object" &&
    "error" in (result as Record<string, unknown>)
  ) {
    return String((result as Record<string, unknown>).error);
  }
  return "unknown error";
}

/**
 * CreateEmailDialog renders a modal form for creating new email accounts.
 * Handles form submission, job polling, and completion/failure states.
 */
export function CreateEmailDialog({
  isOpen,
  onClose,
  onCreated,
  onActivity,
}: CreateEmailDialogProps): JSX.Element | null {
  const { addToast } = useToast();

  const [provider, setProvider] = useState<"mail.com" | "gmx.com">("mail.com");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredUsername, setPreferredUsername] = useState("");
  const [preferredDomain, setPreferredDomain] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<EmailJobStatus | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => {
        modalRef.current?.focus();
      });
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Cleanup poll timer
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  /** Poll job status from the API */
  const pollJob = useCallback(
    async (id: string): Promise<void> => {
      try {
        const response = await dashboardFetch(
          `/api/email-accounts/jobs/${id}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as EmailJobStatus;
        setJobStatus(data);

        if (data.status === "completed") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          const email = extractResultEmail(data.result);
          addToast(`Account created: ${email}`, "success");
          onActivity("account_created", true, `Created ${email}`);
          onCreated();
        } else if (data.status === "failed") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          const errorMsg = data.error;
          addToast(`Account creation failed: ${errorMsg}`, "error");
          onActivity("account_created", false, errorMsg);
        }
      } catch {
        // Silently continue polling on network errors
      }
    },
    [addToast, onActivity, onCreated],
  );

  /** Handle form submission */
  const handleSubmit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      if (isSubmitting) return;

      setIsSubmitting(true);
      try {
        const body: Record<string, string> = { provider };
        if (firstName.trim()) body.first_name = firstName.trim();
        if (lastName.trim()) body.last_name = lastName.trim();
        if (preferredUsername.trim())
          body.preferred_username = preferredUsername.trim();
        if (preferredDomain.trim())
          body.preferred_domain = preferredDomain.trim();

        const response = await dashboardFetch("/api/email-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          timeoutMs: 30_000,
        });

        if (!response.ok) {
          const data = (await response.json()) as { message?: string };
          throw new Error(data.message ?? "Failed to create account");
        }

        const data = (await response.json()) as { job_id: string };
        setJobId(data.job_id);
        setJobStatus({ status: "running", progress: "Starting..." });

        // Start polling
        pollTimerRef.current = setInterval(() => {
          void pollJob(data.job_id);
        }, POLL_INTERVAL_MS);
      } catch (error: unknown) {
        const msg =
          error instanceof Error
            ? error.message
            : "Failed to create account";
        addToast(msg, "error");
        onActivity("account_created", false, msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      provider,
      firstName,
      lastName,
      preferredUsername,
      preferredDomain,
      isSubmitting,
      addToast,
      onActivity,
      pollJob,
    ],
  );

  /** Close dialog and reset all state */
  const handleClose = useCallback((): void => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setJobId(null);
    setJobStatus(null);
    setProvider("mail.com");
    setFirstName("");
    setLastName("");
    setPreferredUsername("");
    setPreferredDomain("");
    onClose();
  }, [onClose]);

  /** Handle Escape key to close */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "Escape") handleClose();
    },
    [handleClose],
  );

  if (!isOpen) return null;

  const isPolling =
    jobId !== null && jobStatus !== null && jobStatus.status === "running";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={modalRef}
        className="relative w-full max-w-md mx-4 rounded-lg border border-red-800 bg-gray-950 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-email-title"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2
            id="create-email-title"
            className="text-lg font-semibold text-white font-mono"
          >
            Create Email Account
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: polling state */}
        {isPolling ? (
          <div className="px-5 py-6 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-red-400" />
            <p className="text-sm text-gray-400">
              {jobStatus.status === "running"
                ? jobStatus.progress
                : "Creating account..."}
            </p>
            <p className="text-xs text-gray-600">
              Job: {jobId?.slice(0, 8)}...
            </p>
          </div>
        ) : jobStatus?.status === "completed" ? (
          /* Body: completed state */
          <div className="px-5 py-6 flex flex-col items-center gap-3">
            <p className="text-sm text-green-400">
              Account created successfully!
            </p>
            <p className="text-xs text-gray-400">
              {extractResultEmail(jobStatus.result)}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 h-8 px-4 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Done
            </button>
          </div>
        ) : jobStatus?.status === "failed" ? (
          /* Body: failed state */
          <div className="px-5 py-6 flex flex-col items-center gap-3">
            <p className="text-sm text-red-400">Account creation failed</p>
            <p className="text-xs text-gray-500">
              {extractResultError(jobStatus.error)}
            </p>
            <button
              type="button"
              onClick={() => {
                setJobId(null);
                setJobStatus(null);
              }}
              className="mt-2 h-8 px-4 text-xs rounded-md border border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          /* Body: form state */
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="px-5 pb-5 space-y-4"
          >
            {/* Provider */}
            <div>
              <label
                htmlFor="email-provider"
                className="block text-xs text-gray-500 mb-1"
              >
                Provider *
              </label>
              <select
                id="email-provider"
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as "mail.com" | "gmx.com")
                }
                className="w-full h-8 px-2 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-600"
              >
                <option value="mail.com">mail.com</option>
                <option value="gmx.com">gmx.com</option>
              </select>
            </div>

            {/* First Name */}
            <div>
              <label
                htmlFor="email-first-name"
                className="block text-xs text-gray-500 mb-1"
              >
                First Name (optional)
              </label>
              <input
                id="email-first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Auto-generated if empty"
                className="w-full h-8 px-2 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>

            {/* Last Name */}
            <div>
              <label
                htmlFor="email-last-name"
                className="block text-xs text-gray-500 mb-1"
              >
                Last Name (optional)
              </label>
              <input
                id="email-last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Auto-generated if empty"
                className="w-full h-8 px-2 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>

            {/* Preferred Username */}
            <div>
              <label
                htmlFor="email-username"
                className="block text-xs text-gray-500 mb-1"
              >
                Preferred Username (optional)
              </label>
              <input
                id="email-username"
                type="text"
                value={preferredUsername}
                onChange={(e) => setPreferredUsername(e.target.value)}
                placeholder="Auto-generated if empty"
                className="w-full h-8 px-2 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>

            {/* Preferred Domain */}
            <div>
              <label
                htmlFor="email-domain"
                className="block text-xs text-gray-500 mb-1"
              >
                Preferred Domain (optional)
              </label>
              <input
                id="email-domain"
                type="text"
                value={preferredDomain}
                onChange={(e) => setPreferredDomain(e.target.value)}
                placeholder="e.g., mail.com, email.com"
                className="w-full h-8 px-2 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-gray-700 bg-transparent px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isSubmitting && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Create Account
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
