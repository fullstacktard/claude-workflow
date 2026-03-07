/**
 * Subscriber Admin Routes
 * REST API endpoints for listing and viewing Polar.sh subscriptions.
 *
 * Route map:
 *   GET  /              -> List subscriptions (paginated, filterable)
 *   GET  /:id           -> Get subscription detail with customer and product
 *
 * Uses direct fetch to Polar API (not MCP proxy). Error handling follows
 * the same shape as routes/shared/mcp-error-handler.ts.
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";

import {
  listSubscriptions,
  getSubscriptionById,
  PolarAdminError,
} from "../../services/polar-admin-client.js";
import type { PolarAdminConfig } from "../../services/polar-admin-client.js";

// HTTP status codes (following project convention - each route file has its own)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_BAD_GATEWAY = 502;
const HTTP_STATUS_GATEWAY_TIMEOUT = 504;

/** Valid subscription status values for the status filter */
const VALID_STATUSES = [
  "active",
  "canceled",
  "past_due",
  "trialing",
  "incomplete",
  "incomplete_expired",
  "unpaid",
] as const;

/** UUID v4 format regex */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dependencies for the subscribers router.
 */
interface SubscribersRouterDeps {
  polarConfig: PolarAdminConfig;
}

/**
 * Map Polar API errors to appropriate HTTP responses.
 * - AbortError (timeout) -> 504 Gateway Timeout
 * - PolarAdminError with statusCode < 500 -> pass-through (e.g. 404)
 * - PolarAdminError with statusCode >= 500 -> 502 Bad Gateway
 * - Unknown errors -> 502 Bad Gateway
 */
function handlePolarError(
  res: Response,
  error: unknown,
  operation: string,
): void {
  if (error instanceof Error && error.name === "AbortError") {
    res.status(HTTP_STATUS_GATEWAY_TIMEOUT).json({
      error: `Timeout during ${operation}`,
      message: "Polar API did not respond in time",
    });
    return;
  }

  if (error instanceof PolarAdminError) {
    const statusCode =
      error.statusCode < 500 ? error.statusCode : HTTP_STATUS_BAD_GATEWAY;
    res.status(statusCode).json({
      error: `Failed to ${operation}`,
      message: error.message,
    });
    return;
  }

  const message =
    error instanceof Error ? error.message : "Polar API unreachable";
  res.status(HTTP_STATUS_BAD_GATEWAY).json({
    error: `Failed to ${operation}`,
    message,
  });
}

/**
 * Create the subscribers admin router.
 *
 * Factory pattern follows existing route conventions (analytics.ts, health.ts).
 * Mounted at /api/admin/subscribers by admin/index.ts.
 */
export function createSubscribersRouter({
  polarConfig,
}: SubscribersRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET / - List subscriptions with pagination and filtering
  router.get("/", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const page = Math.max(1, Number(req.query["page"]) || 1);
        const limit = Math.min(
          100,
          Math.max(1, Number(req.query["limit"]) || 20),
        );
        const status = req.query["status"] as string | undefined;
        const productId = req.query["product_id"] as string | undefined;
        const email = req.query["email"] as string | undefined;

        // Validate status if provided
        if (
          status &&
          !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])
        ) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid status filter",
            message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
          });
          return;
        }

        // UUID format validation for product_id
        if (productId && !UUID_REGEX.test(productId)) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid product_id",
            message: "product_id must be a valid UUID",
          });
          return;
        }

        // Map status filter to Polar's active boolean parameter
        let active: boolean | undefined;
        if (status === "active" || status === "trialing") {
          active = true;
        } else if (status === "canceled") {
          active = false;
        }

        const result = await listSubscriptions(polarConfig, {
          page,
          limit,
          active,
          productId,
          email,
          sorting: ["-started_at"],
        });

        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handlePolarError(res, error, "list subscribers");
      }
    })();
  });

  // GET /:id - Get subscription detail with customer and product
  router.get("/:id", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const id = String(req.params["id"]);
        const subscription = await getSubscriptionById(polarConfig, id);

        if (!subscription) {
          res.status(HTTP_STATUS_NOT_FOUND).json({
            error: "Subscription not found",
            message: `No subscription found with id: ${id}`,
          });
          return;
        }

        res.status(HTTP_STATUS_OK).json(subscription);
      } catch (error) {
        handlePolarError(res, error, "get subscriber details");
      }
    })();
  });

  return router;
}
