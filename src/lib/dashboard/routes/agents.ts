/**
 * Agents Router
 * REST API endpoint for agent metadata including colors
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";
import { AgentColorsService } from "../services/agent-colors.js";

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Agent color mapping response
 */
export interface AgentColorsResponse {
  /** Map of agent name to color string */
  colors: Record<string, string>;
  /** Total number of agents */
  count: number;
  /** ISO timestamp of when colors were last loaded */
  lastUpdated: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Dependencies for agents router
 */
export interface AgentsRouterDeps {
  /** Agent colors service */
  agentColorsService: AgentColorsService;
}

/**
 * Create agents router
 */
export function createAgentsRouter(deps: AgentsRouterDeps): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/agents/colors - Get agent color mappings
   */
  router.get("/colors", (_req: Request, res: Response): void => {
    try {
      const colorMap = deps.agentColorsService.getAgentColors();
      const response: AgentColorsResponse = {
        colors: colorMap,
        count: Object.keys(colorMap).length,
        lastUpdated: deps.agentColorsService.getLastUpdated().toISOString(),
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[agents/colors] Error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get agent colors",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}
