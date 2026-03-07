/**
 * DraftFilters Component
 *
 * Status filter tabs (All | Pending | Approved | Rejected | Published) and
 * persona dropdown for the draft review queue.
 *
 * Terminal aesthetic: tab-style filter bar with red-400 active state.
 *
 * @module components/drafts/DraftFilters
 */

import type { DraftFilterState } from "../../types/draft";
import { DRAFT_STATUS_TABS } from "../../types/draft";

interface PersonaOption {
  id: string;
  name: string;
}

interface DraftFiltersProps {
  /** Current filter state */
  filters: DraftFilterState;
  /** Called when any filter changes */
  onFiltersChange: (filters: DraftFilterState) => void;
  /** Available personas for dropdown */
  personas?: PersonaOption[];
}

export function DraftFilters({ filters, onFiltersChange, personas = [] }: DraftFiltersProps): JSX.Element {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-red-800/30 px-4 py-2"
      role="toolbar"
      aria-label="Draft filters"
    >
      {/* Status tabs */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Filter by status">
        {DRAFT_STATUS_TABS.map((tab) => {
          const isActive = filters.status === tab.value;
          return (
            <button
              key={tab.value}
              onClick={(): void => onFiltersChange({ ...filters, status: tab.value })}
              className={`rounded px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/50 ${
                isActive
                  ? "border border-red-600/30 bg-red-600/20 text-red-400"
                  : "border border-transparent text-gray-500 hover:text-gray-300"
              }`}
              role="tab"
              aria-selected={isActive}
              aria-controls="draft-grid"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Persona dropdown */}
      <label className="sr-only" htmlFor="persona-filter">
        Filter by persona
      </label>
      <select
        id="persona-filter"
        value={filters.personaId ?? ""}
        onChange={(e): void =>
          onFiltersChange({
            ...filters,
            personaId: e.target.value || null,
          })
        }
        className="appearance-none rounded border border-red-800/30 bg-gray-800 px-2 py-1 pr-7 text-xs text-gray-400 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400/50"
      >
        <option value="">All Personas</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}
