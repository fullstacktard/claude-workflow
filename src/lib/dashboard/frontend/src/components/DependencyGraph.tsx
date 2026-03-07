/**
 * DependencyGraph Component
 * Visualizes agent workflow dependencies with real-time status updates
 *
 * Features:
 * - Interactive graph visualization using React Flow
 * - Real-time status updates via polling
 * - Status color coding (completed=green, running=blue, waiting=yellow, blocked/error=red)
 * - Legend, MiniMap, and zoom controls
 * - Responsive design for mobile and desktop
 * - Keyboard accessibility
 *
 * @example
 * <DependencyGraph
 *   sessionId="session-123"
 *   className="h-[400px]"
 *   onToastError={(msg) => toast.error(msg)}
 * />
 */

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  type NodeTypes,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { TerminalCard } from "./TerminalCard";
import {
  DependencyNode,
  type DependencyNodeType,
  type DependencyNodeData,
  type AgentStatus,
} from "./DependencyNode";
import {
  useDependencyGraph,
  type DependencyGraphData,
} from "../hooks/useDependencyGraph";

/** Props for DependencyGraph component */
interface DependencyGraphProps {
  /** Session ID to fetch dependency graph for */
  sessionId: string;
  /** Additional CSS classes */
  className?: string;
  /** Callback for error toast notifications */
  onToastError?: (message: string) => void;
}

/**
 * CSS variable names for status colors.
 * These map to variables defined in globals.css.
 * The actual hex values are computed at runtime from CSS custom properties.
 */
const STATUS_CSS_VARS: Record<AgentStatus, string> = {
  completed: "--color-status-completed",
  running: "--color-status-running",
  waiting: "--color-status-waiting",
  blocked: "--color-status-blocked",
  error: "--color-status-error",
  pending: "--color-status-pending",
  queued: "--color-status-queued",
};

