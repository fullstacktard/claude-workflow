/**
 * ContentCalendarPage Component
 *
 * Full content calendar with month/week views, platform/status filtering,
 * and drag-and-drop rescheduling via @dnd-kit.
 *
 * @module pages/ContentCalendarPage
 */

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  GripVertical,
} from "lucide-react";

import { Navigation } from "../components/Navigation";
import { useContentCalendar } from "../hooks/useContentCalendar";
import type {
  CalendarPost,
  CalendarView,
  PostPlatform,
  PostStatus,
} from "../hooks/useContentCalendar";
import { PostComposerModal } from "../components/PostComposerModal";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<PostStatus, string> = {
  draft: "bg-gray-600 text-gray-200",
  approved: "bg-blue-600 text-blue-100",
  scheduled: "bg-yellow-600 text-yellow-100",
  publishing: "bg-orange-600 text-orange-100",
  published: "bg-green-600 text-green-100",
  failed: "bg-red-600 text-red-100",
};

const PLATFORM_ICONS: Record<PostPlatform, string> = {
  x: "\uD835\uDD4F",
  linkedin: "in",
  email: "\u2709",
};

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ALL_PLATFORMS: PostPlatform[] = ["x", "linkedin", "email"];
const ALL_STATUSES: PostStatus[] = [
  "draft",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
];

/* ------------------------------------------------------------------ */
/*  Date Utilities                                                     */
/* ------------------------------------------------------------------ */

function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: toISODateString(start), end: toISODateString(end) };
}

function getWeekRange(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  // Monday = 0 offset, Sunday = 6
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISODateString(monday), end: toISODateString(sunday) };
}

/**
 * Returns an array of Date objects for all days that should appear
 * in the month grid, padded to start on Monday and fill complete weeks.
 */
function getDaysInMonthGrid(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Determine padding days before the first of the month (Monday = 0)
  const rawDow = firstDay.getDay(); // 0=Sun, 1=Mon, ...
  const startDow = rawDow === 0 ? 6 : rawDow - 1; // Convert to Mon=0

  const days: Date[] = [];

  // Padding days from previous month
  for (let i = startDow; i > 0; i--) {
    days.push(new Date(year, month, 1 - i));
  }

  // Days of current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  // Padding days after end of month to fill the grid row
  let nextMonthDay = 1;
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month + 1, nextMonthDay));
    nextMonthDay++;
  }

  return days;
}

function getWeekDays(date: Date): Date[] {
  const { start } = getWeekRange(date);
  const monday = new Date(start + "T00:00:00");
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatWeekLabel(date: Date): string {
  const { start, end } = getWeekRange(date);
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sMonth = s.toLocaleDateString("en-US", { month: "short" });
  const eMonth = e.toLocaleDateString("en-US", { month: "short" });
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} \u2013 ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${sMonth} ${s.getDate()} \u2013 ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/*  Draggable PostCard                                                 */
/* ------------------------------------------------------------------ */

interface PostCardProps {
  onEdit?: (post: CalendarPost) => void;
  post: CalendarPost;
  isDragOverlay?: boolean;
}

function PostCard({ post, isDragOverlay, onEdit }: PostCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: post.id,
    data: { post },
  });

  const truncated =
    post.content.length > 60
      ? post.content.slice(0, 57) + "..."
      : post.content;

  const cardClasses = [
    "flex items-start gap-1.5 rounded px-1.5 py-1 text-xs cursor-grab",
    "border border-gray-700 bg-gray-800 hover:bg-gray-750 transition-colors",
    isDragging && !isDragOverlay ? "opacity-30" : "",
    isDragOverlay ? "shadow-lg shadow-black/50 ring-1 ring-red-400" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      className={cardClasses}
      {...(isDragOverlay ? {} : { ...listeners, ...attributes })}
      onClick={onEdit && !isDragOverlay ? () => onEdit(post) : undefined}
    >
      <span className="mt-px flex-shrink-0" aria-label={`Platform: ${post.platform}`}>
        <GripVertical className="inline h-3 w-3 text-gray-500" />
        <span className="ml-0.5 font-medium">{PLATFORM_ICONS[post.platform]}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`inline-block rounded-sm px-1 py-px text-[10px] font-medium leading-tight ${STATUS_COLORS[post.status]}`}
        >
          {post.status}
        </span>
        <span className="mt-0.5 block truncate text-gray-300" title={post.content}>
          {truncated}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Droppable Day Cell                                                 */
/* ------------------------------------------------------------------ */

interface DayCellProps {
  onEditPost?: (post: CalendarPost) => void;
  date: Date;
  posts: CalendarPost[];
  isCurrentMonth: boolean;
  compact?: boolean;
}

