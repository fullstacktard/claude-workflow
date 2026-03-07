
import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

import {
  addServer as addServerToConfig,
  detectInstalledMcps,
  listServers,
  MCP_OPTIONS,
  readProjectConfig,
  removeServer as removeServerFromConfig,
  validateMcpServerConfig,
} from "../mcp-config.js";
import {
  prompt,
  promptMultiSelect,
  promptYesNo,
  showError,
  showInfo,
  showSection,
  showSuccess,
  
  showWarning,
} from "../ui.js";

interface InstalledMcps {
  all: string[];
  global: string[];
  local: string[];
}

interface McpCommandOptions {
  add?: string;
  list?: boolean;
  remove?: string;
  test?: string;
}

// Type definitions for MCP server configuration
interface McpServerConfig {
  args: string[];
  command: string;
  default_config?: Record<string, boolean | number | string>;
  env?: Record<string, string>;
}

interface McpServerInfo {
  config: McpServerConfig;
  name: string;
  overridden?: boolean;
  overridesGlobal?: boolean;
  scope: "global" | "project";
}

/**
 * Main MCP command handler
 * Supports both interactive and non-interactive modes
 */
export async function mcp(options: McpCommandOptions = {}): Promise<void> {
  // If no options, show interactive menu
  if (Object.keys(options).length === 0) {
    await showInteractiveMenu();
    return;
  }

  // Handle non-interactive mode

  if (options.list !== undefined && options.list) {
    listServersCommand();

  } else if (options.add !== undefined && options.add !== "") {

    await addServerCommand(options.add);

  } else if (options.remove !== undefined && options.remove !== "") {

    await removeServerCommand(options.remove);

  } else if (options.test !== undefined && options.test !== "") {

    testServerCommand(options.test);
  } else {
    showError("Unknown mcp command option. Use --list, --add, --remove, or --test");
  }
}

/**
 * Add server to configuration
 */
