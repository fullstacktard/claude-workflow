/**
 * Workflow Schema Validator
 *
 * Validates workflow YAML data against the JSON schema using ajv.
 * Provides detailed error messages with field paths and dependency cycle detection.
 *
 * @module workflow-validator
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { resolve } = path;

// AJV types are imported directly from the package

/**
 * Validation error with field path and human-readable message
 */
export interface ValidationError {
  /** JSON path to the field with error (e.g., "phases[2].agent") */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Error severity: "error" blocks save, "warning" allows save */
  severity: "error" | "warning";
  /** AJV keyword that failed (e.g., "required", "type", "pattern") */
  keyword?: string;
  /** Additional context (e.g., expected value, allowed values) */
  context?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of validation errors (empty if valid) */
  errors: ValidationError[];
  /** List of warnings (non-blocking issues) */
  warnings: ValidationError[];
  /** Performance metric: validation time in ms */
  validationTimeMs: number;
}

/**
 * Workflow data interface for cycle detection
 */
interface WorkflowData {
  phases?: Array<{
    id: string;
    next?: string | null;
    next_conditions?: Array<{
      next_phase?: string | null;
    }>;
  }>;
}

/**
 * Workflow schema validator using ajv
 * Validates workflow YAML data against workflow.schema.json
 */
export class WorkflowValidator {
  private validateFn: ValidateFunction;
  private schemaPath: string;

  constructor(schemaPath?: string) {
    // Default to bundled schema - try multiple paths for dev/prod/docker environments
    if (schemaPath) {
      this.schemaPath = schemaPath;
    } else {
      const candidates = [
        resolve(__dirname, "../../../../templates/.claude/schemas/workflow.schema.json"),     // prod (dist/)
        resolve(__dirname, "../../../templates/.claude/schemas/workflow.schema.json"),          // dev (src/lib/)
        resolve(__dirname, "../../../../src/templates/.claude/schemas/workflow.schema.json"),   // docker dev
      ];
      this.schemaPath = candidates.find(p => existsSync(p)) ?? candidates[0];
    }

    // Initialize ajv with strict mode disabled (allow additional properties)
    const ajv = new Ajv({
      allErrors: true,  // Report all errors, not just first
      strict: false,    // Allow additional properties not in schema
      verbose: true,    // Include data values in errors
    });

    // Load and compile schema
    const schemaContent = readFileSync(this.schemaPath, "utf8");
    const schema = JSON.parse(schemaContent) as Record<string, unknown>;
    this.validateFn = ajv.compile(schema);
  }

  /**
   * Validate workflow data against schema
   * @param workflowData - Parsed workflow YAML as plain object
   * @returns Validation result with errors and warnings
   */
  validate(workflowData: unknown): ValidationResult {
    const startTime = performance.now();

    // Run ajv validation
    this.validateFn(workflowData);
    const ajvErrors = this.validateFn.errors ?? [];

    // Transform ajv errors to our format
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const error of ajvErrors) {
      const validationError = this.transformAjvError(error);
      errors.push(validationError);
    }

    // Add cycle detection (only if basic schema is valid)
    if (errors.length === 0) {
      const cycleErrors = this.detectCycles(workflowData as WorkflowData);
      errors.push(...cycleErrors);
    }

