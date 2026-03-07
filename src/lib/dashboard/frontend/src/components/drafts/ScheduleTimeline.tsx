/**
 * ScheduleTimeline Component
 *
 * Date-grouped timeline view for approved/scheduled drafts.
 * Shows drafts ordered chronologically with date headers and
 * a left-border timeline aesthetic.
 *
 * @module components/drafts/ScheduleTimeline
 */

import type { Draft } from "../../types/draft";
import { groupDraftsByDate, DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS } from "../../types/draft";

interface ScheduleTimelineProps {
  /** Drafts to display in the timeline */
  drafts: Draft[];
}

export function ScheduleTimeline({ drafts }: ScheduleTimelineProps): JSX.Element {
  const grouped = groupDraftsByDate(drafts);

  if (grouped.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        No drafts found for the current view.
      </div>
    );
  }

  return (
    <div className="space-y-4" role="list" aria-label="Draft schedule timeline">
      {grouped.map(([dateLabel, dateDrafts]) => (
        <div key={dateLabel} role="listitem">
          <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-red-400">
            {dateLabel}
          </h3>
          <div className="space-y-1 border-l border-red-800/30 pl-3">
            {dateDrafts.map((draft) => {
              const time = new Date(draft.scheduledAt ?? draft.createdAt).toLocaleTimeString(
                "en-US",
                { hour: "2-digit", minute: "2-digit" },
              );
              return (
                <div
                  key={draft.id}
                  className="flex items-center gap-3 py-1.5 font-mono text-sm"
                >
                  <span className="w-14 shrink-0 text-gray-500">{time}</span>
                  <span className="shrink-0 text-gray-400">{draft.personaName}</span>
                  <span className="shrink-0 text-gray-600">via</span>
                  <span className="shrink-0 text-gray-400">@{draft.targetAccountHandle}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-300">
                    &ldquo;{draft.text.slice(0, 60)}
                    {draft.text.length > 60 ? "..." : ""}&rdquo;
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${DRAFT_STATUS_COLORS[draft.status]}`}
                  >
                    {DRAFT_STATUS_LABELS[draft.status]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
