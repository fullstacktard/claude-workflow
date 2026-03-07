/**
 * Configuration Manager - Handle reading, validating, and writing .claude/settings.json
 *
 * Provides atomic writes with backup creation, schema validation, and file locking
 * to prevent concurrent write conflicts and ensure configuration integrity.
 */

import AjvModule, { type ErrorObject as AjvErrorObject } from "ajv";
import addFormats from "ajv-formats";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ConfigLockError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  ConfigWriteError,
} from "./errors/config-errors.js";

/**
 * Ajv constructor type
 */
type AjvConstructor = new (options: { allErrors: boolean; verbose: boolean }) => AjvInstance;

/**
 * Ajv instance interface
 */
interface AjvInstance {
  addSchema(schema: object, key: string): void;
  getSchema(key: string): AjvValidateFunction | undefined;
}

/**
 * Ajv validator function interface
 */
interface AjvValidateFunction {
  (data: JsonObject | SettingsConfig): boolean;
  errors?: AjvErrorObject[] | null;
}

// Extract Ajv constructor - AjvModule is the constructor
 
const Ajv = AjvModule as unknown as AjvConstructor;

/**
 * Settings configuration structure matching .claude/settings.json
 */
export interface SettingsConfig {
  hooks: Record<string, {
    hooks: {
      command: string;
      type: string;
    }[];
    matcher: string;
  }[]>;
  outputStyle?: string;
  permissions: {
    allow: string[];
    ask: string[];
    deny: string[];
  };
  thinkingMode?: string;
}

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: boolean | number | string;
}

/**
 * Validation result with detailed error information
 */
export interface ValidationResult {
  errors?: ValidationErrorDetail[];
  valid: boolean;
}

/**
 * JSON-compatible array
 */
type JsonArray = JsonValue[];

/**
 * JSON-compatible object
 */
interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * JSON-compatible primitive types
 */
type JsonPrimitive = boolean | null | number | string;

/**
 * JSON-compatible value types (primitives, arrays, or objects)
 */
type JsonValue = JsonArray | JsonObject | JsonPrimitive;

/**
 * Configuration Manager for .claude/settings.json
 *
 * Handles all configuration file operations with:
 * - JSON schema validation
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup creation
 * - File locking to prevent concurrent writes
 * - Detailed error handling
 */
export class ConfigurationManager {
  private readonly ajv: AjvInstance;
  private readonly backupPath: string;
  private readonly configPath: string;
  private readonly lockPath: string;
  private readonly schema: object;

  /**
   * Create a new ConfigurationManager instance
   *
   * @param projectRoot - Root directory of the project (defaults to current working directory)
   */
  constructor(projectRoot: string = process.cwd()) {
    this.configPath = path.join(projectRoot, ".claude", "settings.json");
    this.backupPath = `${this.configPath}.backup`;
    this.lockPath = `${this.configPath}.lock`;

    // Load schema from file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, "schemas", "settings.schema.json");

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }

    this.schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as object;

    // Initialize Ajv with formats support
    this.ajv = new Ajv({ allErrors: true, verbose: true });

    // Add format validators (date, email, uri, etc.)
     
