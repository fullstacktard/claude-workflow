/**
 * Configuration Management Command
 * View and modify workflow configuration after initialization
 * @module commands/config
 */

import chalk from "chalk";
import * as fs from "node:fs";

import type { HookCategories, WorkflowConfig } from "../types/workflow-config.js";

import {
  availableAgents,
  availableHookCategories,
  availableSkills,
} from "../component-registry.js";
import { downloadDirectory, fetchFile, templateFileExists } from "../file-operations.js";
import {
  promptMultiSelect,
  promptSelect,
  promptYesNo,
  showError,
  showInfo,
  showSuccess,
  showWarning,
} from "../ui.js";
import {
  configExists,
  loadConfig,
  saveConfig,
} from "../utils/config-manager.js";
import {
  isRunningInDocker,
  isValidHostPath,
} from "../utils/docker-utils.js";
import { promptMcpSelection } from "../utils/mcp-selection.js";

/**
 * Main config command entry point
 * Shows current config and provides action menu
 */
export async function configureWorkflow(): Promise<void> {
  console.log(chalk.cyan.bold("\n=== Claude Workflow Configuration ===\n"));

  // Check if config exists
  if (!configExists()) {
    showError("No workflow configuration found!");
    showInfo(
      "Run 'claude-workflow init' first to initialize your project."
    );
    process.exit(1);
  }

  // Load config
  const config = loadConfig();
  if (!config) {
    showError("Failed to load workflow configuration!");
    process.exit(1);
  }

  // Main loop - show menu until user exits
  let shouldExit = false;
  while (!shouldExit) {
    // Display current configuration
    displayCurrentConfig(config);

    // Show action menu
    const action = await promptSelect(
      "\nWhat would you like to do?",
      [
        { name: "View full configuration", value: "view" },
        {
          name: `Modify agents (${String(config.components.agents.length)} selected)`,
          value: "agents",
        },
        {
          name: `Modify skills (${String(config.components.skills.length)} selected)`,
          value: "skills",
        },
        {
          name: "Modify hook categories",
          value: "hooks",
        },
        {
          name: "Modify workflow settings",
          value: "workflow",
        },
        {
          name: "Modify tooling options",
          value: "tooling",
        },
        {
          name: `Modify MCP servers (${String(config.mcpServers.localServers.length)} local${config.mcpServers.useProxy ? ", proxy enabled" : ""})`,
          value: "mcp",
        },
        {
          name: `Set Docker host path${config._hostProjectRoot ? ` (${config._hostProjectRoot})` : " (not set)"}`,
          value: "docker",
        },
        {
          name: "Reset configuration",
          value: "reset",
        },
        { name: "Exit", value: "exit" },
      ]
    );

    // Route to appropriate handler
    let modified = false;
    switch (action) {
    case "agents": {
      modified = await modifyAgents(config);
      break;
    }
    case "docker": {
      modified = await modifyDockerHostPath(config);
      break;
    }
    case "exit": {
      shouldExit = true;
      break;
    }
    case "hooks": {
      modified = await modifyHooks(config);
      break;
    }
    case "mcp": {
      modified = await modifyMcpServers(config);
      break;
    }
    case "reset": {
      modified = await resetConfig();
      if (modified) {
        shouldExit = true; // Exit after reset
      }
      break;
    }
    case "skills": {
      modified = await modifySkills(config);
      break;
    }
    case "tooling": {
      modified = await modifyTooling(config);
      break;
    }
    case "view": {
      displayFullConfig(config);
      await promptToContinue();
      break;
    }
    case "workflow": {
      modified = modifyWorkflow();
      break;
    }
    }

    // Save config if modified
    if (modified && !shouldExit) {
      saveConfig(config);
      showSuccess("Configuration updated successfully!");
      await promptToContinue();
    }
  }

  showInfo("Configuration session ended.");
}

/**
 * Display current configuration summary
 */
