/**
 * Claude Proxy Router
 * REST API endpoints for claude-proxy configuration management.
 * Manages agent routing and model routing configuration via YAML file.
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import YAML from "js-yaml";

const execAsync = promisify(exec);

// Container name for claude-proxy
const CLAUDE_PROXY_CONTAINER_NAME = "claude-proxy";

// Default proxy endpoint
const CLAUDE_PROXY_ENDPOINT = "http://localhost:4000";

// Global Claude settings path
const CLAUDE_SETTINGS_PATH = path.join(process.env.HOME || "", ".claude", "settings.json");

// Config paths - primary location used by claude-proxy container
const CLAUDE_PROXY_DIR = path.join(process.env.HOME || "", ".claude-proxy");
// Legacy location for dashboard-only settings
const CLAUDE_WORKFLOW_DIR = path.join(process.env.HOME || "", ".claude-workflow");

// Agent hashes - must match container mount path
const AGENTS_PATH = path.join(CLAUDE_PROXY_DIR, "agent_hashes.json");
// Routing config - matches container mount
const CONFIG_PATH = path.join(CLAUDE_PROXY_DIR, "routing_config.yaml");
// LiteLLM config - matches container mount
const LITELLM_CONFIG_PATH = path.join(CLAUDE_PROXY_DIR, "litellm_config.yaml");

// Dashboard-only settings (not mounted into container)
const ROUTER_SETTINGS_PATH = path.join(CLAUDE_WORKFLOW_DIR, "claude-proxy-router-settings.json");
const RULES_PATH = path.join(CLAUDE_WORKFLOW_DIR, "claude-proxy-rules.json");
const FALLBACKS_PATH = path.join(CLAUDE_WORKFLOW_DIR, "claude-proxy-fallbacks.json");
const ENV_PATH = path.join(CLAUDE_WORKFLOW_DIR, ".env");

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/**
 * Error codes for config operations
 */
const CONFIG_ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
  READ_FAILED: "READ_FAILED",
  YAML_PARSE_ERROR: "YAML_PARSE_ERROR",
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;

// Prototype pollution prevention vectors
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validate object key to prevent prototype pollution
 * Returns true if key is safe to use as object property
 */
function isValidObjectKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length < 256 &&
    !FORBIDDEN_KEYS.has(key)
  );
}

/**
 * Validate config object structure
 * Returns error message if invalid, null if valid
 */
function validateConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") {
    return "Config must be an object";
  }

  const cfg = config as Record<string, unknown>;

  // Validate agentRouting if present
  if (cfg.agentRouting !== undefined) {
    if (typeof cfg.agentRouting !== "object" || cfg.agentRouting === null) {
      return "agentRouting must be an object";
    }
    const ar = cfg.agentRouting as Record<string, unknown>;
    if (ar.enabled !== undefined && typeof ar.enabled !== "boolean") {
      return "agentRouting.enabled must be a boolean";
    }
    if (ar.routes !== undefined && (typeof ar.routes !== "object" || ar.routes === null)) {
      return "agentRouting.routes must be an object";
    }
    // Validate route keys for prototype pollution
    if (ar.routes && typeof ar.routes === "object") {
      for (const key of Object.keys(ar.routes)) {
        if (!isValidObjectKey(key)) {
          return `Invalid route key: ${key}`;
        }
      }
    }
  }

  // Validate modelRouting if present
  if (cfg.modelRouting !== undefined) {
    if (typeof cfg.modelRouting !== "object" || cfg.modelRouting === null) {
      return "modelRouting must be an object";
    }
    const mr = cfg.modelRouting as Record<string, unknown>;
    if (mr.enabled !== undefined && typeof mr.enabled !== "boolean") {
      return "modelRouting.enabled must be a boolean";
    }
    if (mr.routes !== undefined && (typeof mr.routes !== "object" || mr.routes === null)) {
      return "modelRouting.routes must be an object";
    }
    // Validate route keys for prototype pollution
    if (mr.routes && typeof mr.routes === "object") {
      for (const key of Object.keys(mr.routes)) {
        if (!isValidObjectKey(key)) {
          return `Invalid route key: ${key}`;
        }
      }
    }
  }

  return null;
}

/**
 * Validate YAML serialization before writing
 * Throws if YAML would be invalid
 */
function validateYamlOutput(config: ClaudeProxyConfig): void {
  const yamlContent = YAML.dump(config);
  // Attempt to re-parse to ensure valid YAML
  const parsed = YAML.load(yamlContent);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated YAML is not a valid object");
  }
}

/**
 * Agent hash entry from agent-hashes.json
 */
interface AgentHash {
  name: string;
  hash: string;
  description?: string;
  createdAt?: string;
}

/**
 * Agent routing configuration
 */
interface AgentRoutingConfig {
  enabled: boolean;
  routes: Record<string, string>; // agentHash -> modelId
}

/**
 * Model routing configuration
 */
interface ModelRoutingConfig {
  enabled: boolean;
  routes: Record<string, string>; // sourceModel -> targetModel
}

/**
 * Full claude-proxy configuration
 */
interface ClaudeProxyConfig {
  agentRouting: AgentRoutingConfig;
  modelRouting: ModelRoutingConfig;
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Enhanced error response with code
 */
interface EnhancedErrorResponse extends ErrorResponse {
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Router settings for failover configuration
 */
interface RouterSettings {
  allowedFails: number;
  cooldownTime: number;
  numRetries: number;
}

/**
 * Simplified routing rule for UI
 */
interface SimpleRoutingRule {
  sourcePattern: string;
  targetAlias: string;
  enabled: boolean;
}

/**
 * Model fallback configuration
 */
interface ModelFallbacks {
  [modelAlias: string]: string[];
}

/**
 * Default available models - Claude models (source models)
 */
const DEFAULT_CLAUDE_MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

/**
 * GLM redirect targets (external models)
 */
const GLM_MODELS = [
  { name: "openai/glm-5", label: "GLM 5" },
  { name: "openai/glm-4.7", label: "GLM 4.7" },
  { name: "openai/glm-4.6", label: "GLM 4.6" },
];

/**
 * Read claude-proxy config from YAML file
 */
function readConfig(): ClaudeProxyConfig {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return {
        agentRouting: { enabled: false, routes: {} },
        modelRouting: { enabled: false, routes: {} },
      };
    }
    const content = readFileSync(CONFIG_PATH, "utf8");
    const parsed = YAML.load(content) as Partial<ClaudeProxyConfig>;
    return {
      agentRouting: parsed.agentRouting ?? { enabled: false, routes: {} },
      modelRouting: parsed.modelRouting ?? { enabled: false, routes: {} },
    };
  } catch {
    return {
      agentRouting: { enabled: false, routes: {} },
      modelRouting: { enabled: false, routes: {} },
    };
  }
}

