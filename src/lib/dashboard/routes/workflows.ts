/**
 * Workflows Router
 * REST API endpoints for workflow storage management
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";
import * as os from "node:os";
import * as path from "node:path";
import type {
  WorkflowStorageService,
  WorkflowContent,
  WorkflowTier,
} from "../services/workflow-storage.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_CREATED = 201;
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Error response structure
 */
interface ErrorResponse {
	error: string;
	message?: string;
}

/**
 * Request body for create/update operations
 */
interface WorkflowRequestBody {
	content: WorkflowContent;
	projectPath?: string; // Required if tier is 'project'
}

/**
 * Query parameters for list endpoint
 */
interface WorkflowListQuery {
	projectPath?: string;
}

/**
 * Router dependencies
 */
export interface WorkflowsRouterDeps {
	workflowStorage: WorkflowStorageService;
}

/**
 * Create workflows router with dependencies
 */
export function createWorkflowsRouter(deps: WorkflowsRouterDeps): Router {
  const router: Router = express.Router() as Router;

  /**
	 * GET /api/workflows - List all workflows from all tiers
	 * Query params: ?projectPath=/path/to/project (optional - includes project tier if provided)
	 */
  router.get("/", (req: Request, res: Response): void => {
    const handleList = async (): Promise<void> => {
      const query = req.query as WorkflowListQuery;
      const workflows = await deps.workflowStorage.listWorkflows(
        query.projectPath
      );

      res.status(HTTP_STATUS_OK).json(workflows);
    };

    handleList().catch((error: unknown) => {
      console.error("[workflows] Error listing workflows:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to list workflows",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
	 * GET /api/workflows/:tier/:name - Read specific workflow
	 * Params: tier = built-in | global | project, name = workflow name (no extension)
	 * Query params: ?projectPath=/path/to/project (required if tier is 'project')
	 */
  router.get("/:tier/:name", (req: Request, res: Response): void => {
    const handleRead = async (): Promise<void> => {
      const tier = String(req.params.tier) as WorkflowTier;
      const name = String(req.params.name);
      const projectPath = req.query.projectPath as string | undefined;

      // Validate tier
      if (!["built-in", "global", "project"].includes(tier)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid tier",
          message: "Tier must be 'built-in', 'global', or 'project'",
        });
        return;
      }

      // Validate projectPath for project tier
      if (tier === "project" && !projectPath) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath",
          message: "projectPath query parameter required for project tier",
        });
        return;
      }

      try {
        const content = await deps.workflowStorage.readWorkflow(
          tier,
          name,
          projectPath
        );
        res.status(HTTP_STATUS_OK).json(content);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          res.status(HTTP_STATUS_NOT_FOUND).json({
            error: "Workflow not found",
            message: error.message,
          });
        } else {
          throw error;
        }
      }
    };

    handleRead().catch((error: unknown) => {
      console.error("[workflows] Error reading workflow:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read workflow",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
	 * POST /api/workflows/:tier/:name - Create new workflow
	 * Body: { content: WorkflowContent, projectPath?: string }
	 */
  router.post("/:tier/:name", (req: Request, res: Response): void => {
    const handleCreate = async (): Promise<void> => {
      const tier = String(req.params.tier) as WorkflowTier;
      const name = String(req.params.name);
      const body = req.body as WorkflowRequestBody;

      // Validate tier
      if (!["global", "project"].includes(tier)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid tier for create",
          message: "Can only create workflows in 'global' or 'project' tier",
        });
        return;
      }

      // Reject built-in tier creates
      if (tier === "built-in") {
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Built-in tier is read-only",
          message: "Cannot create workflows in built-in tier",
        });
        return;
      }

      // Validate request body
      if (!body.content) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing content",
          message: "Request body must include 'content' field",
        });
        return;
      }

      // Validate projectPath for project tier
      if (tier === "project" && !body.projectPath) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath",
          message: "projectPath required in body for project tier",
        });
        return;
      }

      try {
        await deps.workflowStorage.createWorkflow(
          tier,
          name,
          body.content,
          body.projectPath
        );
        res.status(HTTP_STATUS_CREATED).json({
          success: true,
          tier,
          name,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("already exists")) {
            res.status(HTTP_STATUS_BAD_REQUEST).json({
              error: "Workflow already exists",
              message: error.message,
            });
            return;
          }
          if (error.message.includes("read-only")) {
            res.status(HTTP_STATUS_FORBIDDEN).json({
              error: "Cannot create in read-only tier",
              message: error.message,
            });
            return;
          }
        }
        throw error;
      }
    };

    handleCreate().catch((error: unknown) => {
      console.error("[workflows] Error creating workflow:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to create workflow",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
	 * PUT /api/workflows/:tier/:name - Update existing workflow
	 * Body: { content: WorkflowContent, projectPath?: string }
	 */
  router.put("/:tier/:name", (req: Request, res: Response): void => {
    const handleUpdate = async (): Promise<void> => {
      const tier = String(req.params.tier) as WorkflowTier;
      const name = String(req.params.name);
      const body = req.body as WorkflowRequestBody;

      // Reject built-in tier updates
      if (tier === "built-in") {
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Built-in tier is read-only",
          message: "Cannot update workflows in built-in tier",
        });
        return;
      }

      // Validate request body
      if (!body.content) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing content",
          message: "Request body must include 'content' field",
        });
        return;
      }

      // Validate projectPath for project tier
      if (tier === "project" && !body.projectPath) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath",
          message: "projectPath required in body for project tier",
        });
        return;
      }

      try {
        await deps.workflowStorage.updateWorkflow(
          tier,
          name,
          body.content,
          body.projectPath
        );
        res.status(HTTP_STATUS_OK).json({
          success: true,
          tier,
          name,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            res.status(HTTP_STATUS_NOT_FOUND).json({
              error: "Workflow not found",
              message: error.message,
            });
            return;
          }
          if (error.message.includes("read-only")) {
            res.status(HTTP_STATUS_FORBIDDEN).json({
              error: "Cannot update read-only tier",
              message: error.message,
            });
            return;
          }
        }
        throw error;
      }
    };

    handleUpdate().catch((error: unknown) => {
      console.error("[workflows] Error updating workflow:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update workflow",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
	 * DELETE /api/workflows/:tier/:name - Delete workflow
	 * Query params: ?projectPath=/path/to/project (required if tier is 'project')
	 */
  router.delete("/:tier/:name", (req: Request, res: Response): void => {
    const handleDelete = async (): Promise<void> => {
      const tier = String(req.params.tier) as WorkflowTier;
      const name = String(req.params.name);
      const projectPath = req.query.projectPath as string | undefined;

      // Reject built-in tier deletes
      if (tier === "built-in") {
        res.status(HTTP_STATUS_FORBIDDEN).json({
          error: "Built-in tier is read-only",
          message: "Cannot delete workflows from built-in tier",
        });
        return;
      }

      // Validate projectPath for project tier
      if (tier === "project" && !projectPath) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath",
          message: "projectPath query parameter required for project tier",
        });
        return;
      }

      try {
        await deps.workflowStorage.deleteWorkflow(tier, name, projectPath);
        res.status(HTTP_STATUS_NO_CONTENT).send();
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            res.status(HTTP_STATUS_NOT_FOUND).json({
              error: "Workflow not found",
              message: error.message,
            });
            return;
          }
          if (error.message.includes("read-only")) {
            res.status(HTTP_STATUS_FORBIDDEN).json({
              error: "Cannot delete from read-only tier",
              message: error.message,
            });
            return;
          }
        }
        throw error;
      }
    };

    handleDelete().catch((error: unknown) => {
      console.error("[workflows] Error deleting workflow:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to delete workflow",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
	 * GET /api/workflows/templates - List all built-in workflow templates
	 * Returns parsed metadata from built-in workflows for template gallery
	 */
  router.get("/templates", (_req: Request, res: Response): void => {
    const handleTemplates = async (): Promise<void> => {
      try {
        // Get all built-in workflows
        const workflows = await deps.workflowStorage.listWorkflows();
        const builtInWorkflows = workflows.filter((w) => w.tier === "built-in");

        // Read and parse each workflow to extract metadata
        const templates = await Promise.all(
          builtInWorkflows.map(async (workflow) => {
            try {
              const content = await deps.workflowStorage.readWorkflow(
                "built-in",
                workflow.name
              );

              return {
                id: workflow.name,
                name: content.name || workflow.name,
                description: content.description || "",
                tags:
									(content.metadata as { tags?: string[] })?.tags || [],
                phases: Array.isArray(content.phases)
                  ? content.phases.length
                  : 0,
                version: (content.version as string) || "1.0.0",
                author:
									(content.metadata as { author?: string })?.author ||
									"unknown",
                command:
									(content.entry as { command?: string })?.command || null,
              };
            } catch (error) {
              console.error(
                `[workflows] Failed to parse template ${workflow.name}:`,
                error
              );
              return null;
            }
          })
        );

        // Filter out failed parses
        const validTemplates = templates.filter(
          (t): t is NonNullable<typeof t> => t !== null
        );

        res.status(HTTP_STATUS_OK).json(validTemplates);
      } catch (error) {
        console.error("[workflows] Error loading templates:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to load templates",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    handleTemplates().catch((error: unknown) => {
      console.error("[workflows] Uncaught error in templates handler:", error);
    });
  });

  /**
	 * POST /api/workflows/clone - Clone a built-in template to global or project tier
	 * Body: { templateId: string, tier: 'global' | 'project', projectPath?: string }
	 */
  router.post("/clone", (req: Request, res: Response): void => {
    const handleClone = async (): Promise<void> => {
      const body = req.body as {
				templateId: string;
				tier: "global" | "project";
				projectPath?: string;
			};

      // Validate request body
      if (!body.templateId || !body.tier) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required fields",
          message: "Request must include templateId and tier",
        });
        return;
      }

      // Validate tier
      if (body.tier !== "global" && body.tier !== "project") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid tier",
          message: "Tier must be 'global' or 'project'",
        });
        return;
      }

      // Validate projectPath for project tier
      if (body.tier === "project" && !body.projectPath) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing projectPath",
          message: "projectPath required for project tier",
        });
        return;
      }

      try {
        // Read the built-in template
        const templateContent = await deps.workflowStorage.readWorkflow(
          "built-in",
          body.templateId
        );

        // Create workflow in target tier
        await deps.workflowStorage.createWorkflow(
          body.tier,
          body.templateId,
          templateContent,
          body.projectPath
        );

        // Construct path for response
        let targetPath: string;
        if (body.tier === "global") {
          const homeDir = os.homedir();
          targetPath = path.join(
            homeDir,
            ".claude",
            "workflows",
            `${body.templateId}.yml`
          );
        } else {
          targetPath = path.join(
						body.projectPath!,
						".claude",
						"workflows",
						`${body.templateId}.yml`
          );
        }

        res.status(HTTP_STATUS_CREATED).json({
          success: true,
          path: targetPath,
          message: `Workflow cloned to ${body.tier} directory`,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            res.status(HTTP_STATUS_NOT_FOUND).json({
              error: "Template not found",
              message: error.message,
            });
            return;
          }
          if (error.message.includes("already exists")) {
            res.status(HTTP_STATUS_BAD_REQUEST).json({
              error: "Workflow already exists",
              message: `A workflow named '${body.templateId}' already exists in the ${body.tier} tier`,
            });
            return;
          }
        }
        throw error;
      }
    };

    handleClone().catch((error: unknown) => {
      console.error("[workflows] Error cloning template:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to clone template",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  return router;
}