    const validationTimeMs = performance.now() - startTime;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validationTimeMs,
    };
  }

  /**
   * Validate partial workflow (for real-time feedback)
   * Relaxes required field constraints
   *
   * @param partialData - Partial workflow data
   * @returns Validation result with only critical errors
   */
  validatePartial(partialData: unknown): ValidationResult {
    const startTime = performance.now();

    // For partial validation:
    // - Required fields become optional (treat missing as warnings)
    // - Type/pattern errors remain as errors
    // - Cycle detection skipped (incomplete graph)

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Run full validation
    const fullResult = this.validate(partialData);

    // Reclassify "required" errors as warnings for partial validation
    for (const error of fullResult.errors) {
      if (error.keyword === "required") {
        warnings.push({
          ...error,
          severity: "warning",
        });
      } else if (error.keyword === "dependency-cycle") {
        // Skip cycle detection for partial workflows
        continue;
      } else {
        errors.push(error);
      }
    }

    const validationTimeMs = performance.now() - startTime;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validationTimeMs,
    };
  }

  /**
   * Transform ajv error to our ValidationError format
   */
  private transformAjvError(error: ErrorObject): ValidationError {
    // Convert instancePath to readable field path
    // "/phases/2/agent" → "phases[2].agent"
    const field = this.formatFieldPath(error.instancePath);

    // Create human-readable message based on error keyword
    const message = this.createErrorMessage(error, field);

    return {
      field: field || "(root)",
      message,
      severity: "error",
      keyword: error.keyword,
      context: error.params,
    };
  }

  /**
   * Format JSON path to readable field path
   * "/phases/2/agent" → "phases[2].agent"
   */
  private formatFieldPath(instancePath: string | undefined): string {
    if (!instancePath || instancePath === "/") {
      return "";
    }

    // Remove leading slash and convert to dot notation with array indices
    return instancePath
      .slice(1)
      .replaceAll('/', ".")
      .replaceAll(/\.(\d+)\./g, "[$1].")
      .replaceAll(/\.(\d+)$/g, "[$1]");
  }

  /**
   * Create human-readable error message
   */
  private createErrorMessage(error: ErrorObject, field: string): string {
    switch (error.keyword) {
    case "required": {
      const missingProperty = (error.params as { missingProperty: string }).missingProperty;
      return `Missing required field: ${field ? `${field}.` : ""}${missingProperty}`;
    }

    case "type": {
      const expectedType = (error.params as { type: string }).type;
      return `Field "${field}" must be of type ${expectedType}`;
    }

    case "pattern": {
      const pattern = (error.params as { pattern: string }).pattern;
      return `Field "${field}" does not match required pattern: ${pattern}`;
    }

    case "enum": {
      const allowedValues = (error.params as { allowedValues: unknown[] }).allowedValues;
      return `Field "${field}" must be one of: ${allowedValues.join(", ")}`;
    }

    case "minItems": {
      const minItems = (error.params as { limit: number }).limit;
      return `Field "${field}" must have at least ${minItems} items`;
    }

    case "additionalProperties": {
      const additionalProperty = (error.params as { additionalProperty: string }).additionalProperty;
      return `Unknown field: ${field ? `${field}.` : ""}${additionalProperty}`;
    }

    default: {
      return error.message ?? `Validation error in field "${field}"`;
    }
    }
  }

  /**
   * Detect circular dependencies in workflow phases
   * Uses depth-first search with color marking
   *
   * @param workflowData - Parsed workflow data
   * @returns Array of cycle errors (empty if no cycles)
   */
  private detectCycles(workflowData: WorkflowData): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!workflowData.phases || !Array.isArray(workflowData.phases)) {
      return errors;
    }

    // Build adjacency list (phase ID → next phase IDs)
    const graph = new Map<string, string[]>();
    const phaseIds = new Set<string>();

    for (const phase of workflowData.phases) {
      phaseIds.add(phase.id);
      const nextPhases: string[] = [];

      // Add default next
      if (phase.next && typeof phase.next === "string") {
        nextPhases.push(phase.next);
      }

      // Add conditional next phases
      if (phase.next_conditions && Array.isArray(phase.next_conditions)) {
        for (const condition of phase.next_conditions) {
          if (condition.next_phase && typeof condition.next_phase === "string") {
            nextPhases.push(condition.next_phase);
          }
        }
      }

      graph.set(phase.id, nextPhases);
    }

    // DFS with color marking
    // WHITE = not visited, GRAY = visiting (in current path), BLACK = visited
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const colors = new Map<string, number>();
    const path: string[] = [];

    // Initialize all nodes as white
    for (const id of phaseIds) {
      colors.set(id, WHITE);
    }

    /**
     * DFS visit with cycle detection
     * Returns true if cycle detected
     */
    const visit = (phaseId: string): boolean => {
      colors.set(phaseId, GRAY);
      path.push(phaseId);

      const neighbors = graph.get(phaseId) ?? [];

      for (const nextId of neighbors) {
        // Skip null transitions (terminal phases)
        if (!phaseIds.has(nextId)) {
          continue;
        }

        const color = colors.get(nextId) ?? WHITE;

        if (color === GRAY) {
          // Back edge detected - cycle found!
          const cycleStart = path.indexOf(nextId);
          const cycle = [...path.slice(cycleStart), nextId];

          errors.push({
            field: `phases[${phaseId}]`,
            message: `Circular dependency detected: ${cycle.join(" → ")}`,
            severity: "error",
            keyword: "dependency-cycle",
            context: { cycle },
          });

          return true;
        }

        if (color === WHITE && visit(nextId)) {
          return true;  // Cycle found in subtree
        }
      }

      path.pop();
      colors.set(phaseId, BLACK);
      return false;
    };

    // Check all nodes (handles disconnected components)
    for (const id of phaseIds) {
      if (colors.get(id) === WHITE) {
        visit(id);
      }
    }

    return errors;
  }
}
