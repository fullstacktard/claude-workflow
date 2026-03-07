/**
 * Workflow YAML serialization and graph conversion
 * @module dashboard/services/workflow-serializer
 *
 * Provides bidirectional conversion between:
 * - YAML workflow files (.claude/workflows/*.yml)
 * - React Flow graph data (nodes + edges for visual editing)
 *
 * This enables the visual workflow editor to load existing workflows
 * and save user edits back to disk while preserving all workflow data.
 */

import yaml from "js-yaml";

import type { ConditionType, WorkflowConfig, WorkflowPhase } from "../../workflow/types.js";
import type {
  EdgeData,
  GraphData,
  GraphEdge,
  GraphNode,
  NodePosition,
  WorkflowPhaseNodeData,
} from "../frontend/src/types/graph.js";

import { ERROR_CATEGORIES, ERROR_CODES, OrchestrationError } from "../../errors/orchestration-error.js";

/**
 * Calculate node position for auto-layout
 * Uses simple top-to-bottom vertical layout with fixed horizontal center
 *
 * @param index - Node index in phase array (0-based)
 * @returns Node position coordinates
 */
function calculateNodePosition(index: number): NodePosition {
  const VERTICAL_SPACING = 150;
  const HORIZONTAL_CENTER = 400;

  return {
    x: HORIZONTAL_CENTER,
    y: index * VERTICAL_SPACING + 50,
  };
}

/**
 * Convert workflow YAML content to React Flow graph structure
 *
 * @param yamlContent - Raw YAML string from workflow file
 * @returns GraphData with nodes and edges for React Flow
 * @throws OrchestrationError on parse failure or invalid YAML structure
 *
 * @example
 * ```typescript
 * const yamlContent = fs.readFileSync('feature-development.yml', 'utf8');
 * const graph = yamlToGraph(yamlContent);
 * console.log(graph.nodes.length); // 3
 * console.log(graph.metadata.name); // 'feature-development'
 * ```
 */
export function yamlToGraph(yamlContent: string): GraphData {
  try {
    // Parse YAML using existing pattern from parser.ts
    const rawYaml = yaml.load(yamlContent, {
      schema: yaml.JSON_SCHEMA,
    });

    // Validate the parsed result is a non-null object (not array)
    if (rawYaml === null || typeof rawYaml !== "object" || Array.isArray(rawYaml)) {
      throw new OrchestrationError("Config must be an object", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.INVALID_JSON_SCHEMA,
        context: { type: typeof rawYaml },
        operation: "yamlToGraph",
      });
    }

    // Type assertion after validation - we've checked it's an object
    const config = rawYaml as unknown as WorkflowConfig;

    // Validate required fields
    if (!config.name) {
      throw new OrchestrationError("Workflow must have a name", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        context: { field: "name" },
        operation: "yamlToGraph",
      });
    }

    if (!config.description) {
      throw new OrchestrationError("Workflow must have a description", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        context: { field: "description" },
        operation: "yamlToGraph",
      });
    }

    if (!config.phases || !Array.isArray(config.phases) || config.phases.length === 0) {
      throw new OrchestrationError("Workflow must have at least one phase", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.INVALID_JSON_SCHEMA,
        context: { phasesCount: config.phases?.length || 0 },
        operation: "yamlToGraph",
      });
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Convert each phase to a node
    for (const [index, phase] of config.phases.entries()) {
      const nodeData: WorkflowPhaseNodeData = {
        label: phase.description || phase.id,
        agent: phase.agent,
        count: phase.count,
        description: phase.description,
        maxIterations: phase.max_iterations,
        timeoutMs: phase.timeout_ms,
        nextConditions: phase.next_conditions || [],
      };

      const node: GraphNode = {
        id: phase.id,
        type: "workflowPhase",
        position: calculateNodePosition(index),
        data: nodeData,
      };
      nodes.push(node);

      // Create edge to next phase (if not terminal)
      if (phase.next) {
        edges.push({
          id: `${phase.id}-${phase.next}`,
          source: phase.id,
          target: phase.next,
          type: "smoothstep",
          data: { label: "next" },
        });
      }

      // Create edges for conditional transitions
      if (phase.next_conditions) for (const [condIdx, condition] of phase.next_conditions.entries()) {
        if (condition.next_phase) {
          const edgeData: EdgeData = {
            label: condition.condition,
            conditional: true,
          };

          edges.push({
            id: `${phase.id}-${condition.next_phase}-cond-${condIdx}`,
            source: phase.id,
            target: condition.next_phase,
            type: "smoothstep",
            data: edgeData,
          });
        }
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        name: config.name,
        description: config.description,
        version: config.version,
        globalTimeoutMs: config.global_timeout_ms,
        workflowMetadata: config.metadata,
      },
    };
  } catch (error) {
    // Handle YAML parse errors with line numbers
    if (error instanceof yaml.YAMLException) {
      throw new OrchestrationError(`YAML syntax error: ${error.message}`, {
        category: ERROR_CATEGORIES.PARSING,
        cause: error as Error,
        code: ERROR_CODES.JSON_PARSE_ERROR,
        context: {
          line: error.mark?.line ? error.mark.line + 1 : undefined,
          column: error.mark?.column ? error.mark.column + 1 : undefined,
        },
        operation: "yamlToGraph",
      });
    }

    // Re-throw OrchestrationErrors
    if (error instanceof OrchestrationError) {
      throw error;
    }

    // Wrap unknown errors
    throw OrchestrationError.fromError(error as Error, {
      category: ERROR_CATEGORIES.PARSING,
      code: ERROR_CODES.UNKNOWN_ERROR,
      operation: "yamlToGraph",
    });
  }
}

