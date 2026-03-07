import chalk from "chalk";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { clackMultiSelect, clackPassword } from "../ui.js";

// Constants
const DEFAULT_PROXY_PORT = 3847;
const JSON_INDENT_SPACES = 2;
const DECIMAL_RADIX = 10;

export interface DockerProxyInfo {
  containerId: string;
  port: number;
  running: boolean;
}

/**
 * Docker setup information for MCP deployment classification
 */
export interface DockerSetup {
  configuredServers: string[];
  hasDockerCompose: boolean;
  hasEnvFile: boolean;
  hasMcpServices: boolean;
  mcpServices: string[];
}

export interface McpServerOption {
  category: "ai" | "browser" | "documentation" | "infrastructure" | "proxy" | "search";
  default: boolean;
  defaultArgs?: string[];  // Additional args appended to command (e.g., ["--headless"])
  deployment?: "docker" | "hybrid" | "local";
  description: string;
  incompatibleWith?: string[];
  localOnly?: boolean;
  name: string;
  note?: string;
  package?: string;
  requiresKey?: boolean;
  signupUrl?: string;            // URL where users register for API key (different from MCP endpoint)
  transport?: "http" | "stdio";  // Transport type (default: stdio when not specified)
  url?: string;
  warning?: string;
}

interface DockerPsResult {
  containerId: string;
  ports: string;
  status: string;
}

interface HttpServerConfig {
  headers?: Record<string, string>;
  type: "http";
  url: string;
}

interface ServerConfig {
  args: string[];
  command: string;
  env?: Record<string, string>;
}

/**
 * Classify where an MCP server should be deployed based on its configuration and Docker availability
 * @param server - MCP server configuration
 * @param dockerSetup - Docker environment setup information
 * @returns Deployment target: 'local' or 'docker'
 */
export function classifyDeployment(
  server: McpServerOption,
  dockerSetup: DockerSetup
): "docker" | "local" {
  // Local-only servers always run locally
  if (server.localOnly === true) {
    return "local";
  }

  // Explicit docker preference
  if (server.deployment === "docker") {
    return "docker";
  }

  // Hybrid servers: docker if available, otherwise local
  if (server.deployment === "hybrid") {
    return dockerSetup.hasDockerCompose ? "docker" : "local";
  }

  // Default to local
  return "local";
}

// Local MCP servers - these run directly via npx (NOT in Docker)
// Note: context7 is now in the proxy, not listed here
export const localServers: McpServerOption[] = [
  {
    category: "browser",
    default: true,
    description: "Browser automation, testing, and web scraping",
    name: "chrome-devtools",
    package: "chrome-devtools-mcp@latest",
    warning: "Requires Chrome browser with --remote-debugging-port=9222"
  },
  {
    category: "browser",
    default: false,
    defaultArgs: ["--headless", "--caps=testing,tracing"],
    deployment: "hybrid",  // When Docker mcp-proxy is running, use HTTP transport (headed inside Docker)
    description: "E2E testing with accessibility tree automation",
    name: "playwright",
    note: "Uses accessibility tree instead of screenshots for reliable automation",
    package: "@playwright/mcp@latest",
    transport: "stdio",  // Default for local; overridden to HTTP when Docker detected
    url: "http://localhost:3848/mcp"  // Used when Docker mcp-proxy provides headed Playwright
  },
  {
    category: "ai",
    default: false,
    description: "Dynamic reasoning chains for complex decisions",
    name: "sequential-thinking",
    note: "Low latency local server for multi-step reasoning",
    package: "@modelcontextprotocol/server-sequential-thinking"
  },
  {
    category: "documentation",
    default: false,
    description: "Semantic code navigation via LSP",
    localOnly: true,
    name: "serena",
    note: "Free open-source server for code understanding",
    warning: "Requires Python 3.11+ and uv (pip install uv)"
  }
];

// All servers (for backward compatibility and API key collection)
export const availableServers: McpServerOption[] = [
  ...localServers,
  // These run inside Docker proxy container
  {
    category: "search",
    default: false,
    description: "Neural web search with semantic understanding",
    name: "exa",
    package: "mcp-remote",
    requiresKey: true,
    url: "https://mcp.exa.ai/mcp"
  },
  {
    category: "ai",
    default: false,
    description: "Vercel v0 UI component generation (one-shot, no chatId required)",
    name: "v0",
    note: "Uses OpenAI-compatible API for autonomous UI generation",
    package: "v0-mcp",
    requiresKey: true,
    signupUrl: "https://v0.dev/api"
  },
  {
    category: "ai",
    default: false,
    description: "AI model hosting and deployment",
    name: "replicate",
    package: "replicate-mcp",
    requiresKey: true
  },
  {
    category: "infrastructure",
    default: false,
    description: "Cloudflare infrastructure management",
    name: "cloudflare",
    package: "@cloudflare/mcp-server-cloudflare",
    requiresKey: true
  },
  {
    category: "documentation",
    default: false,
    description: "Token-efficient documentation search via Ref.tools",
    name: "ref",
    requiresKey: true,
    signupUrl: "https://ref.tools",
    transport: "http",
    url: "https://api.ref.tools/mcp"
  }
];

