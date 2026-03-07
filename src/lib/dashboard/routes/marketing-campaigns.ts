/**
 * Marketing Campaigns Router
 * REST API endpoints for cross-platform campaign management.
 * All operations proxy through McpToolClient -> mcp-proxy -> marketing-mcp.
 *
 * Route map:
 *   GET    /                -> marketing_list_campaigns
 *   POST   /                -> marketing_create_campaign
 *   GET    /:id             -> marketing_get_campaign
 *   PATCH  /:id             -> marketing_update_campaign
 *   GET    /:id/analytics   -> marketing_get_campaign_analytics
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

export function createMarketingCampaignsRouter({
  mcpToolClient,
}: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/marketing/campaigns - List campaigns with optional filters
  router.get(
    "/",
    wrapMcpRoute("list campaigns", async (req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_list_campaigns",
        {
          status: req.query["status"] as string | undefined,
          start_date: req.query["start_date"] as string | undefined,
          end_date: req.query["end_date"] as string | undefined,
          platform: req.query["platform"] as string | undefined,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/marketing/campaigns - Create a new campaign
  router.post(
    "/",
    wrapMcpRoute("create campaign", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["name"] || !body["platforms"]) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_fields",
          message: "name and platforms are required",
        });
        return;
      }
      const result = await mcpToolClient.callTool(
        "marketing_create_campaign",
        body,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/marketing/campaigns/:id - Get a single campaign with linked posts
  router.get(
    "/:id",
    wrapMcpRoute("get campaign", async (req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_get_campaign",
        {
          id: req.params["id"],
          include_posts: true,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // PATCH /api/marketing/campaigns/:id - Update campaign fields and/or status
  router.patch(
    "/:id",
    wrapMcpRoute("update campaign", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await mcpToolClient.callTool(
        "marketing_update_campaign",
        {
          id: req.params["id"],
          ...body,
        },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/marketing/campaigns/:id/analytics - Get aggregate campaign metrics
  router.get(
    "/:id/analytics",
    wrapMcpRoute("get campaign analytics", async (req, res) => {
      const result = await mcpToolClient.callTool(
        "marketing_get_campaign_analytics",
        { id: req.params["id"] },
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  return router;
}
