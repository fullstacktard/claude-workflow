/**
 * Workflow Dry Run Engine
 *
 * Simulates workflow execution without spawning real agents.
 * Provides fast validation and execution path preview for workflows.
 *
 * @module workflow-dry-run
 */

import { getWorkflowEngine } from "../../workflow/workflow-engine.js";
import type { WorkflowPhase } from "../../workflow/types.js";
import type { PhaseResults, PhaseTransition } from "../../workflow/workflow-engine.js";
import { WorkflowValidator } from "./workflow-validator.js";

/**
 * Simulation mode for agent outcomes
 */
export type SimulationMode =
	| "happy_path" // All agents succeed
	| "all_fail" // All agents fail
	| "partial_success" // Mix of success and failure
	| "alternating"; // Alternate between success and failure

/**
 * Execution step record
 */
export interface ExecutionStep {
	/** Phase ID executed */
	phaseId: string;
	/** Phase description */
	description: string;
	/** Agent type */
	agent: string;
	/** Number of agents spawned */
	spawnCount: number;
	/** Simulated results */
	results: PhaseResults;
	/** Next phase transition */
	transition: PhaseTransition;
	/** Step number (1-indexed) */
	stepNumber: number;
}

/**
 * Dry run execution result
 */
export interface DryRunResult {
	/** Whether dry run completed successfully */
	success: boolean;
	/** Workflow name */
	workflowName: string;
	/** Execution steps in order */
	executionPath: ExecutionStep[];
	/** Errors detected in workflow logic */
	errors: string[];
	/** Warnings about workflow configuration */
	warnings: string[];
	/** Total execution time in ms */
	executionTimeMs: number;
	/** Simulation mode used */
	simulationMode: SimulationMode;
}

/**
 * Dry Run Engine
 *
 * Simulates workflow execution by walking through the workflow graph,
 * evaluating conditions, and recording the execution path without
 * spawning actual agents.
 *
 * @example
 * ```typescript
 * const engine = new DryRunEngine();
 * const result = engine.execute('project-setup', 'happy_path');
 * console.log(result.executionPath); // Shows which phases would execute
 * ```
 */
export class DryRunEngine {
  private workflowEngine = getWorkflowEngine();
  private validator = new WorkflowValidator();

