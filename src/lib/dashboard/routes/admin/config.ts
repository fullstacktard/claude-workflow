/**
 * Admin Config Router
 * REST API endpoints for reading, updating, validating, and diffing
 * the product configuration file (config/product-config.json).
 *
 * Endpoints:
 * - GET  /           - Read current product-config.json
 * - PUT  /           - Update config (validate, version, atomic write)
 * - GET  /diff       - Diff current vs last-deployed config
 * - POST /validate   - Validate config payload without saving
 *
 * @module routes/admin/config
 */

import type { Request, Response, Router } from "express-serve-static-core";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import express from "express";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// HTTP status codes (following project convention - each route file has its own)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Config file paths (relative to project root)
const CONFIG_DIR = "config";
const CONFIG_FILE = "product-config.json";
const CONFIG_SCHEMA_FILE = "product-config.schema.json";
const CONFIG_DEPLOYED_FILE = "product-config.deployed.json";
const CONFIG_TMP_FILE = "product-config.tmp.json";

// ───────────────────────────── Types ──────────────────────────────

/**
 * Dependencies for the admin config router
 */
export interface AdminConfigRouterDeps {
  /** Absolute path to the project root directory */
  projectRoot: string;
}

/**
 * Response for successful config read
 */
export interface ConfigReadResponse {
  /** The full product config object */
  config: Record<string, unknown>;
  /** Server timestamp when the response was generated */
  timestamp: string;
}

/**
 * Request body for updating config
 */
export interface ConfigUpdateRequest {
  /** The full config object to save */
  config: Record<string, unknown>;
  /** Optional human-readable description of the change */
  description?: string;
}

/**
 * Response for successful config update
 */
export interface ConfigUpdateResponse {
  /** The updated config object (with new version metadata) */
  config: Record<string, unknown>;
  /** The config version before the update */
  previousVersion: number;
  /** The config version after the update */
  newVersion: number;
  /** Server timestamp when the update was applied */
  timestamp: string;
}

/**
 * A single diff entry representing a changed, added, or removed field
 */
export interface DiffEntry {
  /** Dot-notation path to the field (e.g. "tiers.pro.pricing.price") */
  path: string;
  /** Type of change */
  type: "changed" | "added" | "removed";
  /** Current value (present for "changed" and "added") */
  currentValue?: unknown;
  /** Last-deployed value (present for "changed" and "removed") */
  deployedValue?: unknown;
}

/**
 * Response for config diff
 */
export interface ConfigDiffResponse {
  /** Whether any differences were found */
  hasDiff: boolean;
  /** Current config version number */
  currentVersion: number;
  /** Last-deployed config version number (null if never deployed) */
  deployedVersion: number | null;
  /** Individual field-level diff entries */
  entries: DiffEntry[];
  /** Human-readable message (e.g. when no deployed snapshot exists) */
  message?: string;
  /** Server timestamp when the diff was computed */
  timestamp: string;
}

/**
 * Response for config validation
 */
export interface ConfigValidationResponse {
  /** Whether the config is valid */
  valid: boolean;
  /** Validation error details (empty array when valid) */
  errors: Array<{
    /** JSON Pointer path to the invalid field */
    path: string;
    /** Human-readable error message */
    message: string;
    /** JSON Schema validation keyword that failed */
    keyword: string;
    /** Additional error context from the schema validator */
    params?: Record<string, unknown>;
  }>;
  /** Server timestamp when validation was performed */
  timestamp: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}

// ───────────────────────────── Helpers ──────────────────────────────

/**
 * Resolve a config file path relative to project root
 */
function resolveConfigPath(projectRoot: string, filename: string): string {
  return path.join(projectRoot, CONFIG_DIR, filename);
}

/**
 * Read and parse a JSON file, returning null if it does not exist
 */
function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Recursively compute diff entries between two objects.
 *
 * Compares objects key-by-key. For nested objects, recurses with a dot-notation
 * path prefix. Arrays and primitives are compared by JSON serialization.
 *
 * @param current  - The current (working) config object
 * @param deployed - The last-deployed config object
 * @param prefix   - Dot-notation prefix for nested paths (internal use)
 * @returns Array of diff entries describing individual field changes
 */