    addFormats(this.ajv as any);
    this.ajv.addSchema(this.schema, "settings");
  }

  /**
   * Read and parse configuration file
   *
   * Note: This is a synchronous read operation. Since settings.json is typically
   * small (a few KB), blocking read is acceptable and simplifies the API.
   *
   * @returns Parsed configuration object
   * @throws {ConfigNotFoundError} If file doesn't exist
   * @throws {ConfigParseError} If JSON is invalid
   */
  public readConfig(): SettingsConfig {
    if (!fs.existsSync(this.configPath)) {
      throw new ConfigNotFoundError(
        `Configuration file not found: ${this.configPath}`
      );
    }

    try {
      const content = fs.readFileSync(this.configPath, "utf8");
      const config = JSON.parse(content) as SettingsConfig;
      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigParseError(
          `Invalid JSON in configuration file: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Apply partial updates to configuration
   *
   * Performs deep merge while preserving arrays (replaces arrays instead of merging them).
   * This is the expected behavior for configuration updates - when updating a permission
   * list, you want to replace it entirely, not append to it.
   *
   * @param updates - Partial configuration updates
   * @returns Updated configuration object
   * @throws {ConfigValidationError} If merged config is invalid
   */
  public updateConfig(updates: Partial<SettingsConfig>): SettingsConfig {
    const current = this.readConfig();

    // Deep merge helper - replaces arrays instead of merging them
    // Using type assertion because SettingsConfig is structurally compatible with JsonObject
    type ConfigAsJson = JsonObject & SettingsConfig;

    const deepMergeObjects = (target: ConfigAsJson, source: Partial<ConfigAsJson>): ConfigAsJson => {
      const merged: ConfigAsJson = { ...target };

      for (const key of Object.keys(source)) {
        const sourceValue = source[key as keyof typeof source];
        const targetValue = merged[key as keyof typeof merged];

        // If source value is array, replace entirely (don't merge)
        if (Array.isArray(sourceValue)) {
          (merged as Record<string, JsonValue>)[key] = sourceValue;
        } else if (
          typeof sourceValue === "object" &&
          sourceValue !== null &&
          typeof targetValue === "object" &&
          targetValue !== null &&
          !Array.isArray(targetValue)
        ) {
          // Recursively merge nested objects
          (merged as Record<string, JsonValue>)[key] = deepMergeObjects(
            targetValue as ConfigAsJson,
            sourceValue as Partial<ConfigAsJson>
          );
        } else if (sourceValue !== undefined) {
          // For primitives, use source value
          (merged as Record<string, JsonValue>)[key] = sourceValue as JsonValue;
        }
      }

      return merged;
    };

    const updated = deepMergeObjects(current as ConfigAsJson, updates as Partial<ConfigAsJson>);

    // Validate merged result
    const validation = this.validateConfig(updated);
    if (!validation.valid) {
      const errorDetails = validation.errors
        ?.map(e => `${e.field}: ${e.message}`)
        .join(", ");
      throw new ConfigValidationError(
        `Updated configuration is invalid: ${errorDetails ?? "unknown error"}`
      );
    }

    return updated;
  }

  /**
   * Validate configuration against JSON schema
   *
   * Uses Ajv for comprehensive schema validation with detailed error reporting.
   * Errors include field paths and expected types for easy debugging.
   *
   * @param config - Configuration object to validate
   * @returns Validation result with detailed error messages
   */
  public validateConfig(config: JsonObject | SettingsConfig): ValidationResult {
    const validate = this.ajv.getSchema("settings");
    if (validate === undefined) {
      throw new TypeError("Schema not loaded");
    }

    const valid = validate(config);

    if (valid) {
      return { valid: true };
    }

    // Format validation errors with field paths
    const validationErrors = validate.errors ?? [];

    interface RequiredParams {
      missingProperty: string;
    }

    interface TypeParams {
      format?: string;
      type?: string;
    }

    const errors = validationErrors.map((err: AjvErrorObject): ValidationErrorDetail => {
      // Use dataPath for older Ajv versions, instancePath for newer
      let field = ("instancePath" in err ? String(err.instancePath) : "");
      if (field === "" || field === "/") {
        field = "root";
      }
      let message = err.message ?? "Validation failed";

      // Handle missing required properties
      if (err.keyword === "required" && "missingProperty" in err.params) {
        const params = err.params as RequiredParams;
        const basePath = (field === "" || field === "/") ? "" : `${field}.`;
        field = basePath + params.missingProperty;
      }

      // Add context about expected type/format
      const params = err.params as TypeParams;
      if (params.type !== undefined) {
        message = `${message} (expected ${params.type})`;
      }
      if (params.format !== undefined) {
        message = `${message} (expected format: ${params.format})`;
      }

      return {
        field: field.replace(/^\//, "").replaceAll("/", "."),
        message,
        value: undefined,
      };
    });

    return { errors, valid: false };
  }

  /**
   * Write configuration to disk atomically with backup
   *
   * Uses atomic write pattern:
   * 1. Acquire exclusive write lock
   * 2. Create backup of existing file
   * 3. Write to temporary file
   * 4. Rename temp file to actual file (atomic on POSIX systems)
   * 5. Release lock
   *
   * This ensures:
   * - Configuration is never left in a partially written state
   * - Previous version can be recovered from backup
   * - Concurrent writes are serialized
   *
   * @param config - Configuration object to write
   * @throws {ConfigValidationError} If config is invalid
   * @throws {ConfigWriteError} If write fails
   * @throws {ConfigLockError} If unable to acquire lock
   */
  public async writeConfig(config: SettingsConfig): Promise<void> {
    // Validate before writing
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      const errorDetails = validation.errors
        ?.map(e => `${e.field}: ${e.message}`)
        .join(", ");
      throw new ConfigValidationError(
        `Cannot write invalid configuration: ${errorDetails ?? "unknown error"}`
      );
    }

    let lockAcquired = false;
    const tempPath = `${this.configPath}.tmp`;
    const configDir = path.dirname(this.configPath);

    // Check write permissions early before acquiring lock
    try {
      fs.accessSync(configDir, fs.constants.W_OK);
    } catch (error) {
      if (error instanceof Error && (error.message.includes("EACCES") || error.message.includes("EPERM"))) {
        throw new ConfigWriteError(
          `Permission denied writing to ${this.configPath}. Check file permissions.`
        );
      }
    }

    try {
      // Acquire write lock
      await this._acquireLock();
      lockAcquired = true;

      // Create backup if file exists
      if (fs.existsSync(this.configPath)) {
        this._createBackup();
      }

      // Write to temporary file
      const JSON_INDENT_SPACES = 2;
      const content = JSON.stringify(config, undefined, JSON_INDENT_SPACES);
      fs.writeFileSync(tempPath, content, "utf8");

      // Atomic rename (on POSIX systems, this is atomic)
      fs.renameSync(tempPath, this.configPath);
    } catch (error) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      if (error instanceof ConfigLockError || error instanceof ConfigWriteError) {
        throw error; // Re-throw our custom errors
      }

      if (error instanceof Error) {
        if (error.message.includes("EACCES") || error.message.includes("EPERM")) {
          throw new ConfigWriteError(
            `Permission denied writing to ${this.configPath}. Check file permissions.`
          );
        }
        throw new ConfigWriteError(
          `Failed to write configuration: ${error.message}`
        );
      }
      throw error;
    } finally {
      // Always release lock if we acquired it
      if (lockAcquired) {
        this._releaseLock();
      }
    }
  }

  /**
   * Acquire write lock with timeout
   *
   * Uses lockfile package to prevent concurrent writes.
   * - Retries: 10 attempts with backoff (100-500ms)
   * - Total timeout: ~5 seconds
   * - Stale lock: 30 seconds (if previous process crashed)
   *
   * @throws {ConfigLockError} If unable to acquire lock
   */
  private async _acquireLock(): Promise<void> {
    // Simple file-based locking with retry logic
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 100;
    const STALE_LOCK_AGE_MS = 30_000; // 30 seconds

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        // Check for stale lock
        if (fs.existsSync(this.lockPath)) {
          const stats = fs.statSync(this.lockPath);
          const age = Date.now() - stats.mtimeMs;
          if (age > STALE_LOCK_AGE_MS) {
            // Remove stale lock
            try {
              fs.unlinkSync(this.lockPath);
            } catch {
              // Ignore errors removing stale lock
            }
          }
        }

        // Try to create lock file exclusively
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
        return; // Lock acquired successfully
      } catch {
        if (i < MAX_RETRIES - 1) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    const maxRetriesString = String(MAX_RETRIES);
    throw new ConfigLockError(
      `Unable to acquire configuration lock after ${maxRetriesString} retries. ` +
      "Another process may be writing to the configuration file."
    );
  }

  /**
   * Create backup of current configuration file
   *
   * Backup creation is best-effort - if it fails, we log a warning
   * but don't throw. This allows writes to proceed even if backup fails.
   */
  private _createBackup(): void {
    try {
      fs.copyFileSync(this.configPath, this.backupPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to create backup: ${message}`);
      // Don't throw - backup is best-effort
    }
  }

  /**
   * Release write lock
   */
  private _releaseLock(): void {
    try {
      // Simple lock release - just delete the lock file
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch (error) {
      // Log but don't throw - lock will expire via stale mechanism
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to release lock: ${message}`);
    }
  }
}
