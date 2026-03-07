/**
 * DependencyNode Component
 * Custom React Flow node with status coloring and tooltip
 *
 * Displays an agent node in the dependency graph with:
 * - Status-based coloring (completed=green, running=blue, waiting=yellow, blocked/error=red)
 * - Tooltip showing agent details on hover/focus
 * - Keyboard accessibility with focus indicators
 *
 * @example
 * // Used internally by DependencyGraph via nodeTypes
 * const nodeTypes: NodeTypes = { agent: DependencyNode };
 */

import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

/** Agent status values matching API response */
export type AgentStatus =
  | "completed"
  | "running"
  | "waiting"
  | "blocked"
  | "error"
  | "pending"
  | "queued";

/** Data structure for dependency node */
export interface DependencyNodeData extends Record<string, unknown> {
  label: string;
  status: AgentStatus;
  agentId: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Type alias for our custom node */
export type DependencyNodeType = Node<DependencyNodeData, "agent">;

/** Status color mappings for Tailwind classes */
const STATUS_COLORS: Record<
  AgentStatus,
  { bg: string; border: string; text: string }
> = {
  completed: {
    bg: "bg-green-900/50",
    border: "border-green-500",
    text: "text-green-400",
  },
  running: {
    bg: "bg-blue-900/50",
    border: "border-blue-500",
    text: "text-blue-400",
  },
  waiting: {
    bg: "bg-yellow-900/50",
    border: "border-yellow-500",
    text: "text-yellow-400",
  },
  blocked: {
    bg: "bg-red-900/50",
    border: "border-red-500",
    text: "text-red-400",
  },
  error: {
    bg: "bg-red-900/50",
    border: "border-red-500",
    text: "text-red-400",
  },
  pending: {
    bg: "bg-gray-900/50",
    border: "border-gray-500",
    text: "text-gray-400",
  },
  queued: {
    bg: "bg-purple-900/50",
    border: "border-purple-500",
    text: "text-purple-400",
  },
};

/** Status icon mappings */
const STATUS_ICONS: Record<AgentStatus, string> = {
  completed: "✓",
  running: "●",
  waiting: "○",
  blocked: "✕",
  error: "!",
  pending: "◌",
  queued: "⋯",
};

/**
 * Format duration between two timestamps
 * @param startedAt - ISO timestamp when agent started
 * @param completedAt - ISO timestamp when agent completed (optional, uses now if not provided)
 * @returns Human-readable duration string
 */
function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "Not started";

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const duration = Math.floor((end - start) / 1000);

  if (duration < 60) return `${duration}s`;
  if (duration < 3600)
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
}

/**
 * DependencyNode - Custom React Flow node component
 *
 * Renders a single agent node in the dependency graph with status coloring,
 * connection handles, and an interactive tooltip.
 */
function DependencyNodeComponent({
  data,
}: NodeProps<DependencyNodeType>): JSX.Element {
  const [showTooltip, setShowTooltip] = useState(false);
  const nodeData = data;
  const colors = STATUS_COLORS[nodeData.status] ?? STATUS_COLORS.pending;
  const icon = STATUS_ICONS[nodeData.status] ?? STATUS_ICONS.pending;

  return (
    <div
      className={`py-3 px-4 rounded-md border-2 min-w-[120px] font-mono cursor-pointer relative focus:outline-2 focus:outline-red-500 focus:outline-offset-2 ${colors.bg} ${colors.border}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      tabIndex={0}
      role="button"
      aria-label={`Agent ${nodeData.label}, status: ${nodeData.status}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-red-800 !border-2 !border-red-500"
      />

      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${colors.text}`}>{icon}</span>
        <span className="text-xs text-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px]">{nodeData.label}</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-red-800 !border-2 !border-red-500"
      />

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-950 border border-red-800 rounded-md p-3 min-w-[200px] z-[1000] shadow-lg" role="tooltip">
          <div className="text-[10px] font-semibold tracking-wide pb-2 mb-2 border-b border-gray-800">
            <span className={colors.text}>{nodeData.status.toUpperCase()}</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between gap-4">
              <span className="text-xs text-gray-500">Agent:</span>
              <span className="text-xs text-gray-300">
                {nodeData.label}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-xs text-gray-500">ID:</span>
              <span className="text-xs text-gray-300 font-mono">
                {nodeData.agentId.length > 12
                  ? `${nodeData.agentId.slice(0, 12)}...`
                  : nodeData.agentId}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-xs text-gray-500">Duration:</span>
              <span className="text-xs text-gray-300">
                {formatDuration(nodeData.startedAt, nodeData.completedAt)}
              </span>
            </div>
            {nodeData.error && (
              <div className="mt-2 pt-2 border-t border-gray-800 text-xs">
                <span className="text-gray-500">Error:</span>
                <span className="text-red-400 ml-1">{nodeData.error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const DependencyNode = memo(DependencyNodeComponent);
