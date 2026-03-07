/**
 * MCP Config Manager Service
 * Manages MCP server configurations persisted to ~/.mcp-proxy/mcp-servers.json
 * Also generates the full proxy config file for container volume mount
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  /** Unique server identifier (alphanumeric with hyphens) */
  name: string;
  /** Command to execute (e.g., 'npx', 'node', 'python') */
  command: string;
  /** Command arguments array */
  args?: string[];
  /** Transport type (default: 'stdio') */
  transport?: "stdio" | "http";
  /** Idle timeout in seconds (0 = no timeout) */
  idleTimeout?: number;
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Config file structure
 */
interface ConfigFile {
  servers: McpServerConfig[];
}

// Server name pattern: alphanumeric with hyphens, 1-64 characters
// Must start and end with alphanumeric, hyphens only in middle
const SERVER_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Default MCP servers for the mcp-proxy Docker container
 *
 * These are remote/API-based MCP servers that benefit from running in Docker.
 * Local MCP servers (chrome-devtools, playwright, sequential-thinking, serena)
 * are configured separately via claude-workflow and run on the host machine.
 */
const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    name: "context7",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    transport: "stdio",
    env: {},
  },
  {
    name: "exa",
    command: "npx",
    args: ["-y", "exa-mcp-server@latest"],
    transport: "stdio",
    env: { "EXA_API_KEY": "${EXA_API_KEY}" },
  },
  {
    name: "ref-tools",
    command: "npx",
    args: ["-y", "ref-tools-mcp@latest"],
    transport: "stdio",
    env: { "REF_API_KEY": "${REF_API_KEY}" },
  },
  // Meshy AI auto-rigging and animation MCP server
  {
    name: "meshy",
    command: "npx",
    args: ["-y", "meshy-mcp@latest"],
    transport: "stdio",
    env: { "MESHY_API_KEY": "${MESHY_API_KEY}" },
  },
  // v0 UI component generation MCP server
  {
    name: "v0",
    command: "npx",
    args: ["-y", "v0-mcp@latest"],
    transport: "stdio",
    env: { "V0_API_KEY": "${V0_API_KEY}" },
  },
  // Netlify MCP - Static site deployment with local directory zip upload
  // Auth: Personal Access Token from Netlify Dashboard > User Settings > OAuth > Applications
  // Docs: https://github.com/netlify/netlify-mcp
  {
    name: "netlify",
    command: "npx",
    args: ["-y", "@netlify/mcp"],
    transport: "stdio",
    idleTimeout: 300_000,
    env: {
      "NETLIFY_PERSONAL_ACCESS_TOKEN": "${NETLIFY_PERSONAL_ACCESS_TOKEN}",
    },
  },
  // DigitalOcean MCP - Full infrastructure management (apps, droplets, databases, networking, spaces)
  // Auth: API token from DigitalOcean Dashboard > API > Generate New Token
  // BILLING WARNING: Tools can provision real infrastructure that incurs charges
  // Docs: https://github.com/digitalocean-labs/mcp-digitalocean
  {
    name: "digitalocean",
    command: "npx",
    args: ["-y", "@digitalocean/mcp", "--services", "apps,droplets,databases,networking,spaces"],
    transport: "stdio",
    idleTimeout: 300_000,
    env: {
      "DIGITALOCEAN_API_TOKEN": "${DIGITALOCEAN_API_TOKEN}",
    },
  },
  // Railway Community MCP - Full-stack app hosting from git repos and Docker images
  // Uses community package (official Railway MCP requires interactive CLI login)
  // Auth: API token from Railway Dashboard > Account > Tokens
  // Docs: https://github.com/jason-tan-swe/railway-mcp
  {
    name: "railway",
    command: "npx",
    args: ["-y", "@jasontanswe/railway-mcp"],
    transport: "stdio",
    idleTimeout: 300_000,
    env: {
      "RAILWAY_API_TOKEN": "${RAILWAY_API_TOKEN}",
    },
  },
];

/**
 * Get the mcp-proxy config directory path
 */
function getMcpProxyConfigDir(): string {
  return path.join(process.env.HOME || "", ".mcp-proxy");
}

/**
 * Get the mcp-servers.json file path
 */
function getMcpServersFilePath(): string {
  return path.join(getMcpProxyConfigDir(), "mcp-servers.json");
}

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const configDir = getMcpProxyConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

/**
 * Validate server name format
 */
