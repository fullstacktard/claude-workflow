/**
 * Email Accounts Router
 * REST API endpoints for email account management:
 * - List accounts (with DashboardEmailAccount DTO sanitization)
 * - Get account details (password stripped)
 * - Reveal password (rate-limited)
 * - Read inbox (30-second cache)
 * - Check health
 * - Create account (async job)
 * - Check job status
 * - Delete account
 *
 * All operations proxy through McpToolClient -> mcp-proxy -> email-provisioner-mcp (stdio).
 * Security policy: docs/research/email-dashboard-security-sanitization.md
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import type {
  DashboardEmailMessage,
  EmailCheckHealthResponse,
  EmailCreateAccountResponse,
  EmailDeleteAccountResponse,
  EmailJobStatus,
  InboxResponse,
  RawEmailGetAccountResponse,
  RawEmailInboxMessage,
  RawEmailListItem,
  RawEmailReadInboxResponse,
} from "../types/email-dashboard.js";
import {
  toSafeDashboardEmailAccount,
  toSafeDashboardMessage,
} from "../types/email-dashboard.js";
import type { RawEmailListResponse } from "../types/email-dashboard.js";
import {
  handleMcpError,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
  McpToolError,
} from "./shared/mcp-error-handler.js";
import type { McpRouterDeps } from "./shared/mcp-error-handler.js";

// ============================================================================
// Constants
// ============================================================================

const MCP_TIMEOUT_MS = 30_000;
const INBOX_TIMEOUT_MS = 90_000; // Inbox reads need longer: HTTP login → browser fallback
const INBOX_CACHE_TTL_MS = 30_000;
const INBOX_ERROR_CACHE_TTL_MS = 60_000; // Cache errors for 60s to avoid hammering dead accounts
const REVEAL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const REVEAL_RATE_LIMIT_MAX = 5;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

// ============================================================================
// In-memory caches
// ============================================================================

interface CachedInbox {
  response: InboxResponse;
  fetched_at_ms: number;
}

interface CachedInboxError {
  error: string;
  message: string;
  status: number;
  fetched_at_ms: number;
}

const inboxCache = new Map<string, CachedInbox>();
const inboxErrorCache = new Map<string, CachedInboxError>();

interface RevealWindow {
  count: number;
  window_start: number;
}

const revealRateLimit = new Map<string, RevealWindow>();

interface CachedHealthResult {
  healthy: boolean;
  error?: string;
  checked_at: string;
}

const healthCache = new Map<string, CachedHealthResult>();

// ============================================================================
// Router factory
// ============================================================================

/**
 * Create email accounts router with dependencies.
 *
 * Route map:
 *   GET    /                       -> email_list_accounts
 *   POST   /                       -> email_create_account
 *   GET    /jobs/:jobId            -> email_check_job_status
 *   GET    /:id                    -> email_get_account (password stripped)
 *   POST   /:id/reveal-password    -> email_get_account (password only, rate-limited)
 *   GET    /:id/inbox              -> email_read_inbox (30s cache)
 *   POST   /:id/health             -> email_check_health
 *   DELETE /:id                    -> email_delete_account
 */