/**
 * Write claude-proxy config to YAML file with proper permissions
 */
function writeConfig(config: ClaudeProxyConfig): void {
  // Ensure directory exists with user-only write permission
  if (!existsSync(CLAUDE_PROXY_DIR)) {
    mkdirSync(CLAUDE_PROXY_DIR, { recursive: true, mode: 0o755 });
  }
  const yamlContent = YAML.dump(config);
  // Write with 644 permissions (owner read/write, group/others read)
  writeFileSync(CONFIG_PATH, yamlContent, { encoding: "utf8", mode: 0o644 });
}

/**
 * Write config with validation
 * Validates structure and YAML output before writing
 */
function writeConfigWithValidation(config: ClaudeProxyConfig): void {
  // Validate YAML serialization
  validateYamlOutput(config);

  // Ensure directory exists with proper permissions
  if (!existsSync(CLAUDE_PROXY_DIR)) {
    mkdirSync(CLAUDE_PROXY_DIR, { recursive: true, mode: 0o755 });
  }

  const yamlContent = YAML.dump(config);
  writeFileSync(CONFIG_PATH, yamlContent, { encoding: "utf8", mode: 0o644 });
}

/**
 * LiteLLM config structure
 */
interface LiteLLMConfig {
  model_list: Array<{
    model_name: string;
    litellm_params: {
      model: string;
      api_key?: string;
      api_base?: string;
    };
  }>;
  router_settings?: {
    num_retries?: number;
    timeout?: number;
    allowed_fails?: number;
    cooldown_time?: number;
  };
}

/**
 * Read LiteLLM config from YAML file
 */
function readLiteLLMConfig(): LiteLLMConfig {
  try {
    if (!existsSync(LITELLM_CONFIG_PATH)) {
      // Return default config with passthrough Claude models
      return {
        model_list: DEFAULT_CLAUDE_MODELS.map((model) => ({
          model_name: model,
          litellm_params: { model: `anthropic/${model}` },
        })),
      };
    }
    const content = readFileSync(LITELLM_CONFIG_PATH, "utf8");
    const parsed = YAML.load(content) as LiteLLMConfig | null;
    return parsed ?? { model_list: [] };
  } catch {
    return { model_list: [] };
  }
}

/**
 * Write LiteLLM config to YAML file
 */
function writeLiteLLMConfig(config: LiteLLMConfig): void {
  if (!existsSync(CLAUDE_PROXY_DIR)) {
    mkdirSync(CLAUDE_PROXY_DIR, { recursive: true, mode: 0o755 });
  }
  const yamlContent = YAML.dump(config);
  writeFileSync(LITELLM_CONFIG_PATH, yamlContent, { encoding: "utf8", mode: 0o644 });
}

/**
 * Update LiteLLM config with routing rules
 * Converts SimpleRoutingRule[] to model_list aliases
 */
function updateLiteLLMConfigWithRules(rules: SimpleRoutingRule[]): void {
  const config = readLiteLLMConfig();

  // Build a map of existing model_names
  const existingModels = new Map<string, typeof config.model_list[0]>();
  for (const entry of config.model_list) {
    existingModels.set(entry.model_name, entry);
  }

  // Update or add entries based on rules
  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Determine the actual target model
    let targetModel = rule.targetAlias;
    let apiBase: string | undefined;

    // Handle GLM redirects
    if (rule.targetAlias.startsWith("glm-")) {
      targetModel = `openai/${rule.targetAlias}`;
      apiBase = "https://api.z.ai/api/coding/paas/v4";
    } else if (!rule.targetAlias.includes("/")) {
      // Claude model - add anthropic/ prefix
      targetModel = `anthropic/${rule.targetAlias}`;
    }

    const entry = {
      model_name: rule.sourcePattern,
      litellm_params: {
        model: targetModel,
        ...(apiBase ? { api_base: apiBase } : {}),
      },
    };

    existingModels.set(rule.sourcePattern, entry);
  }

  // Ensure all default Claude models exist (passthrough if no rule)
  for (const model of DEFAULT_CLAUDE_MODELS) {
    if (!existingModels.has(model)) {
      existingModels.set(model, {
        model_name: model,
        litellm_params: { model: `anthropic/${model}` },
      });
    }
  }

  config.model_list = [...existingModels.values()];
  writeLiteLLMConfig(config);
}

/**
 * Agent hashes file structure (agent_hashes.json)
 */
interface AgentHashesFile {
  mappings?: Record<string, string>; // hash -> model
  agent_info?: Record<string, { hash: string; model: string; description?: string }>;
  metadata?: {
    description?: string;
    version?: string;
    updated_at?: string;
    agent_count?: number;
    default_model?: string;
  };
}

/**
 * Read agent hashes from JSON file
 * Handles the agent_hashes.json format with mappings and agent_info
 */
