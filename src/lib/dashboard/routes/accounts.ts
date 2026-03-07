/**
 * Accounts Router
 * REST API endpoints for OAuth account management:
 * - List all accounts with usage data
 * - Set active account
 * - Refresh OAuth token
 * - Remove account
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import rateLimit from "express-rate-limit";

import type { AccountManager, RotationResult } from "../../account/account-manager.js";
import type { UsageMonitor } from "../services/usage-monitor.js";
import type { LogStreamer } from "../websocket-server.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_CONFLICT = 409;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Estimated token limits for Claude Max tier
// Note: These are rough estimates - actual limits vary by subscription
const FIVE_HOUR_LIMIT_ESTIMATE = 10_000_000;  // 10M tokens per 5h window
const SEVEN_DAY_LIMIT_ESTIMATE = 50_000_000;  // 50M tokens per 7d window
const PERCENTAGE_MULTIPLIER = 100;

// Rate limiting for refresh endpoint: 5 requests per hour per IP
const REFRESH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // 1 hour in milliseconds
const REFRESH_RATE_LIMIT_MAX_REQUESTS = 5;

// Rate limiting for rotation endpoint: 10 requests per minute
const ROTATE_RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minute in milliseconds
const ROTATE_RATE_LIMIT_MAX_REQUESTS = 10;

/**
 * Dependencies for accounts router
 */
export interface AccountsRouterDeps {
  /** Account manager for CRUD operations */
  accountManager: AccountManager;
  /** Usage monitor for real-time metrics */
  usageMonitor?: UsageMonitor;
  /**
   * Getter function for the LogStreamer instance (WebSocket broadcasting).
   * Returns undefined if WebSocket server has not been initialized yet.
   * Uses getter pattern because LogStreamer is created after server.listen(),
   * but routes are mounted before listen().
   */
  getLogStreamer?: () => LogStreamer | undefined;
}

/**
 * Rotation request body from proxy or manual dashboard rotation
 */
interface RotationRequest {
  /** Account that hit rate limit (omit for manual rotation) */
  currentAccountId?: string;
  /** ISO 8601 timestamp when rate limit resets */
  resetsAt?: string;
  /** Rotation reason from proxy */
  reason?: string;
}

/**
 * Type guard to validate rotation request body.
 * Empty body is valid (manual rotation with no context).
 */
