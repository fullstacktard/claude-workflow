/**
 * Admin Panel Authentication Middleware
 * Validates CLAUDE_WORKFLOW_ADMIN_TOKEN from Authorization header.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Unlike the public auth middleware (auth.ts), this middleware:
 * - Has NO localhost bypass (admin always requires auth)
 * - Is NOT configurable via env flags (always on when token is set)
 * - Uses a separate env var (CLAUDE_WORKFLOW_ADMIN_TOKEN)
 */

import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express-serve-static-core";

// HTTP status codes
const HTTP_STATUS_UNAUTHORIZED = 401;

/**
 * Unauthorized error response
 */
interface UnauthorizedResponse {
  error: string;
  message: string;
  status: 401;
}

/**
 * Create admin authentication middleware.
 * Returns middleware that validates Bearer token against CLAUDE_WORKFLOW_ADMIN_TOKEN.
 *
 * @param adminToken - The admin token to validate against
 * @returns Express middleware function
 */
export function createAdminAuthMiddleware(adminToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const response: UnauthorizedResponse = {
        error: "Unauthorized",
        message:
          "Missing or invalid Authorization header. Use 'Bearer <admin-token>'",
        status: HTTP_STATUS_UNAUTHORIZED,
      };
      res.status(HTTP_STATUS_UNAUTHORIZED).json(response);
      return;
    }

    // Extract token and compare using timing-safe comparison
    const token = authHeader.slice(7); // Remove "Bearer " prefix
    const tokenBuffer = Buffer.from(token);
    const secretBuffer = Buffer.from(adminToken);

    // Check length first -- timingSafeEqual throws on mismatched lengths.
    // Length leakage is acceptable for randomly generated fixed-length tokens.
    if (
      tokenBuffer.length !== secretBuffer.length ||
      !timingSafeEqual(tokenBuffer, secretBuffer)
    ) {
      const response: UnauthorizedResponse = {
        error: "Unauthorized",
        message: "Invalid admin token",
        status: HTTP_STATUS_UNAUTHORIZED,
      };
      res.status(HTTP_STATUS_UNAUTHORIZED).json(response);
      return;
    }

    next();
  };
}
