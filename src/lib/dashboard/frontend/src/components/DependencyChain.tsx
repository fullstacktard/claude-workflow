/**
 * DependencyChain visualizes the dependency hierarchy for a blocked agent.
 *
 * Uses ASCII tree characters to show the chain of dependencies
 * in a terminal-friendly format.
 */

import { getAgentColorClass } from "../utils/agentColors";

/**
 * Status types for dependency nodes.
 */
export type DependencyStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * A node in the dependency tree.
 */
export interface DependencyNode {
  taskId: string;
  agentType: string;
  status: DependencyStatus;
  dependencies?: DependencyNode[];
}

interface DependencyChainProps {
  /** Root node of the dependency tree */
  root: DependencyNode;
  /** Maximum depth to render (prevents infinite loops) */
  maxDepth?: number;
}

/**
 * Status indicators for each state.
 */
const STATUS_ICONS: Record<DependencyStatus, string> = {
  pending: "o",
  running: "*",
  completed: "+",
  failed: "x",
  skipped: "-",
};

/**
 * Color classes for each status.
 */
const STATUS_COLORS: Record<DependencyStatus, string> = {
  pending: "text-gray-500",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
  skipped: "text-yellow-500",
};

/**
 * DependencyChain renders a tree visualization of task dependencies.
 */
export function DependencyChain({
  root,
  maxDepth = 5,
}: DependencyChainProps): JSX.Element {
  return (
    <div className="font-mono text-xs">
      <DependencyNodeRow
        node={root}
        depth={0}
        maxDepth={maxDepth}
        isLast={true}
        prefix=""
      />
    </div>
  );
}

interface DependencyNodeRowProps {
  node: DependencyNode;
  depth: number;
  maxDepth: number;
  isLast: boolean;
  prefix: string;
}

/**
 * Renders a single node in the dependency tree with proper indentation.
 */
function DependencyNodeRow({
  node,
  depth,
  maxDepth,
  isLast,
  prefix,
}: DependencyNodeRowProps): JSX.Element {
  const connector = isLast ? "L-" : "|-";
  const childPrefix = prefix + (isLast ? "   " : "|  ");

  const hasDeps = node.dependencies && node.dependencies.length > 0;
  const showChildren = depth < maxDepth && hasDeps;

  return (
    <>
      <div className="py-0.5 whitespace-pre">
        <span className="text-gray-600">
          {prefix}
          {depth > 0 ? connector : ""}
        </span>
        <span className={STATUS_COLORS[node.status]}>
          {STATUS_ICONS[node.status]}
        </span>
        <span className={`ml-1 ${getAgentColorClass(node.agentType)}`}>
          {node.agentType}
        </span>
        <span className="text-gray-600 ml-1">({node.taskId})</span>
        <span className={`ml-2 text-xs ${STATUS_COLORS[node.status]}`}>
          {node.status}
        </span>
      </div>

      {showChildren &&
        node.dependencies?.map((dep, index) => (
          <DependencyNodeRow
            key={dep.taskId}
            node={dep}
            depth={depth + 1}
            maxDepth={maxDepth}
            isLast={index === (node.dependencies?.length ?? 0) - 1}
            prefix={childPrefix}
          />
        ))}

      {depth >= maxDepth && hasDeps && (
        <div className="py-0.5 whitespace-pre">
          <span className="text-gray-600">{childPrefix}L-</span>
          <span className="text-gray-500">
            ... {node.dependencies?.length} more dependencies
          </span>
        </div>
      )}
    </>
  );
}
