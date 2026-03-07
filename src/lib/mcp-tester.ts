import { type ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import * as path from "node:path";

import { validateMcpConfigFile } from "./mcp-config.js";
import { showError, showInfo, showSuccess } from "./ui.js";

interface JsonSchemaProperty {
  description?: string;
  items?: Record<string, string>;
  type: string;
}

interface McpResponse {
  error?: {
    code?: number;
    message?: string;
  };
  id: number;
  jsonrpc: string;
  result?: {
    serverInfo?: {
      version?: string;
    };
    tools?: McpTool[];
  };
}

interface McpTool {
  description?: string;
  inputSchema?: {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    type: string;
  };
  name: string;
}

interface ParseResult {
  errors: string[];
  valid: boolean;
}

interface ServerConfig {
  args?: string[];
  command?: string;
  configs?: Record<string, {
    defer_loading?: boolean;
  }>;
  default_config?: {
    defer_loading?: boolean;
  };
  env?: Record<string, string>;
  url?: string;
}

interface TestResults {
  details: {
    handshakeComplete?: boolean;
    processSpawned?: boolean;
    serverVersion?: string;
    toolCount?: number;
    tools?: McpTool[];
  };
  errors: string[];
  serverName: string;
  success: boolean;
}

/**
 * Parse and validate MCP protocol response
 *
 * @param response - Response from MCP server
 * @returns Validation result { valid: boolean, errors: Array<string> }
 *
 * @example
 * const result = parseTestResponse(response);
 * if (!result.valid) {
 *   console.error('Protocol errors:', result.errors);
 * }
 */
export function parseTestResponse(response: McpResponse): ParseResult {
  const errors: string[] = [];

  // Validate JSON-RPC version
  if (response.jsonrpc !== "2.0") {
    errors.push(`Invalid JSON-RPC version: ${response.jsonrpc} (expected "2.0")`);
  }

  // Validate response has result or error
  if (response.result === undefined && response.error === undefined) {
    errors.push("Response missing both \"result\" and \"error\" fields");
  }

  // If error response, extract error message
  if (response.error !== undefined) {
    errors.push(`Server returned error: ${response.error.message ?? JSON.stringify(response.error)}`);
  }

  return {
    errors,
    valid: errors.length === 0
  };
}

/**
 * Format and display test results
 *
 * @param results - Test results from testServerConnection()
 * @param results.success - Whether test passed
 * @param results.serverName - Name of tested server
 * @param results.details - Test details (version, tool count, etc.)
 * @param results.errors - Any errors encountered
 * @returns void
 *
 * @example
 * const results = await testServerConnection('chrome-devtools');
 * reportTestResults(results);
 */
export function reportTestResults(results: TestResults): void {
  const SEPARATOR_WIDTH = 60;
  const separator = "=".repeat(SEPARATOR_WIDTH);

  console.log("\n" + separator);
  console.log(`MCP Server Test: ${results.serverName}`);
  console.log(separator + "\n");

  if (results.success) {
    showSuccess("ALL TESTS PASSED");
    console.log("\nDetails:");
    console.log(`  Server Version: ${results.details.serverVersion ?? "unknown"}`);
    console.log(`  Tools Available: ${String(results.details.toolCount ?? 0)}`);
    console.log(`  Process Spawned: ${results.details.processSpawned === true ? "✓" : "✗"}`);
    console.log(`  Handshake Complete: ${results.details.handshakeComplete === true ? "✓" : "✗"}`);
  } else {
    showError("TEST FAILED");
    console.log("\nErrors:");
    for (const err of results.errors) {
      console.log(`  ✗ ${err}`);
    }
  }

  console.log("\n" + separator + "\n");
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_SPAWN_TIMEOUT_MS = 10_000;
const REQUEST_ID_INIT = 1;
const REQUEST_ID_TOOLS_LIST = 2;

/**
 * Send MCP initialization request to server
 *
 * @param serverProcess - Spawned server process
 * @param timeoutMs - Timeout in milliseconds
 * @returns MCP initialization response
 * @throws Error If request times out or response is invalid JSON
 *
 * @example
 * const response = await sendTestRequest(serverProcess);
 * console.log(response.result.serverInfo.version);
 */
export async function sendTestRequest(serverProcess: ChildProcess, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<McpResponse> {
  return new Promise<McpResponse>((resolve, reject) => {
    let resolved = false;

    const request = {
      id: REQUEST_ID_INIT,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: {
          name: "mcp-tester",
          version: "1.0.0"
        },
        protocolVersion: "2024-11-05"
      }
    };

    // Buffer to accumulate data
    let buffer = "";

    // Listen for response
    const responseHandler = (data: Buffer): void => {
      buffer += data.toString();

      // Try to parse complete JSON objects (may receive multiple or partial)
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim().length === 0) continue;

        try {
          const response = JSON.parse(line) as McpResponse;
          if (response.id === REQUEST_ID_INIT && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            serverProcess.stdout?.removeListener("data", responseHandler);
            resolve(response);
          }
        } catch {
          // Ignore parse errors for partial JSON, continue buffering
        }
      }
    };

    serverProcess.stdout?.on("data", responseHandler);

    // Send request
    serverProcess.stdin?.write(JSON.stringify(request) + "\n");

    // Timeout after specified time
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        serverProcess.stdout?.removeListener("data", responseHandler);
        reject(new Error("Initialization request timed out"));
      }
    }, timeoutMs);
  });
}

