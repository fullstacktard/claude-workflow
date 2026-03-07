/**
 * Validate Router
 * REST API endpoint for workflow validation
 *
 * Provides schema validation, cycle detection, and partial validation
 * for real-time feedback during workflow editing.
 *
 * @module routes/validate
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type { ValidationResult } from "../services/workflow-validator.js";
import { WorkflowValidator } from "../services/workflow-validator.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Validation request body
 */
export interface ValidateRequest {
  /** Workflow data to validate (parsed YAML as object) */
  workflow: unknown;
  /** Whether to use partial validation (for real-time feedback) */
  partial?: boolean;
}

/**
 * Validation response
 */
export interface ValidateResponse extends ValidationResult {
  /** Request processing timestamp */
  timestamp: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Create validation router
 *
 * @returns Express router with validation endpoints
 *
 * @example
 * ```typescript
 * // In server.ts
 * import { createValidateRouter } from "./routes/validate.js";
 * app.use("/api/workflows", createValidateRouter());
 * ```
 */
export function createValidateRouter(): Router {
   
  const router: Router = express.Router() as Router;

  // Create validator instance (schema compiled once, reused for all requests)
  const validator = new WorkflowValidator();

  /**
   * POST /api/workflows/validate - Validate workflow data
   *
   * Validates workflow data against the workflow.schema.json and
   * performs cycle detection for phase dependencies.
   *
   * @example Request body:
   * ```json
   * {
   *   "workflow": {
   *     "name": "my-workflow",
   *     "description": "My workflow",
   *     "phases": [...]
   *   },
   *   "partial": false
   * }
   * ```
   *
   * @example Response (valid):
   * ```json
   * {
   *   "valid": true,
   *   "errors": [],
   *   "warnings": [],
   *   "validationTimeMs": 12.5,
   *   "timestamp": "2026-02-02T10:30:00.000Z"
   * }
   * ```
   *
   * @example Response (invalid):
   * ```json
   * {
   *   "valid": false,
   *   "errors": [
   *     {
   *       "field": "phases[2].agent",
   *       "message": "Missing required field: phases[2].agent",
   *       "severity": "error",
   *       "keyword": "required"
   *     }
   *   ],
   *   "warnings": [],
   *   "validationTimeMs": 8.2,
   *   "timestamp": "2026-02-02T10:30:00.000Z"
   * }
   * ```
   */
  router.post("/validate", (req: Request, res: Response): void => {
    try {
      const body = req.body as ValidateRequest;

      // Validate request body
      if (body.workflow === undefined || body.workflow === null) {
        const errorResponse: ErrorResponse = {
          error: "Missing workflow data",
          message: "Request body must include 'workflow' field",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      // Run validation (full or partial based on request)
      const result = body.partial === true
        ? validator.validatePartial(body.workflow)
        : validator.validate(body.workflow);

      // Add timestamp to response
      const response: ValidateResponse = {
        ...result,
        timestamp: new Date().toISOString(),
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[validate] Validation error:", error);
      const errorResponse: ErrorResponse = {
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}
