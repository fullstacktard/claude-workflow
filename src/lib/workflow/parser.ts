/**
 * Workflow configuration parser for YAML and JSON files
 * @module workflow/parser
 */

import yaml from "js-yaml";
import * as fs from "node:fs";
import * as path from "node:path";

import type { WorkflowConfig } from "./types.js";

import { ERROR_CATEGORIES, ERROR_CODES, OrchestrationError } from "../errors/orchestration-error.js";

/**
 * Intermediate type for parsed configuration before validation
 */
interface ParsedConfig {
  [key: string]: boolean | null | number | object | string | undefined;
  name?: string;
}

/**
 * YAML exception with mark information for error reporting
 */
interface YAMLExceptionWithMark {
  mark?: {
    column: number;
    line: number;
  };
  message: string;
}

/**
 * Load multiple workflow configs from a directory
 *
 * @param dirPath - Directory containing workflow config files
 * @returns Map of workflow name to config
 *
 * @example
 * ```typescript
 * const configs = loadWorkflowDirectory('/path/to/workflows');
 * console.log(configs.size); // 3
 * console.log(configs.get('feature-development')); // WorkflowConfig
 * ```
 */
export function loadWorkflowDirectory(dirPath: string): Map<string, WorkflowConfig> {
  const configs = new Map<string, WorkflowConfig>();

  if (!fs.existsSync(dirPath)) {
    return configs;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".yml" && ext !== ".yaml" && ext !== ".json") {
      continue;
    }

    const filePath = path.join(dirPath, file);
    try {
      const config = parseWorkflowConfig(filePath);
      configs.set(config.name, config);
    } catch (error) {
      // Log warning but continue loading other configs
      console.warn(`Failed to load workflow config ${file}:`, (error as Error).message);
    }
  }

  return configs;
}

/**
 * Parse workflow configuration from YAML or JSON file
 *
 * @param filePath - Absolute path to config file
 * @returns Parsed workflow configuration
 * @throws OrchestrationError on parse failure or missing file
 *
 * @example
 * ```typescript
 * const config = parseWorkflowConfig('/path/to/workflow.yml');
 * console.log(config.name); // 'feature-development'
 * ```
 */
export function parseWorkflowConfig(filePath: string): WorkflowConfig {
  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new OrchestrationError("Workflow config file not found", {
      category: ERROR_CATEGORIES.IO,
      code: ERROR_CODES.FILE_NOT_FOUND,
      context: { filePath },
      operation: "parseWorkflowConfig"
    });
  }

  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");

  try {
    let config: ParsedConfig;

    if (ext === ".yml" || ext === ".yaml") {
      // Parse YAML with safe schema and filename for error reporting
      // Extract schema to avoid inline reference triggering unsafe assignment
      const yamlSchema = yaml.JSON_SCHEMA;

      // Parse YAML - returns unknown type which we validate before using
      const rawYaml = yaml.load(content, {
        filename: filePath,
        schema: yamlSchema
      });

      // Validate the parsed result is a non-null object (not array)
      if (rawYaml === null || typeof rawYaml !== "object" || Array.isArray(rawYaml)) {
        const configType = rawYaml === null ? "null" : (Array.isArray(rawYaml) ? "array" : typeof rawYaml);
        throw new OrchestrationError("Config must be an object", {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.INVALID_JSON_SCHEMA,
          context: { filePath, type: configType },
          operation: "parseWorkflowConfig"
        });
      }

      // Type assertion after validation
      config = rawYaml as ParsedConfig;
    } else if (ext === ".json") {
      // Parse JSON - use type assertion to handle 'any' return type
       
      const jsonResult = JSON.parse(content);

      // Validate the parsed result is a non-null object (not array)
       
      if (jsonResult === null || typeof jsonResult !== "object" || Array.isArray(jsonResult)) {
         
        const configType = jsonResult === null ? "null" : (Array.isArray(jsonResult) ? "array" : typeof jsonResult);
        throw new OrchestrationError("Config must be an object", {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.INVALID_JSON_SCHEMA,
          context: { filePath, type: configType },
          operation: "parseWorkflowConfig"
        });
      }

      // Type assertion after validation
       
      config = jsonResult as ParsedConfig;
    } else {
      throw new OrchestrationError("Unsupported config file format", {
        category: ERROR_CATEGORIES.PARSING,
        code: ERROR_CODES.INVALID_CLI_ARGS,
        context: { extension: ext, filePath },
        operation: "parseWorkflowConfig"
      });
    }

     
    return config as unknown as WorkflowConfig;

  } catch (error) {
    // Handle YAML parse errors with line numbers
    if (error instanceof yaml.YAMLException) {
      const parseError = error as YAMLExceptionWithMark;
      const errorMessage = parseError.message;

      // Extract line and column numbers from mark if available
      const columnNumber = parseError.mark?.column === undefined ? undefined : parseError.mark.column + 1;
      const lineNumber = parseError.mark?.line === undefined ? undefined : parseError.mark.line + 1;

      throw new OrchestrationError(`YAML syntax error: ${errorMessage}`, {
        category: ERROR_CATEGORIES.PARSING,
        cause: error as Error,
        code: ERROR_CODES.JSON_PARSE_ERROR,
        context: {
          column: columnNumber,
          filePath,
          line: lineNumber
        },
        operation: "parseWorkflowConfig"
      });
    }

    // Handle JSON parse errors
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      throw new OrchestrationError(`JSON syntax error: ${error.message}`, {
        category: ERROR_CATEGORIES.PARSING,
        cause: error as Error,
        code: ERROR_CODES.JSON_PARSE_ERROR,
        context: { filePath },
        operation: "parseWorkflowConfig"
      });
    }

    // Re-throw OrchestrationErrors
    if (error instanceof OrchestrationError) {
      throw error;
    }

    // Wrap unknown errors
    throw OrchestrationError.fromError(error as Error, {
      category: ERROR_CATEGORIES.PARSING,
      code: ERROR_CODES.UNKNOWN_ERROR,
      context: { filePath },
      operation: "parseWorkflowConfig"
    });
  }
}
