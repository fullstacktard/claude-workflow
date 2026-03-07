/**
 * Draft Type Definitions
 *
 * Types and helpers for the draft review queue. Drafts represent AI-generated
 * tweet content that requires human review before publication.
 *
 * REST API: GET /api/drafts, PUT /api/drafts/:id, POST /api/drafts/:id/approve,
 *           POST /api/drafts/:id/reject, POST /api/drafts/batch
 *
 * @module types/draft
 */

/** Draft lifecycle statuses */
export type DraftStatus = "pending" | "approved" | "rejected" | "scheduled" | "published";

/** Human-readable labels for draft statuses */
export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
};

/** Status badge color mapping (Tailwind classes matching terminal theme) */
export const DRAFT_STATUS_COLORS: Record<DraftStatus, string> = {
  pending: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  approved: "text-green-400 border-green-400/30 bg-green-400/10",
  rejected: "text-red-400 border-red-400/30 bg-red-400/10",
  scheduled: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  published: "text-gray-400 border-gray-400/30 bg-gray-400/10",
};

/** Filter state for the draft queue */
export interface DraftFilterState {
  status: DraftStatus | "all";
  personaId: string | null;
  dateRange: { start: string; end: string } | null;
}

/** Generation metadata attached to a draft */
export interface DraftGenerationMeta {
  /** AI model used for generation (e.g., "claude-3-opus", "gpt-4") */
  model: string;
  /** Temperature setting used for generation */
  temperature: number;
  /** Quality score (0-100) from post-generation evaluation */
  qualityScore: number;
  /** The generation prompt/context used */
  promptContext: string | null;
}

/** Frontend-safe representation of a tweet draft */
export interface Draft {
  /** Unique draft UUID */
  id: string;
  /** Persona name that generated this draft */
  personaName: string;
  /** Persona ID for filtering */
  personaId: string;
  /** Target X account handle for publishing */
  targetAccountHandle: string;
  /** Target X account ID */
  targetAccountId: string;
  /** Tweet text content (max 280 chars) */
  text: string;
  /** Current draft status */
  status: DraftStatus;
  /** Generation metadata */
  generation: DraftGenerationMeta;
  /** Scheduled publication time (ISO 8601), null if not scheduled */
  scheduledAt: string | null;
  /** Published tweet ID (populated after publication) */
  tweetId: string | null;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** Optimistic update flag -- true while awaiting server confirmation */
  _optimistic?: boolean;
}

/** Status filter tabs configuration */
export const DRAFT_STATUS_TABS: Array<{ value: DraftStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "published", label: "Published" },
];

/**
 * Group drafts by date for timeline view.
 * Returns an array of [dateLabel, drafts[]] sorted chronologically.
 */
export function groupDraftsByDate(drafts: Draft[]): Array<[string, Draft[]]> {
  const groups = new Map<string, Draft[]>();

  const sortedDrafts = [...drafts].sort((a, b) => {
    const dateA = a.scheduledAt ?? a.createdAt;
    const dateB = b.scheduledAt ?? b.createdAt;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  for (const draft of sortedDrafts) {
    const dateStr = new Date(draft.scheduledAt ?? draft.createdAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const existing = groups.get(dateStr) ?? [];
    existing.push(draft);
    groups.set(dateStr, existing);
  }

  return Array.from(groups.entries());
}
