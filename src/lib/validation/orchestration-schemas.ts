#!/usr/bin/env node

/**
 * Orchestration Command Validation Schemas
 *
 * Validation schemas for all CLI options in the orchestration command.
 * Provides comprehensive validation rules, error messages, and help text.
 *
 * @author claude-workflow
 * @version 1.0.0
 */

import { CLIValidator, type ValidationOptionsResult } from "./clivalidator.js";

/**
 * Known agent types for filter validation
 */
const KNOWN_AGENT_TYPES = [
  "task-management",
  "implementation",
  "review",
  "documentation",
  "ui-generation",
  "architecture",
  "refactor",
  "debug",
  "explore",
  "frontend-engineer",
  "backend-engineer",
  "devops-engineer",
  "general-purpose",
  "research"
] as const;

/**
 * Known outcome types for filter validation
 */
const KNOWN_OUTCOMES = [
  "success",
  "failure",
  "partial",
  "blocked",
  "skipped",
  "timeout"
] as const;

/**
 * Session ID pattern for validation
 */
const SESSION_ID_PATTERN = /^sess_[a-zA-Z0-9]+$/;

/**
 * Magic number constants
 */
const MAX_AGENT_TYPES_TO_DISPLAY = 5;
const MAX_DAYS_WARNING_THRESHOLD = 90;

/**
 * Validation result for custom validators
 */
interface CustomValidationResult {
  error?: string;
  valid: boolean;
  warning?: string;
}

/**
 * Type guard to check if value is a string
 */
function isString(value: boolean | number | string): value is string {
  return typeof value === "string";
}

/**
 * Custom validation function for filter option
 */
function validateFilter(value: boolean | number | string): CustomValidationResult {
  // Type guard to ensure value is a string
  if (!isString(value)) {
    return {
      error: "Filter value must be a string",
      valid: false
    };
  }

  // Allow filtering by agent type
  if (KNOWN_AGENT_TYPES.includes(value as typeof KNOWN_AGENT_TYPES[number])) {
    return { valid: true };
  }

  // Allow filtering by outcome
  if (KNOWN_OUTCOMES.includes(value as typeof KNOWN_OUTCOMES[number])) {
    return { valid: true };
  }

  // Allow partial matches (e.g., "task" matches "task-management")
  const lowerValue = value.toLowerCase();
  if (KNOWN_AGENT_TYPES.some(type => type.includes(lowerValue))) {
    return {
      valid: true,
      warning: `Filter '${value}' matched multiple agent types. Consider being more specific.`
    };
  }

  return {
    error: `Invalid filter '${value}'. Valid agent types: ${KNOWN_AGENT_TYPES.slice(0, MAX_AGENT_TYPES_TO_DISPLAY).join(", ")}... or outcomes: ${KNOWN_OUTCOMES.join(", ")}`,
    valid: false
  };
}

/**
 * Custom validation function for session ID
 */
function validateSession(value: boolean | number | string): CustomValidationResult {
  // Type guard to ensure value is a string
  if (!isString(value)) {
    return {
      error: "Session ID must be a string",
      valid: false
    };
  }

  if (!SESSION_ID_PATTERN.test(value)) {
    return {
      error: `Invalid session ID format: '${value}'. Expected format: sess_[alphanumeric]`,
      valid: false
    };
  }

  return { valid: true };
}

/**
 * Custom validation for watch mode dependencies
 */
function validateWatchDependencies(value: boolean | number | string, context: Record<string, boolean | number | string | undefined>): CustomValidationResult {
  if (Boolean(value) && context.format === "tui") {
    return {
      error: "Watch mode is not compatible with TUI format. Use --format json or --format csv with --watch",
      valid: false
    };
  }

  return { valid: true };
}

/**
 * Validation schemas for orchestration CLI options
 */
const ORCHESTRATION_SCHEMAS = {
  days: {
    conflicts: ["session"], // Can't use both days and session filter
    custom: (value: boolean | number | string): CustomValidationResult => {
      // Type guard to ensure value is a number
      if (typeof value !== "number") {
        return {
          error: "Days value must be a number",
          valid: false
        };
      }

      // Warn about very large ranges
      if (value > MAX_DAYS_WARNING_THRESHOLD) {
        return {
          valid: true,
          warning: `Filtering by ${String(value)} days may impact performance. Consider using a smaller range.`
        };
      }
      return { valid: true };
    },
    dependencies: [],
    description: "Filter analytics to last N days",
    help: "7 (last week), 30 (last month), 90 (last quarter)",
    range: { max: 365, min: 1 },
    type: "number" as const
  },

  filter: {
    conflicts: [],
    custom: validateFilter,
    dependencies: [],
    description: "Filter by agent type or outcome",
    help: "task-management, success, failure, backend-engineer, frontend-engineer",
    type: "string" as const
  },

  format: {
    conflicts: [], // No conflicts
    default: "tui",
    dependencies: [], // No dependencies
    description: "Output format for orchestration analytics",
    enum: ["tui", "json", "csv"],
    help: "tui (interactive), json (machine-readable), csv (spreadsheet)",
    type: "string" as const
  },

  session: {
    conflicts: ["days"], // Can't use both session and days filter
    custom: validateSession,
    dependencies: [],
    description: "Filter by specific session ID",
    help: "sess_abc123, sess_xyz789",
    pattern: SESSION_ID_PATTERN,
    type: "string" as const
  },

  verbose: {
    conflicts: [],
    default: false,
    dependencies: [],
    description: "Enable verbose output with detailed information",
    help: "true/false, yes/no, 1/0, on/off",
    type: "boolean" as const
  },

  watch: {
    conflicts: [],
    custom: validateWatchDependencies,
    default: false,
    dependencies: [],
    description: "Enable watch mode for real-time updates",
    help: "true/false, yes/no, 1/0, on/off (requires non-TUI format)",
    type: "boolean" as const
  }
};

/**
 * Generate help text for orchestration command
 * @returns Formatted help text
 */
export function generateOrchestrationHelp(): string {
  let help = CLIValidator.generateHelpText(ORCHESTRATION_SCHEMAS);

  // Add usage examples section
  help += `Examples:
  npx claude-workflow orchestration                           # Interactive TUI mode (default)
  npx claude-workflow orchestration --json                     # Export as JSON
  npx claude-workflow orchestration --csv                      # Export as CSV
  npx claude-workflow orchestration --days 7                  # Last 7 days
  npx claude-workflow orchestration --filter success          # Only successful workflows
  npx claude-workflow orchestration --filter backend-engineer # Only backend agents
  npx claude-workflow orchestration --session sess_abc123     # Specific session
  npx claude-workflow orchestration --watch --format json     # Real-time JSON updates
  npx claude-workflow orchestration --verbose --days 30       # Verbose output for last month

Notes:
  - TUI format (default) provides interactive dashboard
  - JSON/CSV formats export data and exit immediately
  - Watch mode requires --format to be json or csv
  - Filter supports agent types or outcomes (success/failure/partial/blocked/skipped)
  - Session filters conflict with day filters
`;

  return help;
}

/**
 * Validate orchestration command options
 * @param options - CLI options to validate
 * @returns Validation result
 */
export function validateOrchestrationOptions(options: Record<string, boolean | number | string | undefined>): ValidationOptionsResult {
  return CLIValidator.validateOptions(options, ORCHESTRATION_SCHEMAS);
}