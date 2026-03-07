/**
 * Status Router
 * REST API endpoints for system status monitoring:
 * - claude-proxy health and metrics
 * - OAuth usage limits
 * - Routing efficiency metrics
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

// Proxy URL getter - reads at runtime for testability
function getProxyUrl(): string {
  return process.env.FST_PROXY_URL ?? "http://localhost:4000";
}

import Docker from "dockerode";

import type OAuthUsageClient from "../oauth-usage-client.js";
import type { LogAggregatorService } from "../services/log-aggregator.js";

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Percentage multiplier
const PERCENTAGE_MULTIPLIER = 100;

/**
 * Dependencies for status router
 */
export interface StatusRouterDeps {
  /** Log aggregator for routing stats */
  logAggregator?: LogAggregatorService;
  /** OAuth usage client */
  oauthClient?: OAuthUsageClient;
}

/**
 * Endpoint status from proxy health check
 */
interface EndpointStatus {
  /** Endpoint name/identifier */
  name: string;
  /** Whether endpoint is healthy */
  healthy: boolean;
  /** Error message if unhealthy (optional) */
  error?: string;
}

/**
 * Proxy status response
 */
export interface ProxyStatusResponse {
  /** Number of errors encountered */
  errors: number;
  /** Error message if monitor not configured */
  error?: string;
  /** Array of healthy endpoint objects from proxy health check */
  healthyEndpoints: EndpointStatus[];
  /** ISO timestamp of last health check */
  lastCheck: string;
  /** Port proxy is listening on */
  port: number;
  /** Number of requests processed */
  requests: number;
  /** Whether proxy is currently running */
  running: boolean;
  /** Array of unhealthy endpoint objects from proxy health check */
  unhealthyEndpoints: EndpointStatus[];
  /** Uptime in seconds */
  uptime: number;
}

/**
 * OAuth usage period metrics
 */
interface UsagePeriod {
  /** Limit value (estimated) */
  limit: number;
  /** Usage percentage (0-100) */
  percentage: number;
  /** Human-readable time until reset */
  resetsIn: string;
  /** Used value (estimated from percentage) */
  used: number;
}

/**
 * OAuth usage response
 */
export interface OAuthUsageResponse {
  /** Error message if client not configured */
  error?: string;
  /** Five-hour rolling window usage */
  fiveHour?: UsagePeriod;
  /** ISO timestamp of last update */
  lastUpdated: string;
  /** Seven-day rolling window usage (closest to "daily" in API) */
  sevenDay?: UsagePeriod;
}

/**
 * Route breakdown entry
 */
interface RouteBreakdown {
  /** Number of requests routed to this target */
  count: number;
  /** Percentage of total routed requests */
  percentage: number;
  /** Route target (model/agent/skill) */
  route: string;
}

/**
 * Routing efficiency response
 */
