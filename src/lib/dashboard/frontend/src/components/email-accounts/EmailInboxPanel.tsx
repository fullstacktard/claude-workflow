/**
 * EmailInboxPanel Component
 *
 * Most novel component in the email dashboard. Features:
 * - Message list with 3-row cards (sender+time, subject, preview)
 * - Verification code extraction (regex: 4-8 digit codes, "Code: XXXXX")
 * - Click-to-copy code banner (bg-gray-800, border-red-800, text-red-400)
 * - Load More pagination (20 messages per page)
 * - Refresh button with 10-second cooldown
 * - Plain text body rendering with HTML stripping
 *
 * @module components/email-accounts/EmailInboxPanel
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { RefreshCw, Loader2, Copy, Check, ChevronDown, AlertTriangle } from "lucide-react";

import { useToast } from "../../contexts/ToastContext";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type {
  EmailInboxMessage,
  InboxResponse,
} from "../../types/email-accounts";

/** Props for the EmailInboxPanel component */
interface EmailInboxPanelProps {
  /** Account ID to fetch inbox for */
  accountId: string;
  /** Email address for display */
  accountEmail: string;
  /** Callback to log activity entries */
  onActivity: (action: string, success: boolean, details: string) => void;
}

/**
 * Regex patterns for verification code extraction.
 * Ordered from most specific to most generic to reduce false positives.
 */
const CODE_PATTERNS = [
  /(?:verification|Verification)[:\s]+(\d{4,8})/, // "Verification: 123456"
  /(?:OTP|otp)[:\s]+(\d{4,8})/, // "OTP: 123456"
  /(?:code|Code|CODE)[:\s]+(\d{4,8})/, // "Code: 123456"
  /\b(\d{4,8})\b/, // Standalone 4-8 digit number (most generic, last)
];

/**
 * Extract verification code from email subject/preview text.
 * Tries each pattern in order, returns first match or null.
 */
function extractVerificationCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Decode HTML entities and strip tags using DOMParser for safe plain text rendering */
function decodeHtml(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body.textContent ?? "";
  } catch {
    // Fallback regex strip if DOMParser fails
    return html.replace(/<[^>]*>/g, "");
  }
}

/** Cooldown between refreshes in milliseconds */
const REFRESH_COOLDOWN_MS = 10_000;

/** Number of messages per page */
const PAGE_SIZE = 20;

/**
 * EmailInboxPanel renders the inbox view for a selected email account.
 * Handles message loading, verification code extraction, and refresh cooldown.
 */
