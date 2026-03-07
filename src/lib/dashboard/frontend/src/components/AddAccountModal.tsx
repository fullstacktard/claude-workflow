/**
 * AddAccountModal Component
 * Modal for initiating CLI-based OAuth login flow to add Claude accounts
 *
 * Uses the CLI login flow which spawns `claude setup-token` and captures
 * the OAuth URL from CLI output. This approach works reliably because it
 * uses the official CLI's OAuth implementation.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import type {
  WSServerMessage,
  CliLoginUrlPayload,
  CliLoginCompletePayload,
  CliLoginErrorPayload,
  CliLoginProgressPayload,
} from "../types/websocket";

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (email?: string) => void;
  onError: (error: string) => void;
  /** Optional account ID for re-authentication flow (updates existing account) */
  reAuthAccountId?: string;
}

type ModalStep = "starting" | "waiting_for_url" | "waiting_for_code" | "submitting" | "complete" | "error";

interface StartLoginResponse {
  sessionId: string;
  status: "starting" | "no_cli" | "already_logged_in";
  error?: string;
}

export function AddAccountModal({
  isOpen,
  onClose,
  onSuccess,
  reAuthAccountId,
}: AddAccountModalProps): JSX.Element | null {
  const [step, setStep] = useState<ModalStep>("starting");
  const [sessionId, setSessionId] = useState<string>("");
  const [authUrl, setAuthUrl] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [oauthCode, setOauthCode] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string>("Exchanging code for tokens via CLI");

  // Ref for modal content container (for focus trap)
  const modalRef = useRef<HTMLDivElement>(null);
  // Restore focus to previously focused element when modal closes
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);
  // Track if we've already completed to avoid double-handling
  const completedRef = useRef<boolean>(false);
  // Ref for sessionId to avoid dependency cycle in handleClose
  const sessionIdRef = useRef<string>("");
  // Track if login has already been initiated to prevent duplicate calls
  const loginStartedRef = useRef<boolean>(false);

  // Keep sessionIdRef in sync with sessionId state
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Helper function for closing modal
  const handleClose = useCallback((): void => {
    // Stop CLI login session if active (use ref to avoid dependency cycle)
    if (sessionIdRef.current) {
      void fetch("/api/cli-login/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch(() => {
        // Ignore errors when stopping - session may have already completed
      });
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset state
    setStep("starting");
    setSessionId("");
    setAuthUrl("");
    setErrorMessage("");
    setOauthCode("");
    setIsSubmitting(false);
    completedRef.current = false;
    sessionIdRef.current = "";
    loginStartedRef.current = false;
    onClose();
  }, [onClose]);

  /**
   * Handle keyboard navigation for modal
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      handleClose();
      return;
    }

    // Tab trap
    if (event.key === "Tab" && modalRef.current) {
      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusableElements.length === 0) return;

      const activeElement = document.activeElement as HTMLElement;
      const currentIndex = focusableElements.indexOf(activeElement);

      if (event.shiftKey) {
        event.preventDefault();
        if (currentIndex <= 0) {
          focusableElements[focusableElements.length - 1]?.focus();
        } else {
          focusableElements[currentIndex - 1]?.focus();
        }
      } else {
        event.preventDefault();
        if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
          focusableElements[0]?.focus();
        } else {
          focusableElements[currentIndex + 1]?.focus();
        }
      }
    }
  }, [handleClose]);

  /**
   * Setup WebSocket connection to receive CLI login events
   */
  const setupWebSocket = useCallback((loginSessionId: string): void => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/logs`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[AddAccountModal] WebSocket connected");
      // Subscribe to all sessions to receive CLI login broadcasts
      ws.send(JSON.stringify({ type: "subscribe_all" }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WSServerMessage;

        // Handle CLI login URL (OAuth URL extracted from CLI output)
        if (message.type === "cli_login_url") {
          const payload = message.payload as CliLoginUrlPayload;
          if (payload.sessionId === loginSessionId) {
            console.log("[AddAccountModal] Received OAuth URL");
            // The payload uses 'oauthUrl' not 'authUrl' based on cli-login.ts broadcast
            const url = (payload as unknown as { oauthUrl?: string }).oauthUrl ?? payload.authUrl;
            setAuthUrl(url);
            setStep("waiting_for_code");
          }
        }

        // Handle CLI login completion
        if (message.type === "cli_login_complete") {
          const payload = message.payload as CliLoginCompletePayload;
          if (payload.sessionId === loginSessionId && !completedRef.current) {
            completedRef.current = true;
            console.log("[AddAccountModal] CLI login completed successfully");
            setStep("complete");

            // Get sync result email if available
            const syncResult = (payload as unknown as { syncResult?: { email?: string } }).syncResult;

            // Brief delay to show success state, then close
            setTimeout(() => {
              onSuccess(syncResult?.email);
              handleClose();
            }, 1000);
          }
        }

        // Handle CLI login error
        if (message.type === "cli_login_error") {
          const payload = message.payload as CliLoginErrorPayload;
          if (payload.sessionId === loginSessionId && !completedRef.current) {
            completedRef.current = true;
            console.error("[AddAccountModal] CLI login error:", payload.error);
            setErrorMessage(payload.error || "CLI login failed");
            setStep("error");
            setIsSubmitting(false);
          }
        }

        // Handle CLI login progress
        if (message.type === "cli_login_progress") {
          const payload = message.payload as CliLoginProgressPayload;
          if (payload.sessionId === loginSessionId) {
            console.log("[AddAccountModal] CLI login progress:", payload.message);
            setProgressMessage(payload.message);
          }
        }

        // Handle credential file update (for Docker mode - user ran CLI on host)
        if (message.type === "credentials_updated" && !completedRef.current) {
          const payload = message.payload as { action?: string; email?: string };
          if (payload.action === "added" || payload.action === "updated") {
            completedRef.current = true;
            console.log("[AddAccountModal] Credentials detected from host CLI");
            setStep("complete");

            // Brief delay to show success state, then close
            setTimeout(() => {
              onSuccess(payload.email);
              handleClose();
            }, 1000);
          }
        }
      } catch (err) {
        console.error("[AddAccountModal] Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("[AddAccountModal] WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("[AddAccountModal] WebSocket closed");
    };
  }, [onSuccess, handleClose]);

  /**
   * Start CLI login flow
   */
  const startCliLogin = useCallback(async (): Promise<void> => {
    // Prevent duplicate login calls
    if (loginStartedRef.current) {
      console.log("[AddAccountModal] Login already started, skipping duplicate call");
      return;
    }
    loginStartedRef.current = true;

    setStep("waiting_for_url");
    setErrorMessage("");
    setOauthCode("");
    setIsSubmitting(false);
    completedRef.current = false;

    try {
      const body: { accountId?: string } = {};
      if (reAuthAccountId) {
        body.accountId = reAuthAccountId;
      }

      const response = await fetch("/api/cli-login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json() as StartLoginResponse;

      if (!response.ok || data.status === "no_cli") {
        throw new Error(data.error || "Failed to start CLI login. Is Claude CLI installed?");
      }

      console.log("[AddAccountModal] CLI login started:", {
        sessionId: data.sessionId.slice(0, 16) + "...",
        status: data.status,
      });

      setSessionId(data.sessionId);

      // Setup WebSocket to receive CLI events
      setupWebSocket(data.sessionId);

    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start CLI login");
      setStep("error");
    }
  }, [reAuthAccountId, setupWebSocket]);

  /**
   * Retry CLI login after an error - resets guard refs and starts fresh
   */
  const retryCliLogin = useCallback((): void => {
    console.log("[AddAccountModal] Retrying CLI login...");
    // Reset the guard ref so startCliLogin will actually run
    loginStartedRef.current = false;
    completedRef.current = false;
    // Close existing WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    void startCliLogin();
  }, [startCliLogin]);

  /**
   * Open the auth URL in a new browser tab
   */
  function openAuthUrl(): void {
    if (authUrl) {
      window.open(authUrl, "_blank", "noopener,noreferrer");
    }
  }

  /**
   * Submit OAuth code to CLI via /cli-login/submit-code
   */
  async function submitOauthCode(): Promise<void> {
    if (!oauthCode.trim() || !sessionId) return;

    setIsSubmitting(true);
    setStep("submitting");
    setProgressMessage("Exchanging code for tokens via CLI");
    console.log("[AddAccountModal] Entering submitting state, waiting for completion...");

    try {
      const response = await fetch("/api/cli-login/submit-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          code: oauthCode.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "Failed to submit authorization code");
      }

      console.log("[AddAccountModal] OAuth code submitted successfully, awaiting WebSocket event...");
      // Now we wait for WebSocket cli_login_complete or cli_login_error message

    } catch (err) {
      setIsSubmitting(false);
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit code");
      setStep("error");
    }
  }

  // Frontend timeout for submitting state - prevents hanging forever
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    if (step === "submitting") {
      console.log("[AddAccountModal] Starting 90-second timeout for submitting state");
      timeoutId = setTimeout(() => {
        console.log("[AddAccountModal] Timeout reached in submitting state");
        if (step === "submitting" && !completedRef.current) {
          setErrorMessage("Authentication timed out. The CLI may have completed but failed to notify. Please check your accounts list and try again if needed.");
          setStep("error");
          setIsSubmitting(false);
        }
      }, 90_000); // 90 seconds - gives CLI 30s check time + buffer
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [step]);

  // Start CLI login immediately when modal opens
  useEffect(() => {
    if (isOpen && !loginStartedRef.current) {
      setSessionId("");
      setAuthUrl("");
      setErrorMessage("");
      setOauthCode("");
      setIsSubmitting(false);
      completedRef.current = false;
      // Note: loginStartedRef is only reset in handleClose when modal actually closes.
      // Do NOT reset it here - that causes infinite loops when dependencies change.
      void startCliLogin();
    }

    // Cleanup on unmount or close
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCliLogin dependency causes re-execution cascade; guard ref handles idempotency
  }, [isOpen]);

  // Focus first focusable element when modal opens
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const firstFocusable = modalRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [isOpen]);

  // Manage body scroll and focus restoration
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Get the title based on current step
  function getModalTitle(): string {
    if (reAuthAccountId) {
      return "Re-authenticate Account";
    }
    switch (step) {
      case "starting":
      case "waiting_for_url":
        return "Adding Account";
      case "waiting_for_code":
        return "Authorization Required";
      case "submitting":
        return "Completing Authentication";
      case "complete":
        return reAuthAccountId ? "Account Re-authenticated" : "Account Connected";
      case "error":
        return "Authentication Failed";
      default:
        return "Add Claude Account";
    }
  }

  // Early return AFTER all hooks
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-red-800">
          <h2 id="modal-title" className="text-white font-medium font-mono">
            {getModalTitle()}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 rounded transition-colors hover:text-white hover:bg-red-800/50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {(step === "starting" || step === "waiting_for_url") && (
            <div className="py-8 flex flex-col items-center justify-center">
              <div className="spinner w-8 h-8 mb-4" />
              <p className="text-gray-400">
                {step === "starting" ? "Starting CLI login..." : "Waiting for OAuth URL from CLI..."}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                This uses the official Claude CLI for authentication
              </p>
            </div>
          )}

          {step === "waiting_for_code" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Click the button below to open the Anthropic authorization page. After authorizing, copy and paste the code you receive.
              </p>

              <button
                className="mt-2 w-full flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:bg-gray-700 disabled:border-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                onClick={openAuthUrl}
                type="button"
              >
                Open Authorization Page
              </button>

              <div className="mt-5 pt-5 border-t border-gray-800 space-y-4">
                <div>
                  <label htmlFor="authCode" className="block text-sm mb-2 text-gray-400">
                    Authorization code:
                  </label>
                  <div className="flex gap-3">
                    <input
                      id="authCode"
                      type="text"
                      value={oauthCode}
                      onChange={(e) => setOauthCode(e.target.value)}
                      placeholder="Enter authorization code..."
                      className="flex-1 min-w-0 bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={isSubmitting}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && oauthCode.trim()) {
                          void submitOauthCode();
                        }
                      }}
                    />
                  <button
                    className="h-10 px-5 text-sm font-medium rounded-md transition-colors shrink-0 bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                    onClick={() => void submitOauthCode()}
                    type="button"
                    disabled={!oauthCode.trim() || isSubmitting}
                  >
                    Submit
                  </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  onClick={handleClose}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {step === "submitting" && (
            <div className="py-8 flex flex-col items-center justify-center">
              <div className="spinner w-8 h-8 mb-4" />
              <p className="text-gray-400">Completing authentication...</p>
              <p className="text-xs text-gray-500 mt-2">{progressMessage}</p>
            </div>
          )}

          {step === "complete" && (
            <div className="py-8 flex flex-col items-center justify-center">
              <svg className="w-12 h-12 mb-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M20 6L9 17l-5-5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
              <p className="text-sm text-gray-400 text-center">
                {reAuthAccountId
                  ? "Your account has been successfully re-authenticated."
                  : "Your account has been successfully connected."}
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4">
              <div className="p-4 rounded-md border bg-red-900/20 border-red-800/50">
                <p className="text-sm text-red-400">{errorMessage}</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  onClick={handleClose}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:bg-gray-700 disabled:border-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  onClick={retryCliLogin}
                  type="button"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
