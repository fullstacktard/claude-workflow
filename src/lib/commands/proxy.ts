/**
 * Proxy command - MCP proxy server management
 *
 * Usage:
 *   claude-workflow proxy start [--stdio] [--port PORT] [--config FILE] [--docker|--local]
 *   claude-workflow proxy stop
 *   claude-workflow proxy status
 *   claude-workflow proxy logs [--follow] [--tail N]
 *   claude-workflow proxy build [--force]
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- dockerManager namespace types cannot be resolved by typescript-eslint */
/* eslint-disable unicorn/no-process-exit -- this is a CLI command entry point */

import chalk from "chalk";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { dockerManager } from "mcp-proxy";
import {
  showError,
  showInfo,
  showSuccess,
  showWarning,
} from "../ui.js";

const PID_FILE = path.join(process.cwd(), ".claude", "logs", "proxy.pid");

// Constants for magic numbers
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_PORT = 3847;
const DEFAULT_LOG_TAIL = 100;
const CONTAINER_ID_PREFIX_LENGTH = 12;
const PROCESS_STARTUP_CHECK_DELAY = 500;
const GRACEFUL_SHUTDOWN_TIMEOUT = 5000;
const SHUTDOWN_CHECK_INTERVAL = 100;
const UPTIME_DIVISOR = 1000;

interface ChildServer {
  cpu?: number;
  memory?: number;
  name?: string;
  pid?: number;
}

interface ContainerInfo {
  Id: string;
  NetworkSettings?: {
    Ports?: {
      "3847/tcp"?: { HostPort: string }[];
    };
  };
  State: {
    StartedAt: string;
  };
}

interface HealthStatus {
  childServers?: ChildServer[];
  uptime?: number;
}

interface NodeError extends Error {
  code?: string;
}

interface ProxyOptions {
  config?: string;
  docker?: boolean;
  follow?: boolean;
  force?: boolean;
  help?: boolean;
  local?: boolean;
  port?: number;
  stdio?: boolean;
  tail?: number;
  verbose?: boolean;
}

/**
 * Main proxy command handler
 * @param {string[]} args - Command arguments
 * @param {ProxyOptions} options - Command options
 */
export async function proxy(args: string[], options: ProxyOptions): Promise<void> {
  const subcommand = args[0];

  if (subcommand === undefined || subcommand === "" || subcommand === "help" || options.help === true) {
    showHelp();
    return;
  }

  try {
    switch (subcommand) {
    case "build": {
      await buildProxy(options);
      break;
    }
    case "logs": {
      await logsProxy(options);
      break;
    }
    case "start": {
      await startProxy(options);
      break;
    }
    case "status": {
      await statusProxy(options);
      break;
    }
    case "stop": {
      await stopProxy();
      break;
    }
    default: {
      showError(`Unknown subcommand: ${subcommand}`);
      showHelp();
      
      process.exit(1);
    }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Error: ${errorMessage}`);
    if (options.verbose === true) {
      const errorStack = error instanceof Error ? error.stack : undefined;
      if (errorStack !== undefined) {
        console.error(errorStack);
      }
    }

    process.exit(1);
  }
}

/**
 * Build Docker image
 * @param {ProxyOptions} options - Command options
 */
async function buildProxy(options: ProxyOptions): Promise<void> {
  showInfo("Building MCP proxy Docker image...");

  // Check Docker availability
  const dockerStatus = dockerManager.isDockerAvailable();

  if (!dockerStatus.available) {
    const reason = dockerStatus.reason;
    showError(`Docker not available: ${reason}`);
    showInfo("Install Docker Desktop or ensure Docker daemon is running");

    process.exit(1);
  }

  showSuccess("Docker is available");

  // Check for Dockerfile
  const dockerfilePath = path.resolve(process.cwd(), "Dockerfile");
  try {
    await fs.access(dockerfilePath);
  } catch {
    showError("Dockerfile not found in current directory");
    showInfo("Expected path: ./Dockerfile");

    process.exit(1);
  }

  try {
    // Force rebuild if --force flag
    if (options.force === true) {
      showInfo("Force rebuilding image...");
      await dockerManager.buildImage("mcp-proxy:latest", ".", {
        noCache: true,
      });
    } else {
      await dockerManager.buildImageIfNeeded("mcp-proxy:latest", ".");
    }

    showSuccess("Image ready: mcp-proxy:latest");
    showInfo("Run 'proxy start' to use the image");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Build failed: ${errorMessage}`);

    process.exit(1);
  }
}

