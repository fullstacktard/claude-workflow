/**
 * Logs Router
 * REST API endpoints for querying logs and statistics
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type {
  LogAggregatorService,
  LogFilterOptions,
} from "../services/log-aggregator.js";

import type { LogEventType } from "../services/types/log-entry.js";

// Pagination constants
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Top N limit for stats
const TOP_ENTRIES_LIMIT = 10;

// Time constants
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Query parameters for /api/logs endpoint
 */
interface LogsQueryParams {
  limit?: string;
  offset?: string;
  project?: string;
  timeRange?: string;
  type?: string;
}

/**
 * Paginated response wrapper
 */
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
}

/**
 * Log entry for API response
 * Includes all event types: invocations, MCP calls, and workflow events
 */
interface TransformedLogEntry {
  timestamp: string;
  project: string;
  type: "agent_invocation" | "skill_invocation" | "agent_with_skill" | "mcp_tool_call" | "agent_completion" | "workflow_start" | "workflow_stage" | "workflow_trigger" | "workflow_complete" | "workflow_resumed";
  agent?: string;
  skill?: string;
  message?: string;
  tool_use_id?: string;
  // Additional fields for invocations
  agentContext?: string;
  mcpServer?: string;
  mcpTool?: string;
  expectedSkills?: string[];
  totalTokens?: number;
  totalDurationMs?: number;
}

/**
 * Statistics response
 */
interface StatsResponse {
  topAgents: { count: number; name: string }[];
  topSkills: { count: number; name: string }[];
  totalInvocations: number;
}

/**
 * Create logs router with aggregator service
 */
export function createLogsRouter(aggregator: LogAggregatorService): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/logs - Query logs with filters and pagination
   * Returns all event types: agent/skill invocations, MCP calls, and workflow events
   */
  router.get("/logs", (req: Request, res: Response): void => {
    const handleLogs = async (): Promise<void> => {
      const query = req.query as LogsQueryParams;

      // Parse pagination params
      const { limit, offset } = parsePagination(query.limit, query.offset);

      // Build filter options
      const filters: LogFilterOptions = {
        project: query.project,
        timeRange: parseTimeRange(query.timeRange),
        eventTypes: parseEventTypesFilter(query.type),
      };

      // Query ALL events (invocations, MCP calls, workflow events)
      const result = await aggregator.queryAllEvents(filters, { limit, offset });

      // Map StandardLogEntry to TransformedLogEntry for API response
      const transformedEntries: TransformedLogEntry[] = result.entries.map((entry) => ({
        timestamp: entry.timestamp,
        project: entry.projectName,
        type: entry.type,
        agent: entry.agent,
        skill: entry.skill,
        message: entry.message,
        tool_use_id: undefined,
        agentContext: entry.agentContext,
        mcpServer: entry.mcpServer,
        mcpTool: entry.mcpTool,
        expectedSkills: entry.expectedSkills,
        totalTokens: entry.totalTokens,
        totalDurationMs: entry.totalDurationMs,
      }));

      const response: PaginatedResponse<TransformedLogEntry> = {
        data: transformedEntries,
        pagination: {
          hasMore: offset + limit < result.total,
          limit,
          offset,
          total: result.total,
        },
      };

      res.status(HTTP_STATUS_OK).json(response);
    };


    handleLogs().catch((error: unknown) => {
      console.error("[logs] Error querying logs:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to query logs",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/stats - Aggregated statistics
   */
  router.get("/stats", (_req: Request, res: Response): void => {
    const handleStats = async (): Promise<void> => {
      const stats = await aggregator.getStats();

      const response: StatsResponse = {
        topAgents: stats.agentCounts
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_ENTRIES_LIMIT),
        topSkills: stats.skillCounts
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_ENTRIES_LIMIT),
        totalInvocations: stats.totalDecisions,
      };

      res.status(HTTP_STATUS_OK).json(response);
    };


    handleStats().catch((error: unknown) => {
      console.error("[stats] Error aggregating stats:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to aggregate statistics",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  // NOTE: /api/projects is now handled by the dedicated projects router
  // which provides additional stats like activeSessions and tokenUsage

  return router;
}

/**
 * Parse pagination parameters
 */
function parsePagination(limitStr?: string, offsetStr?: string): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(1, Number.parseInt(limitStr ?? String(DEFAULT_PAGE_SIZE), 10)),
    MAX_PAGE_SIZE
  );
  const offset = Math.max(0, Number.parseInt(offsetStr ?? "0", 10));

  // Handle NaN values
  return {
    limit: Number.isNaN(limit) ? DEFAULT_PAGE_SIZE : limit,
    offset: Number.isNaN(offset) ? 0 : offset,
  };
}

/**
 * Parse time range string into date bounds
 */
function parseTimeRange(timeRange?: string): undefined | { end: Date; start: Date } {
  if (timeRange === undefined || timeRange === "") {
    return undefined;
  }

  const now = Date.now();

  switch (timeRange) {
  case "1h": {
    return { end: new Date(now), start: new Date(now - MILLISECONDS_PER_HOUR) };
  }
  case "4h": {
    const HOURS_4 = 4;
    return { end: new Date(now), start: new Date(now - HOURS_4 * MILLISECONDS_PER_HOUR) };
  }
  case "7d": {
    return { end: new Date(now), start: new Date(now - DAYS_IN_WEEK * MILLISECONDS_PER_DAY) };
  }
  case "24h": {
    return { end: new Date(now), start: new Date(now - MILLISECONDS_PER_DAY) };
  }
  case "30d": {
    return { end: new Date(now), start: new Date(now - DAYS_IN_MONTH * MILLISECONDS_PER_DAY) };
  }
  default: {
    return undefined;
  }
  }
}

/**
 * Parse type parameter to event types filter
 *
 * @param type - Filter type: "agent", "skill", "mcp", "workflow", or undefined for all
 * @returns Array of event types to include, or undefined for default set
 */
function parseEventTypesFilter(type?: string): LogEventType[] | undefined {
  if (type === undefined || type === "") {
    return undefined; // Show all default event types
  }

  switch (type) {
  case "agent": {
    return ["agent_invocation", "agent_completion"];
  }
  case "skill": {
    return ["skill_invocation"];
  }
  case "mcp": {
    return ["mcp_tool_call"];
  }
  case "workflow": {
    return ["workflow_start", "workflow_stage", "workflow_trigger", "workflow_complete", "workflow_resumed"];
  }
  default: {
    return undefined;
  }
  }
}

/**
 * Export types for external use
 */
export type {
  ErrorResponse,
  LogsQueryParams,
  PaginatedResponse,
  StatsResponse,
};
