/**
 * Dependencies Router
 * REST API endpoint for dependency graph visualization data
 *
 * Provides workflow state transformed into a graph format with nodes (agents)
 * and edges (dependencies) for dashboard visualization.
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ProjectScannerService } from "../services/project-scanner.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Error response structure
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Node in the dependency graph (represents a task/agent)
 */
interface DependencyNode {
  /** Unique identifier for the node */
  id: string;
  /** Human-readable label */
  label: string;
  /** Agent/subagent type */
  type: string;
  /** Current execution status */
  status: "completed" | "failed" | "running" | "skipped" | "stale" | "pending" | "waiting";
  /** When the agent was spawned */
  startedAt?: string;
  /** When the agent completed (if applicable) */
  completedAt?: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Reason for failure (if failed) */
  failureReason?: string;
}

/**
 * Edge in the dependency graph (represents a dependency relationship)
 */
interface DependencyEdge {
  /** Source node ID (dependency) */
  source: string;
  /** Target node ID (dependent) */
  target: string;
  /** Relationship type */
  type: "depends_on";
}

/**
 * Blocked task info
 */
interface BlockedTask {
  /** Task/agent ID that is blocked */
  taskId: string;
  /** IDs of tasks this is blocked by */
  blockedBy: string[];
  /** Human-readable reason for blockage */
  reason: string;
}

/**
 * Queued task ready to spawn
 */
interface QueuedTask {
  /** Task/agent ID */
  taskId: string;
  /** Agent type */
  type: string;
  /** Task priority */
  priority: string;
}

/**
 * Full dependency graph response
 */
interface DependencyGraphResponse {
  /** Session identifier */
  sessionId: string;
  /** Workflow identifier */
  workflowId: string;
  /** Human-readable workflow name */
  workflowName: string;
  /** Response generation timestamp */
  timestamp: string;
  /** Graph nodes (agents) */
  nodes: DependencyNode[];
  /** Graph edges (dependencies) */
  edges: DependencyEdge[];
  /** Tasks blocked by dependencies */
  blocked: BlockedTask[];
  /** Tasks ready to spawn */
  queue: QueuedTask[];
  /** Summary statistics */
  stats: {
    totalNodes: number;
    completedNodes: number;
    runningNodes: number;
    failedNodes: number;
    blockedNodes: number;
    queuedNodes: number;
  };
}

/**
 * Spawned agent record from workflow state
 */
interface SpawnedAgentRecord {
  agent_id: string;
  subagent_type: string;
  status: "completed" | "failed" | "running" | "skipped" | "stale";
  spawned_at: string;
  completed_at?: string;
  retry_count: number;
  failure_reason?: string;
  dependencies?: string[];
}

/**
 * Phase structure from workflow state
 */
interface WorkflowPhase {
  id: string;
  agent: string;
  status: string;
  spawned_agent_records: SpawnedAgentRecord[];
}

/**
 * Workflow state file structure (subset of MultiPhaseWorkflowState)
 */
interface WorkflowStateFile {
  workflow_id: string;
  workflow_name: string;
  session_id: string;
  status: string;
  current_phase: WorkflowPhase;
  phase_history: WorkflowPhase[];
}

/**
 * Router configuration
 */
export interface DependenciesRouterConfig {
  /** Project scanner service for dynamic project discovery */
  projectScanner: ProjectScannerService;
}

/**
 * Helper to get current project paths from scanner
 */
async function getProjectPaths(scanner: ProjectScannerService): Promise<string[]> {
  const projects = await scanner.scan();
  return projects.map((p) => p.path);
}

/**
 * Find workflow state file for a session
 * Searches across all project paths for matching session directory
 *
 * @param sessionId - Session identifier to search for
 * @param projectPaths - Array of project paths to search in
 * @returns Path to workflow state file, or null if not found
 */
async function findWorkflowStateFile(
  sessionId: string,
  projectPaths: string[]
): Promise<string | null> {
  for (const projectPath of projectPaths) {
    const stateFile = path.join(
      projectPath,
      ".claude",
      "logs",
      `session-${sessionId}`,
      "workflow-state.json"
    );
    try {
      await fs.access(stateFile);
      return stateFile;
    } catch {
      // File doesn't exist in this project, continue searching
    }
  }
  return null;
}

/**
 * Transform workflow state into dependency graph format
 * Extracts nodes and edges from spawned agent records
 *
 * @param state - Parsed workflow state file
 * @returns Dependency graph response
 */
