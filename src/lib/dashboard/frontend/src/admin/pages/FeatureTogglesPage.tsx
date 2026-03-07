/**
 * FeatureTogglesPage Component
 *
 * Admin matrix for toggling feature sub-items (agents, skills, commands, workflows)
 * per pricing tier (Free / Pro / All). Reads from FEATURE_GROUPS_DATA registry.
 *
 * Layout:
 *   - Header: title, subtitle with sub-item count, expand/collapse toggle
 *   - Matrix: scrollable area with sticky column headers and collapsible group rows
 *   - UnsavedChangesBar: appears at bottom when toggles !== savedToggles
 *   - DiffReviewModal: opens before saving to review all changes
 *
 * @module pages/FeatureTogglesPage
 */

import { useState, useMemo } from "react";
import { ToggleLeft, ChevronDown, ChevronRight } from "lucide-react";

import { FEATURE_GROUPS_DATA, SUB_ITEM_TYPES } from "../types/featureToggle";
import { FeatureMatrix } from "../components/feature-toggles/FeatureMatrix";
import { UnsavedChangesBar } from "../components/feature-toggles/UnsavedChangesBar";
import { DiffReviewModal } from "../components/feature-toggles/DiffReviewModal";
import { useFeatureMatrix } from "../hooks/useFeatureMatrix";

export function FeatureTogglesPage(): JSX.Element {
  const {
    toggles,
    dispatch,
    isDirty,
    changeCount,
    diffEntries,
    save,
    discard,
  } = useFeatureMatrix(FEATURE_GROUPS_DATA);

  const [expandAll, setExpandAll] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);

  // Calculate total sub-item count across all groups
  const totalSubItems = useMemo(() => {
    let count = 0;
    for (const group of FEATURE_GROUPS_DATA) {
      for (const type of SUB_ITEM_TYPES) {
        count += group[type].length;
      }
    }
    return count;
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <ToggleLeft size={22} className="text-red-400" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-gray-100">
              Feature Toggles
            </h1>
            <p className="text-xs text-gray-500">
              {FEATURE_GROUPS_DATA.length} groups &middot; {totalSubItems}{" "}
              sub-items &middot; 3 tiers
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpandAll((prev) => !prev)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-700 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
          aria-label={expandAll ? "Collapse all groups" : "Expand all groups"}
        >
          {expandAll ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          {expandAll ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Matrix */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FeatureMatrix
          featureGroups={FEATURE_GROUPS_DATA}
          toggles={toggles}
          dispatch={dispatch}
          expandAll={expandAll}
        />
      </div>

      {/* Unsaved changes bar */}
      {isDirty && (
        <UnsavedChangesBar
          changeCount={changeCount}
          onSave={() => setShowDiffModal(true)}
          onDiscard={discard}
        />
      )}

      {/* Diff review modal */}
      {showDiffModal && (
        <DiffReviewModal
          diffEntries={diffEntries}
          onConfirm={() => {
            save();
            setShowDiffModal(false);
          }}
          onCancel={() => setShowDiffModal(false)}
        />
      )}
    </div>
  );
}
