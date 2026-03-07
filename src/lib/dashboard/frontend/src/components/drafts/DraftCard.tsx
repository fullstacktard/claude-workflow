/**
 * DraftCard Component
 *
 * Individual draft card for the review queue. Displays persona/account header,
 * tweet text with inline editing, collapsible generation metadata, and
 * approve/reject/edit action buttons.
 *
 * Optimistic state is shown via reduced opacity + pulse animation.
 *
 * @module components/drafts/DraftCard
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "../../types/draft";
import { DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS } from "../../types/draft";

interface DraftCardProps {
  /** Draft data to display */
  draft: Draft;
  /** Called when user approves this draft */
  onApprove: (id: string) => void;
  /** Called when user rejects this draft */
  onReject: (id: string) => void;
  /** Called when user saves an edit to the draft text */
  onEdit: (id: string, newText: string) => void;
}

/** Maximum tweet character count */
const MAX_CHARS = 280;

export function DraftCard({ draft, onApprove, onReject, onEdit }: DraftCardProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(draft.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editText when draft.text changes externally (e.g., WS update)
  useEffect(() => {
    if (!isEditing) {
      setEditText(draft.text);
    }
  }, [draft.text, isEditing]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const charsRemaining = MAX_CHARS - editText.length;
  const isOverLimit = charsRemaining < 0;
  const isPublished = draft.status === "published";
  const optimisticClass = draft._optimistic ? "opacity-60 animate-pulse" : "";

  const handleSave = useCallback((): void => {
    if (isOverLimit) return;
    onEdit(draft.id, editText);
    setIsEditing(false);
  }, [draft.id, editText, isOverLimit, onEdit]);

  const handleCancel = useCallback((): void => {
    setEditText(draft.text);
    setIsEditing(false);
  }, [draft.text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === "Escape") {
        handleCancel();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        handleSave();
      }
    },
    [handleCancel, handleSave],
  );

  return (
    <div
      className={`flex flex-col rounded border border-red-800/50 bg-gray-900/80 font-mono ${optimisticClass}`}
      role="article"
      aria-label={`Draft by ${draft.personaName} for @${draft.targetAccountHandle}`}
    >
      {/* Header: persona + account */}
      <div className="flex items-center justify-between gap-2 border-b border-red-800/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Avatar placeholder */}
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs text-gray-400"
            aria-hidden="true"
          >
            {draft.personaName.charAt(0).toUpperCase()}
          </div>
          <span className="truncate text-sm text-gray-200">{draft.personaName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-500">@{draft.targetAccountHandle}</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-xs ${DRAFT_STATUS_COLORS[draft.status]}`}
          >
            {DRAFT_STATUS_LABELS[draft.status]}
          </span>
        </div>
      </div>

      {/* Body: tweet text / edit area */}
      <div className="flex-1 px-3 py-3">
        {isEditing ? (
          <div>
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e): void => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full resize-none rounded border border-red-800 bg-gray-800 p-2 text-sm text-gray-200 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400/50"
              rows={4}
              maxLength={MAX_CHARS + 20}
              aria-label="Edit draft text"
              aria-describedby={`chars-remaining-${draft.id}`}
            />
            <div className="mt-2 flex items-center justify-between">
              <span
                id={`chars-remaining-${draft.id}`}
                className={`text-xs ${isOverLimit ? "text-red-400" : charsRemaining <= 20 ? "text-yellow-400" : "text-gray-500"}`}
                aria-live="polite"
              >
                {charsRemaining} characters remaining
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={isOverLimit}
                  className="rounded border border-green-600/30 bg-green-600/20 px-2 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 focus:outline-none focus:ring-2 focus:ring-green-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="rounded border border-gray-600/30 bg-gray-700/50 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
            {draft.text}
          </p>
        )}
      </div>

      {/* Collapsible metadata footer */}
      <details className="px-3 pb-2 text-xs text-gray-500">
        <summary className="cursor-pointer py-1 transition-colors hover:text-gray-400">
          Generation Info
        </summary>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 border-l border-red-800/30 pl-2">
          <span>
            Model: <span className="text-gray-400">{draft.generation.model}</span>
          </span>
          <span>
            Temp: <span className="text-gray-400">{draft.generation.temperature}</span>
          </span>
          <span>
            Score: <span className="text-gray-400">{draft.generation.qualityScore}/100</span>
          </span>
          {draft.scheduledAt && (
            <span>
              Scheduled:{" "}
              <span className="text-gray-400">
                {new Date(draft.scheduledAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
          )}
          {draft.generation.promptContext && (
            <span className="col-span-2">
              Context: <span className="text-gray-400">{draft.generation.promptContext}</span>
            </span>
          )}
        </div>
      </details>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t border-red-800/30 px-3 py-2">
        {isPublished ? (
          <span className="text-xs text-gray-400">
            Published{draft.tweetId ? ` (${draft.tweetId.slice(0, 10)}...)` : ""}
          </span>
        ) : (
          <>
            <button
              onClick={(): void => {
                if (isEditing) {
                  handleCancel();
                } else {
                  setIsEditing(true);
                }
              }}
              className="rounded border border-gray-600/30 bg-gray-700/50 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400/50"
            >
              {isEditing ? "Cancel Edit" : "Edit"}
            </button>
            <button
              onClick={(): void => onApprove(draft.id)}
              disabled={draft._optimistic === true || draft.status === "approved"}
              className="rounded border border-green-600/30 bg-green-600/20 px-2 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 focus:outline-none focus:ring-2 focus:ring-green-400/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={(): void => onReject(draft.id)}
              disabled={draft._optimistic === true || draft.status === "rejected"}
              className="rounded border border-red-600/30 bg-red-600/20 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-600/30 focus:outline-none focus:ring-2 focus:ring-red-400/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
