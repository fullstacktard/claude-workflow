/**
 * Generate Agent Hashes Command
 *
 * Scans template agent files and generates SHA256[:16] hashes for per-agent model routing.
 * The generated registry maps agent prompt hashes to target model names.
 *
 * Usage:
 *   claude-workflow generate-agent-hashes [--output PATH] [--agents-dir PATH] [--dry-run]
 *
 * Options:
 *   --output       Custom output path for registry JSON (default: ~/.claude-proxy/agent_hashes.json)
 *   --agents-dir   Path to agents directory (default: auto-detect from package)
 *   --dry-run      Print registry without saving
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Simple ANSI color helpers (no external deps for Docker compatibility)
const colors = {
  cyan: (s: string) => `\u001B[36m${s}\u001B[0m`,
  gray: (s: string) => `\u001B[90m${s}\u001B[0m`,
  green: (s: string) => `\u001B[32m${s}\u001B[0m`,
  red: (s: string) => `\u001B[31m${s}\u001B[0m`,
  yellow: (s: string) => `\u001B[33m${s}\u001B[0m`,
  bold: (s: string) => `\u001B[1m${s}\u001B[0m`,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Hash truncation length (first 16 hex characters of SHA256) */
const HASH_LENGTH = 16;

/** Default output path for agent hashes */
const DEFAULT_OUTPUT_PATH = path.join(os.homedir(), ".claude-proxy", "agent_hashes.json");

/**
 * Options for generate-agent-hashes command
 */
export interface GenerateAgentHashesOptions {
  agentsDir?: string;
  dryRun?: boolean;
  help?: boolean;
  output?: string;
}

/**
 * Agent info structure for the registry
 */
interface AgentInfo {
  hash: string;
  model: string;
  description?: string;
}

/**
 * Agent hash registry structure
 */
interface AgentHashRegistry {
  mappings: Record<string, string>;
  metadata: {
    description: string;
    version: string;
    updated_at: string;
    agent_count: number;
    default_model: string;
    instructions: string[];
  };
  agent_info: Record<string, AgentInfo>;
}

/**
 * Model assignment based on agent type
 * Maps agent name patterns to target models
 */
const MODEL_ASSIGNMENTS: Record<string, string> = {
  // Haiku - fast, simple tasks
  "auto-fixer": "haiku",
  "cleanup-agent": "haiku",
  "css-fixer": "haiku",
  "lint-fixer": "haiku",

  // Sonnet - balanced tasks
  "agent-analyzer": "sonnet",
  "code-reviewer": "sonnet",
  "debugger": "sonnet",
  "devops-engineer": "sonnet",
  "qa-engineer": "sonnet",
  "skill-analyzer": "sonnet",
  "task-reviewer": "sonnet",
  "tailwind-migrator": "sonnet",

  // Opus - complex tasks (default)
  // Everything else gets opus
};

/**
 * Get model assignment for an agent
 */
function getModelForAgent(agentName: string): string {
  return MODEL_ASSIGNMENTS[agentName] ?? "opus";
}

/**
 * Show help text for generate-agent-hashes command
 */
function showHelp(): void {
  console.log(`
${colors.bold("Generate Agent Hashes")}

Scans template agent files and generates SHA256[:16] hashes for per-agent model routing.

${colors.bold("Usage:")}
  claude-workflow generate-agent-hashes [options]

${colors.bold("Options:")}
  ${colors.cyan("--output PATH")}       Output path for registry JSON
                        (default: ~/.claude-proxy/agent_hashes.json)
  ${colors.cyan("--agents-dir PATH")}   Path to agents directory
                        (default: auto-detect from package)
  ${colors.cyan("--dry-run")}           Print registry without saving
  ${colors.cyan("--help")}              Show this help message

${colors.bold("Examples:")}
  # Generate hashes with default settings
  claude-workflow generate-agent-hashes

  # Preview what would be generated
  claude-workflow generate-agent-hashes --dry-run

  # Use custom agents directory
  claude-workflow generate-agent-hashes --agents-dir /path/to/agents

  # Save to custom location
  claude-workflow generate-agent-hashes --output ./my-registry.json

${colors.bold("Notes:")}
  The hash algorithm uses SHA256[:16] of agent prompts excluding the "Notes:" section.
  This ensures consistent hashing across requests since Notes contain dynamic content.
`);
}

/**
 * Compute agent hash from prompt content
 * Strips the Notes: section before hashing for consistency
 *
 * @param prompt - Agent prompt content
 * @returns 16-character hex hash
 */
