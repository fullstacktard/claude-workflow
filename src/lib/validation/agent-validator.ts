
import type { AnySchemaObject, ErrorObject, ValidateFunction as AjvValidateFunction } from "ajv/dist/types/index.js";
import type AjvType from "ajv";

// AJV imports - the library has complex ESM/CJS interop
import AjvDefault from "ajv";
import addFormatsDefault from "ajv-formats";

import SchemaLoader from "./schema-loader.js";

type AddFormatsFunction = (ajv: AjvType) => void;
type AjvConstructor = new (options?: {
    allErrors?: boolean;
    coerceTypes?: boolean;
    removeAdditional?: boolean;
    strict?: boolean;
    useDefaults?: boolean;
    verbose?: boolean;
  }) => AjvInstance;
type AjvInstance = AjvType;
type JsonArray = JsonValue[];

interface JsonObject { [key: string]: JsonValue }

// JSON value types for runtime validation
type JsonPrimitive = boolean | null | number | string;

type JsonValue = JsonArray | JsonObject | JsonPrimitive;

// Runtime module resolution for AJV (handles ESM/CJS differences)
const Ajv = ((AjvDefault as { default?: AjvConstructor }).default ?? AjvDefault) as AjvConstructor;
const addFormats = ((addFormatsDefault as { default?: AddFormatsFunction }).default ?? addFormatsDefault);

interface SchemaStats {
  basePath: string;
  cachedSchemas: number;
}

interface ValidationResult {
  errors: string[];
  isFallback?: boolean;
  timestamp?: string;
  valid: boolean;
  validationTime: number;
}


/**
 * Agent Validator utility using AJV for JSON schema validation
 * Provides high-performance validation with compiled schema caching
 */
class AgentValidator {
  public compiledValidators: Map<string, AjvValidateFunction>;
  public schemaLoader: typeof SchemaLoader;
  private ajv: AjvInstance | undefined = undefined;
  private fallbackValidationEnabled: boolean;
  private lastLoadAttempt: number;
  private loadRetryDelay: number;

  constructor() {
    this.compiledValidators = new Map();
    this.schemaLoader = SchemaLoader;
    this.lastLoadAttempt = 0;
    this.loadRetryDelay = 5000; // 5 seconds between retries
    this.fallbackValidationEnabled = true;

    this.initialize();
  }

