/**
 * FeatureGroupRow Component
 *
 * Collapsible row for a feature group with parent-level tier checkboxes
 * that reflect aggregate state (checked / unchecked / indeterminate).
 * Memoized to prevent re-renders when sibling groups change.
 *
 * Parent checkbox states:
 *   - Checked: all sub-items for that tier are enabled
 *   - Unchecked: all sub-items for that tier are disabled
 *   - Indeterminate: mixed state (some on, some off)
 */

import { memo, useState, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown, Info } from "lucide-react";

import type { FeatureGroup, TierName } from "../../types/featureToggle";
import {
  TIERS,
  TIER_HIERARCHY,
  SUB_ITEM_TYPES,
} from "../../types/featureToggle";
import type { ToggleAction } from "../../hooks/useFeatureMatrix";
import { TierCheckbox } from "./TierCheckbox";
import { SubItemRow } from "./SubItemRow";

interface FeatureGroupRowProps {
  group: FeatureGroup;
  toggles: Record<string, boolean>;
  dispatch: React.Dispatch<ToggleAction>;
  expandAll: boolean;
  autoEnabledBy?: string;
}

export const FeatureGroupRow = memo(function FeatureGroupRow({
  group,
  toggles,
  dispatch,
  expandAll,
  autoEnabledBy,
}: FeatureGroupRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  // Sync with expandAll prop
  useEffect(() => {
    setExpanded(expandAll);
  }, [expandAll]);

  const subItemCount = useMemo(
    () =>
      group.agents.length +
      group.skills.length +
      group.commands.length +
      group.workflows.length,
    [group],
  );

  const requiredLevel = TIER_HIERARCHY[group.requiredTier] ?? 0;

  // Compute parent checkbox state per tier
  const tierStates = useMemo(() => {
    const result: Record<
      string,
      { checked: boolean; indeterminate: boolean; locked: boolean }
    > = {};

    for (const tier of TIERS) {
      const tierLevel = TIER_HIERARCHY[tier];
      const locked = tierLevel < requiredLevel;

      if (locked || subItemCount === 0) {
        result[tier] = { checked: false, indeterminate: false, locked };
        continue;
      }

      const subKeys: string[] = [];
      for (const type of SUB_ITEM_TYPES) {
        for (const item of group[type]) {
          subKeys.push(`${group.id}:${type}:${item}:${tier}`);
        }
      }

      const onCount = subKeys.filter((k) => Boolean(toggles[k])).length;
      const allOn = onCount === subKeys.length;
      const allOff = onCount === 0;

      result[tier] = {
        checked: allOn,
        indeterminate: !allOn && !allOff,
        locked: false,
      };
    }

    return result;
  }, [toggles, group, requiredLevel, subItemCount]);

  // Tier badge color
  const tierBadgeClasses =
    group.requiredTier === "free"
      ? "bg-green-500/10 text-green-400"
      : group.requiredTier === "pro"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-red-500/10 text-red-400";

  return (
    <div className="border-b border-gray-800">
      {/* Group header row */}
      <div
        className="flex cursor-pointer items-center py-2.5 pl-3 pr-4 transition-colors hover:bg-gray-900/50"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${group.name} feature group, ${subItemCount} items`}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        {/* Expand/collapse icon */}
        <div className="mr-2 text-gray-500" aria-hidden="true">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>

        {/* Group name + meta */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">
            {group.name}
          </span>
          <span className="text-[10px] text-gray-500">
            {subItemCount} items
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tierBadgeClasses}`}
          >
            {group.requiredTier}
          </span>
          {group.dependencies.length > 0 && (
            <span className="text-[10px] text-gray-600">
              deps: {group.dependencies.join(", ")}
            </span>
          )}
          {autoEnabledBy && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400">
              <Info size={10} />
              auto-enabled by {autoEnabledBy}
            </span>
          )}
        </div>

        {/* Parent tier checkboxes */}
        <div
          className="flex items-center gap-6"
          onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => e.stopPropagation()}
          role="presentation"
        >
          {TIERS.map((tier: TierName) => {
            const st = tierStates[tier];
            return (
              <div key={tier} className="flex w-16 justify-center">
                <TierCheckbox
                  checked={st.checked}
                  indeterminate={st.indeterminate}
                  locked={st.locked}
                  lockTooltip={`Requires ${group.requiredTier} tier or higher`}
                  ariaLabel={`Toggle all ${group.name} items in ${tier} tier`}
                  onChange={(checked: boolean) =>
                    dispatch({
                      type: "TOGGLE_GROUP_TIER",
                      groupId: group.id,
                      tierId: tier,
                      value: checked,
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Sub-item rows (only when expanded) */}
      {expanded && (
        <div className="bg-gray-950/50">
          {SUB_ITEM_TYPES.map((type) =>
            group[type].map((itemId: string) => (
              <SubItemRow
                key={`${type}:${itemId}`}
                groupId={group.id}
                type={type}
                itemId={itemId}
                requiredTier={group.requiredTier}
                toggles={toggles}
                dispatch={dispatch}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
});
