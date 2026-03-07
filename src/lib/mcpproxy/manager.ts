/**
 * McpProxyManager - Docker Compose lifecycle management for mcp-proxy
 *
 * Provides Docker Compose-based management for the mcp-proxy service,
 * including building, startup, health monitoring, and status reporting.
 *
 * @example
 * const manager = new McpProxyManager();
 *
 * // Detect installation
 * const status = manager.detectInstallation();
 * console.log(status.message);
 *
 * // Build image if needed
 * if (!status.imageExists) {
 *   manager.build();
 * }
 *
 * // Start container
 * await manager.start();
 *
 * // Get runtime status
 * const runtimeStatus = await manager.getStatus();
 * console.log(`Running: ${runtimeStatus.running}, Port: ${runtimeStatus.port}`);
 *
 * // Stop container
 * await manager.stop();
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { InstallStatus, McpProxyStatus } from "./types.js";

/**
 * Result type for operations that can succeed or fail with messages
 */
export interface OperationResult {
  alreadyExists?: boolean;
  message: string;
  success: boolean;
}

/**
 * Custom error: Docker daemon is not running
 */
export class DockerDaemonNotRunningError extends Error {
  constructor() {
    super(
      "Docker daemon is not running.\n" +
      "Start Docker Desktop or run: sudo systemctl start docker"
    );
    this.name = "DockerDaemonNotRunningError";
  }
}

/**
 * Custom error: Docker is not installed
 */
export class DockerNotInstalledError extends Error {
  constructor() {
    super(
      "Docker is not installed.\n" +
      "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    );
    this.name = "DockerNotInstalledError";
  }
}

/**
 * McpProxyManager - Manages mcp-proxy Docker container lifecycle
 */
export class McpProxyManager {
  private readonly CHECK_INTERVAL_MS = 1000; // Check every 1 second
  private readonly COMPOSE_FILE = ".claude/docker-compose.yml";
  private readonly CONTAINER_NAME = "mcp-proxy";
  private readonly FETCH_TIMEOUT_MS = 2000; // 2 seconds
  private readonly HEALTH_CHECK_TIMEOUT = 30_000; // 30 seconds
  private readonly MCP_PROXY_PORT = 3847;

  /**
   * Build mcp-proxy Docker image using docker compose
   * Uses the .claude/docker-compose.yml file in the current directory
   * @param options - Build options
   * @param options.silent - Suppress stdout/stderr (default: false for backward compatibility)
   * @returns Operation result with success status and message
   */
  build(options: { silent?: boolean } = {}): OperationResult {
    const { silent = false } = options;

    // Check if compose file exists
    const composePath = path.join(process.cwd(), this.COMPOSE_FILE);
    if (!fs.existsSync(composePath)) {
      throw new Error(
        `${this.COMPOSE_FILE} not found in current directory.\n` +
        "Run \"claude-workflow init\" to scaffold compose files."
      );
    }

    try {
      // Build using docker compose
      execSync(`docker compose -f ${this.COMPOSE_FILE} build mcp-proxy`, {
        encoding: "utf8",
        // Suppress output when silent mode is enabled
        stdio: silent ? "pipe" : "inherit"
      });

      return {
        message: "mcp-proxy image built successfully",
        success: true
      };

    } catch (error) {
      // Capture stderr for error messages even in silent mode
      const execError = error as { stderr?: string; message?: string };
      const errorMessage = execError.stderr ?? execError.message ?? "Unknown build error";
      throw new Error(`Build failed: ${errorMessage}`);
    }
  }

