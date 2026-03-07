/**
 * MCP Proxy Router
 * REST API endpoints for mcp-proxy container monitoring via HTTP health checks.
 * Connects to mcp-proxy container directly via Docker network (no Docker CLI needed).
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import { exec } from "node:child_process";

import {
  McpConfigManager,
  validateServerConfig,
  validateServerUpdate,
  validateServerName,
  getMcpConfigPath,
  readMcpProxyConfig,
  writeMcpProxyConfig,
  syncProxyConfigFile,
  validateProxyConfig,
} from "../services/mcp-config-manager.js";
import type { McpServerConfig, McpProxyConfig } from "../services/mcp-config-manager.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// MCP Proxy container name
const MCPPROXY_CONTAINER_NAME = "mcp-proxy";

/**
 * Restart mcp-proxy container to pick up config changes
 * Similar to claude-proxy reload pattern
 * @returns true if container was restarted successfully
 */
async function reloadMcpproxyConfig(): Promise<boolean> {
  try {
    // Check if container is running
    const { stdout: status } = await execAsync(
      `docker inspect -f '{{.State.Running}}' ${MCPPROXY_CONTAINER_NAME} 2>/dev/null`
    );

    if (status.trim() !== "true") {
      console.log("[mcpproxy-config] Container not running, skip reload");
      return false;
    }

    // Restart the container to pick up env var changes
    await execAsync(`docker restart ${MCPPROXY_CONTAINER_NAME}`);
    console.log("[mcpproxy-config] Restarted mcp-proxy container to apply config changes");
    return true;
  } catch (error) {
    console.error("[mcpproxy-config] Failed to restart:", (error as Error).message);
    return false;
  }
}

/**
 * Get the mcp-proxy .env file path
 * Stores API keys in ~/.mcp-proxy/.env which is mounted into the mcp-proxy container
 */
function getMcpProxyEnvFilePath(): string {
  const envDir = path.join(process.env.HOME || "", ".mcp-proxy");
  // Ensure directory exists
  if (!existsSync(envDir)) {
    mkdirSync(envDir, { recursive: true });
  }
  return path.join(envDir, ".env");
}

/**
 * MCP API key configuration
 */
interface McpApiKeyConfig {
  name: string;
  envVar: string;
  description: string;
  requiredFor: string;
}

/**
 * Known MCP API keys that can be configured
 */
const MCP_API_KEYS: McpApiKeyConfig[] = [
  { name: "EXA", envVar: "EXA_API_KEY", description: "Neural web search", requiredFor: "exa" },
  { name: "v0", envVar: "V0_API_KEY", description: "UI component generation", requiredFor: "v0" },
  { name: "Replicate", envVar: "REPLICATE_API_TOKEN", description: "AI model inference", requiredFor: "replicate" },
  { name: "Ref Tools", envVar: "REF_API_KEY", description: "Documentation search", requiredFor: "ref" },
];

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_CREATED = 201;
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;

// MCP Proxy connection settings
// In Docker: use container name. Outside Docker: use localhost
const MCP_PROXY_HOST = process.env.MCP_PROXY_HOST ?? "mcp-proxy";
const MCP_PROXY_PORT = process.env.MCP_PROXY_PORT ?? "3847";
const MCP_PROXY_URL = `http://${MCP_PROXY_HOST}:${MCP_PROXY_PORT}`;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Child server status for display
 */
interface ChildServerStatus {
  /** Server identifier (e.g., 'chrome-devtools', 'exa') */
  name: string;
  /** Current state: running, stopped, error */
  state: "running" | "stopped" | "error";
  /** Tool count from this server (if known) */
  toolCount?: number;
}

/**
 * Tool category breakdown
 */
interface ToolCategory {
  /** Category name */
  category: string;
  /** Number of tools in this category */
  count: number;
}

/**
 * MCP Proxy status response
 */
export interface McpProxyStatusResponse {
  /** Is mcp-proxy reachable? */
  containerRunning: boolean;
  /** Status message */
  message: string;
  /** Port mcp-proxy is listening on */
  port: number;
  /** Uptime in seconds (if available) */
  uptime?: number;
  /** Health check response time in ms */
  responseTimeMs?: number;
}

/**
 * MCP Proxy metrics response
 */