function DayCell({ date, posts, isCurrentMonth, compact, onEditPost }: DayCellProps): JSX.Element {
  const dateStr = toISODateString(date);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dateStr}` });

  const todayHighlight = isToday(date) ? "text-red-400 font-bold" : "text-gray-400";
  const cellBg = isOver
    ? "bg-gray-800 ring-1 ring-red-400/50"
    : isCurrentMonth
      ? "bg-gray-900"
      : "bg-gray-950 opacity-50";

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[80px] border border-gray-800 p-1 ${cellBg} ${compact ? "min-h-[100px]" : ""}`}
    >
      <div className={`mb-1 text-xs ${todayHighlight}`}>{date.getDate()}</div>
      <div className="flex flex-col gap-0.5">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} onEdit={onEditPost} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MonthView                                                          */
/* ------------------------------------------------------------------ */

interface MonthViewProps {
  onEditPost?: (post: CalendarPost) => void;
  currentDate: Date;
  posts: CalendarPost[];
}

function MonthView({ currentDate, posts, onEditPost }: MonthViewProps): JSX.Element {
  const days = useMemo(() => getDaysInMonthGrid(currentDate), [currentDate]);
  const currentMonth = currentDate.getMonth();

  const postsByDate = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      const dateKey = post.scheduled_at
        ? post.scheduled_at.slice(0, 10)
        : post.created_at.slice(0, 10);
      const existing = map.get(dateKey);
      if (existing) {
        existing.push(post);
      } else {
        map.set(dateKey, [post]);
      }
    }
    return map;
  }, [posts]);

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-800">
        {DAY_HEADERS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dateStr = toISODateString(day);
          return (
            <DayCell
              key={dateStr}
              date={day}
              posts={postsByDate.get(dateStr) ?? []}
              isCurrentMonth={day.getMonth() === currentMonth}
              onEditPost={onEditPost}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WeekView                                                           */
/* ------------------------------------------------------------------ */

interface WeekViewProps {
  onEditPost?: (post: CalendarPost) => void;
  currentDate: Date;
  posts: CalendarPost[];
}

function WeekView({ currentDate, posts, onEditPost }: WeekViewProps): JSX.Element {
  const days = useMemo(() => getWeekDays(currentDate), [currentDate]);

  const postsByDate = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      const dateKey = post.scheduled_at
        ? post.scheduled_at.slice(0, 10)
        : post.created_at.slice(0, 10);
      const existing = map.get(dateKey);
      if (existing) {
        existing.push(post);
      } else {
        map.set(dateKey, [post]);
      }
    }
    return map;
  }, [posts]);

  return (
    <div>
      {/* Day headers with full date */}
      <div className="grid grid-cols-7 border-b border-gray-800">
        {days.map((day) => {
          const dayLabel = day.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          return (
            <div
              key={toISODateString(day)}
              className={`py-2 text-center text-xs font-medium ${
                isToday(day) ? "text-red-400" : "text-gray-500"
              }`}
            >
              {dayLabel}
            </div>
          );
        })}
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dateStr = toISODateString(day);
          return (
            <DayCell
              key={dateStr}
              date={day}
              posts={postsByDate.get(dateStr) ?? []}
              isCurrentMonth
              compact
              onEditPost={onEditPost}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toolbar                                                            */
/* ------------------------------------------------------------------ */

interface ToolbarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  platformFilter: PostPlatform | "";
  onPlatformFilterChange: (platform: PostPlatform | "") => void;
  statusFilter: PostStatus | "";
  onStatusFilterChange: (status: PostStatus | "") => void;
}

function Toolbar({
  view,
  onViewChange,
  currentDate,
  onPrev,
  onNext,
  onToday,
  platformFilter,
  onPlatformFilterChange,
  statusFilter,
  onStatusFilterChange,
}: ToolbarProps): JSX.Element {
  const label =
    view === "month"
      ? formatMonthLabel(currentDate)
      : formatWeekLabel(currentDate);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-3">
      {/* View toggle */}
      <div className="flex rounded-md border border-gray-700">
        <button
          type="button"
          onClick={() => onViewChange("month")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            view === "month"
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-gray-200"
          }`}
          aria-pressed={view === "month"}
        >
          Month
        </button>
        <button
          type="button"
          onClick={() => onViewChange("week")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            view === "week"
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-gray-200"
          }`}
          aria-pressed={view === "week"}
        >
          Week
        </button>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          aria-label={`Previous ${view}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          aria-label={`Next ${view}`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Date label */}
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
        <CalendarIcon className="h-4 w-4 text-gray-500" />
        {label}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filters */}
      <div className="flex items-center gap-2">
        <label htmlFor="platform-filter" className="sr-only">
          Filter by platform
        </label>
        <select
          id="platform-filter"
          value={platformFilter}
          onChange={(e) =>
            onPlatformFilterChange(e.target.value as PostPlatform | "")
          }
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
        >
          <option value="">All Platforms</option>
          {ALL_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        <label htmlFor="status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) =>
            onStatusFilterChange(e.target.value as PostStatus | "")
          }
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ContentCalendarPage                                                */
/* ------------------------------------------------------------------ */

export function ContentCalendarPage(): JSX.Element {
  const [view, setView] = useState<CalendarView>("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [platformFilter, setPlatformFilter] = useState<PostPlatform | "">("");
  const [statusFilter, setStatusFilter] = useState<PostStatus | "">("");
  const [activePost, setActivePost] = useState<CalendarPost | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<CalendarPost | undefined>();

  // Compute date range based on view
  const dateRange = useMemo(() => {
    if (view === "month") {
      return getMonthRange(currentDate);
    }
    return getWeekRange(currentDate);
  }, [view, currentDate]);

  const filters = useMemo(
    () => ({
      platform: platformFilter || undefined,
      status: statusFilter || undefined,
    }),
    [platformFilter, statusFilter],
  );

  const { posts, loading, error, refetch, reschedulePost } = useContentCalendar(
    dateRange.start,
    dateRange.end,
    view,
    filters,
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // Navigation handlers
  const handlePrev = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === "month") {
        d.setMonth(d.getMonth() - 1);
      } else {
        d.setDate(d.getDate() - 7);
      }
      return d;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === "month") {
        d.setMonth(d.getMonth() + 1);
      } else {
        d.setDate(d.getDate() + 7);
      }
      return d;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const post = event.active.data.current?.post as CalendarPost | undefined;
    setActivePost(post ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActivePost(null);
      const { active, over } = event;
      if (!over) return;

      const droppableId = String(over.id);
      if (!droppableId.startsWith("day-")) return;

      const newDateStr = droppableId.replace("day-", "");
      const post = active.data.current?.post as CalendarPost | undefined;
      if (!post) return;

      // Preserve the original time-of-day if a scheduled_at exists
      let newScheduledAt: string;
      if (post.scheduled_at) {
        const timePart = post.scheduled_at.includes("T")
          ? post.scheduled_at.slice(10)
          : "T12:00:00Z";
        newScheduledAt = newDateStr + timePart;
      } else {
        newScheduledAt = newDateStr + "T12:00:00Z";
      }

      // Don't reschedule if dropped on the same day
      const currentDateStr = post.scheduled_at
        ? post.scheduled_at.slice(0, 10)
        : post.created_at.slice(0, 10);
      if (currentDateStr === newDateStr) return;

      void reschedulePost(post.id, newScheduledAt);
    },
    [reschedulePost],
  );

  const handleDragCancel = useCallback(() => {
    setActivePost(null);
  }, []);

  const handleNewPost = useCallback(() => {
    setEditingPost(undefined);
    setComposerOpen(true);
  }, []);

  const handleEditPost = useCallback((post: CalendarPost) => {
    setEditingPost(post);
    setComposerOpen(true);
  }, []);

  const handleComposerSaved = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-950">
      <Navigation />

      <Toolbar
        view={view}
        onViewChange={setView}
        currentDate={currentDate}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        platformFilter={platformFilter}
        onPlatformFilterChange={setPlatformFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* New Post action bar */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-2">
        <span className="text-xs text-gray-500">
          {posts.length} post{posts.length !== 1 ? "s" : ""} in view
        </span>
        <button
          type="button"
          onClick={handleNewPost}
          className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
        >
          + New Post
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-gray-500">Loading calendar...</div>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            <div className="text-sm text-red-400">
              Failed to load calendar: {error.message}
            </div>
            <button
              type="button"
              onClick={handleToday}
              className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <CalendarIcon className="mx-auto mb-3 h-8 w-8 text-gray-600" />
              <div className="text-sm text-gray-500">
                No posts scheduled for this period
              </div>
              <div className="mt-1 text-xs text-gray-600">
                Posts will appear here once content is scheduled
              </div>
            </div>
          </div>
        )}

        {!loading && !error && (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {view === "month" ? (
              <MonthView currentDate={currentDate} posts={posts} onEditPost={handleEditPost} />
            ) : (
              <WeekView currentDate={currentDate} posts={posts} onEditPost={handleEditPost} />
            )}

            <DragOverlay>
              {activePost ? (
                <PostCard post={activePost} isDragOverlay />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <PostComposerModal
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSaved={handleComposerSaved}
        editPost={editingPost}
      />
    </div>
  );
}
