
import * as JSON5 from "json5";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// MCP Configuration - defines which skills/agents depend on which MCPs

const JSON_INDENT_SPACES = 2;

interface ClaudeConfig {
  mcpServers?: Record<string, MCPServerConfig>;
  projects?: Record<string, ProjectConfig>;
}

interface McpConfigItem {
  agentRules: string[];
  agents: string[];
  name: string;
  references: {
    endMarker: string;
    file: string;
    startMarker: string;
  }[];
  skillRules: string[];
  skills: string[];
}

interface McpConfigStructure {
  mcpServers: Record<string, MCPServerConfig>;
}

interface MCPServerConfig {
  command?: string;
  configs?: Record<string, {
    defer_loading?: boolean;
  }>;
  default_config?: {
    defer_loading?: boolean;
  };
  // HTTP transport support (e.g., Ref Tools, mcp-proxy)
  type?: "http" | "stdio";
  url?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ProjectConfig {
  mcpServers?: Record<string, MCPServerConfig>;
}

interface SkillOption {
  checked: boolean;
  description: string;
  label: string;
  requiresMcp?: string;
  value: string;
}

interface UnvalidatedConfig {
  mcpServers?: null | object;
}

export const MCP_OPTIONS = [
  {
    checked: true,
    description: "Real-time library documentation",
    label: "Context7",
    value: "context7"
  },
  {
    checked: true,
    description: "Browser automation & testing",
    label: "Chrome DevTools",
    value: "chrome-devtools"
  },
  {
    checked: true,
    description: "AI-powered UI component generation",
    label: "v0",
    value: "v0"
  },
  {
    checked: false,
    description: "Run AI models in the cloud (requires API key)",
    label: "Replicate",
    value: "replicate"
  },
  {
    checked: false,
    description: "DNS record management (requires API token)",
    label: "Cloudflare DNS",
    value: "cloudflare"
  },
  {
    checked: false,
    description: "E2E testing with accessibility tree automation",
    label: "Playwright",
    value: "playwright"
  },
  {
    checked: false,
    description: "Token-efficient documentation search (requires API key)",
    label: "Ref Tools",
    value: "ref"
  },
  {
    checked: false,
    description: "Dynamic reasoning chains for complex decisions",
    label: "Sequential Thinking",
    value: "sequential-thinking"
  },
  {
    checked: false,
    description: "Semantic code navigation via LSP (requires Python 3.11, uv)",
    label: "Serena",
    value: "serena"
  }
];


// Detect which MCPs are already installed (globally or locally)
export function detectInstalledMcps(): { all: string[]; global: string[]; local: string[]; } {
  const result = {
    all: [] as string[],
    global: [] as string[],
    local: [] as string[]
  };

  // Check global Claude Desktop config (try all possible paths)
  const globalConfigPaths = getClaudeConfigPaths();
  for (const globalConfigPath of globalConfigPaths) {
    try {
      if (fs.existsSync(globalConfigPath)) {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf8")) as ClaudeConfig;

        // Collect all MCP servers from all formats (v0.18+ support)
        const allMcpServers: Record<string, MCPServerConfig> = {};

        // NEW FORMAT (v0.18+): Check top-level mcpServers
        if (config.mcpServers !== undefined && typeof config.mcpServers === "object") {
          Object.assign(allMcpServers, config.mcpServers);
        }

        // NEWER FORMAT: Check projects object
        if (config.projects !== undefined && typeof config.projects === "object") {
          for (const projectConfig of Object.values(config.projects)) {
            if (projectConfig.mcpServers !== undefined && typeof projectConfig.mcpServers === "object") {
              Object.assign(allMcpServers, projectConfig.mcpServers);
            }
          }
        }

        for (const option of MCP_OPTIONS) {
          const isInstalled = Object.keys(allMcpServers).some(key =>
            key.toLowerCase().includes(option.value.toLowerCase()) ||
            option.value.toLowerCase().includes(key.toLowerCase())
          );

          if (isInstalled && !result.global.includes(option.value)) {
            
            result.global.push(option.value);
            
            if (!result.all.includes(option.value)) {
              
              result.all.push(option.value);
            }
          }
        }
        // If we found a valid config, stop checking other paths
        break;
      }
    } catch {
      // Config doesn't exist or can't be read, try next path
    }
  }

  // Check local .mcp.json
  const localConfigPath = path.join(process.cwd(), ".mcp.json");
  try {
    if (fs.existsSync(localConfigPath)) {
      const config = JSON.parse(fs.readFileSync(localConfigPath, "utf8")) as { mcpServers?: Record<string, MCPServerConfig> };
      const mcpServers = config.mcpServers ?? {};

      for (const option of MCP_OPTIONS) {
        const isInstalled = Object.keys(mcpServers).some(key =>
          key.toLowerCase().includes(option.value.toLowerCase()) ||
          option.value.toLowerCase().includes(key.toLowerCase())
        );

        if (isInstalled) {
          result.local.push(option.value);

          if (!result.all.includes(option.value)) {
            result.all.push(option.value);
          }
        }
      }
    }
  } catch {
    // Config doesn't exist or can't be read
  }

  // Check package.json dependencies/devDependencies
  const packageJsonPath = path.join(process.cwd(), "package.json");
  try {
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      for (const option of MCP_OPTIONS) {
        // Check if MCP is installed as npm package
        const depNames = Object.keys(allDeps);
        const isInstalled = depNames.some(dep =>
          dep.toLowerCase().includes(option.value.toLowerCase()) ||
          dep.toLowerCase().includes("mcp-" + option.value.toLowerCase()) ||
          dep.toLowerCase().includes(option.value.toLowerCase() + "-mcp")
        );

        if (isInstalled && !result.all.includes(option.value)) {
          result.local.push(option.value);
          result.all.push(option.value);
        }
      }
    }
  } catch {
    // Package.json doesn't exist or can't be read
  }

