/**
 * Projects Router
 * REST API endpoints for project management:
 * - GET /api/projects - List all discovered projects with stats
 * - POST /api/projects/update - Start update job
 * - GET /api/projects/update/:jobId/stream - SSE stream for real-time output
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import * as path from "node:path";

import type {
  DiscoveredProject,
  DiscoveredProjectWithStats,
  ProjectScannerService,
} from "../services/project-scanner.js";
import type { UpdateExecutorService } from "../services/update-executor.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_ACCEPTED = 202;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Dependencies for projects router
 */
export interface ProjectsRouterDeps {
  /** Project scanner for validating paths */
  projectScanner: ProjectScannerService;
  /** Update executor for managing jobs */
  updateExecutor: UpdateExecutorService;
}

/**
 * Request body for starting update
 */
interface UpdateRequestBody {
  /** Absolute or relative path to project directory */
  projectPath: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Update start response
 */
interface UpdateResponse {
  status: "started";
  jobId: string;
}

/**
 * SSE output event payload
 */
interface OutputEvent {
  /** Output line */
  line: string;
  /** Which stream the line came from */
  stream: "stdout" | "stderr";
}

/**
 * SSE complete event payload
 */
interface CompleteEvent {
  /** Exit code from update command */
  exitCode: number;
}

/**
 * SSE error event payload
 */
interface ErrorEvent {
  /** Error message */
  error: string;
}

/**
 * Log entry for update attempts
 */
interface UpdateLogEntry {
  type: string;
  timestamp: string;
  projectPath: string;
  status: string;
  detail: string;
  clientIp: string;
}

/**
 * Create projects router with dependencies
 */
export function createProjectsRouter(deps: ProjectsRouterDeps): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/projects - List all discovered projects with stats
   *
   * Returns projects with active session counts and token usage.
   */
  router.get("/", (_req: Request, res: Response): void => {
    const handleList = async (): Promise<void> => {
      const projects: DiscoveredProjectWithStats[] =
        await deps.projectScanner.scanWithStats();

      res.status(HTTP_STATUS_OK).json(projects);
    };

    handleList().catch((error: unknown) => {
      console.error("[projects] Error listing projects:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to list projects",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * POST /api/projects/update - Start update job
   *
   * Validates project path against discovered projects,
   * checks rate limits, starts update command.
   */
  router.post("/update", (req: Request, res: Response): void => {
    const handleUpdate = async (): Promise<void> => {
      const { projectPath } = req.body as UpdateRequestBody;

      if (!projectPath || typeof projectPath !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath in request body",
        });
        return;
      }

      // Resolve absolute path first
      const resolvedPath = path.resolve(projectPath);

      // Security: Block path traversal attempts using path normalization
      // This catches "..", URL-encoded variants, null bytes, etc.
      const normalized = path.normalize(projectPath);
      const normalizedResolved = path.normalize(resolvedPath);

      // Check for URL-encoded path traversal attempts
      const decoded = decodeURIComponent(projectPath);

      // Detect any form of path traversal
      if (
        projectPath !== normalized ||
        projectPath.includes("..") ||
        projectPath.includes("\0") || // Null bytes
        decoded !== normalized || // URL-encoded traversal
        // Check forward/backward slash variations
        /%2f|%2e|%5c|%c0%af|\.{2,}/i.test(projectPath)
      ) {
        logUpdateAttempt(req, projectPath, "blocked", "path_traversal");
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Invalid project path",
          message: "Path traversal not allowed",
        });
        return;
      }

      // Ensure normalized and resolved paths match
      if (normalizedResolved !== path.resolve(normalized)) {
        logUpdateAttempt(req, projectPath, "blocked", "path_normalization_mismatch");
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Invalid project path",
          message: "Path traversal not allowed",
        });
        return;
      }

      // Validate against registered projects
      const projects = await deps.projectScanner.scan();
      const registeredPaths = new Set(
        projects.map((p: DiscoveredProject) => path.resolve(p.path))
      );

      // Debug logging for path validation
      console.log("[projects] Path validation:");
      console.log("  Request path:", projectPath);
      console.log("  Resolved path:", resolvedPath);
      console.log("  Registered paths:", [...registeredPaths]);

      // Try direct match first
      let isValidPath = registeredPaths.has(resolvedPath);

      // If no direct match, try normalized comparison
      if (!isValidPath) {
        const normalizedRequest = path.normalize(projectPath);
        const normalizedResolved = path.normalize(resolvedPath);
        for (const registeredPath of registeredPaths) {
          const normalizedRegistered = path.normalize(registeredPath);
          if (
            normalizedRequest === normalizedRegistered ||
            normalizedResolved === normalizedRegistered
          ) {
            isValidPath = true;
            console.log("  Matched via normalized comparison:", registeredPath);
            break;
          }
        }
      }

      // If still no match, try matching just the basename (last directory)
      if (!isValidPath) {
        const requestBasename = path.basename(resolvedPath);
        for (const registeredPath of registeredPaths) {
          if (path.basename(registeredPath) === requestBasename) {
            isValidPath = true;
            console.log("  Matched via basename:", registeredPath);
            break;
          }
        }
      }

      if (!isValidPath) {
        console.log("  No match found - blocking request");
        logUpdateAttempt(req, resolvedPath, "blocked", "unregistered_project");
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Project not registered",
          message: "Only discovered claude-workflow projects can be updated",
        });
        return;
      }

