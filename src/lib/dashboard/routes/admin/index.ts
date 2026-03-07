/**
 * Admin API Routes
 * Only mounted when CLAUDE_WORKFLOW_ADMIN_TOKEN is set.
 * All routes require valid Bearer token authentication.
 *
 * Returns null if admin token is not configured, so server.ts
 * can skip mounting entirely.
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import { createAdminAuthMiddleware } from "../../middleware/admin-auth.js";
import type { PolarAdminConfig } from "../../services/polar-admin-client.js";
import { createAdminConfigRouter } from "./config.js";
import { createLicensesRouter } from "./licenses.js";
import { createSubscribersRouter } from "./subscribers.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;

/**
 * Create the admin router.
 * @returns Router if CLAUDE_WORKFLOW_ADMIN_TOKEN is set, null otherwise
 */
export function createAdminRouter(): Router | null {
  const adminToken = process.env["CLAUDE_WORKFLOW_ADMIN_TOKEN"];

  if (!adminToken) {
    // Admin routes not available -- return null so server.ts skips mounting
    return null;
  }

  const router: Router = express.Router() as Router;

  // Apply admin auth middleware to ALL admin routes
  router.use(createAdminAuthMiddleware(adminToken));

  // Health check endpoint to verify admin auth is working
  router.get("/health", (_req: Request, res: Response): void => {
    res.status(HTTP_STATUS_OK).json({
      admin: true,
      message: "Admin API is operational",
      status: "ok",
    });
  });

  // Config management endpoints (read, update, validate, diff)
  router.use("/config", createAdminConfigRouter({ projectRoot: process.cwd() }));

  // Polar.sh subscriber and license key management
  // Requires POLAR_API_TOKEN and POLAR_ORG_ID environment variables
  const polarConfig: PolarAdminConfig = {
    apiToken: process.env["POLAR_API_TOKEN"] ?? "",
    organizationId: process.env["POLAR_ORG_ID"] ?? "",
  };

  router.use("/subscribers", createSubscribersRouter({ polarConfig }));
  router.use("/licenses", createLicensesRouter({ polarConfig }));

  return router;
}
