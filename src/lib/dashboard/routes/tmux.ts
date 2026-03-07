/**
 * Tmux Router
 * REST API endpoints for tmux session management:
 * - GET    /api/tmux/sessions              - List all sessions as a tree with notification flags
 * - POST   /api/tmux/sessions              - Create a new session
 * - DELETE  /api/tmux/sessions/:name        - Kill a session
 * - PATCH   /api/tmux/sessions/:name        - Rename a session
 * - DELETE  /api/tmux/notifications/:sessionName - Clear a notification marker
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import {
  buildSessionTree,
  clearNotification,
  readNotifications,
  readRegistry,
  type NotificationMarker,
  type RegistryProject,
  type TmuxSession,
} from "tmux-manager/data";

import type { TmuxDockerClient } from "../services/tmux-docker-client.js";

// HTTP status codes (matches existing codebase pattern)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_CREATED = 201;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/** Regex for valid tmux session names (prevents command injection). */
const SESSION_NAME_REGEX = /^[\w.-]+$/;

// ── Response Types ──────────────────────────────────────────────────

/** Serialized TmuxSession for JSON transport (Date -> string, + notification flag). */
interface SerializedTmuxSession {
  id: string;
  name: string;
  path: string;
  created: string;
  attached: number;
  windows: number;
  hasNotification: boolean;
}

/** A project node with its sessions serialized for JSON transport. */
interface SerializedProjectNode {
  project: RegistryProject;
  sessions: SerializedTmuxSession[];
}

/** Response shape for GET /api/tmux/sessions. */
interface TmuxSessionsResponse {
  registered: SerializedProjectNode[];
  registeredNoSessions: SerializedProjectNode[];
  unregistered: SerializedTmuxSession[];
  totalSessions: number;
  tmuxAvailable: boolean;
}

/** Standard error response. */
interface ErrorResponse {
  error: string;
  message?: string;
}

/** Standard action result response. */
interface ActionResponse {
  success: boolean;
  error?: string;
}

// ── Request Body Types ──────────────────────────────────────────────

/** Body for POST /api/tmux/sessions. */
interface CreateSessionBody {
  name: string;
  projectDir: string;
}

/** Body for PATCH /api/tmux/sessions/:name. */
interface RenameSessionBody {
  newName: string;
}

// ── Router Dependencies ─────────────────────────────────────────────

/** Dependencies injected into the tmux router factory. */
export interface TmuxRouterDeps {
  /** Socket-aware tmux client for Docker environments */
  tmuxClient: TmuxDockerClient;
  /** Override path for registry.json (for Docker volume mounts) */
  registryPath?: string;
  /** Override path for notifications directory (for Docker volume mounts) */
  notifDir?: string;
}

// ── Router Factory ──────────────────────────────────────────────────

/**
 * Create the tmux router with injected dependencies.
 *
 * @param deps - Router dependencies (tmux client, optional path overrides)
 * @returns Express router with tmux session management endpoints
 */
