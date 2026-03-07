/**
 * FileToolbar Component
 * Main toolbar for file operations (New, Open, Save, Save As)
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, FolderOpen, Save, FilePlus } from 'lucide-react';
import type { CanvasState, WorkflowMetadata } from './types';
import { OpenDialog } from './OpenDialog';
import { SaveAsDialog } from './SaveAsDialog';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { Toast } from './Toast';

interface FileToolbarProps {
  canvasState: CanvasState;
  onNew: () => void;
  onOpen: (workflow: WorkflowMetadata) => void;
  onSave: () => Promise<void>;
  onSaveAs: (name: string, tier: 'user' | 'project') => Promise<void>;
}

export function FileToolbar({
  canvasState,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
}: FileToolbarProps): JSX.Element {
  const [activeModal, setActiveModal] = useState<'open' | 'saveAs' | 'unsaved' | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleNew = useCallback(() => {
    if (canvasState.isDirty) {
      // Show unsaved changes warning
      setPendingAction(() => onNew);
      setActiveModal('unsaved');
    } else {
      onNew();
    }
  }, [canvasState.isDirty, onNew]);

  const handleOpen = useCallback(() => {
    if (canvasState.isDirty) {
      setPendingAction(() => () => setActiveModal('open'));
      setActiveModal('unsaved');
    } else {
      setActiveModal('open');
    }
  }, [canvasState.isDirty]);

  const handleSave = useCallback(async () => {
    if (!canvasState.currentFile) return;

    try {
      await onSave();
      setToast({ type: 'success', message: 'Workflow saved successfully' });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save workflow',
      });
    }
  }, [canvasState.currentFile, onSave]);

  const handleSaveAs = useCallback(() => {
    setActiveModal('saveAs');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      if (e.key === 'n') {
        e.preventDefault();
        handleNew();
      } else if (e.key === 'o') {
        e.preventDefault();
        handleOpen();
      } else if (e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          void handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  const isSaveDisabled = !canvasState.currentFile || canvasState.currentFile.readonly;

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
        {/* New Button */}
        <button
          onClick={handleNew}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-900"
          aria-label="New workflow (Ctrl+N)"
          title="New (Ctrl+N)"
        >
          <FilePlus className="w-4 h-4" aria-hidden="true" />
          <span>New</span>
        </button>

        {/* Open Button */}
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-900"
          aria-label="Open workflow (Ctrl+O)"
          title="Open (Ctrl+O)"
        >
          <FolderOpen className="w-4 h-4" aria-hidden="true" />
          <span>Open</span>
        </button>

        {/* Save Button */}
        <button
          onClick={() => void handleSave()}
          disabled={isSaveDisabled}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
          aria-label="Save workflow (Ctrl+S)"
          title="Save (Ctrl+S)"
        >
          <Save className="w-4 h-4" aria-hidden="true" />
          <span>Save</span>
        </button>

        {/* Save As Button */}
        <button
          onClick={handleSaveAs}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-900"
          aria-label="Save workflow as (Ctrl+Shift+S)"
          title="Save As (Ctrl+Shift+S)"
        >
          <FileText className="w-4 h-4" aria-hidden="true" />
          <span>Save As</span>
        </button>

        {/* Current file indicator */}
        {canvasState.currentFile && (
          <div className="ml-auto flex items-center gap-2 text-sm text-gray-400">
            <span>{canvasState.currentFile.name}</span>
            {canvasState.isDirty && (
              <span className="text-yellow-400" aria-label="Unsaved changes">
                •
              </span>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {activeModal === 'open' && (
        <OpenDialog
          onClose={() => setActiveModal(null)}
          onSelect={(workflow) => {
            setActiveModal(null);
            onOpen(workflow);
          }}
        />
      )}

      {activeModal === 'saveAs' && (
        <SaveAsDialog
          onClose={() => setActiveModal(null)}
          onSave={async (name, tier) => {
            try {
              await onSaveAs(name, tier);
              setActiveModal(null);
              setToast({ type: 'success', message: `Workflow saved as "${name}"` });
            } catch (error) {
              setToast({
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to save workflow',
              });
            }
          }}
        />
      )}

      {activeModal === 'unsaved' && (
        <UnsavedChangesDialog
          onClose={() => {
            setActiveModal(null);
            setPendingAction(null);
          }}
          onSave={async () => {
            await handleSave();
            setActiveModal(null);
            pendingAction?.();
            setPendingAction(null);
          }}
          onDiscard={() => {
            setActiveModal(null);
            pendingAction?.();
            setPendingAction(null);
          }}
        />
      )}

      {/* Toast notifications */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
