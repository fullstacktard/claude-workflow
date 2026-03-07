/**
 * ApprovalPanel Component
 *
 * Slide-in side panel for reviewing and approving/rejecting draft posts.
 * Shows pending queue count, individual post review with approve/reject,
 * bulk approve, and recent activity feed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, Loader2, Clock, CheckCircle2, XCircle } from "lucide-react";

import { useApprovalQueue } from "../hooks/useApprovalQueue";
import type { ApprovalAction } from "../hooks/useApprovalQueue";
import type { CalendarPost, PostPlatform } from "../hooks/useContentCalendar";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PLATFORM_LABELS: Record<PostPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  email: "Email",
};

const PLATFORM_BADGE_COLORS: Record<PostPlatform, string> = {
  x: "bg-gray-700 text-gray-300",
  linkedin: "bg-blue-900 text-blue-300",
  email: "bg-purple-900 text-purple-300",
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface PostCardProps {
  post: CalendarPost;
  isProcessing: boolean;
  isSelected: boolean;
  onToggleSelect: (postId: string) => void;
  onApprove: (postId: string) => void;
  onReject: (postId: string, reason: string) => void;
}

function ApprovalPostCard({
  post,
  isProcessing,
  isSelected,
  onToggleSelect,
  onApprove,
  onReject,
}: PostCardProps): JSX.Element {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showRejectForm && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showRejectForm]);

  const truncated =
    post.content.length > 140
      ? post.content.slice(0, 137) + "..."
      : post.content;

  const createdDate = new Date(post.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleRejectSubmit = (): void => {
    if (rejectReason.trim()) {
      onReject(post.id, rejectReason.trim());
      setShowRejectForm(false);
      setRejectReason("");
    }
  };

  return (
    <div className="rounded border border-[#30363d] bg-[#0d1117] p-3">
      <div className="flex items-start gap-2">
        {/* Checkbox */}
        <label className="mt-0.5 flex-shrink-0 cursor-pointer" aria-label={`Select post ${post.id}`}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(post.id)}
            className="h-3.5 w-3.5 rounded border-[#30363d] bg-[#0d1117] accent-blue-500"
            disabled={isProcessing}
          />
        </label>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${PLATFORM_BADGE_COLORS[post.platform]}`}
            >
              {PLATFORM_LABELS[post.platform]}
            </span>
            <span className="text-[10px] text-gray-500">{createdDate}</span>
          </div>
          <p className="text-xs leading-relaxed text-gray-300" title={post.content}>
            {truncated}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-label="Processing" />
        ) : (
          <>
            <button
              type="button"
              onClick={() => onApprove(post.id)}
              className="rounded p-1.5 text-green-400 transition-colors hover:bg-green-900/30"
              aria-label={`Approve post ${post.id}`}
              title="Approve"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowRejectForm(!showRejectForm)}
              className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-900/30"
              aria-label={`Reject post ${post.id}`}
              title="Reject"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Reject reason form */}
      {showRejectForm && !isProcessing && (
        <div className="mt-2 border-t border-[#30363d] pt-2">
          <textarea
            ref={textareaRef}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-gray-300 placeholder:text-gray-600 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            rows={2}
            aria-label="Rejection reason"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason("");
              }}
              className="rounded px-2 py-1 text-[10px] text-gray-400 transition-colors hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim()}
              className="rounded bg-red-700 px-2 py-1 text-[10px] font-medium text-red-100 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit Rejection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity Feed Item                                                 */
/* ------------------------------------------------------------------ */

function ActivityItem({ action }: { action: ApprovalAction }): JSX.Element {
  const timeAgo = getTimeAgo(action.timestamp);
  const isApprove = action.action === "approve";

  return (
    <div className="flex items-start gap-2 py-1.5">
      {isApprove ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
      )}
      <div className="min-w-0 flex-1">
        <span className="text-[10px] text-gray-400">
          Post {action.postId.slice(0, 8)}...{" "}
          <span className={isApprove ? "text-green-400" : "text-red-400"}>
            {isApprove ? "approved" : "rejected"}
          </span>
        </span>
        {action.reason && (
          <p className="mt-0.5 truncate text-[10px] text-gray-600" title={action.reason}>
            Reason: {action.reason}
          </p>
        )}
      </div>
      <span className="flex-shrink-0 text-[10px] text-gray-600">{timeAgo}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

function getTimeAgo(timestamp: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  ApprovalPanel                                                      */
/* ------------------------------------------------------------------ */

interface ApprovalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after any approval/rejection to refresh parent data */
  onPostStatusChanged?: () => void;
}

export function ApprovalPanel({
  isOpen,
  onClose,
  onPostStatusChanged,
}: ApprovalPanelProps): JSX.Element {
  const {
    pendingPosts,
    loading,
    error,
    processingIds,
    approvePost,
    rejectPost,
    bulkApprove,
    refetch,
    recentActions,
  } = useApprovalQueue();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset selection when posts change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [pendingPosts]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleToggleSelect = useCallback((postId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === pendingPosts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingPosts.map((p) => p.id)));
    }
  }, [selectedIds.size, pendingPosts]);

  const handleApprove = useCallback(
    async (postId: string): Promise<void> => {
      await approvePost(postId);
      onPostStatusChanged?.();
    },
    [approvePost, onPostStatusChanged],
  );

  const handleReject = useCallback(
    async (postId: string, reason: string): Promise<void> => {
      await rejectPost(postId, reason);
      onPostStatusChanged?.();
    },
    [rejectPost, onPostStatusChanged],
  );

  const handleBulkApprove = useCallback(async (): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await bulkApprove(ids);
    setSelectedIds(new Set());
    onPostStatusChanged?.();
  }, [selectedIds, bulkApprove, onPostStatusChanged]);

  const allSelected =
    pendingPosts.length > 0 && selectedIds.size === pendingPosts.length;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Approval review panel"
        className={`fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-[#30363d] bg-[#161b22] shadow-xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-200">
              Pending Review
            </h2>
            {pendingPosts.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-yellow-600 px-2 py-0.5 text-[10px] font-medium text-yellow-100">
                {pendingPosts.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-[#30363d] hover:text-gray-200"
            aria-label="Close approval panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Bulk actions bar */}
        {pendingPosts.length > 0 && (
          <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAll}
                className="h-3.5 w-3.5 rounded border-[#30363d] bg-[#0d1117] accent-blue-500"
              />
              Select All
            </label>
            <button
              type="button"
              onClick={() => void handleBulkApprove()}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 rounded bg-green-700 px-2.5 py-1 text-[10px] font-medium text-green-100 transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3 w-3" />
              Approve Selected ({selectedIds.size})
            </button>
          </div>
        )}

        {/* Post list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
              <span className="ml-2 text-xs text-gray-500">
                Loading pending posts...
              </span>
            </div>
          )}

          {error && !loading && (
            <div className="py-10 text-center">
              <p className="text-xs text-red-400">
                Failed to load: {error.message}
              </p>
              <button
                type="button"
                onClick={refetch}
                className="mt-2 rounded bg-[#30363d] px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-[#3d444d]"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && pendingPosts.length === 0 && (
            <div className="py-10 text-center">
              <Clock className="mx-auto mb-2 h-6 w-6 text-gray-600" />
              <p className="text-xs text-gray-500">
                No posts pending review
              </p>
              <p className="mt-1 text-[10px] text-gray-600">
                Draft posts will appear here for approval
              </p>
            </div>
          )}

          {!loading && !error && pendingPosts.length > 0 && (
            <div className="flex flex-col gap-2">
              {pendingPosts.map((post) => (
                <ApprovalPostCard
                  key={post.id}
                  post={post}
                  isProcessing={processingIds.has(post.id)}
                  isSelected={selectedIds.has(post.id)}
                  onToggleSelect={handleToggleSelect}
                  onApprove={(id) => void handleApprove(id)}
                  onReject={(id, reason) => void handleReject(id, reason)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        {recentActions.length > 0 && (
          <div className="border-t border-[#30363d] px-4 py-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Recent Activity
            </h3>
            <div className="max-h-32 overflow-y-auto">
              {recentActions.map((action, index) => (
                <ActivityItem key={`${action.postId}-${String(index)}`} action={action} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
