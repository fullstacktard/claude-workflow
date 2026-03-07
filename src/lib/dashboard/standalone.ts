/**
 * Standalone entry point for running the Dashboard server in Docker
 *
 * This file is used by the Dockerfile to start the dashboard server
 * independently of the CLI.
 *
 * Configuration is provided via environment variables:
 * - DASHBOARD_PORT: Port to listen on (default: 3850)
 * - DASHBOARD_HOST: Host to bind to (default: 0.0.0.0)
 * - CLAUDE_HOME: Path to Claude home directory (default: /root/.claude)
 * - SCAN_ROOT: Root directory to scan for projects (default: /app/projects)
 * - FST_PROXY_URL: URL for claude-proxy service (default: http://localhost:4000)
 */

import { existsSync } from "node:fs";
import * as path from "node:path";

import { RealTimeLogMonitor } from "../analytics/real-time-log-monitor.js";
import { getProjectRegistry } from "../services/project-registry.js";
import { startDashboardServer, stopDashboardServer } from "./server.js";

const DEFAULT_PORT = 3850;
const DEFAULT_HOST = "0.0.0.0";

// Parse environment variables
const port = Number.parseInt(process.env.DASHBOARD_PORT ?? String(DEFAULT_PORT), 10);
const host = process.env.DASHBOARD_HOST ?? DEFAULT_HOST;
const claudeHome = process.env.CLAUDE_HOME ?? "/root/.claude";
const fstProxyUrl = process.env.FST_PROXY_URL ?? "http://localhost:4000";
const scanRoot = process.env.SCAN_ROOT ?? "/app/projects";
const hostProjectPath = process.env.HOST_PROJECT_PATH ?? "";

// Build list of log directories to monitor from registry
const logsDirectories: string[] = [];

// Always include Claude home logs
logsDirectories.push(`${claudeHome}/logs`);

// Discover project log directories from registry
try {
  const registry = getProjectRegistry();
  const entries = registry.list();

  for (const entry of entries) {
    // Translate host path to container path
    // Registry has host paths like /home/user/development/projects/personal/myapp
    // Container mounts HOST_PROJECT_PATH at SCAN_ROOT
    // So we need to compute the relative path and apply it to SCAN_ROOT
    let containerPath: string;

    if (hostProjectPath !== "" && entry.pwd.startsWith(hostProjectPath)) {
      // Compute relative path from HOST_PROJECT_PATH
      const relativePath = entry.pwd.slice(hostProjectPath.length);
      containerPath = path.join(scanRoot, relativePath);
    } else {
      // Fallback: try using basename only
      containerPath = path.join(scanRoot, path.basename(entry.pwd));
    }

    const logsPath = path.join(containerPath, ".claude", "logs");

    if (existsSync(logsPath)) {
      logsDirectories.push(logsPath);
    }
  }
} catch {
  // Registry unavailable - will only monitor claudeHome logs
  console.warn("Registry unavailable, monitoring only Claude home logs");
}

// Create log monitor for WebSocket streaming with all discovered directories
const logMonitor = new RealTimeLogMonitor({ logsDirectories });

// Project paths for dashboard (uses SCAN_ROOT)
const projectPaths = [scanRoot];

console.log("Starting Dashboard Server...");
console.log(`  Port: ${String(port)}`);
console.log(`  Host: ${host}`);
console.log(`  Claude Home: ${claudeHome}`);
console.log(`  Scan Root: ${scanRoot}`);
console.log(`  Logs Directories: ${logsDirectories.length} directories`);
console.log(`  claude-proxy URL: ${fstProxyUrl}`);
console.log(`  Project Paths: ${projectPaths.join(", ") || "(none)"}`);

// Global error handlers to prevent crashes from unhandled errors
process.on("uncaughtException", (error: Error) => {
  console.error("[dashboard] Uncaught exception (keeping alive):", error.message);
  if (error.stack) {
    console.error("[dashboard] Stack:", error.stack);
  }
});

process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("[dashboard] Unhandled rejection (keeping alive):", message);
  if (reason instanceof Error && reason.stack) {
    console.error("[dashboard] Stack:", reason.stack);
  }
});

try {
  // Start log monitor before server
  await logMonitor.start();
  console.log(`RealTimeLogMonitor started (${String(logsDirectories.length)} directories)`);

  const result = await startDashboardServer({
    host,
    logMonitor,
    port,
    projectPaths,
  });
  console.log("Dashboard Server started successfully");

  // Graceful shutdown handlers for Docker/container environments
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await logMonitor.stop();
      await stopDashboardServer(result);
      console.log("Graceful shutdown complete");
      process.exit(0);
    } catch (shutdownError) {
      const shutdownErrorMessage = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
      console.error("Error during shutdown:", shutdownErrorMessage);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("Failed to start Dashboard Server:", errorMessage);
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
  process.exit(1);
}