export function createTmuxRouter(deps: TmuxRouterDeps): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/tmux/sessions - List all sessions as a tree with notification flags
   */
  router.get("/sessions", (_req: Request, res: Response): void => {
    try {
      const projects = readRegistry(deps.registryPath);
      const sessions = deps.tmuxClient.listSessions();
      const notifications = readNotifications(deps.notifDir);
      const tree = buildSessionTree(projects, sessions);

      const response: TmuxSessionsResponse = {
        registered: tree.registered.map((node) => ({
          project: node.project,
          sessions: node.sessions.map((s) => serializeSession(s, notifications)),
        })),
        registeredNoSessions: tree.registeredNoSessions.map((node) => ({
          project: node.project,
          sessions: [],
        })),
        unregistered: tree.unregistered.map((s) => serializeSession(s, notifications)),
        totalSessions: sessions.length,
        tmuxAvailable: deps.tmuxClient.isAvailable(),
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[tmux] Error listing sessions:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to list sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * POST /api/tmux/sessions - Create a new session
   * Body: { name: string, projectDir: string }
   */
  router.post("/sessions", (req: Request, res: Response): void => {
    try {
      const body = req.body as CreateSessionBody | undefined;

      if (body === undefined || body === null || typeof body.name !== "string" || body.name === "") {
        const errorResponse: ErrorResponse = {
          error: "Missing or invalid 'name' in request body",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      if (typeof body.projectDir !== "string" || body.projectDir === "") {
        const errorResponse: ErrorResponse = {
          error: "Missing or invalid 'projectDir' in request body",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      if (!SESSION_NAME_REGEX.test(body.name)) {
        const errorResponse: ErrorResponse = {
          error: String.raw`Invalid session name. Must match /^[\w.-]+$/`,
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      const result = deps.tmuxClient.createSession(body.name, body.projectDir);

      if (result.success) {
        const response: ActionResponse = { success: true };
        res.status(HTTP_STATUS_CREATED).json(response);
      } else {
        const response: ActionResponse = { success: false, error: result.error };
        res.status(HTTP_STATUS_BAD_REQUEST).json(response);
      }
    } catch (error: unknown) {
      console.error("[tmux] Error creating session:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to create session",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/tmux/sessions/:name - Kill a session
   */
  router.delete("/sessions/:name", (req: Request, res: Response): void => {
    try {
      const name = String(req.params.name);

      if (!SESSION_NAME_REGEX.test(name)) {
        const errorResponse: ErrorResponse = {
          error: "Invalid session name format",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      const result = deps.tmuxClient.killSession(name);

      if (result.success) {
        const response: ActionResponse = { success: true };
        res.status(HTTP_STATUS_OK).json(response);
      } else {
        const response: ActionResponse = { success: false, error: result.error };
        res.status(HTTP_STATUS_NOT_FOUND).json(response);
      }
    } catch (error: unknown) {
      console.error("[tmux] Error killing session:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to kill session",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PATCH /api/tmux/sessions/:name - Rename a session
   * Body: { newName: string }
   */
  router.patch("/sessions/:name", (req: Request, res: Response): void => {
    try {
      const oldName = String(req.params.name);
      const body = req.body as RenameSessionBody | undefined;

      if (!SESSION_NAME_REGEX.test(oldName)) {
        const errorResponse: ErrorResponse = {
          error: "Invalid current session name format",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      if (body === undefined || body === null || typeof body.newName !== "string" || body.newName === "") {
        const errorResponse: ErrorResponse = {
          error: "Missing or invalid 'newName' in request body",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      if (!SESSION_NAME_REGEX.test(body.newName)) {
        const errorResponse: ErrorResponse = {
          error: String.raw`Invalid new session name. Must match /^[\w.-]+$/`,
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      const result = deps.tmuxClient.renameSession(oldName, body.newName);

      if (result.success) {
        const response: ActionResponse = { success: true };
        res.status(HTTP_STATUS_OK).json(response);
      } else {
        const response: ActionResponse = { success: false, error: result.error };
        res.status(HTTP_STATUS_BAD_REQUEST).json(response);
      }
    } catch (error: unknown) {
      console.error("[tmux] Error renaming session:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to rename session",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/tmux/notifications/:sessionName - Clear a notification marker
   */
  router.delete("/notifications/:sessionName", (req: Request, res: Response): void => {
    try {
      const sessionName = String(req.params.sessionName);

      if (!SESSION_NAME_REGEX.test(sessionName)) {
        const errorResponse: ErrorResponse = {
          error: "Invalid session name format",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      clearNotification(sessionName, deps.notifDir);

      const response: ActionResponse = { success: true };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[tmux] Error clearing notification:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to clear notification",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Serialize a TmuxSession to JSON-safe format with notification flag merged.
 *
 * @param session - The tmux session to serialize
 * @param notifications - Map of session name to notification markers
 * @returns JSON-safe session object with `hasNotification` flag
 */
function serializeSession(
  session: TmuxSession,
  notifications: Map<string, NotificationMarker>,
): SerializedTmuxSession {
  return {
    id: session.id,
    name: session.name,
    path: session.path,
    created: session.created.toISOString(),
    attached: session.attached,
    windows: session.windows,
    hasNotification: notifications.has(session.name),
  };
}

// Export types for external use
export type {
  ActionResponse,
  ErrorResponse,
  SerializedProjectNode,
  SerializedTmuxSession,
  TmuxSessionsResponse,
};