/** Get computed color value from CSS variable */
function getCssColor(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

/** Fallback hex colors for when CSS vars aren't available
 * These values are defined as CSS variables in globals.css
 * and are only used as runtime fallbacks when getComputedStyle fails.
 * @see globals.css --color-status-* variables
 */
const STATUS_FALLBACKS: Record<AgentStatus, string> = {
  completed: "#22c55e", // css-validation-ignore
  running: "#3b82f6", // css-validation-ignore
  waiting: "#eab308", // css-validation-ignore
  blocked: "#ef4444", // css-validation-ignore
  error: "#ef4444", // css-validation-ignore
  pending: "#6b7280", // css-validation-ignore
  queued: "#a855f7", // css-validation-ignore
};

/** Get status color from CSS variable with fallback */
function getStatusColor(status: AgentStatus): string {
  return getCssColor(STATUS_CSS_VARS[status], STATUS_FALLBACKS[status]);
}

/** Custom node types for React Flow */
const nodeTypes: NodeTypes = {
  agent: DependencyNode,
};

/**
 * DependencyGraph - Main visualization component
 *
 * Displays an interactive dependency graph showing agent relationships
 * and their execution status in real-time.
 */
export function DependencyGraph({
  sessionId,
  className = "",
  onToastError,
}: DependencyGraphProps): JSX.Element {
  const {
    data: graphData,
    isLoading,
    error,
  } = useDependencyGraph({
    sessionId,
    pollInterval: 3000,
    enabled: Boolean(sessionId),
    onError: (err) => onToastError?.(err.message),
  });

  const [nodes, setNodes, onNodesChange] =
    useNodesState<DependencyNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /** Transform API data to React Flow nodes */
  const transformToNodes = useCallback(
    (data: DependencyGraphData): DependencyNodeType[] => {
      return data.nodes.map((agent, index) => ({
        id: agent.agent_id,
        type: "agent" as const,
        position: { x: (index % 4) * 200, y: Math.floor(index / 4) * 120 },
        data: {
          label: agent.agent_type,
          status: agent.status as AgentStatus,
          agentId: agent.agent_id,
          startedAt: agent.started_at,
          completedAt: agent.completed_at,
          error: agent.error,
        } satisfies DependencyNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }));
    },
    []
  );

  /** Transform API data to React Flow edges */
  const transformToEdges = useCallback((data: DependencyGraphData): Edge[] => {
    return data.edges.map((edge, index) => ({
      id: `e-${index}`,
      source: edge.source,
      target: edge.target,
      animated:
        data.nodes.find((n) => n.agent_id === edge.target)?.status === "running",
      style: { stroke: getCssColor("--border", "#991b1b") },
    }));
  }, []);

  // Update nodes and edges when graph data changes
  useEffect(() => {
    if (graphData) {
      setNodes(transformToNodes(graphData));
      setEdges(transformToEdges(graphData));
    }
  }, [graphData, transformToNodes, transformToEdges, setNodes, setEdges]);

  /** Legend component */
  const Legend = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2 bg-gray-900/50 border-b border-red-800 shrink-0">
        <span className="text-xs text-gray-500 uppercase tracking-wide font-medium w-full sm:w-auto">Status:</span>
        {(Object.keys(STATUS_CSS_VARS) as AgentStatus[]).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getStatusColor(status) }}
            />
            <span className="text-xs text-gray-300 capitalize">{status}</span>
          </div>
        ))}
      </div>
    ),
    []
  );

  /** Queue and capacity indicators */
  const headerActions = (
    <div className="flex items-center gap-4">
      {graphData?.pending_spawn_queue &&
        graphData.pending_spawn_queue.length > 0 && (
          <span className="text-xs text-yellow-500 px-2 py-0.5 bg-yellow-900/30 rounded">
            Queue: {graphData.pending_spawn_queue.length}
          </span>
        )}
      <span className="text-xs text-gray-500">
        Active: {graphData?.active_agents ?? 0}/
        {graphData?.max_concurrent_agents ?? "∞"}
      </span>
    </div>
  );

  // Loading state
  if (isLoading) {
    return (
      <TerminalCard
        command="graph"
        filename="workflow-dependencies"
        headerText="Dependency Graph"
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
          <div className="spinner w-8 h-8 mb-4" />
          <p className="text-gray-400">Loading dependency graph...</p>
        </div>
      </TerminalCard>
    );
  }

  // Error state
  if (error) {
    return (
      <TerminalCard
        command="graph"
        filename="workflow-dependencies"
        headerText="Dependency Graph"
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
          <p className="text-red-400 text-sm">
            Failed to load dependency graph
          </p>
          <p className="text-gray-600 text-xs mt-1">{error.message}</p>
        </div>
      </TerminalCard>
    );
  }

  // Empty state
  if (!graphData || graphData.nodes.length === 0) {
    return (
      <TerminalCard
        command="graph"
        filename="workflow-dependencies"
        headerText="Dependency Graph"
        className={className}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
          <p className="text-gray-500 text-sm">No workflow data available</p>
          <p className="text-gray-600 text-xs mt-1">
            Start a workflow session to see the dependency graph
          </p>
        </div>
      </TerminalCard>
    );
  }

  return (
    <TerminalCard
      command="graph"
      filename="workflow-dependencies"
      headerText="Dependency Graph"
      headerActions={headerActions}
      className={className}
      noPadding
    >
      <div className="flex flex-col h-full min-h-[300px]">
        {Legend}
        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
            minZoom={0.5}
            maxZoom={2}
          >
            <Background color={getCssColor("--border", "#991b1b")} gap={20} size={1} />
            <Controls
              className="react-flow-controls"
              showZoom
              showFitView
              showInteractive={false}
            />
            <MiniMap
              className="react-flow-minimap"
              nodeColor={(node) =>
                getStatusColor(
                  (node.data?.status as AgentStatus | undefined) ?? "pending"
                )
              }
              maskColor={getCssColor("--minimap-mask", "rgba(0, 0, 0, 0.8)")}
            />
          </ReactFlow>
        </div>
      </div>
    </TerminalCard>
  );
}