function displayCurrentConfig(config: WorkflowConfig): void {
  console.clear();
  console.log(chalk.cyan.bold("\n=== Current Configuration ===\n"));

  // Components
  console.log(chalk.yellow("\nComponents:"));
  console.log(
    `  Agents (${String(config.components.agents.length)}):  ${config.components.agents.join(", ") || "none"}`
  );
  console.log(
    `  Skills (${String(config.components.skills.length)}):  ${config.components.skills.join(", ") || "none"}`
  );

  // Hook Categories
  console.log(chalk.yellow("\nHook Categories:"));
  const enabledHooks = Object.entries(config.components.hooks)
    .filter(([, enabled]): boolean => Boolean(enabled))
    .map(([name]) => name);
  console.log(`  Enabled (${String(enabledHooks.length)}):  ${enabledHooks.join(", ") || "none"}`);

  // Tooling
  console.log(chalk.yellow("\nTooling:"));
  console.log(
    `  CSS Mode:             ${config.tooling.tailwind ? "Tailwind CSS v4" : "Standard CSS"}`
  );

  // MCP Servers
  console.log(chalk.yellow("\nMCP Servers:"));
  const mcpInfo = config.mcpServers.localServers.length > 0
    ? config.mcpServers.localServers.join(", ")
    : "none";
  const DEFAULT_PROXY_PORT = 3847;
  const proxyInfo = config.mcpServers.useProxy
    ? ` + proxy (port ${String(config.mcpServers.proxyPort ?? DEFAULT_PROXY_PORT)})`
    : "";
  console.log(
    `  Local (${String(config.mcpServers.localServers.length)}): ${mcpInfo}${proxyInfo}`
  );

  // Metadata
  console.log(chalk.gray("\nMetadata:"));
  console.log(
    chalk.gray(`  Last Updated: ${new Date(config.updated).toLocaleString()}`)
  );
}

/**
 * Display full configuration as formatted JSON
 */
function displayFullConfig(config: WorkflowConfig): void {
  const JSON_INDENT_SPACES = 2;
  console.clear();
  console.log(chalk.cyan.bold("\n=== Full Configuration ===\n"));
  console.log(JSON.stringify(config, undefined, JSON_INDENT_SPACES));
}

/**
 * Modify agents - add or remove agent files
 * @returns true if config was modified
 */
async function modifyAgents(config: WorkflowConfig): Promise<boolean> {
  const choices = availableAgents.map((agent) => ({
    checked: config.components.agents.includes(agent.id),
    name: `${agent.name} - ${agent.description}`,
    value: agent.id,
  }));

  const newSelection = await promptMultiSelect(
    "Select agents to include:",
    choices
  );

  // Find agents to add and remove
  const toAdd = newSelection.filter(
    (id) => !config.components.agents.includes(id)
  );
  const toRemove = config.components.agents.filter(
    (id) => !newSelection.includes(id)
  );

  // Add new agents
  for (const agentId of toAdd) {
    const src = `dist/templates/.claude/agents/${agentId}.md`;
    // Skip agents that no longer exist in templates
    if (!templateFileExists(src)) {
      showWarning(`Agent not available: ${agentId}`);
      continue;
    }
    try {
      const content = fetchFile(src);
      fs.mkdirSync(".claude/agents", { recursive: true });
      fs.writeFileSync(`.claude/agents/${agentId}.md`, content);
      showSuccess(`Added agent: ${agentId}`);
    } catch {
      showWarning(`Could not add agent: ${agentId}`);
    }
  }

  // Remove deselected agents
  for (const agentId of toRemove) {
    const agentPath = `.claude/agents/${agentId}.md`;
    if (fs.existsSync(agentPath)) {
      fs.unlinkSync(agentPath);
      showInfo(`Removed agent: ${agentId}`);
    }
  }

  // Update config
  config.components.agents = newSelection;

  return toAdd.length > 0 || toRemove.length > 0;
}

/**
 * Modify hook categories - toggle hook category folders
 * @returns true if config was modified
 */