async function addServerCommand(serverName: string): Promise<void> {
  const serverInfo = MCP_OPTIONS.find((opt) => opt.value === serverName);

  if (!serverInfo) {
    showError(`Unknown server: ${serverName}`);
    showInfo("Available servers: " + MCP_OPTIONS.map((s) => s.value).join(", "));
    return;
  }

  showSection(`Adding ${serverInfo.label}`);

  // Prompt for scope (global vs local)
  const useLocal = await promptYesNo("Add to local project (.mcp.json)?", true);

  // Get server configuration template
  const serverConfig = getServerConfigTemplate(serverName);

  // For servers requiring API keys, prompt for credentials
  if (
    serverInfo.description.includes("requires API key") ||
    serverInfo.description.includes("requires API token")
  ) {
    const apiKey = await prompt("Enter API key (or leave blank to configure later): ");
    if (typeof apiKey === "string" && apiKey !== "") {
      // Use appropriate env var name based on server
      const envVarName: string = getApiKeyEnvVarName(serverName);
      // Ensure env object exists
      serverConfig.env = serverConfig.env ?? {};
      serverConfig.env[envVarName] = apiKey;
    }
  }

  // Validate configuration
  const validationErrors = validateMcpServerConfig(serverConfig);
  if (validationErrors.length > 0) {
    showError("Configuration validation failed:");
    
    for (const err of validationErrors) console.log(`  ${chalk.red("✗")} ${err}`);
    return;
  }

  // Save to appropriate location
  const JSON_INDENT_SPACES = 2;
  try {
    if (useLocal) {
      addServerToConfig(serverName, serverConfig, "project");
      showSuccess(`${serverInfo.label} added to .mcp.json`);
    } else {
      showWarning("Global configuration must be added manually to Claude Code config");
      showInfo("Config to add to ~/.config/claude-code/mcp.json:");

      console.log("");

      console.log(chalk.gray(JSON.stringify({ mcpServers: { [serverName]: serverConfig } }, undefined, JSON_INDENT_SPACES)));

      console.log("");
      return;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Failed to add server: ${errorMessage}`);
    return;
  }

  showSuccess(`${serverInfo.label} added successfully!`);

  // Offer to test connection
  const shouldTest = await promptYesNo("Test server connection now?", true);
  if (shouldTest) {
    testServerCommand(serverName);
  }
}

/**
 * Interactive add server flow
 */
async function addServerInteractive(): Promise<void> {
  showSection("Add MCP Server");

  const installed = detectInstalledMcps() as InstalledMcps;
  const availableServers = MCP_OPTIONS.map((opt) => ({
    checked: false,
    description: opt.description + (installed.all.includes(opt.value) ? " (already installed)" : ""),
    disabled: installed.all.includes(opt.value),
    name: opt.label, // inquirer expects 'name' not 'label'
    value: opt.value,
  }));

  const selected = await promptMultiSelect(
    "Select a server to add:",
    availableServers
  );

  if (selected.length === 0 || selected[0] === undefined || selected[0] === "") {
    return;
  }

  const serverName = selected[0];
  await addServerCommand(serverName);
}

/**
 * Check dependencies for MCP servers
 */
function checkDependencies(): void {
  showSection("Checking Dependencies");

  const checks = [
    { command: "node --version", name: "Node.js", required: true },
    { command: "npm --version", name: "npm", required: true },
    { command: "npx --version", name: "npx", required: true },
    { command: "git --version", name: "git", required: false },
  ];

  console.log("");

  for (const check of checks) {
    try {
      const version = execSync(check.command, { stdio: "pipe" }).toString().trim();

      console.log(`  ${chalk.green("✓")} ${check.name}: ${chalk.gray(version)}`);
    } catch {
      if (check.required) {

        console.log(`  ${chalk.red("✗")} ${check.name}: ${chalk.red("Not found (required)")}`);
      } else {

        console.log(`  ${chalk.yellow("⚠")} ${check.name}: ${chalk.gray("Not found (optional)")}`);
      }
    }
  }

  console.log("");
  showSuccess("Dependency check complete");
}

/**
 * Get API key environment variable name for server
 */
function getApiKeyEnvVarName(serverName: string): string {
  const envVarNames: Record<string, string> = {
    cloudflare: "CLOUDFLARE_API_TOKEN",
    replicate: "REPLICATE_API_TOKEN",
  };

  return envVarNames[serverName] ?? "API_KEY";
}

/**
 * Get server configuration template
 */
function getServerConfigTemplate(serverName: string): McpServerConfig {
  const templates: Record<string, McpServerConfig> = {
    "chrome-devtools": {
      args: ["-y", "@anthropic-ai/mcp-server-chrome-devtools"],
      command: "npx",
    },
    cloudflare: {
      args: ["-y", "@cloudflare/mcp-server-cloudflare"],
      command: "npx",
      env: {},
    },
    context7: {
      args: ["-y", "@upstash/context7-mcp@latest"],
      command: "npx",
      default_config: {
        defer_loading: true,
      },
    },
    replicate: {
      args: ["-y", "@replicate/mcp-server"],
      command: "npx",
      env: {},
    },
    v0: {
      args: ["-y", "@v0/mcp-server"],
      command: "npx",
    },
  };

  return templates[serverName] ?? { args: [], command: "npx", env: {} };
}

/**
 * List all configured MCP servers
 */
function listServersCommand(): void {
  showSection("Configured MCP Servers");

  const servers = listServers() as McpServerInfo[];

  if (servers.length === 0) {
    showWarning("No MCP servers configured");
    showInfo("Run 'npx claude-workflow mcp --add <server>' to add a server");
    return;
  }

  console.log("");

  // Group by scope
  const globalServers = servers.filter((s) => s.scope === "global" && !(s.overridden ?? false));
  const projectServers = servers.filter((s) => s.scope === "project");

  // Global servers
  if (globalServers.length > 0) {

    console.log(chalk.red.bold("Global Servers (Claude Code):"));
    for (const server of globalServers) {
      const serverInfo = MCP_OPTIONS.find((opt) => opt.value === server.name);

      console.log(`  ${chalk.green("✓")} ${chalk.white(serverInfo?.label ?? server.name)}`);
      if ((serverInfo?.description ?? "") !== "") {

        console.log(`    ${chalk.gray(serverInfo?.description ?? "")}`);
      }

      console.log(`    ${chalk.gray(`Command: ${(server.config).command}`)}`);
    }

    console.log("");
  }

  // Project servers
  if (projectServers.length > 0) {

    console.log(chalk.red.bold("Project Servers (.mcp.json):"));
    for (const server of projectServers) {
      const serverInfo = MCP_OPTIONS.find((opt) => opt.value === server.name);
      const label = serverInfo?.label ?? server.name;
      const overrideNote = (server.overridesGlobal ?? false) ? chalk.yellow(" (overrides global)") : "";

      console.log(`  ${chalk.green("✓")} ${chalk.white(label)}${overrideNote}`);
      if ((serverInfo?.description ?? "") !== "") {

        console.log(`    ${chalk.gray(serverInfo?.description ?? "")}`);
      }

      console.log(`    ${chalk.gray(`Command: ${(server.config).command}`)}`);
    }

    console.log("");
  }

  showSuccess(`Total: ${String(servers.length)} server(s) configured`);
}

/**
 * Remove server from configuration
 */
async function removeServerCommand(serverName: string): Promise<void> {
  
  const configPath = path.join(process.cwd(), ".mcp.json");

  if (!existsSync(configPath)) {
    showError("No .mcp.json file found");
    return;
  }

  const config = readProjectConfig();

  if (config.mcpServers[serverName] === undefined) {
    showError(`Server '${serverName}' not found in .mcp.json`);
    return;
  }

  // Confirm removal
  const confirmed = await promptYesNo(`Remove ${serverName} from .mcp.json?`, false);

  if (!confirmed) {
    showInfo("Removal cancelled");
    return;
  }

  // Remove server
  try {
    removeServerFromConfig(serverName, "project");
    showSuccess(`${serverName} removed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    showError(`Failed to remove server: ${errorMessage}`);
  }
}

/**
 * Interactive remove server flow
 */
async function removeServerInteractive(): Promise<void> {
  showSection("Remove MCP Server");

  const servers = listServers();
  const projectServers = servers.filter((s) => s.scope === "project");

  if (projectServers.length === 0) {
    showWarning("No local servers configured to remove");
    showInfo("Global servers must be removed manually from Claude Code config");
    return;
  }

  const serverOptions = projectServers.map((server) => {
    const serverInfo = MCP_OPTIONS.find((opt) => opt.value === server.name);
    return {
      checked: false,
      description: serverInfo?.description ?? "",
      name: serverInfo?.label ?? server.name,
      value: server.name,
    };
  });

  const selected = await promptMultiSelect("Select server to remove:", serverOptions);

  if (selected.length === 0 || selected[0] === undefined || selected[0] === "") {
    return;
  }

  const serverName = selected[0];
  await removeServerCommand(serverName);
}

/**
 * Interactive menu system
 */
async function showInteractiveMenu(): Promise<void> {
  showSection("MCP Server Management");

  const menuOptions = [
    {
      checked: false,
      description: "View all installed servers",
      name: "List configured MCP servers",
      value: "list",
    },
    {
      checked: false,
      description: "Install and configure a server",
      name: "Add new MCP server",
      value: "add",
    },
    {
      checked: false,
      description: "Uninstall a server",
      name: "Remove MCP server",
      value: "remove",
    },
    {
      checked: false,
      description: "Verify server is working",
      name: "Test server connection",
      value: "test",
    },
    {
      checked: false,
      description: "Open documentation",
      name: "View server documentation",
      value: "docs",
    },
    {
      checked: false,
      description: "Verify requirements",
      name: "Check dependencies",
      value: "deps",
    },
    {
      checked: false,
      description: "Return to shell",
      name: "Exit",
      value: "exit",
    },
  ];

  const selected = await promptMultiSelect(
    "What would you like to do?",
    menuOptions
  );

  if (selected.includes("exit")) {
    return;
  }

  const choice = selected[0]; // Single selection

  switch (choice) {
  case "add": {
    await addServerInteractive();
    break;
  }
  case "deps": {
    checkDependencies();
    break;
  }
  case "docs": {
    await viewDocsInteractive();
    break;
  }
  case "list": {
    listServersCommand();
    break;
  }
  case "remove": {
    await removeServerInteractive();
    break;
  }
  case "test": {
    await testServerInteractive();
    break;
  }
  }

  // Return to menu after action
  await showInteractiveMenu();
}

/**
 * Test server connection
 */
function testServerCommand(serverName: string): void {
  showSection(`Testing ${serverName}`);

  // Find server config
  const servers = listServers();
  const server = servers.find((s) => s.name === serverName);

  if (!server) {
    showError(`Server '${serverName}' not found`);
    return;
  }

  // Validate configuration
  const validationErrors = validateMcpServerConfig(server.config);
  if (validationErrors.length > 0) {
    showError("Configuration validation failed:");
    
    for (const err of validationErrors) console.log(`  ${chalk.red("✗")} ${err}`);
    return;
  }

  showSuccess("Configuration is valid");

  // Check if command exists
  try {
    
    const command = (server.config as McpServerConfig).command;
    execSync(`which ${command}`, { stdio: "pipe" });
    showSuccess(`Command '${command}' is available`);
  } catch {
    
    showError(`Command '${(server.config as McpServerConfig).command}' not found in PATH`);
    return;
  }

  // Check if package can be installed (for npx commands)
  const MIN_NPX_ARGS = 1;
  if ((server.config as McpServerConfig).command === "npx" && (server.config as McpServerConfig).args.length > MIN_NPX_ARGS) {
    showInfo("Checking package availability...");
    try {
      // Get package name (skip -y flag)

      const packageName = (server.config as McpServerConfig).args.find((arg: string) => arg !== "-y");
      if (packageName !== undefined && packageName !== "") {
        execSync(`npm view ${packageName} version`, { stdio: "pipe" });
        showSuccess(`Package '${packageName}' is available on npm`);
      }
    } catch {
      showWarning("Could not verify package availability");
    }
  }

  showSuccess(`${serverName} server test completed successfully!`);
}

/**
 * Interactive test server flow
 */
async function testServerInteractive(): Promise<void> {
  showSection("Test Server Connection");

  const servers = listServers();

  if (servers.length === 0) {
    showWarning("No servers configured to test");
    return;
  }

  const serverOptions = servers.map((server) => {
    const serverInfo = MCP_OPTIONS.find((opt) => opt.value === server.name);
    return {
      checked: false,
      description: serverInfo?.description ?? "",
      name: serverInfo?.label ?? server.name,
      value: server.name,
    };
  });

  const selected = await promptMultiSelect("Select server to test:", serverOptions);

  if (selected.length === 0 || selected[0] === undefined || selected[0] === "") {
    return;
  }

  const serverName = selected[0];
  testServerCommand(serverName);
}

/**
 * Interactive view documentation flow
 */
async function viewDocsInteractive(): Promise<void> {
  showSection("View Server Documentation");

  const serverOptions = MCP_OPTIONS.map((opt) => ({
    checked: false,
    description: opt.description,
    name: opt.label,
    value: opt.value,
  }));

  const selected = await promptMultiSelect(
    "Select server to view documentation:",
    serverOptions
  );

  const serverName = selected[0];
  if (serverName === undefined || serverName === "") {
    return;
  }

  viewServerDocs(serverName);
}

/**
 * View server documentation
 */
function viewServerDocs(serverName: string): void {
  const docs: Record<string, string> = {
    "chrome-devtools": "https://github.com/anthropics/anthropic-mcp-servers/tree/main/chrome-devtools",
    "cloudflare": "https://github.com/cloudflare/mcp-server-cloudflare",
    "context7": "https://github.com/upstash/context7-mcp",
    "replicate": "https://github.com/replicate/mcp-server",
    "v0": "https://v0.dev/docs/mcp",
  };

  const url = docs[serverName];
  if (url === undefined || url === "") {
    showWarning(`No documentation URL configured for ${serverName}`);
    return;
  }

  showInfo(`Documentation: ${url}`);
  showInfo("Opening in browser...");

  try {
    // Try to open in browser
    
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
    showSuccess("Documentation opened in browser");
  } catch {
    showWarning("Could not open browser automatically");
    showInfo(`Please visit: ${url}`);
  }
}
