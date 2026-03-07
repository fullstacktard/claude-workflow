/**
 * Graph data types for React Flow workflow visualization
 * @module dashboard/types/graph
 */

import type { AgentCount, NextCondition } from "../../../../workflow/types.js";

/**
 * React Flow node position
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Data stored within a workflow phase node
 */
export interface WorkflowPhaseNodeData {
  /** Human-readable label for the node */
  label: string;
  /** Agent type to spawn */
  agent: string;
  /** Number of agents to spawn (or dynamic logic) */
  count: AgentCount;
  /** Phase description for logging */
  description?: string;
  /** Maximum loop iterations */
  maxIterations?: number;
  /** Phase timeout in milliseconds */
  timeoutMs?: number;
  /** Conditional transitions */
  nextConditions: NextCondition[];
}

/**
 * React Flow graph node representing a workflow phase
 */
export interface GraphNode {
  /** Unique node identifier (matches phase.id) */
  id: string;
  /** Node type for React Flow rendering */
  type: string;
  /** Node position on canvas */
  position: NodePosition;
  /** Workflow phase data */
  data: WorkflowPhaseNodeData;
}

/**
 * Data stored within an edge
 */
export interface EdgeData {
  /** Human-readable label for the edge */
  label?: string;
  /** Whether this edge represents a conditional transition */
  conditional?: boolean;
}

/**
 * React Flow graph edge representing a phase transition
 */
export interface GraphEdge {
  /** Unique edge identifier */
  id: string;
  /** Source node ID (phase that transitions) */
  source: string;
  /** Target node ID (phase to transition to) */
  target: string;
  /** Edge type for React Flow rendering */
  type?: string;
  /** Edge-specific data */
  data?: EdgeData;
}

/**
 * Metadata about the workflow
 */
export interface GraphMetadata {
  /** Workflow name (kebab-case identifier) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Schema version for future migrations */
  version?: string;
  /** Global timeout for entire workflow (ms) */
  globalTimeoutMs?: number;
  /** Additional workflow metadata */
  workflowMetadata?: {
    author?: string;
    created?: string;
    tags?: string[];
    updated?: string;
  };
}

/**
 * Complete graph data structure for React Flow
 * Represents a workflow in visual graph format
 */
export interface GraphData {
  /** Array of workflow phase nodes */
  nodes: GraphNode[];
  /** Array of phase transition edges */
  edges: GraphEdge[];
  /** Workflow metadata */
  metadata: GraphMetadata;
}
