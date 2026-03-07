#!/usr/bin/env node

/**
 * CLI Input Validation Utilities
 *
 * Comprehensive input validation system for CLI commands following clean architecture.
 * Provides type checking, range validation, enum validation, dependency validation,
 * and clear error messages for all command-line options.
 *
 * Features:
 * - Type checking for string, number, and boolean options
 * - Range validation for numeric values
 * - Enum validation for predefined values
 * - Option dependency validation
 * - Clear, actionable error messages
 * - Help text integration with validation rules
 *
 * @author claude-workflow
 * @version 1.0.0
 */

/**
 * Validation options result
 */
export interface ValidationOptionsResult {
  errors: string[];
  normalized: Record<string, boolean | number | string | undefined>;
  valid: boolean;
  warnings: string[];
}

/**
 * Custom validation function
 */
type CustomValidator = (value: boolean | number | string, context: Record<string, boolean | number | string | undefined>) => boolean | string | ValidationResult;

/**
 * Range configuration for numeric validation
 */
interface RangeConfig {
  max?: number;
  min?: number;
}

/**
 * Validation result interface
 */
interface ValidationResult {
  error?: string;
  normalizedValue?: boolean | number | string | undefined;
  valid: boolean;
  warning?: string | undefined;
}

/**
 * Validation schema interface
 */
interface ValidationSchema {
  conflicts?: string[];
  custom?: CustomValidator;
  default?: boolean | number | string;
  dependencies?: string[];
  description?: string;
  enum?: (boolean | number | string)[];
  help?: string;
  pattern?: RegExp;
  range?: RangeConfig;
  required?: boolean;
  type: "boolean" | "number" | "string";
}

/**
 * CLI Validator class following clean architecture principles
 * Domain layer: Pure validation logic without framework dependencies
 */