function readAgentHashes(): AgentHash[] {
  try {
    if (!existsSync(AGENTS_PATH)) {
      return [];
    }
    const content = readFileSync(AGENTS_PATH, "utf8");
    const data = JSON.parse(content) as AgentHashesFile;

    // If we have agent_info, use that (has names)
    if (data.agent_info) {
      return Object.entries(data.agent_info).map(([name, info]) => ({
        name,
        hash: info.hash,
        description: info.description,
      }));
    }

    // Fall back to mappings (hash -> model), synthesize names from hash
    if (data.mappings) {
      return Object.entries(data.mappings).map(([hash, model]) => ({
        name: `Agent ${hash.slice(0, 8)}`,
        hash,
        description: `Routes to ${model}`,
      }));
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Read agent hash mappings directly (hash -> model)
 * Used for routing configuration display
 */
function readAgentMappings(): Record<string, string> {
  try {
    if (!existsSync(AGENTS_PATH)) {
      return {};
    }
    const content = readFileSync(AGENTS_PATH, "utf8");
    const data = JSON.parse(content) as AgentHashesFile;
    return data.mappings ?? {};
  } catch {
    return {};
  }
}

/**
 * Read router settings from JSON file
 */
function readRouterSettings(): RouterSettings {
  try {
    if (!existsSync(ROUTER_SETTINGS_PATH)) {
      return { allowedFails: 2, cooldownTime: 60, numRetries: 3 };
    }
    const content = readFileSync(ROUTER_SETTINGS_PATH, "utf8");
    return JSON.parse(content) as RouterSettings;
  } catch {
    return { allowedFails: 2, cooldownTime: 60, numRetries: 3 };
  }
}

/**
 * Write router settings to JSON file
 */
function writeRouterSettings(settings: RouterSettings): void {
  if (!existsSync(CLAUDE_WORKFLOW_DIR)) {
    mkdirSync(CLAUDE_WORKFLOW_DIR, { recursive: true, mode: 0o755 });
  }
  writeFileSync(ROUTER_SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    encoding: "utf8",
    mode: 0o644,
  });
}

/**
 * Read simplified routing rules from JSON file
 */
function readRules(): SimpleRoutingRule[] {
  try {
    if (!existsSync(RULES_PATH)) {
      return [];
    }
    const content = readFileSync(RULES_PATH, "utf8");
    const data = JSON.parse(content) as { rules?: SimpleRoutingRule[] };
    return data.rules ?? [];
  } catch {
    return [];
  }
}

/**
 * Write simplified routing rules to JSON file
 */
function writeRules(rules: SimpleRoutingRule[]): void {
  if (!existsSync(CLAUDE_WORKFLOW_DIR)) {
    mkdirSync(CLAUDE_WORKFLOW_DIR, { recursive: true, mode: 0o755 });
  }
  writeFileSync(RULES_PATH, JSON.stringify({ rules }, null, 2), {
    encoding: "utf8",
    mode: 0o644,
  });
}

/**
 * Read model fallbacks from JSON file
 */
function readFallbacks(): ModelFallbacks {
  try {
    if (!existsSync(FALLBACKS_PATH)) {
      return {};
    }
    const content = readFileSync(FALLBACKS_PATH, "utf8");
    return JSON.parse(content) as ModelFallbacks;
  } catch {
    return {};
  }
}

/**
 * Write model fallbacks to JSON file
 */
function writeFallbacks(fallbacks: ModelFallbacks): void {
  if (!existsSync(CLAUDE_WORKFLOW_DIR)) {
    mkdirSync(CLAUDE_WORKFLOW_DIR, { recursive: true, mode: 0o755 });
  }
  writeFileSync(FALLBACKS_PATH, JSON.stringify(fallbacks, null, 2), {
    encoding: "utf8",
    mode: 0o644,
  });
}

/**
 * Write environment variable to .env file
 */
function writeEnvFile(key: string, value: string): void {
  if (!existsSync(CLAUDE_WORKFLOW_DIR)) {
    mkdirSync(CLAUDE_WORKFLOW_DIR, { recursive: true, mode: 0o755 });
  }

  let content = "";

  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, "utf8");
    // Remove existing key if present
    const lines = content.split("\n").filter((line) => !line.startsWith(`${key}=`));
    content = lines.join("\n");
  }

  // Add new key
  if (content && !content.endsWith("\n")) {
    content += "\n";
  }
  content += `${key}=${value}\n`;

  writeFileSync(ENV_PATH, content, { encoding: "utf8", mode: 0o600 });
}

/**
 * Remove environment variable from .env file
 */
function removeEnvVar(key: string): void {
  if (!existsSync(ENV_PATH)) {
    return;
  }

  const content = readFileSync(ENV_PATH, "utf8");
  const lines = content.split("\n").filter((line) => !line.startsWith(`${key}=`));
  writeFileSync(ENV_PATH, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
}

/**
 * Trigger config reload on claude-proxy container
 */
async function triggerConfigReload(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker inspect -f '{{.State.Running}}' ${CLAUDE_PROXY_CONTAINER_NAME} 2>/dev/null`
    );
    if (stdout.trim() === "true") {
      await execAsync(`docker kill --signal=SIGHUP ${CLAUDE_PROXY_CONTAINER_NAME}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Claude settings.json structure
 */
interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Read Claude global settings from ~/.claude/settings.json
 */
function readClaudeSettings(): ClaudeSettings {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) {
      return {};
    }
    const content = readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Write Claude global settings to ~/.claude/settings.json
 */
function writeClaudeSettings(settings: ClaudeSettings): void {
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true, mode: 0o755 });
  }
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    encoding: "utf8",
    mode: 0o644,
  });
}

/**
 * Enable proxy in Claude settings by setting ANTHROPIC_BASE_URL
 */
function enableProxyInClaudeSettings(): void {
  const settings = readClaudeSettings();
  const env = settings.env ?? {};

  // Set the proxy URL
  env.ANTHROPIC_BASE_URL = CLAUDE_PROXY_ENDPOINT;

  // Remove API key if present - proxy uses OAuth forwarding
  if (env.ANTHROPIC_API_KEY !== undefined) {
    delete env.ANTHROPIC_API_KEY;
  }

  settings.env = env;
  writeClaudeSettings(settings);
  console.log(`[claude-proxy] Set ANTHROPIC_BASE_URL=${CLAUDE_PROXY_ENDPOINT} in ~/.claude/settings.json`);
}

/**
 * Disable proxy in Claude settings by removing ANTHROPIC_BASE_URL
 */
