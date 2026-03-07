/**
 * useWorkflowValidation Hook
 * Client-side debounced validation for workflow canvas nodes and edges
 *
 * Validates:
 * - Required node properties (label, config)
 * - Connection rules (entry->phase, phase->agent, etc.)
 * - Orphan nodes (nodes without connections)
 * - Entry point requirements
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

/**
 * Validation error interface
 */
export interface ValidationError {
  nodeId: string;
  nodeName: string;
  message: string;
  severity: "error" | "warning";
}

/** Debounce delay for validation (1 second) */
const VALIDATION_DEBOUNCE_MS = 1000;

/**
 * Connection rules - which node types can connect to which
 */
const CONNECTION_RULES: Record<string, string[]> = {
  entry: ["phase"],
  phase: ["condition", "agent", "hook"],
  condition: ["phase", "agent"],
  agent: ["phase", "hook"],
  hook: ["phase"],
};

/**
 * Hook result interface
 */
export interface UseWorkflowValidationResult {
  /** Current validation errors */
  errors: ValidationError[];
  /** Whether validation is currently in progress */
  isValidating: boolean;
  /** Validation request error if any */
  error: Error | null;
  /** Get errors for a specific node */
  getNodeErrors: (nodeId: string) => ValidationError[];
  /** Whether any errors exist */
  hasErrors: boolean;
  /** Manually trigger validation */
  validate: () => void;
}

/**
 * Get human-readable node name from node data
 */
function getNodeName(node: Node): string {
  const data = node.data as Record<string, unknown>;
  return (data.label as string) || node.type || node.id;
}

/**
 * Perform client-side validation of workflow nodes and edges
 */