const CLIValidator = {
  /**
   * Generate help text for validation schemas
   * @param schemas - Validation schemas
   * @returns Formatted help text
   */
  generateHelpText(schemas: Record<string, ValidationSchema>): string {
    let help = "\nOptions:\n";

    for (const [name, schema] of Object.entries(schemas)) {
      help += `  --${name}`;

      if (schema.enum !== undefined) {
        const enumValues = schema.enum.map(String).join("|");
        help += ` <${enumValues}>`;
      } else if (schema.type === "number") {
        help += " <number>";
      } else if (schema.type === "string") {
        help += " <string>";
      }

      help += "\n";

      if (schema.description !== undefined) {
        help += `    ${schema.description}\n`;
      }

      if (schema.enum !== undefined) {
        const enumValues = schema.enum.map(v => `'${String(v)}'`).join(", ");
        help += `    Valid values: ${enumValues}\n`;
      }

      if (schema.range !== undefined) {
        const { max, min } = schema.range;
        if (min !== undefined && max !== undefined) {
          help += `    Range: ${String(min)}-${String(max)}\n`;
        } else if (min !== undefined) {
          help += `    Minimum: ${String(min)}\n`;
        } else if (max !== undefined) {
          help += `    Maximum: ${String(max)}\n`;
        }
      }

      if (schema.default !== undefined) {
        help += `    Default: ${JSON.stringify(schema.default)}\n`;
      }

      if (schema.dependencies !== undefined && schema.dependencies.length > 0) {
        const deps = schema.dependencies.map(dep => `--${dep}`).join(", ");
        help += `    Requires: ${deps}\n`;
      }

      if (schema.conflicts !== undefined && schema.conflicts.length > 0) {
        const conflicts = schema.conflicts.map(conflict => `--${conflict}`).join(", ");
        help += `    Conflicts with: ${conflicts}\n`;
      }

      if (schema.help !== undefined) {
        help += `    Examples: ${schema.help}\n`;
      }

      help += "\n";
    }

    return help;
  },

  /**
   * Validate a single option against a schema
   * @param name - Option name
   * @param value - Option value to validate
   * @param schema - Validation schema
   * @param context - All provided options for dependency validation
   * @returns ValidationResult
   */
  validateOption(
    name: string,
    value: boolean | number | string | undefined,
    schema: ValidationSchema,
    context: Record<string, boolean | number | string | undefined> = {}
  ): ValidationResult {
    // Handle undefined/null values
    if (value === undefined) {
      if (schema.required === true) {
        return {
          error: `Option '--${name}' is required`,
          valid: false
        };
      }
      return {
        normalizedValue: schema.default,
        valid: true
      };
    }

    // Type validation
    const typeResult = CLIValidator.validateType(name, value, schema.type);
    if (!typeResult.valid) {
      return typeResult;
    }

    let normalizedValue = typeResult.normalizedValue;

    // Enum validation
    if (schema.enum !== undefined && normalizedValue !== undefined) {
      const isInEnum = schema.enum.includes(normalizedValue);
      if (!isInEnum) {
        const enumValues = schema.enum.map(v => `'${String(v)}'`).join(", ");
        return {
          error: `Invalid value for '--${name}': '${String(normalizedValue)}'. Valid values are: ${enumValues}`,
          valid: false
        };
      }
    }

    // Range validation for numbers
    if (schema.range !== undefined && typeof normalizedValue === "number") {
      const rangeResult = CLIValidator.validateRange(name, normalizedValue, schema.range);
      if (!rangeResult.valid) {
        return rangeResult;
      }
    }

    // Pattern validation for strings
    if (schema.pattern !== undefined && typeof normalizedValue === "string") {
      const patternResult = CLIValidator.validatePattern(name, normalizedValue, schema.pattern);
      if (!patternResult.valid) {
        return patternResult;
      }
    }

    // Custom validation
    if (schema.custom !== undefined && normalizedValue !== undefined) {
      try {
        const customResult = schema.custom(normalizedValue, context);
        if (typeof customResult === "string") {
          return {
            error: customResult,
            valid: false
          };
        } else if (typeof customResult === "object") {
          if (!customResult.valid) {
            const errorMsg = customResult.error ?? `Custom validation failed for '--${name}'`;
            return {
              error: errorMsg,
              valid: false
            };
          }
          if (customResult.normalizedValue !== undefined) {
            normalizedValue = customResult.normalizedValue;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          error: `Validation error for '--${name}': ${errorMessage}`,
          valid: false
        };
      }
    }

    return {
      normalizedValue,
      valid: true,
      warning: typeResult.warning
    };
  },

  /**
   * Validate multiple options with dependency checking
   * @param options - All options to validate
   * @param schemas - Validation schemas
   * @returns Validation result with errors and normalized options
   */
  validateOptions(
    options: Record<string, boolean | number | string | undefined>,
    schemas: Record<string, ValidationSchema>
  ): ValidationOptionsResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalized: Record<string, boolean | number | string | undefined> = {};

    // First pass: validate individual options
    for (const [name, schema] of Object.entries(schemas)) {
      const result = CLIValidator.validateOption(name, options[name], schema, options);

      if (result.valid) {
        normalized[name] = result.normalizedValue;
        if (result.warning !== undefined) {
          warnings.push(result.warning);
        }
      } else if (result.error !== undefined) {
        errors.push(result.error);
      }
    }

    // Second pass: check dependencies and conflicts
    for (const [name, schema] of Object.entries(schemas)) {
      const optionValue = options[name];
      if (optionValue !== undefined) {
        // Check required dependencies
        if (schema.dependencies !== undefined) {
          for (const dep of schema.dependencies) {
            const depValue = options[dep];
            if (depValue === undefined) {
              errors.push(`Option '--${name}' requires '--${dep}' to be specified`);
            }
          }
        }

        // Check conflicts
        if (schema.conflicts !== undefined) {
          for (const conflict of schema.conflicts) {
            const conflictValue = options[conflict];
            if (conflictValue !== undefined) {
              errors.push(`Option '--${name}' conflicts with '--${conflict}'`);
            }
          }
        }
      }
    }

    return {
      errors,
      normalized,
      valid: errors.length === 0,
      warnings
    };
  },

  /**
   * Validate regex pattern
   * @param name - Option name
   * @param value - Value to validate
   * @param pattern - Regex pattern
   * @returns ValidationResult
   */
  validatePattern(name: string, value: string, pattern: RegExp): ValidationResult {
    if (!pattern.test(value)) {
      return {
        error: `Option '--${name}' has invalid format: '${value}'`,
        valid: false
      };
    }

    return {
      normalizedValue: value,
      valid: true
    };
  },

  /**
   * Validate numeric range
   * @param name - Option name
   * @param value - Value to validate
   * @param range - Range object with min and/or max
   * @returns ValidationResult
   */
  validateRange(name: string, value: number, range: RangeConfig): ValidationResult {
    const { max, min } = range;

    if (min !== undefined && value < min) {
      return {
        error: `Option '--${name}' must be at least ${String(min)}, got ${String(value)}`,
        valid: false
      };
    }

    if (max !== undefined && value > max) {
      return {
        error: `Option '--${name}' must be at most ${String(max)}, got ${String(value)}`,
        valid: false
      };
    }

    return {
      normalizedValue: value,
      valid: true
    };
  },

  /**
   * Validate data type
   * @param name - Option name
   * @param value - Value to validate
   * @param expectedType - Expected type
   * @returns ValidationResult
   */
  validateType(name: string, value: boolean | number | string, expectedType: "boolean" | "number" | "string"): ValidationResult {
    switch (expectedType) {
    case "boolean": {
      if (typeof value === "boolean") {
        return {
          normalizedValue: value,
          valid: true
        };
      }
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        const BOOLEAN_TRUE_VALUES = ["1", "on", "true", "yes"] as const;
        const BOOLEAN_FALSE_VALUES = ["0", "false", "no", "off"] as const;

        if (BOOLEAN_TRUE_VALUES.includes(lower as typeof BOOLEAN_TRUE_VALUES[number])) {
          return {
            normalizedValue: true,
            valid: true
          };
        }
        if (BOOLEAN_FALSE_VALUES.includes(lower as typeof BOOLEAN_FALSE_VALUES[number])) {
          return {
            normalizedValue: false,
            valid: true
          };
        }
        return {
          error: `Option '--${name}' must be a boolean, got '${value}'. Use: true, false, 1, 0, yes, no, on, off`,
          valid: false
        };
      }
      return {
        error: `Option '--${name}' must be a boolean, got ${typeof value}`,
        valid: false
      };
    }

    case "number": {
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isNaN(parsed)) {
          return {
            error: `Option '--${name}' must be a number, got '${value}'`,
            valid: false
          };
        }
        return {
          normalizedValue: parsed,
          valid: true,
          warning: `Converted '--${name}' from string '${value}' to number ${String(parsed)}`
        };
      }
      if (typeof value !== "number") {
        return {
          error: `Option '--${name}' must be a number, got ${typeof value}`,
          valid: false
        };
      }
      return {
        normalizedValue: value,
        valid: true
      };
    }

    case "string": {
      if (typeof value !== "string") {
        return {
          error: `Option '--${name}' must be a string, got ${typeof value}`,
          valid: false
        };
      }
      return {
        normalizedValue: value.trim(),
        valid: true
      };
    }

    default: {
      // TypeScript exhaustiveness check - this should never happen
      const exhaustiveCheck: never = expectedType;
      return {
        error: `Unknown type '${String(exhaustiveCheck)}' for option '--${name}'`,
        valid: false
      };
    }
    }
  },
};

export { CLIValidator };
