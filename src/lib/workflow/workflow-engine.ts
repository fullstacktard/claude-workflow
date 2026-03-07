/**
 * Workflow Runtime Engine
 *
 * Core engine for declarative workflow system. Handles:
 * - Loading and caching YAML workflow definitions
 * - Phase transition logic based on conditions
 * - Dynamic spawn count calculation
 * - Agent type resolution for by_assignment phases
 * - Agent output schema validation
 * - Workflow auto-detection from prompts
 *
 * @module workflow/workflow-engine
 */

import { loadWorkflowDirectory } from "./parser.js";
import { getSchemaValidator } from "./schema-validator.js";
import type { WorkflowConfig, WorkflowPhase, ConditionType } from "./types.js";
import type { PhaseResult } from "./condition-evaluator.js";
import type { SchemaValidationResult,   } from "./schema-validator.js";

const DEFAULT_WORKFLOW_DIR = ".claude/workflows";

/**
 * Extended phase interface for additional properties not in base type
 */
interface ExtendedPhase extends WorkflowPhase {
  /** Field path to extract count from previous output */
  count_field?: string;
  /** Mapping from assignee type to agent type */
  agent_mapping?: Record<string, string>;
  /** Field path to extract assignee from task data */
  assignment_field?: string;
  /** Output schema file name */
  output_schema?: string;
}

/**
 * Phase results for transition calculation
 */
export interface PhaseResults {
  /** Number of completed (successful) agents */
  completed: number;
  /** Number of failed agents */
  failed: number;
  /** Total number of agents */
  total: number;
  /** Optional detailed results */
  results?: PhaseResult[];
}

/**
 * Phase transition result
 */
export interface PhaseTransition {
  /** Next phase ID (null for workflow complete) */
  nextPhase: string | null;
  /** Reason for the transition */
  reason: string;
  /** Whether this transition creates a loop */
  isLoop: boolean;
}

/**
 * Workflow detection result
 */
export interface WorkflowDetection {
  /** Detected workflow name */
  workflow: string;
  /** Confidence score (number of matching keywords) */
  confidence: number;
}

/**
 * Workflow entry configuration for auto-detection
 */
interface WorkflowEntry {
  /** Auto-detection configuration */
  auto_detect?: {
    /** Keywords to match in prompts */
    keywords: string[];
    /** Minimum score to consider a match */
    min_score: number;
  };
  /** CLI command to trigger workflow */
  command?: string;
  /** Command aliases */
  aliases?: string[];
}

/**
 * Extended workflow config with entry section
 */
interface ExtendedWorkflowConfig extends WorkflowConfig {
  /** Entry point configuration */
  entry?: WorkflowEntry;
}

/**
 * WorkflowEngine class
 *
 * Central runtime engine for declarative workflow execution.
 * Uses singleton pattern via getWorkflowEngine() for consistent state.
 *
 * @example
 * ```typescript
 * const engine = getWorkflowEngine();
 * const workflow = engine.loadWorkflowDefinition('feature-development');
 * const nextPhase = engine.calculateNextPhase(workflow, 'planning', results);
 * ```
 */
export class WorkflowEngine {
  private definitions: Map<string, WorkflowConfig> = new Map();
  private loaded = false;

  /**
   * Load workflow definition by name
   *
   * @param workflowType - Workflow name to load
   * @returns WorkflowConfig if found, undefined otherwise
   */
  loadWorkflowDefinition(workflowType: string): WorkflowConfig | undefined {
    this.ensureLoaded();
    return this.definitions.get(workflowType);
  }

  /**
   * Load all workflow definitions from directory
   *
   * @param dirPath - Directory containing workflow YAML files
   */
  loadWorkflowsFromDirectory(dirPath: string = DEFAULT_WORKFLOW_DIR): void {
    const configs = loadWorkflowDirectory(dirPath);
    for (const [name, config] of configs) {
      this.definitions.set(name, config);
    }
    this.loaded = true;
  }

  /**
   * Ensure workflows are loaded (lazy initialization)
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      this.loadWorkflowsFromDirectory();
    }
  }

  /**
   * Clear cache and reload workflows
   */
  reload(): void {
    this.definitions.clear();
    this.loaded = false;
    this.ensureLoaded();
  }

  /**
   * Get workflow by name or command
   *
   * @param nameOrCommand - Workflow name, command, or alias
   * @returns WorkflowConfig if found, undefined otherwise
   */
  getWorkflow(nameOrCommand: string): WorkflowConfig | undefined {
    this.ensureLoaded();

    // Direct name match
    if (this.definitions.has(nameOrCommand)) {
      return this.definitions.get(nameOrCommand);
    }

    // Command match (check entry.command and entry.aliases)
    for (const [, def] of this.definitions) {
      const extDef = def as ExtendedWorkflowConfig;
      if (extDef.entry?.command === nameOrCommand) {
        return def;
      }
      if (extDef.entry?.aliases?.includes(nameOrCommand)) {
        return def;
      }
    }

    return undefined;
  }

