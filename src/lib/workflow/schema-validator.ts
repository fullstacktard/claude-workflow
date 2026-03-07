/**
 * Schema Validator for workflow agent outputs
 * Provides runtime JSON Schema validation with fail-open behavior
 * @module workflow/schema-validator
 */

import type { AnySchemaObject, ErrorObject, ValidateFunction as AjvValidateFunction } from "ajv/dist/types/index.js";
import type AjvType from "ajv";

import AjvDefault from "ajv";
import addFormatsDefault from "ajv-formats";
import * as fs from "node:fs";
import * as path from "node:path";

// ESM/CJS interop (same pattern as agent-validator.ts)
type AddFormatsFunction = (ajv: AjvType) => void;
type AjvConstructor = new (options?: AjvOptions) => AjvInstance;

interface AjvOptions {
  allErrors?: boolean;
  coerceTypes?: boolean;
  removeAdditional?: boolean;
  strict?: boolean;
  useDefaults?: boolean;
  verbose?: boolean;
}

type AjvInstance = AjvType;

// Runtime module resolution for AJV (handles ESM/CJS differences)
const Ajv = ((AjvDefault as { default?: AjvConstructor }).default ?? AjvDefault) as AjvConstructor;
const addFormats = ((addFormatsDefault as { default?: AddFormatsFunction }).default ?? addFormatsDefault);

/**
 * Detailed validation error
 */
export interface ValidationError {
  /** Error keyword (type, required, enum, etc.) */
  keyword: string;
  /** Human-readable error message */
  message: string;
  /** Error parameters from Ajv */
  params: Record<string, unknown>;
  /** JSON path to the error location */
  path: string;
}

/**
 * Validation warning (non-blocking)
 */
export interface ValidationWarning {
  /** Warning message */
  message: string;
  /** JSON path to the warning location */
  path: string;
  /** Suggestion for fixing the warning */
  suggestion: string;
}

/**
 * Validation result with errors and warnings
 */
export interface SchemaValidationResult {
  /** List of validation errors */
  errors: ValidationError[];
  /** Whether the data is valid */
  valid: boolean;
  /** List of non-blocking warnings */
  warnings: ValidationWarning[];
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** List of cached schema names */
  schemas: string[];
  /** Number of cached schemas */
  size: number;
}

/**
 * SchemaValidator class for workflow agent output validation
 *
 * Features:
 * - Ajv-based JSON Schema validation
 * - Compiled schema caching for performance
 * - Fail-open behavior for missing schemas (returns valid=true with warnings)
 * - ajv-formats for date-time, uri validators
 *
 * @example
 * ```typescript
 * const validator = getSchemaValidator();
 * const result = validator.validateAgentOutput(output, "backend-engineer");
 * if (!result.valid) {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export class SchemaValidator {
  private ajv: AjvInstance;
  private cache: Map<string, AjvValidateFunction>;
  private schemaBasePath: string;

  /**
   * Create a new SchemaValidator instance
   * @param schemaBasePath - Custom path to schema files (defaults to .claude/schemas)
   */
  constructor(schemaBasePath?: string) {
    this.cache = new Map();
    this.schemaBasePath = schemaBasePath ?? path.resolve(".claude/schemas");

    // Configure Ajv per spec: allErrors=true, verbose=true, strict=false
    this.ajv = new Ajv({
      allErrors: true,
      coerceTypes: false,
      removeAdditional: false,
      strict: false,
      useDefaults: false,
      verbose: true
    });

    // Add format validators (date-time, uri, etc.)
    addFormats(this.ajv);
  }

  /**
   * Clear schema cache
   *
   * @param schemaName - Optional specific schema to clear (clears all if omitted)
   */
  clearCache(schemaName?: string): void {
    if (schemaName) {
      this.cache.delete(schemaName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns Cache statistics including size and cached schema names
   */
  getCacheStats(): CacheStats {
    return {
      schemas: [...this.cache.keys()],
      size: this.cache.size
    };
  }

  /**
   * Validate agent output against schema
   *
   * Implements fail-open behavior: returns valid=true with warnings if schema not found.
   * This ensures workflow resilience when schemas are missing or invalid.
   *
   * @param output - Agent output data to validate
   * @param agentType - Type of agent (used to select schema: {agentType}-output-schema)
   * @param schemaFile - Optional explicit schema file name (without .json extension)
   * @returns SchemaValidationResult with errors and warnings
   */
  validateAgentOutput(
    output: unknown,
    agentType: string,
    schemaFile?: string
  ): SchemaValidationResult {
    const schemaName = schemaFile ?? `${agentType}-output-schema`;

    // Try to get cached validator
    let validator = this.cache.get(schemaName);

    if (!validator) {
      // Load and compile schema
      const schema = this.loadSchema(schemaName);

      if (!schema) {
        // FAIL-OPEN: Return valid with warning if schema not found
        return {
          errors: [],
          valid: true,
          warnings: [{
            message: `Schema '${schemaName}' not found, validation skipped`,
            path: "root",
            suggestion: `Create schema file at ${this.schemaBasePath}/${schemaName}.json`
          }]
        };
      }

      try {
        validator = this.ajv.compile(schema) as AjvValidateFunction;
        this.cache.set(schemaName, validator);
      } catch (compileError) {
        // FAIL-OPEN: Return valid with warning if schema compilation fails
        return {
          errors: [],
          valid: true,
          warnings: [{
            message: `Schema '${schemaName}' compilation failed: ${String(compileError)}`,
            path: "root",
            suggestion: "Check schema syntax and fix compilation errors"
          }]
        };
      }
    }

    // Perform validation
    const isValid = validator(output);

    if (isValid) {
      return { errors: [], valid: true, warnings: [] };
    }

    // Format errors
    const errors = this.formatErrors(validator.errors ?? []);

    return { errors, valid: false, warnings: [] };
  }

  /**
   * Format Ajv errors into ValidationError objects
   * @param ajvErrors - Raw Ajv error objects
   * @returns Formatted ValidationError array
   */
  private formatErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map(error => ({
      keyword: error.keyword,
      message: error.message ?? "Validation error",
      params: error.params as Record<string, unknown>,
      path: error.instancePath || "root"
    }));
  }

  /**
   * Load schema from file system
   * @param schemaName - Schema name (without .json extension)
   * @returns Parsed schema object or undefined if not found
   */
  private loadSchema(schemaName: string): AnySchemaObject | undefined {
    const schemaPath = path.join(this.schemaBasePath, `${schemaName}.json`);

    if (!fs.existsSync(schemaPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(schemaPath, "utf8");
      return JSON.parse(content) as AnySchemaObject;
    } catch {
      return undefined;
    }
  }
}

// Singleton instance
let validatorInstance: SchemaValidator | undefined;

/**
 * Get singleton SchemaValidator instance
 *
 * @param schemaBasePath - Optional custom schema path (only used on first call)
 * @returns SchemaValidator singleton instance
 */
export function getSchemaValidator(schemaBasePath?: string): SchemaValidator {
  if (!validatorInstance) {
    validatorInstance = new SchemaValidator(schemaBasePath);
  }
  return validatorInstance;
}

/**
 * Reset singleton instance (primarily for testing)
 */
export function resetSchemaValidator(): void {
  validatorInstance = undefined;
}
