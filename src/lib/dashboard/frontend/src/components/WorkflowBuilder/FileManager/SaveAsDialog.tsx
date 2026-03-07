/**
 * SaveAsDialog Component
 * Modal for saving workflow with tier selection and name input
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SaveAsDialogProps {
  onClose: () => void;
  onSave: (name: string, tier: 'user' | 'project') => Promise<void>;
}

export function SaveAsDialog({ onClose, onSave }: SaveAsDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [tier, setTier] = useState<'user' | 'project'>('user');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input on mount
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Workflow name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(name.trim(), tier);
      // Parent will handle success toast and close
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !saving) {
      onClose();
    }
  };

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
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-lg w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-red-800">
            <h2 id="save-as-dialog-title" className="text-lg font-semibold text-white">
              Save Workflow As
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-red-800/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            {/* Name field */}
            <div>
              <label htmlFor="workflow-name" className="block text-sm font-medium text-gray-300 mb-1">
                Workflow Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={nameInputRef}
                id="workflow-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2 bg-gray-950 border border-red-800 rounded-md text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:opacity-50"
                placeholder="Enter workflow name"
                required
              />
            </div>

            {/* Description field */}
            <div>
              <label htmlFor="workflow-description" className="block text-sm font-medium text-gray-300 mb-1">
                Description (optional)
              </label>
              <textarea
                id="workflow-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                rows={3}
                className="w-full px-3 py-2 bg-gray-950 border border-red-800 rounded-md text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:opacity-50 resize-none"
                placeholder="Optional description"
              />
            </div>

            {/* Tier selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Save Location <span className="text-red-400">*</span>
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-red-800 rounded-md hover:bg-red-800/20 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="tier"
                    value="user"
                    checked={tier === 'user'}
                    onChange={() => setTier('user')}
                    disabled={saving}
                    className="mt-0.5 focus:ring-2 focus:ring-red-500"
                  />
                  <div>
                    <div className="font-medium text-white">User Workflows</div>
                    <div className="text-sm text-gray-400">
                      Saved to your personal workflow library (~/.claude/workflows)
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-red-800 rounded-md hover:bg-red-800/20 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="tier"
                    value="project"
                    checked={tier === 'project'}
                    onChange={() => setTier('project')}
                    disabled={saving}
                    className="mt-0.5 focus:ring-2 focus:ring-red-500"
                  />
                  <div>
                    <div className="font-medium text-white">Project Workflows</div>
                    <div className="text-sm text-gray-400">
                      Saved to current project (.claude/workflows)
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 rounded-md bg-red-900/20 border border-red-800/50 text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-red-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md border border-red-800 text-gray-400 hover:bg-red-800/50 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-red-700 text-white hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