  // Check alternative config locations
  const alternativeConfigPaths = [
    path.join(process.cwd(), ".claude", "mcp.json"),
    path.join(process.cwd(), "mcp.config.json"),
    path.join(os.homedir(), ".mcp", "config.json"),
  ];

  for (const configPath of alternativeConfigPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { mcpServers?: Record<string, MCPServerConfig>; servers?: Record<string, MCPServerConfig> };
        const mcpServers = config.mcpServers ?? config.servers ?? {};

        for (const option of MCP_OPTIONS) {
          const isInstalled = Object.keys(mcpServers).some(key =>
            key.toLowerCase().includes(option.value.toLowerCase()) ||
            option.value.toLowerCase().includes(key.toLowerCase())
          );

          if (isInstalled && !result.all.includes(option.value)) {
            result.local.push(option.value);
            result.all.push(option.value);
          }
        }
      }
    } catch {
      // Config doesn't exist or can't be read
    }
  }

  return result;
}

// Get MCP options with installed MCPs marked and pre-selected
export function getAvailableMcpOptions(): {
  checked: boolean;
  description: string;
  isGlobal: boolean;
  isInstalled: boolean;
  isLocal: boolean;
  label: string;
  value: string;
}[] {
  const installed = detectInstalledMcps();

  return MCP_OPTIONS.map(opt => {
    const isGlobal = installed.global.includes(opt.value);
    const isLocal = installed.local.includes(opt.value);

    const description = opt.description;
    let suffix = "";

    if (isGlobal && isLocal) {
      suffix = " (installed globally + locally)";
    } else if (isGlobal) {
      suffix = " (installed globally - selecting will create local override)";
    } else if (isLocal) {
      suffix = " (installed locally)";
    }

    return {
      ...opt,
      checked: isGlobal ? false : opt.checked, // Don't select globally installed MCPs by default
      description: description + suffix,
      isGlobal,
      isInstalled: isGlobal || isLocal,
      isLocal
    };
  });
}