function computeDiff(
  current: Record<string, unknown>,
  deployed: Record<string, unknown>,
  prefix: string = "",
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const allKeys = new Set([
    ...Object.keys(current),
    ...Object.keys(deployed),
  ]);

  for (const key of allKeys) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    const currentVal = current[key];
    const deployedVal = deployed[key];

    if (!(key in deployed)) {
      entries.push({
        path: currentPath,
        type: "added",
        currentValue: currentVal,
      });
    } else if (!(key in current)) {
      entries.push({
        path: currentPath,
        type: "removed",
        deployedValue: deployedVal,
      });
    } else if (
      typeof currentVal === "object" &&
      currentVal !== null &&
      typeof deployedVal === "object" &&
      deployedVal !== null &&
      !Array.isArray(currentVal) &&
      !Array.isArray(deployedVal)
    ) {
      // Recurse into nested objects
      entries.push(
        ...computeDiff(
          currentVal as Record<string, unknown>,
          deployedVal as Record<string, unknown>,
          currentPath,
        ),
      );
    } else if (JSON.stringify(currentVal) !== JSON.stringify(deployedVal)) {
      entries.push({
        path: currentPath,
        type: "changed",
        currentValue: currentVal,
        deployedValue: deployedVal,
      });
    }
  }

  return entries;
}

// ───────────────────────────── Router ──────────────────────────────

/**
 * Create admin config router
 *
 * Provides CRUD endpoints for the product configuration file with
 * JSON Schema validation, atomic writes, and config diffing.
 *
 * The Ajv schema is compiled once at router creation time and reused
 * for all subsequent validation requests, matching the pattern used by
 * WorkflowValidator in the codebase.
 *
 * @param deps - Router dependencies including project root path
 * @returns Express router with admin config endpoints
 *
 * @example
 * ```typescript
 * // In admin/index.ts
 * import { createAdminConfigRouter } from "./config.js";
 * router.use("/config", createAdminConfigRouter({ projectRoot: process.cwd() }));
 * ```
 */