  /**
	 * Execute dry run for a workflow
	 *
	 * @param workflowName - Name of workflow to simulate
	 * @param simulationMode - How to simulate agent outcomes
	 * @param maxSteps - Maximum steps to prevent infinite loops (default: 50)
	 * @returns DryRunResult with execution path and errors
	 */
  execute(
    workflowName: string,
    simulationMode: SimulationMode = "happy_path",
    maxSteps = 50
  ): DryRunResult {
    const startTime = performance.now();
    const executionPath: ExecutionStep[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Load workflow definition
      const workflow = this.workflowEngine.loadWorkflowDefinition(workflowName);

      if (!workflow) {
        errors.push(`Workflow not found: ${workflowName}`);
        return {
          success: false,
          workflowName,
          executionPath,
          errors,
          warnings,
          executionTimeMs: performance.now() - startTime,
          simulationMode,
        };
      }

      // Validate workflow configuration
      const validationResult = this.validator.validate(workflow);
      if (!validationResult.valid) {
        errors.push(
          ...validationResult.errors.map(
            (e) => `${e.field}: ${e.message}`
          )
        );
        // Continue with dry run even if validation fails
        // (to show execution path up to error point)
      }

      if (validationResult.warnings.length > 0) {
        warnings.push(
          ...validationResult.warnings.map(
            (w) => `${w.field}: ${w.message}`
          )
        );
      }

      // Start from first phase
      if (!workflow.phases || workflow.phases.length === 0) {
        errors.push("Workflow has no phases defined");
        return {
          success: false,
          workflowName,
          executionPath,
          errors,
          warnings,
          executionTimeMs: performance.now() - startTime,
          simulationMode,
        };
      }

      let currentPhaseId: string | null = workflow.phases[0].id;
      let stepNumber = 0;
      const visitedPhases = new Set<string>();

      // Execute workflow graph traversal
      while (currentPhaseId !== null && stepNumber < maxSteps) {
        stepNumber++;

        // Find current phase
        const currentPhase = workflow.phases.find(
          (p) => p.id === currentPhaseId
        );

        if (!currentPhase) {
          errors.push(
            `Phase not found: ${currentPhaseId} (referenced in step ${stepNumber})`
          );
          break;
        }

        // Detect loops (phase visited multiple times)
        if (visitedPhases.has(currentPhaseId)) {
          warnings.push(
            `Loop detected: Phase "${currentPhaseId}" visited multiple times (step ${stepNumber})`
          );
          // Allow loops up to max_iterations if specified
          const maxIterations = (currentPhase as WorkflowPhase & { max_iterations?: number }).max_iterations ?? 1;
          const visitCount = executionPath.filter(
            (step) => step.phaseId === currentPhaseId
          ).length;

          if (visitCount >= maxIterations) {
            warnings.push(
              `Max iterations (${maxIterations}) reached for phase "${currentPhaseId}"`
            );
            break;
          }
        }
        visitedPhases.add(currentPhaseId);

        // Simulate phase execution
        const spawnCount = this.calculateSpawnCount(currentPhase);
        const results = this.simulatePhaseResults(
          spawnCount,
          simulationMode,
          stepNumber
        );

        // Calculate next phase
        const transition = this.workflowEngine.calculateNextPhase(
          workflow,
          currentPhaseId,
          results
        );

        // Record execution step
        executionPath.push({
          phaseId: currentPhaseId,
          description: currentPhase.description || currentPhase.id,
          agent: currentPhase.agent,
          spawnCount,
          results,
          transition,
          stepNumber,
        });

        // Move to next phase
        currentPhaseId = transition.nextPhase;
      }

      // Check for infinite loop
      if (stepNumber >= maxSteps) {
        errors.push(
          `Maximum steps (${maxSteps}) reached - possible infinite loop`
        );
      }

      const success = errors.length === 0;

      return {
        success,
        workflowName,
        executionPath,
        errors,
        warnings,
        executionTimeMs: performance.now() - startTime,
        simulationMode,
      };
    } catch (error) {
      errors.push(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        workflowName,
        executionPath,
        errors,
        warnings,
        executionTimeMs: performance.now() - startTime,
        simulationMode,
      };
    }
  }

  /**
	 * Calculate spawn count for a phase (simplified for dry run)
	 */
  private calculateSpawnCount(phase: WorkflowPhase): number {
    const count = phase.count;

    // Fixed numeric count
    if (typeof count === "number") {
      return count;
    }

    // Dynamic counts - use reasonable defaults for dry run
    switch (count) {
    case "from_previous":
    case "match_previous": {
      return 3;
    } // Simulate 3 tasks from previous phase
    case "by_assignment": {
      return 2;
    } // Simulate 2 different assignees
    case "all_tasks": {
      return 5;
    } // Simulate 5 tasks
    case "failed_only": {
      return 1;
    } // Simulate 1 failed task
    default: {
      return 1;
    }
    }
  }

  /**
	 * Simulate phase execution results based on simulation mode
	 */
  private simulatePhaseResults(
    spawnCount: number,
    simulationMode: SimulationMode,
    stepNumber: number
  ): PhaseResults {
    switch (simulationMode) {
    case "happy_path": {
      // All agents succeed
      return {
        completed: spawnCount,
        failed: 0,
        total: spawnCount,
      };
    }

    case "all_fail": {
      // All agents fail
      return {
        completed: 0,
        failed: spawnCount,
        total: spawnCount,
      };
    }

    case "partial_success": {
      // Half succeed, half fail
      const succeeded = Math.ceil(spawnCount / 2);
      return {
        completed: succeeded,
        failed: spawnCount - succeeded,
        total: spawnCount,
      };
    }

    case "alternating": {
      // Alternate between success and failure based on step number
      return stepNumber % 2 === 1 ? {
        completed: spawnCount,
        failed: 0,
        total: spawnCount,
      } : {
        completed: 0,
        failed: spawnCount,
        total: spawnCount,
      };
    }

    default: {
      return {
        completed: spawnCount,
        failed: 0,
        total: spawnCount,
      };
    }
    }
  }

  /**
	 * List all available workflows
	 *
	 * @returns Array of workflow names
	 */
  listWorkflows(): string[] {
    return this.workflowEngine.listWorkflows();
  }
}
