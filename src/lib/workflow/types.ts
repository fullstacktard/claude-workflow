/**
 * Workflow configuration schema for multi-phase orchestration
 * @module workflow/types
 * @version 1.0.0
 */

/**
 * Dynamic count types for agent spawning
 *
 * - `number`: Fixed count - spawn N agents
 * - `from_previous`: Match count from previous phase output
 * - `match_previous`: Same as from_previous (alias)
 * - `failed_only`: Spawn one agent per failed task from previous phase
 * - `all_tasks`: Spawn one agent per task in backlog
 * - `by_assignment`: Spawn agents based on task assignee field
 */
export type AgentCount =
  | "all_tasks"
  | "by_assignment"
  | "failed_only"
  | "from_previous"
  | "match_previous"
  | number;

/**
 * Condition types for phase transitions
 *
 * - `any_failed`: At least one agent failed
 * - `all_passed`: All agents succeeded
 * - `partial_success`: Some passed, some failed
 * - `custom_expression`: Custom JavaScript expression
 */
export type ConditionType =
  | "all_passed"
  | "any_failed"
  | "custom_expression"
  | "partial_success";

/**
 * Conditional transition definition
 * Evaluated in order before the default 'next' field
 */
export interface NextCondition {
  /** Condition to evaluate */
  condition: ConditionType;
  /** Phase ID to transition to if condition is true (null for terminal phases) */
  next_phase: null | string;
}

/**
 * Parse error with location information
 */
export interface ParseError extends Error {
  /** Column number where error occurred (1-indexed) */
  column?: number;
  /** File path where error occurred */
  filePath?: string;
  /** Line number where error occurred (1-indexed) */
  line?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** List of validation errors */
  errors: string[];
  /** Whether the config is valid */
  valid: boolean;
  /** List of non-blocking warnings */
  warnings?: string[];
}

/**
 * Complete workflow configuration
 */
export interface WorkflowConfig {
  /** Human-readable description */
  description: string;
  /** Global timeout for entire workflow (ms) */
  global_timeout_ms?: number;
  /** Metadata for tracking */
  metadata?: {
    author?: string;
    created?: string;
    tags?: string[];
    updated?: string;
  };
  /** Workflow name (kebab-case identifier) */
  name: string;
  /** Ordered phases to execute */
  phases: WorkflowPhase[];
  /** Schema version for future migrations */
  version?: string;
}

/**
 * Individual workflow phase definition
 */
export interface WorkflowPhase {
  /** Agent to spawn for this phase */
  agent: string;
  /** Phase-specific configuration passed through to the agent (e.g., { mode: "preview", platform: "vercel" }) */
  config?: Record<string, boolean | number | string>;
  /** Number of agents to spawn (or dynamic logic) */
  count: AgentCount;
  /** Phase description for logging */
  description?: string;
  /** Unique phase identifier */
  id: string;
  /** Maximum loop iterations (default: 3) */
  max_iterations?: number;
  /** Next phase ID (null for terminal phases) */
  next: null | string;
  /** Conditional transitions (evaluated before 'next') */
  next_conditions?: NextCondition[];
  /** Whether this phase can be skipped (default: false) */
  optional?: boolean;
  /** Whether this phase requires explicit user confirmation before execution (default: false) */
  requires_user_confirmation?: boolean;
  /** Phase timeout in milliseconds */
  timeout_ms?: number;
}
