/**
 * Workflow configuration validator
 * @module workflow/validator
 */

import type { AgentCount, ValidationResult, WorkflowConfig, WorkflowPhase } from "./types.js";

/**
 * Validate workflow configuration
 *
 * Performs comprehensive validation including:
 * - Required fields checking
 * - Phase ID uniqueness
 * - Agent count validation
 * - Phase reference validation
 * - Circular dependency detection
 * - Timeout and iteration validation
 *
 * @param config - Parsed workflow config
 * @returns Validation result with errors and warnings arrays
 *
 * @example
 * ```typescript
 * const result = validateWorkflowConfig(config);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * if (result.warnings && result.warnings.length > 0) {
 *   console.warn('Warnings:', result.warnings);
 * }
 * ```
 */
export function validateWorkflowConfig(config: WorkflowConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.name || typeof config.name !== "string") {
    errors.push("Missing or invalid required field: name");
  } else if (!/^[a-z0-9-]+$/.test(config.name)) {
    errors.push("Workflow name must be kebab-case (lowercase letters, numbers, hyphens only)");
  }

  if (!config.description || typeof config.description !== "string") {
    errors.push("Missing or invalid required field: description");
  }

  if (!Array.isArray(config.phases) || config.phases.length === 0) {
    errors.push("Missing or empty required field: phases (must be non-empty array)");
    return { errors, valid: false, warnings };
  }

  // Validate each phase
  const phaseIds = new Set<string>();
  for (let i = 0; i < config.phases.length; i++) {
    const phase = config.phases[i];
    if (!phase) continue;

    const prefix = `Phase ${String(i + 1)} (${phase.id || "unnamed"})`;

    // Required phase fields
    if (!phase.id || typeof phase.id !== "string") {
      errors.push(`${prefix}: Missing or invalid required field: id`);
    } else if (phaseIds.has(phase.id)) {
      errors.push(`${prefix}: Duplicate phase ID: ${phase.id}`);
    } else {
      phaseIds.add(phase.id);
    }

    if (!phase.agent || typeof phase.agent !== "string") {
      errors.push(`${prefix}: Missing or invalid required field: agent`);
    }

    // Validate count type
    const validCount = validateAgentCount(phase.count);
    if (!validCount) {
      const countStr = typeof phase.count === "number" ? String(phase.count) : phase.count;
      errors.push(`${prefix}: Invalid count value: ${countStr}. Must be number or one of: from_previous, match_previous, failed_only, all_tasks, by_assignment`);
    }

    // Validate next reference
    if (phase.next !== null && typeof phase.next !== "string") {
      errors.push(`${prefix}: Invalid next field (must be string or null)`);
    }

    // Validate next_conditions
    if (phase.next_conditions) {
      if (Array.isArray(phase.next_conditions)) {
        for (let j = 0; j < phase.next_conditions.length; j++) {
          const condition = phase.next_conditions[j];
          if (condition === undefined) continue;

          if (!validateConditionType(condition.condition)) {
            errors.push(`${prefix}: next_conditions[${String(j)}] has invalid condition type: ${condition.condition}`);
          }
        }
      } else {
        errors.push(`${prefix}: next_conditions must be an array`);
      }
    }

    // Validate max_iterations
    if (phase.max_iterations !== undefined && (typeof phase.max_iterations !== "number" || phase.max_iterations < 1)) {
      errors.push(`${prefix}: max_iterations must be a positive number`);
    }

    // Validate timeout
    if (phase.timeout_ms !== undefined && (typeof phase.timeout_ms !== "number" || phase.timeout_ms < 0)) {
      errors.push(`${prefix}: timeout_ms must be a non-negative number`);
    }
  }

  // Validate phase references
  for (const phase of config.phases) {
    if (phase.next !== null && phase.next !== "" && !phaseIds.has(phase.next)) {
      errors.push(`Phase ${phase.id}: references non-existent next phase: ${phase.next}`);
    }

    if (phase.next_conditions !== undefined) {
      for (const condition of phase.next_conditions) {
        if (condition.next_phase !== null && condition.next_phase !== "" && !phaseIds.has(condition.next_phase)) {
          errors.push(`Phase ${phase.id}: next_condition references non-existent phase: ${condition.next_phase}`);
        }
      }
    }
  }

  // Detect circular dependencies
  const cycles = detectCircularDependencies(config.phases);
  if (cycles.length > 0) {
    errors.push(...cycles);
  }

  // Warnings for missing optional fields
  for (const phase of config.phases) {
    if (phase.description === undefined || phase.description === "") {
      warnings.push(`Phase ${phase.id}: Missing description (recommended)`);
    }
    if (phase.max_iterations === undefined && phase.next === phase.id) {
      warnings.push(`Phase ${phase.id}: Self-loop without max_iterations (default: 3)`);
    }
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings
  };
}

/**
 * Detect circular dependencies in phase graph
 *
 * Uses depth-first search with recursion stack tracking to detect cycles.
 * This algorithm detects:
 * - Simple cycles (A → B → A)
 * - Complex cycles (A → B → C → A)
 * - Conditional branch cycles
 * - Self-loops
 *
 * @param phases - Array of workflow phases
 * @returns Array of cycle descriptions (empty if no cycles found)
 *
 * @example
 * ```typescript
 * const cycles = detectCircularDependencies(phases);
 * // ['Circular dependency detected: phase1 → phase2 → phase1']
 * ```
 */
function detectCircularDependencies(phases: WorkflowPhase[]): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(phaseId: string, path: string[]): void {
    if (recursionStack.has(phaseId)) {
      // Check if this is a self-loop with max_iterations (allowed)
      const isSelfLoop = path.length > 0 && path[path.length - 1] === phaseId;
      const phase = phases.find(p => p.id === phaseId);

      if (isSelfLoop && phase?.max_iterations !== undefined) {
        // Self-loop with max_iterations is allowed, don't report as cycle
        return;
      }

      cycles.push(`Circular dependency detected: ${[...path, phaseId].join(" → ")}`);
      return;
    }
    if (visited.has(phaseId)) {
      return;
    }

    visited.add(phaseId);
    recursionStack.add(phaseId);

    const phase = phases.find(p => p.id === phaseId);
    if (!phase) {
      return;
    }

    // Check direct next
    if (phase.next !== null && phase.next !== "") {
      dfs(phase.next, [...path, phaseId]);
    }

    // Check conditional branches
    if (phase.next_conditions) {
      for (const condition of phase.next_conditions) {
        if (condition.next_phase !== null) {
          dfs(condition.next_phase, [...path, phaseId]);
        }
      }
    }

    recursionStack.delete(phaseId);
  }

  // Start DFS from each unvisited phase
  for (const phase of phases) {
    if (!visited.has(phase.id)) {
      dfs(phase.id, []);
    }
  }

  return cycles;
}

/**
 * Validate agent count value
 *
 * @param count - Agent count value to validate
 * @returns True if count is valid, false otherwise
 */
function validateAgentCount(count: AgentCount): boolean {
  if (typeof count === "number") {
    return count > 0 && Number.isInteger(count);
  }

  const validStrings = ["from_previous", "match_previous", "failed_only", "all_tasks", "by_assignment"];
  return validStrings.includes(count as string);
}

/**
 * Validate condition type
 *
 * @param condition - Condition type to validate
 * @returns True if condition type is valid, false otherwise
 */
function validateConditionType(condition: string): boolean {
  const validTypes = ["any_failed", "all_passed", "partial_success", "custom_expression"];
  return validTypes.includes(condition) || typeof condition === "string";
}