// Get all possible paths to Claude Desktop config
function getClaudeConfigPaths(): string[] {
  const platform = os.platform();
  const paths: string[] = [];

  // Always check the settings.json first (global Claude Code settings)
  paths.push(path.join(os.homedir(), ".config", "claude-code", "settings.json"));

  if (platform === "darwin") {
    paths.push(path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"));
  } else if (platform === "win32") {
    paths.push(path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"));
  } else {
    // Linux/WSL - try multiple possible locations
    paths.push(
      path.join(os.homedir(), ".config", "claude", ".claude.json"),
      path.join(os.homedir(), ".config", "Claude", ".claude.json"),
      path.join(os.homedir(), ".claude", ".claude.json"),
      path.join(os.homedir(), ".claude.json")
    );
  }

  return paths;
}

export const MCP_CONFIG: Record<string, McpConfigItem> = {
  "chrome-devtools": {
    agentRules: [],
    agents: [],
    name: "Chrome DevTools",
    references: [],
    skillRules: ["chrome-devtools"],
    skills: ["chrome-devtools"]
  },
  "cloudflare": {
    agentRules: [],
    agents: [],
    name: "Cloudflare DNS",
    references: [],
    skillRules: ["cloudflare-dns"],
    skills: ["cloudflare-dns"]
  },
  "context7": {
    // Agent rules to remove when MCP not selected
    agentRules: [],
    // Agents that require this MCP
    agents: [],
    name: "Context7",
    // Files that reference this MCP (will have content removed)
    references: [
      {
        endMarker: "<!-- /MCP:context7 -->",
        file: "agents/task-maker.md",
        // Markers to identify content to remove
        startMarker: "<!-- MCP:context7 -->"
      }
    ],
    // Skill rules to remove when MCP not selected
    skillRules: ["context7-research"],
    // Skills that require this MCP
    skills: ["context7-research"]
  },
  "playwright": {
    agentRules: ["qa-engineer"],
    agents: ["qa-engineer"],
    name: "Playwright",
    references: [],
    skillRules: ["playwright-testing"],
    skills: ["playwright-testing"]
  },
  "ref": {
    agentRules: [],
    agents: [],
    name: "Ref Tools",
    references: [],
    skillRules: ["ref-research"],
    skills: ["ref-research"]
  },
  "replicate": {
    agentRules: [],
    agents: [],
    name: "Replicate",
    references: [],
    skillRules: ["replicate-models"],
    skills: ["replicate-models"]
  },
  "sequential-thinking": {
    agentRules: [],
    agents: [],
    name: "Sequential Thinking",
    references: [],
    skillRules: ["sequential-thinking"],
    skills: ["sequential-thinking"]
  },
  "serena": {
    agentRules: [],
    agents: [],
    name: "Serena",
    references: [],
    skillRules: ["serena"],
    skills: ["serena"]
  },
  "v0": {
    agentRules: ["v0-ui-generator"],
    agents: ["v0-ui-generator"],
    name: "v0",
    references: [],
    skillRules: [],
    skills: []
  }
};


// Get agents to skip based on MCP selection
export function getAgentsToSkip(selectedMcps: string[]): string[] {
  const allMcps = Object.keys(MCP_CONFIG);
  const unselectedMcps = allMcps.filter(mcp => !selectedMcps.includes(mcp));

  const agentsToSkip: string[] = [];
  for (const mcp of unselectedMcps) {
    const mcpConfig = MCP_CONFIG[mcp];
    if (mcpConfig) {
      agentsToSkip.push(...mcpConfig.agents);
    }
  }

  return agentsToSkip;
}



// Get skills to skip based on MCP selection
export function getSkillsToSkip(selectedMcps: string[]): string[] {
  const allMcps = Object.keys(MCP_CONFIG);
  const unselectedMcps = allMcps.filter(mcp => !selectedMcps.includes(mcp));

  const skillsToSkip: string[] = [];
  for (const mcp of unselectedMcps) {
    const mcpConfig = MCP_CONFIG[mcp];
    if (mcpConfig) {
      skillsToSkip.push(...mcpConfig.skills);
    }
  }

  return skillsToSkip;
}

// Skill Options - all available skills
export const SKILL_OPTIONS = [
  {
    checked: true,
    description: "Backlog and task structure",
    label: "Task Management",
    value: "task-management"
  },
  {
    checked: true,
    description: "Vitest and coverage",
    label: "Testing Workflow",
    value: "testing-workflow"
  },
  {
    checked: true,
    description: "Break down features",
    label: "Task Planning",
    value: "task-planning"
  },
  {
    checked: true,
    description: "README and API docs",
    label: "Documentation",
    value: "documentation-writing"
  },
  {
    checked: true,
    description: "Library documentation (requires Context7 MCP)",
    label: "Context7 Research",
    requiresMcp: "context7",
    value: "context7-research"
  },
  {
    checked: true,
    description: "Browser automation (requires Chrome DevTools MCP)",
    label: "Chrome DevTools",
    requiresMcp: "chrome-devtools",
    value: "chrome-devtools"
  },
  {
    checked: true,
    description: "Create custom agents",
    label: "Agent Developer",
    value: "agent-developer"
  },
  {
    checked: true,
    description: "Create custom skills",
    label: "Skill Developer",
    value: "skill-developer"
  },
  {
    checked: true,
    description: "Run AI models in the cloud (requires Replicate MCP)",
    label: "Replicate Models",
    requiresMcp: "replicate",
    value: "replicate-models"
  },
  {
    checked: true,
    description: "DNS record management (requires Cloudflare MCP)",
    label: "Cloudflare DNS",
    requiresMcp: "cloudflare",
    value: "cloudflare-dns"
  },
  {
    checked: true,
    description: "E2E testing with accessibility tree (requires Playwright MCP)",
    label: "Playwright Testing",
    requiresMcp: "playwright",
    value: "playwright-testing"
  },
  {
    checked: true,
    description: "Token-efficient documentation search (requires Ref Tools MCP)",
    label: "Ref Research",
    requiresMcp: "ref",
    value: "ref-research"
  },
  {
    checked: true,
    description: "Dynamic reasoning chains (requires Sequential Thinking MCP)",
    label: "Sequential Thinking",
    requiresMcp: "sequential-thinking",
    value: "sequential-thinking"
  },
  {
    checked: true,
    description: "Semantic code navigation via LSP (requires Serena MCP)",
    label: "Serena",
    requiresMcp: "serena",
    value: "serena"
  }
];

// Agent Options - all available agents
export const AGENT_OPTIONS = [
  {
    checked: true,
    description: "Create implementation-ready tasks",
    label: "Task Maker",
    value: "task-maker"
  },
  {
    checked: true,
    description: "Review code quality",
    label: "Code Reviewer",
    value: "code-reviewer"
  },
  {
    checked: true,
    description: "Fix errors and bugs",
    label: "Debugger",
    value: "debugger"
  },
  {
    checked: true,
    description: "Create PR descriptions",
    label: "PR Documentation",
    value: "pr-document-maker"
  },
  {
    checked: true,
    description: "Fix all project errors (CSS, TypeScript, linting)",
    label: "Auto-Fixer",
    value: "auto-fixer"
  },
  {
    checked: true,
    description: "Analyze agent quality (requires Agent Developer skill)",
    label: "Agent Analyzer",
    requiresSkill: "agent-developer",
    value: "agent-analyzer"
  },
  {
    checked: true,
    description: "Analyze skill quality (requires Skill Developer skill)",
    label: "Skill Analyzer",
    requiresSkill: "skill-developer",
    value: "skill-analyzer"
  },
  {
    checked: true,
    description: "Generate UI components with v0 (requires v0 MCP)",
    label: "v0 UI Generator",
    requiresMcp: "v0",
    value: "v0-ui-generator"
  },
  {
    checked: true,
    description: "E2E testing with Playwright (black-box, reports issues)",
    label: "QA Engineer",
    requiresMcp: "playwright",
    value: "qa-engineer"
  },
  {
    checked: true,
    description: "Break down features into task sequences",
    label: "Feature Planner",
    value: "feature-planner"
  },
  {
    checked: true,
    description: "Strategic technical leadership and architecture",
    label: "CTO Architect",
    value: "cto-architect"
  },
  {
    checked: true,
    description: "Implement backend features with clean architecture",
    label: "Backend Engineer",
    value: "backend-engineer"
  },
  {
    checked: true,
    description: "Implement infrastructure and CI/CD",
    label: "DevOps Engineer",
    value: "devops-engineer"
  },
  {
    checked: true,
    description: "Implement frontend features and components",
    label: "Frontend Engineer",
    value: "frontend-engineer"
  }
];

// Get skill options filtered by MCP selection, worktree usage, and CSS enforcement

export function addServer(name: string, serverConfig: MCPServerConfig, scope = "project", projectPath = process.cwd()): void {
  if (scope !== "global" && scope !== "project") {
    throw new Error(`Invalid scope: ${scope}. Must be 'global' or 'project'`);
  }

  // Validate server config - must have command (stdio) or url (http)
  const isHttpTransport = serverConfig.type === "http" || serverConfig.url !== undefined;
  const isStdioTransport = serverConfig.command !== undefined;
  if (!isHttpTransport && !isStdioTransport) {
    throw new Error("Server config must have \"command\" (stdio) or \"url\" (http) field");
  }

  if (scope === "global") {
    const config = readGlobalConfig();
    config.mcpServers[name] = serverConfig;
    writeGlobalConfig(config);
  } else {
    const config = readProjectConfig(projectPath);
    config.mcpServers[name] = serverConfig;
    writeProjectConfig(config, projectPath);
  }
}



export function getAvailableSkillOptions(selectedMcps: string[]): SkillOption[] {
  return SKILL_OPTIONS.map(skill => {
    // Filter out MCP-dependent skills if MCP not selected
    if (skill.requiresMcp !== undefined && !selectedMcps.includes(skill.requiresMcp)) {
      return undefined;
    }

    return skill;
  }).filter((skill): skill is SkillOption => skill !== undefined);
}


// ============================================================================
// CORE MCP CONFIG MANAGEMENT API
// ============================================================================


export function listServers(projectPath = process.cwd()): { config: MCPServerConfig; name: string; overridden?: boolean; overridesGlobal?: boolean; scope: string }[] {
  const globalConfig = readGlobalConfig();
  const projectConfig = readProjectConfig(projectPath);

  const servers: { config: MCPServerConfig; name: string; overridden?: boolean; overridesGlobal?: boolean; scope: string }[] = [];

  // Add global servers
  for (const [name, config] of Object.entries(globalConfig.mcpServers)) {
    servers.push({
      config,
      name,
      // Check if overridden by project
      overridden: Object.prototype.hasOwnProperty.call(projectConfig.mcpServers, name),
      scope: "global"
    });
  }

  // Add project servers (including overrides)
  for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
    // Skip if already added from global (we'll keep the project version)
    const existingIndex = servers.findIndex(s => s.name === name);
    if (existingIndex === -1) {
      servers.push({
        config,
        name,
        overridesGlobal: false,
        scope: "project"
      });
    } else {
      // Replace global with project version
      servers[existingIndex] = {
        config,
        name,
        overridesGlobal: true,
        scope: "project"
      };
    }
  }

  return servers;
}

export function readProjectConfig(projectPath = process.cwd()): McpConfigStructure {
  const configPath = path.join(projectPath, ".mcp.json");

  try {
    if (!fs.existsSync(configPath)) {
      return { mcpServers: {} };
    }

    const content = fs.readFileSync(configPath, "utf8");
    // Use JSON5 to support comments and trailing commas
    const rawConfig: UnvalidatedConfig = JSON5.parse(content);

    // Ensure mcpServers exists
    if (rawConfig.mcpServers === undefined || typeof rawConfig.mcpServers !== "object" || rawConfig.mcpServers === null) {
      return { mcpServers: {} };
    }

    // Type is now narrowed to Record<string, MCPServerConfig>
    return { mcpServers: rawConfig.mcpServers as Record<string, MCPServerConfig> };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(
        `Invalid JSON5 in .mcp.json at ${configPath}: ${(error as Error).message}\n` +
        "Check for syntax errors, missing commas, or invalid comments"
      );
    }

    throw new Error(`Failed to read project config: ${(error as Error).message}`);
  }
}

