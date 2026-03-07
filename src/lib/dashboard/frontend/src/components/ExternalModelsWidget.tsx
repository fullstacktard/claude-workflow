/**
 * ExternalModelsWidget Component
 * Displays configured external (non-Claude) models with edit/delete actions
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreVertical, Cpu } from "lucide-react";

import { TerminalCard } from "./TerminalCard";
import type { ExternalModel } from "./AddExternalModelModal";

interface ExternalModelsWidgetProps {
  /** API endpoint for external models data */
  apiEndpoint?: string;
  /** Refresh interval in milliseconds (default: 60000) */
  refreshInterval?: number;
  /** Callback when Add External Model is clicked */
  onAddModel?: () => void;
  /** Callback when Edit is clicked */
  onEditModel?: (model: ExternalModel) => void;
  /** Callback when Remove is clicked */
  onRemoveModel?: (modelId: string) => void;
  /** Additional CSS classes */
  className?: string;
}

const DEFAULT_ENDPOINT = "/api/external-models";
const DEFAULT_REFRESH_INTERVAL = 60000;

const PROVIDER_LABELS: Record<ExternalModel["provider"], string> = {
  openai: "OpenAI",
  azure: "Azure",
  ollama: "Ollama",
  custom: "Custom",
};

interface ModelCardProps {
  model: ExternalModel;
  onEdit?: (model: ExternalModel) => void;
  onRemove?: (modelId: string) => void;
}

/**
 * ModelCard Component
 * Individual external model card with dropdown menu
 */
function ModelCard({
  model,
  onEdit,
  onRemove,
}: ModelCardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside handler to close menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  return (
    <div className="min-w-[280px] shrink-0 bg-gray-900/50 rounded-lg p-4 relative border-2 border-blue-600">
      {/* Menu button */}
      <div className="absolute top-2 right-2" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
          aria-label="Model actions"
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-gray-950 border-1 border-red-800 rounded-md shadow-xl z-[200] py-1 min-w-32">
            {onEdit && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-red-900/20 transition-colors"
                onClick={() => {
                  onEdit(model);
                  setMenuOpen(false);
                }}
              >
                Edit
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                onClick={() => {
                  onRemove(model.id);
                  setMenuOpen(false);
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      {/* Model info */}
      <div className="pr-8">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-4 h-4 text-blue-400" />
          <span className="text-white font-medium truncate">{model.name}</span>
        </div>
        <div className="text-sm text-gray-400 space-y-1">
          <div>Provider: {PROVIDER_LABELS[model.provider]}</div>
          <div className="truncate">Model: {model.modelId}</div>
          {model.maxTokens !== undefined && <div>Max Tokens: {model.maxTokens}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * ExternalModelsWidget component
 */
export function ExternalModelsWidget({
  apiEndpoint = DEFAULT_ENDPOINT,
  refreshInterval = DEFAULT_REFRESH_INTERVAL,
  onAddModel,
  onEditModel,
  onRemoveModel,
  className = "",
}: ExternalModelsWidgetProps): JSX.Element {
  const [models, setModels] = useState<ExternalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchModels = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(apiEndpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = (await response.json()) as ExternalModel[];
      setModels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    void fetchModels();
    const interval = setInterval(() => {
      fetchModels().catch((err: unknown) => {
        console.error("[ExternalModelsWidget] Periodic refresh failed:", err);
      });
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchModels, refreshInterval]);

  // Loading state
  if (loading && models.length === 0) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.claude-workflow/external-models.json"
        allowOverflow={true}
        noPadding
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full px-4 py-4">
          <div className="spinner w-8 h-8 mb-4" />
          <p className="text-gray-400">Loading external models...</p>
        </div>
      </TerminalCard>
    );
  }

  // Error state
  if (error !== null && models.length === 0) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.claude-workflow/external-models.json"
        allowOverflow={true}
        noPadding
        className={className}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">Failed to fetch external models</p>
        </div>
      </TerminalCard>
    );
  }

  // Empty state
  if (models.length === 0 && !loading) {
    return (
      <TerminalCard
        command="cat"
        filename="~/.claude-workflow/external-models.json"
        allowOverflow={true}
        noPadding
        headerActions={
          onAddModel ? (
            <button
              className="bg-transparent border-1 border-red-800 text-gray-400 hover:bg-red-800 hover:text-gray-900 h-7 px-3 text-xs rounded-md transition-colors"
              onClick={onAddModel}
              type="button"
            >
              Add External Model
            </button>
          ) : undefined
        }
        className={className}
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">No external models configured</p>
        </div>
      </TerminalCard>
    );
  }

  // Data state
  return (
    <TerminalCard
      command="cat"
      filename="~/.claude-workflow/external-models.json"
      allowOverflow={true}
      noPadding
      headerText={`${models.length} External Model${models.length !== 1 ? "s" : ""}`}
      headerActions={
        onAddModel ? (
          <button
            className="bg-transparent border-1 border-red-800 text-gray-400 hover:bg-red-800 hover:text-gray-900 h-7 px-3 text-xs rounded-md transition-colors"
            onClick={onAddModel}
            type="button"
          >
            Add External Model
          </button>
        ) : undefined
      }
      className={className}
    >
      <div className="p-4">
        <div
          className={
            models.length > 4
              ? "flex gap-4 overflow-x-auto scrollbar-hide"
              : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          }
        >
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onEdit={onEditModel}
              onRemove={onRemoveModel}
            />
          ))}
        </div>
      </div>
    </TerminalCard>
  );
}
