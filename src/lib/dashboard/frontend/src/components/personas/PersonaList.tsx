/**
 * PersonaList Component
 *
 * Left panel of the personas master-detail layout.
 * Provides search filtering, scrollable persona cards with status badges,
 * "Create New" and "Import" buttons, and drag-and-drop JSON import.
 *
 * Pattern: Replicates XAccountList.tsx -- same TerminalCard wrapper,
 * search input, skeleton, error, and empty states.
 *
 * @module components/personas/PersonaList
 */

import { useState, useMemo, useCallback, useRef } from "react";
import { Search, Plus, Upload } from "lucide-react";

import { TerminalCard } from "../TerminalCard";
import type { DashboardPersona, PersonaCharacterFile } from "../../types/persona";
import { validateCharacterFile } from "../../types/persona";

interface PersonaListProps {
  /** All personas from usePersonas hook */
  personas: DashboardPersona[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Currently selected persona ID */
  selectedId: string | null;
  /** Callback when a persona card is clicked */
  onSelect: (personaId: string) => void;
  /** Callback to create a new persona from partial data */
  onCreate: (data: Partial<PersonaCharacterFile>) => Promise<void>;
  /** Optional className for TerminalCard wrapper */
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-900/50 text-green-400 border-green-700",
  draft: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  archived: "bg-gray-800/50 text-gray-500 border-gray-600",
};

export function PersonaList({
  personas,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  className = "",
}: PersonaListProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredPersonas = useMemo(() => {
    if (!searchQuery.trim()) return personas;
    const q = searchQuery.toLowerCase();
    return personas.filter((p) => p.name.toLowerCase().includes(q));
  }, [personas, searchQuery]);

  const handleImportFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        const validationError = validateCharacterFile(parsed);
        if (validationError !== null) {
          setImportError(validationError);
          return;
        }
        setImportError(null);
        await onCreate(parsed as Partial<PersonaCharacterFile>);
      } catch {
        setImportError("Failed to parse JSON file");
      }
    },
    [onCreate],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".json")) {
        void handleImportFile(file);
      } else {
        setImportError("Please drop a .json file");
      }
    },
    [handleImportFile],
  );

  // Loading skeleton
  if (loading && personas.length === 0) {
    return (
      <TerminalCard command="ls" filename="personas/" noPadding className={className}>
        <div className="p-3 animate-pulse flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`skeleton-${String(i)}`} className="bg-gray-900/50 rounded-md p-3 border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-4 w-20 bg-gray-800/50 rounded" />
                <div className="h-3.5 w-12 bg-gray-800/35 rounded-full" />
              </div>
              <div className="h-3 w-16 bg-gray-800/20 rounded" />
            </div>
          ))}
        </div>
      </TerminalCard>
    );
  }

  // Error state
  if (error !== null && personas.length === 0) {
    return (
      <TerminalCard command="ls" filename="personas/" noPadding className={className}>
        <div className="flex items-center justify-center h-full p-6">
          <p className="text-gray-500 text-sm">Failed to load personas. Is MCP Proxy running?</p>
        </div>
      </TerminalCard>
    );
  }

  return (
    <TerminalCard
      command="ls"
      filename="personas/"
      noPadding
      headerText={`${String(personas.length)} Persona${personas.length !== 1 ? "s" : ""}`}
      headerActions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void onCreate({ name: "New Persona", bio: [""] })}
            className="h-6 px-2 text-xs rounded border border-red-800 text-gray-400 hover:bg-red-800 hover:text-white transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-6 px-2 text-xs rounded border border-red-800 text-gray-400 hover:bg-red-800 hover:text-white transition-colors flex items-center gap-1"
          >
            <Upload className="w-3 h-3" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
        </div>
      }
      className={className}
    >
      {/* Search input */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter personas by name"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      </div>

      {/* Import error toast */}
      {importError !== null && (
        <div className="mx-3 mb-2 px-3 py-1.5 text-xs bg-red-900/50 border border-red-700 rounded text-red-300">
          {importError}
          <button type="button" onClick={() => setImportError(null)} className="ml-2 text-red-400 hover:text-white">
            dismiss
          </button>
        </div>
      )}

      {/* Drop zone + scrollable card list */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pb-3 ${isDragOver ? "ring-2 ring-red-600 ring-inset bg-red-900/10" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="flex items-center justify-center py-8 text-red-400 text-xs border-2 border-dashed border-red-800 rounded mb-2">
            Drop .json character file here
          </div>
        )}
        <div className="flex flex-col gap-2" role="listbox" aria-label="Personas">
          {filteredPersonas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              onClick={() => onSelect(persona.id)}
              role="option"
              aria-selected={persona.id === selectedId}
              className={`w-full text-left p-3 rounded-md border transition-colors ${
                persona.id === selectedId
                  ? "border-red-600 bg-red-900/20"
                  : "border-gray-700 bg-gray-900/50 hover:border-gray-600 hover:bg-gray-800/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-mono text-white truncate">{persona.name}</span>
                <span
                  className={`px-1.5 py-0.5 text-xs rounded border ${STATUS_COLORS[persona.status] ?? STATUS_COLORS.draft}`}
                >
                  {persona.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{persona.topicCount} topics</span>
                <span>|</span>
                <span>
                  {(persona.linkedAccountIds ?? []).length} account
                  {(persona.linkedAccountIds ?? []).length !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
          ))}
          {filteredPersonas.length === 0 && searchQuery.trim() !== "" && (
            <p className="text-gray-500 text-xs text-center py-4">
              No personas matching &quot;{searchQuery}&quot;
            </p>
          )}
        </div>
      </div>
    </TerminalCard>
  );
}