/**
 * Add an MCP server to configuration
 * @param {string} name - Server name (e.g., 'context7', 'replicate')
 * @param {Object} serverConfig - Server configuration object
 * @param {string} scope - 'global' or 'project'
 * @param {string} projectPath - Path to project root (for project scope)
 * @throws {Error} If scope is invalid or write fails
 */

export function removeServer(name: string, scope = "project", projectPath = process.cwd()): void {
  if (scope !== "global" && scope !== "project") {
    throw new Error(`Invalid scope: ${scope}. Must be 'global' or 'project'`);
  }

  if (scope === "global") {
    const config = readGlobalConfig();
    const { [name]: removed, ...remainingServers } = config.mcpServers;
    void removed; // Intentionally unused - destructuring used to remove key
    config.mcpServers = remainingServers;
    writeGlobalConfig(config);
  } else {
    const config = readProjectConfig(projectPath);
    const { [name]: removed, ...remainingServers } = config.mcpServers;
    void removed; // Intentionally unused - destructuring used to remove key
    config.mcpServers = remainingServers;
    writeProjectConfig(config, projectPath);
  }
}

/**
 * Remove an MCP server from configuration
 * @param {string} name - Server name to remove
 * @param {string} scope - 'global' or 'project'
 * @param {string} projectPath - Path to project root (for project scope)
 * @throws {Error} If scope is invalid or write fails
 */

