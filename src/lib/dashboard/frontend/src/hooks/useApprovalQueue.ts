/**
 * useApprovalQueue Hook
 *
 * Fetches draft posts pending approval and provides approve/reject/bulk-approve actions.
 * Integrates with /api/content-calendar/pending, /:id/approve, /:id/reject, /bulk-approve endpoints.
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";
import type { CalendarPost } from "./useContentCalendar";

const CALENDAR_URL = "/api/content-calendar";

export interface ApprovalAction {
  postId: string;
  action: "approve" | "reject";
  timestamp: string;
  reason?: string;
}

export interface UseApprovalQueueResult {
  /** Draft posts pending approval */
  pendingPosts: CalendarPost[];
  /** Loading state */
  loading: boolean;
  /** Error from fetch */
  error: Error | null;
  /** IDs of posts currently being processed */
  processingIds: Set<string>;
  /** Approve a single post */
  approvePost: (postId: string) => Promise<void>;
  /** Reject a post with reason */
  rejectPost: (postId: string, reason: string) => Promise<void>;
  /** Approve multiple posts at once */
  bulkApprove: (postIds: string[]) => Promise<void>;
  /** Refetch pending queue */
  refetch: () => void;
  /** Recent approval actions for activity feed */
  recentActions: ApprovalAction[];
}

export function useApprovalQueue(): UseApprovalQueueResult {
  const [pendingPosts, setPendingPosts] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [recentActions, setRecentActions] = useState<ApprovalAction[]>([]);

  const fetchPending = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await dashboardFetch(`${CALENDAR_URL}/pending`);
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      const data = (await res.json()) as CalendarPost[];
      setPendingPosts(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  const addRecentAction = useCallback((action: ApprovalAction) => {
    setRecentActions((prev) => [action, ...prev].slice(0, 20));
  }, []);

  const approvePost = useCallback(
    async (postId: string): Promise<void> => {
      setProcessingIds((prev) => new Set(prev).add(postId));
      try {
        const res = await dashboardFetch(`${CALENDAR_URL}/${postId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`Approve failed: HTTP ${String(res.status)}`);
        addRecentAction({ postId, action: "approve", timestamp: new Date().toISOString() });
        await fetchPending();
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      }
    },
    [fetchPending, addRecentAction],
  );

  const rejectPost = useCallback(
    async (postId: string, reason: string): Promise<void> => {
      setProcessingIds((prev) => new Set(prev).add(postId));
      try {
        const res = await dashboardFetch(`${CALENDAR_URL}/${postId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejection_reason: reason }),
        });
        if (!res.ok) throw new Error(`Reject failed: HTTP ${String(res.status)}`);
        addRecentAction({ postId, action: "reject", timestamp: new Date().toISOString(), reason });
        await fetchPending();
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      }
    },
    [fetchPending, addRecentAction],
  );

  const bulkApprove = useCallback(
    async (postIds: string[]): Promise<void> => {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        for (const id of postIds) next.add(id);
        return next;
      });
      try {
        const res = await dashboardFetch(`${CALENDAR_URL}/bulk-approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post_ids: postIds }),
        });
        if (!res.ok) throw new Error(`Bulk approve failed: HTTP ${String(res.status)}`);
        for (const id of postIds) {
          addRecentAction({ postId: id, action: "approve", timestamp: new Date().toISOString() });
        }
        await fetchPending();
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          for (const id of postIds) next.delete(id);
          return next;
        });
      }
    },
    [fetchPending, addRecentAction],
  );

  return {
    pendingPosts,
    loading,
    error,
    processingIds,
    approvePost,
    rejectPost,
    bulkApprove,
    refetch: (): void => void fetchPending(),
    recentActions,
  };
}
