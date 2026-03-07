/**
 * Configuration Manager - Load, save, and validate workflow configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  WorkflowConfig,
} from "../types/workflow-config.js";

import {
  availableHookCategories,
  isValidAgent,
  isValidSkill,
} from "../component-registry.js";

/**
 * Get the path to the claude-workflow package's dist folder
 * This is resolved from the current file's location (which is inside the package)
 */
export function getPackageDistPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // This file is at dist/lib/utils/config-manager.js
  // Package dist is at dist/
  return path.resolve(__dirname, "../..");
}

/**
 * Get the currently installed claude-workflow package version
 * Reads from package.json at runtime (cached)
 */
let packageVersionCache: string | undefined;
export function getPackageVersion(): string {
  if (packageVersionCache) {
    return packageVersionCache;
  }
  try {
    // package.json is at the package root, one level up from dist/
    const packagePath = path.join(getPackageDistPath(), "..", "package.json");
    const content = fs.readFileSync(packagePath, "utf8");
    const pkg = JSON.parse(content) as { version: string };
    packageVersionCache = pkg.version;
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

/** Path to the workflow configuration file relative to project root */
export const CONFIG_PATH = ".claude/workflow-config.json";

/** Current configuration schema version */
export const CONFIG_VERSION = "1.0" as const;

/** Valid hook category IDs */
const VALID_HOOK_IDS = new Set(availableHookCategories.map((h) => h.id));

/**
 * Check if a configuration file exists
 */
export function configExists(projectPath?: string): boolean {
  const configPath = path.join(projectPath ?? process.cwd(), CONFIG_PATH);
  return fs.existsSync(configPath);
}

/**
 * Create configuration from partial values
 * Merges provided values with defaults
 */
export function createConfig(
  partial: Partial<{
    components: Partial<WorkflowConfig["components"]>;
    mcpServers: string[] | WorkflowConfig["mcpServers"]; // Support legacy string[] format
    tooling: Partial<WorkflowConfig["tooling"]>;
    workflow: Partial<WorkflowConfig["workflow"]>;
  }>
): WorkflowConfig {
  const defaults = createDefaultConfig();

  // Handle migration from legacy string[] format to new object format
  const mcpServers: WorkflowConfig["mcpServers"] = Array.isArray(partial.mcpServers)
    ? {
      localServers: partial.mcpServers.filter(s => s !== "claude-workflow-proxy" && s !== "mcp-proxy"),
      proxyPort: 3847,
      useProxy: partial.mcpServers.includes("claude-workflow-proxy") || partial.mcpServers.includes("mcp-proxy")
    }
    : partial.mcpServers ?? defaults.mcpServers;

  return {
    components: {
      ...defaults.components,
      ...partial.components,
      hooks: {
        ...defaults.components.hooks,
        ...(partial.components?.hooks),
      },
    },
    created: defaults.created,
    mcpServers,
    tooling: {
      ...defaults.tooling,
      ...partial.tooling,
      codeQuality: {
        ...defaults.tooling.codeQuality,
        ...(partial.tooling?.codeQuality),
      },
    },
    updated: defaults.updated,
    version: CONFIG_VERSION,
    workflow: {
      ...defaults.workflow,
      ...partial.workflow,
    },
  };
}

/**
 * Create default configuration with sensible defaults
 * All features enabled, no components selected (user chooses during init)
 */
export function createDefaultConfig(): WorkflowConfig {
  const now = new Date().toISOString();

  return {
    components: {
      agents: [],
      declinedAgents: [],
      docs: true,
      hooks: {
        compliance: true,
        integrations: true,
        orchestration: true,
        proactive: true,
        quality: true,
        recovery: true,
        taskWorkflow: true,
        tracking: true,
        videoWorkflow: true,
      },
      declinedSkills: [],
      scripts: true,
      skills: [],
    },
    created: now,
    mcpServers: {
      localServers: [],
      useProxy: false
    },
    tooling: {
      codeQuality: {
        eslint: true,
        knip: true,
        stylelint: true,
        typescript: true,
      },
    },
    updated: now,
    version: CONFIG_VERSION,
    workflow: {},
  };
}

/**
 * Delete configuration file
 */
export function deleteConfig(projectPath?: string): boolean {
  const configPath = path.join(projectPath ?? process.cwd(), CONFIG_PATH);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    return true;
  }
  return false;
}

/**
 * Load workflow configuration from project directory
 * @param projectPath - Optional project root (defaults to cwd)
 * @returns Parsed config or null if not found or invalid
 */
export function loadConfig(projectPath?: string): undefined | WorkflowConfig {
  const configPath = path.join(projectPath ?? process.cwd(), CONFIG_PATH);

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
     
    const parsedConfig: JsonObject = JSON.parse(content);

    // Try to migrate old configs (adds missing fields like codeQuality)
    const migratedConfig = migrateConfig(parsedConfig);

    if (!validateConfig(migratedConfig)) {
      console.warn(`Invalid config format in ${configPath}`);
      return undefined;
    }

    return migratedConfig;
  } catch (error) {
    console.error(
      `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/**
 * Default code quality tools configuration
 * All tools enabled by default for backward compatibility
 */
const DEFAULT_CODE_QUALITY = {
  eslint: true,
  knip: true,
  typescript: true,
};

type JsonArray = JsonValue[];

/**
 * Represents a parsed JSON object that may be a valid config
 */
interface JsonObject {
  [key: string]: JsonValue;
}

type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

/**
 * Migrate old config format to current version
 * Handles adding new fields like codeQuality and declined arrays for backward compatibility
 */
export function migrateConfig(oldConfig: JsonObject | null | undefined): WorkflowConfig {
  // Handle null/undefined input
  if (oldConfig === null || oldConfig === undefined) {
    console.warn("Config migration received null/undefined, returning default config");
    return createDefaultConfig();
  }

  // Try to migrate partial configs - check if valid-ish config just missing codeQuality or declined arrays
  const version = oldConfig.version;
  const tooling = oldConfig.tooling;
  const components = oldConfig.components as JsonObject;

  let needsMigration = false;
  const migratedConfig = { ...oldConfig };

  // Migrate codeQuality field (existing logic)
  if (version === CONFIG_VERSION && typeof tooling === "object" && tooling !== null) {
    const toolingObj = tooling as JsonObject;
    const codeQuality = toolingObj.codeQuality;

    if (codeQuality === undefined) {
      migratedConfig.tooling = {
        ...toolingObj,
        codeQuality: DEFAULT_CODE_QUALITY,
      };
      needsMigration = true;
    }
  }

  // Migrate declined arrays (new logic)
  // IMPORTANT: We initialize empty arrays instead of auto-declining all non-enabled components.
  // This ensures that truly NEW components (added in newer versions) will be detected as new
  // and prompt the user, rather than being silently marked as declined during migration.
  if (typeof components === "object" && components !== null) {
    const compObj = components;
    const compMigrated = { ...compObj };

    // If declinedAgents is missing, initialize empty array
    // New components will be detected by detectNewComponents() and prompt user
    if (compObj.declinedAgents === undefined) {
      compMigrated.declinedAgents = [];
      needsMigration = true;
    }

    // If declinedSkills is missing, initialize empty array
    if (compObj.declinedSkills === undefined) {
      compMigrated.declinedSkills = [];
      needsMigration = true;
    }

    // Ensure no duplicates between enabled and declined (data integrity)
    const declinedAgentsArr = compMigrated.declinedAgents as string[] | undefined;
    const declinedSkillsArr = compMigrated.declinedSkills as string[] | undefined;

    if (declinedAgentsArr && Array.isArray(compObj.agents)) {
      const enabledAgentSet = new Set(compObj.agents as string[]);
      compMigrated.declinedAgents = declinedAgentsArr.filter(
        (id: string) => !enabledAgentSet.has(id)
      );
    }
    if (declinedSkillsArr && Array.isArray(compObj.skills)) {
      const enabledSkillSet = new Set(compObj.skills as string[]);
      compMigrated.declinedSkills = declinedSkillsArr.filter(
        (id: string) => !enabledSkillSet.has(id)
      );
    }

    if (needsMigration) {
      migratedConfig.components = compMigrated;
    }
  }

  // If we performed migration and result is valid, return it
  if (needsMigration && validateConfig(migratedConfig)) {
    return migratedConfig;
  }

  // If already valid (includes all required fields), return as-is
  if (validateConfig(oldConfig)) {
    return oldConfig;
  }

  // If invalid, return default config
  console.warn("Config migration failed, returning default config");
  return createDefaultConfig();
}

/**
 * Save workflow configuration to project directory
 * @param config - Configuration to save
 * @param projectPath - Optional project root (defaults to cwd)
 */
export function saveConfig(
  config: WorkflowConfig,
  projectPath?: string
): void {
  const configPath = path.join(projectPath ?? process.cwd(), CONFIG_PATH);
  const configDir = path.dirname(configPath);

  // Ensure .claude directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Update timestamp, package path, and project root
  // Package path allows hooks to import from the installed claude-workflow package
  // Project root allows hooks to resolve paths correctly in monorepos
  const resolvedProjectPath = projectPath ?? process.cwd();
  const updatedConfig: WorkflowConfig = {
    ...config,
    _packagePath: getPackageDistPath(),
    _projectRoot: path.resolve(resolvedProjectPath),
    updated: new Date().toISOString(),
  };

  // Write with pretty formatting
  const JSON_INDENT_SPACES = 2;
  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, undefined, JSON_INDENT_SPACES), "utf8");
}

/**
 * Validate configuration object structure and values
 * Type guard that narrows input to WorkflowConfig
 */
export function validateConfig(config: JsonObject | null | undefined | WorkflowConfig): config is WorkflowConfig {
  // Handle null/undefined input
  if (config === null || config === undefined) {
    return false;
  }

  const c = config as JsonObject;

  // Check required top-level fields
  if (c.version !== CONFIG_VERSION) return false;
  if (typeof c.created !== "string") return false;
  if (typeof c.updated !== "string") return false;

  // Validate workflow section
  const workflow = c.workflow;
  if (typeof workflow !== "object" || workflow === null) return false;

  // Validate components section
  const components = c.components;
  if (typeof components !== "object" || components === null) return false;
  const comp = components as JsonObject;
  if (!Array.isArray(comp.agents)) return false;
  if (typeof comp.hooks !== "object" || comp.hooks === null) return false;
  if (typeof comp.scripts !== "boolean") return false;
  if (typeof comp.docs !== "boolean") return false;
  if (!Array.isArray(comp.skills)) return false;
  // Validate declined arrays if present (optional for backward compat)
  if (comp.declinedAgents !== undefined && !Array.isArray(comp.declinedAgents)) return false;
  if (comp.declinedSkills !== undefined && !Array.isArray(comp.declinedSkills)) return false;

  // Validate tooling section
  const tooling = c.tooling;
  if (typeof tooling !== "object" || tooling === null) return false;

  // Validate codeQuality section (optional for backward compatibility - will be migrated)
  const t = tooling as JsonObject;
  const codeQuality = t.codeQuality;
  if (codeQuality !== undefined) {
    if (typeof codeQuality !== "object") return false;
    const cq = codeQuality as JsonObject;
    if (typeof cq.eslint !== "boolean") return false;
    if (typeof cq.typescript !== "boolean") return false;
    if (typeof cq.knip !== "boolean") return false;
  }

  // Validate mcpServers section
  const mcpServers = c.mcpServers;
  if (typeof mcpServers !== "object" || mcpServers === null) return false;
  const mcp = mcpServers as JsonObject;
  if (!Array.isArray(mcp.localServers)) return false;
  // proxyPort and useProxy are optional

  return true;
}

/**
 * Validate configuration with strict checks on agent/skill IDs
 * Use this for full validation including registry lookups
 */
export function validateConfigStrict(
  config: WorkflowConfig
): config is WorkflowConfig {
  if (!validateConfig(config)) {
    return false;
  }

  // Validate agent IDs exist in registry
  for (const agentId of config.components.agents) {
    if (typeof agentId !== "string" || !isValidAgent(agentId)) {
      console.warn(`Unknown agent ID: ${agentId}`);
      return false;
    }
  }

  // Validate skill IDs exist in registry
  for (const skillId of config.components.skills) {
    if (typeof skillId !== "string" || !isValidSkill(skillId)) {
      console.warn(`Unknown skill ID: ${skillId}`);
      return false;
    }
  }

  // Validate hook categories
   
  const hooks = config.components.hooks as unknown as Record<string, boolean>;
  for (const hookId of Object.keys(hooks)) {
    if (!VALID_HOOK_IDS.has(hookId)) {
      console.warn(`Unknown hook category: ${hookId}`);
      return false;
    }
    if (typeof hooks[hookId] !== "boolean") {
      console.warn(`Hook category ${hookId} must be a boolean`);
      return false;
    }
  }

  return true;
}