/**
 * Validate all MCP server configurations in .mcp.json
 * @param {string} mcpConfigPath - Path to .mcp.json file
 * @returns {Object} Validation result with { valid: boolean, errors: Array<string>, config?: Object }
 */
export function validateMcpConfigFile(mcpConfigPath: string): { config?: { mcpServers: Record<string, MCPServerConfig> }; errors: string[]; valid: boolean; } {
  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8")) as { mcpServers?: Record<string, MCPServerConfig> };
    const errors: string[] = [];

    if (config.mcpServers === undefined || typeof config.mcpServers !== "object") {
      errors.push("Missing or invalid mcpServers object");
      return { errors, valid: false };
    }

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      const serverErrors = validateMcpServerConfig(serverConfig);
      if (serverErrors.length > 0) {
        errors.push(...serverErrors.map(err => `${serverName}: ${err}`));
      }
    }

    return {
      config: { mcpServers: config.mcpServers },
      errors,
      valid: errors.length === 0
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      errors: [`Failed to parse .mcp.json: ${errorMessage}`],
      valid: false
    };
  }
}

/**
 * List all configured MCP servers with their scope
 * @param {string} projectPath - Path to project root (defaults to cwd)
 * @returns {Array} Array of server objects with name, config, and scope
 */

/**
 * Validate MCP server configuration with defer_loading support
 * @param {Object} serverConfig - MCP server configuration object
 * @returns {Array<string>} Array of validation error messages (empty if valid)
 */
