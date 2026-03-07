/**
 * X Accounts Router
 * REST API endpoints for X (Twitter) account management:
 * - List accounts (with DashboardXAccount DTO sanitization)
 * - Import accounts
 * - Post tweets/threads, reply, like, follow
 * - Execute warming steps
 * - Read timeline and notifications
 *
 * All operations proxy through McpToolClient -> mcp-proxy -> x-client-mcp (stdio).
 * Security policy: docs/research/x-dashboard-security-sensitive-data-policy.md
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type { DashboardXAccount, RawVaultAccountResponse } from "../types/x-dashboard.js";
import { toSafeDashboardAccount } from "../types/x-dashboard.js";
import {
  handleMcpError,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

/**
 * Create X accounts router with dependencies.
 *
 * Route map:
 *   GET  /                  -> x_list_accounts (returns DashboardXAccount[])
 *   POST /import            -> x_import_account
 *   POST /:id/tweet         -> x_post_tweet
 *   POST /:id/thread        -> x_post_thread
 *   POST /:id/reply         -> x_reply_tweet
 *   POST /:id/like          -> x_like_tweet
 *   POST /:id/follow        -> x_follow_user
 *   POST /:id/warm          -> x_warming_step
 *   GET  /:id/timeline      -> x_get_timeline
 *   GET  /:id/notifications -> x_get_notifications
 */
export function createXAccountsRouter({
  mcpToolClient,
}: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/x-accounts - List all X accounts (sanitized)
  router.get("/", (_req: Request, res: Response): void => {
    const handleListAccounts = async (): Promise<void> => {
      try {
        const raw =
          await mcpToolClient.callTool<
            | RawVaultAccountResponse[]
            | { accounts: RawVaultAccountResponse[] }
          >("x_list_accounts");
        // x_list_accounts returns { total, accounts: [...] } not a flat array
        const rawList = Array.isArray(raw)
          ? raw
          : (Array.isArray(raw?.accounts)
            ? raw.accounts
            : []);
        const accounts: DashboardXAccount[] =
          rawList.map((item) => toSafeDashboardAccount(item));
        res.status(HTTP_STATUS_OK).json({ accounts });
      } catch (error) {
        handleMcpError(res, error, "list X accounts");
      }
    };
    void handleListAccounts();
  });

  // POST /api/x-accounts/import - Import an X account
  router.post("/import", (req: Request, res: Response): void => {
    const handleImport = async (): Promise<void> => {
      try {
        const body = req.body as Record<string, unknown>;
        // Validate required fields for x_import_account
        if (!body.handle || typeof body.handle !== "string") {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required field",
            message: "handle is required",
          });
          return;
        }
        if (!body.auth_token || typeof body.auth_token !== "string") {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required field",
            message: "auth_token is required",
          });
          return;
        }
        if (!body.ct0 || typeof body.ct0 !== "string") {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required field",
            message: "ct0 is required",
          });
          return;
        }
        const result = await mcpToolClient.callTool(
          "x_import_account",
          body,
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "import X account");
      }
    };
    void handleImport();
  });

  // POST /api/x-accounts/:id/tweet - Post a tweet
  router.post("/:id/tweet", (req: Request, res: Response): void => {
    const handleTweet = async (): Promise<void> => {
      try {
        const { text } = req.body as { text?: string };
        if (!text) {
          res
            .status(HTTP_STATUS_BAD_REQUEST)
            .json({ error: "Missing required field", message: "text is required" });
          return;
        }
        const result = await mcpToolClient.callTool("x_post_tweet", {
          account_id: req.params.id,
          text,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "post tweet");
      }
    };
    void handleTweet();
  });

  // POST /api/x-accounts/:id/thread - Post a thread
  router.post("/:id/thread", (req: Request, res: Response): void => {
    const handleThread = async (): Promise<void> => {
      try {
        const { tweets } = req.body as { tweets?: string[] };
        if (!Array.isArray(tweets) || tweets.length === 0) {
          res
            .status(HTTP_STATUS_BAD_REQUEST)
            .json({ error: "Missing required field", message: "tweets array is required" });
          return;
        }
        const result = await mcpToolClient.callTool("x_post_thread", {
          account_id: req.params.id,
          tweets,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "post thread");
      }
    };
    void handleThread();
  });

  // POST /api/x-accounts/:id/reply - Reply to a tweet
  router.post("/:id/reply", (req: Request, res: Response): void => {
    const handleReply = async (): Promise<void> => {
      try {
        const { tweet_id, text } = req.body as {
          tweet_id?: string;
          text?: string;
        };
        if (!tweet_id || !text) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required fields",
            message: "tweet_id and text are required",
          });
          return;
        }
        const result = await mcpToolClient.callTool("x_reply_tweet", {
          account_id: req.params.id,
          tweet_id,
          text,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "reply to tweet");
      }
    };
    void handleReply();
  });

  // POST /api/x-accounts/:id/like - Like a tweet
  router.post("/:id/like", (req: Request, res: Response): void => {
    const handleLike = async (): Promise<void> => {
      try {
        const { tweet_id } = req.body as { tweet_id?: string };
        if (!tweet_id) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required field",
            message: "tweet_id is required",
          });
          return;
        }
        const result = await mcpToolClient.callTool("x_like_tweet", {
          account_id: req.params.id,
          tweet_id,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "like tweet");
      }
    };
    void handleLike();
  });

  // POST /api/x-accounts/:id/follow - Follow a user
  router.post("/:id/follow", (req: Request, res: Response): void => {
    const handleFollow = async (): Promise<void> => {
      try {
        const { username } = req.body as { username?: string };
        if (!username) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Missing required field",
            message: "username is required",
          });
          return;
        }
        const result = await mcpToolClient.callTool("x_follow_user", {
          account_id: req.params.id,
          username,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "follow user");
      }
    };
    void handleFollow();
  });

  // POST /api/x-accounts/:id/warm - Execute warming step
  router.post("/:id/warm", (req: Request, res: Response): void => {
    const handleWarm = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool("x_warming_step", {
          account_id: req.params.id,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "execute warming step");
      }
    };
    void handleWarm();
  });

  // GET /api/x-accounts/:id/timeline - Get home timeline
  router.get("/:id/timeline", (req: Request, res: Response): void => {
    const handleTimeline = async (): Promise<void> => {
      try {
        const count = Number(req.query.count) || 20;
        const result = await mcpToolClient.callTool("x_get_timeline", {
          account_id: req.params.id,
          count,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "get timeline");
      }
    };
    void handleTimeline();
  });

  // GET /api/x-accounts/:id/notifications - Get notifications
  router.get("/:id/notifications", (req: Request, res: Response): void => {
    const handleNotifications = async (): Promise<void> => {
      try {
        const count = Number(req.query.count) || 20;
        const result = await mcpToolClient.callTool("x_get_notifications", {
          account_id: req.params.id,
          count,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "get notifications");
      }
    };
    void handleNotifications();
  });

  return router;
}