export interface McpSelectionResult {
  localServers: string[];
  proxyPort?: number;
  useProxy: boolean;
}

export async function collectRequiredKeys(selectedServers: string[]): Promise<void> {
  const keyRequiredServers = selectedServers.filter(s => {
    const server = availableServers.find(opt => opt.name === s && opt.requiresKey === true);
    return server !== undefined;
  });

  for (const serverName of keyRequiredServers) {
    const server = availableServers.find(opt => opt.name === serverName);
    if (server === undefined) continue;

    // Use signupUrl if available (where users register), fallback to url
    const keyUrl = server.signupUrl ?? server.url ?? "";
    const apiKey = await clackPassword(
      `Enter ${server.name} API key${keyUrl === "" ? "" : ` (get yours at ${keyUrl})`}`
    );

    if (apiKey !== "") {
      // Store in .env
      const envFile = path.join(process.cwd(), ".env");
      const envContent = await fs.readFile(envFile, "utf8").catch(() => "");
      const keyVar = server.name.toUpperCase().replaceAll('-', "_") + "_API_KEY";

      // Check if key already exists
      const keyRegex = new RegExp(`^${keyVar}=.*$`, "m");
      const newEnvContent = keyRegex.test(envContent)
        ? envContent.replace(keyRegex, `${keyVar}=${apiKey}`)
        : envContent + (envContent !== "" && !envContent.endsWith("\n") ? "\n" : "") + `${keyVar}=${apiKey}\n`;

      await fs.writeFile(envFile, newEnvContent);
      console.log(chalk.green(`Added ${keyVar} to .env`));
    }
  }
}

/**
 * Detect running Docker container named "mcp-proxy"
 * Returns container info if found, undefined otherwise
 */
export function detectDockerProxy(): DockerProxyInfo | undefined {
  try {
    // Check if Docker is available
    execSync("docker --version", { stdio: "ignore" });

    // Look for container named "mcp-proxy" (running or stopped)
    const result = execSync(
      "docker ps -a --filter \"name=mcp-proxy\" --format \"{{.ID}}|{{.Status}}|{{.Ports}}\"",
      { encoding: "utf8" }
    ).trim();

    if (result === "") return undefined;

    const parts = result.split("|");
    const parsedResult: DockerPsResult = {
      containerId: parts[0] ?? "",
      ports: parts[2] ?? "",
      status: parts[1] ?? ""
    };

    if (parsedResult.containerId === "") return undefined;

    const running = parsedResult.status.toLowerCase().startsWith("up");

    // Extract port mapping (e.g., "0.0.0.0:3847->3847/tcp" -> 3847)
    let port = DEFAULT_PROXY_PORT;
    const portMatch = /0\.0\.0\.0:(\d+)/.exec(parsedResult.ports);
    const portString = portMatch?.[1];
    if (portString !== undefined && portString !== "") {
      port = Number.parseInt(portString, DECIMAL_RADIX);
    }

    return { containerId: parsedResult.containerId, port, running };
  } catch {
    return undefined;
  }
}

export async function generateMcpJson(selection: McpSelectionResult): Promise<void> {
  const servers: Record<string, HttpServerConfig | ServerConfig> = {};
  const mcpConfig = {
    mcpServers: servers
  };

  // Always add local servers as direct connections
  for (const serverName of selection.localServers) {
    const server = availableServers.find(s => s.name === serverName);
    if (server !== undefined) {
      // When Docker proxy is running, Playwright runs headed inside the container
      // and exposes HTTP transport on port 3848 (for xvfb+ffmpeg video capture)
      servers[serverName] = server.name === "playwright" && server.deployment === "hybrid" && selection.useProxy ? {
        type: "http",
        url: server.url ?? "http://localhost:3848/mcp"
      } : getServerConfig(server);
    }
  }

  // Add proxy if enabled (connects to Docker via HTTP)
  if (selection.useProxy) {
    const proxyPort = selection.proxyPort ?? DEFAULT_PROXY_PORT;
    servers["mcp-proxy"] = {
      type: "http",
      url: `http://localhost:${String(proxyPort)}`
    };
  }

  // Write .mcp.json
  await fs.writeFile(".mcp.json", JSON.stringify(mcpConfig, undefined, JSON_INDENT_SPACES));
}