  /**
   * Create validation result object
   * @param {boolean} valid - Whether validation passed
   * @param {Array} errors - Array of error messages
   * @param {number} validationTime - Time taken to validate in ms
   * @param {boolean} isFallback - Whether fallback validation was used
   * @returns {Object} Validation result
   */
  createResult(valid: boolean, errors: string[], validationTime: number, isFallback = false): ValidationResult {
    return {
      errors,
      isFallback,
      timestamp: new Date().toISOString(),
      valid,
      validationTime
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.compiledValidators.clear();
    this.ajv = undefined;
  }

  /**
   * Validate agent JSON data against the universal schema
   * @param {Object} data - Agent JSON data to validate
   * @returns {Object} Validation result with validity and errors
   */

  /**
   * Format AJV errors into human-readable messages
   * @param {Array} ajvErrors - AJV error objects
   * @returns {Array} Formatted error messages
   */
  formatAjvErrors(ajvErrors: ErrorObject[]): string[] {
    const errors: string[] = [];

    for (const error of ajvErrors) {
      const path = error.instancePath || "root";
      const message = this.formatErrorMessage(error, path);
      errors.push(message);
    }

    return errors;
  }

  /**
   * Format individual error message
   * @param {Object} error - AJV error object
   * @param {string} path - Error path
   * @returns {string} Formatted error message
   */
  formatErrorMessage(error: ErrorObject, path: string): string {
    const { keyword, message, params } = error;
    const data = error.data;
    const typedParams = params as Record<string, boolean | number | string | string[]>;

    switch (keyword) {
    case "additionalProperties": {
      return `Additional property not allowed at ${path}: ${String(typedParams.additionalProperty)}`;
    }

    case "const": {
      return `Value at ${path} must be exactly ${JSON.stringify(typedParams.allowedValue)}`;
    }

    case "enum": {
      const allowedValues = typedParams.allowedValues as string[];
      return `Invalid value at ${path}: ${JSON.stringify(data)} not in allowed values [${allowedValues.join(", ")}]`;
    }

    case "format": {
      return `Invalid format at ${path}: value ${JSON.stringify(data)} does not match ${String(typedParams.format)} format`;
    }

    case "maximum": {
      return `Value at ${path} (${String(data)}) is above maximum (${String(typedParams.limit)})`;
    }

    case "minimum": {
      return `Value at ${path} (${String(data)}) is below minimum (${String(typedParams.limit)})`;
    }

    case "oneOf": {
      return `Data at ${path} does not match any of the allowed schemas`;
    }

    case "pattern": {
      return `Invalid pattern at ${path}: value ${JSON.stringify(data)} does not match required pattern`;
    }

    case "required": {
      return `Missing required field: ${String(typedParams.missingProperty)} at ${path}`;
    }

    case "type": {
      return `Invalid type at ${path}: expected ${String(typedParams.type)}, got ${typeof data}`;
    }

    default: {
      return `${message ?? "Validation error"} at ${path}`;
    }
    }
  }

  /**
   * Get validation statistics
   * @returns {Object} Statistics object
   */
  getStats(): { compiledValidators: number; fallbackEnabled: boolean; isInitialized: boolean; schemaStats: SchemaStats } {
    return {
      compiledValidators: this.compiledValidators.size,
      fallbackEnabled: this.fallbackValidationEnabled,
      isInitialized: this.ajv !== undefined,
      schemaStats: this.schemaLoader.getStats()
    };
  }

  /**
   * Initialize AJV and load schema
   */
  initialize(): void {
    try {
      // Configure AJV with all errors mode for comprehensive validation
      this.ajv = new Ajv({
        allErrors: true, // Report all errors, not just first one
        coerceTypes: false,  // Don't coerce types
        removeAdditional: false, // Don't remove additional properties
        strict: false,    // Allow more flexible validation
        useDefaults: false, // Don't fill in defaults
        verbose: true   // Include more details in errors
      });

      // Add JSON Schema formats support
      addFormats(this.ajv);

      // Load and compile the universal schema
      this.loadAndCompileSchema();
    } catch (error) {

      console.error("Failed to initialize AgentValidator:", error);
      this.ajv = undefined;
    }
  }

  /**
   * Load and compile the universal agent output schema
   */
  loadAndCompileSchema(): boolean {
    const now = Date.now();

    // Don't retry too frequently
    if (now - this.lastLoadAttempt < this.loadRetryDelay) {
      return false;
    }

    this.lastLoadAttempt = now;

    const schema = this.schemaLoader.loadSchema("agent-output-schema") as AnySchemaObject | undefined;

    if (schema === undefined) {

      console.warn("Failed to load agent-output-schema.json, validation will be disabled");
      return false;
    }

    try {
      if (this.ajv === undefined) {
        console.error("AJV not initialized");
        return false;
      }

      const validator = this.ajv.compile(schema) as AjvValidateFunction;

      // Cache the compiled validator
      this.compiledValidators.set("agent-output-schema", validator);
      return true;
    } catch (error) {

      console.error("Failed to compile agent schema:", error);
      return false;
    }
  }

  /**
   * Perform fallback validation using basic checks
   * @param {Object} data - Data to validate
   * @param {number} startTime - Validation start time
   * @returns {Object} Validation result
   */
  performFallbackValidation(data: JsonValue, startTime: number): ValidationResult {

    console.warn("Using fallback validation - schema not available");
    const errors: string[] = [];

    // Type guard to ensure data is an object
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      errors.push("Data must be a valid object");
      return this.createResult(false, errors, Date.now() - startTime, true);
    }

    const dataObj = data;

    // Basic required field checks
    const requiredFields = ["agent_id", "agent_type", "timestamp", "session_id", "schema_version", "status", "nextAction", "metadata"];

    for (const field of requiredFields) {
      if (!(field in dataObj)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Basic enum validations
    const validAgentTypes = ["task-management", "implementation", "review", "documentation", "ui-generation", "architecture", "research", "refactor", "debug", "explore"];
    const agentType = dataObj.agent_type;
    if (typeof agentType === "string" && agentType !== "" && !validAgentTypes.includes(agentType)) {
      errors.push(`Invalid agent_type: ${agentType}`);
    }

    const validStatuses = ["success", "failure", "partial", "blocked", "skipped"];
    const status = dataObj.status;
    if (typeof status === "string" && status !== "" && !validStatuses.includes(status)) {
      errors.push(`Invalid status: ${status}`);
    }

    // Basic nextAction validation
    const nextAction = dataObj.nextAction;
    if (typeof nextAction === "object" && nextAction !== null && !Array.isArray(nextAction)) {
      const nextActionObj = nextAction;
      const nextActionType = nextActionObj.type;
      if (typeof nextActionType !== "string" || nextActionType === "") {
        errors.push("nextAction missing required field: type");
      }
    }

    const validationTime = Date.now() - startTime;
    return this.createResult(errors.length === 0, errors, validationTime, true);
  }

  /**
   * Force reload of schema and recompile validators
   * @returns {boolean} Success status
   */
  reloadSchema(): boolean {
    // Clear compiled validators
    this.compiledValidators.clear();

    // Clear schema loader cache
    this.schemaLoader.clearCache(undefined);

    // Reload and recompile
    return this.loadAndCompileSchema();
  }

  /**
   * Enable or disable fallback validation
   * @param {boolean} enabled - Whether to enable fallback validation
   */
  setFallbackValidation(enabled: boolean): void {
    this.fallbackValidationEnabled = enabled;
  }

  validate(data: JsonValue): ValidationResult {
    const startTime = Date.now();

    // Check if validator is available
    if (this.ajv === undefined) {
      return this.createResult(false, ["AJV validator not initialized"], Date.now() - startTime);
    }

    // Get compiled validator
    const validator = this.compiledValidators.get("agent-output-schema");

    if (validator === undefined) {
      // Try to load schema if not cached
      if (this.loadAndCompileSchema()) {
        return this.validate(data); // Retry after loading
      }

      if (this.fallbackValidationEnabled) {
        return this.performFallbackValidation(data, startTime);
      }

      return this.createResult(false, ["Schema not loaded and fallback disabled"], Date.now() - startTime);
    }

    // Perform validation
    const isValid = validator(data);
    const validationTime = Date.now() - startTime;

    if (isValid) {
      return this.createResult(true, [], validationTime);
    }

    // Format AJV errors into human-readable messages
    const errors = this.formatAjvErrors(validator.errors ?? []);
    return this.createResult(false, errors, validationTime);
  }
}

// Export both the class and a global instance
export { AgentValidator };

// Global instance for reuse
const globalAgentValidator = new AgentValidator();

export default globalAgentValidator;
