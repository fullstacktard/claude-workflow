/**
 * useContentCalendar Hook
 *
 * Fetches calendar posts via REST with date range and filter params.
 * Supports refetching on date/filter changes and drag-and-drop rescheduling.
 *
 * @example
 * ```tsx
 * const { posts, loading, error, reschedulePost } = useContentCalendar(
 *   '2026-03-01', '2026-03-31', 'month', { platform: 'x' }
 * );
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** Calendar grouping / view type */
export type CalendarView = "month" | "week";

/** Supported posting platforms */
export type PostPlatform = "x" | "linkedin" | "email";

/** Post lifecycle status */
export type PostStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

/** A single content post for the calendar */
export interface CalendarPost {
  id: string;
  content: string;
  platform: PostPlatform;
  brand_voice_id?: string;
  scheduled_at?: string;
  published_at?: string;
  status: PostStatus;
  campaign_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

/** A time-period grouping of posts (returned by calendar view endpoint) */
export interface CalendarViewEntry {
  period_label: string;
  period_start: string;
  period_end: string;
  posts: CalendarPost[];
}

/** Optional filter criteria for calendar queries */
export interface CalendarFilters {
  platform?: PostPlatform;
  status?: PostStatus;
}

/** Return type of the useContentCalendar hook */
export interface UseContentCalendarResult {
  /** Posts grouped by period */
  entries: CalendarViewEntry[];
  /** Flat list of all posts in current view */
  posts: CalendarPost[];
  /** Loading state */
  loading: boolean;
  /** Error from fetch */
  error: Error | null;
  /** Refetch with current params */
  refetch: () => void;
  /** Update a post's scheduled_at (for drag-and-drop rescheduling) */
  reschedulePost: (postId: string, newScheduledAt: string) => Promise<void>;
}

const CALENDAR_URL = "/api/content-calendar";

/**
 * Fetches and manages content calendar data.
 *
 * @param startDate - ISO date string for range start
 * @param endDate - ISO date string for range end
 * @param grouping - Period grouping: 'month' or 'week'
 * @param filters - Optional platform/status filters
 * @returns Calendar entries, posts, loading/error state, and actions
 */
export function useContentCalendar(
  startDate: string,
  endDate: string,
  grouping: CalendarView,
  filters: CalendarFilters = {},
): UseContentCalendarResult {
  const [entries, setEntries] = useState<CalendarViewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCalendar = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        grouping,
      });
      if (filters.platform) params.set("platform", filters.platform);
      if (filters.status) params.set("status", filters.status);

      const res = await dashboardFetch(
        `${CALENDAR_URL}?${params.toString()}`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${String(res.status)}: ${res.statusText}`);
      }
      const data = (await res.json()) as CalendarViewEntry[];
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, grouping, filters.platform, filters.status]);

  useEffect(() => {
    void fetchCalendar();
  }, [fetchCalendar]);

  const posts = entries.flatMap((e) => e.posts);

  const reschedulePost = useCallback(
    async (postId: string, newScheduledAt: string): Promise<void> => {
      try {
        const res = await dashboardFetch(
          `${CALENDAR_URL}/${postId}/reschedule`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scheduled_at: newScheduledAt }),
          },
        );
        if (!res.ok) {
          throw new Error(`Reschedule failed: HTTP ${String(res.status)}`);
        }
        // Refetch calendar data after successful reschedule
        await fetchCalendar();
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    [fetchCalendar],
  );

  return {
    entries,
    posts,
    loading,
    error,
    refetch: (): void => void fetchCalendar(),
    reschedulePost,
  };
}
