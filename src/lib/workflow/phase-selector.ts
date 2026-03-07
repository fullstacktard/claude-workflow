/**
 * Phase selection and loop tracking for workflow transitions
 * @module workflow/phase-selector
 */

import type { NextCondition, PhaseResult } from "./condition-evaluator.js";

export interface LoopState {
  current_iteration: number;
  max_iterations: number;
  phase_id: string;
}

export interface PhaseTransition {
  from_phase: string;
  is_loop: boolean;
  iteration?: number;
  reason: string;
  to_phase: string | undefined; // undefined means workflow complete
}

/**
 * Workflow phase configuration
 * Matches WorkflowPhase from workflowConfig.ts
 */
export interface WorkflowPhase {
  agent_name: string;
  count_strategy?: "custom_count" | "failed_only" | "from_previous";
  custom_count?: number;
  id: string;
  max_iterations?: number;
  next_conditions: NextCondition[];
}

/**
 * Calculate count for next phase based on count_strategy
 * @param strategy - Count strategy (from_previous, failed_only, custom_count)
 * @param previousResults - Results from previous phase
 * @param customCount - Custom count value (if strategy is custom_count)
 * @returns Number of agents to spawn in next phase
 */
export function calculateNextPhaseCount(
  strategy: "custom_count" | "failed_only" | "from_previous",
  previousResults: PhaseResult[],
  customCount?: number
): number {
  switch (strategy) {
  case "custom_count": {
    if (customCount === undefined) {
      throw new Error("custom_count strategy requires customCount parameter");
    }
    return customCount;
  }

  case "failed_only": {
    return previousResults.filter(
      r => r.status === "failure" || r.status === "blocked"
    ).length;
  }

  case "from_previous": {
    return previousResults.length;
  }

  default: {
    // TypeScript exhaustiveness check - should never reach here with proper types
    throw new Error(`Unknown count strategy: ${strategy as string}`);
  }
  }
}

/**
 * Determine next phase based on condition match and loop tracking
 * @param currentPhase - Current phase configuration
 * @param matchedCondition - Matched next_condition or undefined
 * @param loopState - Current loop iteration state (if applicable)
 * @returns Phase transition information
 */
export function selectNextPhase(
  currentPhase: WorkflowPhase,
  matchedCondition: NextCondition | undefined,
  loopState?: LoopState
): PhaseTransition {
  // No matching condition = workflow complete (terminal state)
  if (!matchedCondition) {
    return {
      from_phase: currentPhase.id,
      is_loop: false,
      reason: "No matching condition found - workflow complete",
      to_phase: undefined
    };
  }

  // Convert null to undefined for PhaseTransition.to_phase compatibility
  const nextPhaseId = matchedCondition.next_phase ?? undefined;
  const isLoop = nextPhaseId === currentPhase.id;

  // Check loop iteration limit
  if (isLoop && loopState) {
    const nextIteration = loopState.current_iteration + 1;

    if (nextIteration > loopState.max_iterations) {
      throw new Error(
        `Max iterations exceeded for phase ${currentPhase.id}: ${String(nextIteration)} > ${String(loopState.max_iterations)}`
      );
    }

    return {
      from_phase: currentPhase.id,
      is_loop: true,
      iteration: nextIteration,
      reason: `${matchedCondition.condition} condition met - loop iteration ${String(nextIteration)}`,
      to_phase: nextPhaseId
    };
  }

  // Return different objects based on loop status to satisfy exactOptionalPropertyTypes
  if (isLoop) {
    return {
      from_phase: currentPhase.id,
      is_loop: true,
      iteration: 1,
      reason: `${matchedCondition.condition} condition met`,
      to_phase: nextPhaseId
    };
  }

  return {
    from_phase: currentPhase.id,
    is_loop: false,
    reason: `${matchedCondition.condition} condition met`,
    to_phase: nextPhaseId
  };
}