/**
 * Spawn an MCP server process with timeout
 *
 * @param serverConfig - Server config from .mcp.json with command and args
 * @param timeoutMs - Timeout in milliseconds (default: 10 seconds)
 * @returns Spawned process
 * @throws Error If process fails to start or times out
 *
 * @example
 * const config = { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-chrome-devtools'] };
 * const process = await spawnMcpServer(config, 5000);
 */
export async function spawnMcpServer(serverConfig: ServerConfig, timeoutMs = DEFAULT_SPAWN_TIMEOUT_MS): Promise<ChildProcess> {
  return new Promise<ChildProcess>((resolve, reject) => {
    let resolved = false;

    if (serverConfig.command === undefined) {
      reject(new Error("Server configuration missing 'command' field"));
      return;
    }

    const serverProcess = spawn(serverConfig.command, serverConfig.args ?? [], {
      env: { ...process.env, ...serverConfig.env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        serverProcess.kill();
        reject(new Error(`Server failed to start within ${String(timeoutMs)}ms`));
      }
    }, timeoutMs);

    // Wait for first output (indicates server started)
    serverProcess.stdout?.once("data", () => {  
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(serverProcess);
      }
    });

    serverProcess.on("error", (error: NodeJS.ErrnoException) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);

        // Handle missing command (ENOENT error)
        if (error.code === "ENOENT") {
          const commandName = serverConfig.command ?? "unknown";
          reject(new Error(
            `Server command not found: "${commandName}"\n` +
            "Suggestion: Run 'npm install' or check .mcp.json configuration"
          ));
        } else {
          reject(new Error(`Failed to spawn server: ${error.message}`));
        }
      }
    });

    serverProcess.on("exit", (code: null | number) => {
      if (!resolved && code !== null && code !== 0) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Server crashed with exit code: ${String(code)}`));
      }
    });

    // Log stderr but don't fail on warnings
    // stderr is guaranteed to be non-null with stdio: ["pipe", "pipe", "pipe"]
    serverProcess.stderr.on("data", () => {
      // Silent - MCP servers often output warnings on stderr
      // Only actual errors will cause the process to exit
    });
  });
}

/**
 * Test an MCP server connection end-to-end
 * Spawns server, performs handshake, lists tools, validates responses
 *
 * @param serverName - Name of MCP server from .mcp.json
 * @param configPath - Optional path to .mcp.json (defaults to current directory)
 * @returns Test results { success: boolean, serverName: string, details: Object, errors: Array }
 * @throws Error If config validation fails catastrophically
 *
 * @example
 * const results = await testServerConnection('chrome-devtools');
 * if (results.success) {
 *   console.log(`Server has ${results.details.toolCount} tools`);
 * }
 */
export async function testServerConnection(serverName: string, configPath: string | undefined = undefined): Promise<TestResults> {
  const results: TestResults = {
    details: {},
    errors: [],
    serverName,
    success: false
  };

  let serverProcess: ChildProcess | undefined = undefined;

  try {
    // Step 1: Load and validate config
    const mcpConfigPath = configPath ?? path.join(process.cwd(), ".mcp.json");
    showInfo(`Testing ${serverName} MCP server...`);

    const validation = validateMcpConfigFile(mcpConfigPath);

    if (!validation.valid) {
      results.errors.push(...validation.errors);
      return results;
    }

    if (validation.config === undefined) {
      results.errors.push("Configuration validation succeeded but config is undefined");
      return results;
    }

    const serverConfig = validation.config.mcpServers[serverName];
    if (serverConfig === undefined) {
      results.errors.push(`Server "${serverName}" not found in .mcp.json`);
      showError(`Server "${serverName}" not found in configuration`);
      return results;
    }

    // Step 2: Spawn server process
    serverProcess = await spawnMcpServer(serverConfig);
    showSuccess("Process spawned successfully");
    results.details.processSpawned = true;

    // Step 3: Send initialization request
    const initResponse = await sendTestRequest(serverProcess);
    const parseResult = parseTestResponse(initResponse);

    if (!parseResult.valid) {
      results.errors.push(...parseResult.errors);
      showError("MCP handshake failed");
      for (const err of parseResult.errors) {
        console.log(`  ${err}`);
      }
      return results;
    }

    showSuccess("MCP handshake completed");
    results.details.handshakeComplete = true;
    results.details.serverVersion = initResponse.result?.serverInfo?.version ?? "unknown";
    showSuccess(`Server version: ${results.details.serverVersion}`);

    // Step 4: List available tools
    const toolsResponse = await listTools(serverProcess);
    const toolsParseResult = parseTestResponse(toolsResponse);

    if (!toolsParseResult.valid) {
      results.errors.push(...toolsParseResult.errors);
      showError("Failed to list tools");
      return results;
    }

    const tools = toolsResponse.result?.tools ?? [];
    results.details.tools = tools;
    results.details.toolCount = tools.length;

    showSuccess(`Tools available: ${String(tools.length)}`);
    for (const tool of tools) {
      console.log(`    - ${tool.name}`);
    }

    results.success = true;
    showSuccess("Connection test PASSED");

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.errors.push(errorMessage);
    showError(`Connection test FAILED: ${errorMessage}`);
  } finally {
    // Step 5: Clean shutdown
    if (serverProcess !== undefined && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
  }

  return results;
}

/**
 * List available tools from MCP server
 *
 * @param serverProcess - Spawned server process
 * @param timeoutMs - Timeout in milliseconds
 * @returns Tools list response
 * @throws Error If request times out or response is invalid JSON
 *
 * @private
 */
async function listTools(serverProcess: ChildProcess, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<McpResponse> {
  return new Promise<McpResponse>((resolve, reject) => {
    let resolved = false;

    const request = {
      id: REQUEST_ID_TOOLS_LIST,
      jsonrpc: "2.0",
      method: "tools/list",
      params: {}
    };

    // Buffer to accumulate data
    let buffer = "";

    // Listen for response
    const responseHandler = (data: Buffer): void => {
      buffer += data.toString();

      // Try to parse complete JSON objects
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) continue;

        try {
          const response = JSON.parse(line) as McpResponse;
          if (response.id === REQUEST_ID_TOOLS_LIST && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            serverProcess.stdout?.removeListener("data", responseHandler);
            resolve(response);
          }
        } catch {
          // Ignore parse errors for partial JSON
        }
      }
    };

    serverProcess.stdout?.on("data", responseHandler);

    // Send request
    serverProcess.stdin?.write(JSON.stringify(request) + "\n");

    // Timeout after specified time
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        serverProcess.stdout?.removeListener("data", responseHandler);
        reject(new Error("tools/list request timed out"));
      }
    }, timeoutMs);
  });
}