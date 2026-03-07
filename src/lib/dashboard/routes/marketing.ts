/**
 * Marketing Router
 * REST API endpoints for marketing competitor and brand voice management.
 * All operations proxy through McpToolClient -> mcp-proxy -> marketing-mcp.
 *
 * Route map:
 *   GET    /competitors                 -> marketing_list_competitors
 *   POST   /competitors                 -> marketing_add_competitor
 *   DELETE /competitors/:id             -> marketing_remove_competitor
 *   POST   /competitors/scrape-all      -> marketing_scrape_all_competitors
 *   POST   /competitors/:handle/scrape  -> marketing_scrape_competitor
 *
 *   GET    /brand-voices                -> marketing_list_brand_voices
 *   POST   /brand-voices                -> marketing_create_brand_voice
 *   GET    /brand-voices/:id            -> marketing_get_brand_voice
 *   PUT    /brand-voices/:id            -> marketing_update_brand_voice
 *   DELETE /brand-voices/:id            -> marketing_delete_brand_voice
 *
 *   POST   /generate-content            -> marketing_generate_content
 *   POST   /preview-content             -> marketing_preview_content
 *   POST   /refine-content              -> marketing_refine_content
 *
 *   POST   /email/webhook               -> marketing_process_email_webhook
 *
 *   GET    /linkedin/callback           -> marketing_linkedin_callback (OAuth redirect)
 *   GET    /linkedin/status             -> marketing_linkedin_get_status
 *   POST   /linkedin/connect            -> marketing_linkedin_connect
 *   POST   /linkedin/post               -> marketing_linkedin_post
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

export function createMarketingRouter({ mcpToolClient }: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/marketing/competitors - List all competitors
  router.get(
    "/competitors",
    wrapMcpRoute("list competitors", async (_req, res) => {
      const result = await mcpToolClient.callTool("marketing_list_competitors");
      res.status(HTTP_STATUS_OK).json({ competitors: result ?? [] });
    }),
  );

  // POST /api/marketing/competitors - Add a competitor
  router.post(
    "/competitors",
    wrapMcpRoute("add competitor", async (req, res) => {
      const { handle, category, notes } = req.body as {
        handle?: string;
        category?: string;
        notes?: string;
      };
      if (!handle) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_handle",
          message: "handle is required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("marketing_add_competitor", {
        handle,
        category: category ?? "direct_competitor",
        notes: notes ?? "",
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/competitors/scrape-all - Scrape all competitors
  // MUST be before /:handle/scrape to avoid treating "scrape-all" as a handle
  router.post(
    "/competitors/scrape-all",
    wrapMcpRoute("scrape all competitors", async (_req, res) => {
      const result = await mcpToolClient.callTool("marketing_scrape_all_competitors");
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // DELETE /api/marketing/competitors/:id - Remove a competitor
  router.delete(
    "/competitors/:id",
    wrapMcpRoute("remove competitor", async (req, res) => {
      const result = await mcpToolClient.callTool("marketing_remove_competitor", {
        id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/competitors/:handle/scrape - Scrape a single competitor
  router.post(
    "/competitors/:handle/scrape",
    wrapMcpRoute("scrape competitor", async (req, res) => {
      const result = await mcpToolClient.callTool("marketing_scrape_competitor", {
        handle: req.params["handle"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );


  // ==================== Brand Voice Routes ====================

  // GET /api/marketing/brand-voices - List all brand voices (summary)
  router.get(
    "/brand-voices",
    wrapMcpRoute("list brand voices", async (_req, res) => {
      const result = await mcpToolClient.callTool("marketing_list_brand_voices");
      res.status(HTTP_STATUS_OK).json({ voices: result ?? [] });
    }),
  );

  // POST /api/marketing/brand-voices - Create a brand voice
  router.post(
    "/brand-voices",
    wrapMcpRoute("create brand voice", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["name"] || typeof body["name"] !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_name",
          message: "name is required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("marketing_create_brand_voice", body);
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/marketing/brand-voices/:id - Get full brand voice config
  router.get(
    "/brand-voices/:id",
    wrapMcpRoute("get brand voice", async (req, res) => {
      const result = await mcpToolClient.callTool("marketing_get_brand_voice", {
        id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // PUT /api/marketing/brand-voices/:id - Update brand voice
  router.put(
    "/brand-voices/:id",
    wrapMcpRoute("update brand voice", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await mcpToolClient.callTool("marketing_update_brand_voice", {
        ...body,
        id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // DELETE /api/marketing/brand-voices/:id - Delete brand voice
  router.delete(
    "/brand-voices/:id",
    wrapMcpRoute("delete brand voice", async (req, res) => {
      const result = await mcpToolClient.callTool("marketing_delete_brand_voice", {
        id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // ==================== Content Generation Routes ====================

  // POST /api/marketing/generate-content - Generate content with brand voice
  router.post(
    "/generate-content",
    wrapMcpRoute("generate content", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["topic"] || !body["platform"] || !body["brand_voice_id"]) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_fields",
          message: "topic, platform, and brand_voice_id are required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("marketing_generate_content", body);
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/preview-content - Generate content variations
  router.post(
    "/preview-content",
    wrapMcpRoute("preview content", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["topic"] || !body["platform"] || !body["brand_voice_id"]) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_fields",
          message: "topic, platform, and brand_voice_id are required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("marketing_preview_content", body);
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/refine-content - Refine existing content
  router.post(
    "/refine-content",
    wrapMcpRoute("refine content", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["content"] || !body["platform"] || !body["brand_voice_id"] || !body["instructions"]) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_fields",
          message: "content, platform, brand_voice_id, and instructions are required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("marketing_refine_content", body);
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // ==================== Email Webhook Routes ====================

  // POST /api/marketing/email/webhook - Receive Resend webhook events
  router.post(
    "/email/webhook",
    wrapMcpRoute("Resend webhook", async (req, res) => {
      const event = req.body as {
        type: string;
        created_at: string;
        data: {
          email_id: string;
          from: string;
          to: string[];
          subject: string;
          created_at: string;
        };
      };

      if (!event.type || !event.data?.email_id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "invalid_webhook",
          message: "Missing event type or email_id in webhook payload",
        });
        return;
      }

      const result = await mcpToolClient.callTool(
        "marketing_process_email_webhook",
        {
          event_type: event.type,
          email_id: event.data.email_id,
          timestamp: event.created_at,
          from: event.data.from,
          to: event.data.to,
          subject: event.data.subject,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // ==================== LinkedIn OAuth & Posting Routes ====================

  // GET /api/marketing/linkedin/callback - OAuth redirect handler
  router.get(
    "/linkedin/callback",
    wrapMcpRoute("LinkedIn OAuth callback", async (req, res) => {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "LinkedIn OAuth error",
          message: oauthError as string,
        });
        return;
      }

      if (!code || !state) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_parameters",
          message:
            "OAuth callback requires 'code' and 'state' query parameters",
        });
        return;
      }

      const result = await mcpToolClient.callTool(
        "marketing_linkedin_callback",
        {
          code: code as string,
          state: state as string,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/marketing/linkedin/status - Connection status
  router.get(
    "/linkedin/status",
    wrapMcpRoute("LinkedIn connection status", async (_req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_linkedin_get_status",
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/linkedin/connect - Start OAuth flow
  router.post(
    "/linkedin/connect",
    wrapMcpRoute("start LinkedIn OAuth", async (req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_linkedin_connect",
        req.body as Record<string, unknown>,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/linkedin/post - Publish to LinkedIn
  router.post(
    "/linkedin/post",
    wrapMcpRoute("post to LinkedIn", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["account_id"] || !body["text"]) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_fields",
          message: "account_id and text are required",
        });
        return;
      }
      const result = await mcpToolClient.callTool(
        "marketing_linkedin_post",
        body,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  return router;
}
