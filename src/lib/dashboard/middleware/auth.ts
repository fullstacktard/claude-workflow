/**
 * Dashboard Authentication Middleware
 * Validates API key from Authorization header for protected endpoints
 */

import { timingSafeEqual } from "node:crypto";

import type { NextFunction, Request, Response } from "express-serve-static-core";

// HTTP status codes
const HTTP_STATUS_UNAUTHORIZED = 401;

/**
 * Auth configuration from environment
 */
export interface AuthConfig {
  /** Whether authentication is enabled (default: false) */
  enabled: boolean;
  /** API key for bearer token validation */
  apiKey: string;
  /** Whether to bypass auth for localhost requests (default: true) */
  localhostBypass: boolean;
}

/**
 * Unauthorized error response
 */
interface UnauthorizedResponse {
  error: string;
  message: string;
  status: 401;
}

/**
 * Localhost IP addresses for bypass detection
 */
const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Read auth configuration from environment variables
 * @returns AuthConfig object with current environment settings
 */
export function getAuthConfig(): AuthConfig {
  const enabled = process.env.DASHBOARD_AUTH_ENABLED === "true";
  const apiKey = process.env.DASHBOARD_API_KEY ?? "";

  if (enabled && !apiKey) {
    console.warn(
      "[dashboard-auth] WARNING: Auth enabled but DASHBOARD_API_KEY is not set!"
    );
  }

  return {
    // Disabled by default for backward compatibility
    enabled,
    apiKey,
    // Localhost bypass enabled by default for development convenience
    localhostBypass: process.env.DASHBOARD_LOCALHOST_BYPASS !== "false",
  };
}

/**
 * Check if request is from localhost
 * Handles various IP formats:
 * - IPv4 loopback: 127.0.0.1
 * - IPv6 loopback: ::1
 * - IPv4-mapped IPv6: ::ffff:127.0.0.1
 * @param req - Express request object
 * @returns true if request is from localhost
 */
function isLocalhostRequest(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return LOCALHOST_IPS.has(ip);
}

/**
 * Create authentication middleware
 * @param config - Authentication configuration (uses getAuthConfig() if not provided)
 * @returns Express middleware function
 */
export function createAuthMiddleware(config?: Partial<AuthConfig>) {
  const authConfig: AuthConfig = { ...getAuthConfig(), ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip if auth is disabled
    if (!authConfig.enabled) {
      next();
      return;
    }

    // Skip for localhost if bypass enabled
    if (authConfig.localhostBypass && isLocalhostRequest(req)) {
      next();
      return;
    }

    // Validate Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const response: UnauthorizedResponse = {
        error: "Unauthorized",
        message: "Missing or invalid Authorization header. Use 'Bearer <api-key>'",
        status: HTTP_STATUS_UNAUTHORIZED,
      };
      res.status(HTTP_STATUS_UNAUTHORIZED).json(response);
      return;
    }

    // Extract and validate token using timing-safe comparison
    // to prevent timing attacks on API key validation
    const token = authHeader.slice(7); // Remove "Bearer " prefix
    const tokenBuffer = Buffer.from(token);
    const apiKeyBuffer = Buffer.from(authConfig.apiKey);

    // Check length first - different lengths would cause timingSafeEqual to throw
    // Note: Length check itself leaks length info, but this is acceptable
    // since API keys should be randomly generated with fixed length
    if (
      tokenBuffer.length !== apiKeyBuffer.length ||
      !timingSafeEqual(tokenBuffer, apiKeyBuffer)
    ) {
      const response: UnauthorizedResponse = {
        error: "Unauthorized",
        message: "Invalid API key",
        status: HTTP_STATUS_UNAUTHORIZED,
      };
      res.status(HTTP_STATUS_UNAUTHORIZED).json(response);
      return;
    }

    // Auth passed
    next();
  };
}
