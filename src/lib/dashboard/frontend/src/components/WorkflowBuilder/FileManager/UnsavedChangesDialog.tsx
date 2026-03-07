/**
 * UnsavedChangesDialog Component
 * Warning modal for unsaved changes with Save/Don't Save/Cancel options
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface UnsavedChangesDialogProps {
  onClose: () => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}

export function UnsavedChangesDialog({
  onClose,
  onSave,
  onDiscard,
}: UnsavedChangesDialogProps): JSX.Element {
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !saving) {
      onClose();
    }
  };

  // Focus first button on mount
  useEffect(() => {
    if (modalRef.current) {
      const firstButton = modalRef.current.querySelector<HTMLElement>('button');
      firstButton?.focus();
    }
  }, []);

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={saving ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        aria-describedby="unsaved-dialog-description"
        onKeyDown={handleKeyDown}
      >
        <div className="p-6">
          {/* Icon and title */}
          <div className="flex items-start gap-4 mb-4">
            <div className="shrink-0 w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-yellow-400" aria-hidden="true" />
            </div>
            <div>
              <h2 id="unsaved-dialog-title" className="text-lg font-semibold text-white">
                Unsaved Changes
              </h2>
              <p id="unsaved-dialog-description" className="text-sm text-gray-400 mt-1">
                You have unsaved changes. Do you want to save them before continuing?
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md border border-red-800 text-gray-400 hover:bg-red-800/50 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md border border-red-700 text-red-400 hover:bg-red-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Don&apos;t Save
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-red-700 text-white hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
