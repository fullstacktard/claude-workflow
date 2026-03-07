/**
 * Type definitions for mcp-proxy Docker management
 */

/**
 * Installation detection result
 */
export interface InstallStatus {
  /** mcp-proxy container exists */
  containerExists: boolean;
  /** Docker CLI is installed */
  dockerInstalled: boolean;
  /** Docker daemon is running */
  dockerRunning: boolean;
  /** mcp-proxy Docker image exists */
  imageExists: boolean;
  /** Human-readable status message */
  message: string;
}

/**
 * mcp-proxy runtime status
 */
export interface McpProxyStatus {
  /** Container process ID (if running) */
  pid?: number;
  /** Port mcp-proxy is listening on */
  port: number;
  /** Whether container is running */
  running: boolean;
  /** Uptime in seconds (if running) */
  uptime?: number;
}
