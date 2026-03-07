/**
 * MCP Tool Client
 * Thin wrapper around JSON-RPC 2.0 POST requests to the mcp-proxy container.
 * Used by X account and GeeLark routes to invoke MCP tools on child servers.
 *
 * Architecture: docs/research/x-dashboard-backend-api-proxy-pattern.md
 * Error handling: docs/research/x-dashboard-error-handling-patterns.md
 */

const MCP_PROXY_HOST = process.env.MCP_PROXY_HOST ?? "mcp-proxy";
const MCP_PROXY_PORT = process.env.MCP_PROXY_PORT ?? "3847";
const MCP_PROXY_URL = `http://${MCP_PROXY_HOST}:${MCP_PROXY_PORT}`;
const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Error thrown when an MCP tool call fails.
 * Contains the JSON-RPC error code for downstream mapping to HTTP status codes.
 */
export class McpToolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

/**
 * Client for invoking MCP tools on child servers via the mcp-proxy JSON-RPC endpoint.
 *
 * Usage:
 *   const client = new McpToolClient();
 *   const accounts = await client.callTool<VaultAccount[]>("x_list_accounts");
 */
export class McpToolClient {
  private requestId = 0;
  private readonly baseUrl: string;

  constructor(baseUrl: string = MCP_PROXY_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Call an MCP tool on a child server via the mcp-proxy JSON-RPC endpoint.
   * Handles two-level response unwrapping:
   *   1. JSON-RPC envelope -> result.content[0].text
   *   2. JSON.parse(text) -> typed result
   *
   * @param toolName - MCP tool name (e.g., "x_list_accounts")
   * @param args - Tool arguments object
   * @param timeoutMs - Request timeout in milliseconds (default: 30s)
   * @returns Parsed tool response
   * @throws McpToolError if the tool returns an error
   * @throws Error with name "AbortError" on timeout
   */
  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const id = ++this.requestId;

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new McpToolError(
        response.status,
        `MCP proxy returned HTTP ${String(response.status)}: ${response.statusText}`,
      );
    }

    const rpc = (await response.json()) as JsonRpcResponse;

    // JSON-RPC level error (e.g., -32601 method not found)
    if (rpc.error) {
      throw new McpToolError(rpc.error.code, rpc.error.message, rpc.error.data);
    }

    // Tool-level error (isError flag in MCP response)
    if (rpc.result?.isError) {
      const text = rpc.result.content?.[0]?.text ?? "Unknown tool error";
      throw new McpToolError(-1, text);
    }

    // Extract text content and parse
    const textContent = rpc.result?.content?.find((c) => c.type === "text");
    if (!textContent?.text) {
      return undefined as T;
    }

    try {
      return JSON.parse(textContent.text) as T;
    } catch {
      // Return raw text if not valid JSON
      return textContent.text as T;
    }
  }

  /**
   * Health check - is the mcp-proxy container reachable?
   * Uses the /health endpoint, not a JSON-RPC call.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
