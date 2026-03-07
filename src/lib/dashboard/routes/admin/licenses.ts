/**
 * License Key Admin Routes
 * REST API endpoints for listing, viewing, and revoking Polar.sh license keys.
 *
 * Route map:
 *   GET   /              -> List license keys (paginated, filterable)
 *   GET   /:id           -> Get license key detail with activations
 *   POST  /:id/revoke    -> Revoke a license key
 *
 * Uses direct fetch to Polar API (not MCP proxy). Error handling follows
 * the same shape as routes/shared/mcp-error-handler.ts.
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";

import {
  listLicenseKeys,
  getLicenseKeyWithActivations,
  revokeLicenseKey,
  PolarAdminError,
} from "../../services/polar-admin-client.js";
import type {
  PolarAdminConfig,
  LicenseKeyStatus,
} from "../../services/polar-admin-client.js";

// HTTP status codes (following project convention - each route file has its own)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_BAD_GATEWAY = 502;
const HTTP_STATUS_GATEWAY_TIMEOUT = 504;

/** Valid license key status values for the status filter */
const VALID_STATUSES: readonly LicenseKeyStatus[] = [
  "granted",
  "revoked",
  "disabled",
] as const;

/**
 * Dependencies for the licenses router.
 */
interface LicensesRouterDeps {
  polarConfig: PolarAdminConfig;
}

/**
 * Map Polar API errors to appropriate HTTP responses.
 * - AbortError (timeout) -> 504 Gateway Timeout
 * - PolarAdminError with statusCode 404 -> 404 Not Found
 * - PolarAdminError with statusCode < 500 -> pass-through
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
    if (error.statusCode === 404) {
      res.status(HTTP_STATUS_NOT_FOUND).json({
        error: `Not found during ${operation}`,
        message: error.message,
      });
      return;
    }
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
 * Create the licenses admin router.
 *
 * Factory pattern follows existing route conventions (analytics.ts, health.ts).
 * Mounted at /api/admin/licenses by admin/index.ts.
 */
export function createLicensesRouter({
  polarConfig,
}: LicensesRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET / - List license keys with pagination and optional filtering
  router.get("/", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const page = Math.max(1, Number(req.query["page"]) || 1);
        const limit = Math.min(
          100,
          Math.max(1, Number(req.query["limit"]) || 20),
        );
        const status = req.query["status"] as string | undefined;
        const benefitId = req.query["benefit_id"] as string | undefined;

        // Validate status if provided
        if (
          status &&
          !VALID_STATUSES.includes(status as LicenseKeyStatus)
        ) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid status filter",
            message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
          });
          return;
        }

        const result = await listLicenseKeys(polarConfig, {
          page,
          limit,
          benefitId,
        });

        // Client-side status filtering (Polar list endpoint does not support status param)
        if (status) {
          result.items = result.items.filter((key) => key.status === status);
        }

        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handlePolarError(res, error, "list license keys");
      }
    })();
  });

  // GET /:id - Get license key with activations array
  router.get("/:id", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const id = String(req.params["id"]);
        const licenseKey = await getLicenseKeyWithActivations(polarConfig, id);
        res.status(HTTP_STATUS_OK).json(licenseKey);
      } catch (error) {
        handlePolarError(res, error, "get license key details");
      }
    })();
  });

  // POST /:id/revoke - Revoke a license key
  router.post("/:id/revoke", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const id = String(req.params["id"]);
        const result = await revokeLicenseKey(polarConfig, id);
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handlePolarError(res, error, "revoke license key");
      }
    })();
  });

  return router;
}