function disableProxyInClaudeSettings(): void {
  const settings = readClaudeSettings();
  const env = settings.env ?? {};

  // Only remove if it points to our proxy
  if (env.ANTHROPIC_BASE_URL === CLAUDE_PROXY_ENDPOINT) {
    delete env.ANTHROPIC_BASE_URL;
    settings.env = env;

    // Clean up empty env object
    if (Object.keys(settings.env).length === 0) {
      delete settings.env;
    }

    writeClaudeSettings(settings);
    console.log("[claude-proxy] Removed ANTHROPIC_BASE_URL from ~/.claude/settings.json");
  }
}

/**
 * Create fst-proxy router
 */
export function createClaudeProxyRouter(): Router {
   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
  const router: Router = express.Router() as Router;

  // =========================================================================
  // Agent Routing Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/config/agent-routing - Get agent routing config
   * Returns both the routing config and the agent hash mappings
   */
  router.get("/config/agent-routing", (_req: Request, res: Response): void => {
    try {
      const config = readConfig();
      const mappings = readAgentMappings();
      const agents = readAgentHashes();
      res.status(HTTP_STATUS_OK).json({
        ...config.agentRouting,
        mappings,
        agents,
        agentCount: Object.keys(mappings).length,
      });
    } catch (error) {
      console.error("[claude-proxy] Error reading agent routing config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PATCH /api/claude-proxy/config/agent-routing - Update agent routing enabled state
   * Enforces mutual exclusivity with model routing
   */
  router.patch("/config/agent-routing", (req: Request, res: Response): void => {
    try {
      const body = req.body as { enabled?: boolean };

      if (typeof body.enabled !== "boolean") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Expected { enabled: boolean }",
        });
        return;
      }

      const config = readConfig();

      // Mutual exclusivity: if enabling agent routing, disable model routing
      if (body.enabled && config.modelRouting.enabled) {
        config.modelRouting.enabled = false;
        console.log("[claude-proxy] Disabling model routing due to agent routing enable");
      }

      config.agentRouting.enabled = body.enabled;
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        agentRouting: config.agentRouting,
        modelRouting: config.modelRouting,
      });
    } catch (error) {
      console.error("[claude-proxy] Error updating agent routing config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PUT /api/claude-proxy/config/agent-routing/route - Set route for specific agent
   */
  router.put("/config/agent-routing/route", (req: Request, res: Response): void => {
    try {
      const body = req.body as { agentHash?: string; modelId?: string };

      if (!body.agentHash || typeof body.agentHash !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "agentHash is required",
        });
        return;
      }

      if (!body.modelId || typeof body.modelId !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "modelId is required",
        });
        return;
      }

      const config = readConfig();
      config.agentRouting.routes[body.agentHash] = body.modelId;
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        route: { [body.agentHash]: body.modelId },
      });
    } catch (error) {
      console.error("[claude-proxy] Error updating agent route:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update route",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/claude-proxy/config/agent-routing/route/:agentHash - Remove route for agent
   */
  router.delete("/config/agent-routing/route/:agentHash", (req: Request, res: Response): void => {
    try {
      const agentHash = String(req.params.agentHash);

      if (!agentHash || !isValidObjectKey(agentHash)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Invalid agentHash parameter",
        });
        return;
      }

      const config = readConfig();
      delete config.agentRouting.routes[agentHash];
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        message: `Route for agent ${agentHash} removed`,
      });
    } catch (error) {
      console.error("[claude-proxy] Error removing agent route:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to remove route",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // =========================================================================
  // Model Routing Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/config/model-routing - Get model routing config
   */
  router.get("/config/model-routing", (_req: Request, res: Response): void => {
    try {
      const config = readConfig();
      res.status(HTTP_STATUS_OK).json(config.modelRouting);
    } catch (error) {
      console.error("[claude-proxy] Error reading model routing config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PATCH /api/claude-proxy/config/model-routing - Update model routing enabled state
   * Enforces mutual exclusivity with agent routing
   */
  router.patch("/config/model-routing", (req: Request, res: Response): void => {
    try {
      const body = req.body as { enabled?: boolean };

      if (typeof body.enabled !== "boolean") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Expected { enabled: boolean }",
        });
        return;
      }

      const config = readConfig();

      // Mutual exclusivity: if enabling model routing, disable agent routing
      if (body.enabled && config.agentRouting.enabled) {
        config.agentRouting.enabled = false;
        console.log("[claude-proxy] Disabling agent routing due to model routing enable");
      }

      config.modelRouting.enabled = body.enabled;
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        agentRouting: config.agentRouting,
        modelRouting: config.modelRouting,
      });
    } catch (error) {
      console.error("[claude-proxy] Error updating model routing config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * PUT /api/claude-proxy/config/model-routing/route - Set model-to-model route
   */
  router.put("/config/model-routing/route", (req: Request, res: Response): void => {
    try {
      const body = req.body as { sourceModel?: string; targetModel?: string };

      if (!body.sourceModel || typeof body.sourceModel !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "sourceModel is required",
        });
        return;
      }

      if (!body.targetModel || typeof body.targetModel !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "targetModel is required",
        });
        return;
      }

      const config = readConfig();
      config.modelRouting.routes[body.sourceModel] = body.targetModel;
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        route: { [body.sourceModel]: body.targetModel },
      });
    } catch (error) {
      console.error("[claude-proxy] Error updating model route:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to update route",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/claude-proxy/config/model-routing/route/:sourceModel - Remove model route
   */
  router.delete("/config/model-routing/route/:sourceModel", (req: Request, res: Response): void => {
    try {
      const sourceModel = String(req.params.sourceModel);

      if (!sourceModel || !isValidObjectKey(sourceModel)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Invalid sourceModel parameter",
        });
        return;
      }

      const config = readConfig();
      delete config.modelRouting.routes[sourceModel];
      writeConfig(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        message: `Route for model ${sourceModel} removed`,
      });
    } catch (error) {
      console.error("[claude-proxy] Error removing model route:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to remove route",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // =========================================================================
  // Data Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/agents - Get list of registered agents
   */
  router.get("/agents", (_req: Request, res: Response): void => {
    try {
      const agents = readAgentHashes();
      res.status(HTTP_STATUS_OK).json({ agents });
    } catch (error) {
      console.error("[claude-proxy] Error reading agents:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read agents",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/claude-proxy/models - Get list of available models with routing info
   * Returns both Claude source models and GLM redirect targets.
   * Reads litellm_config.yaml to determine if models are aliased (redirected) or passthrough.
   */
  router.get("/models", (_req: Request, res: Response): void => {
    try {
      // Build routing map from litellm_config.yaml
      const routingMap: Record<string, string> = {};
      if (existsSync(LITELLM_CONFIG_PATH)) {
        try {
          const content = readFileSync(LITELLM_CONFIG_PATH, "utf8");
          const parsed = YAML.load(content) as { model_list?: Array<{ model_name?: string; litellm_params?: { model?: string } }> } | null;
          const modelList = parsed?.model_list ?? [];
          for (const entry of modelList) {
            const modelName = entry.model_name;
            const targetModel = entry.litellm_params?.model;
            if (modelName && targetModel && modelName !== targetModel) {
              routingMap[modelName] = targetModel;
            }
          }
        } catch {
          // Ignore parse errors, fall back to passthrough
        }
      }

      // Claude source models (can be routed to GLM)
      const claudeModels = DEFAULT_CLAUDE_MODELS.map((model) => ({
        model,
        targetModel: routingMap[model] ?? null,
        type: "claude" as const,
      }));

      // GLM models (redirect targets, shown for reference)
      const glmModels = GLM_MODELS.map((glm) => ({
        model: glm.name,
        label: glm.label,
        targetModel: null,
        type: "glm" as const,
      }));

      res.status(HTTP_STATUS_OK).json({ models: [...claudeModels, ...glmModels] });
    } catch (error) {
      console.error("[claude-proxy] Error reading models:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read models",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/claude-proxy/config/litellm-aliases - Get LiteLLM model aliases
   * Parses litellm_config.yaml and returns entries where model_name differs from litellm_params.model
   */
  router.get("/config/litellm-aliases", (_req: Request, res: Response): void => {
    try {
      if (!existsSync(LITELLM_CONFIG_PATH)) {
        res.status(HTTP_STATUS_OK).json({ aliases: [] });
        return;
      }
      const content = readFileSync(LITELLM_CONFIG_PATH, "utf8");
      const parsed = YAML.load(content) as { model_list?: Array<{ model_name?: string; litellm_params?: { model?: string } }> } | null;
      const modelList = parsed?.model_list ?? [];

      const aliases = modelList
        .filter((entry) => {
          const modelName = entry.model_name;
          const targetModel = entry.litellm_params?.model;
          return modelName && targetModel && modelName !== targetModel;
        })
        .map((entry) => ({
          modelName: entry.model_name!,
          targetModel: entry.litellm_params!.model!,
        }));

      res.status(HTTP_STATUS_OK).json({ aliases });
    } catch (error) {
      console.error("[claude-proxy] Error reading litellm aliases:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read litellm config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * GET /api/claude-proxy/config - Get full config
   */
  router.get("/config", (_req: Request, res: Response): void => {
    try {
      const config = readConfig();
      res.status(HTTP_STATUS_OK).json({
        config,
        configPath: CONFIG_PATH,
        exists: existsSync(CONFIG_PATH),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[claude-proxy] Error reading config:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to read config",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * POST /api/claude-proxy/config - Save full config
   * Validates and persists the entire configuration object
   */
  router.post("/config", (req: Request, res: Response): void => {
    try {
      const body = req.body as Partial<ClaudeProxyConfig>;

      // Validate request body structure
      const validationError = validateConfig(body);
      if (validationError) {
        const errorResponse: EnhancedErrorResponse = {
          error: "Invalid configuration",
          code: CONFIG_ERROR_CODES.VALIDATION_FAILED,
          message: validationError,
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
        return;
      }

      // Construct validated config with defaults for missing fields
      const config: ClaudeProxyConfig = {
        agentRouting: {
          enabled: body.agentRouting?.enabled ?? false,
          routes: body.agentRouting?.routes ?? {},
        },
        modelRouting: {
          enabled: body.modelRouting?.enabled ?? false,
          routes: body.modelRouting?.routes ?? {},
        },
      };

      // Validate and write config
      writeConfigWithValidation(config);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        config,
        configPath: CONFIG_PATH,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[claude-proxy] Error saving config:", error);

      // Detect permission errors for specific error code
      const isPermissionError =
        error instanceof Error &&
        (error.message.includes("EACCES") || error.message.includes("permission"));

      const errorResponse: EnhancedErrorResponse = {
        error: "Failed to save config",
        code: isPermissionError
          ? CONFIG_ERROR_CODES.PERMISSION_DENIED
          : CONFIG_ERROR_CODES.WRITE_FAILED,
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  // =========================================================================
  // Reload Endpoint
  // =========================================================================

  /**
   * POST /api/claude-proxy/reload - Trigger config reload on claude-proxy container
   * Sends SIGHUP signal to container to reload config
   */
  router.post("/reload", (_req: Request, res: Response): void => {
    console.log("[claude-proxy] POST /api/claude-proxy/reload");

    const handleReload = async (): Promise<void> => {
      try {
        // Check if container is running
        try {
          const { stdout } = await execAsync(
            `docker inspect -f '{{.State.Running}}' ${CLAUDE_PROXY_CONTAINER_NAME} 2>/dev/null`
          );

          if (stdout.trim() !== "true") {
            res.status(HTTP_STATUS_OK).json({
              success: true,
              message: "Config saved. Container not running - will apply on next start.",
              containerRunning: false,
            });
            return;
          }
        } catch {
          // Container doesn't exist
          res.status(HTTP_STATUS_OK).json({
            success: true,
            message: "Config saved. Container not found - will apply on first start.",
            containerRunning: false,
          });
          return;
        }

        // Send SIGHUP to trigger config reload
        try {
          await execAsync(`docker kill --signal=SIGHUP ${CLAUDE_PROXY_CONTAINER_NAME}`);
          console.log("[claude-proxy] Sent SIGHUP to claude-proxy container");
        } catch {
          // SIGHUP might not be supported, try restart
          console.log("[claude-proxy] SIGHUP failed, attempting restart");
          await execAsync(`docker restart ${CLAUDE_PROXY_CONTAINER_NAME}`);
        }

        res.status(HTTP_STATUS_OK).json({
          success: true,
          message: "Config reload triggered successfully",
          containerRunning: true,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[claude-proxy] Error reloading config:", error);
        const errorResponse: ErrorResponse = {
          error: "Failed to reload config",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleReload();
  });

  // =========================================================================
  // API Keys Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/api-keys - Get API key status
   * Returns which API keys are configured (without exposing actual keys)
   */
  router.get("/api-keys", (_req: Request, res: Response): void => {
    try {
      res.status(HTTP_STATUS_OK).json({
        ZAI_API_KEY: {
          set: !!process.env.ZAI_API_KEY,
        },
      });
    } catch (error) {
      console.error("[claude-proxy] Error reading API keys:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to read API key status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/claude-proxy/api-keys - Set API key
   * Stores API key in environment (note: will need restart to take effect)
   */
  router.put("/api-keys", (req: Request, res: Response): void => {
    try {
      const body = req.body as { envVar?: string; apiKey?: string };

      if (!body.envVar || typeof body.envVar !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "envVar is required",
        });
        return;
      }

      if (!body.apiKey || typeof body.apiKey !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "apiKey is required",
        });
        return;
      }

      // Only allow ZAI_API_KEY for now
      if (body.envVar !== "ZAI_API_KEY") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Only ZAI_API_KEY is supported",
        });
        return;
      }

      // Store in environment and persist to .env file
      process.env[body.envVar] = body.apiKey;
      writeEnvFile(body.envVar, body.apiKey);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        message: "API key saved. Restart container to apply.",
      });
    } catch (error) {
      console.error("[claude-proxy] Error saving API key:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to save API key",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /api/claude-proxy/api-keys - Delete API key
   */
  router.delete("/api-keys", (req: Request, res: Response): void => {
    try {
      const body = req.body as { envVar?: string };

      if (!body.envVar || body.envVar !== "ZAI_API_KEY") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Only ZAI_API_KEY is supported",
        });
        return;
      }

      delete process.env[body.envVar];
      removeEnvVar(body.envVar);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        message: "API key removed",
      });
    } catch (error) {
      console.error("[claude-proxy] Error deleting API key:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to delete API key",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // =========================================================================
  // Routing Enable/Disable Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/routing - Get routing enabled status
   */
  router.get("/routing", (_req: Request, res: Response): void => {
    try {
      const config = readConfig();
      // Routing is enabled if either agent or model routing is enabled
      const enabled = config.agentRouting.enabled || config.modelRouting.enabled;
      res.status(HTTP_STATUS_OK).json({ enabled });
    } catch (error) {
      console.error("[claude-proxy] Error reading routing status:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to read routing status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/claude-proxy/routing - Toggle routing enabled state
   * Also updates ~/.claude/settings.json with ANTHROPIC_BASE_URL
   */
  router.put("/routing", (req: Request, res: Response): void => {
    try {
      const body = req.body as { enabled?: boolean };

      if (typeof body.enabled !== "boolean") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Expected { enabled: boolean }",
        });
        return;
      }

      const config = readConfig();
      // Enable/disable model routing (primary routing mode)
      config.modelRouting.enabled = body.enabled;
      writeConfig(config);

      // Update Claude global settings with proxy URL
      if (body.enabled) {
        enableProxyInClaudeSettings();
      } else {
        disableProxyInClaudeSettings();
      }

      res.status(HTTP_STATUS_OK).json({
        success: true,
        enabled: body.enabled,
        claudeSettingsUpdated: true,
        proxyUrl: body.enabled ? CLAUDE_PROXY_ENDPOINT : null,
        message: body.enabled
          ? `Routing enabled. ANTHROPIC_BASE_URL set to ${CLAUDE_PROXY_ENDPOINT}. Restart Claude Code to apply.`
          : "Routing disabled. ANTHROPIC_BASE_URL removed. Restart Claude Code to apply.",
      });
    } catch (error) {
      console.error("[claude-proxy] Error updating routing status:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to update routing status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // =========================================================================
  // Router Settings Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/router-settings - Get router settings
   */
  router.get("/router-settings", (_req: Request, res: Response): void => {
    try {
      const settings = readRouterSettings();
      res.status(HTTP_STATUS_OK).json(settings);
    } catch (error) {
      console.error("[claude-proxy] Error reading router settings:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to read router settings",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/claude-proxy/router-settings - Save router settings
   */
  router.put("/router-settings", (req: Request, res: Response): void => {
    try {
      const body = req.body as Partial<RouterSettings>;

      const settings: RouterSettings = {
        allowedFails: typeof body.allowedFails === "number" ? body.allowedFails : 2,
        cooldownTime: typeof body.cooldownTime === "number" ? body.cooldownTime : 60,
        numRetries: typeof body.numRetries === "number" ? body.numRetries : 3,
      };

      writeRouterSettings(settings);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        ...settings,
      });
    } catch (error) {
      console.error("[claude-proxy] Error saving router settings:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to save router settings",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // =========================================================================
  // Simplified Rules Endpoints
  // =========================================================================

  /**
   * GET /api/claude-proxy/rules - Get routing rules
   */
  router.get("/rules", (_req: Request, res: Response): void => {
    try {
      const rules = readRules();
      res.status(HTTP_STATUS_OK).json({ rules });
    } catch (error) {
      console.error("[claude-proxy] Error reading rules:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to read rules",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/claude-proxy/rules - Save routing rules
   * Updates both rules.json AND litellm_config.yaml for persistence
   */
  router.put("/rules", (req: Request, res: Response): void => {
    try {
      const body = req.body as { rules?: SimpleRoutingRule[] };

      if (!Array.isArray(body.rules)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "Expected { rules: SimpleRoutingRule[] }",
        });
        return;
      }

      // Validate rules
      for (const rule of body.rules) {
        if (
          typeof rule.sourcePattern !== "string" ||
          typeof rule.targetAlias !== "string" ||
          typeof rule.enabled !== "boolean"
        ) {
          res.status(HTTP_STATUS_BAD_REQUEST).json({
            error: "Invalid rule",
            message: "Each rule must have sourcePattern, targetAlias, and enabled",
          });
          return;
        }
      }

      writeRules(body.rules);

      // Update litellm_config.yaml so changes actually take effect
      updateLiteLLMConfigWithRules(body.rules);
      console.log("[claude-proxy] Updated litellm_config.yaml with routing rules");

      // Attempt to reload proxy config
      void triggerConfigReload().then((reloaded) => {
        // Response already sent, just log result
        console.log(
          `[claude-proxy] Config reload ${reloaded ? "succeeded" : "skipped (container not running)"}`
        );
      });

      res.status(HTTP_STATUS_OK).json({
        success: true,
        rules: body.rules,
        message: "Rules saved successfully",
      });
    } catch (error) {
      console.error("[claude-proxy] Error saving rules:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to save rules",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // =========================================================================
  // Fallbacks Endpoint
  // =========================================================================

  /**
   * PUT /api/claude-proxy/fallbacks - Save model fallbacks
   */
  router.put("/fallbacks", (req: Request, res: Response): void => {
    try {
      const body = req.body as { modelAlias?: string; fallbacks?: string[] };

      if (!body.modelAlias || typeof body.modelAlias !== "string") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "modelAlias is required",
        });
        return;
      }

      if (!Array.isArray(body.fallbacks)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Invalid request",
          message: "fallbacks must be an array",
        });
        return;
      }

      const allFallbacks = readFallbacks();
      allFallbacks[body.modelAlias] = body.fallbacks;
      writeFallbacks(allFallbacks);

      res.status(HTTP_STATUS_OK).json({
        success: true,
        modelAlias: body.modelAlias,
        fallbacks: body.fallbacks,
      });
    } catch (error) {
      console.error("[claude-proxy] Error saving fallbacks:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to save fallbacks",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // =========================================================================
  // Logs Endpoint
  // =========================================================================

  /**
   * GET /api/claude-proxy/logs - Fetch container logs
   * Query params:
   *   - tail: number of lines (default 200)
   */
  router.get("/logs", (req: Request, res: Response): void => {
    console.log("[claude-proxy] GET /api/claude-proxy/logs");

    const handleGetLogs = async (): Promise<void> => {
      try {
        // Sanitize tail parameter with strict bounds (1-10_000)
        const rawTail = Number(req.query.tail);
        const tail = Number.isNaN(rawTail) ? 200 : Math.min(Math.max(1, Math.floor(rawTail)), 10_000);

        // Fetch logs from Docker container (tail is guaranteed to be safe integer)
        const { stdout } = await execAsync(
          `docker logs ${CLAUDE_PROXY_CONTAINER_NAME} --tail ${String(tail)} 2>&1`
        );

        const logs = stdout.split("\n").filter((line: string) => line.trim() !== "");

        res.status(HTTP_STATUS_OK).json({
          containerRunning: true,
          logs,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[claude-proxy] Error fetching logs:", error);
        // Container might not be running
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch container logs",
          message: error instanceof Error ? error.message : "Unknown error",
        };
        res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
      }
    };

    void handleGetLogs();
  });

  // =========================================================================
  // Rebuild Endpoint
  // =========================================================================

  /**
   * POST /api/claude-proxy/rebuild - Rebuild and restart container
   */
  router.post("/rebuild", (_req: Request, res: Response): void => {
    const handleRebuild = async (): Promise<void> => {
      try {
        console.log("[claude-proxy] Rebuilding claude-proxy container...");

        // Check if container exists
        try {
          await execAsync(`docker inspect ${CLAUDE_PROXY_CONTAINER_NAME} 2>/dev/null`);
        } catch {
          res.status(HTTP_STATUS_OK).json({
            success: false,
            message: "Container not found. Run 'claude-workflow init' first.",
          });
          return;
        }

        // Stop container if running
        try {
          await execAsync(`docker stop ${CLAUDE_PROXY_CONTAINER_NAME} 2>/dev/null`);
        } catch {
          // Container might not be running
        }

        // Remove old container
        try {
          await execAsync(`docker rm ${CLAUDE_PROXY_CONTAINER_NAME} 2>/dev/null`);
        } catch {
          // Container might not exist
        }

        // Rebuild and start using docker-compose
        const composePath = path.join(CLAUDE_WORKFLOW_DIR, "docker-compose.yml");
        if (!existsSync(composePath)) {
          res.status(HTTP_STATUS_OK).json({
            success: false,
            message: "docker-compose.yml not found. Run 'claude-workflow init' first.",
          });
          return;
        }

        await execAsync(
          `docker-compose -f "${composePath}" up -d --build ${CLAUDE_PROXY_CONTAINER_NAME}`
        );

        res.status(HTTP_STATUS_OK).json({
          success: true,
          message: "Container rebuilt and restarted successfully",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[claude-proxy] Error rebuilding container:", error);
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          error: "Failed to rebuild container",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    void handleRebuild();
  });

  // ===================================================================
  // ENSEMBLING CONFIG ENDPOINTS
  // ===================================================================
  const ENSEMBLING_CONFIG_PATH = path.join(CLAUDE_PROXY_DIR, "ensembling_config.yaml");

  /**
   * GET /ensembling - Read ensembling configuration
   */
  router.get("/ensembling", (_req: Request, res: Response) => {
    try {
      if (!existsSync(ENSEMBLING_CONFIG_PATH)) {
        // Return default config
        res.json({
          ensembling: {
            enabled: false,
            default_strategy: "self_moa",
            strategies: {
              self_moa: {
                candidates: 3,
                temperatures: [0.3, 0.6, 0.9],
                judge_model: "same",
                judge_mode: "pairwise",
                consensus_threshold: 0.67,
                position_bias_mitigation: true,
              },
              multi_model: {
                candidates: [],
                judge_model: "claude-opus-4-6",
                judge_provider: "anthropic",
                judge_mode: "multi_perspective",
                consensus_threshold: 0.67,
                position_bias_mitigation: true,
              },
              hybrid: {
                candidates: 3,
                temperatures: [0.3, 0.6, 0.9],
                extra_models: [],
                judge_model: "claude-opus-4-6",
                judge_provider: "anthropic",
                judge_mode: "pairwise",
                consensus_threshold: 0.67,
                position_bias_mitigation: true,
              },
            },
            prompt_repetition: { enabled: false, mode: "concat" },
            execution_sandbox: { enabled: false, timeout_seconds: 30, checks: ["syntax"] },
            agent_overrides: {},
          },
        });
        return;
      }
      const content = readFileSync(ENSEMBLING_CONFIG_PATH, "utf8");
      const parsed = YAML.load(content);
      res.json(parsed);
    } catch (error) {
      console.error("[claude-proxy] Error reading ensembling config:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: CONFIG_ERROR_CODES.READ_FAILED,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /ensembling - Update ensembling configuration
   */
  router.put("/ensembling", (req: Request, res: Response) => {
    try {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- req.body validation */
      const newConfig = req.body;
      if (!newConfig || typeof newConfig !== "object") {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: CONFIG_ERROR_CODES.VALIDATION_FAILED,
          message: "Request body must be a valid ensembling config object",
        });
        return;
      }

      // Schema validation
      const ens = newConfig.ensembling ?? newConfig;
      const validationErrors: string[] = [];

      if (ens.enabled !== undefined && typeof ens.enabled !== "boolean") {
        validationErrors.push("'enabled' must be a boolean");
      }
      if (ens.default_strategy && !["self_moa", "multi_model", "hybrid"].includes(ens.default_strategy)) {
        validationErrors.push("'default_strategy' must be one of: self_moa, multi_model, hybrid");
      }
      if (ens.strategies) {
        const { self_moa, multi_model, hybrid } = ens.strategies;
        if (self_moa) {
          if (self_moa.candidates && (typeof self_moa.candidates !== "number" || self_moa.candidates < 1 || self_moa.candidates > 10)) {
            validationErrors.push("'strategies.self_moa.candidates' must be a number between 1 and 10");
          }
          if (self_moa.temperatures && (!Array.isArray(self_moa.temperatures) || self_moa.temperatures.some((t: unknown) => typeof t !== "number" || (t) < 0 || (t) > 2))) {
            validationErrors.push("'strategies.self_moa.temperatures' must be an array of numbers between 0 and 2");
          }
          if (self_moa.consensus_threshold && (typeof self_moa.consensus_threshold !== "number" || self_moa.consensus_threshold < 0 || self_moa.consensus_threshold > 1)) {
            validationErrors.push("'strategies.self_moa.consensus_threshold' must be between 0 and 1");
          }
        }
        if (multi_model?.candidates && !Array.isArray(multi_model.candidates)) {
          validationErrors.push("'strategies.multi_model.candidates' must be an array");
        }
        if (hybrid && hybrid.extra_models && !Array.isArray(hybrid.extra_models)) {
          validationErrors.push("'strategies.hybrid.extra_models' must be an array");
        }
      }

      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
      if (validationErrors.length > 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: CONFIG_ERROR_CODES.VALIDATION_FAILED,
          message: "Config validation failed",
          details: validationErrors,
        });
        return;
      }

      // Ensure directory exists
      if (!existsSync(CLAUDE_PROXY_DIR)) {
        mkdirSync(CLAUDE_PROXY_DIR, { recursive: true, mode: 0o755 });
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- validated req.body
      const yamlContent = YAML.dump(newConfig);
      writeFileSync(ENSEMBLING_CONFIG_PATH, yamlContent, { encoding: "utf8", mode: 0o644 });

      // Trigger hot-reload on the proxy
      const handleReload = async () => {
        try {
          const response = await fetch(`${CLAUDE_PROXY_ENDPOINT}/api/ensembling/reload`, {
            method: "POST",
          });
          if (!response.ok) {
            console.warn("[claude-proxy] Ensembling reload failed:", response.status);
          }
        } catch {
          console.warn("[claude-proxy] Could not reach proxy for ensembling reload");
        }
      };
      void handleReload();

      res.json({ success: true, message: "Ensembling config updated" });
    } catch (error) {
      console.error("[claude-proxy] Error writing ensembling config:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: CONFIG_ERROR_CODES.WRITE_FAILED,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /ensembling/reload - Trigger hot-reload of ensembling config on proxy
   */
  router.post("/ensembling/reload", (_req: Request, res: Response) => {
    const handleReload = async () => {
      try {
        const response = await fetch(`${CLAUDE_PROXY_ENDPOINT}/api/ensembling/reload`, {
          method: "POST",
        });
        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          res.json({ success: true, ...data });
        } else {
          res.status(HTTP_STATUS_INTERNAL_ERROR).json({
            error: "RELOAD_FAILED",
            message: `Proxy returned ${response.status}`,
          });
        }
      } catch (error) {
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          error: "PROXY_UNREACHABLE",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };
    void handleReload();
  });

  /**
   * GET /ensembling/status - Get ensembling status and metrics from proxy
   */
  router.get("/ensembling/status", (_req: Request, res: Response) => {
    const handleStatus = async () => {
      try {
        const response = await fetch(`${CLAUDE_PROXY_ENDPOINT}/api/ensembling/status`);
        if (response.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- response.json() returns unknown
          const data = await response.json();
          res.json(data);
        } else {
          res.status(HTTP_STATUS_INTERNAL_ERROR).json({
            error: "STATUS_FAILED",
            message: `Proxy returned ${response.status}`,
          });
        }
      } catch (error) {
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          error: "PROXY_UNREACHABLE",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };
    void handleStatus();
  });

  return router;
}

/**
 * Export types for external use
 */
export type {
  AgentHash,
  AgentRoutingConfig,
  EnhancedErrorResponse,
  ErrorResponse,
  ClaudeProxyConfig,
  ModelFallbacks,
  ModelRoutingConfig,
  RouterSettings,
  SimpleRoutingRule,
};