/**
 * Delete PID file
 */
async function deletePidFile(): Promise<void> {
  try {
    await fs.unlink(PID_FILE);
  } catch {
    // Ignore errors (file may not exist)
  }
}

/**
 * Format uptime in human-readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${String(hours)}h ${String(minutes)}m ${String(secs)}s`;
}

/**
 * Check if a process is running by PID
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process exists
 */
function isProcessRunning(pid: number): boolean {
  try {
    
    process.kill(pid, 0); // Signal 0 = check existence without killing
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream container logs
 * @param {ProxyOptions} options - Command options
 */
async function logsProxy(options: ProxyOptions): Promise<void> {
  // Check if container exists
  const containerStatus = dockerManager.getContainerStatus(
    "mcp-proxy-container"
  );

  if (!containerStatus.exists) {
    showError("No Docker container found");
    showInfo("The 'logs' command only works in Docker mode");
    showInfo("Start the proxy with 'proxy start' to use Docker mode");

    process.exit(1);
  }

  if (!containerStatus.running) {
    showWarning("Container exists but is not running");
    showInfo("Start the proxy with 'proxy start'");

    process.exit(1);
  }

  showInfo("Streaming container logs (press Ctrl+C to exit)...\n");

  try {
    await dockerManager.streamContainerLogs("mcp-proxy-container", {
      follow: options.follow !== false,
      tail: options.tail ?? DEFAULT_LOG_TAIL,
      timestamps: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Failed to stream logs: ${errorMessage}`);

    process.exit(1);
  }
}

/**
 * Read PID from file
 * @returns {Promise<number|null>} PID or null if file doesn't exist
 */
async function readPidFile(): Promise<number | undefined> {
  try {
    const content = await fs.readFile(PID_FILE, "utf8");
    return Number.parseInt(content.trim(), 10);
  } catch (error) {
    if (error instanceof Error) {
      const nodeError = error as NodeError;
      if (nodeError.code === "ENOENT") {
        return undefined;
      }
    }
    throw error;
  }
}

/**
 * Show help text for proxy commands
 */
function showHelp(): void {
  console.log(`
${chalk.bold("MCP Proxy Management")}

${chalk.bold("Usage:")}
  claude-workflow proxy <command> [options]

${chalk.bold("Commands:")}
  ${chalk.cyan("start")}    Start the proxy server
  ${chalk.cyan("stop")}     Stop the proxy server
  ${chalk.cyan("status")}   Show proxy status and child servers
  ${chalk.cyan("logs")}     Stream container logs (Docker mode only)
  ${chalk.cyan("build")}    Build Docker image

${chalk.bold("Options:")}
  ${chalk.cyan("--stdio")}           Enable stdio mode for Claude Code integration
  ${chalk.cyan("--port, -p PORT")}   HTTP port (default: 3847)
  ${chalk.cyan("--config, -c FILE")} Config file path (default: .mcp-proxy.json)
  ${chalk.cyan("--docker")}          Force Docker mode (error if unavailable)
  ${chalk.cyan("--local")}           Force local Node.js execution
  ${chalk.cyan("--follow")}          Follow log output (logs command)
  ${chalk.cyan("--tail N")}          Number of log lines to show (logs command)
  ${chalk.cyan("--force")}           Force rebuild (build command)

${chalk.bold("Examples:")}
  # Start proxy in HTTP mode (auto-detects Docker)
  claude-workflow proxy start

  # Force Docker mode
  claude-workflow proxy start --docker

  # Force local Node.js mode
  claude-workflow proxy start --local

  # Start proxy in stdio mode for Claude Code
  claude-workflow proxy start --stdio

  # Stream container logs
  claude-workflow proxy logs --follow

  # Build Docker image
  claude-workflow proxy build

  # Stop running proxy
  claude-workflow proxy stop

  # Check proxy status
  claude-workflow proxy status

${chalk.bold("Execution Modes:")}
  ${chalk.white("Docker mode:")} Auto-detected when Docker is available
  ${chalk.white("Local mode:")} Fallback when Docker is unavailable or --local flag used

${chalk.bold("PID File:")}
  The proxy PID is stored in: .claude/logs/proxy.pid (local mode only)
`);
}

/**
 * Start the proxy server
 * @param {ProxyOptions} options - Command options
 */
async function startProxy(options: ProxyOptions): Promise<void> {
  try {
    // Determine execution mode (Docker vs local)
    const mode = dockerManager.determineExecutionMode(options);

    await (mode === "docker" ? startProxyDocker(options) : startProxyLocal(options));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Failed to start proxy: ${errorMessage}`);

    process.exit(1);
  }
}

/**
 * Start proxy in Docker mode
 * @param {ProxyOptions} options - Command options
 */
async function startProxyDocker(options: ProxyOptions): Promise<void> {
  showInfo("Starting MCP proxy server in Docker mode...");

  // Check if container already running
  const containerStatus = dockerManager.getContainerStatus(
    "mcp-proxy-container"
  );
  if (containerStatus.running) {
    showWarning("Proxy container is already running");
    showInfo("Use 'proxy stop' to stop it first");
    
    process.exit(1);
  }

  // Build image if needed
  await dockerManager.buildImageIfNeeded("mcp-proxy:latest", ".");

  // Load environment variables from .env file
  const envVars = dockerManager.loadEnvFile(".env");

  // Add port and config to env
  if (options.port !== undefined) {
    envVars.PROXY_PORT = String(options.port);
  }

  // Create and start container
  const containerId = dockerManager.createAndStartContainer({
    configPath: options.config ?? ".mcp-proxy.json",
    envVars,
    port: options.port ?? DEFAULT_PORT,
    stdio: options.stdio ?? false,
  });

  const mode = options.stdio === true
    ? "stdio mode"
    : `HTTP mode on port ${String(options.port ?? DEFAULT_PORT)}`;
  const containerIdPrefix = containerId.slice(0, CONTAINER_ID_PREFIX_LENGTH);
  showSuccess(`Proxy started in Docker (Container: ${containerIdPrefix}, ${mode})`);
  showInfo("Use 'proxy logs --follow' to view logs");
  showInfo("Use 'proxy status' to check status");
}

/**
 * Start proxy in local Node.js mode
 * @param {ProxyOptions} options - Command options
 */
async function startProxyLocal(options: ProxyOptions): Promise<void> {
  showInfo("Starting MCP proxy server in local mode...");

  // Check if already running
  const existingPid = await readPidFile();
  if (existingPid !== undefined && isProcessRunning(existingPid)) {
    showError(`Proxy is already running (PID: ${String(existingPid)})`);
    showInfo("Use \"proxy stop\" to stop it first");

    process.exit(1);
  }

  // Clean up stale PID file if process doesn't exist
  if (existingPid !== undefined) {
    await deletePidFile();
  }

  // Build command arguments
  const args: string[] = [];
  if (options.stdio === true) {
    // For stdio mode, we don't pass port/host
    // The proxy will communicate via stdin/stdout
  }

  // Set environment variables for configuration
  const env = { ...process.env };
  if (options.port !== undefined) {
    env.PROXY_PORT = String(options.port);
  }
  if (options.config !== undefined) {
    env.PROXY_CONFIG = options.config;
  }

  // Get path to standalone server from mcp-proxy package
  // Using import.meta.resolve to locate the package's standalone entry point
  const standaloneModuleUrl = import.meta.resolve("mcp-proxy/standalone");
  const serverPath = fileURLToPath(standaloneModuleUrl);

  // Spawn proxy process
  const spawnOptions: import("child_process").SpawnOptions = {
    detached: options.stdio === true ? false : true, // Detach for HTTP mode, keep attached for stdio
    env,
    stdio: options.stdio === true ? "inherit" : ["ignore", "ignore", "ignore"],
  };

  const child = spawn("node", [serverPath, ...args], spawnOptions);

  // Handle spawn errors
  child.on("error", (err: Error) => {
    showError(`Failed to start proxy: ${err.message}`);

    process.exit(1);
  });

  // For HTTP mode, check if process started successfully
  if (options.stdio === true) {
    // Stdio mode - write PID and keep process alive
    if (child.pid === undefined) {
      showError("Failed to get child process PID");
      process.exit(1);
    }
    await writePidFile(child.pid);
    showSuccess(`Proxy started locally in stdio mode (PID: ${String(child.pid)})`);

    // Keep process alive, proxy will handle all I/O
    // When proxy exits, this process will also exit
  } else {
    // Wait a bit to see if process exits immediately (indicating startup failure)
    await new Promise<void>((resolve) => {
      setTimeout(() => { resolve(); }, PROCESS_STARTUP_CHECK_DELAY);
    });

    if (child.pid === undefined || !isProcessRunning(child.pid)) {
      showError("Proxy failed to start (process exited immediately)");

      process.exit(1);
    }

    // Write PID file
    await writePidFile(child.pid);

    // Detach so parent can exit
    child.unref();

    const mode = `HTTP mode on port ${String(options.port ?? DEFAULT_PORT)}`;
    showSuccess(`Proxy started locally (PID: ${String(child.pid)}, ${mode})`);
    showInfo("View logs in .claude/logs/mcp-proxy-*.log");

    process.exit(0);
  }
}

/**
 * Show proxy status
 */
async function statusProxy(options: ProxyOptions): Promise<void> {
  // Check Docker mode first
  const containerStatus = dockerManager.getContainerStatus(
    "mcp-proxy-container"
  );

  if (containerStatus.exists) {
    console.log(
      chalk.white.bold("Execution Mode:"),
      chalk.green("Docker")
    );
    console.log(chalk.white.bold("Container Name:"), "mcp-proxy-container");

    if (containerStatus.running) {
      // Get detailed container info
      const containerInfo = dockerManager.getContainerInfo(
        "mcp-proxy-container"
         
      ) as unknown as ContainerInfo | undefined;

      if (containerInfo === undefined) {
        console.log(chalk.white.bold("Status:"), chalk.green("Running"));
        showSuccess("Proxy container is running");
      } else {
        const state = containerInfo.State;
        const startedAt = new Date(state.StartedAt);

        const uptime = Math.floor((Date.now() - startedAt.getTime()) / UPTIME_DIVISOR);

        console.log(chalk.white.bold("Status:"), chalk.green("Running"));
        console.log(chalk.white.bold("Container ID:"), containerInfo.Id.slice(0, CONTAINER_ID_PREFIX_LENGTH));
        console.log(chalk.white.bold("Uptime:"), formatUptime(uptime));

        const port =
          containerInfo.NetworkSettings?.Ports?.["3847/tcp"]?.[0]?.HostPort ??
          String(DEFAULT_PORT);
        console.log(chalk.white.bold("Port:"), port);

        showSuccess("Proxy server is running in Docker");
      }
    } else {
      console.log(chalk.white.bold("Status:"), chalk.red("Stopped"));
      showWarning("Container exists but is not running");
      showInfo("Run 'proxy start' to start");
    }

    // Try to query proxy for child server info
    const port = options.port ?? DEFAULT_PORT;
    if (containerStatus.running) {
      try {
        const response = await fetch(`http://localhost:${String(port)}/health`);
        const status = await response.json() as HealthStatus;

        console.log("\nChild MCP Servers:");
        if (status.childServers === undefined || status.childServers.length === 0) {
          console.log("  (none)");
        } else {
          for (const server of status.childServers) {
            const cpuMem =
              server.cpu !== undefined && server.memory !== undefined
                ? `CPU: ${server.cpu.toFixed(1)}%, Memory: ${server.memory.toFixed(0)}MB`
                : "Stats unavailable";

            const serverName = server.name ?? "unknown";
            const serverPid = server.pid === undefined ? "N/A" : String(server.pid);
            console.log(
              `  • ${serverName} (PID: ${serverPid}) - ${cpuMem}`
            );
          }
        }

        console.log("");
      } catch {
        showWarning(
          `Could not fetch child server details (proxy may not be ready on port ${String(port)})`
        );
      }
    }

    process.exit(0);
  }

  // Check local mode
  const pid = await readPidFile();

  if (pid === undefined) {
    console.log(chalk.white.bold("Execution Mode:"), chalk.gray("Not running"));
    showWarning("Proxy is not running");
    showInfo("Run 'proxy start' to start");

    process.exit(0);
  }

  // Check if process exists
  if (!isProcessRunning(pid)) {
    showWarning("Proxy is not running (stale PID file)");
    await deletePidFile();

    process.exit(0);
  }

  console.log(chalk.white.bold("Execution Mode:"), chalk.blue("Local"));
  console.log(chalk.white.bold("Process ID:"), String(pid));
  showSuccess("Proxy is running locally");

  // Try to query proxy for child server info
  const port = options.port ?? DEFAULT_PORT;
  try {
    const response = await fetch(`http://localhost:${String(port)}/health`);
    const status = await response.json() as HealthStatus;

    console.log("\nChild MCP Servers:");
    if (status.childServers === undefined || status.childServers.length === 0) {
      console.log("  (none)");
    } else {
      for (const server of status.childServers) {
        const cpuMem =
          server.cpu !== undefined && server.memory !== undefined
            ? `CPU: ${server.cpu.toFixed(1)}%, Memory: ${server.memory.toFixed(0)}MB`
            : "Stats unavailable";

        const serverName = server.name ?? "unknown";
        const serverPid = server.pid === undefined ? "N/A" : String(server.pid);
        console.log(
          `  • ${serverName} (PID: ${serverPid}) - ${cpuMem}`
        );
      }
    }

    const uptime = status.uptime ?? 0;
    console.log(`\nUptime: ${formatUptime(uptime)}\n`);
  } catch (error) {
    showWarning(
      `Could not fetch child server details (proxy may not support HTTP health endpoint or not running on port ${String(port)})`
    );

    const errorMessage = error instanceof Error ? error.message : String(error);
    showInfo(`Error: ${errorMessage}`);
  }

  process.exit(0);
}

/**
 * Stop the proxy server (Docker or local)
 */
async function stopProxy(): Promise<void> {
  // Check if running in Docker first
  const containerStatus = dockerManager.getContainerStatus(
    "mcp-proxy-container"
  );

  if (containerStatus.running) {
    // Stop Docker container
    showInfo("Stopping Docker container...");
    const stopTimeout = 10;
    dockerManager.stopContainer("mcp-proxy-container", stopTimeout);
    showSuccess("Proxy container stopped successfully");

    process.exit(0);
  }

  // Check if running in local mode
  const pid = await readPidFile();

  if (pid === undefined) {
    showWarning("Proxy is not running");

    process.exit(0);
  }

  // Check if process exists
  if (!isProcessRunning(pid)) {
    showWarning("Proxy is not running (stale PID file)");
    await deletePidFile();

    process.exit(0);
  }

  showInfo(`Stopping local proxy (PID: ${String(pid)})...`);

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, "SIGTERM");

    // Wait for process to exit (with timeout)
    const startTime = Date.now();

    while (Date.now() - startTime < GRACEFUL_SHUTDOWN_TIMEOUT) {
      if (!isProcessRunning(pid)) {
        // Process exited
        await deletePidFile();
        showSuccess("Proxy stopped successfully");

        process.exit(0);
      }
      // Wait a bit before checking again
      await new Promise<void>((resolve) => {
        setTimeout(() => { resolve(); }, SHUTDOWN_CHECK_INTERVAL);
      });
    }

    // Force kill if still running
    showWarning("Graceful shutdown timed out, forcing kill...");
    try {
      process.kill(pid, "SIGKILL");
      await deletePidFile();
      showSuccess("Proxy stopped (forced)");

      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(`Failed to stop proxy: ${errorMessage}`);

      process.exit(1);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Failed to stop proxy: ${errorMessage}`);

    process.exit(1);
  }
}

/**
 * Write PID to file
 * @param {number} pid - Process ID to write
 */
async function writePidFile(pid: number): Promise<void> {
  const dir = path.dirname(PID_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(PID_FILE, String(pid), "utf8");
}
