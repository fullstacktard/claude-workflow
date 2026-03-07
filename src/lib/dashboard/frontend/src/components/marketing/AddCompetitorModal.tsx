/**
 * AddCompetitorModal Component
 *
 * Modal for adding a new competitor to track. Accepts handle,
 * category selection, and optional notes.
 *
 * @module components/marketing/AddCompetitorModal
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AddCompetitorFormData, CompetitorCategory } from "../../types/marketing";
import { CATEGORY_LABELS } from "../../types/marketing";

interface AddCompetitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AddCompetitorFormData) => Promise<void>;
}

const CATEGORY_OPTIONS: CompetitorCategory[] = [
  "direct_competitor",
  "indirect_competitor",
  "industry_leader",
  "aspirational",
  "other",
];

export function AddCompetitorModal({
  isOpen,
  onClose,
  onSubmit,
}: AddCompetitorModalProps): JSX.Element | null {
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState<CompetitorCategory>("direct_competitor");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback((): void => {
    setHandle("");
    setCategory("direct_competitor");
    setNotes("");
    setError(null);
    setIsSubmitting(false);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedHandle = handle.trim().replace(/^@/, "");
    if (!trimmedHandle) {
      setError("Handle is required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({ handle: trimmedHandle, category, notes: notes.trim() });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add competitor");
      setIsSubmitting(false);
    }
  }, [handle, category, notes, onSubmit, handleClose]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === "Escape") {
        handleClose();
        return;
      }
      if (event.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const active = document.activeElement as HTMLElement;
        const idx = focusable.indexOf(active);
        if (event.shiftKey) {
          event.preventDefault();
          focusable[idx <= 0 ? focusable.length - 1 : idx - 1]?.focus();
        } else {
          event.preventDefault();
          focusable[idx === -1 || idx === focusable.length - 1 ? 0 : idx + 1]?.focus();
        }
      }
    },
    [handleClose]
  );

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && modalRef.current) {
      const first = modalRef.current.querySelector<HTMLElement>("input");
      first?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-competitor-title"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-red-800">
          <h2 id="add-competitor-title" className="text-white font-medium font-mono">
            Add Competitor
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 rounded transition-colors hover:text-white hover:bg-red-800/50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-md border bg-red-900/20 border-red-800/50">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Handle input */}
          <div>
            <label htmlFor="competitor-handle" className="block text-sm mb-1.5 text-gray-400">
              X Handle
            </label>
            <input
              id="competitor-handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@competitor_handle"
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
              disabled={isSubmitting}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  void handleSubmit();
                }
              }}
            />
          </div>

          {/* Category select */}
          <div>
            <label htmlFor="competitor-category" className="block text-sm mb-1.5 text-gray-400">
              Category
            </label>
            <select
              id="competitor-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as CompetitorCategory)}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
              disabled={isSubmitting}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Notes textarea */}
          <div>
            <label htmlFor="competitor-notes" className="block text-sm mb-1.5 text-gray-400">
              Notes (optional)
            </label>
            <textarea
              id="competitor-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why are you tracking this competitor?"
              rows={3}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!handle.trim() || isSubmitting}
              className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
            >
              {isSubmitting ? "Adding..." : "Add Competitor"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
