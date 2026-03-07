/**
 * PostComposerModal
 *
 * Multi-platform post composition modal with brand voice selection,
 * AI content generation, character counting, platform preview, and
 * analytics-driven scheduling suggestions with content type tips.
 *
 * @module components/PostComposerModal
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Sparkles, Send, Save } from "lucide-react";

import { dashboardFetch } from "../utils/dashboard-fetch";
import { useEngagementAnalytics } from "../hooks/useEngagementAnalytics";
import type { CalendarPost, PostPlatform } from "../hooks/useContentCalendar";
import type {
  DayInsight,
  HourInsight,
  ContentTypeInsight,
} from "../hooks/useEngagementAnalytics";

// ── Constants ───────────────────────────────────────────────────

const PLATFORM_CHAR_LIMITS: Record<PostPlatform, number | null> = {
  x: 280,
  linkedin: 3000,
  email: null, // unlimited
};

const PLATFORM_OPTIONS: Array<{
  value: PostPlatform;
  label: string;
  icon: string;
}> = [
  { value: "x", label: "X (Twitter)", icon: "\uD835\uDD4F" },
  { value: "linkedin", label: "LinkedIn", icon: "in" },
  { value: "email", label: "Email", icon: "\u2709" },
];

// ── Analytics Suggestion Helpers ────────────────────────────────

/** Abbreviations for day names used in suggestion chip labels */
const DAY_ABBREV: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

/** Numeric index of each day (0 = Sunday) used by getNextOccurrence */
const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** A single suggested posting time derived from analytics insights */
interface TimeSuggestion {
  day: string;
  hour: number;
  score: number;
  label: string;
}

/**
 * Format a 24-hour number as a compact AM/PM string.
 * @example formatHour(0) → "12AM", formatHour(14) → "2PM"
 */
function formatHour(hour: number): string {
  if (hour === 0) return "12AM";
  if (hour === 12) return "12PM";
  return hour > 12 ? `${String(hour - 12)}PM` : `${String(hour)}AM`;
}

/**
 * Cross-join best days and hours, rank by combined avg_score, and
 * return the top `limit` suggestions for display as clickable chips.
 */
function computeTimeSuggestions(
  bestDays: DayInsight[],
  bestHours: HourInsight[],
  limit = 3,
): TimeSuggestion[] {
  if (bestDays.length === 0 || bestHours.length === 0) return [];

  const combos: TimeSuggestion[] = [];
  for (const day of bestDays) {
    for (const hour of bestHours) {
      combos.push({
        day: day.day_of_week,
        hour: hour.hour,
        score: day.avg_score + hour.avg_score,
        label: `${DAY_ABBREV[day.day_of_week] ?? day.day_of_week.slice(0, 3)} ${formatHour(hour.hour)}`,
      });
    }
  }

  combos.sort((a, b) => b.score - a.score);
  return combos.slice(0, limit);
}

/**
 * Compute the next future occurrence of a given day-of-week + hour
 * and return it as a datetime-local string ("YYYY-MM-DDTHH:MM").
 */