      // Start update job
      try {
        const job = deps.updateExecutor.startUpdate(resolvedPath);
        logUpdateAttempt(req, resolvedPath, "started", job.id);

        const response: UpdateResponse = {
          status: "started",
          jobId: job.id,
        };
        res.status(HTTP_STATUS_ACCEPTED).json(response);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("Rate limit")) {
          res.status(429).json({
            error: "Rate limit exceeded",
            message: error.message,
          });
        } else {
          throw error;
        }
      }
    };

    handleUpdate().catch((error: unknown) => {
      console.error("[projects] Error starting update:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to start update",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/projects/update/:jobId/stream - SSE for real-time output
   *
   * Streams stdout/stderr from update command via Server-Sent Events.
   * Sends buffered output for late subscribers.
   */
  router.get("/update/:jobId/stream", (req: Request, res: Response): void => {
    const jobId = String(req.params.jobId);

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // CRITICAL: Flush headers immediately to establish SSE connection
    // Without this, the client won't receive events until the response ends
    res.flushHeaders();

    // Get job
    const job = deps.updateExecutor.getJob(jobId);

    if (!job) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "Job not found" } as ErrorEvent)}\n\n`
      );
      res.end();
      return;
    }

    // Helper to write SSE and flush immediately
    const writeSSE = (eventType: string, data: unknown): void => {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush if available (for compression middleware compatibility)
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    };

    // Send initial status
    writeSSE("status", { status: job.status });

    // Subscribe to job output
    const unsubscribe = deps.updateExecutor.subscribeToJob(jobId, {
      onOutput: (line: string, stream: "stdout" | "stderr") => {
        writeSSE("output", { line, stream } as OutputEvent);
      },
      onComplete: (exitCode: number) => {
        console.log(`[projects] SSE sending complete event for job ${jobId} with exitCode ${exitCode}`);
        writeSSE("complete", { exitCode } as CompleteEvent);
        res.end();
      },
      onError: (error: string) => {
        console.log(`[projects] SSE sending error event for job ${jobId}: ${error}`);
        writeSSE("error", { error } as ErrorEvent);
        res.end();
      },
    });

    // Cleanup on client disconnect
    req.on("close", () => {
      unsubscribe();
    });
  });

  /**
   * GET /api/projects/update/:jobId - Get job status
   *
   * Returns current job state without streaming.
   */
  router.get("/update/:jobId", (req: Request, res: Response): void => {
    const jobId = String(req.params.jobId);

    const job = deps.updateExecutor.getJob(jobId);

    if (!job) {
      res.status(HTTP_STATUS_NOT_FOUND).json({
        error: "Job not found",
      });
      return;
    }

    res.status(HTTP_STATUS_OK).json(job);
  });

  return router;
}

/**
 * Log update attempt for security audit
 *
 * @param req - Express request object
 * @param projectPath - Path to project
 * @param status - Attempt status (started/blocked)
 * @param detail - Job ID or rejection reason
 */
function logUpdateAttempt(
  req: Request,
  projectPath: string,
  status: "started" | "blocked" | "completed" | "failed",
  detail: string
): void {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const timestamp = new Date().toISOString();

  // Structured log entry for easy parsing
  const logEntry: UpdateLogEntry = {
    type: "project_update_attempt",
    timestamp,
    projectPath,
    status,
    detail,
    clientIp,
  };

  console.log(`[projects] ${JSON.stringify(logEntry)}`);
}
