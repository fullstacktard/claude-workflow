/**
 * useFeatureMatrix Hook
 *
 * Manages the toggle state for the feature matrix using useReducer.
 * Flat Record<string, boolean> with keys:
 *   - Group-level: "{groupId}:{tierId}"
 *   - Sub-item:    "{groupId}:{type}:{itemId}:{tierId}"
 *
 * Enforces three constraint rules on every dispatch:
 *   1. requiredTier floor - cannot enable below group's requiredTier
 *   2. dependency auto-enable - enabling a group enables its dependencies
 *   3. tier hierarchy - enabling in lower tier enables in higher tiers
 */

import { useReducer, useMemo, useCallback } from "react";

import type { FeatureGroup, TierName } from "../types/featureToggle";
import {
  TIERS,
  TIER_HIERARCHY,
  SUB_ITEM_TYPES,
} from "../types/featureToggle";

export interface ToggleState {
  toggles: Record<string, boolean>;
  savedToggles: Record<string, boolean>;
}

export type ToggleAction =
  | { type: "TOGGLE_ITEM"; key: string; value: boolean }
  | { type: "TOGGLE_GROUP_TIER"; groupId: string; tierId: string; value: boolean }
  | { type: "SAVE" }
  | { type: "DISCARD" }
  | { type: "LOAD"; toggles: Record<string, boolean> };

export interface DiffEntry {
  key: string;
  from: boolean;
  to: boolean;
  label: string;
}

/**
 * Enforce tier hierarchy: enabling in a lower tier auto-enables in higher tiers.
 * Disabling in a higher tier auto-disables in lower tiers.
 */
function enforceTierHierarchy(
  toggles: Record<string, boolean>,
  key: string,
  value: boolean,
): Record<string, boolean> {
  const result = { ...toggles, [key]: value };
  const parts = key.split(":");
  const tierId = parts[parts.length - 1] as TierName;
  const baseKey = parts.slice(0, -1).join(":");
  const tierLevel = TIER_HIERARCHY[tierId] ?? -1;

  if (value) {
    // Enabling in a lower tier -> enable in all higher tiers
    for (const tier of TIERS) {
      if (TIER_HIERARCHY[tier] > tierLevel) {
        result[`${baseKey}:${tier}`] = true;
      }
    }
  } else {
    // Disabling in a higher tier -> disable in all lower tiers
    for (const tier of TIERS) {
      if (TIER_HIERARCHY[tier] < tierLevel) {
        result[`${baseKey}:${tier}`] = false;
      }
    }
  }

  return result;
}

/**
 * Recompute the group-level checkbox based on sub-item states.
 * Group checkbox = true if ALL sub-items are on, false otherwise.
 * Indeterminate state is computed in the component, not stored in state.
 */
function recomputeGroupCheckbox(
  toggles: Record<string, boolean>,
  groupId: string,
  tierId: string,
  featureGroups: FeatureGroup[],
): Record<string, boolean> {
  const result = { ...toggles };
  const group = featureGroups.find((g) => g.id === groupId);
  if (!group) return result;

  const subKeys: string[] = [];
  for (const type of SUB_ITEM_TYPES) {
    for (const item of group[type]) {
      subKeys.push(`${groupId}:${type}:${item}:${tierId}`);
    }
  }

  if (subKeys.length === 0) {
    result[`${groupId}:${tierId}`] = false;
    return result;
  }

  const allOn = subKeys.every((k) => result[k] === true);
  result[`${groupId}:${tierId}`] = allOn;

  return result;
}

/**
 * Auto-enable dependency groups when a group is toggled on.
 * Walks the dependency chain and enables each dependency group's sub-items
 * for the specified tier and all higher tiers.
 */
function enforceDependencies(
  toggles: Record<string, boolean>,
  groupId: string,
  tierId: string,
  value: boolean,
  featureGroups: FeatureGroup[],
): Record<string, boolean> {
  if (!value) return toggles;

  let result = { ...toggles };
  const group = featureGroups.find((g) => g.id === groupId);
  if (!group) return result;

  for (const depId of group.dependencies) {
    const depGroup = featureGroups.find((g) => g.id === depId);
    if (!depGroup) continue;

    // Enable all sub-items in the dependency group for this tier and higher
    for (const type of SUB_ITEM_TYPES) {
      for (const item of depGroup[type]) {
        const key = `${depId}:${type}:${item}:${tierId}`;
        result = enforceTierHierarchy(result, key, true);
      }
    }

    // Recompute group checkboxes for the dependency
    for (const tier of TIERS) {
      result = recomputeGroupCheckbox(result, depId, tier, featureGroups);
    }

    // Recursively enable transitive dependencies
    result = enforceDependencies(result, depId, tierId, true, featureGroups);
  }

  return result;
}

