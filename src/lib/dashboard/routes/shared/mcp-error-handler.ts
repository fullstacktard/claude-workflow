/**
 * Shared MCP route error handling utilities.
 * Used by route files that proxy operations through McpToolClient.
 *
 * Extracted from x-accounts.ts and geelark.ts to avoid duplication.
 * See: docs/research/email-dashboard-shared-error-handling.md
 */

import type { Request, Response } from "express-serve-static-core";

import type { McpToolClient } from "../../services/mcp-tool-client.js";
import { McpToolError } from "../../services/mcp-tool-client.js";

// Re-export McpToolError for convenience so consumers only need one import source
export { McpToolError } from "../../services/mcp-tool-client.js";

// HTTP status codes used by MCP-proxied routes
export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_BAD_GATEWAY = 502;
export const HTTP_STATUS_GATEWAY_TIMEOUT = 504;

/**
 * Error response format for MCP-proxied routes.
 * Superset of the general dashboard ErrorResponse: message is required
 * and code is included for JSON-RPC error codes.
 */
export interface McpErrorResponse {
  error: string;
  message: string;
  code?: number;
}

/**
 * Dependencies shared by all MCP-proxied routers.
 */
export interface McpRouterDeps {
  /** MCP tool client for JSON-RPC calls to mcp-proxy */
  mcpToolClient: McpToolClient;
}

/**
 * Map MCP errors to HTTP responses.
 * - McpToolError code -32601 (method not found) -> 404
 * - AbortError (timeout) -> 504
 * - All others -> 502
 */
export function handleMcpError(
  res: Response,
  error: unknown,
  operation: string,
): void {
  if (error instanceof McpToolError) {
    const JSON_RPC_METHOD_NOT_FOUND = -32_601;
    const status =
      error.code === JSON_RPC_METHOD_NOT_FOUND
        ? HTTP_STATUS_NOT_FOUND
        : HTTP_STATUS_BAD_GATEWAY;
    const body: McpErrorResponse = {
      error: `Failed to ${operation}`,
      message: error.message,
      code: error.code,
    };
    res.status(status).json(body);
    return;
  }

  if (error instanceof Error && error.name === "AbortError") {
    const body: McpErrorResponse = {
      error: `Timeout during ${operation}`,
      message: error.message || "MCP proxy did not respond in time",
    };
    res.status(HTTP_STATUS_GATEWAY_TIMEOUT).json(body);
    return;
  }

  const body: McpErrorResponse = {
    error: `Failed to ${operation}`,
    message: error instanceof Error ? error.message : "MCP proxy unreachable",
  };
  res.status(HTTP_STATUS_BAD_GATEWAY).json(body);
}

/**
 * Wrap an async MCP route handler with automatic error handling.
 * Eliminates the repeated try/catch + void IIFE pattern.
 *
 * Usage:
 *   router.get("/path", wrapMcpRoute("list items", async (req, res) => {
 *     const result = await mcpToolClient.callTool("tool_name");
 *     res.status(HTTP_STATUS_OK).json(result);
 *   }));
 */
export function wrapMcpRoute(
  operation: string,
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req: Request, res: Response): void => {
    void handler(req, res).catch((error: unknown) => {
      handleMcpError(res, error, operation);
    });
  };
}