export function createEmailAccountsRouter({
  mcpToolClient,
}: McpRouterDeps): Router {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const router: Router = express.Router() as Router;

  // --------------------------------------------------------------------------
  // GET /api/email-accounts - List all email accounts (sanitized)
  // --------------------------------------------------------------------------
  router.get("/", (req: Request, res: Response): void => {
    const handleList = async (): Promise<void> => {
      try {
        const providerFilter = req.query.provider as string | undefined;
        const args: Record<string, unknown> = {};
        if (providerFilter === "mail.com" || providerFilter === "gmx.com") {
          args.provider = providerFilter;
        }
        const raw = await mcpToolClient.callTool<RawEmailListResponse>(
          "email_list_accounts",
          args,
          MCP_TIMEOUT_MS,
        );
        // email_list_accounts returns { total, accounts: [...] } not a flat array
        let rawList: (RawEmailGetAccountResponse | RawEmailListItem)[];
        if (Array.isArray(raw)) {
          rawList = raw as (RawEmailGetAccountResponse | RawEmailListItem)[];
        } else if (Array.isArray(raw?.accounts)) {
          rawList = raw.accounts;
        } else {
          rawList = [];
        }
        const accounts = rawList.map((item) => {
          const safe = toSafeDashboardEmailAccount(item);
          // Enrich with cached health data if available
          const cached = healthCache.get(safe.id);
          if (cached) {
            safe.health_status = cached.healthy ? "healthy" : "unhealthy";
            safe.last_health_check_at = cached.checked_at;
          }
          return safe;
        });
        res.status(HTTP_STATUS_OK).json({ accounts });
      } catch (error) {
        handleMcpError(res, error, "list email accounts");
      }
    };
    void handleList();
  });

  // --------------------------------------------------------------------------
  // POST /api/email-accounts - Create a new email account (async)
  // --------------------------------------------------------------------------
  router.post("/", (req: Request, res: Response): void => {
    const handleCreate = async (): Promise<void> => {
      try {
        const body = req.body as Record<string, unknown>;
        // All fields are optional for email_create_account
        const args: Record<string, unknown> = {};
        if (body.provider && typeof body.provider === "string") {
          if (body.provider !== "mail.com" && body.provider !== "gmx.com") {
            res.status(HTTP_STATUS_BAD_REQUEST).json({
              error: "Invalid provider",
              message: 'provider must be "mail.com" or "gmx.com"',
            });
            return;
          }
          args.provider = body.provider;
        }
        if (body.first_name && typeof body.first_name === "string")
          args.first_name = body.first_name;
        if (body.last_name && typeof body.last_name === "string")
          args.last_name = body.last_name;
        if (
          body.preferred_username &&
          typeof body.preferred_username === "string"
        )
          args.preferred_username = body.preferred_username;
        if (body.preferred_domain && typeof body.preferred_domain === "string")
          args.preferred_domain = body.preferred_domain;
        if (body.password && typeof body.password === "string")
          args.password = body.password;
        if (body.proxy_country && typeof body.proxy_country === "string")
          args.proxy_country = body.proxy_country;

        const result =
          await mcpToolClient.callTool<EmailCreateAccountResponse>(
            "email_create_account",
            args,
            MCP_TIMEOUT_MS,
          );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "create email account");
      }
    };
    void handleCreate();
  });

  // --------------------------------------------------------------------------
  // GET /api/email-accounts/jobs/:jobId - Check async job status
  // IMPORTANT: This route MUST be registered before /:id to avoid conflict.
  // --------------------------------------------------------------------------
  router.get("/jobs/:jobId", (req: Request, res: Response): void => {
    const handleJobStatus = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool<EmailJobStatus>(
          "email_check_job_status",
          { job_id: req.params.jobId },
          MCP_TIMEOUT_MS,
        );

        // Strip password from completed job result
        // Discriminated union: status==="completed" narrows to EmailJobStatusCompleted
        if (
          result &&
          typeof result === "object" &&
          "status" in result &&
          result.status === "completed" &&
          result.result?.password
        ) {
          // Create a sanitized copy without password using omit
          const { password, ...safeResultFields } = result.result;
          void password; // consumed but intentionally discarded
          const sanitized = {
            ...result,
            result: safeResultFields,
          };
          res.status(HTTP_STATUS_OK).json(sanitized);
          return;
        }

        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        // email_check_job_status throws McpToolError for failed jobs
        // (isError flag). We still want to return the error info to
        // the frontend, not a 502.
        if (error instanceof McpToolError && error.code === -1) {
          // Tool-level error (failed job). Return the error details.
          res.status(HTTP_STATUS_OK).json({
            status: "failed",
            error: error.message,
          });
          return;
        }
        handleMcpError(res, error, "check job status");
      }
    };
    void handleJobStatus();
  });

  // --------------------------------------------------------------------------
  // GET /api/email-accounts/:id - Get account details (password stripped)
  // --------------------------------------------------------------------------
  router.get("/:id", (req: Request, res: Response): void => {
    const handleGetAccount = async (): Promise<void> => {
      try {
        const raw = await mcpToolClient.callTool<RawEmailGetAccountResponse>(
          "email_get_account",
          { account_id: req.params.id },
          MCP_TIMEOUT_MS,
        );
        const safe = toSafeDashboardEmailAccount(raw);
        res.status(HTTP_STATUS_OK).json(safe);
      } catch (error) {
        handleMcpError(res, error, "get email account");
      }
    };
    void handleGetAccount();
  });

  // --------------------------------------------------------------------------
  // POST /api/email-accounts/:id/reveal-password - Reveal password (rate-limited)
  // --------------------------------------------------------------------------
  router.post("/:id/reveal-password", (req: Request, res: Response): void => {
    const handleRevealPassword = async (): Promise<void> => {
      try {
        // Rate limiting: 5 reveals per 15-minute window
        const clientKey = req.ip ?? "unknown";
        const now = Date.now();
        const window = revealRateLimit.get(clientKey);

        if (window) {
          if (now - window.window_start > REVEAL_RATE_LIMIT_WINDOW_MS) {
            // Window expired, reset
            revealRateLimit.set(clientKey, { count: 1, window_start: now });
          } else if (window.count >= REVEAL_RATE_LIMIT_MAX) {
            const remainingMs =
              REVEAL_RATE_LIMIT_WINDOW_MS - (now - window.window_start);
            const remainingSecs = Math.ceil(remainingMs / 1000);
            res.status(HTTP_STATUS_TOO_MANY_REQUESTS).json({
              error: "Rate limit exceeded",
              message: `Password reveal is limited to ${String(REVEAL_RATE_LIMIT_MAX)} per 15 minutes. Try again in ${String(remainingSecs)} seconds.`,
            });
            return;
          } else {
            window.count++;
          }
        } else {
          revealRateLimit.set(clientKey, { count: 1, window_start: now });
        }

        const raw = await mcpToolClient.callTool<RawEmailGetAccountResponse>(
          "email_get_account",
          { account_id: req.params.id },
          MCP_TIMEOUT_MS,
        );

        // Set no-cache headers for sensitive data
        res.setHeader("Cache-Control", "no-store, no-cache");
        res.setHeader("Pragma", "no-cache");
        res.status(HTTP_STATUS_OK).json({ password: raw.password });
      } catch (error) {
        handleMcpError(res, error, "reveal password");
      }
    };
    void handleRevealPassword();
  });

  // --------------------------------------------------------------------------
  // GET /api/email-accounts/:id/inbox - Read inbox (30s cache)
  // --------------------------------------------------------------------------
  router.get("/:id/inbox", (req: Request, res: Response): void => {
    const handleInbox = async (): Promise<void> => {
      const accountId = req.params.id as string;
      try {
        const limit = Number(req.query.limit) || 20;
        const now = Date.now();

        // Check success cache
        const cached = inboxCache.get(accountId);
        if (cached && now - cached.fetched_at_ms < INBOX_CACHE_TTL_MS) {
          const ttlRemaining = Math.ceil(
            (INBOX_CACHE_TTL_MS - (now - cached.fetched_at_ms)) / 1000,
          );
          res.status(HTTP_STATUS_OK).json({
            ...cached.response,
            cached: true,
            cache_ttl_remaining: ttlRemaining,
          });
          return;
        }

        // Check error cache — avoid hammering suspended accounts
        const cachedError = inboxErrorCache.get(accountId);
        if (cachedError && now - cachedError.fetched_at_ms < INBOX_ERROR_CACHE_TTL_MS) {
          const ttlRemaining = Math.ceil(
            (INBOX_ERROR_CACHE_TTL_MS - (now - cachedError.fetched_at_ms)) / 1000,
          );
          res.status(cachedError.status).json({
            error: cachedError.error,
            message: cachedError.message,
            cached: true,
            retry_after_seconds: ttlRemaining,
          });
          return;
        }

        const raw = await mcpToolClient.callTool<RawEmailReadInboxResponse>(
          "email_read_inbox",
          { account_id: accountId, limit },
          INBOX_TIMEOUT_MS,
        );

        const messages: DashboardEmailMessage[] = (raw.messages ?? []).map(
          (msg: RawEmailInboxMessage) => toSafeDashboardMessage(msg),
        );
        const fetchedAt = new Date().toISOString();

        const response: InboxResponse = {
          email: raw.email,
          messages,
          message_count: messages.length,
          cached: false,
          fetched_at: fetchedAt,
          cache_ttl_remaining: Math.ceil(INBOX_CACHE_TTL_MS / 1000),
        };

        // Store in cache, clear any error cache
        inboxCache.set(accountId, {
          response,
          fetched_at_ms: now,
        });
        inboxErrorCache.delete(accountId);

        res.status(HTTP_STATUS_OK).json(response);
      } catch (error) {
        // Cache the error so we don't re-attempt immediately
        const errorMsg = error instanceof Error ? error.message : "MCP proxy unreachable";
        const status = error instanceof Error && error.name === "AbortError"
          ? 504
          : (error instanceof McpToolError ? 502 : 502);
        inboxErrorCache.set(accountId, {
          error: `Failed to read inbox`,
          message: errorMsg,
          status,
          fetched_at_ms: Date.now(),
        });
        handleMcpError(res, error, "read inbox");
      }
    };
    void handleInbox();
  });

  // --------------------------------------------------------------------------
  // POST /api/email-accounts/:id/health - Check account health
  // --------------------------------------------------------------------------
  router.post("/:id/health", (req: Request, res: Response): void => {
    const handleHealth = async (): Promise<void> => {
      const accountId = req.params.id as string;
      try {
        const result =
          await mcpToolClient.callTool<EmailCheckHealthResponse>(
            "email_check_health",
            { account_id: accountId },
            MCP_TIMEOUT_MS,
          );
        // Cache the health result for list enrichment
        healthCache.set(accountId, {
          healthy: result.healthy === true,
          error: typeof result.error === "string" ? result.error : undefined,
          checked_at: new Date().toISOString(),
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        // Cache failures too so list shows "unhealthy"
        healthCache.set(accountId, {
          healthy: false,
          error: error instanceof Error ? error.message : "Health check failed",
          checked_at: new Date().toISOString(),
        });
        handleMcpError(res, error, "check email health");
      }
    };
    void handleHealth();
  });

  // --------------------------------------------------------------------------
  // DELETE /api/email-accounts/:id - Delete account from vault
  // --------------------------------------------------------------------------
  router.delete("/:id", (req: Request, res: Response): void => {
    const handleDelete = async (): Promise<void> => {
      try {
        const result =
          await mcpToolClient.callTool<EmailDeleteAccountResponse>(
            "email_delete_account",
            { account_id: req.params.id },
            MCP_TIMEOUT_MS,
          );
        // Clear inbox cache for deleted account
        inboxCache.delete(req.params.id as string);
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "delete email account");
      }
    };
    void handleDelete();
  });

  return router;
}