  /**
   * Detect if Docker is installed and mcp-proxy compose file exists
   * @returns Installation status with detailed information
   */
  detectInstallation(): InstallStatus {
    const result: InstallStatus = {
      containerExists: false,
      dockerInstalled: false,
      dockerRunning: false,
      imageExists: false,
      message: ""
    };

    try {
      // Check Docker CLI availability
      execSync("docker --version", { stdio: "ignore", timeout: 3000 });
      result.dockerInstalled = true;

      // Check Docker daemon
      execSync("docker ps", { stdio: "ignore", timeout: 3000 });
      result.dockerRunning = true;

      // Check for mcp-proxy container FIRST (before compose file check)
      // Container might be running from a different compose location
      try {
        const containerCheck = execSync(
          `docker ps -a --filter name=${this.CONTAINER_NAME} --format "{{.ID}}"`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
        ).trim();
        result.containerExists = containerCheck.length > 0;

        // Also check if it's running (not just exists)
        const runningCheck = execSync(
          `docker ps --filter name=${this.CONTAINER_NAME} --format "{{.ID}}"`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
        ).trim();

        if (runningCheck.length > 0) {
          // Container is running - check for image too
          const imageCheck = execSync(
            "docker images --filter \"reference=*mcp-proxy*\" --format \"{{.ID}}\"",
            { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
          ).trim();
          result.imageExists = imageCheck.length > 0;
          result.message = "mcp-proxy is already running";
          return result;
        }
      } catch {
        // Ignore errors, will check via compose file
      }

      // Check for compose file
      const composePath = path.join(process.cwd(), this.COMPOSE_FILE);
      const composeFileExists = fs.existsSync(composePath);

      if (!composeFileExists) {
        result.message = `${this.COMPOSE_FILE} not found. Run "claude-workflow init" to scaffold compose files.`;
        return result;
      }

      // Check if image is built using docker compose
      try {
        const output = execSync(`docker compose -f ${this.COMPOSE_FILE} images -q`, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"]
        }).trim();
        result.imageExists = output.length > 0;
      } catch {
        result.imageExists = false;
      }

      // Check for mcp-proxy container (re-check via compose)
      const containerCheck = execSync(
        `docker ps -a --filter name=${this.CONTAINER_NAME} --format "{{.ID}}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();

      result.containerExists = containerCheck.length > 0;

      if (result.imageExists && result.containerExists) {
        result.message = "mcp-proxy is fully set up";
      } else if (result.imageExists) {
        result.message = "mcp-proxy image built, ready to start";
      } else {
        result.message = "mcp-proxy image not built yet. Run build() to build the image.";
      }

    } catch (error) {
      const parsedError = this.parseDockerError(error as Error);
      result.message = parsedError.message;

      if (parsedError instanceof DockerNotInstalledError) {
        result.dockerInstalled = false;
      } else if (parsedError instanceof DockerDaemonNotRunningError) {
        result.dockerInstalled = true;
        result.dockerRunning = false;
      }
    }

    return result;
  }

  /**
   * Get current mcp-proxy runtime status
   * @returns Runtime status including uptime and container state
   */
  getStatus(): Promise<McpProxyStatus> {
    const containerStatus = this.getContainerStatus();

    if (!containerStatus.exists || !containerStatus.running) {
      return Promise.resolve({
        port: this.MCP_PROXY_PORT,
        running: false
      });
    }

    try {
      // Get container start time for uptime calculation
      const inspectOutput = execSync(
        `docker inspect --format '{{.State.StartedAt}}' ${this.CONTAINER_NAME}`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();

      const MILLISECONDS_TO_SECONDS = 1000;
      const startedAt = new Date(inspectOutput);
      const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / MILLISECONDS_TO_SECONDS);

      // Get container PID
      const pidOutput = execSync(
        `docker inspect --format '{{.State.Pid}}' ${this.CONTAINER_NAME}`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();

      const pid = Number.parseInt(pidOutput, 10);

      // Build status object with exact optional property types
      const status: McpProxyStatus = {
        port: this.MCP_PROXY_PORT,
        running: true,
        uptime: uptimeSeconds
      };

      if (pid > 0) {
        status.pid = pid;
      }

      return Promise.resolve(status);

    } catch (error) {
      return Promise.reject(new Error(`Failed to get status: ${(error as Error).message}`));
    }
  }

  /**
   * Start mcp-proxy Docker container using docker compose
   * Checks for compose file and starts the service
   * @returns Operation result indicating if already running or newly started
   */
  async start(): Promise<OperationResult> {
    // Check if docker-compose.mcp-proxy.yml exists
    const composePath = path.join(process.cwd(), this.COMPOSE_FILE);
    if (!fs.existsSync(composePath)) {
      throw new Error(
        `${this.COMPOSE_FILE} not found in current directory.\n` +
        "Run \"claude-workflow init\" to scaffold compose files."
      );
    }

    // Check if already running
    const status = this.getContainerStatus();
    if (status.exists && status.running) {
      return {
        alreadyExists: true,
        message: "mcp-proxy is already running",
        success: true
      };
    }

    try {
      // Start using docker compose (set DOCKER_GID for socket access)
      const dockerGid = this.getDockerGid();
      const envVars = dockerGid === "" ? "" : `DOCKER_GID=${dockerGid} `;
      execSync(`${envVars}docker compose -f ${this.COMPOSE_FILE} up -d`, {
        encoding: "utf8",
        shell: "/bin/sh",
        stdio: "inherit"
      });

      // Wait for health check
      await this.waitForHealthy();

      return {
        message: "mcp-proxy started and is ready",
        success: true
      };

    } catch (error) {
      const parsedError = this.parseDockerError(error as Error);
      throw parsedError;
    }
  }

  /**
   * Stop mcp-proxy container using docker compose
   * Gracefully shuts down the service
   * @returns Operation result indicating if container was stopped or didn't exist
   */
  stop(): Promise<OperationResult> {
    const composePath = path.join(process.cwd(), this.COMPOSE_FILE);
    if (!fs.existsSync(composePath)) {
      return Promise.reject(new Error(`${this.COMPOSE_FILE} not found in current directory`));
    }

    const status = this.getContainerStatus();

    if (!status.exists) {
      return Promise.resolve({
        alreadyExists: false,
        message: "mcp-proxy container does not exist",
        success: true
      });
    }

    if (!status.running) {
      return Promise.resolve({
        alreadyExists: false,
        message: "mcp-proxy is already stopped",
        success: true
      });
    }

    try {
      execSync(`docker compose -f ${this.COMPOSE_FILE} down`, {
        encoding: "utf8",
        stdio: "inherit"
      });

      return Promise.resolve({
        message: "mcp-proxy stopped",
        success: true
      });

    } catch (error) {
      return Promise.reject(new Error(`Failed to stop mcp-proxy: ${(error as Error).message}`));
    }
  }

  /**
   * Get container status
   * @private
   */
  private getContainerStatus(): { exists: boolean; id?: string; running: boolean; } {
    try {
      const output = execSync(
        `docker ps -a --filter name=${this.CONTAINER_NAME} --format "{{.ID}}\t{{.State}}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();

      if (!output) {
        return { exists: false, running: false };
      }

      const [id, state] = output.split("\t");

      // Build result with exact optional property types
      const result: { exists: boolean; id?: string; running: boolean; } = {
        exists: true,
        running: state === "running"
      };

      if (id !== undefined && id !== "") {
        result.id = id;
      }

      return result;

    } catch {
      return { exists: false, running: false };
    }
  }

  /**
   * Parse Docker error and return specific error type
   * @private
   */

  /**
   * Get Docker group GID for socket access permissions
   */
  private getDockerGid(): string {
    try {
      const output = execSync("getent group docker | cut -d: -f3", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      return output;
    } catch {
      // getent may not be available on all systems
      return "";
    }
  }

  private parseDockerError(error: Error | NodeJS.ErrnoException): Error {
    const message = error.message;
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT" || message.includes("not found")) {
      return new DockerNotInstalledError();
    }

    if (message.includes("Cannot connect to the Docker daemon")) {
      return new DockerDaemonNotRunningError();
    }

    if (message.includes("port is already allocated")) {
      return new PortConflictError(this.MCP_PROXY_PORT);
    }

    return error as Error;
  }

  /**
   * Wait for mcp-proxy health endpoint to respond
   * @private
   */
  private async waitForHealthy(): Promise<void> {
    const startTime = Date.now();
    const TIMEOUT_DIVISOR = 1000;

    while (Date.now() - startTime < this.HEALTH_CHECK_TIMEOUT) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, this.FETCH_TIMEOUT_MS);

        const response = await fetch(`http://localhost:${String(this.MCP_PROXY_PORT)}/health`, {
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
          return; // Health check passed
        }
      } catch {
        // Ignore fetch errors, keep retrying
      }

      await new Promise(resolve => setTimeout(resolve, this.CHECK_INTERVAL_MS));
    }

    const timeoutSeconds = String(this.HEALTH_CHECK_TIMEOUT / TIMEOUT_DIVISOR);
    throw new Error(
      `mcp-proxy failed to become healthy after ${timeoutSeconds}s.\n` +
      `Check container logs: docker logs ${this.CONTAINER_NAME}`
    );
  }
}

/**
 * Custom error: Port conflict
 */
export class PortConflictError extends Error {
  constructor(port: number) {
    const portStr = String(port);
    super(
      `Port ${portStr} is already in use.\n` +
      `Check what's using the port: lsof -i :${portStr}\n` +
      "Or configure mcp-proxy to use a different port."
    );
    this.name = "PortConflictError";
  }
}