/**
 * Convert React Flow graph data to YAML workflow configuration
 *
 * @param graphData - Graph nodes and edges from React Flow
 * @returns YAML string formatted for workflow files
 * @throws OrchestrationError if graph is invalid or missing required data
 *
 * @example
 * ```typescript
 * const graphData = {
 *   nodes: [{ id: 'planning', type: 'workflowPhase', data: {...}, position: {...} }],
 *   edges: [{ id: 'planning-implementation', source: 'planning', target: 'implementation' }],
 *   metadata: { name: 'my-workflow', description: 'My workflow' }
 * };
 * const yamlString = graphToYaml(graphData);
 * fs.writeFileSync('my-workflow.yml', yamlString);
 * ```
 */
export function graphToYaml(graphData: GraphData): string {
  try {
    // Validate graph structure
    if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
      throw new OrchestrationError("Graph must have nodes array", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.INVALID_JSON_SCHEMA,
        operation: "graphToYaml",
      });
    }

    if (graphData.nodes.length === 0) {
      throw new OrchestrationError("Graph must have at least one node", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.INVALID_JSON_SCHEMA,
        operation: "graphToYaml",
      });
    }

    if (!graphData.metadata) {
      throw new OrchestrationError("Graph must have metadata", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        context: { field: "metadata" },
        operation: "graphToYaml",
      });
    }

    if (!graphData.metadata.name) {
      throw new OrchestrationError("Graph metadata must have a name", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        context: { field: "metadata.name" },
        operation: "graphToYaml",
      });
    }

    if (!graphData.metadata.description) {
      throw new OrchestrationError("Graph metadata must have a description", {
        category: ERROR_CATEGORIES.VALIDATION,
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        context: { field: "metadata.description" },
        operation: "graphToYaml",
      });
    }

    // Build phase array from nodes
    const phases: WorkflowPhase[] = graphData.nodes.map((node) => {
      // Validate node has required fields
      if (!node.data) {
        throw new OrchestrationError("Node must have data field", {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.INVALID_JSON_SCHEMA,
          context: { nodeId: node.id },
          operation: "graphToYaml",
        });
      }

      if (!node.data.agent) {
        throw new OrchestrationError("Node data must have agent field", {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.MISSING_REQUIRED_FIELD,
          context: { field: "data.agent", nodeId: node.id },
          operation: "graphToYaml",
        });
      }

      if (node.data.count === undefined) {
        throw new OrchestrationError("Node data must have count field", {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.MISSING_REQUIRED_FIELD,
          context: { field: "data.count", nodeId: node.id },
          operation: "graphToYaml",
        });
      }

      // Find default next phase from edges
      const defaultEdge = graphData.edges.find(
        (edge) => edge.source === node.id && !edge.data?.conditional
      );

      // Find conditional next phases
      const conditionalEdges = graphData.edges.filter(
        (edge) => edge.source === node.id && edge.data?.conditional
      );

      const nextConditions = conditionalEdges.map((edge) => ({
        condition: edge.data!.label as ConditionType,
        next_phase: edge.target,
      }));

      const phase: WorkflowPhase = {
        id: node.id,
        agent: node.data.agent,
        count: node.data.count,
        next: defaultEdge?.target || null,
        description: node.data.description,
        max_iterations: node.data.maxIterations,
        timeout_ms: node.data.timeoutMs,
      };

      // Only include next_conditions if not empty
      if (nextConditions.length > 0) {
        phase.next_conditions = nextConditions;
      }

      return phase;
    });

    // Build complete workflow config
    const config: WorkflowConfig = {
      name: graphData.metadata.name,
      description: graphData.metadata.description,
      phases,
    };

    // Add optional fields if present
    if (graphData.metadata.version) {
      config.version = graphData.metadata.version;
    }

    if (graphData.metadata.globalTimeoutMs) {
      config.global_timeout_ms = graphData.metadata.globalTimeoutMs;
    }

    if (graphData.metadata.workflowMetadata) {
      config.metadata = graphData.metadata.workflowMetadata;
    }

    // Serialize to YAML with formatting options
    const yamlString = yaml.dump(config, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
      sortKeys: true,
      quotingType: "\"",
      forceQuotes: false,
    });

    return yamlString;
  } catch (error) {
    // Re-throw OrchestrationErrors
    if (error instanceof OrchestrationError) {
      throw error;
    }

    // Wrap unknown errors
    throw OrchestrationError.fromError(error as Error, {
      category: ERROR_CATEGORIES.PARSING,
      code: ERROR_CODES.UNKNOWN_ERROR,
      operation: "graphToYaml",
    });
  }
}