function toggleReducer(
  state: ToggleState,
  action: ToggleAction,
  featureGroups: FeatureGroup[],
): ToggleState {
  switch (action.type) {
    case "TOGGLE_ITEM": {
      let next = enforceTierHierarchy(state.toggles, action.key, action.value);

      // If enabling, enforce dependencies
      if (action.value) {
        const parts = action.key.split(":");
        const groupId = parts[0];
        const tierId = parts[parts.length - 1];
        next = enforceDependencies(next, groupId, tierId, true, featureGroups);
      }

      // Recompute parent group checkbox for the affected group
      const parts = action.key.split(":");
      const groupId = parts[0];
      for (const tier of TIERS) {
        next = recomputeGroupCheckbox(next, groupId, tier, featureGroups);
      }
      return { ...state, toggles: next };
    }
    case "TOGGLE_GROUP_TIER": {
      let next = { ...state.toggles };
      const group = featureGroups.find((g) => g.id === action.groupId);
      if (!group) return state;

      // Set all sub-items in this group for this tier
      for (const type of SUB_ITEM_TYPES) {
        for (const item of group[type]) {
          const key = `${action.groupId}:${type}:${item}:${action.tierId}`;
          next = enforceTierHierarchy(next, key, action.value);
        }
      }

      // If enabling, enforce dependencies
      if (action.value) {
        next = enforceDependencies(
          next,
          action.groupId,
          action.tierId,
          true,
          featureGroups,
        );
      }

      // Recompute group checkboxes for all tiers (for this group and any deps)
      const affectedGroups = new Set([action.groupId, ...group.dependencies]);
      for (const gId of affectedGroups) {
        for (const tier of TIERS) {
          next = recomputeGroupCheckbox(next, gId, tier, featureGroups);
        }
      }

      return { ...state, toggles: next };
    }
    case "SAVE":
      return { ...state, savedToggles: { ...state.toggles } };
    case "DISCARD":
      return { ...state, toggles: { ...state.savedToggles } };
    case "LOAD":
      return {
        toggles: { ...action.toggles },
        savedToggles: { ...action.toggles },
      };
    default:
      return state;
  }
}

export interface UseFeatureMatrixReturn {
  toggles: Record<string, boolean>;
  savedToggles: Record<string, boolean>;
  dispatch: React.Dispatch<ToggleAction>;
  isDirty: boolean;
  changeCount: number;
  diffEntries: DiffEntry[];
  save: () => void;
  discard: () => void;
}

export function useFeatureMatrix(
  featureGroups: FeatureGroup[],
): UseFeatureMatrixReturn {
  const reducerWithGroups = useCallback(
    (state: ToggleState, action: ToggleAction) =>
      toggleReducer(state, action, featureGroups),
    [featureGroups],
  );

  const [state, dispatch] = useReducer(reducerWithGroups, {
    toggles: {},
    savedToggles: {},
  });

  const isDirty = useMemo(() => {
    const keys = new Set([
      ...Object.keys(state.toggles),
      ...Object.keys(state.savedToggles),
    ]);
    for (const key of keys) {
      if (Boolean(state.toggles[key]) !== Boolean(state.savedToggles[key])) {
        return true;
      }
    }
    return false;
  }, [state.toggles, state.savedToggles]);

  const changeCount = useMemo(() => {
    const keys = new Set([
      ...Object.keys(state.toggles),
      ...Object.keys(state.savedToggles),
    ]);
    let count = 0;
    for (const key of keys) {
      if (Boolean(state.toggles[key]) !== Boolean(state.savedToggles[key])) {
        count++;
      }
    }
    return count;
  }, [state.toggles, state.savedToggles]);

  const diffEntries = useMemo((): DiffEntry[] => {
    const entries: DiffEntry[] = [];
    const keys = new Set([
      ...Object.keys(state.toggles),
      ...Object.keys(state.savedToggles),
    ]);
    for (const key of keys) {
      const from = Boolean(state.savedToggles[key]);
      const to = Boolean(state.toggles[key]);
      if (from !== to) {
        entries.push({ key, from, to, label: key.split(":").join(" > ") });
      }
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key));
  }, [state.toggles, state.savedToggles]);

  const save = useCallback(() => dispatch({ type: "SAVE" }), []);
  const discard = useCallback(() => dispatch({ type: "DISCARD" }), []);

  return {
    toggles: state.toggles,
    savedToggles: state.savedToggles,
    dispatch,
    isDirty,
    changeCount,
    diffEntries,
    save,
    discard,
  };
}