// Legacy function for backward compatibility
export async function generateMcpJsonLegacy(selectedServers: string[], useProxy = false): Promise<void> {
  const result: McpSelectionResult = {
    localServers: selectedServers.filter(s => s !== "claude-workflow-proxy" && s !== "mcp-proxy"),
    proxyPort: DEFAULT_PROXY_PORT,
    useProxy: useProxy || selectedServers.includes("claude-workflow-proxy") || selectedServers.includes("mcp-proxy")
  };
  return generateMcpJson(result);
}

// MCPs that run inside the Docker proxy container
const proxyContainedMcps = ["context7", "exa", "v0", "replicate", "cloudflare"];

export async function promptMcpSelection(): Promise<McpSelectionResult> {
  // Build options - local servers first, then proxy if detected
  const options: { hint?: string; label: string; value: string }[] = [];
  const initialValues: string[] = [];

  // Add local servers with (local) suffix
  for (const server of localServers) {
    let hint = server.description;
    const serverWarning = server.warning;
    if (serverWarning !== undefined && serverWarning !== "") {
      hint += ` [${serverWarning}]`;
    }

    options.push({
      hint,
      label: `${server.name} (local)`,
      value: server.name
    });

    // Select all MCPs by default
    initialValues.push(server.name);
  }

  // Check for Docker proxy - only show if running
  const dockerProxy = detectDockerProxy();
  let proxyPort = DEFAULT_PROXY_PORT;

  if (dockerProxy?.running === true) {
    proxyPort = dockerProxy.port;
    // Format: "MCP Proxy (Exa, Cloudflare, V0, Replicate)"
    const proxyMcpList = proxyContainedMcps.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(", ");

    options.push({
      hint: `Docker proxy on port ${String(dockerProxy.port)}`,
      label: `MCP Proxy (${proxyMcpList})`,
      value: "mcp-proxy"
    });

    // Pre-select proxy since it's running
    initialValues.push("mcp-proxy");
  }

  // Single multiselect for all options - use clackMultiSelect wrapper for testability
  const selected = await clackMultiSelect(
    "Select MCP servers",
    options,
    initialValues
  );
  const selectedLocalServers = selected.filter(s => s !== "mcp-proxy");
  const useProxy = selected.includes("mcp-proxy");

  return { localServers: selectedLocalServers, proxyPort, useProxy };
}

function getServerConfig(server: McpServerOption): HttpServerConfig | ServerConfig {
  // Handle HTTP transport servers (e.g., ref)
  if (server.transport === "http" && server.url !== undefined) {
    const httpConfig: HttpServerConfig = {
      type: "http",
      url: server.url
    };

    // Add Authorization header for servers requiring API keys
    if (server.requiresKey === true) {
      const keyVar = server.name.toUpperCase().replaceAll('-', "_") + "_API_KEY";
      httpConfig.headers = {
        "Authorization": `Bearer \${${keyVar}}`
      };
    }

    return httpConfig;
  }

  // Handle stdio transport servers
  const config: ServerConfig = {
    args: [],
    command: ""
  };

  if (server.package === "built-in") {
    // Built-in proxy server
    config.command = "node";
    config.args = [path.join(process.cwd(), "lib/proxy/standalone.js")];
  } else if (server.package === "mcp-remote") {
    // Remote MCP server
    config.command = "mcp";
    const serverUrl = server.url ?? "";
    config.args = ["connect", serverUrl];
  } else if (server.name === "serena") {
    // Serena uses uvx (Python package manager) with specific args
    // Use "." instead of ${workspaceFolder} - Serena resolves to absolute path at runtime
    // and this avoids Claude Code variable expansion issues
    config.command = "uvx";
    config.args = [
      "--from", "git+https://github.com/oraios/serena",
      "serena", "start-mcp-server",
      "--context", "claude-code",
      "--project", "."
    ];
    return config;
  } else {
    // Standard npm package
    const serverPackage = server.package ?? "";
    const baseArgs = ["-y", serverPackage];

    // Add default args if specified (e.g., Playwright's --headless)
    if (server.defaultArgs !== undefined && server.defaultArgs.length > 0) {
      baseArgs.push(...server.defaultArgs);
    }

    // Add chrome-devtools specific args for remote browser connection
    // Required for WSL environments where Chrome runs on Windows
    if (server.name === "chrome-devtools") {
      baseArgs.push("--browserUrl=http://localhost:9222");
    }

    // Wrap browser-category servers with timeout (2 hours) to prevent orphaned processes
    if (server.category === "browser") {
      config.command = "timeout";
      config.args = ["7200", "npx", ...baseArgs];
    } else {
      config.command = "npx";
      config.args = baseArgs;
    }
  }

  // Add environment variables for API keys if needed
  if (server.requiresKey === true) {
    const keyVar = server.name.toUpperCase().replaceAll('-', "_") + "_API_KEY";
    config.env = {
      [keyVar]: `\${${keyVar}}` // Use environment variable
    };
  }

  return config;
}