/**
 * Sessions Router
 * REST API endpoints for session management
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type { SessionDataService } from "../services/SessionDataService.js";
import type { SessionInfo, SessionListItem } from "../../../types/dashboard/session.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
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
 * Session list response structure
 */
interface SessionListResponse {
  sessions: SessionListItem[];
  total: number;
}

/**
 * Session detail response structure (extends SessionInfo for API response)
 */
interface SessionDetailResponse {
  id: string;
  projectName: string;
  projectPath: string;
  status: "active" | "error" | "paused";
  startTime: string;
  elapsedTime: string;
  lastActivity: string;
  stats: {
    tokensUsed: number;
    toolCalls: number;
    agentsSpawned: number;
  };
}

/**
 * Create sessions router with session data service
 * @param sessionService - Service for session data retrieval
 * @returns Express router with session endpoints
 */
export function createSessionsRouter(sessionService: SessionDataService): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/sessions - List all active sessions
   */
  router.get("/", (_req: Request, res: Response): void => {
    const handleGetSessions = async (): Promise<void> => {
      const sessions = await sessionService.getActiveSessions();

      const response: SessionListResponse = {
        sessions,
        total: sessions.length,
      };

      res.status(HTTP_STATUS_OK).json(response);
    };

    handleGetSessions().catch((error: unknown) => {
      console.error("[sessions] Error getting sessions:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/sessions/:id - Get session details by ID
   */
  router.get("/:id", (req: Request, res: Response): void => {
    const handleGetSession = async (): Promise<void> => {
      const sessionId = String(req.params.id);
      const session = await sessionService.getSessionById(sessionId);

      if (!session) {
        const errorResponse: ErrorResponse = {
          error: "Session not found",
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      // Transform SessionInfo to SessionDetailResponse
      const response: SessionDetailResponse = transformSessionToResponse(session);

      res.status(HTTP_STATUS_OK).json(response);
    };

    handleGetSession().catch((error: unknown) => {
      console.error("[sessions] Error getting session:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get session",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  return router;
}

/**
 * Transform SessionInfo to API response format
 * @param session - Session info from service
 * @returns Formatted session detail response
 */
function transformSessionToResponse(session: SessionInfo): SessionDetailResponse {
  // Calculate lastActivity from startTime and elapsedTime
  // For now, use startTime as lastActivity since we don't have precise tracking
  const lastActivity = session.startTime.toISOString();

  return {
    id: session.id,
    projectName: session.projectName,
    projectPath: session.projectPath,
    status: session.status,
    startTime: session.startTime.toISOString(),
    elapsedTime: session.elapsedTime,
    lastActivity,
    stats: {
      // Stats are placeholders - would need to parse session logs for real values
      tokensUsed: 0,
      toolCalls: 0,
      agentsSpawned: 0,
    },
  };
}

/**
 * Export types for external use
 */
export type { ErrorResponse, SessionDetailResponse, SessionListResponse };
