/**
 * Stats Router
 * REST API endpoints for agent statistics and analytics
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type { LogAggregatorService } from "../services/log-aggregator.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Error response structure
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Router configuration
 */
export interface StatsRouterConfig {
  /** LogAggregatorService instance for fetching statistics */
  logAggregator: LogAggregatorService;
}

/**
 * Create stats router for agent statistics endpoints
 * @param config - Router configuration with required services
 * @returns Express Router instance
 */
export function createStatsRouter(config: StatsRouterConfig): Router {
   
  const router: Router = express.Router() as Router;
  const { logAggregator } = config;

  /**
   * GET /api/stats/agents
   * Returns 24-hour agent statistics including:
   * - Per-agent invocation counts and completion times
   * - Token usage per agent
   * - Skills used by each agent
   * - MCP tool usage across all agents
   * - Top skills overall
   */
  router.get("/agents", (_req: Request, res: Response): void => {
    try {
      const stats = logAggregator.getAgentStats24h();
      res.status(HTTP_STATUS_OK).json(stats);
    } catch (error) {
      console.error("[Stats] Error fetching agent stats:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to fetch agent statistics",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}

/**
 * Export types for external use
 */
export type { ErrorResponse };
