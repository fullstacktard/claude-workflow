/**
 * useTreeView Hook
 *
 * Manages WAI-ARIA tree view keyboard navigation with roving tabindex.
 * Tracks the focused node index and provides the full W3C APG keyboard
 * contract (Up/Down/Left/Right/Home/End/Enter/Space).
 *
 * IMPORTANT: This hook does NOT own expand/collapse state. The parent
 * component owns `expandedProjects` and passes expand/collapse callbacks.
 * This avoids a circular dependency between flatNodes (which depend on
 * expandedProjects) and this hook (which needs flatNodes).
 *
 * Keyboard contract (W3C APG):
 * - Down Arrow: Move focus to next visible treeitem
 * - Up Arrow: Move focus to previous visible treeitem
 * - Right Arrow: Closed parent -> expand; Open parent -> first child; Leaf -> no-op
 * - Left Arrow: Open parent -> collapse; Child/leaf -> move to parent
 * - Home: Move focus to first node
 * - End: Move focus to last visible node
 * - Enter / Space: Activate focused node (attach, toggle, new-session)
 *
 * @example
 * ```tsx
 * const { focusedIndex, handleKeyDown, setFocusedIndex } =
 *   useTreeView(flatNodes, treeRef, {
 *     onActivate: (node) => { ... },
 *     onExpand: (path) => { ... },
 *     onCollapse: (path) => { ... },
 *     onToggleExpand: (path) => { ... },
 *   });
 * ```
 */

import { useCallback, useState, type RefObject } from "react";
import type { FlatTreeNode } from "../components/tmux/SessionTree";

// ── Hook Interface ───────────────────────────────────────────────────

/** Options for the useTreeView hook. */
export interface UseTreeViewOptions {
  /** Called when Enter or Space is pressed on a non-project node. */
  onActivate: (node: FlatTreeNode) => void;
  /** Called when Right Arrow expands a closed project. */
  onExpand: (projectPath: string) => void;
  /** Called when Left Arrow collapses an open project. */
  onCollapse: (projectPath: string) => void;
  /** Called when Enter/Space toggles a project node. */
  onToggleExpand: (projectPath: string) => void;
}

/** Return value of the useTreeView hook. */
export interface UseTreeViewResult {
  /** Index of the focused node in the flat list. */
  focusedIndex: number;
  /** Keyboard event handler to attach to the tree container. */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Imperatively set the focused index. */
  setFocusedIndex: (index: number) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Custom hook for WAI-ARIA tree view keyboard navigation with roving tabindex.
 *
 * @param flatNodes - The current flat list of visible tree nodes
 * @param treeRef - Ref to the `<ul role="tree">` container element
 * @param options - Callback options
 * @returns Focused index and keyboard handlers
 */
export function useTreeView(
  flatNodes: FlatTreeNode[],
  treeRef: RefObject<HTMLUListElement | null>,
  options: UseTreeViewOptions,
): UseTreeViewResult {
  const [focusedIndex, setFocusedIndexState] = useState<number>(0);

  /**
   * Find the parent project node index for a child node at the given index.
   * Walks backward through the flat list to find the first level-1 ancestor.
   */
  const findParentIndex = useCallback(
    (index: number): number => {
      const node = flatNodes[index];
      if (!node || node.level === 1) return index;
      for (let i = index - 1; i >= 0; i--) {
        if (flatNodes[i].level === 1) return i;
      }
      return 0;
    },
    [flatNodes],
  );

  /**
   * Focus a specific index and move DOM focus via roving tabindex.
   * Also scrolls the focused element into view.
   */
  const focusIndex = useCallback(
    (index: number): void => {
      if (index < 0 || index >= flatNodes.length) return;
      setFocusedIndexState(index);
      // Move real DOM focus for roving tabindex
      const items = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
      items?.[index]?.focus();
    },
    [flatNodes.length, treeRef],
  );

  /**
   * WAI-ARIA keyboard handler for tree view navigation.
   * Implements the full W3C APG tree view keyboard contract.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      const node = flatNodes[focusedIndex];
      if (!node) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = focusedIndex + 1;
          if (next < flatNodes.length) focusIndex(next);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const prev = focusedIndex - 1;
          if (prev >= 0) focusIndex(prev);
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (node.isExpandable) {
            if (!node.isExpanded) {
              // Closed parent: expand it
              options.onExpand(node.projectPath!);
            } else {
              // Open parent: move to first child
              const next = focusedIndex + 1;
              if (next < flatNodes.length && flatNodes[next].level > node.level) {
                focusIndex(next);
              }
            }
          }
          // Leaf node: no-op
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          if (node.isExpandable && node.isExpanded) {
            // Open parent: collapse it
            options.onCollapse(node.projectPath!);
          } else if (node.level > 1) {
            // Child/leaf: move to parent
            focusIndex(findParentIndex(focusedIndex));
          }
          break;
        }

        case "Home": {
          e.preventDefault();
          focusIndex(0);
          break;
        }

        case "End": {
          e.preventDefault();
          focusIndex(flatNodes.length - 1);
          break;
        }

        case "Enter":
        case " ": {
          e.preventDefault();
          if (node.type === "project") {
            options.onToggleExpand(node.projectPath!);
          } else {
            options.onActivate(node);
          }
          break;
        }

        // Ignore all other keys
        default:
          break;
      }
    },
    [flatNodes, focusedIndex, focusIndex, findParentIndex, options],
  );

  const setFocusedIndex = useCallback(
    (index: number): void => {
      setFocusedIndexState(index);
    },
    [],
  );

  return {
    focusedIndex,
    handleKeyDown,
    setFocusedIndex,
  };
}