export interface RoutingEfficiencyResponse {
  /** Breakdown by route target */
  breakdown: RouteBreakdown[];
  /** Estimated cost savings in USD */
  costSavings: number;
  /** Routing efficiency percentage (0-100) */
  efficiency: number;
  /** Number of requests that were routed */
  routedRequests: number;
  /** Total number of requests */
  totalRequests: number;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Create status router with monitoring dependencies
 */
export function createStatusRouter(deps: StatusRouterDeps): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/status/proxy - Get claude-proxy health and metrics
   * Uses HTTP health check to determine if proxy is running
   */
  router.get("/proxy", async (_req: Request, res: Response): Promise<void> => {
    try {
      let running = false;
      let healthyEndpoints: EndpointStatus[] = [];
      let unhealthyEndpoints: EndpointStatus[] = [];

      // Try HTTP health check
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);

        const healthResponse = await fetch(`${getProxyUrl()}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (healthResponse.ok) {
          running = true;
          // Try to parse health response for endpoint counts
          try {
            const healthData = (await healthResponse.json()) as {
              healthy_endpoints?: unknown[];
              unhealthy_endpoints?: unknown[];
            };
            healthyEndpoints = Array.isArray(healthData.healthy_endpoints)
              ? healthData.healthy_endpoints.map((ep) => ({
                name: typeof ep === "string" ? ep : (ep as { model?: string }).model ?? "unknown",
                healthy: true,
              }))
              : [];
            unhealthyEndpoints = Array.isArray(healthData.unhealthy_endpoints)
              ? healthData.unhealthy_endpoints.map((ep) => ({
                name: typeof ep === "string" ? ep : (ep as { model?: string }).model ?? "unknown",
                healthy: false,
                error: typeof ep === "object" && ep !== null ? (ep as { error?: string }).error : undefined,
              }))
              : [];
          } catch {
            // Ignore JSON parse errors
          }
        }
      } catch {
        // Proxy not reachable
        running = false;
      }

      const response: ProxyStatusResponse = {
        errors: 0, // No longer tracked via file monitor
        healthyEndpoints,
        lastCheck: new Date().toISOString(),
        port: 4000,
        requests: 0, // No longer tracked via file monitor
        running,
        unhealthyEndpoints,
        uptime: 0, // No longer tracked via file monitor
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[status/proxy] Error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get proxy status",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/status/oauth - Get OAuth usage limits
   */
  router.get("/oauth", async (_req: Request, res: Response): Promise<void> => {
    try {
      if (deps.oauthClient === undefined) {
        const errorResponse: OAuthUsageResponse = {
          error: "OAuth client not configured",
          lastUpdated: new Date().toISOString(),
        };
        res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json(errorResponse);
        return;
      }

      const usage = await deps.oauthClient.fetchUsage();

      if (usage === undefined) {
        const errorResponse: OAuthUsageResponse = {
          error: "Unable to fetch usage data",
          lastUpdated: new Date().toISOString(),
        };
        res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json(errorResponse);
        return;
      }

      // Estimate limits based on typical Claude Max tier
      // These are approximations since API only returns utilization percentages
      const FIVE_HOUR_LIMIT_ESTIMATE =100_000;
      const SEVEN_DAY_LIMIT_ESTIMATE = 500_000;

      const response: OAuthUsageResponse = {
        fiveHour: {
          limit: FIVE_HOUR_LIMIT_ESTIMATE,
          percentage: usage.fiveHour.percentage,
          resetsIn: usage.fiveHour.resetsIn,
          used: Math.round(
            (usage.fiveHour.percentage / PERCENTAGE_MULTIPLIER) * FIVE_HOUR_LIMIT_ESTIMATE
          ),
        },
        lastUpdated: usage.lastUpdated.toISOString(),
        sevenDay: {
          limit: SEVEN_DAY_LIMIT_ESTIMATE,
          percentage: usage.sevenDay.percentage,
          resetsIn: usage.sevenDay.resetsIn,
          used: Math.round(
            (usage.sevenDay.percentage / PERCENTAGE_MULTIPLIER) * SEVEN_DAY_LIMIT_ESTIMATE
          ),
        },
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[status/oauth] Error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get OAuth usage",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/status/routing - Get routing efficiency metrics
   */
  router.get("/routing", async (_req: Request, res: Response): Promise<void> => {
    try {
      // Use LogAggregator to get routing stats if available
      if (deps.logAggregator !== undefined) {
        const stats = await deps.logAggregator.getStats();

        // Build breakdown from agent and skill counts
        const breakdown: RouteBreakdown[] = [];
        const allCounts = [
          ...stats.agentCounts.map((a) => ({ count: a.count, route: a.name })),
          ...stats.skillCounts.map((s) => ({ count: s.count, route: s.name })),
        ];

        // Sort by count descending and calculate percentages
        allCounts.sort((a, b) => b.count - a.count);

        for (const entry of allCounts) {
          breakdown.push({
            count: entry.count,
            percentage:
              stats.totalDecisions > 0
                ? Math.round((entry.count / stats.totalDecisions) * PERCENTAGE_MULTIPLIER)
                : 0,
            route: entry.route,
          });
        }

        const response: RoutingEfficiencyResponse = {
          breakdown,
          costSavings: 0, // Cost tracking not implemented yet
          efficiency:
            stats.totalDecisions > 0
              ? Math.round((stats.followedCount / stats.totalDecisions) * PERCENTAGE_MULTIPLIER)
              : 0,
          routedRequests: stats.followedCount,
          totalRequests: stats.totalDecisions,
        };

        res.status(HTTP_STATUS_OK).json(response);
        return;
      }

      // No data sources available
      const response: RoutingEfficiencyResponse = {
        breakdown: [],
        costSavings: 0,
        efficiency: 0,
        routedRequests: 0,
        totalRequests: 0,
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[status/routing] Error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get routing metrics",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/status/docker - Get Docker socket and container status for debugging
   * This endpoint helps diagnose Docker log streaming issues
   */
  router.get("/docker", async (_req: Request, res: Response): Promise<void> => {
    try {
      const docker = new Docker({
        socketPath: "/var/run/docker.sock",
      });

      // Test Docker socket connection
      let socketAccessible = false;
      let socketError: string | undefined;
      try {
        await docker.ping();
        socketAccessible = true;
      } catch (error) {
        socketError = (error as Error).message;
      }

      // List all containers
      let containers: Array<{
        name: string;
        state: string;
        status: string;
        id: string;
      }> = [];

      if (socketAccessible) {
        try {
          const containerList = await docker.listContainers({ all: true });
          containers = containerList.map(c => ({
            name: c.Names?.[0]?.replace(/^\//, "") ?? "unknown",
            state: c.State ?? "unknown",
            status: c.Status ?? "unknown",
            id: c.Id?.slice(0, 12) ?? "unknown",
          }));
        } catch (error) {
          socketError = (error as Error).message;
        }
      }

      // Check specific target containers for log streaming
      const targetContainers = ["claude-proxy", "mcp-proxy"];
      const targetStatus: Record<string, {
        found: boolean;
        running: boolean;
        status?: string;
        error?: string;
      }> = {};

      for (const name of targetContainers) {
        const container = containers.find(c => c.name === name);
        targetStatus[name] = container
          ? {
            found: true,
            running: container.state === "running",
            status: container.status,
          }
          : {
            error: "Container not found",
            found: false,
            running: false,
          };
      }

      const response = {
        socketPath: "/var/run/docker.sock",
        socketAccessible,
        socketError,
        containerCount: containers.length,
        containers,
        targetContainers: targetStatus,
        timestamp: new Date().toISOString(),
      };

      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      console.error("[status/docker] Error:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get Docker status",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}

/**
 * Export types for external use
 */
export type {
  ErrorResponse,
  RouteBreakdown,
  UsagePeriod,
};
