/**
 * Condition evaluation for workflow phase transitions
 * @module workflow/condition-evaluator
 */

export type ConditionType = "all_passed" | "any_failed" | "partial_success";

export interface NextCondition {
  condition: ConditionType;
  next_phase: null | string;
}

/**
 * Phase result structure - simplified view of AgentOutput from agent-output-schema.json
 *
 * Type Mapping Documentation:
 * - PhaseResult is a simplified interface for condition evaluation
 * - Actual agent outputs follow the full AgentOutput schema from agent-output-schema.json
 * - Conversion: AgentOutput.status → PhaseResult.status (1:1 mapping)
 * - Additional AgentOutput fields (timestamp, metadata, results) ignored for condition logic
 */
export interface PhaseResult {
  agent_id: string;
  status: "blocked" | "failure" | "partial" | "success";
  // Note: This is a subset of AgentOutput - see conversion function below
}

/**
 * Convert AgentOutput from agent-output-schema.json to PhaseResult
 * This function bridges the gap between full agent output and simplified phase result
 *
 * @param agentOutput - Full agent output following agent-output-schema.json
 * @returns PhaseResult with just the fields needed for condition evaluation
 */
export function convertToPhaseResult(agentOutput: {
   
  [key: string]: any;
  agent_id: string;
  status: "blocked" | "failure" | "partial" | "success";
}): PhaseResult {
  return {
    agent_id: agentOutput.agent_id,
    status: agentOutput.status
  };
}

/**
 * Evaluate phase results against a condition
 * @param results - Array of agent outputs from phase execution
 * @param condition - Condition to evaluate (any_failed, all_passed, partial_success)
 * @returns true if condition is met
 */
export function evaluateCondition(
  results: PhaseResult[],
  condition: ConditionType
): boolean {
  if (results.length === 0) {
    throw new Error("Cannot evaluate condition with empty results array");
  }

  switch (condition) {
  case "all_passed": {
    return results.every(r => r.status === "success");
  }

  case "any_failed": {
    return results.some(r => r.status === "failure" || r.status === "blocked");
  }

  case "partial_success": {
    const hasSuccess = results.some(r => r.status === "success");
    const hasFailure = results.some(r => r.status === "failure" || r.status === "blocked");
    return hasSuccess && hasFailure;
  }

  default: {
    // TypeScript exhaustiveness check - should never reach here with proper types
    throw new Error(`Unknown condition type: ${condition as string}`);
  }
  }
}

/**
 * Find the first matching next_condition from workflow config
 * @param results - Phase execution results
 * @param nextConditions - Array of next_conditions from workflow phase config
 * @returns Matching condition or undefined if none match
 */
export function findMatchingCondition(
  results: PhaseResult[],
  nextConditions: NextCondition[]
): NextCondition | undefined {
  for (const condition of nextConditions) {
    if (evaluateCondition(results, condition.condition)) {
      return condition;
    }
  }
  return undefined;
}
