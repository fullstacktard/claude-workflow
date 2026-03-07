/**
 * Phase Transition Validation
 *
 * Provides validation logic for phase transitions in multi-phase workflows.
 * Checks iteration limits and phase configuration validity.
 *
 * @module phase-tracker
 */

import type { WorkflowPhase } from "./types.js";

/**
 * Phase configuration (alias for WorkflowPhase for backward compatibility)
 */
export type PhaseConfig = WorkflowPhase;

/**
 * Phase transition validation result
 */
export interface ValidationResult {
  errors: string[];
  valid: boolean;
}

/**
 * Check if phase can iterate again
 *
 * @param {string} phaseId - Phase ID to check
 * @param {Record<string, number>} iterations - Current iteration counts
 * @param {Record<string, number>} maxIterations - Maximum iterations per phase
 * @returns {boolean} True if phase can iterate
 */
export function canIteratePhase(
  phaseId: string,
  iterations: Record<string, number>,
  maxIterations: Record<string, number>
): boolean {
  const currentIterations = iterations[phaseId] ?? 0;
  const limit = maxIterations[phaseId];

  return (limit === undefined) || currentIterations < limit;
}

/**
 * Get remaining iterations for a phase
 *
 * @param {string} phaseId - Phase ID to check
 * @param {Record<string, number>} iterations - Current iteration counts
 * @param {Record<string, number>} maxIterations - Maximum iterations per phase
 * @returns {number} Remaining iterations (Infinity if no limit)
 */
export function getRemainingIterations(
  phaseId: string,
  iterations: Record<string, number>,
  maxIterations: Record<string, number>
): number {
  const currentIterations = iterations[phaseId] ?? 0;
  const limit = maxIterations[phaseId];

  if (limit === undefined) {
    return Infinity;
  }

  const remaining = limit - currentIterations;
  return Math.max(0, remaining);
}

/**
 * Validate phase transition is allowed
 *
 * Checks:
 * - Phase exists in configuration
 * - Iteration limit not exceeded
 *
 * @param {string} _currentPhaseId - Current phase ID (reserved for future transition rules)
 * @param {string} nextPhaseId - Target phase ID
 * @param {Record<string, number>} iterations - Current iteration counts per phase
 * @param {Record<string, number>} maxIterations - Maximum iterations per phase
 * @param {PhaseConfig[]} phaseConfig - Workflow phase configuration
 * @returns {ValidationResult} Validation result with errors if invalid
 */
export function validatePhaseTransition(
  _currentPhaseId: string,
  nextPhaseId: string,
  iterations: Record<string, number>,
  maxIterations: Record<string, number>,
  phaseConfig: PhaseConfig[]
): ValidationResult {
  const errors: string[] = [];

  // Check phase exists in config
  const phaseExists = phaseConfig.some(p => p.id === nextPhaseId);
  if (!phaseExists) {
    errors.push(`Phase '${nextPhaseId}' not found in workflow configuration`);
    return { errors, valid: false };
  }

  // Check iteration limit
  const currentIterations = iterations[nextPhaseId] ?? 0;
  const limit = maxIterations[nextPhaseId];

  if ((limit !== undefined) && currentIterations >= limit) {
    const limitStr = String(limit);
    const currentStr = String(currentIterations);
    errors.push(
      `Phase '${nextPhaseId}' has reached maximum iterations (${limitStr}). ` +
      `Current: ${currentStr}, Max: ${limitStr}`
    );
  }

  return {
    errors,
    valid: errors.length === 0,
  };
}
