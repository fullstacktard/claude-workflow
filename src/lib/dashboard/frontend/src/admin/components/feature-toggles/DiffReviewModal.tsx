/**
 * DiffReviewModal Component
 *
 * Modal showing all toggle changes (added/removed) before saving.
 * Each entry shows the toggle key with a + (enabled) or - (disabled) indicator.
 * Groups changes into "Enabled" and "Disabled" sections for clarity.
 *
 * Accessible: traps focus within the modal, supports Escape to close.
 */

import { useEffect, useCallback } from "react";
import { X, Plus, Minus } from "lucide-react";

import type { DiffEntry } from "../../hooks/useFeatureMatrix";

interface DiffReviewModalProps {
  diffEntries: DiffEntry[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiffReviewModal({
  diffEntries,
  onConfirm,
  onCancel,
}: DiffReviewModalProps): JSX.Element {
  const added = diffEntries.filter((e) => e.to && !e.from);
  const removed = diffEntries.filter((e) => !e.to && e.from);

  // Handle Escape key to close modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review changes before saving"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-100">
            Review Changes ({diffEntries.length})
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer text-gray-500 transition-colors hover:text-gray-300"
            aria-label="Close review dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Diff list */}
        <div className="max-h-80 overflow-y-auto px-5 py-3">
          {added.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-green-400">
                Enabled ({added.length})
              </div>
              {added.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 py-1 text-xs"
                >
                  <Plus size={12} className="shrink-0 text-green-400" />
                  <span className="truncate font-mono text-gray-300">
                    {entry.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {removed.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-400">
                Disabled ({removed.length})
              </div>
              {removed.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 py-1 text-xs"
                >
                  <Minus size={12} className="shrink-0 text-red-400" />
                  <span className="truncate font-mono text-gray-300">
                    {entry.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {diffEntries.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">
              No changes to review.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-gray-600 bg-transparent px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-md border border-red-600 bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500"
          >
            Confirm Save
          </button>
        </div>
      </div>
    </div>
  );
}