export interface McpProxyMetricsResponse {
  /** Total number of registered tools */
  totalTools: number;
  /** Tools by category */
  categories: ToolCategory[];
  /** Number of currently pending requests */
  pendingRequests: number;
  /** Active child servers (if available) */
  activeChildren: ChildServerStatus[];
  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Child server counts from health endpoint
 */
interface ChildServerCounts {
  crashed?: number;
  pending?: number;
  running?: number;
  starting?: number;
  stopped?: number;
  total?: number;
}

/**
 * Health check response from mcp-proxy
 */
interface HealthCheckResponse {
  childServers?: ChildServerCounts;
  name?: string;
  status?: string;
  timestamp?: string;
  uptime?: number;
}

/**
 * Create mcp-proxy router - connects via HTTP, no Docker CLI needed
 */
export function createMcpProxyRouter(): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/mcpproxy/status - Check if mcp-proxy is reachable via HTTP
   */
  router.get("/status", async (_req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      // Try to reach mcp-proxy health endpoint
      const healthResponse = await fetch(`${MCP_PROXY_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - startTime;

      if (healthResponse.ok) {
        let uptime: number | undefined;
        try {
          const healthData = (await healthResponse.json()) as HealthCheckResponse;
          uptime = healthData.uptime;
        } catch {
          // Health endpoint may not return JSON
        }

        const response: McpProxyStatusResponse = {
          containerRunning: true,
          message: "MCP Proxy is running",
          port: Number.parseInt(MCP_PROXY_PORT, 10),
          responseTimeMs,
          uptime,
        };
        res.status(HTTP_STATUS_OK).json(response);
        return;
      }

      // Got a response but not OK
      const response: McpProxyStatusResponse = {
        containerRunning: false,
        message: `MCP Proxy returned status ${healthResponse.status}`,
        port: Number.parseInt(MCP_PROXY_PORT, 10),
        responseTimeMs,
      };
      res.status(HTTP_STATUS_OK).json(response);
    } catch (error: unknown) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const isConnRefused = error instanceof Error &&
        (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));

      let message = "MCP Proxy is not reachable";
      if (isTimeout) {
        message = "MCP Proxy health check timed out";
      } else if (isConnRefused) {
        message = "MCP Proxy container is not running";
      }

      const response: McpProxyStatusResponse = {
        containerRunning: false,
        message,
        port: Number.parseInt(MCP_PROXY_PORT, 10),
        responseTimeMs,
      };
      res.status(HTTP_STATUS_OK).json(response);
    }
  });

  /**
   * GET /api/mcpproxy/metrics - Get MCP Proxy metrics from health endpoint
   * Note: mcp-proxy doesn't have a /metrics endpoint, so we extract data from /health
   */
  router.get("/metrics", async (_req: Request, res: Response): Promise<void> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      // Fetch from /health since /metrics doesn't exist on mcp-proxy
      const healthResponse = await fetch(`${MCP_PROXY_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (healthResponse.ok) {
        const healthData = (await healthResponse.json()) as HealthCheckResponse;
        const childServers = healthData.childServers;

        // Build active children list from health data
        const activeChildren: ChildServerStatus[] = [];
        if (childServers) {
          // We don't have individual server names from health endpoint,
          // so we create summary entries based on counts
          if (childServers.running && childServers.running > 0) {
            activeChildren.push({
              name: `${String(childServers.running)} running`,
              state: "running",
            });
          }
          if (childServers.starting && childServers.starting > 0) {
            activeChildren.push({
              name: `${String(childServers.starting)} starting`,
              state: "running",
            });
          }
          if (childServers.stopped && childServers.stopped > 0) {
            activeChildren.push({
              name: `${String(childServers.stopped)} stopped`,
              state: "stopped",
            });
          }
          if (childServers.crashed && childServers.crashed > 0) {
            activeChildren.push({
              name: `${String(childServers.crashed)} crashed`,
              state: "error",
            });
          }
        }

        const response: McpProxyMetricsResponse = {
          activeChildren,
          categories: [], // Not available from health endpoint
          lastUpdated: healthData.timestamp ?? new Date().toISOString(),
          pendingRequests: childServers?.pending ?? 0,
          totalTools: childServers?.total ?? 0,
        };

        res.status(HTTP_STATUS_OK).json(response);
        return;
      }

      // Return empty metrics if endpoint not available
      const emptyMetrics: McpProxyMetricsResponse = {
        activeChildren: [],
        categories: [],
        lastUpdated: new Date().toISOString(),
        pendingRequests: 0,
        totalTools: 0,
      };
      res.status(HTTP_STATUS_OK).json(emptyMetrics);
    } catch {
      // mcp-proxy not reachable - return empty metrics
      const emptyMetrics: McpProxyMetricsResponse = {
        activeChildren: [],
        categories: [],
        lastUpdated: new Date().toISOString(),
        pendingRequests: 0,
        totalTools: 0,
      };
      res.status(HTTP_STATUS_OK).json(emptyMetrics);
    }
  });

  /**
   * POST /api/mcpproxy/rebuild - Rebuild and restart mcp-proxy container
   */
  router.post("/rebuild", (_req: Request, res: Response): void => {
    console.log("[mcpproxy-rebuild] POST /api/mcpproxy/rebuild");

    const handleRebuild = async (): Promise<void> => {
      try {
        // Check if container exists
        try {
          await execAsync("docker inspect mcp-proxy --format='{{.State.Status}}'");
        } catch {
          // Container doesn't exist
          res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
            error: "MCP Proxy container not found. Run 'docker compose up mcp-proxy' first."
          });
          return;
        }

        // Stop container
        try {
          await execAsync("docker stop mcp-proxy");
          console.log("[mcpproxy-rebuild] Container stopped");
        } catch {
          // Ignore if already stopped
        }

        // Remove container
        try {
          await execAsync("docker rm mcp-proxy");
          console.log("[mcpproxy-rebuild] Container removed");
        } catch {
          // Ignore if already removed
        }

        // Rebuild and start using docker compose
        const { stdout, stderr } = await execAsync("docker compose up mcp-proxy -d --build 2>&1");

        if (stderr && stderr.includes("error")) {
          throw new Error(stderr);
        }

        console.log("[mcpproxy-rebuild] Container rebuilt and started:", stdout);

        res.status(HTTP_STATUS_OK).json({
          message: "mcp-proxy rebuilt and restarted successfully",
          timestamp: new Date().toISOString()
        });
      } catch (error: unknown) {
        console.error("[mcpproxy-rebuild] Error:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to rebuild mcp-proxy",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleRebuild();
  });

  /**
   * POST /api/mcpproxy/reload - Reload MCP proxy config without full rebuild
   *
   * This is faster than rebuild (~3-5 seconds vs ~30-60 seconds) because it only
   * restarts the container, which picks up the new config from the mounted file.
   *
   * Workflow:
   * 1. Verify config file exists at ~/.mcp-proxy/mcp-config.json
   * 2. Check if container is running
   * 3. Restart container (picks up new config)
   * 4. Wait for health check to pass
   * 5. Return success with timing metrics
   */
  router.post("/reload", (_req: Request, res: Response): void => {
    console.log("[mcpproxy-reload] POST /api/mcpproxy/reload");

    const handleReload = async (): Promise<void> => {
      try {
        // Step 1: Verify config file exists
        const configPath = getMcpConfigPath();
        if (!existsSync(configPath)) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Config file not found",
            message: `Expected config at ${configPath}. Generate config first via POST /api/mcpproxy/config/sync.`,
            configPath,
          });
          return;
        }

        // Step 2: Check if container is running
        try {
          const { stdout } = await execAsync(
            "docker inspect mcp-proxy --format='{{.State.Running}}'"
          );
          const isRunning = stdout.trim().replaceAll("'", "") === "true";

          if (!isRunning) {
            res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
              error: "Container not running",
              message: "MCP Proxy container is not running. Start it first with 'docker compose up mcp-proxy -d'",
            });
            return;
          }
        } catch {
          res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
            error: "Container not found",
            message: "MCP Proxy container not found. Run 'docker compose up mcp-proxy -d' first.",
          });
          return;
        }

        // Step 3: Restart container (picks up new config from mounted file)
        console.log("[mcpproxy-reload] Restarting container...");
        const startTime = Date.now();

        await execAsync("docker compose restart mcp-proxy");

        const reloadTimeMs = Date.now() - startTime;
        console.log(`[mcpproxy-reload] Container restarted in ${reloadTimeMs}ms`);

        // Step 4: Wait for container to be healthy
        const maxWaitMs = 10_000; // 10 seconds
        const pollIntervalMs = 500;
        let waited = 0;
        let healthy = false;

        while (waited < maxWaitMs) {
          try {
            const healthResponse = await fetch(`${MCP_PROXY_URL}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            if (healthResponse.ok) {
              healthy = true;
              break;
            }
          } catch {
            // Health check failed, container still starting
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          waited += pollIntervalMs;
        }

        const totalTimeMs = Date.now() - startTime;

        if (!healthy) {
          res.status(HTTP_STATUS_OK).json({
            message: "Reload triggered but health check pending",
            reloadTimeMs,
            totalTimeMs,
            healthy: false,
            warning: "Container restarted but health check not confirmed. Check logs if issues persist.",
          });
          return;
        }

        res.status(HTTP_STATUS_OK).json({
          message: "MCP Proxy config reloaded successfully",
          reloadTimeMs,
          totalTimeMs,
          healthy: true,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        console.error("[mcpproxy-reload] Error:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to reload MCP Proxy config",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleReload();
  });

  // =========================================================================
  // MCP Proxy Config File Endpoints
  // These manage the mounted config file at ~/.mcp-proxy/mcp-config.json
  // =========================================================================

  /**
   * GET /api/mcpproxy/config - Get current MCP proxy config from file
   */
  router.get("/config", (_req: Request, res: Response): void => {
    try {
      const config = readMcpProxyConfig();
      const configPath = getMcpConfigPath();
      res.status(HTTP_STATUS_OK).json({
        config,
        configPath,
        exists: existsSync(configPath),
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      console.error("[mcpproxy-config] Error reading config:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to read config",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/mcpproxy/config - Replace full MCP proxy config
   *
   * Use this to directly set the proxy config. Note that this replaces
   * the entire config - use POST /api/mcpproxy/servers for individual server changes.
   *
   * After updating, call POST /api/mcpproxy/reload to apply changes.
   */
  router.put("/config", (req: Request, res: Response): void => {
    try {
      const body = req.body as McpProxyConfig;

      // Validate config structure
      const validation = validateProxyConfig(body);
      if (!validation.valid) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid config",
          message: validation.errors.join("; "),
        });
        return;
      }

      writeMcpProxyConfig(body);

      res.status(HTTP_STATUS_OK).json({
        message: "Config saved successfully",
        configPath: getMcpConfigPath(),
        note: "Call POST /api/mcpproxy/reload to apply changes",
      });
    } catch (error: unknown) {
      console.error("[mcpproxy-config] Error writing config:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to write config",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/mcpproxy/config/sync - Sync config file from stored servers
   *
   * Regenerates ~/.mcp-proxy/mcp-config.json from ~/.mcp-proxy/mcp-servers.json.
   * This is useful after adding/removing servers via the /servers endpoints.
   *
   * After syncing, call POST /api/mcpproxy/reload to apply changes.
   */
  router.post("/config/sync", (_req: Request, res: Response): void => {
    console.log("[mcpproxy-config] POST /api/mcpproxy/config/sync");

    const handleSync = async (): Promise<void> => {
      try {
        const config = await syncProxyConfigFile();
        res.status(HTTP_STATUS_OK).json({
          message: "Config synced successfully",
          configPath: getMcpConfigPath(),
          serverCount: Object.keys(config.childServers).length,
          servers: Object.keys(config.childServers),
          note: "Call POST /api/mcpproxy/reload to apply changes",
        });
      } catch (error: unknown) {
        console.error("[mcpproxy-config] Error syncing config:", error);
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          error: "Failed to sync config",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    void handleSync();
  });

  /**
   * POST /api/mcpproxy/start - Not available in Docker-to-Docker mode
   */
  router.post("/start", (_req: Request, res: Response): void => {
    const errorResponse: ErrorResponse = {
      error: "Container management not available",
      message: "Use docker compose to manage mcp-proxy container",
    };
    res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
  });

  /**
   * POST /api/mcpproxy/stop - Not available in Docker-to-Docker mode
   */
  router.post("/stop", (_req: Request, res: Response): void => {
    const errorResponse: ErrorResponse = {
      error: "Container management not available",
      message: "Use docker compose to manage mcp-proxy container",
    };
    res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
  });

  /**
   * GET /api/mcpproxy/logs - Fetch container logs
   * Query params:
   *   - tail: number of lines (default 200)
   *   - since: timestamp to fetch logs since
   */
  router.get("/logs", (req: Request, res: Response): void => {
    console.log("[mcpproxy-logs] GET /api/mcpproxy/logs");

    const handleGetLogs = async (): Promise<void> => {
      try {
        // Sanitize tail parameter with strict bounds (1-10_000)
        const rawTail = Number(req.query.tail);
        const tail = Number.isNaN(rawTail) ? 200 : Math.min(Math.max(1, Math.floor(rawTail)), 10_000);

        // Fetch logs from Docker container (tail is guaranteed to be safe integer)
        const { stdout } = await execAsync(
          `docker logs mcp-proxy --tail ${String(tail)} 2>&1`
        );

        const logs = stdout.split("\n").filter((line: string) => line.trim() !== "");

        res.status(HTTP_STATUS_OK).json({
          containerRunning: true,
          logs,
          timestamp: new Date().toISOString()
        });
      } catch (error: unknown) {
        console.error("[mcpproxy-logs] Error fetching logs:", error);
        // Container might not be running
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch container logs",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleGetLogs();
  });

  /**
   * GET /api/mcpproxy/api-keys - Get configured MCP API keys status
   * Returns list of known API keys with their configuration status
   */
  router.get("/api-keys", (_req: Request, res: Response): void => {
    try {
      // Read env vars from the .env file (source of truth)
      const envPath = getMcpProxyEnvFilePath();
      let envContent = "";
      try {
        envContent = readFileSync(envPath, "utf8");
      } catch {
        // File doesn't exist
      }

      // Parse all env vars from the file
      const allEnvVars: Record<string, { value: string; maskedValue: string }> = {};
      const lines = envContent.split("\n");
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#")) continue;

        const equalsIndex = trimmedLine.indexOf("=");
        if (equalsIndex > 0) {
          const key = trimmedLine.slice(0, equalsIndex);
          const value = trimmedLine.slice(equalsIndex + 1);
          // Mask the value: show first 4 and last 4 chars if long enough
          let maskedValue = "";
          if (value.length > 12) {
            maskedValue = value.slice(0, 4) + "..." + value.slice(-4);
          } else if (value.length > 0) {
            maskedValue = "****";
          }
          allEnvVars[key] = { value, maskedValue };
        }
      }

      // Build API keys list with known keys and their status
      const apiKeys = MCP_API_KEYS.map((keyConfig) => ({
        ...keyConfig,
        isSet: allEnvVars[keyConfig.envVar]?.value ? true : false,
        maskedValue: allEnvVars[keyConfig.envVar]?.maskedValue ?? "",
      }));

      // Also include all env vars for the modal edit (with full values for editing)
      res.status(HTTP_STATUS_OK).json({
        apiKeys,
        envVars: Object.fromEntries(
          Object.entries(allEnvVars).map(([key, { value, maskedValue }]) => [key, { set: true, maskedValue, value }])
        )
      });
    } catch (error: unknown) {
      console.error("[mcpproxy] Error getting API keys:", error);
      // Return keys with unknown status if we can't check
      const apiKeys = MCP_API_KEYS.map((keyConfig) => ({
        ...keyConfig,
        isSet: false,
        maskedValue: "",
      }));
      res.status(HTTP_STATUS_OK).json({ apiKeys, envVars: {} });
    }
  });

  /**
   * PUT /api/mcpproxy/api-keys - Update an environment variable
   */
  router.put("/api-keys", (req: Request, res: Response): void => {
    console.log("[mcpproxy-api-keys] PUT /api/mcpproxy/api-keys");

    const handleUpdateApiKey = async (): Promise<void> => {
      try {
        const body = req.body as { envVar?: string; apiKey?: string };

        if (!body.envVar || body.apiKey === undefined) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid request",
            message: "Expected { envVar: string, apiKey: string }"
          });
          return;
        }

        // Validate env var name (alphanumeric + underscore only)
        if (!/^[A-Z][A-Z0-9_]*$/.test(body.envVar)) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid environment variable name",
            message: "Must start with uppercase letter, contain only A-Z, 0-9, _"
          });
          return;
        }

        // Read mcp-proxy .env file
        const envPath = getMcpProxyEnvFilePath();
        let envContent = "";
        let lines: string[] = [];

        try {
          envContent = readFileSync(envPath, "utf8");
          lines = envContent.split("\n");
        } catch {
          // File doesn't exist, create new
        }

        // Update or add the key
        const envVarPrefix = `${body.envVar}=`;
        let found = false;
        const updatedLines = lines.map((line) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith(envVarPrefix)) {
            found = true;
            return `${body.envVar}=${body.apiKey}`;
          }
          return line;
        });

        if (!found) {
          // Add new env var at the end (before any trailing empty lines)
          let insertIndex = updatedLines.length;
          while (insertIndex > 0 && updatedLines[insertIndex - 1].trim() === "") {
            insertIndex--;
          }
          updatedLines.splice(insertIndex, 0, `${body.envVar}=${body.apiKey}`);
        }

        // Write back to mcp-proxy .env file
        writeFileSync(envPath, updatedLines.filter(Boolean).join("\n") + "\n", "utf8");
        console.log(`[mcpproxy-api-keys] Updated ${body.envVar} in ~/.mcp-proxy/.env`);

        // Trigger container reload unless skipReload=true
        const skipReload = req.query.skipReload === "true";
        let reloadStatus: { reloaded: boolean; error?: string } = { reloaded: false };

        if (!skipReload) {
          try {
            const reloadSuccess = await reloadMcpproxyConfig();
            reloadStatus = {
              reloaded: reloadSuccess,
              error: reloadSuccess ? undefined : "Container not running or restart failed"
            };
          } catch (error) {
            reloadStatus = {
              reloaded: false,
              error: (error as Error).message
            };
          }
        }

        res.status(HTTP_STATUS_OK).json({
          success: true,
          message: "Environment variable saved successfully",
          reload: reloadStatus
        });
      } catch (error: unknown) {
        console.error("[mcpproxy-api-keys] Error:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to save environment variable",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleUpdateApiKey();
  });

  /**
   * DELETE /api/mcpproxy/api-keys - Remove an environment variable
   */
  router.delete("/api-keys", (req: Request, res: Response): void => {
    console.log("[mcpproxy-api-keys] DELETE /api/mcpproxy/api-keys");

    const handleDeleteApiKey = (): void => {
      try {
        const body = req.body as { envVar?: string };

        if (!body.envVar) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid request",
            message: "Expected { envVar: string }"
          });
          return;
        }

        // Read mcp-proxy .env file
        const envPath = getMcpProxyEnvFilePath();
        let envContent = "";
        let lines: string[] = [];

        try {
          envContent = readFileSync(envPath, "utf8");
          lines = envContent.split("\n");
        } catch {
          // File doesn't exist
        }

        // Remove the key
        const envVarPrefix = `${body.envVar}=`;
        const updatedLines = lines.filter((line) => {
          const trimmedLine = line.trim();
          return !trimmedLine.startsWith(envVarPrefix);
        });

        // Write back to mcp-proxy .env file
        writeFileSync(envPath, updatedLines.filter(Boolean).join("\n") + "\n", "utf8");
        console.log(`[mcpproxy-api-keys] Removed ${body.envVar} from ~/.mcp-proxy/.env`);

        res.status(HTTP_STATUS_OK).json({ message: "Environment variable removed successfully" });
      } catch (error: unknown) {
        console.error("[mcpproxy-api-keys] Error:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to remove API key",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    handleDeleteApiKey();
  });

  // =========================================================================
  // MCP Server Configuration CRUD Endpoints
  // =========================================================================

  /**
   * GET /api/mcpproxy/servers - List all configured MCP servers
   */
  router.get("/servers", (_req: Request, res: Response): void => {
    const handleListServers = async (): Promise<void> => {
      try {
        const configManager = new McpConfigManager();
        const servers = await configManager.listServers();

        res.status(HTTP_STATUS_OK).json({ servers });
      } catch (error: unknown) {
        console.error("[mcpproxy-servers] Error listing servers:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to list MCP servers",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleListServers();
  });

  /**
   * POST /api/mcpproxy/servers - Add new MCP server configuration
   */
  router.post("/servers", (req: Request, res: Response): void => {
    const handleAddServer = async (): Promise<void> => {
      try {
        const body = req.body as Partial<McpServerConfig>;

        // Validate required fields
        const validation = validateServerConfig(body);
        if (!validation.valid) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid server configuration",
            message: validation.errors.join("; ")
          });
          return;
        }

        const configManager = new McpConfigManager();

        // Check for duplicate name
        const existing = await configManager.getServer(body.name!);
        if (existing !== undefined) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Server already exists",
            message: `A server with name '${body.name}' already exists`
          });
          return;
        }

        const server = await configManager.addServer(body as McpServerConfig);

        // Auto-sync proxy config file so mcp-config.json stays in sync
        try {
          await syncProxyConfigFile();
        } catch (syncError) {
          console.warn("[mcpproxy-servers] Config sync failed after add:", syncError);
        }

        res.status(HTTP_STATUS_CREATED).json(server);
      } catch (error: unknown) {
        console.error("[mcpproxy-servers] Error adding server:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to add MCP server",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleAddServer();
  });

  /**
   * PUT /api/mcpproxy/servers/:name - Update existing MCP server configuration
   */
  router.put("/servers/:name", (req: Request, res: Response): void => {
    const handleUpdateServer = async (): Promise<void> => {
      const name = String(req.params.name);

      if (!name) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Server name required" });
        return;
      }

      // Validate server name from URL parameter
      const nameValidation = validateServerName(name);
      if (!nameValidation.valid) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid server name",
          message: nameValidation.errors.join("; ")
        });
        return;
      }

      try {
        const body = req.body as Partial<McpServerConfig>;

        // Validate update fields (name cannot be changed)
        const validation = validateServerUpdate(body);
        if (!validation.valid) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid server configuration",
            message: validation.errors.join("; ")
          });
          return;
        }

        const configManager = new McpConfigManager();

        // Check server exists
        const existing = await configManager.getServer(name);
        if (existing === undefined) {
          res.status(HTTP_STATUS_NOT_FOUND).json({
            error: "Server not found",
            message: `No server with name '${name}' exists`
          });
          return;
        }

        const updated = await configManager.updateServer(name, body);

        // Auto-sync proxy config file so mcp-config.json stays in sync
        try {
          await syncProxyConfigFile();
        } catch (syncError) {
          console.warn("[mcpproxy-servers] Config sync failed after update:", syncError);
        }

        res.status(HTTP_STATUS_OK).json(updated);
      } catch (error: unknown) {
        console.error("[mcpproxy-servers] Error updating server:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to update MCP server",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleUpdateServer();
  });

  /**
   * DELETE /api/mcpproxy/servers/:name - Remove MCP server configuration
   */
  router.delete("/servers/:name", (req: Request, res: Response): void => {
    const handleDeleteServer = async (): Promise<void> => {
      const name = String(req.params.name);

      if (!name) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Server name required" });
        return;
      }

      // Validate server name from URL parameter
      const nameValidation = validateServerName(name);
      if (!nameValidation.valid) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid server name",
          message: nameValidation.errors.join("; ")
        });
        return;
      }

      try {
        const configManager = new McpConfigManager();

        // Check server exists
        const existing = await configManager.getServer(name);
        if (existing === undefined) {
          res.status(HTTP_STATUS_NOT_FOUND).json({
            error: "Server not found",
            message: `No server with name '${name}' exists`
          });
          return;
        }

        await configManager.removeServer(name);

        // Auto-sync proxy config file so mcp-config.json stays in sync
        try {
          await syncProxyConfigFile();
        } catch (syncError) {
          console.warn("[mcpproxy-servers] Config sync failed after delete:", syncError);
        }

        res.status(HTTP_STATUS_NO_CONTENT).send();
      } catch (error: unknown) {
        console.error("[mcpproxy-servers] Error removing server:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to remove MCP server",
          message: error instanceof Error ? error.message : "Unknown error"
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleDeleteServer();
  });

  return router;
}

/**
 * Export types for external use
 */
export type {
  ChildServerStatus,
  ErrorResponse,
  ToolCategory,
};