  /**
   * List all available workflow names
   *
   * @returns Array of workflow names
   */
  listWorkflows(): string[] {
    this.ensureLoaded();
    return [...this.definitions.keys()];
  }

  /**
   * Calculate next phase based on conditions and results
   *
   * @param workflow - Current workflow configuration
   * @param currentPhaseId - ID of the current phase
   * @param phaseResults - Results from current phase execution
   * @returns PhaseTransition with next phase and reason
   */
  calculateNextPhase(
    workflow: WorkflowConfig,
    currentPhaseId: string,
    phaseResults: PhaseResults
  ): PhaseTransition {
    const currentPhase = workflow.phases.find(p => p.id === currentPhaseId);

    if (!currentPhase) {
      return {
        nextPhase: null,
        reason: `Current phase not found: ${currentPhaseId}`,
        isLoop: false
      };
    }

    // Check next_conditions in order
    if (currentPhase.next_conditions && currentPhase.next_conditions.length > 0) {
      for (const condition of currentPhase.next_conditions) {
        const conditionType = condition.condition;

        if (this.evaluateSimpleCondition(conditionType, phaseResults)) {
          const isLoop = condition.next_phase === currentPhaseId;
          return {
            nextPhase: condition.next_phase,
            reason: `Condition matched: ${condition.condition}`,
            isLoop,
          };
        }
      }
    }

    // Default transition
    return {
      nextPhase: currentPhase.next,
      reason: "Default transition",
      isLoop: false,
    };
  }

  /**
   * Evaluate condition against phase results (simplified version)
   *
   * @param condition - Condition type to evaluate
   * @param results - Phase results
   * @returns true if condition is met
   */
  private evaluateSimpleCondition(
    condition: ConditionType,
    results: PhaseResults
  ): boolean {
    switch (condition) {
    case "all_passed": {
      return results.failed === 0 && results.completed > 0;
    }
    case "any_failed": {
      return results.failed > 0;
    }
    case "partial_success": {
      return results.completed > 0 && results.failed > 0;
    }
    case "custom_expression": {
      // Custom expressions need additional context - fall through to default
      return false;
    }
    default: {
      return false;
    }
    }
  }

  /**
   * Calculate spawn count for a phase
   *
   * @param phase - Workflow phase configuration
   * @param previousPhaseOutput - Output from previous phase (for dynamic counts)
   * @returns Number of agents to spawn
   */
  calculateSpawnCount(
    phase: WorkflowPhase,
    previousPhaseOutput: unknown
  ): number {
    const count = phase.count;

    // Fixed numeric count
    if (typeof count === "number") {
      return count;
    }

    // Dynamic count from previous output
    if (count === "from_previous" || count === "match_previous") {
      const extPhase = phase as ExtendedPhase;
      const countField = extPhase.count_field;

      if (!countField || !previousPhaseOutput) {
        return 1; // Fallback
      }

      const value = this.getJsonPath(previousPhaseOutput, countField);

      if (Array.isArray(value)) {
        return value.length;
      }
      if (typeof value === "number") {
        return value;
      }
      return 1; // Fallback
    }

    // Count failed agents only
    if (count === "failed_only") {
      const extPhase = phase as ExtendedPhase;
      const resultsField = extPhase.count_field;
      if (!resultsField || !previousPhaseOutput) {
        return 0;
      }

      const results = this.getJsonPath(previousPhaseOutput, resultsField);
      if (Array.isArray(results)) {
        return results.filter(
          (r: unknown) => {
            if (typeof r === "object" && r !== null && "status" in r) {
              const status = (r as { status: unknown }).status;
              return status === "failure" || status === "blocked";
            }
            return false;
          }
        ).length;
      }
      return 0;
    }

    // by_assignment and all_tasks need task data from state
    // These are handled at orchestration layer
    if (count === "by_assignment" || count === "all_tasks") {
      return 1; // Placeholder - actual count determined by orchestrator
    }

    return 1; // Default fallback
  }