function getNextOccurrence(dayName: string, hour: number): string {
  const now = new Date();
  const targetDay = DAY_INDEX[dayName];
  if (targetDay === undefined) return "";

  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;

  if (daysUntil === 0 && now.getHours() >= hour) {
    // Same day but hour already passed → next week
    daysUntil = 7;
  } else if (daysUntil < 0) {
    daysUntil += 7;
  }

  const target = new Date(now);
  target.setDate(target.getDate() + daysUntil);
  target.setHours(hour, 0, 0, 0);

  const year = String(target.getFullYear());
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const hours = String(target.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:00`;
}

// ── SuggestedTimes Sub-Component ────────────────────────────────

interface SuggestedTimesProps {
  suggestions: TimeSuggestion[];
  onSelect: (suggestion: TimeSuggestion) => void;
}

/**
 * Renders analytics-derived posting time suggestions as clickable
 * chips. Returns null when no suggestions exist (graceful degradation).
 */
function SuggestedTimes({
  suggestions,
  onSelect,
}: SuggestedTimesProps): JSX.Element | null {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-2">
      <span className="mb-1.5 block text-xs text-gray-500">
        Suggested times
      </span>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={`${s.day}-${String(s.hour)}`}
            type="button"
            onClick={() => onSelect(s)}
            className="rounded-full border border-green-800 bg-green-900/20 px-3 py-1 text-xs text-green-400 transition-colors hover:border-green-600 hover:bg-green-900/40"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ContentTypeTip Sub-Component ────────────────────────────────

interface ContentTypeTipProps {
  contentTypes: ContentTypeInsight[];
}

/**
 * Displays the best-performing content type as a small informational
 * badge. Returns null when data is insufficient (graceful degradation).
 */
function ContentTypeTip({
  contentTypes,
}: ContentTypeTipProps): JSX.Element | null {
  if (contentTypes.length === 0) return null;

  const sorted = [...contentTypes].sort(
    (a, b) => b.avg_engagement_rate - a.avg_engagement_rate,
  );
  const best = sorted[0];
  if (!best || best.post_count < 2) return null;

  const engRate = (best.avg_engagement_rate * 100).toFixed(1);

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="inline-flex items-center rounded bg-blue-900/30 px-2 py-0.5 text-xs text-blue-400">
        <span className="mr-1">&#9733;</span>
        {best.type} posts perform best ({engRate}% eng. rate)
      </span>
    </div>
  );
}

// ── Types ───────────────────────────────────────────────────────

interface BrandVoice {
  id: string;
  name: string;
  tone: string;
  description?: string;
}

interface PostComposerModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Callback after successful save/schedule */
  onSaved: () => void;
  /** Existing post for edit mode (undefined = create mode) */
  editPost?: CalendarPost;
  /** Pre-selected date from calendar click */
  defaultDate?: string;
}

// ── Character Count Display ─────────────────────────────────────

interface CharCountProps {
  current: number;
  limit: number | null;
}

function CharCount({ current, limit }: CharCountProps): JSX.Element {
  if (limit === null) {
    return <span className="text-xs text-gray-500">{current} chars</span>;
  }

  const remaining = limit - current;
  const percentage = (current / limit) * 100;

  let colorClass = "text-green-400";
  if (percentage >= 100) colorClass = "text-red-400 font-bold";
  else if (percentage >= 90) colorClass = "text-red-400";
  else if (percentage >= 75) colorClass = "text-yellow-400";

  return <span className={`text-xs ${colorClass}`}>{remaining} remaining</span>;
}

// ── Platform Preview ────────────────────────────────────────────

interface PlatformPreviewProps {
  platform: PostPlatform;
  content: string;
}

function PlatformPreview({
  platform,
  content,
}: PlatformPreviewProps): JSX.Element {
  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">
        Start typing to see preview...
      </div>
    );
  }

  switch (platform) {
    case "x":
      return (
        <div className="rounded-xl border border-gray-700 bg-black p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-gray-700" />
            <div>
              <div className="text-sm font-bold text-gray-100">Your Brand</div>
              <div className="text-xs text-gray-500">@yourbrand</div>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-200">{content}</p>
          <div className="mt-3 flex gap-6 text-xs text-gray-600">
            <span>Reply 0</span>
            <span>Repost 0</span>
            <span>Like 0</span>
            <span>Views 0</span>
          </div>
        </div>
      );
    case "linkedin":
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-12 w-12 rounded-full bg-blue-900" />
            <div>
              <div className="text-sm font-bold text-gray-100">Your Brand</div>
              <div className="text-xs text-gray-500">Company - 1d</div>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-200">{content}</p>
        </div>
      );
    case "email":
      return (
        <div className="rounded border border-gray-700 bg-gray-900 p-4">
          <div className="mb-3 border-b border-gray-700 pb-2">
            <div className="text-xs text-gray-500">
              From: your-brand@company.com
            </div>
            <div className="text-xs text-gray-500">
              Subject: Marketing Update
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-200">{content}</p>
        </div>
      );
  }
}

// ── Main Modal ──────────────────────────────────────────────────

export function PostComposerModal({
  isOpen,
  onClose,
  onSaved,
  editPost,
  defaultDate,
}: PostComposerModalProps): JSX.Element | null {
  const [platform, setPlatform] = useState<PostPlatform>(
    editPost?.platform ?? "x",
  );
  const [content, setContent] = useState(editPost?.content ?? "");
  const [brandVoiceId, setBrandVoiceId] = useState(
    editPost?.brand_voice_id ?? "",
  );
  const [scheduledAt, setScheduledAt] = useState(
    editPost?.scheduled_at?.slice(0, 16) ?? defaultDate ?? "",
  );
  const [brandVoices, setBrandVoices] = useState<BrandVoice[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditMode = editPost !== undefined;
  const charLimit = PLATFORM_CHAR_LIMITS[platform];

  // Fetch posting insights for the selected platform (only when modal is open)
  const { insights } = useEngagementAnalytics(
    30,
    isOpen ? platform : undefined,
  );

  // Compute top 3 suggested posting times from analytics
  const timeSuggestions = insights
    ? computeTimeSuggestions(insights.best_days, insights.best_hours, 3)
    : [];

  // Auto-fill scheduledAt with next occurrence of a suggested day+hour
  const handleSuggestionSelect = useCallback(
    (suggestion: TimeSuggestion): void => {
      const nextDate = getNextOccurrence(suggestion.day, suggestion.hour);
      if (nextDate) {
        setScheduledAt(nextDate);
      }
    },
    [],
  );

  // Fetch brand voices on mount
  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const res = await dashboardFetch(
          "/api/content-calendar/brand-voices",
        );
        if (res.ok) {
          const data = (await res.json()) as BrandVoice[];
          setBrandVoices(data);
        }
      } catch {
        // Non-critical: brand voices dropdown will be empty
      }
    })();
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Focus textarea on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // AI Generate handler
  const handleGenerate = useCallback(async (): Promise<void> => {
    setGenerating(true);
    try {
      const res = await dashboardFetch("/api/content-calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          brand_voice_id: brandVoiceId || undefined,
          prompt: content || "Generate a marketing post",
        }),
        timeoutMs: 60_000,
      });
      if (!res.ok)
        throw new Error(`Generation failed: HTTP ${String(res.status)}`);
      const data = (await res.json()) as { content?: string; text?: string };
      setContent(data.content ?? data.text ?? "");
    } catch (err) {
      console.error("AI generation failed:", err);
    } finally {
      setGenerating(false);
    }
  }, [platform, brandVoiceId, content]);

  // Save handler (draft or schedule)
  const handleSave = useCallback(
    async (asDraft: boolean): Promise<void> => {
      setSaving(true);
      try {
        const postData: Record<string, unknown> = {
          content,
          platform,
          brand_voice_id: brandVoiceId || undefined,
        };

        if (!asDraft && scheduledAt) {
          postData.scheduled_at = new Date(scheduledAt).toISOString();
        }

        if (isEditMode && editPost) {
          // Update existing post
          await dashboardFetch(
            `/api/content-calendar/posts/${editPost.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(postData),
            },
          );
        } else {
          // Create new post
          await dashboardFetch("/api/content-calendar/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postData),
          });
        }

        onSaved();
        onClose();
      } catch (err) {
        console.error("Save failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [
      content,
      platform,
      brandVoiceId,
      scheduledAt,
      isEditMode,
      editPost,
      onSaved,
      onClose,
    ],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="composer-title"
    >
      <div className="w-full max-w-4xl rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2
            id="composer-title"
            className="text-lg font-semibold text-gray-100"
          >
            {isEditMode ? "Edit Post" : "New Post"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body - Two columns */}
        <div className="flex gap-0 border-b border-gray-700">
          {/* Left: Editor */}
          <div className="flex-1 border-r border-gray-700 p-6">
            {/* Platform Selector */}
            <div className="mb-4">
              <span className="mb-1.5 block text-xs font-medium text-gray-400">
                Platform
              </span>
              <div className="flex gap-2">
                {PLATFORM_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPlatform(opt.value)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                      platform === opt.value
                        ? "border-red-500 bg-red-500/10 text-red-400"
                        : "border-gray-700 text-gray-400 hover:border-gray-500"
                    }`}
                    aria-pressed={platform === opt.value}
                  >
                    <span className="font-mono">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Brand Voice */}
            <div className="mb-4">
              <label
                className="mb-1.5 block text-xs font-medium text-gray-400"
                htmlFor="composer-brand-voice"
              >
                Brand Voice
              </label>
              <select
                id="composer-brand-voice"
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200"
                value={brandVoiceId}
                onChange={(e) => setBrandVoiceId(e.target.value)}
              >
                <option value="">No brand voice</option>
                {brandVoices.map((bv) => (
                  <option key={bv.id} value={bv.id}>
                    {bv.name} ({bv.tone})
                  </option>
                ))}
              </select>
            </div>

            {/* Content Textarea */}
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  className="text-xs font-medium text-gray-400"
                  htmlFor="composer-content"
                >
                  Content
                </label>
                <CharCount current={content.length} limit={charLimit} />
              </div>
              <textarea
                id="composer-content"
                ref={textareaRef}
                className="h-40 w-full resize-none rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-red-500 focus:outline-none"
                placeholder="Write your post content..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={charLimit ?? undefined}
              />
              {insights?.content_types && (
                <ContentTypeTip contentTypes={insights.content_types} />
              )}
            </div>

            {/* AI Generate Button */}
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="mb-4 flex items-center gap-2 rounded border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generating..." : "AI Generate"}
            </button>

            {/* Schedule Date/Time */}
            <div>
              <label
                className="mb-1.5 block text-xs font-medium text-gray-400"
                htmlFor="composer-schedule"
              >
                Schedule Date/Time
              </label>
              <input
                id="composer-schedule"
                type="datetime-local"
                className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
              <SuggestedTimes
                suggestions={timeSuggestions}
                onSelect={handleSuggestionSelect}
              />
            </div>
          </div>

          {/* Right: Preview */}
          <div className="w-80 p-6">
            <span className="mb-3 block text-xs font-medium text-gray-400">
              Preview
            </span>
            <PlatformPreview platform={platform} content={content} />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={saving || !content.trim()}
            className="flex items-center gap-2 rounded border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:border-gray-400 hover:text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={saving || !content.trim() || !scheduledAt}
            className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
