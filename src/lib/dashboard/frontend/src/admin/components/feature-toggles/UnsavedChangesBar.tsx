/**
 * UnsavedChangesBar Component
 *
 * Fixed bottom bar showing unsaved change count with Save and Discard actions.
 * Only renders when isDirty is true (parent controls visibility).
 * Uses amber/warning styling to alert the user of pending changes.
 */

import { AlertTriangle } from "lucide-react";

interface UnsavedChangesBarProps {
  changeCount: number;
  onSave: () => void;
  onDiscard: () => void;
}

export function UnsavedChangesBar({
  changeCount,
  onSave,
  onDiscard,
}: UnsavedChangesBarProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-between border-t border-amber-800/50 bg-amber-900/20 px-4 py-2.5 sm:px-6"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-amber-300">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="cursor-pointer rounded-md border border-gray-600 bg-transparent px-3.5 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSave}
          className="cursor-pointer rounded-md border border-red-600 bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
        >
          Review &amp; Save
        </button>
      </div>
    </div>
  );
}
