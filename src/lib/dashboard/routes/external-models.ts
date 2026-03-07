/**
 * External Models Router
 * REST API endpoints for managing external (non-Claude) models.
 * Models are stored in ~/.claude-workflow/external-models.json
 */

import type { Request, Response, Router } from "express-serve-static-core";

import { randomUUID } from "node:crypto";
import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_CREATED = 201;
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Config paths
const CLAUDE_WORKFLOW_DIR = path.join(process.env.HOME || "", ".claude-workflow");
const MODELS_PATH = path.join(CLAUDE_WORKFLOW_DIR, "external-models.json");

/**
 * External model configuration
 */
export interface ExternalModel {
  id: string;
  name: string;
  provider: "openai" | "azure" | "ollama" | "custom";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Read external models from JSON file
 */
function readModels(): ExternalModel[] {
  try {
    if (!existsSync(MODELS_PATH)) {
      return [];
    }
    const content = readFileSync(MODELS_PATH, "utf8");
    const data = JSON.parse(content) as ExternalModel[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Write external models to JSON file
 */
function writeModels(models: ExternalModel[]): void {
  // Ensure directory exists
  if (!existsSync(CLAUDE_WORKFLOW_DIR)) {
    mkdirSync(CLAUDE_WORKFLOW_DIR, { recursive: true });
  }
  writeFileSync(MODELS_PATH, JSON.stringify(models, null, 2), { mode: 0o600 });
}

/**
 * Validate external model data
 */
function validateModel(model: Partial<ExternalModel>): string | null {
  if (!model.name || typeof model.name !== "string" || model.name.trim().length === 0) {
    return "Name is required";
  }

  const validProviders = ["openai", "azure", "ollama", "custom"];
  if (!model.provider || !validProviders.includes(model.provider)) {
    return "Invalid provider";
  }

  if (!model.baseUrl || typeof model.baseUrl !== "string") {
    return "Base URL is required";
  }

  // Validate URL format
  try {
    new URL(model.baseUrl);
  } catch {
    return "Invalid base URL format";
  }

  if (!model.modelId || typeof model.modelId !== "string" || model.modelId.trim().length === 0) {
    return "Model ID is required";
  }

  // Ollama doesn't require API key, but other providers do
  if (model.provider !== "ollama" && (!model.apiKey || typeof model.apiKey !== "string")) {
    return "API key is required for this provider";
  }

  return null;
}

/**
 * Create external models router
 */
export function createExternalModelsRouter(): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/external-models - Get all external models
   */
  router.get("/", (_req: Request, res: Response): void => {
    try {
      const models = readModels();
      // Mask API keys in response
      const maskedModels = models.map((model) => ({
        ...model,
        apiKey: model.apiKey ? "••••••••" : "",
      }));
      res.status(HTTP_STATUS_OK).json(maskedModels);
    } catch (error) {
      console.error("[external-models] Error reading models:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read models",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/external-models/:id - Get single external model
   */
  router.get("/:id", (req: Request, res: Response): void => {
    try {
      const id = String(req.params.id);
      const models = readModels();
      const model = models.find((m) => m.id === id);

      if (!model) {
        res.status(HTTP_STATUS_NOT_FOUND).json({
          error: "Not found",
          message: `Model ${id} not found`,
        });
        return;
      }

      // Mask API key in response
      res.status(HTTP_STATUS_OK).json({
        ...model,
        apiKey: model.apiKey ? "••••••••" : "",
      });
    } catch (error) {
      console.error("[external-models] Error reading model:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read model",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * POST /api/external-models - Create new external model
   */
  router.post("/", (req: Request, res: Response): void => {
    try {
      const body = req.body as Partial<ExternalModel>;

      const validationError = validateModel(body);
      if (validationError) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Validation failed",
          message: validationError,
        });
        return;
      }

      const models = readModels();
      const newModel: ExternalModel = {
        id: randomUUID(),
        name: body.name!.trim(),
        provider: body.provider!,
        baseUrl: body.baseUrl!,
        apiKey: body.apiKey || "",
        modelId: body.modelId!.trim(),
        maxTokens: body.maxTokens,
        temperature: body.temperature,
      };

      models.push(newModel);
      writeModels(models);

      // Return with masked API key
      res.status(HTTP_STATUS_CREATED).json({
        ...newModel,
        apiKey: newModel.apiKey ? "••••••••" : "",
      });
    } catch (error) {
      console.error("[external-models] Error creating model:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to create model",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PUT /api/external-models/:id - Update external model
   */
  router.put("/:id", (req: Request, res: Response): void => {
    try {
      const id = String(req.params.id);
      const body = req.body as Partial<ExternalModel>;

      const models = readModels();
      const index = models.findIndex((m) => m.id === id);

      if (index === -1) {
        res.status(HTTP_STATUS_NOT_FOUND).json({
          error: "Not found",
          message: `Model ${id} not found`,
        });
        return;
      }

      const existingModel = models[index];

      // If apiKey is masked (••••••••), keep the existing key
      const apiKey = body.apiKey === "••••••••" ? existingModel.apiKey : (body.apiKey ?? existingModel.apiKey);

      const updatedModel: ExternalModel = {
        id: existingModel.id,
        name: body.name?.trim() || existingModel.name,
        provider: body.provider || existingModel.provider,
        baseUrl: body.baseUrl || existingModel.baseUrl,
        apiKey,
        modelId: body.modelId?.trim() || existingModel.modelId,
        maxTokens: body.maxTokens ?? existingModel.maxTokens,
        temperature: body.temperature ?? existingModel.temperature,
      };

      const validationError = validateModel(updatedModel);
      if (validationError) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Validation failed",
          message: validationError,
        });
        return;
      }

      models[index] = updatedModel;
      writeModels(models);

      // Return with masked API key
      res.status(HTTP_STATUS_OK).json({
        ...updatedModel,
        apiKey: updatedModel.apiKey ? "••••••••" : "",
      });
    } catch (error) {
      console.error("[external-models] Error updating model:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update model",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/external-models/:id - Delete external model
   */
  router.delete("/:id", (req: Request, res: Response): void => {
    try {
      const id = String(req.params.id);
      const models = readModels();
      const index = models.findIndex((m) => m.id === id);

      if (index === -1) {
        res.status(HTTP_STATUS_NOT_FOUND).json({
          error: "Not found",
          message: `Model ${id} not found`,
        });
        return;
      }

      models.splice(index, 1);
      writeModels(models);

      res.status(HTTP_STATUS_NO_CONTENT).send();
    } catch (error) {
      console.error("[external-models] Error deleting model:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to delete model",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}
