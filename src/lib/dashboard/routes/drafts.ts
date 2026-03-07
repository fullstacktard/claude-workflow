/**
 * Drafts Router
 * REST API endpoints for draft queue management.
 * Most operations proxy through McpToolClient -> mcp-proxy -> x-persona-mcp.
 * The publish endpoint orchestrates across x-persona-mcp and x-client-mcp.
 *
 * Route map:
 *   GET    /                  -> xp_list_drafts (with filters)
 *   GET    /:id               -> xp_get_draft
 *   PUT    /:id               -> xp_update_draft
 *   POST   /:id/approve       -> xp_approve_draft
 *   POST   /:id/reject        -> xp_reject_draft
 *   POST   /:id/publish       -> orchestrated: xp_get_draft + x_post_tweet + xp_mark_published
 *   POST   /batch             -> batch approve/reject
 */

import type { Router } from "express-serve-static-core";
import express from "express";

import {
  wrapMcpRoute,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

/** Shape returned by xp_get_draft */
interface DraftDetail {
  id: string;
  text: string;
  persona_id: string;
  account_id?: string;
  status: string;
  [key: string]: unknown;
}

export function createDraftsRouter({ mcpToolClient }: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // POST /api/drafts/batch - Batch approve or reject drafts
  // Registered before /:id routes so "batch" is not captured as a param
  router.post(
    "/batch",
    wrapMcpRoute("batch draft operation", async (req, res) => {
      const { action, ids } = req.body as {
        action?: string;
        ids?: string[];
      };

      // Validate action
      if (!action || (action !== "approve" && action !== "reject")) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "invalid_action",
          message: 'action must be "approve" or "reject"',
        });
        return;
      }

      // Validate ids is a non-empty array
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "invalid_ids",
          message: "ids must be a non-empty array of draft IDs",
        });
        return;
      }

      // Validate all ids are strings
      if (!ids.every((id) => typeof id === "string")) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "invalid_ids",
          message: "all ids must be strings",
        });
        return;
      }

      const toolName =
        action === "approve" ? "xp_approve_draft" : "xp_reject_draft";

      const results: Array<{
        id: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const draftId of ids) {
        try {
          await mcpToolClient.callTool(toolName, { draft_id: draftId });
          results.push({ id: draftId, success: true });
        } catch (error) {
          results.push({
            id: draftId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      res.status(HTTP_STATUS_OK).json({
        action,
        total: ids.length,
        succeeded,
        failed,
        results,
      });
    }),
  );

  // GET /api/drafts - List drafts with optional filters
  // Maps MCP response fields to Draft shape expected by frontend
  router.get(
    "/",
    wrapMcpRoute("list drafts", async (req, res) => {
      const args: Record<string, unknown> = {};
      // Map frontend status "pending" to MCP statuses
      const statusParam = req.query["status"] as string | undefined;
      if (statusParam && statusParam !== "all") {
        args["status"] = statusParam === "pending" ? "generated" : statusParam;
      }
      if (req.query["persona_id"]) args["persona_id"] = req.query["persona_id"];
      if (req.query["limit"]) args["limit"] = Number(req.query["limit"]);
      const result = await mcpToolClient.callTool<
        Array<Record<string, unknown>>
      >("xp_list_drafts", args);
      const raw = Array.isArray(result) ? result : [];
      const drafts = raw.map((d) => {
        // Map MCP status to frontend status
        const mcpStatus = d.status as string;
        let status: string;
        if (mcpStatus === "generated" || mcpStatus === "pending_review") {
          status = "pending";
        } else {
          status = mcpStatus;
        }
        // Parse scores
        let scores: Record<string, number> = {};
        try {
          if (typeof d.scores_json === "string") {
            scores = JSON.parse(d.scores_json) as Record<string, number>;
          }
        } catch { /* ignore */ }
        return {
          id: d.id as string,
          personaId: (d.persona_id as string) ?? "",
          personaName: (d.persona_name as string) ?? "",
          targetAccountHandle: (d.published_account_id as string) ?? "",
          targetAccountId: (d.published_account_id as string) ?? "",
          text: (d.content as string) ?? (d.text as string) ?? "",
          status,
          generation: {
            model: "claude-sonnet-4-20250514",
            temperature: 0.9,
            qualityScore: scores.persona_match ?? 0,
            promptContext: (d.reasoning as string) ?? null,
          },
          scheduledAt: null,
          tweetId: (d.published_tweet_id as string) ?? null,
          createdAt: (d.created_at as string) ?? new Date().toISOString(),
          updatedAt: (d.updated_at as string) ?? (d.created_at as string) ?? new Date().toISOString(),
        };
      });
      res.status(HTTP_STATUS_OK).json({ drafts });
    }),
  );

  // GET /api/drafts/:id - Get draft details
  router.get(
    "/:id",
    wrapMcpRoute("get draft", async (req, res) => {
      const result = await mcpToolClient.callTool("xp_get_draft", {
        draft_id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // PUT /api/drafts/:id - Edit draft text
  router.put(
    "/:id",
    wrapMcpRoute("update draft", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      if (!body["text"] || typeof body["text"] !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "missing_text",
          message: "text is required",
        });
        return;
      }
      const result = await mcpToolClient.callTool("xp_update_draft", {
        draft_id: req.params["id"],
        text: body["text"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/drafts/:id/approve - Approve a draft
  router.post(
    "/:id/approve",
    wrapMcpRoute("approve draft", async (req, res) => {
      const result = await mcpToolClient.callTool("xp_approve_draft", {
        draft_id: req.params["id"],
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/drafts/:id/reject - Reject a draft with optional reason
  router.post(
    "/:id/reject",
    wrapMcpRoute("reject draft", async (req, res) => {
      const { reason } = req.body as { reason?: string };
      const result = await mcpToolClient.callTool("xp_reject_draft", {
        draft_id: req.params["id"],
        ...(reason ? { reason } : {}),
      });
      res.status(HTTP_STATUS_OK).json(result);
    }),
  );

  // POST /api/drafts/:id/publish - Publish draft to X (multi-step orchestration)
  // Step 1: Get draft details (text, account_id)
  // Step 2: Post tweet via x_post_tweet
  // Step 3: Mark draft as published via xp_mark_published
  // On tweet post failure: error propagates via wrapMcpRoute (draft unchanged)
  // On mark-published failure after tweet posted: log warning, return success
  //   (tweet is already live, marking failure is non-critical)
  router.post(
    "/:id/publish",
    wrapMcpRoute("publish draft", async (req, res) => {
      const draftId = String(req.params["id"]);

      // Step 1: Get the draft to retrieve text and target account
      const draft = await mcpToolClient.callTool<DraftDetail>("xp_get_draft", {
        draft_id: draftId,
      });

      if (!draft?.text) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "invalid_draft",
          message: "Draft has no text content",
        });
        return;
      }

      if (!draft.account_id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "no_account",
          message: "Draft has no associated X account for publishing",
        });
        return;
      }

      // Step 2: Post the tweet via x-client-mcp
      const tweetResult = await mcpToolClient.callTool<{
        tweet_id?: string;
        [key: string]: unknown;
      }>("x_post_tweet", {
        account_id: draft.account_id,
        text: draft.text,
      });

      // Step 3: Mark the draft as published
      // If this fails, the tweet is already live -- log warning but return success
      try {
        await mcpToolClient.callTool("xp_mark_published", {
          draft_id: draftId,
          tweet_id: tweetResult?.tweet_id,
        });
      } catch (markError) {
        console.warn(
          `[drafts] Draft ${draftId} tweet posted but mark_published failed:`,
          markError instanceof Error ? markError.message : "unknown error",
        );
      }

      res.status(HTTP_STATUS_OK).json({
        published: true,
        draft_id: draftId,
        tweet_id: tweetResult?.tweet_id,
        account_id: draft.account_id,
      });
    }),
  );

  return router;
}
