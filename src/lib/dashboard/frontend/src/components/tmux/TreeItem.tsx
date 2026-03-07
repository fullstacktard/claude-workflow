/**
 * TreeItem Component
 *
 * Renders a single WAI-ARIA treeitem node with correct ARIA attributes,
 * lucide-react icons, and Tailwind styling using @theme design tokens.
 *
 * ARIA attributes:
 * - `role="treeitem"` on every node
 * - `aria-expanded` only on expandable nodes (projects), never on leaves
 * - `aria-selected` indicates the currently focused/selected item
 * - `aria-level`, `aria-setsize`, `aria-posinset` for positional info
 * - `tabIndex` follows roving tabindex pattern (0 for focused, -1 for all others)
 *
 * Visual indicators:
 * - Chevron (expand/collapse) for project nodes
 * - Green dot for attached sessions
 * - Yellow bell for sessions with notifications
 * - Red "+ new session" action with Plus icon
 * - Dimmed "Unregistered Sessions" header
 */

import { Bell, ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { FlatTreeNode } from "./SessionTree";

import errorIcon from "../../assets/icons/session-states/error.svg";
import waitingIcon from "../../assets/icons/session-states/waiting.svg";
import workingIcon from "../../assets/icons/session-states/working.svg";
import idleIcon from "../../assets/icons/session-states/idle.svg";

/** Rainbow color palette for session labels. */
const RAINBOW_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

/** Format token count into a compact human-readable string. */
function formatTokens(n: number): string {
  if (n < 1000) return `${String(n)}t`;
  if (n < 1_000_000) return `${String(Math.round(n / 1000))}kt`;
  return `${(n / 1_000_000).toFixed(1)}Mt`;
}

/** Props for the TreeItem component. */
export interface TreeItemProps {
  /** The flat tree node data to render. */
  node: FlatTreeNode;
  /** Whether this item currently has visual and keyboard focus. */
  isFocused: boolean;
  /** Roving tabindex value: 0 for the focused item, -1 for all others. */
  tabIndex: 0 | -1;
  /** Called when the item receives focus (click or tab). */
  onFocus: () => void;
  /** Called when the item is clicked. */
  onClick: () => void;
  /** Called on right-click (context menu trigger). */
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * TreeItem -- A single node in the WAI-ARIA tree view.
 *
 * Renders project headers with chevrons, session items with status indicators,
 * "+ new session" actions, and the "Unregistered Sessions" header.
 */
export function TreeItem({
  node,
  isFocused,
  tabIndex,
  onFocus,
  onClick,
  onContextMenu,
}: TreeItemProps): JSX.Element {
  const paddingLeft = node.level === 1 ? "pl-2" : "pl-6";

  const className = [
    "flex items-center gap-1.5 py-1 pr-2 cursor-pointer select-none",
    "outline-none transition-colors duration-100",
    paddingLeft,
    isFocused
      ? "bg-gray-800 text-white"
      : "text-gray-300 hover:bg-gray-800/50",
    node.type === "unregistered-header" ? "text-muted cursor-default" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      role="treeitem"
      aria-expanded={node.isExpandable ? node.isExpanded : undefined}
      aria-selected={isFocused}
      aria-level={node.level}
      aria-setsize={node.setSize}
      aria-posinset={node.posInSet}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={className}
    >
      {/* Expand/collapse chevron for project nodes */}
      {node.type === "project" && (
        <span className="w-4 h-4 flex items-center justify-center shrink-0" aria-hidden="true">
          {node.isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          )}
        </span>
      )}

      {/* Indentation spacer for non-project nodes at level 2 */}
      {node.type !== "project" && node.level === 2 && (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}

      {/* Node label */}
      {node.type === "new-session" ? (
        <span className="flex items-center gap-1 text-green-400">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>new session</span>
        </span>
      ) : node.type === "unregistered-header" ? (
        <span className="text-muted text-xs uppercase tracking-wider">
          Unregistered Sessions
        </span>
      ) : node.type === "session" && node.colorIndex != null ? (
        <span
          className="truncate"
          style={{ color: RAINBOW_COLORS[node.colorIndex % RAINBOW_COLORS.length] }}
        >
          {node.label}
        </span>
      ) : (
        <span className="truncate">{node.label}</span>
      )}

      {/* Session state icon (between name and status indicators) */}
      {node.type === "session" && node.sessionState === "error" && (
        <img
          src={errorIcon}
          className="w-4 h-4 shrink-0 animate-pulse"
          alt={node.errorMessage ?? "Error"}
          title={node.errorMessage ?? "Error — rate limit or compact error"}
        />
      )}
      {node.type === "session" && node.sessionState === "waiting_permission" && (
        <img
          src={waitingIcon}
          className="w-5 h-5 animate-pulse shrink-0"
          alt="Waiting for permission"
        />
      )}
      {node.type === "session" && node.sessionState === "working" && (
        <img
          src={workingIcon}
          className="w-5 h-5 shrink-0 animate-spin"
          style={{ animationDuration: "3s" }}
          alt="Working"
        />
      )}
      {node.type === "session" && node.sessionState === "idle" && (
        <img
          src={idleIcon}
          className="w-4 h-4 shrink-0 opacity-60"
          alt="Idle"
        />
      )}

      {/* Cumulative token count */}
      {node.type === "session" && node.cumulativeTokens != null && node.cumulativeTokens > 0 && (
        <span
          className="text-gray-500 text-[10px] shrink-0 tabular-nums"
          title={`${String(node.cumulativeTokens)} tokens used`}
        >
          {formatTokens(node.cumulativeTokens)}
        </span>
      )}

      {/* Session status indicators (attached dot + notification bell) */}
      {node.type === "session" && (
        <span className="flex items-center gap-1 ml-auto shrink-0">
          {node.isAttached && (
            <span
              className="w-2 h-2 rounded-full bg-success"
              title="Attached"
              aria-label="Attached"
            />
          )}
          {node.hasNotification && (
            <Bell
              className="w-3.5 h-3.5 text-warning"
              aria-label="Has notification"
            />
          )}
        </span>
      )}

      {/* Project session count badge */}
      {node.type === "project" && node.session === undefined && (
        <span className="text-gray-500 text-xs ml-auto shrink-0">
          ({String(node.childCount)})
        </span>
      )}
    </li>
  );
}