export function EmailInboxPanel({
  accountId,
  accountEmail,
  onActivity,
}: EmailInboxPanelProps): JSX.Element {
  const { addToast } = useToast();

  const [messages, setMessages] = useState<EmailInboxMessage[]>([]);
  const [selectedMessageUid, setSelectedMessageUid] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);

  // Refresh cooldown state
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable ref for onActivity to avoid infinite useEffect loops.
  // onActivity changes reference on every parent render (depends on selectedAccount),
  // but fetchMessages needs it without re-triggering the load effect.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const selectedMessage =
    messages.find((m) => m.uid === selectedMessageUid) ?? null;

  /** Fetch messages from the inbox API */
  const fetchMessages = useCallback(
    async (offset = 0, append = false): Promise<void> => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await dashboardFetch(
          `/api/email-accounts/${accountId}/inbox?limit=${PAGE_SIZE}&offset=${offset}`,
          { timeoutMs: 90_000 },
        );
        if (!response.ok) {
          const body = (await response.json()) as { message?: string; error?: string };
          throw new Error(body.message ?? body.error ?? "Failed to load inbox");
        }
        const data = (await response.json()) as InboxResponse;
        const newMessages = data.messages ?? [];

        if (append) {
          setMessages((prev) => [...prev, ...newMessages]);
        } else {
          setMessages(newMessages);
        }
        setHasMore(newMessages.length >= PAGE_SIZE);
        setInboxError(null);
        onActivityRef.current("inbox_read", true, `Loaded ${newMessages.length} messages`);
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : "Failed to load inbox";
        if (!append) setInboxError(msg);
        onActivityRef.current("inbox_read", false, msg);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accountId],
  );

  // Load messages on mount and when account changes
  useEffect(() => {
    setInboxError(null);
    void fetchMessages();
    setSelectedMessageUid(null);
  }, [accountId, fetchMessages]);

  /** Refresh with cooldown timer */
  const handleRefresh = useCallback((): void => {
    if (cooldownRemaining > 0) return;
    void fetchMessages();

    setCooldownRemaining(REFRESH_COOLDOWN_MS / 1000);
    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [cooldownRemaining, fetchMessages]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  /** Load more messages (pagination) */
  const handleLoadMore = useCallback((): void => {
    void fetchMessages(messages.length, true);
  }, [fetchMessages, messages.length]);

  /** Copy verification code to clipboard */
  const handleCopyCode = useCallback(
    async (code: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(code);
        setCodeCopied(true);
        addToast(`Code ${code} copied to clipboard`, "success");
        setTimeout(() => setCodeCopied(false), 2000);
      } catch {
        addToast("Failed to copy code", "error");
      }
    },
    [addToast],
  );

  // Extract verification code from selected message's subject + preview
  const extractedCode = selectedMessage
    ? extractVerificationCode(
        selectedMessage.subject + " " + selectedMessage.preview,
      )
    : null;

  /** Render preview text, always decoding HTML entities and stripping tags */
  const renderPreview = (msg: EmailInboxMessage): string => {
    return decodeHtml(msg.preview);
  };

  const isRefreshDisabled = loading || cooldownRemaining > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header with message count and refresh button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-red-800/30 shrink-0">
        <span className="text-xs text-gray-400">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshDisabled}
          className={`h-7 px-2 text-xs rounded-md border border-red-800 flex items-center gap-1.5 transition-colors ${
            isRefreshDisabled
              ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
              : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
          }`}
          aria-label={
            cooldownRemaining > 0
              ? `Refresh available in ${cooldownRemaining}s`
              : "Refresh inbox"
          }
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {cooldownRemaining > 0 ? `${cooldownRemaining}s` : "Refresh"}
        </button>
      </div>

      {/* Loading state */}
      {loading && messages.length === 0 && (
        <div className="flex items-center justify-center flex-1 p-6">
          <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      )}

      {/* Error state */}
      {!loading && messages.length === 0 && inboxError && (
        <div className="flex flex-col items-center justify-center flex-1 p-6 gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <p className="text-red-400 text-sm font-medium">Failed to load inbox</p>
          <p className="text-gray-500 text-xs text-center max-w-xs">{inboxError}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && messages.length === 0 && !inboxError && (
        <div className="flex items-center justify-center flex-1 p-6">
          <p className="text-gray-500 text-sm">No messages found</p>
        </div>
      )}

      {/* Message list + detail */}
      {messages.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {/* Verification code banner -- prominent click-to-copy */}
          {extractedCode && (
            <div className="mx-4 mt-3 mb-2">
              <button
                type="button"
                onClick={() => void handleCopyCode(extractedCode)}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-800 border border-red-800 rounded-md hover:bg-gray-750 transition-colors cursor-pointer"
                aria-label={`Copy verification code ${extractedCode}`}
              >
                <span className="text-2xl font-mono text-red-400 tracking-widest">
                  {extractedCode}
                </span>
                {codeCopied ? (
                  <Check className="w-4 h-4 text-green-400 shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-500 shrink-0" />
                )}
              </button>
            </div>
          )}

          {/* Message cards */}
          <div className="px-4 pb-2 space-y-1">
            {messages.map((msg) => {
              const isSelected = msg.uid === selectedMessageUid;
              return (
                <button
                  key={msg.uid}
                  type="button"
                  onClick={() =>
                    setSelectedMessageUid(isSelected ? null : msg.uid)
                  }
                  className={`w-full text-left rounded-md p-2.5 border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-green-600 bg-gray-900/80"
                      : "border-gray-800/50 bg-gray-900/30 hover:border-gray-600"
                  }`}
                >
                  {/* Row 1: Sender + timestamp */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs truncate text-gray-400">
                      {msg.from}
                    </span>
                    <span className="text-gray-600 text-xs shrink-0">
                      {new Date(msg.date).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {/* Row 2: Subject */}
                  <div className="mt-0.5">
                    <span className="text-xs text-white font-medium">
                      {msg.subject || "(no subject)"}
                    </span>
                  </div>
                  {/* Row 3: Preview snippet */}
                  <div className="mt-0.5">
                    <span className="text-xs text-gray-500 line-clamp-1">
                      {renderPreview(msg).slice(0, 120)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected message body */}
          {selectedMessage && (
            <div className="mx-4 mb-4 mt-2 border border-red-800/30 rounded-md bg-gray-900/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium">
                  From: {selectedMessage.from}
                </span>
                <span className="text-xs text-gray-600">
                  {new Date(selectedMessage.date).toLocaleString()}
                </span>
              </div>
              <h4 className="text-sm text-white font-medium mb-2">
                {selectedMessage.subject || "(no subject)"}
              </h4>
              <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto scrollbar-hide">
                {renderPreview(selectedMessage)}
              </pre>
            </div>
          )}

          {/* Load More button */}
          {hasMore && (
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full h-8 text-xs rounded-md border border-red-800/50 bg-transparent text-gray-400 hover:bg-red-800/20 transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {loadingMore ? "Loading..." : "Load 20 more..."}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