function validateWorkflow(nodes: Node[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Build connection maps for quick lookup
  const outgoingEdges = new Map<string, Edge[]>();
  const incomingEdges = new Map<string, Edge[]>();

  for (const edge of edges) {
    // Track outgoing edges
    if (!outgoingEdges.has(edge.source)) {
      outgoingEdges.set(edge.source, []);
    }
    outgoingEdges.get(edge.source)!.push(edge);

    // Track incoming edges
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, []);
    }
    incomingEdges.get(edge.target)!.push(edge);
  }

  // Count entry nodes
  const entryNodes = nodes.filter((n) => n.type === "entry");

  // Validate: Must have at least one entry node
  if (entryNodes.length === 0 && nodes.length > 0) {
    // Add error to first node as reference
    const firstNode = nodes[0];
    errors.push({
      nodeId: firstNode.id,
      nodeName: getNodeName(firstNode),
      message:
        "Workflow requires at least one Entry node. Drag an Entry node from the palette.",
      severity: "error",
    });
  }

  // Validate each node
  for (const node of nodes) {
    const nodeName = getNodeName(node);
    const nodeType = node.type || "unknown";
    const data = node.data as Record<string, unknown>;

    // Check for missing label
    if (!data.label || (data.label as string).trim() === "") {
      errors.push({
        nodeId: node.id,
        nodeName: nodeName,
        message: `Node '${node.id}' is missing a label. Double-click to edit.`,
        severity: "warning",
      });
    }

    // Entry node validation
    if (nodeType === "entry") {
      const outEdges = outgoingEdges.get(node.id) || [];
      if (outEdges.length === 0) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Entry node '${nodeName}' is not connected to any phase. Connect it to a Phase node.`,
          severity: "error",
        });
      }
    }

    // Phase node validation
    if (nodeType === "phase") {
      // Must have at least one incoming connection (except if it's the first phase after entry)
      const inEdges = incomingEdges.get(node.id) || [];
      if (inEdges.length === 0) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Phase '${nodeName}' has no incoming connections. It won't be reachable in the workflow.`,
          severity: "warning",
        });
      }
    }

    // Agent node validation
    if (nodeType === "agent") {
      // Must have incoming connection from phase or condition
      const inEdges = incomingEdges.get(node.id) || [];
      if (inEdges.length === 0) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Agent '${nodeName}' has no incoming connections. Connect it from a Phase or Condition node.`,
          severity: "error",
        });
      }

      // Check for agent_type property
      if (!data.agentType || (data.agentType as string).trim() === "") {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Agent '${nodeName}' is missing required 'agent_type' property. Select an agent type in the property panel.`,
          severity: "error",
        });
      }
    }

    // Condition node validation
    if (nodeType === "condition") {
      // Must have incoming connection
      const inEdges = incomingEdges.get(node.id) || [];
      if (inEdges.length === 0) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Condition '${nodeName}' has no incoming connections. Connect it from a Phase node.`,
          severity: "error",
        });
      }

      // Should have at least 2 outgoing connections (true/false branches)
      const outEdges = outgoingEdges.get(node.id) || [];
      if (outEdges.length < 2) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Condition '${nodeName}' should have both 'true' and 'false' branch connections.`,
          severity: "warning",
        });
      }

      // Check for condition expression
      if (!data.expression || (data.expression as string).trim() === "") {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Condition '${nodeName}' is missing required 'expression' property. Add a condition expression in the property panel.`,
          severity: "error",
        });
      }
    }

    // Hook node validation
    if (nodeType === "hook") {
      // Must have incoming connection
      const inEdges = incomingEdges.get(node.id) || [];
      if (inEdges.length === 0) {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Hook '${nodeName}' has no incoming connections. Connect it from a Phase or Agent node.`,
          severity: "error",
        });
      }

      // Check for hook type
      if (!data.hookType || (data.hookType as string).trim() === "") {
        errors.push({
          nodeId: node.id,
          nodeName: nodeName,
          message: `Hook '${nodeName}' is missing required 'hook_type' property. Select a hook type in the property panel.`,
          severity: "error",
        });
      }
    }

    // Validate connections from this node follow the rules
    const outEdges = outgoingEdges.get(node.id) || [];
    const allowedTargets = CONNECTION_RULES[nodeType] || [];

    for (const edge of outEdges) {
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (targetNode) {
        const targetType = targetNode.type || "unknown";
        if (!allowedTargets.includes(targetType)) {
          errors.push({
            nodeId: node.id,
            nodeName: nodeName,
            message: `Invalid connection: '${nodeName}' (${nodeType}) cannot connect to '${getNodeName(targetNode)}' (${targetType}). Allowed: ${allowedTargets.join(", ") || "none"}.`,
            severity: "error",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Custom hook for workflow validation with debouncing
 *
 * @param nodes - Current workflow nodes
 * @param edges - Current workflow edges
 * @returns Validation state and helpers
 */
export function useWorkflowValidation(
  nodes: Node[],
  edges: Edge[]
): UseWorkflowValidationResult {
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Perform validation
   */
  const performValidation = useCallback(() => {
    setIsValidating(true);
    setError(null);

    try {
      const validationErrors = validateWorkflow(nodes, edges);
      setErrors(validationErrors);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Validation failed")
      );
      setErrors([]);
    } finally {
      setIsValidating(false);
    }
  }, [nodes, edges]);

  /**
   * Debounced validation effect
   * Triggers validation 1 second after nodes/edges change
   */
  useEffect(() => {
    // Clear existing timer
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }

    // Skip validation if no nodes
    if (nodes.length === 0) {
      setErrors([]);
      setIsValidating(false);
      return;
    }

    // Set debounced validation
    validationTimerRef.current = setTimeout(() => {
      performValidation();
    }, VALIDATION_DEBOUNCE_MS);

    // Cleanup timer on unmount or dependency change
    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
    };
  }, [nodes, edges, performValidation]);

  /**
   * Get errors for a specific node
   */
  const getNodeErrors = useCallback(
    (nodeId: string): ValidationError[] => {
      return errors.filter((err) => err.nodeId === nodeId);
    },
    [errors]
  );

  return {
    errors,
    isValidating,
    error,
    getNodeErrors,
    hasErrors: errors.length > 0,
    validate: performValidation,
  };
}