async function modifyHooks(config: WorkflowConfig): Promise<boolean> {
  const choices = availableHookCategories.map((category) => ({
    checked: config.components.hooks[category.id as keyof HookCategories],
    name: `${category.name} - ${category.description}`,
    value: category.id,
  }));

  const selectedHooks = await promptMultiSelect(
    "Select hook categories to enable:",
    choices
  );

  // Update hook categories
  const newHooks = {} as HookCategories;
  for (const category of availableHookCategories) {
    newHooks[category.id as keyof HookCategories] = selectedHooks.includes(
      category.id
    );
  }

  // Sync hook directories
  await syncHooks(config.components.hooks, newHooks);

  // Check if modified
  const modified = JSON.stringify(config.components.hooks) !== JSON.stringify(newHooks);
  config.components.hooks = newHooks;

  return modified;
}

/**
 * Modify MCP servers using existing promptMcpSelection
 * @returns true if config was modified
 */
async function modifyMcpServers(config: WorkflowConfig): Promise<boolean> {
  const oldServers = { ...config.mcpServers };

  showInfo("\nConfiguring MCP servers...");
  const newServers = await promptMcpSelection();

  config.mcpServers = newServers;

  // Check if anything changed
  return JSON.stringify(oldServers) !== JSON.stringify(newServers);
}

/**
 * Modify skills - add or remove skill directories
 * @returns true if config was modified
 */
async function modifySkills(config: WorkflowConfig): Promise<boolean> {
  // All skills are applicable now that worktree filtering is removed
  const applicableSkills = availableSkills;

  const choices = applicableSkills.map((skill) => ({
    checked: config.components.skills.includes(skill.id),
    name: `${skill.name} - ${skill.description}`,
    value: skill.id,
  }));

  const newSelection = await promptMultiSelect(
    "Select skills to include:",
    choices
  );

  // Sync skills folder
  await syncSkills(config.components.skills, newSelection);

  // Update config
  const modified = JSON.stringify(config.components.skills) !== JSON.stringify(newSelection);
  config.components.skills = newSelection;

  return modified;
}

/**
 * Modify tooling options
 * @returns true if config was modified
 */
async function modifyTooling(config: WorkflowConfig): Promise<boolean> {
  const oldTooling = { ...config.tooling };

  // Tailwind CSS v4 mode
  config.tooling.tailwind = (await promptYesNo(
    "Use Tailwind CSS v4 (utility-first CSS with design tokens)?",
    config.tooling.tailwind ?? false
  ));

  // Check if anything changed
  return JSON.stringify(oldTooling) !== JSON.stringify(config.tooling);
}

/**
 * Modify workflow settings
 * @returns true if config was modified
 */
function modifyWorkflow(): boolean {
  // No workflow settings to modify currently
  showInfo("No workflow settings available to modify.");
  return false;
}

/**
 * Modify Docker host path setting
 * Used when running in Docker to ensure hook paths work on host system
 */
async function modifyDockerHostPath(config: WorkflowConfig): Promise<boolean> {
  console.log(chalk.cyan("\n=== Docker Host Path Configuration ===\n"));

  if (!isRunningInDocker()) {
    showInfo("Note: You don't appear to be running in Docker.");
    showInfo("This setting is used when 'claude-workflow init/update' runs inside Docker");
    showInfo("but Claude Code runs on the host system.\n");
  }

  const currentPath = config._hostProjectRoot;
  if (currentPath) {
    showInfo(`Current host path: ${currentPath}`);
  } else {
    showInfo("Host path: Not configured");
  }

  const action = await promptSelect(
    "\nWhat would you like to do?",
    [
      { name: "Set/update host path", value: "set" },
      { name: "Clear host path", value: "clear" },
      { name: "Cancel", value: "cancel" },
    ]
  );

  if (action === "cancel") {
    return false;
  }

  if (action === "clear") {
    if (currentPath) {
      delete config._hostProjectRoot;
      showSuccess("Host path cleared. Will use container path for hooks.");
      return true;
    }
    showInfo("No host path was configured.");
    return false;
  }

  // Set new path
  const { text } = await import("@clack/prompts");
  const newPath = await text({
    message: "Enter the host system path to this project:",
    placeholder: currentPath ?? "/home/user/projects/myproject",
    initialValue: currentPath ?? "",
    validate: (value) => {
      if (!value || value.trim() === "") {
        return "Path cannot be empty";
      }
      if (!isValidHostPath(value)) {
        return "Path should be an absolute host system path (e.g., /home/user/project)";
      }
      return undefined;
    }
  });

  if (typeof newPath === "string" && newPath !== currentPath) {
    config._hostProjectRoot = newPath;
    showSuccess(`Host path set to: ${newPath}`);
    showInfo("Run 'claude-workflow update --force' to regenerate settings.json with new paths.");
    return true;
  }

  return false;
}