export function createAdminConfigRouter(deps: AdminConfigRouterDeps): Router {
  const router: Router = express.Router() as Router;
  const { projectRoot } = deps;

  // Initialize Ajv with schema compiled once (reused for all requests)
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);

  // Load and compile schema at router creation time
  const schemaPath = resolveConfigPath(projectRoot, CONFIG_SCHEMA_FILE);
  let validateConfig: ReturnType<typeof ajv.compile> | null = null;

  if (existsSync(schemaPath)) {
    const schema = JSON.parse(
      readFileSync(schemaPath, "utf-8"),
    ) as Record<string, unknown>;
    validateConfig = ajv.compile(schema);
  } else {
    console.warn(
      `[admin-config] Schema not found at ${schemaPath}. Validation will be unavailable.`,
    );
  }

  // ───────────── GET / ─────────────

  /**
   * GET / - Read current product config
   *
   * Returns the current product-config.json contents.
   * Returns 404 if the config file does not exist yet.
   */
  router.get("/", (_req: Request, res: Response): void => {
    try {
      const configPath = resolveConfigPath(projectRoot, CONFIG_FILE);
      const config = readJsonFile(configPath);

      if (config === null) {
        const errorResponse: ErrorResponse = {
          error: "Config not found",
          message: `${CONFIG_FILE} does not exist at ${configPath}`,
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      const response: ConfigReadResponse = {
        config,
        timestamp: new Date().toISOString(),
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[admin-config] Error reading config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // ───────────── PUT / ─────────────

  /**
   * PUT / - Update product config with validation and atomic write
   *
   * Validates the config against the JSON Schema, auto-increments
   * configVersion and configTimestamp, and performs an atomic write
   * (write to .tmp file, then rename).
   *
   * Request body: { config: {...}, description?: "..." }
   *
   * Returns 400 if validation fails with detailed error messages.
   * Returns 200 with the updated config on success.
   */
  router.put("/", (req: Request, res: Response): void => {
    try {
      const body = req.body as ConfigUpdateRequest;

      if (!body.config || typeof body.config !== "object") {
        const errorResponse: ErrorResponse = {
          error: "Invalid request",
          message: "Request body must include a 'config' object",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      // Read current config for version tracking
      const configPath = resolveConfigPath(projectRoot, CONFIG_FILE);
      const currentConfig = readJsonFile(configPath);
      const previousVersion =
        typeof currentConfig?.configVersion === "number"
          ? currentConfig.configVersion
          : 0;
      const newVersion = previousVersion + 1;

      // Apply version metadata before validation so the validated object
      // includes the correct version fields that the schema requires
      const updatedConfig: Record<string, unknown> = {
        ...body.config,
        configVersion: newVersion,
        configTimestamp: new Date().toISOString(),
        configAuthor: "admin-api",
        configDescription:
          body.description ?? `Config update v${String(newVersion)}`,
      };

      // Validate against JSON Schema if schema is loaded
      if (validateConfig !== null) {
        const isValid = validateConfig(updatedConfig);
        if (!isValid) {
          const errorResponse: ErrorResponse = {
            error: "Config validation failed",
            message: "Config does not match product-config.schema.json",
            details: validateConfig.errors?.map((err) => ({
              path: err.instancePath || "/",
              message: err.message ?? "Unknown validation error",
              keyword: err.keyword,
              params: err.params,
            })),
          };
          res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
          return;
        }
      }

      // Ensure config directory exists
      const configDir = path.join(projectRoot, CONFIG_DIR);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // Atomic write: write to temp file, then rename
      // renameSync is atomic on POSIX systems (same filesystem),
      // preventing partial writes from corrupting the config file
      const tmpPath = resolveConfigPath(projectRoot, CONFIG_TMP_FILE);
      const serialized = JSON.stringify(updatedConfig, null, 2) + "\n";
      writeFileSync(tmpPath, serialized, "utf-8");
      renameSync(tmpPath, configPath);

      const response: ConfigUpdateResponse = {
        config: updatedConfig,
        previousVersion,
        newVersion,
        timestamp: new Date().toISOString(),
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[admin-config] Error updating config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // ───────────── GET /diff ─────────────

  /**
   * GET /diff - Diff current config vs last-deployed config
   *
   * Compares the current product-config.json against the
   * product-config.deployed.json snapshot. Returns structured
   * diff entries showing what changed, was added, or removed.
   *
   * If no deployed snapshot exists, returns empty diff with a message
   * indicating the config has never been deployed.
   */
  router.get("/diff", (_req: Request, res: Response): void => {
    try {
      const configPath = resolveConfigPath(projectRoot, CONFIG_FILE);
      const deployedPath = resolveConfigPath(projectRoot, CONFIG_DEPLOYED_FILE);

      const currentConfig = readJsonFile(configPath);

      if (currentConfig === null) {
        const errorResponse: ErrorResponse = {
          error: "Config not found",
          message: "No current config exists to diff",
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      const deployedConfig = readJsonFile(deployedPath);

      if (deployedConfig === null) {
        const currentVersion =
          typeof currentConfig.configVersion === "number"
            ? currentConfig.configVersion
            : 0;

        const response: ConfigDiffResponse = {
          hasDiff: true,
          currentVersion,
          deployedVersion: null,
          entries: [],
          message:
            "No deployed snapshot found. All current config is new (never deployed).",
          timestamp: new Date().toISOString(),
        };
        res.status(HTTP_STATUS_OK).json(response);
        return;
      }

      const entries = computeDiff(currentConfig, deployedConfig);

      const currentVersion =
        typeof currentConfig.configVersion === "number"
          ? currentConfig.configVersion
          : 0;
      const deployedVersion =
        typeof deployedConfig.configVersion === "number"
          ? deployedConfig.configVersion
          : 0;

      const response: ConfigDiffResponse = {
        hasDiff: entries.length > 0,
        currentVersion,
        deployedVersion,
        entries,
        timestamp: new Date().toISOString(),
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[admin-config] Error computing diff:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to compute diff",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // ───────────── POST /validate ─────────────

  /**
   * POST /validate - Validate config without saving
   *
   * Accepts a config payload, validates it against the JSON Schema,
   * and returns the validation result. Does not modify any files.
   * Useful for real-time form validation in the admin UI.
   */
  router.post("/validate", (req: Request, res: Response): void => {
    try {
      const body = req.body as { config: unknown };

      if (!body.config || typeof body.config !== "object") {
        const errorResponse: ErrorResponse = {
          error: "Invalid request",
          message: "Request body must include a 'config' object",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      if (validateConfig === null) {
        const errorResponse: ErrorResponse = {
          error: "Schema not loaded",
          message: `${CONFIG_SCHEMA_FILE} not found. Cannot validate without schema.`,
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
        return;
      }

      const isValid = validateConfig(body.config);
      const response: ConfigValidationResponse = {
        valid: isValid,
        errors: isValid
          ? []
          : (validateConfig.errors ?? []).map((err) => ({
            path: err.instancePath || "/",
            message: err.message ?? "Unknown validation error",
            keyword: err.keyword,
            params: err.params as Record<string, unknown> | undefined,
          })),
        timestamp: new Date().toISOString(),
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[admin-config] Validation error:", error);
      const errorResponse: ErrorResponse = {
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}
