/**
 * Dry Run Router
 * REST API endpoint for workflow dry run execution
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";
import {
  DryRunEngine,
  type DryRunResult,
  type SimulationMode,
} from "../services/workflow-dry-run.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Dry run request body
 */
interface DryRunRequest {
	/** Workflow name to simulate */
	workflowName: string;
	/** Simulation mode for agent outcomes */
	simulationMode?: SimulationMode;
	/** Maximum steps to prevent infinite loops */
	maxSteps?: number;
}

/**
 * Dry run response (extends DryRunResult with timestamp)
 */
interface DryRunResponse extends DryRunResult {
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
 * Workflow list response
 */
interface WorkflowListResponse {
	workflows: string[];
}

/**
 * Create dry-run router
 */
export function createDryRunRouter(): Router {
  const router: Router = express.Router() as Router;
  const engine = new DryRunEngine();

  /**
	 * POST /api/workflows/dry-run - Execute dry run simulation
	 *
	 * Request body:
	 * {
	 *   "workflowName": "project-setup",
	 *   "simulationMode": "happy_path",  // optional, default: "happy_path"
	 *   "maxSteps": 50                   // optional, default: 50
	 * }
	 *
	 * Response:
	 * {
	 *   "success": true,
	 *   "workflowName": "project-setup",
	 *   "executionPath": [...],
	 *   "errors": [],
	 *   "warnings": [],
	 *   "executionTimeMs": 12.5,
	 *   "simulationMode": "happy_path",
	 *   "timestamp": "2026-02-02T10:30:00.000Z"
	 * }
	 */
  router.post("/", (req: Request, res: Response): void => {
    try {
      const body = req.body as DryRunRequest;

      // Validate request body
      if (!body.workflowName) {
        const errorResponse: ErrorResponse = {
          error: "Missing workflow name",
          message: "Request body must include 'workflowName' field",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      // Validate simulation mode if provided
      const validModes: SimulationMode[] = [
        "happy_path",
        "all_fail",
        "partial_success",
        "alternating",
      ];
      const simulationMode = body.simulationMode ?? "happy_path";

      if (!validModes.includes(simulationMode)) {
        const errorResponse: ErrorResponse = {
          error: "Invalid simulation mode",
          message: `Simulation mode must be one of: ${validModes.join(", ")}`,
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      // Execute dry run
      const result = engine.execute(
        body.workflowName,
        simulationMode,
        body.maxSteps
      );

      // Check if workflow was not found
      if (
        !result.success &&
				result.errors.some((e) => e.includes("Workflow not found"))
      ) {
        const errorResponse: ErrorResponse = {
          error: "Workflow not found",
          message: `Workflow "${body.workflowName}" does not exist`,
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      // Add timestamp to response
      const response: DryRunResponse = {
        ...result,
        timestamp: new Date().toISOString(),
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[dry-run] Execution error:", error);
      const errorResponse: ErrorResponse = {
        error: "Dry run execution failed",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
	 * GET /api/workflows/dry-run/list - List available workflows
	 *
	 * Response:
	 * {
	 *   "workflows": ["project-setup", "feature-development", ...]
	 * }
	 */
  router.get("/list", (_req: Request, res: Response): void => {
    try {
      const workflows = engine.listWorkflows();
      const response: WorkflowListResponse = {
        workflows,
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[dry-run] List workflows error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to list workflows",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}

export type { DryRunRequest, DryRunResponse };
