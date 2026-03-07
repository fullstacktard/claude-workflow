/**
 * FeatureMatrix Component
 *
 * The main matrix layout with tier column headers (Free / Pro / All)
 * and all 13 feature group rows from FEATURE_GROUPS.
 *
 * Composes:
 *   - Sticky column headers with tier labels
 *   - FeatureGroupRow for each feature group
 */

import type { FeatureGroup } from "../../types/featureToggle";
import type { ToggleAction } from "../../hooks/useFeatureMatrix";
import { FeatureGroupRow } from "./FeatureGroupRow";

const TIER_COLUMNS = [
  { id: "free", label: "Free", color: "text-green-400" },
  { id: "pro", label: "Pro", color: "text-amber-400" },
  { id: "all", label: "All", color: "text-red-400" },
] as const;

interface FeatureMatrixProps {
  featureGroups: FeatureGroup[];
  toggles: Record<string, boolean>;
  dispatch: React.Dispatch<ToggleAction>;
  expandAll: boolean;
}

export function FeatureMatrix({
  featureGroups,
  toggles,
  dispatch,
  expandAll,
}: FeatureMatrixProps): JSX.Element {
  return (
    <div className="min-w-[600px]">
      {/* Column headers */}
      <div className="sticky top-0 z-10 flex items-center border-b border-gray-700 bg-gray-900 py-2 pl-10 pr-4">
        <div className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Feature Group
        </div>
        <div className="flex items-center gap-6" role="presentation">
          {TIER_COLUMNS.map((tier) => (
            <div
              key={tier.id}
              className={`w-16 text-center text-[11px] font-semibold uppercase tracking-wide ${tier.color}`}
            >
              {tier.label}
            </div>
          ))}
        </div>
      </div>

      {/* Group rows */}
      <div role="list" aria-label="Feature groups">
        {featureGroups.map((group) => (
          <FeatureGroupRow
            key={group.id}
            group={group}
            toggles={toggles}
            dispatch={dispatch}
            expandAll={expandAll}
          />
        ))}
      </div>
    </div>
  );
}
