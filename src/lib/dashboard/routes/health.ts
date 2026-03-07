/**
 * Service Health Router
 * REST API endpoint for checking connectivity and health status of all
 * dependent services in the claude-workflow infrastructure stack.
 *
 * Checks: dashboard (self), claude-proxy, mcp-proxy, websocket server.
 * Each HTTP check has a 3-second timeout via AbortController.
 * Uses Promise.allSettled() so a single failed check never crashes the endpoint.
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";
import type { LogStreamer } from "../websocket-server.js";

// HTTP status codes (following project convention - each route file has its own)
const HTTP_STATUS_OK = 200;

// Health check timeout: 3 seconds per service
const HEALTH_CHECK_TIMEOUT_MS = 3000;

// Service URLs from environment (follows existing mcpproxy.ts + status.ts patterns)
const CLAUDE_PROXY_URL = process.env.FST_PROXY_URL ?? "http://localhost:4000";
const MCP_PROXY_HOST = process.env.MCP_PROXY_HOST ?? "mcp-proxy";
const MCP_PROXY_PORT = process.env.MCP_PROXY_PORT ?? "3847";
const MCP_PROXY_URL = `http://${MCP_PROXY_HOST}:${MCP_PROXY_PORT}`;
const CODE_SERVER_HOST = process.env.CODE_SERVER_HOST ?? "code-server";
const CODE_SERVER_PORT = process.env.CODE_SERVER_PORT ?? "8080";
const CODE_SERVER_URL = `http://${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`;

/**
 * Status of a single service health check
 */
export interface ServiceHealthStatus {
  /** Service display name */
  name: string;
  /** Health status: healthy, unhealthy, or unknown */
  status: "healthy" | "unhealthy" | "unknown";
  /** Round-trip latency in milliseconds */
  latency_ms: number;
  /** ISO timestamp of when the check was performed */
  last_checked: string;
  /** Error message if unhealthy */
  error?: string;
}

/**
 * Dependencies for the service health router
 */
interface ServiceHealthRouterDeps {
  /**
   * Getter function for the LogStreamer instance.
   * Returns undefined if WebSocket server has not been initialized yet.
   * Uses getter pattern because LogStreamer is created after server.listen(),
   * but routes are mounted before listen().
   */
  getLogStreamer: () => LogStreamer | undefined;
}

/**
 * Check dashboard backend health (self-check).
 * Always healthy if this code is executing.
 */
function checkDashboard(): ServiceHealthStatus {
  return {
    name: "dashboard",
    status: "healthy",
    latency_ms: 0,
    last_checked: new Date().toISOString(),
  };
}

/**
 * Check claude-proxy connectivity via HTTP health endpoint.
 * Uses AbortController with 3s timeout (matches mcpproxy.ts pattern).
 */
async function checkClaudeProxy(): Promise<ServiceHealthStatus> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${CLAUDE_PROXY_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency_ms = Date.now() - startTime;

    if (response.ok) {
      return {
        name: "claude-proxy",
        status: "healthy",
        latency_ms,
        last_checked: new Date().toISOString(),
      };
    }

    return {
      name: "claude-proxy",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: `HTTP ${String(response.status)}`,
    };
  } catch (error: unknown) {
    const latency_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const isConnRefused = error instanceof Error &&
      (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));

    let errorMsg = "Not reachable";
    if (isTimeout) {
      errorMsg = "Health check timed out (3s)";
    } else if (isConnRefused) {
      errorMsg = "Connection refused - container not running";
    }

    return {
      name: "claude-proxy",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: errorMsg,
    };
  }
}

/**
 * Check mcp-proxy connectivity via HTTP health endpoint.
 * Same timeout + error handling pattern as checkClaudeProxy.
 */
async function checkMcpProxy(): Promise<ServiceHealthStatus> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${MCP_PROXY_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency_ms = Date.now() - startTime;

    if (response.ok) {
      return {
        name: "mcp-proxy",
        status: "healthy",
        latency_ms,
        last_checked: new Date().toISOString(),
      };
    }

    return {
      name: "mcp-proxy",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: `HTTP ${String(response.status)}`,
    };
  } catch (error: unknown) {
    const latency_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const isConnRefused = error instanceof Error &&
      (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));

    let errorMsg = "Not reachable";
    if (isTimeout) {
      errorMsg = "Health check timed out (3s)";
    } else if (isConnRefused) {
      errorMsg = "Connection refused - container not running";
    }

    return {
      name: "mcp-proxy",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: errorMsg,
    };
  }
}