function computeAgentHash(prompt: string): string {
  let content = prompt;

  // Strip Notes: section (same logic as Python version)
  for (const separator of ["\n\nNotes:", "\nNotes:", "Notes:"]) {
    if (content.includes(separator)) {
      content = content.split(separator)[0];
      break;
    }
  }

  // Compute SHA256 and take first 16 characters
  return createHash("sha256")
    .update(content.trim(), "utf8")
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

/**
 * Find the default agents directory
 *
 * @returns Path to agents directory or undefined if not found
 */
function findAgentsDir(): string | undefined {
  // Try relative to this file (dist/templates/.claude/agents)
  const distPath = path.join(__dirname, "..", "..", "templates", ".claude", "agents");
  if (existsSync(distPath)) {
    return distPath;
  }

  // Try relative to working directory (for development)
  const cwdPath = path.join(process.cwd(), "src", "templates", ".claude", "agents");
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Try project's .claude/agents
  const localPath = path.join(process.cwd(), ".claude", "agents");
  if (existsSync(localPath)) {
    return localPath;
  }

  // Try npm global install location (for Docker where lib/ is copied separately)
  // Common npm global paths
  const npmGlobalPaths = [
    "/usr/local/lib/node_modules/claude-workflow/dist/templates/.claude/agents",
    "/usr/lib/node_modules/claude-workflow/dist/templates/.claude/agents",
    path.join(os.homedir(), ".npm-global/lib/node_modules/claude-workflow/dist/templates/.claude/agents"),
  ];
  for (const npmPath of npmGlobalPaths) {
    if (existsSync(npmPath)) {
      return npmPath;
    }
  }

  return undefined;
}

/**
 * Generate agent hash registry from template agents.
 *
 * This command scans the template agents directory and generates SHA256[:16] hashes
 * for each agent's prompt content. The registry is saved to ~/.claude-proxy/agent_hashes.json
 *
 * @param options - Command options
 */
export function generateAgentHashes(options: GenerateAgentHashesOptions = {}): void {
  // Show help if requested
  if (options.help === true) {
    showHelp();
    return;
  }

  // Find or validate agents directory
  let agentsDir = options.agentsDir;
  if (agentsDir === undefined) {
    agentsDir = findAgentsDir();
    if (agentsDir === undefined) {
      console.error(colors.red("✗ Could not auto-detect agents directory"));
      console.log(colors.gray("Please specify --agents-dir explicitly"));
      // Don't exit - allow caller to handle gracefully (e.g., in Docker)
      return;
    }
  } else if (!existsSync(agentsDir)) {
    console.error(colors.red(`✗ Agents directory not found: ${agentsDir}`));
    // Don't exit - allow caller to handle gracefully
    return;
  }

  const outputPath = options.output ?? DEFAULT_OUTPUT_PATH;

  console.log(colors.gray(`Scanning agents directory: ${agentsDir}\n`));

  // Read all .md files in the agents directory
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    console.log(colors.yellow("⚠ No agent files found in directory"));
    return;
  }

  // Build the registry
  const mappings: Record<string, string> = {};
  const agentInfo: Record<string, AgentInfo> = {};

  for (const file of files) {
    const agentName = file.replace(/\.md$/, "");
    const filePath = path.join(agentsDir, file);
    const content = readFileSync(filePath, "utf8");

    const hash = computeAgentHash(content);
    const model = getModelForAgent(agentName);

    mappings[hash] = model;
    agentInfo[agentName] = {
      hash,
      model,
    };

    console.log(`  ${colors.cyan(agentName.padEnd(30))} ${colors.gray(hash)} → ${colors.yellow(model)}`);
  }

  const registry: AgentHashRegistry = {
    mappings,
    metadata: {
      description: "Agent hash to model routing table. Hashes are SHA256[:16] of agent prompts (excluding Notes: section).",
      version: "1.0.0",
      updated_at: new Date().toISOString(),
      agent_count: files.length,
      default_model: "opus",
      instructions: [
        "This file maps agent prompt hashes to target model names.",
        "Regenerate with: claude-workflow generate-agent-hashes",
        "",
        "Model names must match entries in litellm_config.yaml model_list",
      ],
    },
    agent_info: agentInfo,
  };

  console.log();

  if (options.dryRun === true) {
    console.log(colors.gray("Dry run - registry not saved"));
    console.log();
    console.log(JSON.stringify(registry, null, 2));
    return;
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write registry
  writeFileSync(outputPath, JSON.stringify(registry, null, 2), "utf8");

  console.log(colors.green(`✓ Generated ${files.length} agent hashes`));
  console.log(colors.gray(`Saved to: ${outputPath}`));
}
