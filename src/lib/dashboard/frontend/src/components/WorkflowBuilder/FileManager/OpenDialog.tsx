/**
 * OpenDialog Component
 * Modal for selecting and opening workflows from all tiers
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search } from 'lucide-react';
import type { WorkflowMetadata } from './types';

interface OpenDialogProps {
  onClose: () => void;
  onSelect: (workflow: WorkflowMetadata) => void;
}

export function OpenDialog({ onClose, onSelect }: OpenDialogProps): JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load workflows on mount
  useEffect(() => {
    async function loadWorkflows(): Promise<void> {
      try {
        const response = await fetch('/api/workflows');
        if (!response.ok) {
          throw new Error(`Failed to load workflows: ${response.statusText}`);
        }
        const allWorkflows: WorkflowMetadata[] = await response.json();
        setWorkflows(allWorkflows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflows');
      } finally {
        setLoading(false);
      }
    }
    void loadWorkflows();
  }, []);

  // Filter workflows by search query
  const filteredWorkflows = workflows.filter(
    (w) =>
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group by tier
  const builtIn = filteredWorkflows.filter((w) => w.tier === 'built-in');
  const user = filteredWorkflows.filter((w) => w.tier === 'user');
  const project = filteredWorkflows.filter((w) => w.tier === 'project');

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // Focus trap (same pattern as AddAccountModal)
  useEffect(() => {
    if (modalRef.current) {
      const firstInput = modalRef.current.querySelector<HTMLElement>('input');
      firstInput?.focus();
    }
  }, []);

  const renderWorkflowGroup = (title: string, items: WorkflowMetadata[]): JSX.Element | null => {
    if (items.length === 0) return null;

    return (
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          {title}
        </h3>
        <div className="space-y-1">
          {items.map((workflow) => (
            <button
              key={workflow.id}
              onClick={() => onSelect(workflow)}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-red-800/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <div className="font-medium text-white">{workflow.name}</div>
              {workflow.description && (
                <div className="text-sm text-gray-400 mt-0.5">{workflow.description}</div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                Last updated: {new Date(workflow.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-dialog-title"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-800">
          <h2 id="open-dialog-title" className="text-lg font-semibold text-white">
            Open Workflow
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-red-800/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-red-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workflows..."
              className="w-full pl-10 pr-4 py-2 bg-gray-950 border border-red-800 rounded-md text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="text-center py-8 text-gray-400">Loading workflows...</div>
          )}

          {error && (
            <div className="p-4 rounded-md bg-red-900/20 border border-red-800/50 text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && filteredWorkflows.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              {searchQuery ? 'No workflows found matching your search' : 'No workflows available'}
            </div>
          )}

          {!loading && !error && filteredWorkflows.length > 0 && (
            <>
              {renderWorkflowGroup('Built-in Workflows', builtIn)}
              {renderWorkflowGroup('User Workflows', user)}
              {renderWorkflowGroup('Project Workflows', project)}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-red-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md border border-red-800 text-gray-400 hover:bg-red-800/50 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
