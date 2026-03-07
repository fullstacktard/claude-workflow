/**
 * Personas Router
 * REST API endpoints for persona management and tweet generation.
 * All operations proxy through McpToolClient -> mcp-proxy -> x-persona-mcp.
 *
 * Route map:
 *   GET    /                    -> xp_list_personas
 *   GET    /:id                 -> xp_get_persona
 *   POST   /                    -> xp_create_persona
 *   PUT    /:id                 -> xp_update_persona
 *   DELETE /:id                 -> xp_delete_persona
 *   POST   /:id/generate        -> xp_generate_tweet
 *   POST   /:id/link            -> xp_update_persona (add account association)
 *   DELETE /:id/link/:accountId -> xp_update_persona (remove account association)
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

export function createPersonasRouter({ mcpToolClient }: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/personas - List all personas
  // Maps MCP response fields to DashboardPersona shape expected by frontend
  router.get(
    "/",
    wrapMcpRoute("list personas", async (_req, res) => {
      const result = await mcpToolClient.callTool<
        Array<Record<string, unknown>>
      >("xp_list_personas");
      const raw = Array.isArray(result) ? result : [];
      const personas = raw.map((p) => ({
        id: p.id as string,
        name: p.name as string,
        bio: Array.isArray(p.bio) ? (p.bio as string[])[0] ?? "" : (p.bio as string) ?? "",
        topicCount: Array.isArray(p.topics) ? (p.topics as string[]).length : 0,
        linkedAccountIds: (p.account_ids as string[]) ?? [],
        status: (p.status as string) ?? "draft",
        created_at: (p.created_at as string) ?? new Date().toISOString(),
        updated_at: (p.updated_at as string) ?? (p.created_at as string) ?? new Date().toISOString(),
      }));
      res.status(HTTP_STATUS_OK).json({ personas });
    }),
  );

  // GET /api/personas/:id - Get persona details
  router.get(
    "/:id",
    wrapMcpRoute("get persona", async (req, res) => {
      const result = await mcpToolClient.callTool("xp_get_persona", {
        persona_id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/personas - Create persona
  router.post(
    "/",
    wrapMcpRoute("create persona", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["name"] || typeof body["name"] !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_name",
          message: "name is required",
        });
        return;
      }
      // Sanitize bio: filter out empty strings that fail MCP validation
      if (Array.isArray(body["bio"])) {
        const filtered = (body["bio"] as string[]).filter((s) => s.length > 0);
        body["bio"] = filtered.length > 0 ? filtered : "No bio yet";
      } else if (!body["bio"]) {
        body["bio"] = "No bio yet";
      }
      const result = await mcpToolClient.callTool("xp_create_persona", {
        character: body,
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // PUT /api/personas/:id - Update persona
  router.put(
    "/:id",
    wrapMcpRoute("update persona", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await mcpToolClient.callTool("xp_update_persona", {
        persona_id: req.params["id"],
        ...body,
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // DELETE /api/personas/:id - Delete persona
  router.delete(
    "/:id",
    wrapMcpRoute("delete persona", async (req, res) => {
      const result = await mcpToolClient.callTool("xp_delete_persona", {
        persona_id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/personas/:id/generate - Generate tweets for persona
  router.post(
    "/:id/generate",
    wrapMcpRoute("generate tweet", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const mcpArgs: Record<string, unknown> = {
        persona_id: req.params["id"],
        count: body["count"] ?? 3,
      };
      if (body["topic"] && typeof body["topic"] === "string") {
        mcpArgs["topic"] = body["topic"];
      }
      const result = (await mcpToolClient.callTool(
        "xp_generate_tweet",
        mcpArgs,
      )) as Record<string, unknown>;

      // Normalize MCP response shape → { tweets: string[] }
      // MCP returns { draft, all_candidates: [{text,...},...], usage }
      if (Array.isArray(result["all_candidates"])) {
        const candidates = result["all_candidates"] as Array<
          Record<string, unknown>
        >;
        const tweets = candidates
          .map((c) => c["text"] as string)
          .filter(Boolean);
        res.status(HTTP_STATUS_OK).json({ tweets });
      } else if (typeof result["draft"] === "string") {
        res
          .status(HTTP_STATUS_OK)
          .json({ tweets: [result["draft"] as string] });
      } else {
        res.status(HTTP_STATUS_OK).json({ tweets: [] });
      }
    }),
  );

  // POST /api/personas/:id/link - Associate X account with persona
  router.post(
    "/:id/link",
    wrapMcpRoute("link account to persona", async (req, res) => {
      const { account_id } = req.body as { account_id?: string };
      if (!account_id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_account_id",
          message: "account_id is required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("xp_update_persona", {
        persona_id: req.params["id"],
        link_account_id: account_id,
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // DELETE /api/personas/:id/link/:accountId - Dissociate X account from persona
  router.delete(
    "/:id/link/:accountId",
    wrapMcpRoute("unlink account from persona", async (req, res) => {
      const result = await mcpToolClient.callTool("xp_update_persona", {
        persona_id: req.params["id"],
        unlink_account_id: req.params["accountId"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  return router;
}