function isValidRotationRequest(body: unknown): body is RotationRequest {
  if (body === undefined || body === null) {
    return true; // Empty body is valid (manual rotation)
  }

  if (typeof body !== "object") {
    return false;
  }

  const req = body as Record<string, unknown>;

  // Optional fields - validate types if present
  if (req.currentAccountId !== undefined && typeof req.currentAccountId !== "string") {
    return false;
  }

  if (req.resetsAt !== undefined && typeof req.resetsAt !== "string") {
    return false;
  }

  if (req.reason !== undefined) {
    const validReasons = ["rate_limit", "rate_limit_429", "rate_limit_5h", "rate_limit_7d", "manual", "scheduled"];
    if (typeof req.reason !== "string" || !validReasons.includes(req.reason)) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize rotation reason string into an AccountRotatedPayload-compatible reason.
 * Maps proxy reason strings to the enum used in WebSocket payloads.
 */
function normalizeRotationReason(reason: string | undefined): "manual" | "rate_limit_5h" | "rate_limit_7d" | "scheduled" {
  if (!reason) {
    return "manual";
  }
  if (reason === "rate_limit_7d") {
    return "rate_limit_7d";
  }
  if (reason === "scheduled") {
    return "scheduled";
  }
  // "rate_limit", "rate_limit_429", "rate_limit_5h" all map to rate_limit_5h
  if (reason.startsWith("rate_limit")) {
    return "rate_limit_5h";
  }
  return "manual";
}

/**
 * Format a selectionReason enum value into a human-readable string for the frontend.
 * The frontend expects strings like "Lowest utilization (45%)", "Soonest reset (20min)".
 */
function formatSelectionReason(
  result: RotationResult,
  utilization: { fiveHour: number; sevenDay: number } | undefined,
): string {
  if (result.selectionReason === "lowest_utilization" && utilization) {
    return `Lowest utilization (${String(Math.round(utilization.fiveHour))}%)`;
  }
  if (result.selectionReason === "soonest_reset" && result.resetsInMs !== undefined && result.resetsInMs !== null) {
    const MILLISECONDS_PER_MINUTE = 60_000;
    const minutes = Math.round(result.resetsInMs / MILLISECONDS_PER_MINUTE);
    return `Soonest reset (${String(minutes)}min)`;
  }
  if (result.selectionReason === "first_available") {
    return "First available";
  }
  return result.selectionReason ?? "First available";
}

/**
 * Frontend-compatible account format
 */
export interface AccountResponse {
  /** Unique account identifier */
  id: string;
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Subscription type (Free, Pro, Team, etc.) */
  subscriptionType: string;
  /** Whether this is the active account */
  isActive: boolean;
  /** Whether OAuth token is expired or needs re-authentication */
  isExpired: boolean;
  /** Reason for expiration (if isExpired is true) */
  expiredReason?: "token_expired" | "needs_reauth";
  /** Whether this is a long-lived token (no refresh token) */
  isLongLived: boolean;
  /** Whether this account is pinned (prevents auto-rotation away) */
  isPinned: boolean;
  /** 5-hour usage data */
  usage5h: UsageDataResponse;
  /** 7-day usage data */
  usage7d: UsageDataResponse;
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Usage data for a time period
 */
interface UsageDataResponse {
  /** Current usage count/amount */
  current: number;
  /** Maximum allowed in period */
  limit: number;
  /** ISO timestamp when usage resets */
  resetsAt: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Create accounts router with dependencies
 */
export function createAccountsRouter(deps: AccountsRouterDeps): Router {
  // Rate limiters are created per-router instance so each mounted router
  // gets its own rate limit store. This also prevents shared state in tests.

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- express-rate-limit returns unresolved type
  const refreshRateLimit = rateLimit({
    windowMs: REFRESH_RATE_LIMIT_WINDOW_MS,
    max: REFRESH_RATE_LIMIT_MAX_REQUESTS,
    message: "Too many refresh requests. Please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- express-rate-limit returns unresolved type
  const rotateRateLimit = rateLimit({
    windowMs: ROTATE_RATE_LIMIT_WINDOW_MS,
    max: ROTATE_RATE_LIMIT_MAX_REQUESTS,
    message: "Too many rotation requests. Please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
  const router: Router = express.Router() as Router;

  /**
   * GET /api/accounts - List all OAuth accounts with usage data
   */
  router.get("/", (_req: Request, res: Response): void => {
    const handleGetAccounts = async (): Promise<void> => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      console.log(`[accounts:GET] ${requestId} - Fetching all accounts`);

      try {
        const accounts = await deps.accountManager.getAccounts();
        console.log(`[accounts:GET] ${requestId} - Found ${accounts.length} accounts`);

        const activeAccount = await deps.accountManager.getActiveAccount();
        const activeId = activeAccount?.id;
        console.log(`[accounts:GET] ${requestId} - Active account: ${activeId?.slice(0, 8) ?? "none"}...`);

        // Fetch usage if monitor is available
        let usageMap: Map<string, { fiveHour: { percentage: number; resetsAt: string }; sevenDay: { percentage: number; resetsAt: string } }> | undefined;
        if (deps.usageMonitor !== undefined) {
          usageMap = await deps.usageMonitor.fetchAllUsage();

          // AC #1: Diagnostic logging for fetchAllUsage result
          console.log("[accounts] fetchAllUsage result:", {
            usageMapDefined: usageMap !== undefined,
            usageMapSize: usageMap?.size ?? 0,
            usageMapKeys: usageMap ? [...usageMap.keys()] : [],
          });

          // Log each entry for debugging
          if (usageMap !== undefined) {
            for (const [accountId, usage] of usageMap.entries()) {
              console.log(`[accounts] Usage for ${accountId}:`, {
                fiveHourPercentage: usage.fiveHour.percentage,
                sevenDayPercentage: usage.sevenDay.percentage,
                fiveHourResetsAt: usage.fiveHour.resetsAt,
                sevenDayResetsAt: usage.sevenDay.resetsAt,
              });
            }
          }
        }

        const response: AccountResponse[] = accounts.map((account) => {
          const usage = usageMap?.get(account.id);

          // Calculate current usage from percentage
          const fiveHourPercentage = usage?.fiveHour.percentage ?? 0;
          const sevenDayPercentage = usage?.sevenDay.percentage ?? 0;

          const fiveHourCurrent = Math.round(
            (fiveHourPercentage / PERCENTAGE_MULTIPLIER) * FIVE_HOUR_LIMIT_ESTIMATE
          );
          const sevenDayCurrent = Math.round(
            (sevenDayPercentage / PERCENTAGE_MULTIPLIER) * SEVEN_DAY_LIMIT_ESTIMATE
          );

          // Calculate reset times (default to 5h/7d from now if not available)
          const now = new Date();
          const fiveHourReset = usage?.fiveHour.resetsAt ?? new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
          const sevenDayReset = usage?.sevenDay.resetsAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

          // Check if token is expired or account needs re-authentication
          const tokenExpired = account.token.expiresAt < Date.now();
          const needsReauth = account.metadata.status === "needs_reauth";
          const isExpired = tokenExpired || needsReauth;
          const expiredReason = needsReauth ? "needs_reauth" : (tokenExpired ? "token_expired" : undefined);

          // Long-lived tokens have no refresh token (can't be refreshed)
          const isLongLived = !account.token.refreshToken || account.token.refreshToken.length === 0;

          // Log detailed account info
          console.log(`[accounts:GET] ${requestId} - Account ${account.id.slice(0, 8)}...:`, {
            email: account.metadata.email,
            emailType: typeof account.metadata.email,
            alias: account.metadata.alias,
            status: account.metadata.status,
            isActive: account.id === activeId,
            tokenExpired,
            needsReauth,
            fiveHourUsage: `${fiveHourPercentage}%`,
            sevenDayUsage: `${sevenDayPercentage}%`,
          });

          return {
            email: account.metadata.email ?? "",
            expiredReason,
            id: account.id,
            isActive: account.id === activeId,
            isExpired,
            isLongLived,
            isPinned: account.metadata.pinned === true,
            lastUpdated: new Date().toISOString(),
            name: account.metadata.alias ?? account.metadata.email ?? account.id.slice(0, 8),
            subscriptionType: account.token.subscriptionType ?? "Pro",
            usage5h: {
              current: fiveHourCurrent,
              limit: FIVE_HOUR_LIMIT_ESTIMATE,
              resetsAt: fiveHourReset,
            },
            usage7d: {
              current: sevenDayCurrent,
              limit: SEVEN_DAY_LIMIT_ESTIMATE,
              resetsAt: sevenDayReset,
            },
          };
        });

        console.log(`[accounts:GET] ${requestId} - Returning ${response.length} accounts to client`);
        res.status(HTTP_STATUS_OK).json(response);
      } catch (error: unknown) {
        console.error(`[accounts:GET] ${requestId} - ERROR:`, error);
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch accounts",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleGetAccounts();
  });

  /**
   * POST /api/accounts/import-cli - Import credentials from CLI credentials file
   * Reads ~/.claude/.credentials.json and imports into AccountManager
   */
  router.post("/import-cli", (_req: Request, res: Response): void => {
    const handleImportCli = async (): Promise<void> => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      console.log(`[accounts:IMPORT-CLI] ${requestId} - Starting CLI credentials import`);

      try {
        const account = await deps.accountManager.importFromClaudeCli();

        console.log(`[accounts:IMPORT-CLI] ${requestId} - Import result:`, {
          success: account !== null,
          accountId: account?.id.slice(0, 8),
          email: account?.metadata.email,
        });

        if (account === null) {
          res.status(HTTP_STATUS_NOT_FOUND).json({
            error: "No CLI credentials found",
            success: false,
          });
          return;
        }

        res.status(HTTP_STATUS_OK).json({
          accountId: account.id,
          email: account.metadata.email,
          name: account.metadata.alias ?? account.metadata.email ?? account.id.slice(0, 8),
          success: true,
        });
      } catch (error: unknown) {
        console.error("[accounts] Error importing CLI credentials:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to import CLI credentials",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleImportCli();
  });

  /**
   * POST /api/accounts/fetch-emails - Fetch emails for all accounts missing email
   * Iterates through accounts and fetches profile data from Claude API
   */
  router.post("/fetch-emails", (_req: Request, res: Response): void => {
    const handleFetchEmails = async (): Promise<void> => {
      try {
        const results = await deps.accountManager.fetchAllMissingEmails();

        res.status(HTTP_STATUS_OK).json({
          success: true,
          updated: results.size,
          emails: Object.fromEntries(results),
        });
      } catch (error: unknown) {
        console.error("[accounts] Error fetching emails:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch emails",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleFetchEmails();
  });

  /**
   * POST /api/accounts/rotate - Rotate to the next available account
   * Used for automatic credential rotation on rate limits.
   *
   * Request body (all fields optional):
   *   { currentAccountId?: string, resetsAt?: string, reason?: string }
   *
   * Responses:
   *   200 - Rotation succeeded, new account activated
   *   400 - Invalid request body
   *   409 - Account is pinned (cannot rotate)
   *   503 - No available accounts (includes retry timing)
   *   500 - Internal error
   *
   * On success, broadcasts an "account_rotated" WebSocket event to all
   * connected dashboard clients. Broadcast failures are logged but do
   * not block the HTTP response.
   */

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- express-rate-limit middleware type
  router.post("/rotate", rotateRateLimit, (req: Request, res: Response): void => {
    const handleRotate = async (): Promise<void> => {
      const requestId = `rot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      try {
        // Validate request body
        if (!isValidRotationRequest(req.body)) {
          console.warn(`[accounts:ROTATE] ${requestId} - Invalid request body:`, req.body);
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            success: false,
            error: "Invalid rotation request. Expected { currentAccountId?: string, resetsAt?: string, reason?: \"rate_limit\" | \"manual\" | \"scheduled\" }",
          });
          return;
        }

        const body = req.body as RotationRequest | undefined;
        const currentAccountId = body?.currentAccountId;
        const resetsAt = body?.resetsAt;
        const rawReason = body?.reason;
        const reason = normalizeRotationReason(rawReason);

        // Log rotation attempt with full context
        console.log(`[accounts:ROTATE] ${requestId} - Rotation attempt:`, {
          currentAccountId: currentAccountId?.slice(0, 8),
          reason,
          rawReason,
          timestamp: new Date().toISOString(),
        });

        // If proxy told us which account hit rate limit, mark it before rotating
        if (currentAccountId) {
          console.log(`[accounts:ROTATE] ${requestId} - Marking ${currentAccountId.slice(0, 8)}... as rate_limited (reason: ${rawReason ?? "unknown"})`);
          await deps.accountManager.markAccountRateLimited(currentAccountId, resetsAt);
        }

        const result = await deps.accountManager.rotateToNextAccount();

        if (!result.success) {
          // Log rotation failure with retry information
          console.log(`[accounts:ROTATE] ${requestId} - Rotation failed:`, {
            success: false,
            error: result.error,
            previousAccountId: result.previousAccountId?.slice(0, 8),
            resetsAt: result.resetsAt,
            resetsInMs: result.resetsInMs,
            selectionReason: result.selectionReason,
            reason,
            timestamp: new Date().toISOString(),
          });

          // 409 Conflict when account is pinned, 503 for no available accounts
          const statusCode = result.error === "Account is pinned" ? HTTP_STATUS_CONFLICT : 503;
          res.status(statusCode).json({
            success: false,
            error: result.error,
            previousAccountId: result.previousAccountId,
            resetsAt: result.resetsAt,
            resetsInMs: result.resetsInMs,
          });
          return;
        }

        // Get new account details for response
        const newAccount = result.newAccountId
          ? await deps.accountManager.getAccount(result.newAccountId)
          : null;

        // Fetch utilization data for the new account (for WebSocket payload)
        let utilization: { fiveHour: number; sevenDay: number } | undefined;
        if (deps.usageMonitor && result.newAccountId) {
          try {
            const usageMap = await deps.usageMonitor.fetchAllUsage();
            const accountUsage = usageMap.get(result.newAccountId);
            if (accountUsage) {
              utilization = {
                fiveHour: accountUsage.fiveHour.percentage,
                sevenDay: accountUsage.sevenDay.percentage,
              };
            }
          } catch (usageError: unknown) {
            console.warn(`[accounts:ROTATE] ${requestId} - Failed to fetch utilization data:`, usageError instanceof Error ? usageError.message : "Unknown error");
          }
        }

        // Format selectionReason for frontend display
        const formattedSelectionReason = formatSelectionReason(result, utilization);

        // Log rotation success with full context
        console.log(`[accounts:ROTATE] ${requestId} - Rotation completed:`, {
          success: true,
          previousAccountId: result.previousAccountId?.slice(0, 8),
          newAccountId: result.newAccountId?.slice(0, 8),
          email: newAccount?.metadata.email,
          selectionReason: result.selectionReason,
          formattedSelectionReason,
          utilization: utilization ?? null,
          reason,
          timestamp: new Date().toISOString(),
        });

        // Broadcast WebSocket event to all connected dashboard clients
        // Errors are caught and logged - they must NOT block the HTTP response
        const logStreamer = deps.getLogStreamer?.();
        if (logStreamer) {
          try {
            logStreamer.broadcast({
              type: "account_rotated",
              payload: {
                timestamp: new Date().toISOString(),
                previousAccountId: result.previousAccountId,
                newAccountId: result.newAccountId ?? "",
                reason,
                selectionReason: formattedSelectionReason,
                utilization: utilization ?? { fiveHour: 0, sevenDay: 0 },
              },
            });
            console.log(`[accounts:ROTATE] ${requestId} - WebSocket broadcast sent`);
          } catch (broadcastError: unknown) {
            console.warn(
              "[accounts:ROTATE] WebSocket broadcast failed for account_rotated event:",
              broadcastError instanceof Error ? broadcastError.message : "Unknown error",
            );
          }
        }

        res.status(HTTP_STATUS_OK).json({
          success: true,
          previousAccountId: result.previousAccountId,
          newAccountId: result.newAccountId,
          email: newAccount?.metadata.email,
          selectionReason: formattedSelectionReason,
        });
      } catch (error: unknown) {
        console.error(`[accounts:ROTATE] ${requestId} - Internal error:`, error);
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          success: false,
          error: "Failed to rotate credentials",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };
    void handleRotate();
  });

  /**
   * POST /api/accounts/:id/fetch-email - Fetch email for a specific account
   */
  router.post("/:id/fetch-email", (req: Request, res: Response): void => {
    const handleFetchEmail = async (): Promise<void> => {
      const id = req.params.id as string | undefined;

      if (!id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Account ID required" });
        return;
      }

      try {
        const account = await deps.accountManager.getAccount(id);
        if (account === undefined) {
          res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Account not found" });
          return;
        }

        const email = await deps.accountManager.fetchAccountEmail(id);

        if (email === undefined) {
          res.status(HTTP_STATUS_OK).json({
            success: false,
            message: "Could not fetch email. Token may be expired.",
          });
          return;
        }

        res.status(HTTP_STATUS_OK).json({
          success: true,
          email,
        });
      } catch (error: unknown) {
        console.error("[accounts] Error fetching email:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch email",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleFetchEmail();
  });

  /**
   * POST /api/accounts/:id/activate - Set account as active
   */
  router.post("/:id/activate", (req: Request, res: Response): void => {
    const handleActivate = async (): Promise<void> => {
      const id = String(req.params.id);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      console.log(`[accounts:ACTIVATE] ${requestId} - Request to activate account ${id.slice(0, 8)}...`);

      if (!id) {
        console.error(`[accounts:ACTIVATE] ${requestId} - ERROR: No account ID provided`);
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Account ID required" });
        return;
      }

      try {
        // Get previous active account for logging
        const previousActive = await deps.accountManager.getActiveAccount();
        console.log(`[accounts:ACTIVATE] ${requestId} - Previous active: ${previousActive?.id.slice(0, 8) ?? "none"}...`);

        const account = await deps.accountManager.getAccount(id);
        if (account === undefined) {
          console.error(`[accounts:ACTIVATE] ${requestId} - ERROR: Account ${id.slice(0, 8)}... not found`);
          res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Account not found" });
          return;
        }

        console.log(`[accounts:ACTIVATE] ${requestId} - Setting ${id.slice(0, 8)}... as active (email: ${account.metadata.email ?? "unknown"})`);
        await deps.accountManager.setActiveAccount(id);

        console.log(`[accounts:ACTIVATE] ${requestId} - SUCCESS: Account ${id.slice(0, 8)}... is now active`);
        res.status(HTTP_STATUS_OK).json({ success: true, activeId: id });
      } catch (error: unknown) {
        console.error("[accounts] Error activating account:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to activate account",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleActivate();
  });

  /**
   * POST /api/accounts/:id/refresh - Refresh OAuth token for account
   * Rate limited to 5 requests per hour per IP
   */
   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- express-rate-limit middleware type
  router.post("/:id/refresh", refreshRateLimit, (req: Request, res: Response): void => {
    const handleRefresh = async (): Promise<void> => {
      const id = String(req.params.id);

      if (!id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Account ID required" });
        return;
      }

      try {
        const account = await deps.accountManager.getAccount(id);
        if (account === undefined) {
          res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Account not found" });
          return;
        }

        // Manual refresh always allowed - reset retry count so it attempts immediately
        if (account.metadata.status === "needs_reauth") {
          await deps.accountManager.updateAccount(id, {
            metadata: {
              refreshRetryCount: 0,
              lastRefreshRetryAt: undefined,
            },
          });
          console.log(`[accounts:REFRESH] Manual refresh for needs_reauth account ${id.slice(0, 8)}... - retry count reset`);
        }

        // Attempt OAuth token refresh
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 10_000);

        try {
          const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "anthropic-beta": "oauth-2025-04-20",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: account.token.refreshToken,
            }).toString(),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Check for permanent failures (401, 403, 400)
            if (
              response.status === HTTP_STATUS_UNAUTHORIZED ||
              response.status === HTTP_STATUS_FORBIDDEN ||
              response.status === HTTP_STATUS_BAD_REQUEST
            ) {
              // Mark account as needing re-authentication
              await deps.accountManager.updateAccount(id, {
                metadata: { status: "needs_reauth" },
              });
              res.status(HTTP_STATUS_UNAUTHORIZED).json({
                error: "Refresh token invalid or expired. Re-authentication required.",
              });
              return;
            }

            res.status(HTTP_STATUS_INTERNAL_ERROR).json({
              error: `OAuth refresh failed: HTTP ${response.status}`,
            });
            return;
          }

          const tokenData = (await response.json()) as {
            access_token: string;
            expires_in: number;
            refresh_token?: string;
            token_type: string;
          };

          const newExpiresAt = Date.now() + tokenData.expires_in * 1000;

          // Verify the refreshed token belongs to the same account
          // by fetching the profile and comparing email addresses
          if (account.metadata.email) {
            try {
              const profileResponse = await fetch("https://api.claude.ai/api/me", {
                headers: {
                  Authorization: `Bearer ${tokenData.access_token}`,
                  "Content-Type": "application/json",
                },
              });

              if (profileResponse.ok) {
                const profileData = (await profileResponse.json()) as {
                  email?: string;
                  email_address?: string;
                  account?: { email_address?: string };
                };

                const newEmail = profileData.email ?? profileData.email_address ?? profileData.account?.email_address;

                if (newEmail && newEmail !== account.metadata.email) {
                  console.warn(
                    `[accounts] Token refresh returned different account: expected ${account.metadata.email}, got ${newEmail}`
                  );
                  // Mark account as needing re-authentication - don't store mismatched credentials
                  await deps.accountManager.updateAccount(id, {
                    metadata: { status: "needs_reauth" },
                  });
                  res.status(HTTP_STATUS_UNAUTHORIZED).json({
                    error: `Token refresh returned a different account (${newEmail}). Please re-authenticate with the correct account.`,
                    expectedEmail: account.metadata.email,
                    actualEmail: newEmail,
                  });
                  return;
                }
              }
            } catch (profileError) {
              // Profile fetch failed - log but continue with refresh
              // Better to update credentials than fail completely
              console.warn("[accounts] Failed to verify account identity after refresh:", profileError);
            }
          }

          // Update account with new tokens and clear all retry metadata
          await deps.accountManager.updateAccount(id, {
            token: {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token ?? account.token.refreshToken,
              expiresAt: newExpiresAt,
            },
            metadata: {
              status: "active",
              needsReauthSince: undefined,
              refreshRetryCount: undefined,
              lastRefreshRetryAt: undefined,
            },
          });

          res.status(HTTP_STATUS_OK).json({
            success: true,
            expiresAt: new Date(newExpiresAt).toISOString(),
          });
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error: unknown) {
        console.error("[accounts] Error refreshing token:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to refresh token",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleRefresh();
  });

  /**
   * POST /api/accounts/:id/pin - Toggle pin status for account
   * Pinned accounts are protected from auto-rotation (429 rotation won't switch away)
   */
  router.post("/:id/pin", (req: Request, res: Response): void => {
    const handlePin = async (): Promise<void> => {
      const id = String(req.params.id);

      if (!id) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Account ID required" });
        return;
      }

      try {
        const account = await deps.accountManager.getAccount(id);
        if (account === undefined) {
          res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Account not found" });
          return;
        }

        // Toggle pin state
        const newPinnedState = !(account.metadata.pinned === true);

        await deps.accountManager.updateAccount(id, {
          metadata: { pinned: newPinnedState },
        });

        console.log(`[accounts:PIN] Account ${id.slice(0, 8)}... ${newPinnedState ? "pinned" : "unpinned"}`);
        res.status(HTTP_STATUS_OK).json({
          success: true,
          isPinned: newPinnedState,
        });
      } catch (error: unknown) {
        console.error("[accounts] Error toggling pin:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to toggle pin",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handlePin();
  });

  /**
   * DELETE /api/accounts/:id - Remove account
   */
  router.delete("/:id", (req: Request, res: Response): void => {
    const handleDelete = async (): Promise<void> => {
      const id = String(req.params.id);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      console.log(`[accounts:DELETE] ${requestId} - Request to remove account ${id.slice(0, 8)}...`);

      if (!id) {
        console.error(`[accounts:DELETE] ${requestId} - ERROR: No account ID provided`);
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Account ID required" });
        return;
      }

      try {
        const account = await deps.accountManager.getAccount(id);
        if (account === undefined) {
          console.error(`[accounts:DELETE] ${requestId} - ERROR: Account ${id.slice(0, 8)}... not found`);
          res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Account not found" });
          return;
        }

        // Get current state for logging
        const allAccounts = await deps.accountManager.getAccounts();
        const activeAccount = await deps.accountManager.getActiveAccount();
        const isActive = activeAccount?.id === id;

        console.log(`[accounts:DELETE] ${requestId} - Removing account ${id.slice(0, 8)}... (email: ${account.metadata.email ?? "unknown"})`, {
          isActive,
          totalAccountsBefore: allAccounts.length,
          accountEmail: account.metadata.email,
        });

        await deps.accountManager.removeAccount(id);

        const remainingAccounts = await deps.accountManager.getAccounts();
        const newActive = await deps.accountManager.getActiveAccount();

        console.log(`[accounts:DELETE] ${requestId} - SUCCESS: Account removed`, {
          totalAccountsAfter: remainingAccounts.length,
          newActiveAccount: newActive?.id.slice(0, 8),
        });

        res.status(HTTP_STATUS_NO_CONTENT).send();
      } catch (error: unknown) {
        console.error(`[accounts:DELETE] ${requestId} - ERROR:`, error);
        const errorResponse: ErrorResponse = {
          error: "Failed to remove account",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleDelete();
  });

  return router;
}