export function validateMcpServerConfig(serverConfig: MCPServerConfig): string[] {
  const errors: string[] = [];

  // Validate basic structure - either command (stdio) or url (http) required
  const isHttpTransport = serverConfig.type === "http" || serverConfig.url !== undefined;
  const isStdioTransport = serverConfig.command !== undefined;

  if (!isHttpTransport && !isStdioTransport) {
    errors.push("Missing required \"command\" (stdio) or \"url\" (http) field");
  }

  // Validate HTTP transport has url
  if (serverConfig.type === "http" && serverConfig.url === undefined) {
    errors.push("HTTP transport requires \"url\" field");
  }

  // Validate defer_loading configuration in default_config
  if (serverConfig.default_config !== undefined) {
    if (typeof serverConfig.default_config !== "object") {
      errors.push("default_config must be an object");
    } else if (serverConfig.default_config.defer_loading !== undefined && typeof serverConfig.default_config.defer_loading !== "boolean") {
      errors.push("default_config.defer_loading must be a boolean (true or false)");
    }
  }

  // Validate per-tool configs
  if (serverConfig.configs !== undefined) {
    if (typeof serverConfig.configs === "object") {
      for (const [toolName, toolConfig] of Object.entries(serverConfig.configs)) {
        if (toolConfig.defer_loading !== undefined && typeof toolConfig.defer_loading !== "boolean") {
          errors.push(`configs.${toolName}.defer_loading must be a boolean (true or false)`);
        }
      }
    } else {
      errors.push("configs must be an object");
    }
  }

  return errors;
}