/**
 * Prompt user to press enter to continue
 */
async function promptToContinue(): Promise<void> {
  await promptYesNo("\nPress enter to continue...", true);
}

/**
 * Reset configuration with preset selection
 * @returns true if reset was completed
 */
async function resetConfig(): Promise<boolean> {
  showWarning("\n⚠️  This will reset your entire workflow configuration!");
  const proceed = (await promptYesNo("Are you sure you want to continue?", false));

  if (!proceed) {
    return false;
  }

  // Import promptWorkflowConfig for full configuration flow
  const { promptWorkflowConfig } = await import("../utils/configPrompts.js");

  // Use the full configuration prompt
  const newConfig = await promptWorkflowConfig();

  // Save new config
  saveConfig(newConfig);

  showSuccess("\n✓ Configuration reset successfully!");
  showInfo("You may need to run 'claude-workflow update' to sync files.");

  return true;
}

/**
 * Sync hook category directories
 */
async function syncHooks(
  oldHooks: HookCategories,
  newHooks: HookCategories
): Promise<void> {
  const hookCategoryMap: Record<keyof HookCategories, string> = {
    compliance: "compliance",
    integrations: "integrations",
    orchestration: "orchestration",
    proactive: "proactive",
    quality: "quality",
    recovery: "recovery",
    taskWorkflow: "task-workflow",
    tracking: "tracking",
    videoWorkflow: "video-workflow",
  };

  for (const [configKey, dirName] of Object.entries(hookCategoryMap)) {
    const key = configKey as keyof HookCategories;
    const wasEnabled = oldHooks[key];
    const isEnabled = newHooks[key];

    if (!wasEnabled && isEnabled) {
      // Add hook category
      try {
        await downloadDirectory(
          `dist/templates/.claude/hooks/${dirName}`,
          `.claude/hooks/${dirName}`,
          { silent: true }
        );
        showSuccess(`Added hook category: ${dirName}`);
      } catch {
        showWarning(`Could not add hook category: ${dirName}`);
      }
    } else if (wasEnabled && !isEnabled) {
      // Remove hook category
      const hookPath = `.claude/hooks/${dirName}`;
      if (fs.existsSync(hookPath)) {
        fs.rmSync(hookPath, { force: true, recursive: true });
        showInfo(`Removed hook category: ${dirName}`);
      }
    }
  }
}

/**
 * Sync skill directories - add new, remove old
 */
async function syncSkills(
  oldSkills: string[],
  newSkills: string[]
): Promise<void> {
  const toAdd = newSkills.filter((id) => !oldSkills.includes(id));
  const toRemove = oldSkills.filter((id) => !newSkills.includes(id));

  // Add new skills (download entire directory)
  for (const skillId of toAdd) {
    try {
      await downloadDirectory(
        `dist/templates/.claude/skills/${skillId}`,
        `.claude/skills/${skillId}`,
        { silent: true }
      );
      showSuccess(`Added skill: ${skillId}`);
    } catch {
      showWarning(`Could not add skill: ${skillId}`);
    }
  }

  // Remove deselected skills (delete entire directory)
  for (const skillId of toRemove) {
    const skillPath = `.claude/skills/${skillId}`;
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { force: true, recursive: true });
      showInfo(`Removed skill: ${skillId}`);
    }
  }
}