  /**
   * Resolve agent type for by_assignment phases
   *
   * @param phase - Workflow phase configuration
   * @param taskData - Task data containing assignee information
   * @returns Resolved agent type string
   */
  resolveAgentType(
    phase: WorkflowPhase,
    taskData: unknown
  ): string {
    // If not by_assignment, return the agent directly
    if (phase.agent !== "by_assignment") {
      return phase.agent;
    }

    const extPhase = phase as ExtendedPhase;
    const { assignment_field, agent_mapping } = extPhase;

    if (!assignment_field || !agent_mapping) {
      return agent_mapping?.default ?? "backend-engineer";
    }

    // Extract assignee from task data using JSON path
    const assignee = this.getJsonPath(taskData, assignment_field);

    if (typeof assignee === "string" && // Direct mapping lookup
      agent_mapping[assignee]) {
      return agent_mapping[assignee];
    }

    if (Array.isArray(assignee) && assignee.length > 0) {
      const firstAssignee = assignee[0] as unknown;
      if (typeof firstAssignee === "string") {
        // Direct mapping lookup
        if (agent_mapping[firstAssignee]) {
          return agent_mapping[firstAssignee];
        }
        // Try mapping the first assignee's type (e.g., "frontend-engineer" -> try "frontend")
        const typeMatch = firstAssignee.replace("-engineer", "");
        if (agent_mapping[typeMatch]) {
          return agent_mapping[typeMatch];
        }
      }
    }

    return agent_mapping.default ?? "backend-engineer";
  }

  /**
   * Validate agent output against its schema
   *
   * Uses SchemaValidator singleton with fail-open behavior.
   * Missing schemas result in valid=true with warnings.
   *
   * @param output - Agent output to validate
   * @param phase - Workflow phase containing schema reference
   * @returns SchemaValidationResult with errors and warnings
   */
  validateAgentOutput(
    output: unknown,
    phase: WorkflowPhase
  ): SchemaValidationResult {
    const extPhase = phase as ExtendedPhase;

    if (!extPhase.output_schema) {
      // No schema specified - validation passes with no-op
      return { valid: true, errors: [], warnings: [] };
    }

    // Delegate to SchemaValidator singleton
    const validator = getSchemaValidator();

    // The schema file is specified in phase config
    // Strip .json extension if present for consistency
    const schemaName = extPhase.output_schema.replace(/\.json$/, "");

    return validator.validateAgentOutput(output, phase.agent, schemaName);
  }

  /**
   * Auto-detect workflow type from user prompt
   *
   * Matches keywords from workflow entry.auto_detect configuration.
   *
   * @param prompt - User prompt to analyze
   * @returns WorkflowDetection with workflow name and confidence score
   */
  detectWorkflowType(prompt: string): WorkflowDetection {
    this.ensureLoaded();

    const promptLower = prompt.toLowerCase();
    let bestMatch: WorkflowDetection = {
      workflow: "feature-development",
      confidence: 0
    };

    for (const [name, def] of this.definitions) {
      const extDef = def as ExtendedWorkflowConfig;

      if (!extDef.entry?.auto_detect) {
        continue;
      }

      const { keywords, min_score } = extDef.entry.auto_detect;
      let score = 0;

      for (const keyword of keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          score++;
        }
      }

      if (score >= min_score && score > bestMatch.confidence) {
        bestMatch = { workflow: name, confidence: score };
      }
    }

    return bestMatch;
  }

  /**
   * Extract value from nested object using JSON path
   *
   * Supports dot notation and array indexing: "results.tasks[0].id"
   *
   * @param obj - Object to extract value from
   * @param pathStr - Dot-notation path string
   * @returns Extracted value or undefined if not found
   *
   * @example
   * ```typescript
   * const data = { results: { tasks: [{ id: 1 }, { id: 2 }] } };
   * getJsonPath(data, "results.tasks[0].id"); // Returns 1
   * getJsonPath(data, "results.tasks"); // Returns [{ id: 1 }, { id: 2 }]
   * ```
   */
  getJsonPath(obj: unknown, pathStr: string): unknown {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    const parts = pathStr.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array indexing (e.g., "tasks[0]" or "items[123]")
      const arrayMatch = /^(\w+)\[(\d+)\]$/.exec(part);

      if (arrayMatch) {
        const [, key, indexStr] = arrayMatch;
        const record = current as Record<string, unknown>;
        current = record[key];

        if (Array.isArray(current)) {
          const index = Number.parseInt(indexStr, 10);
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        const record = current as Record<string, unknown>;
        current = record[part];
      }
    }

    return current;
  }
}

// Singleton instance
let engineInstance: WorkflowEngine | null = null;

/**
 * Get the singleton WorkflowEngine instance
 *
 * @returns WorkflowEngine singleton instance
 *
 * @example
 * ```typescript
 * const engine = getWorkflowEngine();
 * const workflow = engine.loadWorkflowDefinition('feature-development');
 * ```
 */
export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowEngine();
    // Lazy load workflows on first access (via ensureLoaded)
  }
  return engineInstance;
}

/**
 * Reset singleton for testing
 *
 * Clears the singleton instance, allowing fresh initialization.
 * Primarily used in test suites.
 */
export function resetWorkflowEngine(): void {
  engineInstance = null;
}

// Re-export types for convenience


export {type ValidationError, type ValidationWarning, type SchemaValidationResult} from "./schema-validator.js";