function transformToGraph(state: WorkflowStateFile): DependencyGraphResponse {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const blocked: BlockedTask[] = [];
  const queue: QueuedTask[] = [];
  const nodeIds = new Set<string>();

  /**
   * Process agent records from a phase
   */
  function processAgentRecords(records: SpawnedAgentRecord[]): void {
    for (const record of records) {
      // Skip duplicates
      if (nodeIds.has(record.agent_id)) {
        continue;
      }
      nodeIds.add(record.agent_id);

      // Create node
      const node: DependencyNode = {
        id: record.agent_id,
        label: record.agent_id,
        type: record.subagent_type,
        status: record.status,
        startedAt: record.spawned_at,
        completedAt: record.completed_at,
        retryCount: record.retry_count,
        failureReason: record.failure_reason,
      };
      nodes.push(node);

      // Create edges from dependencies
      if (record.dependencies && record.dependencies.length > 0) {
        for (const dep of record.dependencies) {
          // Check for duplicate edges
          const edgeExists = edges.some(
            (e) => e.source === dep && e.target === record.agent_id
          );
          if (!edgeExists) {
            edges.push({
              source: dep,
              target: record.agent_id,
              type: "depends_on",
            });
          }
        }

        // Check if task is blocked (has incomplete dependencies and not running)
        if (record.status !== "running" && record.status !== "completed") {
          const incompleteDepends = record.dependencies.filter((depId) => {
            const depRecord = records.find((r) => r.agent_id === depId);
            return depRecord && depRecord.status !== "completed";
          });

          if (incompleteDepends.length > 0) {
            blocked.push({
              taskId: record.agent_id,
              blockedBy: incompleteDepends,
              reason: `Waiting for ${incompleteDepends.length} dependency(ies) to complete`,
            });
          }
        }
      }
    }
  }

  // Process current phase agents
  if (state.current_phase?.spawned_agent_records) {
    processAgentRecords(state.current_phase.spawned_agent_records);
  }

  // Process historical phases for complete graph
  if (state.phase_history) {
    for (const phase of state.phase_history) {
      if (phase.spawned_agent_records) {
        processAgentRecords(phase.spawned_agent_records);
      }
    }
  }

  // Calculate stats
  const stats = {
    totalNodes: nodes.length,
    completedNodes: nodes.filter((n) => n.status === "completed").length,
    runningNodes: nodes.filter((n) => n.status === "running").length,
    failedNodes: nodes.filter((n) => n.status === "failed").length,
    blockedNodes: blocked.length,
    queuedNodes: queue.length,
  };

  return {
    sessionId: state.session_id,
    workflowId: state.workflow_id,
    workflowName: state.workflow_name,
    timestamp: new Date().toISOString(),
    nodes,
    edges,
    blocked,
    queue,
    stats,
  };
}

/**
 * Create dependencies router
 *
 * @param config - Router configuration with project paths
 * @returns Express router with dependency graph endpoint
 */
export function createDependenciesRouter(config: DependenciesRouterConfig): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /:sessionId/dependencies - Get dependency graph for a workflow session
   *
   * @param sessionId - Session identifier (path parameter)
   * @returns DependencyGraphResponse with nodes, edges, blocked tasks, and stats
   *
   * @example Response:
   * {
   *   "sessionId": "1234567890",
   *   "workflowId": "feature-impl-abc123",
   *   "workflowName": "Feature Implementation",
   *   "timestamp": "2025-01-15T10:30:00.000Z",
   *   "nodes": [
   *     { "id": "task-maker-001", "type": "task-maker", "status": "completed", ... }
   *   ],
   *   "edges": [
   *     { "source": "task-maker-001", "target": "backend-engineer-001", "type": "depends_on" }
   *   ],
   *   "blocked": [],
   *   "queue": [],
   *   "stats": { "totalNodes": 5, "completedNodes": 3, "runningNodes": 1, ... }
   * }
   */
  router.get("/:sessionId/dependencies", (req: Request, res: Response): void => {
    const handleGetDependencies = async (): Promise<void> => {
      const sessionId = String(req.params.sessionId);

      // Find workflow state file (dynamically discovered projects)
      const projectPaths = await getProjectPaths(config.projectScanner);
      const stateFile = await findWorkflowStateFile(sessionId, projectPaths);

      if (!stateFile) {
        const errorResponse: ErrorResponse = {
          error: "Session not found",
          message: `No workflow state found for session ${sessionId}`,
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      // Read and parse workflow state
      const stateContent = await fs.readFile(stateFile, "utf8");
      const state: WorkflowStateFile = JSON.parse(stateContent) as WorkflowStateFile;

      // Transform to graph format
      const graph = transformToGraph(state);

      res.status(HTTP_STATUS_OK).json(graph);
    };

    handleGetDependencies().catch((error: unknown) => {
      console.error("[dependencies] Error getting dependency graph:", error);

      // Differentiate between JSON parse errors and other errors
      const isParseError = error instanceof SyntaxError;
      const errorResponse: ErrorResponse = {
        error: isParseError ? "Invalid workflow state file" : "Failed to get dependency graph",
        message: error instanceof Error ? error.message : "Unknown error",
      };

      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  return router;
}

/**
 * Export types for external use
 */
export type {
  BlockedTask,
  DependencyEdge,
  DependencyGraphResponse,
  DependencyNode,
  ErrorResponse,
  QueuedTask,
};
