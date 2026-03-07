/**
 * Analytics Router
 * REST API endpoints for engagement analytics.
 * All operations proxy through McpToolClient -> mcp-proxy -> marketing-mcp.
 *
 * Route map:
 *   GET  /stats           -> marketing_get_engagement_stats
 *   GET  /top-posts       -> marketing_get_top_posts
 *   GET  /insights        -> marketing_get_posting_insights
 *   GET  /benchmarks      -> marketing_get_competitor_benchmarks
 *   POST /record          -> marketing_record_engagement
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

export function createAnalyticsRouter({
  mcpToolClient,
}: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/analytics/stats - Aggregate engagement statistics
  router.get(
    "/stats",
    wrapMcpRoute("get engagement stats", async (req, res) => {
      const { days, platform } = req.query as Record<
        string,
        string | undefined
      >;

      const args: Record<string, string | number> = {};
      if (days) args["days"] = Number(days);
      if (platform) args["platform"] = platform;

      const result = await mcpToolClient.callTool(
        "marketing_get_engagement_stats",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/analytics/top-posts - Top performing posts by weighted score
  router.get(
    "/top-posts",
    wrapMcpRoute("get top posts", async (req, res) => {
      const { limit, days, platform } = req.query as Record<
        string,
        string | undefined
      >;

      const args: Record<string, string | number> = {};
      if (limit) args["limit"] = Number(limit);
      if (days) args["days"] = Number(days);
      if (platform) args["platform"] = platform;

      const result = await mcpToolClient.callTool(
        "marketing_get_top_posts",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/analytics/insights - Posting insights (best days, hours, content types)
  router.get(
    "/insights",
    wrapMcpRoute("get posting insights", async (req, res) => {
      const { days, platform } = req.query as Record<
        string,
        string | undefined
      >;

      const args: Record<string, string | number> = {};
      if (days) args["days"] = Number(days);
      if (platform) args["platform"] = platform;

      const result = await mcpToolClient.callTool(
        "marketing_get_posting_insights",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // GET /api/analytics/benchmarks - Competitor benchmarks
  router.get(
    "/benchmarks",
    wrapMcpRoute("get competitor benchmarks", async (req, res) => {
      const { days, competitor_ids } = req.query as Record<
        string,
        string | undefined
      >;

      const args: Record<string, unknown> = {};
      if (days) args["days"] = Number(days);
      if (competitor_ids) args["competitor_ids"] = competitor_ids.split(",");

      const result = await mcpToolClient.callTool(
        "marketing_get_competitor_benchmarks",
        args,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/analytics/record - Record engagement data for a post
  router.post(
    "/record",
    wrapMcpRoute("record engagement", async (req, res) => {
      const body = req.body as Record<string, unknown>;

      if (!body.post_id || typeof body.post_id !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required field: post_id",
        });
        return;
      }

      const result = await mcpToolClient.callTool(
        "marketing_record_engagement",
        body,
      );
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  return router;
}
