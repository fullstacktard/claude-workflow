
/**
 * Configuration Prompts - Modern stage-based workflow configuration
 * Uses @clack/prompts for a beautiful, batteries-included experience
 */

import * as p from "@clack/prompts";
import { existsSync } from "node:fs";

import type { CodeQualityTools, HookCategories, WorkflowConfig } from "../types/workflow-config.js";
import { getPackageVersion } from "./config-manager.js";
import type { PermissionPreset } from "./permissions.js";

import {
  availableAgents,
  availableHookCategories,
  availableSkills,
} from "../component-registry.js";
import {
  clackMultiSelect,
  clackNote,
  clackYesNo
} from "../ui.js";
import { promptMcpSelection } from "./mcp-selection.js";

/** Number of items per row when formatting lists in columns */
const ITEMS_PER_ROW = 3;

/** Default MCP proxy port */
const DEFAULT_MCP_PROXY_PORT = 3847;


/**
 * Main prompt function that collects all configuration settings
 * Returns a complete WorkflowConfig object ready to be saved
 */
export async function promptWorkflowConfig(): Promise<WorkflowConfig> {
  // Stage 1: Code Quality Tools
  // Check which config files already exist - deselect those by default
  const hasEslint = existsSync("eslint.config.ts") || existsSync("eslint.config.js") || existsSync(".eslintrc.json") || existsSync(".eslintrc.js");
  const hasTsconfig = existsSync("tsconfig.json");
  const hasKnip = existsSync("knip.config.ts") || existsSync("knip.json");
  const hasStylelint = existsSync(".stylelintrc.json") || existsSync(".stylelintrc.js") || existsSync("stylelint.config.js") || existsSync("stylelint.config.mjs");

  const existingConfigs: string[] = [];
  if (hasEslint) existingConfigs.push("ESLint");
  if (hasTsconfig) existingConfigs.push("TypeScript");
  if (hasKnip) existingConfigs.push("Knip");
  if (hasStylelint) existingConfigs.push("Stylelint");

  if (existingConfigs.length > 0) {
    p.note(
      `Existing configs detected: ${existingConfigs.join(", ")}\n` +
      "These are deselected by default. Select them to replace with claude-workflow templates.",
      "Stage 1: Code Quality Tools"
    );
  } else {
    p.note("Select which code quality tools to configure (ESLint, TypeScript, Knip, Stylelint)", "Stage 1: Code Quality Tools");
  }

  const codeQualityOptions = [
    { hint: hasEslint ? "⚠️ EXISTS - select to replace" : "Code linting and formatting rules", label: "ESLint", value: "eslint" as const },
    { hint: hasTsconfig ? "⚠️ EXISTS - select to replace" : "Type checking with tsconfig.json", label: "TypeScript", value: "typescript" as const },
    { hint: hasKnip ? "⚠️ EXISTS - select to replace" : "Find unused code, dependencies, and exports", label: "Knip", value: "knip" as const },
    { hint: hasStylelint ? "⚠️ EXISTS - select to replace" : "CSS linting and style rules", label: "Stylelint", value: "stylelint" as const },
  ];

  // Build default selection - exclude tools that already have config files
  const defaultCodeQuality: ("eslint" | "knip" | "stylelint" | "typescript")[] = [];
  if (!hasEslint) defaultCodeQuality.push("eslint");
  if (!hasTsconfig) defaultCodeQuality.push("typescript");
  if (!hasKnip) defaultCodeQuality.push("knip");
  if (!hasStylelint) defaultCodeQuality.push("stylelint");

  const selectedCodeQualityTools = await clackMultiSelect(
    "Select code quality tools to install/replace",
    codeQualityOptions,
    defaultCodeQuality
  );

  const codeQuality: CodeQualityTools = {
    eslint: selectedCodeQualityTools.includes("eslint"),
    knip: selectedCodeQualityTools.includes("knip"),
    stylelint: selectedCodeQualityTools.includes("stylelint"),
    typescript: selectedCodeQualityTools.includes("typescript"),
  };

  // Store what was detected (exists in project) separately from what was selected (to install)
  const codeQualityDetected: CodeQualityTools = {
    eslint: hasEslint,
    knip: hasKnip,
    stylelint: hasStylelint,
    typescript: hasTsconfig,
  };

  // Tailwind CSS v4: default to true (recommended for all projects)
  const useTailwind = await clackYesNo(
    "Enable Tailwind CSS v4 mode? (design token enforcement via ESLint)",
    true
  );

  // Stage 2: Git Hooks Configuration
  p.note("Pre-commit hooks will validate code quality before each commit", "Stage 2: Git Hooks");

  const gitHooksEnabled = await clackYesNo("Enable pre-commit git hooks?", true);

  // Auto-determine which hooks to include based on config selections OR existing files
  // TypeScript: enabled if user selected to install OR exists in project
  const gitHooksTypescript = gitHooksEnabled && (codeQuality.typescript || hasTsconfig);
  // ESLint: enabled if user selected to install OR exists in project
  const gitHooksEslint = gitHooksEnabled && (codeQuality.eslint || hasEslint);
  // Stylelint: enabled if user selected to install OR config exists in project (only when NOT Tailwind mode)
  const gitHooksStylelint = gitHooksEnabled && !useTailwind && (codeQuality.stylelint || hasStylelint);
  // Tailwind: enabled if Tailwind mode is selected (uses ESLint Tailwind plugin)
  const gitHooksTailwind = gitHooksEnabled && useTailwind;

  // Stage 3: Agent Selection
  p.note("Select which AI agents to include in your project", "Stage 3: Agent Selection");

  const allAgentIds = availableAgents.map(a => a.id);
  const agentOptions = availableAgents.map(agent => ({
    hint: agent.description,
    label: agent.name,
    value: agent.id
  }));

  const agents = await clackMultiSelect(
    "Select agents (all selected by default)",
    agentOptions,
    allAgentIds // All pre-selected
  );

  // Calculate declined agents (what user deselected)
  const declinedAgents = allAgentIds.filter((id) => !agents.includes(id));

  // Stage 4: Skill Selection
  p.note("Select which skills to include", "Stage 4: Skill Selection");

  const allSkillIds = availableSkills.map(s => s.id);

  const skillOptions = availableSkills.map(skill => ({
    hint: skill.description,
    label: skill.name,
    value: skill.id
  }));

  const skills = await clackMultiSelect(
    "Select skills (all selected by default)",
    skillOptions,
    allSkillIds
  );

  // Calculate declined skills
  const declinedSkills = allSkillIds.filter((id) => !skills.includes(id));

  // Stage 5: Hook Categories
  p.note("Select hook categories to enable", "Stage 5: Hook Categories");

  const allHookIds = availableHookCategories.map(h => h.id);
  const hookOptions = availableHookCategories.map(cat => ({
    hint: cat.description,
    label: cat.name,
    value: cat.id
  }));

  const selectedHooks = await clackMultiSelect(
    "Select hook categories (all selected by default)",
    hookOptions,
    allHookIds
  );

  const hooks = {} as HookCategories;
  for (const category of availableHookCategories) {
    hooks[category.id as keyof HookCategories] = selectedHooks.includes(category.id);
  }

  // Stage 6: MCP Server Selection
  p.note("Select MCP servers for extended capabilities", "Stage 6: MCP Server Selection");
  const mcpSelection = await promptMcpSelection();
  const mcpServers = mcpSelection;

  // Stage 7: Permission Preset
  p.note(
    "Controls which tool operations require confirmation.\n" +
    "  yolo: Full trust, zero interruptions\n" +
    "  supervised: Guards destructive ops (git push, docker, rm)\n" +
    "  strict: Ask before any file mutation or shell command",
    "Stage 7: Permissions"
  );

  let permissionPreset: PermissionPreset = "supervised";

  if (process.stdin.isTTY) {
    const selected = await p.select<PermissionPreset>({
      message: "Select a permission preset",
      options: [
        { label: "supervised", value: "supervised" as PermissionPreset, hint: "Default — guards destructive operations" },
        { label: "yolo", value: "yolo" as PermissionPreset, hint: "Full trust, zero interruptions" },
        { label: "strict", value: "strict" as PermissionPreset, hint: "Ask before any file mutation or shell command" },
      ],
      initialValue: "supervised" as PermissionPreset,
    });

    if (p.isCancel(selected)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
    permissionPreset = selected;
  } else {
    console.log("Select a permission preset (non-interactive, using default: supervised)");
  }

  // Show summary before completion
  const codeQualityTools = [
    codeQuality.eslint && "ESLint",
    codeQuality.typescript && "TypeScript",
    codeQuality.knip && "Knip",
  ].filter(Boolean);

  // Get agent names from IDs
  const agentNames = agents
    .map(id => availableAgents.find(a => a.id === id)?.name ?? id)
    .sort();

  // Get skill names from IDs
  const skillNames = skills
    .map(id => availableSkills.find(s => s.id === id)?.name ?? id)
    .sort();

  // Get hook category names
  const hookNames = selectedHooks
    .map(id => availableHookCategories.find(h => h.id === id)?.name ?? id)
    .sort();

  // Determine MCP proxy port display string
  const mcpProxyPortString = mcpServers.useProxy
    ? `  Proxy: port ${String(mcpServers.proxyPort ?? DEFAULT_MCP_PROXY_PORT)}`
    : "";

  // Build git hooks summary
  const gitHooksChecks: string[] = [];
  if (gitHooksTypescript) gitHooksChecks.push("TypeScript");
  if (gitHooksEslint) gitHooksChecks.push("ESLint");
  if (gitHooksStylelint) gitHooksChecks.push("Stylelint");
  if (gitHooksTailwind) gitHooksChecks.push("Tailwind");
  const gitHooksSummary = gitHooksEnabled
    ? (gitHooksChecks.length > 0
      ? gitHooksChecks.join(", ")
      : "Task validation only")
    : "Disabled";

  const cssMode = useTailwind ? "Tailwind CSS v4" : "Standard CSS";

  const summaryItems = [
    `Code Quality: ${codeQualityTools.length > 0 ? codeQualityTools.join(", ") : "None"}`,
    `CSS Mode: ${cssMode}`,
    `Git Hooks: ${gitHooksSummary}`,
    "",
    `Agents (${String(agents.length)}/${String(availableAgents.length)}):`,
    formatList(agentNames),
    "",
    `Skills (${String(skills.length)}/${String(availableSkills.length)}):`,
    formatList(skillNames),
    "",
    `Hooks (${String(selectedHooks.length)}/${String(availableHookCategories.length)}):`,
    formatList(hookNames),
    "",
    "MCP Servers:",
    mcpServers.localServers.length > 0
      ? formatList(mcpServers.localServers)
      : "  None",
    mcpProxyPortString,
    "",
    `Permissions: ${permissionPreset}`,
  ].filter((line): line is string => line !== "").join("\n");

  clackNote(summaryItems, "Configuration Summary");

  const s = p.spinner();
  s.start("Creating project structure...");

  // Build config
  const now = new Date().toISOString();
  const config: WorkflowConfig = {
    components: {
      agents,
      declinedAgents,
      docs: true,
      hooks,
      declinedSkills,
      scripts: true,
      skills,
    },
    created: now,
    mcpServers,
    permissions: permissionPreset,
    tooling: {
      codeQuality,
      codeQualityDetected,
      tailwind: useTailwind,
      gitHooks: {
        enabled: gitHooksEnabled,
        eslint: gitHooksEslint,
        stylelint: gitHooksStylelint,
        tailwind: gitHooksTailwind,
        typescript: gitHooksTypescript,
      }
    },
    updated: now,
    version: "1.0",
    packageVersion: getPackageVersion(),
    workflow: {}
  };

  s.stop("Configuration complete!");

  return config;
}

/**
 * Format an array of strings into multi-column layout
 * @param items - Array of strings to format
 * @param indent - Indentation prefix for each row
 * @returns Formatted multi-line string
 */
function formatList(items: string[], indent = "  "): string {
  if (items.length === 0) {
    return `${indent}None`;
  }
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_ROW) {
    const chunk = items.slice(i, i + ITEMS_PER_ROW);
    rows.push(indent + chunk.join(", "));
  }
  return rows.join("\n");
}
