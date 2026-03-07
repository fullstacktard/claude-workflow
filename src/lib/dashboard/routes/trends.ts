/**
 * Trends Router
 * REST API endpoints for trending topics and viral tweet discovery.
 * All operations proxy through McpToolClient -> mcp-proxy -> x-research-mcp.
 *
 * Route map:
 *   GET /           -> xr_get_trending_topics
 *   GET /viral      -> xr_find_reply_targets (high engagement threshold)
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

/** Check if an MCP error is an auth/credential failure (stale cookies etc.) */
function isAuthError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /invalid auth|authentication|unauthorized|cookie/i.test(msg);
}

/** Check if an MCP error is a service unavailability (missing API keys, GraphQL down, etc.) */
function isServiceUnavailable(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /unavailable|not configured|not found|no provider/i.test(msg);
}

export function createTrendsRouter({ mcpToolClient }: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/trends - Current trending topics
  // Maps MCP response fields to Trend shape expected by frontend
  router.get(
    "/",
    wrapMcpRoute("get trending topics", async (_req, res) => {
      try {
        const result = await mcpToolClient.callTool<Record<string, unknown>>(
          "xr_get_trending_topics",
        );
        // MCP returns {topics: [{name, description, domain, tweet_count, url}], count, source}
        // Frontend expects Trend[]: {id, name, tweetVolume, volumeChangePercent, volumeHistory, category, updatedAt}
        const raw = result as Record<string, unknown> | null;
        const topics = Array.isArray(raw?.["topics"])
          ? (raw["topics"] as Record<string, unknown>[])
          : Array.isArray(raw)
            ? (raw as Record<string, unknown>[])
            : [];
        const now = new Date().toISOString();
        const trends = topics.map((t, i) => ({
          id: (t["id"] as string) ?? `trend-${String(i)}`,
          name: (t["name"] as string) ?? "Unknown",
          tweetVolume:
            typeof t["tweet_count"] === "number" ? t["tweet_count"] : null,
          volumeChangePercent: 0,
          volumeHistory: [] as number[],
          category: (t["domain"] as string) ?? null,
          updatedAt: now,
        }));
        res.status(HTTP_STATUS_OK).json({ trends });
      } catch (err) {
        if (isAuthError(err)) {
          // Auth failure — return empty instead of erroring the whole page
          res.status(HTTP_STATUS_OK).json({
            trends: [],
            _auth_error: true,
            _message: "X session expired — refresh cookies to restore trends",
          });
          return;
        }
        if (isServiceUnavailable(err)) {
          res.status(HTTP_STATUS_OK).json({
            trends: [],
            _service_unavailable: true,
            _message: "Trends service is not available",
          });
          return;
        }
        throw err;
      }
    }),
  );

  // GET /api/trends/viral - Viral tweets (high engagement reply targets)
  // Maps MCP response fields to ViralTweet shape expected by frontend
  router.get(
    "/viral",
    wrapMcpRoute("get viral tweets", async (req, res) => {
      const args: Record<string, unknown> = {
        min_engagement: Number(req.query["min_engagement"]) || 1000,
      };
      if (req.query["topic"]) args["topic"] = req.query["topic"];
      if (req.query["limit"]) args["limit"] = Number(req.query["limit"]);
      try {
        const result = await mcpToolClient.callTool(
          "xr_find_reply_targets",
          args,
        );
        // MCP may return raw tweet objects — map to ViralTweet shape
        const raw = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
        const viral = raw.map((t) => ({
          id: (t["id"] as string) ?? (t["tweet_id"] as string) ?? "",
          text: (t["text"] as string) ?? (t["full_text"] as string) ?? "",
          authorHandle: (t["authorHandle"] as string) ?? (t["author_handle"] as string) ?? (t["username"] as string) ?? "",
          authorName: (t["authorName"] as string) ?? (t["author_name"] as string) ?? (t["display_name"] as string) ?? "",
          likes: (t["likes"] as number) ?? (t["like_count"] as number) ?? 0,
          retweets: (t["retweets"] as number) ?? (t["retweet_count"] as number) ?? 0,
          replies: (t["replies"] as number) ?? (t["reply_count"] as number) ?? 0,
          createdAt: (t["createdAt"] as string) ?? (t["created_at"] as string) ?? new Date().toISOString(),
          relatedTrend: (t["relatedTrend"] as string) ?? (t["related_trend"] as string) ?? null,
        }));
        res.status(HTTP_STATUS_OK).json({ viral });
      } catch (err) {
        if (isAuthError(err)) {
          res.status(HTTP_STATUS_OK).json({
            viral: [],
            _auth_error: true,
            _message: "X session expired — refresh cookies to restore trends",
          });
          return;
        }
        if (isServiceUnavailable(err)) {
          res.status(HTTP_STATUS_OK).json({
            viral: [],
            _service_unavailable: true,
            _message: "Viral tweets service is not available — configure SOCIALDATA_API_KEY to enable",
          });
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}
