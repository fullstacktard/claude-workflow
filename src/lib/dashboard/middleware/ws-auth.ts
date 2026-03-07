/**
 * WebSocket Authentication Utility
 *
 * Validates WebSocket upgrade requests using query parameter tokens.
 * Mirrors the Express auth middleware logic for consistency, but operates
 * on raw IncomingMessage (not Express Request) since WebSocket upgrades
 * bypass Express entirely.
 *
 * @module ws-auth
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { AuthConfig } from "./auth.js";

/** Localhost IP addresses for bypass detection */
const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Validate WebSocket upgrade request authentication.
 *
 * Auth token can come from:
 * 1. Query parameter: ?token=<api-key> (browser WebSocket connections)
 * 2. Authorization header: Bearer <api-key> (non-browser clients like wscat)
 *
 * @param req - The HTTP upgrade request (raw IncomingMessage, not Express Request)
 * @param url - Pre-parsed URL from the upgrade handler (avoids re-parsing)
 * @param config - Auth configuration from getAuthConfig()
 * @returns true if request is authenticated, false otherwise
 */
export function validateWebSocketAuth(
  req: IncomingMessage,
  url: URL,
  config: AuthConfig
): boolean {
  // Auth disabled = allow all connections
  if (!config.enabled) {
    return true;
  }

  // Localhost bypass (matches Express middleware behavior)
  if (config.localhostBypass) {
    const ip = req.socket.remoteAddress ?? "";
    if (LOCALHOST_IPS.has(ip)) {
      return true;
    }
  }

  // Try query parameter first (browser WebSocket connections cannot set headers)
  let token = url.searchParams.get("token") ?? "";

  // Fall back to Authorization header (non-browser clients, e.g., curl, wscat)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  // No token provided
  if (!token) {
    return false;
  }

  // Timing-safe comparison (same pattern as auth.ts middleware)
  const tokenBuffer = Buffer.from(token);
  const apiKeyBuffer = Buffer.from(config.apiKey);

  // Length check first -- different lengths would cause timingSafeEqual to throw.
  // Note: Length check leaks length info, acceptable since API keys have fixed random length.
  if (tokenBuffer.length !== apiKeyBuffer.length) {
    return false;
  }

  return timingSafeEqual(tokenBuffer, apiKeyBuffer);
}