export function validateServerName(name: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof name !== "string" || name.length === 0) {
    errors.push("name is required and must be a non-empty string");
    return { valid: false, errors };
  }

  if (name.length > 64) {
    errors.push("name must be 64 characters or less");
  }

  if (!SERVER_NAME_PATTERN.test(name)) {
    errors.push("name must be lowercase alphanumeric with hyphens (cannot start or end with hyphen)");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate complete server configuration
 */
export function validateServerConfig(config: Partial<McpServerConfig>): ValidationResult {
  const errors: string[] = [];

  // Validate name
  const nameValidation = validateServerName(config.name);
  errors.push(...nameValidation.errors);

  // Validate command
  if (typeof config.command !== "string" || config.command.trim().length === 0) {
    errors.push("command is required and must be a non-empty string");
  }

  // Validate args (optional)
  if (config.args !== undefined) {
    if (!Array.isArray(config.args)) {
      errors.push("args must be an array of strings");
    } else if (!config.args.every((arg) => typeof arg === "string")) {
      errors.push("all args must be strings");
    }
  }

  // Validate transport (optional) - supports stdio, http, sse, and streamable-http
  const validTransports = ["stdio", "http", "sse", "streamable-http"];
  if (config.transport !== undefined && !validTransports.includes(config.transport)) {
    errors.push(`transport must be one of: ${validTransports.join(", ")}`);
  }

  // Validate idleTimeout (optional)
  if (config.idleTimeout !== undefined &&
      (typeof config.idleTimeout !== "number" || config.idleTimeout < 0)) {
    errors.push("idleTimeout must be a non-negative number");
  }

  // Validate env (optional)
  if (config.env !== undefined) {
    if (typeof config.env !== "object" || config.env === null || Array.isArray(config.env)) {
      errors.push("env must be an object");
    } else {
      for (const [key, value] of Object.entries(config.env)) {
        if (typeof value !== "string") {
          errors.push(`env.${key} must be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate server update (name cannot be changed)
 */
export function validateServerUpdate(config: Partial<McpServerConfig>): ValidationResult {
  const errors: string[] = [];

  // Name should not be in update payload
  if (config.name !== undefined) {
    errors.push("name cannot be changed; use DELETE and POST to rename");
  }

  // Validate command if provided
  if (config.command !== undefined &&
      (typeof config.command !== "string" || config.command.trim().length === 0)) {
    errors.push("command must be a non-empty string");
  }

  // Validate args if provided
  if (config.args !== undefined) {
    if (!Array.isArray(config.args)) {
      errors.push("args must be an array of strings");
    } else if (!config.args.every((arg) => typeof arg === "string")) {
      errors.push("all args must be strings");
    }
  }

  // Validate transport if provided
  if (config.transport !== undefined && !["stdio", "http"].includes(config.transport)) {
    errors.push("transport must be 'stdio' or 'http'");
  }

  // Validate idleTimeout if provided
  if (config.idleTimeout !== undefined &&
      (typeof config.idleTimeout !== "number" || config.idleTimeout < 0)) {
    errors.push("idleTimeout must be a non-negative number");
  }

  // Validate env if provided
  if (config.env !== undefined) {
    if (typeof config.env !== "object" || config.env === null || Array.isArray(config.env)) {
      errors.push("env must be an object");
    } else {
      for (const [key, value] of Object.entries(config.env)) {
        if (typeof value !== "string") {
          errors.push(`env.${key} must be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * MCP Config Manager class
 */
export class McpConfigManager {
  private filePath: string;

  constructor() {
    this.filePath = getMcpServersFilePath();
  }

  /**
   * Read config file, initializing with defaults if not exists
   */
  private async readConfig(): Promise<ConfigFile> {
    try {
      if (!existsSync(this.filePath)) {
        // First time setup - create with default servers
        console.log("[mcp-config-manager] Config file not found, creating with default servers");
        const defaultConfig = { servers: [...DEFAULT_MCP_SERVERS] };
        await this.writeConfig(defaultConfig);
        return defaultConfig;
      }
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as ConfigFile;
      return { servers: parsed.servers || [] };
    } catch {
      // Return empty config on parse error
      return { servers: [] };
    }
  }

  /**
   * Write config file
   */
  private async writeConfig(config: ConfigFile): Promise<void> {
    await ensureConfigDir();
    await writeFile(this.filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  /**
   * List all configured servers
   */
  async listServers(): Promise<McpServerConfig[]> {
    const config = await this.readConfig();
    return config.servers;
  }

  /**
   * Get server by name
   */
  async getServer(name: string): Promise<McpServerConfig | undefined> {
    const config = await this.readConfig();
    return config.servers.find((s) => s.name === name);
  }

  /**
   * Add new server configuration
   */
  async addServer(server: McpServerConfig): Promise<McpServerConfig> {
    const config = await this.readConfig();

    // Apply defaults
    const newServer: McpServerConfig = {
      name: server.name,
      command: server.command,
      args: server.args ?? [],
      transport: server.transport ?? "stdio",
      idleTimeout: server.idleTimeout ?? 0,
      env: server.env ?? {},
    };

    config.servers.push(newServer);
    await this.writeConfig(config);

    console.log(`[mcp-config-manager] Added server: ${server.name}`);
    return newServer;
  }

  /**
   * Update existing server configuration
   */
  async updateServer(name: string, updates: Partial<McpServerConfig>): Promise<McpServerConfig> {
    const config = await this.readConfig();
    const index = config.servers.findIndex((s) => s.name === name);

    if (index === -1) {
      throw new Error(`Server '${name}' not found`);
    }

    // Merge updates (excluding name)
    const existing = config.servers[index];
    const updated: McpServerConfig = {
      ...existing,
      command: updates.command ?? existing.command,
      args: updates.args ?? existing.args,
      transport: updates.transport ?? existing.transport,
      idleTimeout: updates.idleTimeout ?? existing.idleTimeout,
      env: updates.env ?? existing.env,
    };

    config.servers[index] = updated;
    await this.writeConfig(config);

    console.log(`[mcp-config-manager] Updated server: ${name}`);
    return updated;
  }

  /**
   * Remove server configuration
   */
  async removeServer(name: string): Promise<void> {
    const config = await this.readConfig();
    const index = config.servers.findIndex((s) => s.name === name);

    if (index === -1) {
      throw new Error(`Server '${name}' not found`);
    }

    config.servers.splice(index, 1);
    await this.writeConfig(config);

    console.log(`[mcp-config-manager] Removed server: ${name}`);
  }
}

// =========================================================================
// MCP Proxy Config Generation (for container volume mount)
// =========================================================================

/**
 * MCP child server configuration for proxy config format
 */
export interface McpChildServer {
  command: string;
  args: string[];
  transport: "stdio" | "http";
  idleTimeout?: number;
  env?: Record<string, string>;
}

/**
 * Full MCP proxy configuration structure
 * This is the format expected by mcp-proxy standalone.ts
 */
export interface McpProxyConfig {
  proxy: {
    port: number;
    host: string;
    idleTimeout: number;
  };
  childServers: Record<string, McpChildServer>;
}

/**
 * Get the MCP config file path for container volume mount
 * Located at ~/.mcp-proxy/mcp-config.json
 */
export function getMcpConfigPath(): string {
  const configDir = getMcpProxyConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    // Create subdirectories for volume mounts
    mkdirSync(path.join(configDir, "exports"), { recursive: true });
    mkdirSync(path.join(configDir, "video-output"), { recursive: true });
    mkdirSync(path.join(configDir, "demo-video-output"), { recursive: true });
  }
  return path.join(configDir, "mcp-config.json");
}

/**
 * Default proxy configuration
 */
function getDefaultProxyConfig(): McpProxyConfig["proxy"] {
  return {
    port: 3847,
    host: "0.0.0.0",
    idleTimeout: 0,
  };
}

/**
 * Convert McpServerConfig (our format) to McpChildServer (proxy format)
 */
function serverConfigToChildServer(server: McpServerConfig): McpChildServer {
  return {
    command: server.command,
    args: server.args ?? [],
    transport: server.transport ?? "stdio",
    idleTimeout: server.idleTimeout ?? 0,
    env: server.env,
  };
}

/**
 * Generate full MCP proxy config from stored servers
 * Combines stored servers from mcp-servers.json into the full proxy config format
 */
export async function generateProxyConfig(): Promise<McpProxyConfig> {
  const configManager = new McpConfigManager();
  const servers = await configManager.listServers();

  const childServers: Record<string, McpChildServer> = {};
  for (const server of servers) {
    childServers[server.name] = serverConfigToChildServer(server);
  }

  return {
    proxy: getDefaultProxyConfig(),
    childServers,
  };
}

/**
 * Read current MCP proxy config from file
 */
export function readMcpProxyConfig(): McpProxyConfig {
  const configPath = getMcpConfigPath();

  if (!existsSync(configPath)) {
    // Return default config if file doesn't exist
    return {
      proxy: getDefaultProxyConfig(),
      childServers: {},
    };
  }

  try {
    const content = readFileSync(configPath, "utf8");
    return JSON.parse(content) as McpProxyConfig;
  } catch (error) {
    console.error("[mcp-config-manager] Error reading proxy config:", error);
    return {
      proxy: getDefaultProxyConfig(),
      childServers: {},
    };
  }
}

/**
 * Write MCP proxy config to file with atomic write pattern
 * Uses temp file + rename for safe writes
 */
export function writeMcpProxyConfig(config: McpProxyConfig): void {
  const configPath = getMcpConfigPath();
  const tempPath = `${configPath}.tmp`;

  try {
    // Validate config structure
    if (!config.proxy || !config.childServers) {
      throw new Error("Invalid config structure: missing proxy or childServers");
    }

    // Write to temp file first
    const content = JSON.stringify(config, null, 2);
    writeFileSync(tempPath, content, "utf8");

    // Atomic rename
    renameSync(tempPath, configPath);

    console.log("[mcp-config-manager] Proxy config written to:", configPath);
  } catch (error) {
    // Clean up temp file on error
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Generate and write proxy config from stored servers
 * Call this after adding/removing servers to update the config file
 */
export async function syncProxyConfigFile(): Promise<McpProxyConfig> {
  const config = await generateProxyConfig();
  writeMcpProxyConfig(config);
  return config;
}

/**
 * Validate MCP proxy config structure
 */
export function validateProxyConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof config !== "object" || config === null) {
    errors.push("Config must be an object");
    return { valid: false, errors };
  }

  const c = config as Record<string, unknown>;

  // Validate proxy section
  if (!c.proxy || typeof c.proxy !== "object") {
    errors.push("Config must have a 'proxy' object");
  } else {
    const proxy = c.proxy as Record<string, unknown>;
    if (typeof proxy.port !== "number" || proxy.port < 1 || proxy.port > 65_535) {
      errors.push("proxy.port must be a valid port number (1-65535)");
    }
    if (typeof proxy.host !== "string" || proxy.host.length === 0) {
      errors.push("proxy.host must be a non-empty string");
    }
  }

  // Validate childServers section
  if (!c.childServers || typeof c.childServers !== "object") {
    errors.push("Config must have a 'childServers' object");
  } else {
    const childServers = c.childServers as Record<string, unknown>;
    for (const [name, server] of Object.entries(childServers)) {
      if (typeof server !== "object" || server === null) {
        errors.push(`childServers.${name} must be an object`);
        continue;
      }
      const s = server as Record<string, unknown>;
      if (typeof s.command !== "string" || s.command.length === 0) {
        errors.push(`childServers.${name}.command must be a non-empty string`);
      }
      if (s.args !== undefined && !Array.isArray(s.args)) {
        errors.push(`childServers.${name}.args must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Initialize MCP config file if it doesn't exist
 * Creates config by syncing from mcp-servers.json
 */
export async function initializeMcpConfigFile(): Promise<void> {
  const configPath = getMcpConfigPath();

  // Reverse-sync: import servers from mcp-config.json that aren't in mcp-servers.json
  // This handles cases where servers were added directly to mcp-config.json
  if (existsSync(configPath)) {
    const existingConfig = readMcpProxyConfig();
    const configManager = new McpConfigManager();
    const knownServers = await configManager.listServers();
    const knownNames = new Set(knownServers.map((s) => s.name));

    for (const [name, child] of Object.entries(existingConfig.childServers)) {
      if (!knownNames.has(name)) {
        const imported: McpServerConfig = {
          name,
          command: child.command,
          args: child.args ?? [],
          transport: child.transport ?? "stdio",
          idleTimeout: child.idleTimeout ?? 0,
          env: child.env ?? {},
        };
        await configManager.addServer(imported);
        console.log(`[mcp-config-manager] Imported server from mcp-config.json: ${name}`);
      }
    }
  }

  // Forward-sync: generate mcp-config.json from mcp-servers.json
  const syncedConfig = await syncProxyConfigFile();

  if (existsSync(configPath)) {
    // Config exists - verify it has the same servers as mcp-servers.json
    const existingConfig = readMcpProxyConfig();
    const existingServerNames = Object.keys(existingConfig.childServers);
    const syncedServerNames = Object.keys(syncedConfig.childServers);

    if (existingServerNames.length === syncedServerNames.length &&
        existingServerNames.every((name, i) => name === syncedServerNames[i])) {
      // Config is in sync, no action needed
      console.log("[mcp-config-manager] Config file is up-to-date at:", configPath);
      return;
    }
  }

  // Config doesn't exist or is out of sync - write synced config
  writeMcpProxyConfig(syncedConfig);
  console.log(`[mcp-config-manager] Initialized config with ${Object.keys(syncedConfig.childServers).length} servers at:`, configPath);
}
