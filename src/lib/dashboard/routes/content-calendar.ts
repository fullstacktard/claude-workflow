/**
 * Content Calendar Router
 * REST API endpoints for content calendar management.
 * All operations proxy through McpToolClient -> mcp-proxy -> marketing-mcp.
 *
 * Route map:
 *   GET    /               -> marketing_get_calendar_view
 *   GET    /posts          -> marketing_list_posts
 *   GET    /brand-voices   -> marketing_list_brand_voices
 *   GET    /pending        -> marketing_list_posts (status: draft)
 *   POST   /generate       -> marketing_generate_content
 *   POST   /:id/reschedule -> marketing_update_post
 *   POST   /posts          -> marketing_create_post
 *   PUT    /posts/:id      -> marketing_update_post
 *   POST   /:id/approve    -> marketing_approve_post
 *   POST   /:id/reject     -> marketing_reject_post
 *   POST   /bulk-approve   -> marketing_bulk_approve
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

/**
 * Extended deps for content calendar router with optional WebSocket broadcast.
 */
export interface ContentCalendarRouterDeps extends McpRouterDeps {
  /** Optional callback for broadcasting approval events via WebSocket */
  broadcastApprovalEvent?: (
    eventType: string,
    data: Record<string, unknown>,
  ) => void;
}

export function createContentCalendarRouter({
  mcpToolClient,
  broadcastApprovalEvent,
}: ContentCalendarRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/content-calendar - Fetch calendar view grouped by period
  router.get(
    "/",
    wrapMcpRoute("get calendar view", async (req, res) => {
      const { start_date, end_date, grouping, platform, status } =
        req.query as Record<string, string | undefined>;

      if (!start_date || !end_date) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_dates",
          message: "start_date and end_date query parameters are required",
        });
        return;
      }

      const args: Record<string, string> = {
        start_date,
        end_date,
        grouping: grouping ?? "month",
      };
      if (platform) args["platform"] = platform;
      if (status) args["status"] = status;

      const result = await mcpToolClient.callTool(
        "marketing_get_calendar_view",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/content-calendar/posts - List posts with optional filters
  router.get(
    "/posts",
    wrapMcpRoute("list posts", async (req, res) => {
      const { platform, status, campaign_id } = req.query as Record<
        string,
        string | undefined
      >;

      const args: Record<string, string> = {};
      if (platform) args["platform"] = platform;
      if (status) args["status"] = status;
      if (campaign_id) args["campaign_id"] = campaign_id;

      const result = await mcpToolClient.callTool(
        "marketing_list_posts",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/content-calendar/brand-voices - List brand voices
  router.get(
    "/brand-voices",
    wrapMcpRoute("list brand voices", async (_req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_list_brand_voices",
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/content-calendar/generate - AI generate content
  router.post(
    "/generate",
    wrapMcpRoute("generate content", async (req, res) => {
      const body = req.body as Record<string, unknown>;

      const result = await mcpToolClient.callTool(
        "marketing_generate_content",
        {
          platform: body.platform,
          brand_voice_id: body.brand_voice_id,
          prompt: body.prompt,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/content-calendar/:id/reschedule - Reschedule a post
  router.post(
    "/:id/reschedule",
    wrapMcpRoute("reschedule post", async (req, res) => {
      const postId = req.params["id"];
      const { scheduled_at } = req.body as { scheduled_at?: string };

      if (!scheduled_at) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_scheduled_at",
          message: "scheduled_at is required in request body",
        });
        return;
      }

      const result = await mcpToolClient.callTool("marketing_update_post", {
        id: postId,
        scheduled_at,
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );


  // POST /api/content-calendar/posts - Create a new post
  router.post(
    "/posts",
    wrapMcpRoute("create post", async (req, res) => {
      const body = req.body as Record<string, unknown>;

      if (!body.content || typeof body.content !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required field: content",
        });
        return;
      }

      if (!body.platform || typeof body.platform !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required field: platform",
        });
        return;
      }

      const result = await mcpToolClient.callTool("marketing_create_post", {
        content: body.content,
        platform: body.platform,
        brand_voice_id: body.brand_voice_id,
        scheduled_at: body.scheduled_at,
        campaign_id: body.campaign_id,
        metadata: body.metadata,
      });

      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // PUT /api/content-calendar/posts/:id - Update a post
  router.put(
    "/posts/:id",
    wrapMcpRoute("update post", async (req, res) => {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      const result = await mcpToolClient.callTool("marketing_update_post", {
        id,
        ...body,
      });

      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // ── Approval Workflow Routes ──────────────────────────────────

  // GET /api/content-calendar/pending - List posts pending approval (status: draft)
  router.get(
    "/pending",
    wrapMcpRoute("list pending posts", async (_req, res) => {
      const result = await mcpToolClient.callTool("marketing_list_posts", {
        status: "draft",
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/content-calendar/bulk-approve - Approve multiple posts
  router.post(
    "/bulk-approve",
    wrapMcpRoute("bulk approve posts", async (req, res) => {
      const body = req.body as { post_ids?: string[]; approved_by?: string };

      if (!Array.isArray(body.post_ids) || body.post_ids.length === 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required field: post_ids",
          message: "post_ids must be a non-empty array of post IDs.",
        });
        return;
      }

      const result = await mcpToolClient.callTool("marketing_bulk_approve", {
        post_ids: body.post_ids,
        approved_by: body.approved_by,
      });

      // Broadcast WebSocket event for each approved post
      const castResult = result as {
        results?: Array<{ id: string; success: boolean }>;
      };
      if (Array.isArray(castResult.results)) {
        for (const r of castResult.results) {
          if (r.success) {
            broadcastApprovalEvent?.("post_approved", { postId: r.id });
          }
        }
      }

      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/content-calendar/:id/approve - Approve a single post
  router.post(
    "/:id/approve",
    wrapMcpRoute("approve post", async (req, res) => {
      const postId = req.params["id"];
      const body = req.body as { approved_by?: string };

      const result = await mcpToolClient.callTool("marketing_approve_post", {
        id: postId,
        approved_by: body.approved_by,
      });

      broadcastApprovalEvent?.("post_approved", { postId, result });

      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/content-calendar/:id/reject - Reject a post
  router.post(
    "/:id/reject",
    wrapMcpRoute("reject post", async (req, res) => {
      const postId = req.params["id"];
      const body = req.body as { rejection_reason?: string };

      if (!body.rejection_reason || body.rejection_reason.trim().length === 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required field: rejection_reason",
          message:
            "A rejection reason must be provided when rejecting a post.",
        });
        return;
      }

      const result = await mcpToolClient.callTool("marketing_reject_post", {
        id: postId,
        rejection_reason: body.rejection_reason,
      });

      broadcastApprovalEvent?.("post_rejected", {
        postId,
        reason: body.rejection_reason,
        result,
      });

      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  return router;
}