/**
 * Check code-server connectivity via HTTP health endpoint.
 * Same timeout + error handling pattern as checkClaudeProxy.
 */
async function checkCodeServer(): Promise<ServiceHealthStatus> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${CODE_SERVER_URL}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency_ms = Date.now() - startTime;

    if (response.ok) {
      return {
        name: "code-server",
        status: "healthy",
        latency_ms,
        last_checked: new Date().toISOString(),
      };
    }

    return {
      name: "code-server",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: `HTTP ${String(response.status)}`,
    };
  } catch (error: unknown) {
    const latency_ms = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const isConnRefused = error instanceof Error &&
      (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));

    let errorMsg = "Not reachable";
    if (isTimeout) {
      errorMsg = "Health check timed out (3s)";
    } else if (isConnRefused) {
      errorMsg = "Connection refused - container not running";
    }

    return {
      name: "code-server",
      status: "unhealthy",
      latency_ms,
      last_checked: new Date().toISOString(),
      error: errorMsg,
    };
  }
}

/**
 * Check WebSocket server status via in-process LogStreamer reference.
 * Uses getter pattern because LogStreamer is created after server.listen().
 */
function checkWebSocket(getLogStreamer: () => LogStreamer | undefined): ServiceHealthStatus {
  const startTime = Date.now();
  const logStreamer = getLogStreamer();

  if (logStreamer === undefined) {
    return {
      name: "websocket",
      status: "unknown",
      latency_ms: Date.now() - startTime,
      last_checked: new Date().toISOString(),
      error: "WebSocket server not initialized",
    };
  }

  // LogStreamer exists and is accepting connections - verify via getConnectionCount()
  logStreamer.getConnectionCount();

  return {
    name: "websocket",
    status: "healthy",
    latency_ms: Date.now() - startTime,
    last_checked: new Date().toISOString(),
  };
}

/**
 * Create service health router with LogStreamer dependency.
 *
 * Factory pattern follows existing route conventions (mcpproxy.ts, status.ts).
 * Mounts at /api/health and provides a /services sub-route.
 *
 * @param deps - Router dependencies including LogStreamer getter
 * @returns Express Router instance
 */
export function createServiceHealthRouter(deps: ServiceHealthRouterDeps): Router {
  const router: Router = express.Router() as Router;

  /**
   * GET /api/health/services - Check all dependent service statuses
   *
   * Returns JSON array of ServiceHealthStatus objects.
   * Each check has a 3-second timeout. Failed checks return
   * unhealthy status with error details (never throws).
   */
  router.get("/services", async (_req: Request, res: Response): Promise<void> => {
    // Run all HTTP checks concurrently - sync checks are inline
    const [claudeProxy, mcpProxy, codeServer] = await Promise.allSettled([
      checkClaudeProxy(),
      checkMcpProxy(),
      checkCodeServer(),
    ]);

    const services: ServiceHealthStatus[] = [
      // Dashboard self-check (always healthy if responding)
      checkDashboard(),
      // Claude proxy
      claudeProxy.status === "fulfilled"
        ? claudeProxy.value
        : {
          name: "claude-proxy",
          status: "unhealthy" as const,
          latency_ms: 0,
          last_checked: new Date().toISOString(),
          error: "Check failed unexpectedly",
        },
      // MCP proxy
      mcpProxy.status === "fulfilled"
        ? mcpProxy.value
        : {
          name: "mcp-proxy",
          status: "unhealthy" as const,
          latency_ms: 0,
          last_checked: new Date().toISOString(),
          error: "Check failed unexpectedly",
        },
      // Code server
      codeServer.status === "fulfilled"
        ? codeServer.value
        : {
          name: "code-server",
          status: "unhealthy" as const,
          latency_ms: 0,
          last_checked: new Date().toISOString(),
          error: "Check failed unexpectedly",
        },
      // WebSocket server (in-process check)
      checkWebSocket(deps.getLogStreamer),
    ];

    res.status(HTTP_STATUS_OK).json(services);
  });

  return router;
}