// Hybrid MCP configuration functions

/**
 * Read global Claude Code MCP configuration
 * @returns {Object} Global MCP config with mcpServers object
 */
function readGlobalConfig(): McpConfigStructure {
  const homeDir = os.homedir();
  const globalConfigPath = path.join(homeDir, ".config", "claude-code", "mcp.json");

  try {
    if (!fs.existsSync(globalConfigPath)) {
      return { mcpServers: {} };
    }

    const content = fs.readFileSync(globalConfigPath, "utf8");
    const rawConfig = JSON.parse(content) as UnvalidatedConfig;

    // Ensure mcpServers exists
    if (rawConfig.mcpServers === undefined || typeof rawConfig.mcpServers !== "object" || rawConfig.mcpServers === null) {
      return { mcpServers: {} };
    }

    return { mcpServers: rawConfig.mcpServers as Record<string, MCPServerConfig> };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(`Invalid JSON in global config at ${globalConfigPath}: ${(error as Error).message}`);
    }

    throw new Error(`Failed to read global config: ${(error as Error).message}`);
  }
}

/**
 * Write global MCP configuration atomically with backup
 * @param {Object} config - Config object with mcpServers
 * @throws {Error} If write fails
 */
function writeGlobalConfig(config: McpConfigStructure): void {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, ".config", "claude-code");
  const configPath = path.join(configDir, "mcp.json");
  const tmpPath = `${configPath}.tmp`;

  try {
    // Ensure directory exists
    fs.mkdirSync(configDir, { recursive: true });

    // Create backup if config exists
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup`;
      fs.copyFileSync(configPath, backupPath);
    }

    // Write to temporary file
    const content = JSON.stringify(config, undefined, JSON_INDENT_SPACES);
    fs.writeFileSync(tmpPath, content, "utf8");

    // Atomic rename
    fs.renameSync(tmpPath, configPath);
  } catch (error) {
    // Clean up tmp file on error
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    throw new Error(`Failed to write global config: ${(error as Error).message}`);
  }
}

function writeProjectConfig(config: McpConfigStructure, projectPath = process.cwd()): void {
  const configPath = path.join(projectPath, ".mcp.json");
  const tmpPath = `${configPath}.tmp`;

  try {
    // Create backup if config exists
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup`;
      fs.copyFileSync(configPath, backupPath);
    }

    // Write to temporary file with JSON formatting (not JSON5)
    // JSON5.stringify doesn't preserve comments, so use standard JSON
    const content = JSON.stringify(config, undefined, JSON_INDENT_SPACES);
    fs.writeFileSync(tmpPath, content, "utf8");

    // Atomic rename
    fs.renameSync(tmpPath, configPath);
  } catch (error) {
    // Clean up tmp file on error
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    throw new Error(`Failed to write project config: ${(error as Error).message}`);
  }
}
