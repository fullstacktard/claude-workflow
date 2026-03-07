
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CodeQualityTools, ComponentDefinition, WorkflowConfig } from "../types/workflow-config.js";
import { PACKAGE_ROOT } from "../file-operations.js";

const JSON_INDENT_SPACES = 2;

export interface HookCommand {
  command: string;
  type: string;
}

export interface HookConfig {
  hooks: HookCommand[];
}

export type HooksObject = Record<string, HookConfig[]>;

type JsonArray = JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

interface SettingsJson {
  hooks: HooksObject;
  outputStyle?: string;
  permissions?: SettingsPermissions;
  thinkingMode?: string;
}

interface SettingsPermissions {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  type?: string;
}

import {
  availableAgents,
  availableHookCategories,
  availableSkills,
} from "../component-registry.js";
import {
  getComponentsForFeatures,
  resolveFeatures,
} from "../feature-registry.js";
import {
  downloadDirectory,
  downloadDirectoryHybrid,
  fetchFile,
  fetchFileHybrid,
  makeExecutable,
  templateFileExistsHybrid,
} from "../file-operations.js";
import { generatePreCommitHook } from "../hook-generator.js";
import * as p from "@clack/prompts";

import {
  clackMultiSelect,
  showError,
  showHeader,
} from "../ui.js";
import { getPackageVersion, loadConfig, saveConfig } from "../utils/config-manager.js";
import { isRunningInDocker, tryAutoDetectHostPath } from "../utils/docker-utils.js";
import { filterPackageDeps, filterPackageScripts, mergeUserCustomizations, processTemplateContent } from "../utils/template-processor.js";

/**
 * Progress tracker for minimal output
 */
interface ProgressTracker {
  current: number;
  increment: () => void;
  total: number;
}

/**
 * Tracks file changes during update
 */
type FileCategory = "agents" | "commands" | "config" | "docs" | "hooks" | "scripts" | "skills" | "templates";

interface FileChange {
  category: FileCategory;
  name: string;           // Display name (e.g., "backend-engineer", "core/pre-tool-use")
  path: string;           // Full path
  status: "added" | "modified" | "unchanged";
}

interface FileChangeTracker {
  changes: FileChange[];
  getModified: () => Map<FileCategory, FileChange[]>;
  track: (category: FileCategory, name: string, path: string, oldContent: string | null, newContent: string) => void;
}

/**
 * Creates a tracker for file changes during update
 */
function createFileChangeTracker(): FileChangeTracker {
  const changes: FileChange[] = [];

  return {
    changes,
    getModified() {
      const modified = changes.filter(c => c.status === "modified");
      const grouped = new Map<FileCategory, FileChange[]>();
      for (const change of modified) {
        const list = grouped.get(change.category) ?? [];
        list.push(change);
        grouped.set(change.category, list);
      }
      return grouped;
    },
    track(category, name, filePath, oldContent, newContent) {
      if (oldContent === null) {
        changes.push({ category, name, path: filePath, status: "added" });
      } else if (oldContent !== newContent) {
        changes.push({ category, name, path: filePath, status: "modified" });
      }
      // 'unchanged' files are not tracked (too noisy)
    },
  };
}

/**
 * Creates a simple progress tracker (no visual bar during execution)
 * The bar is rendered once at completion
 */
function createProgressTracker(total: number): ProgressTracker {
  return {
    current: 0,
    increment: function() { this.current++; },
    total
  };
}

/**
 * Renders a static red progress bar
 */
function renderProgressBar(percentage: number, width = 40): void {
  const filled = Math.round(width * percentage / 100);
  const empty = width - filled;
  const bar = chalk.red("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  console.log(`${bar} ${percentage}%`);
}

/**
 * Counts total update items based on config
 */
function countUpdateItems(config: WorkflowConfig): number {
  let count = 0;

  // Agents
  count += config.components.agents.length;

  // Skills
  count += config.components.skills.length;

  // Core hooks (always updated)
  count += 1;

  // Enabled hook categories
  const hookMap: Record<string, string> = {
    compliance: "compliance",
    coverage: "coverage",
    integrations: "integrations",
    orchestration: "orchestration",
    proactive: "proactive",
    quality: "quality",
    recommendations: "recommendations",
    recovery: "recovery",
    taskWorkflow: "task-workflow",
    tracking: "tracking",
    videoWorkflow: "video-workflow",
  };
  for (const key of Object.keys(hookMap)) {
    if (config.components.hooks[key as keyof typeof config.components.hooks]) {
      count += 1;
    }
  }

  // Scripts
  if (config.components.scripts) count += 1;

  // Docs
  if (config.components.docs) count += 1;

  // Slash commands (always updated)
  count += 1;

  // Settings
  count += 1;

  // Code quality tools
  if (config.tooling.codeQuality.eslint) count += 1;
  if (config.tooling.codeQuality.typescript) count += 1;
  if (config.tooling.codeQuality.knip) count += 1;

  // Base templates
  count += 3;

  // Task template (always updated)
  count += 1;

  // WORKFLOW-GUIDE.md (always updated)
  count += 1;

  // Logo gallery templates (always updated)
  count += 1;

  // Banner gallery templates (always updated)
  count += 1;

  // Architecture templates (always updated)
  count += 1;

  // Docker files (always updated if docker-compose exists)
  count += 1;

  // Package.json merge (always)
  count += 1;

  // Pre-commit hook (conditional on git hooks enabled)
  if (config.tooling.gitHooks?.enabled !== false) count += 1;

  return count;
}

/**
 * Options for the updateTemplates command
 */
interface UpdateTemplatesOptions {
  /** Force update all files, replacing existing configurations */
  force?: boolean;
  /** Prompt user to reconfigure code quality tool selection (ESLint, TypeScript, Knip) */
  reconfigureTools?: boolean;
  /** Run in test mode to verify merge logic */
  test?: boolean;
}

/**
 * Updates Claude workflow configuration files based on user's existing config
 *
 * @param options - Update options
 * @param options.force - Force replace all config files
 * @param options.reconfigureTools - Prompt for code quality tool reconfiguration
 * @param options.test - Run merge logic tests
 * @returns Promise that resolves when update is complete
 */
export async function updateTemplates(options: UpdateTemplatesOptions = {}): Promise<boolean | undefined> {

  const { force = false, reconfigureTools = false, test = false } = options;

  if (test) {
    await showHeader();
    return testMergeLogic();
  }

  await showHeader();

  // Load existing config
  const config = loadConfig(process.cwd());

  if (!config) {
    showError("workflow-config.json not found");
    console.log(chalk.gray("Run 'claude-workflow init' first."));
    process.exit(1);
  }

  // Docker detection: automatically detect host path for hook paths in settings.json
  // This ensures Claude Code on the host can find hooks at correct paths
  if (isRunningInDocker() && !config._hostProjectRoot) {
    const autoDetected = tryAutoDetectHostPath(process.cwd());
    if (autoDetected) {
      config._hostProjectRoot = autoDetected;
      console.log(chalk.gray(`Docker detected, auto-mapped host path: ${autoDetected}`));
      // Save the updated config so future runs don't need to re-detect
      saveConfig(config);
    }
  }

  // Handle reconfigure-tools flag
  if (reconfigureTools) {
    await reconfigureCodeQualityTools(config);
  }

  // Preserve Tailwind mode - never downgrade Tailwind projects
  // If existing config has Tailwind enabled, ensure it stays enabled
  if (config.tooling.tailwind && // Ensure gitHooks.tailwind is also set for consistency
    config.tooling.gitHooks) {
    config.tooling.gitHooks.tailwind = true;
  }

  // Check for new components (silent unless found)
  const { newAgents, newHookCategories, newSkills } = detectNewComponents(config);

  if (newAgents.length > 0 || newSkills.length > 0 || newHookCategories.length > 0) {
    // Build list of new components
    const componentList: string[] = [];
    if (newAgents.length > 0) {
      for (const a of newAgents) componentList.push(`+ ${a.name}`);
    }
    if (newSkills.length > 0) {
      for (const s of newSkills) componentList.push(`+ ${s.name}`);
    }
    if (newHookCategories.length > 0) {
      for (const h of newHookCategories) componentList.push(`+ ${h.name}`);
    }

    p.note(componentList.join("\n"), "New components available");

    if (force) {
      // When --force is used (e.g., from dashboard), automatically add all new components
      // This ensures users get new agents, skills, and hooks without interactive prompts
      if (newAgents.length > 0) {
        for (const a of newAgents) {
          config.components.agents.push(a.id);
        }
        console.log(chalk.green(`  Auto-added ${newAgents.length} new agent(s)`));
      }
      if (newSkills.length > 0) {
        for (const s of newSkills) {
          config.components.skills.push(s.id);
        }
        console.log(chalk.green(`  Auto-added ${newSkills.length} new skill(s)`));
      }
      if (newHookCategories.length > 0) {
        for (const h of newHookCategories) {
          config.components.hooks[h.id as keyof typeof config.components.hooks] = true;
        }
        console.log(chalk.green(`  Auto-added ${newHookCategories.length} new hook category(s)`));
      }
    } else {
      // Show multiselect directly with items pre-selected by default
      // User can unselect items they don't want
      if (newAgents.length > 0) {
        const agentOptions = newAgents.map(a => ({
          hint: a.description,
          label: a.name,
          value: a.id
        }));
        const selectedAgents = await clackMultiSelect(
          "Select agents",
          agentOptions,
          newAgents.map(a => a.id) // All pre-selected
        );
        config.components.agents.push(...selectedAgents);
      }
      if (newSkills.length > 0) {
        const skillOptions = newSkills.map(s => ({
          hint: s.description,
          label: s.name,
          value: s.id
        }));
        const selectedSkills = await clackMultiSelect(
          "Select skills",
          skillOptions,
          newSkills.map(s => s.id) // All pre-selected
        );
        config.components.skills.push(...selectedSkills);
      }
      if (newHookCategories.length > 0) {
        const hookOptions = newHookCategories.map(h => ({
          hint: h.description,
          label: h.name,
          value: h.id
        }));
        const selectedHooks = await clackMultiSelect(
          "Select hooks",
          hookOptions,
          newHookCategories.map(h => h.id) // All pre-selected
        );
        for (const id of selectedHooks) {
          config.components.hooks[id as keyof typeof config.components.hooks] = true;
        }
      }
    }
  }

  // Perform selective update with progress bar
  // Pass force flag to allow full settings.json replacement when --force is used
  const modifiedFiles = await performSelectiveUpdate(config, force);

  // Display modified files summary (only if there were modifications)
  if (modifiedFiles.size > 0) {
    const lines: string[] = [];
    const categoryLabels: Record<FileCategory, string> = {
      agents: "Agents",
      commands: "Commands",
      config: "Config",
      docs: "Docs",
      hooks: "Hooks",
      scripts: "Scripts",
      skills: "Skills",
      templates: "Templates",
    };

    // Sort categories for consistent display
    const sortedCategories = [...modifiedFiles.keys()].sort();

    for (const category of sortedCategories) {
      const files = modifiedFiles.get(category);
      if (files && files.length > 0) {
        lines.push(`${categoryLabels[category]} (${files.length})`);
        for (const file of files) {
          lines.push(`  ~ ${file.name}`);
        }
        lines.push("");
      }
    }

    if (lines.length > 0) {
      p.note(lines.join("\n").trim(), "Updated files");
    }
  }

  // Update config timestamp and package version
  config.updated = new Date().toISOString();
  config.packageVersion = getPackageVersion();
  saveConfig(config, process.cwd());

  // Register/update project in global registry (registers legacy projects)
  try {
    const { getProjectRegistry } = await import("../services/project-registry.js");
    const registry = getProjectRegistry();

    // Get installed version from this package's package.json
    let installedVersion = "unknown";
    try {
      // Path from dist/lib/commands/update.js to package.json is 3 levels up
      const packagePath = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "../../../package.json"
      );
      const packageContent = readFileSync(packagePath, "utf8");
      const pkg = JSON.parse(packageContent) as { version?: string };
      installedVersion = pkg.version ?? "unknown";
    } catch (error) {
      console.log("✗ Error reading package version:", (error as Error).message);
    }

    // Use HOST_PATH_FOR_SETTINGS when running in Docker to register with host path
    // This ensures the project registry uses paths that work on the host system
    const hostProjectPath = process.env.HOST_PATH_FOR_SETTINGS ?? path.resolve(process.cwd());
    const projectName = path.basename(hostProjectPath);
    registry.register({
      installedVersion,
      name: projectName,
      pwd: hostProjectPath,
    });
  } catch {
    // Non-fatal - registry is optional for backward compatibility
  }

  // Check for pro module updates (if licensed)
  try {
    const { areProModulesDownloaded, checkProModuleUpdate } =
      await import("../pro-module-manager.js");
    if (areProModulesDownloaded()) {
      const { LICENSE_PATH } = await import("../license-manager.js");
      if (existsSync(LICENSE_PATH)) {
        const token = readFileSync(LICENSE_PATH, "utf8").trim();
        if (token) {
          const updateInfo = await checkProModuleUpdate(token);
          if (updateInfo.updateAvailable) {
            console.log(
              chalk.cyan(
                `  Pro modules update available: ${updateInfo.currentVersion ?? "unknown"} -> ${updateInfo.latestVersion}`
              )
            );
            console.log(
              chalk.dim("  Run 'claude-workflow activate --sync' to update")
            );
          }
        }
      }
    }
  } catch {
    // Non-fatal: pro module check is informational only
  }

  p.outro("Update complete");
  return true;
}

// Helper function to convert relative paths in hooks to absolute paths
// When hostProjectRoot is provided (e.g., running in Docker), use it for hook paths
// so they work correctly on the host system
export function convertHooksToAbsolutePaths(
  hooks: HooksObject,
  projectPath: string,
  hostProjectRoot?: string
): HooksObject {
  // Guard: if projectPath ends with .claude, strip it to avoid .claude/.claude duplication
  // This happens when users accidentally run commands from inside the .claude directory
  let normalizedProjectPath = hostProjectRoot ?? projectPath;
  if (normalizedProjectPath.endsWith("/.claude") || normalizedProjectPath.endsWith(String.raw`\.claude`)) {
    normalizedProjectPath = normalizedProjectPath.slice(0, -7);
  }

  const convertedHooks: HooksObject = {};

  for (const [hookType, hookConfigs] of Object.entries(hooks)) {
    convertedHooks[hookType] = hookConfigs.map((config: HookConfig) => {
      const updatedConfig = { ...config };
      updatedConfig.hooks = config.hooks.map((hook: HookCommand) => {
        const updatedHook = { ...hook };

        if (hook.type === "command") {
          const command = hook.command;

          // Extract optional env var prefix (e.g. "CLAUDE_HOOK_EVENT_NAME=Stop ")
          const envPrefixMatch = command.match(/^((?:[A-Z_]+=\S+\s+)+)/);
          const envPrefix = envPrefixMatch ? envPrefixMatch[1] : "";
          const cmdWithoutEnv = envPrefix ? command.slice(envPrefix.length) : command;

          // Only convert if it starts with a relative .claude/ path
          // Skip if already absolute (contains /.claude/ in the middle)
          if (cmdWithoutEnv.startsWith(".claude/") || cmdWithoutEnv.startsWith("node .claude/")) {
            // Find the .claude/ portion and extract it
            const claudeIndex = cmdWithoutEnv.indexOf(".claude/");
            if (claudeIndex !== -1) {
              const prefix = cmdWithoutEnv.slice(0, claudeIndex).trim(); // e.g., "node" or ""
              const claudePath = cmdWithoutEnv.slice(claudeIndex); // e.g., ".claude/hooks/foo.js arg1 arg2"

              // Split the .claude path from any arguments
              const pathParts = claudePath.split(" ");
              const relativePath = pathParts[0]; // e.g., ".claude/hooks/foo.js"
              const args = pathParts.slice(1).join(" "); // e.g., "arg1 arg2"

              if (relativePath !== undefined) {
                // Convert to absolute path
                const absolutePath = path.join(normalizedProjectPath, relativePath);

                // Reconstruct command: envPrefix + "node" prefix + absolute path + args
                const nodePrefix = prefix || "node";
                let newCommand = `${envPrefix}${nodePrefix} ${absolutePath}`;
                if (args) {
                  newCommand += ` ${args}`;
                }

                updatedHook.command = newCommand;
              }
            }
          }
        }

        return updatedHook;
      });

      return updatedConfig;
    });
  }

  return convertedHooks;
}

/**
 * Extract hook file paths from a hooks object
 * Returns a Set of relative paths (e.g., ".claude/hooks/core/hook.js")
 */
function extractHookPaths(hooks: HooksObject): Set<string> {
  const paths = new Set<string>();
  for (const hookConfigs of Object.values(hooks)) {
    for (const config of hookConfigs) {
      for (const hook of config.hooks) {
        if (hook.type === "command") {
          // Extract .claude/hooks/... path from command
          // Handles both absolute and relative paths
          const match = hook.command.match(/\.claude\/hooks\/[^\s]+\.js/);
          if (match) {
            // Normalize to relative path for comparison
            const matchPath = match[0];
            // If it's an absolute path, make it relative
            if (matchPath.includes("/.claude/")) {
              const lastDotClaude = matchPath.lastIndexOf("/.claude/");
              paths.add(matchPath.slice(lastDotClaude));
            } else {
              paths.add(matchPath);
            }
          }
        }
      }
    }
  }
  return paths;
}

/**
 * Template hook directories that should have stale hooks removed
 */
const TEMPLATE_HOOK_DIRECTORIES = [
  "core",
  "compliance",
  "coverage",
  "integrations",
  "orchestration",
  "proactive",
  "quality",
  "recovery",
  "task-workflow",
  "tracking"
];

/**
 * Remove stale hooks that no longer exist in template
 * @param currentHooks - Current hooks from settings.json
 * @param templateHooks - Hooks from settings.template.json
 * @param projectPath - Project root path
 * @returns Object with cleaned hooks and list of removed paths
 */
function removeStaleHooks(
  currentHooks: HooksObject,
  templateHooks: HooksObject
): { cleanedHooks: HooksObject; removedPaths: string[] } {
  const templatePaths = extractHookPaths(templateHooks);
  const removedPaths: string[] = [];
  const cleanedHooks: HooksObject = {};

  for (const [hookType, hookConfigs] of Object.entries(currentHooks)) {
    cleanedHooks[hookType] = hookConfigs.filter((config: HookConfig) => {
      let shouldRemove = false;

      for (const hook of config.hooks) {
        if (hook.type === "command") {
          // Extract relative path from command
          const match = hook.command.match(/\.claude\/hooks\/[^\s]+\.js/);
          if (match) {
            // Normalize to relative path for comparison
            const matchPath = match[0];
            let relativePath = matchPath;

            // If it's an absolute path, make it relative
            if (matchPath.includes("/.claude/")) {
              const lastDotClaude = matchPath.lastIndexOf("/.claude/");
              relativePath = matchPath.slice(lastDotClaude);
            }

            // Check if this is a template hook (in known directories)
            const isTemplateHook = TEMPLATE_HOOK_DIRECTORIES.some((dir) =>
              relativePath.includes(`/hooks/${dir}/`)
            );

            // Remove template hooks that don't exist in template
            if (isTemplateHook && !templatePaths.has(relativePath)) {
              removedPaths.push(relativePath);
              shouldRemove = true;
            }
          }
        }
      }
      return !shouldRemove; // Keep hook unless marked for removal
    });
  }

  return { cleanedHooks, removedPaths };
}

/**
 * Delete stale hook files from filesystem
 * @param removedPaths - Array of relative paths to remove (e.g., ".claude/hooks/core/old-hook.js")
 * @param projectPath - Project root path
 */
function deleteStaleHookFiles(removedPaths: string[], projectPath: string): void {
  for (const relativePath of removedPaths) {
    const absolutePath = path.join(projectPath, relativePath);
    try {
      if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
        console.log(chalk.yellow(`  Removed stale hook: ${relativePath}`));
      }
    } catch (error) {
      console.warn(
        chalk.yellow(`  Failed to remove ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }
}

/**
 * Extract the script filename from a hook command for comparison
 * e.g., "node /path/to/.claude/hooks/core/foo.js" -> "hooks/core/foo.js"
 */
function extractHookScriptName(command: string): string {
  // Remove "node " prefix if present
  let scriptPath = command.startsWith("node ") ? command.slice(5) : command;

  // Remove any arguments after the script path
  const spaceIdx = scriptPath.indexOf(" ");
  if (spaceIdx > 0) {
    scriptPath = scriptPath.slice(0, spaceIdx);
  }

  // Extract everything after ".claude/" to get canonical name
  const claudeIdx = scriptPath.indexOf(".claude/");
  if (claudeIdx !== -1) {
    return scriptPath.slice(claudeIdx + ".claude/".length);
  }

  return scriptPath;
}

/**
 * Merge hooks from template into current settings, appending any missing hooks.
 * Missing hooks are identified by their script filename (ignoring path prefix).
 */
function mergeHooksFromTemplate(
  currentHooks: HooksObject,
  templateHooks: HooksObject
): HooksObject {
  const mergedHooks: HooksObject = {};

  // Deep clone currentHooks to avoid mutation
  for (const [hookType, hookConfigs] of Object.entries(currentHooks)) {
    mergedHooks[hookType] = hookConfigs.map(config => ({
      ...config,
      hooks: config.hooks.map(hook => ({ ...hook }))
    }));
  }

  let addedCount = 0;

  // Iterate through each hook type in template (PreToolUse, PostToolUse, etc.)
  for (const [hookType, templateConfigs] of Object.entries(templateHooks)) {
    // Get or create the hook type array in merged
    if (mergedHooks[hookType] === undefined) {
      mergedHooks[hookType] = [];
    }

    // Build a set of existing hook script names for this hook type
    const existingScriptNames = new Set<string>();
    for (const config of mergedHooks[hookType]) {
      for (const hook of config.hooks) {
        if (hook.type === "command") {
          existingScriptNames.add(extractHookScriptName(hook.command));
        }
      }
    }

    // Find missing hooks from template
    for (const templateConfig of templateConfigs) {
      for (const templateHook of templateConfig.hooks) {
        if (templateHook.type !== "command") continue;

        const scriptName = extractHookScriptName(templateHook.command);

        // Check if this hook is missing from current settings
        if (!existingScriptNames.has(scriptName)) {
          // Find the first config with a hooks array, or create one
          let targetConfig = mergedHooks[hookType].find(c => c.hooks.length > 0);
          if (targetConfig === undefined) {
            targetConfig = { hooks: [] };
            mergedHooks[hookType].push(targetConfig);
          }

          // Add the missing hook
          targetConfig.hooks.push({ ...templateHook });

          existingScriptNames.add(scriptName);
          addedCount++;
          console.log(chalk.green(`  + Added missing hook: ${scriptName}`));
        }
      }
    }
  }

  if (addedCount > 0) {
    console.log(chalk.gray(`Added ${addedCount} missing hook(s) from template`));
  }

  return mergedHooks;
}

/**
 * Detects components that exist in the registry but are not in the user's config
 */
function detectNewComponents(config: WorkflowConfig): {
  newAgents: ComponentDefinition[];
  newHookCategories: ComponentDefinition[];
  newSkills: ComponentDefinition[];
} {
  // Get declined sets (default to empty for backward compat)
  const declinedAgentSet = new Set(config.components.declinedAgents ?? []);
  const declinedSkillSet = new Set(config.components.declinedSkills ?? []);

  // When features are configured, only suggest new components from enabled features
  let allowedAgents: Set<string> | undefined;
  let allowedSkills: Set<string> | undefined;
  if (config.features && config.features.length > 0) {
    const resolved = resolveFeatures(config.features);
    const components = getComponentsForFeatures(resolved);
    allowedAgents = new Set(components.agents);
    allowedSkills = new Set(components.skills);
  }

  // Find agents not in config AND not declined AND in allowed features (if set)
  const newAgents = availableAgents.filter(
    (a) =>
      !config.components.agents.includes(a.id) &&
      !declinedAgentSet.has(a.id) &&
      (!allowedAgents || allowedAgents.has(a.id))
  );

  const newSkills = availableSkills.filter(
    (s) =>
      !config.components.skills.includes(s.id) &&
      !declinedSkillSet.has(s.id) &&
      (!allowedSkills || allowedSkills.has(s.id))
  );

  // Find hook categories not enabled in config (hooks use boolean flags, not arrays)
  const enabledHooks = new Set(Object.entries(config.components.hooks)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key));

  const newHookCategories = availableHookCategories.filter(
    (h) => !enabledHooks.has(h.id)
  );

  return { newAgents, newHookCategories, newSkills };
}

/**
 * Filters hooks array to only include hooks from enabled categories
 */
export function filterHooksByConfig(
  hooks: HooksObject,
  config: WorkflowConfig
): HooksObject {
  const enabledCategories = Object.entries(config.components.hooks)
    .filter(([, enabled]) => enabled === true)
    .map(([category]) => category);

  // Always include core hooks
  enabledCategories.push("core");

  const hookCategoryMap: Record<string, string> = {
    compliance: "compliance",
    coverage: "coverage",
    integrations: "integrations",
    orchestration: "orchestration",
    proactive: "proactive",
    quality: "quality",
    recovery: "recovery",
    taskWorkflow: "task-workflow",
    tracking: "tracking",
  };

  const filteredHooks: HooksObject = {};

  for (const [hookType, hookConfigs] of Object.entries(hooks)) {
    filteredHooks[hookType] = hookConfigs.filter((config: HookConfig) => {
      if (config.hooks.length > 0) {
        const hook = config.hooks[0];
        if (hook !== undefined) {
          const hookPath = hook.command;

          // Check if hook belongs to an enabled category
          for (const category of enabledCategories) {
            const categoryDir = hookCategoryMap[category] ?? category;
            if (hookPath.includes(`/hooks/${categoryDir}/`)) {
              return true;
            }
          }
          return false;
        }
      }
      return true; // Keep hooks without proper structure
    });
  }

  return filteredHooks;
}

/**
 * Updates only the components selected in the config
 * Conditionally updates tool configuration files based on CodeQualityTools settings
 *
 * @param config - User's workflow configuration
 * @param force - When true, replaces settings.json instead of merging
 * @returns Map of file categories to their modified files
 */
async function performSelectiveUpdate(
  config: WorkflowConfig,
  force = false
): Promise<Map<FileCategory, FileChange[]>> {
  // Create file change tracker
  const tracker = createFileChangeTracker();

  // Create required directories (silent)
  const requiredDirs = [
    ".claude",
    ".claude/agents",
    ".claude/skills",
    ".claude/hooks",
    ".claude/commands",
    ".claude/logs", // Session logs - created here to ensure proper ownership
    ".claude/logos", // Logo files generated by logo-designer agent
    ".claude/banners", // Banner files generated by banner-designer agent
    "backlog",
    "backlog/tasks",
    "backlog/completed",
    "backlog/drafts",
    "backlog/templates",
  ];

  for (const dir of requiredDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create progress tracker (silent during execution)
  const totalItems = countUpdateItems(config);
  const progress = createProgressTracker(totalItems);

  // Update agents (only selected ones) - checks both dist/ and pro/ sources
  for (const agentId of config.components.agents) {
    const src = `dist/templates/.claude/agents/${agentId}.md`;
    // Check hybrid sources (dist/ for free, pro dir for pro)
    if (templateFileExistsHybrid(src)) {
      try {
        const newContent = fetchFileHybrid(src);
        const destPath = `.claude/agents/${agentId}.md`;
        // Ensure directory exists
        const destDir = path.dirname(destPath);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        // Track changes before writing
        const oldContent = existsSync(destPath) ? readFileSync(destPath, "utf8") : null;
        tracker.track("agents", agentId, destPath, oldContent, newContent);
        writeFileSync(destPath, newContent);
      } catch (error) {
        // Log error but continue with other agents
        console.error(`Failed to update agent ${agentId}:`, (error as Error).message);
      }
    }
    progress.increment();
  }

  // Update skills (only selected ones) - checks both dist/ and pro/ sources
  for (const skillId of config.components.skills) {
    try {
      const skillChanges = await downloadDirectoryHybrid(
        `dist/templates/.claude/skills/${skillId}`,
        `.claude/skills/${skillId}`,
        { forceUpdate: true, silent: true }
      );
      // Track skill changes (use skill ID as the name)
      for (const change of skillChanges) {
        if (change.status === "modified") {
          tracker.track("skills", skillId, change.path, "", "changed");
          break; // Only track once per skill (it's a directory)
        }
      }
    } catch (error) {
      console.error(`Failed to update skill ${skillId}:`, (error as Error).message);
    }
    progress.increment();
  }

  // Always update core hooks
  const coreHookChanges = await downloadDirectory(
    "dist/templates/.claude/hooks/core",
    ".claude/hooks/core",
    { forceUpdate: true, silent: true }
  );
  // Track modified hook files
  for (const change of coreHookChanges) {
    if (change.status === "modified") {
      const hookName = `core/${path.basename(change.path, ".ts")}`;
      tracker.track("hooks", hookName, change.path, "", "changed");
    }
  }
  progress.increment();

  // Update enabled hook categories
  const hookMap: Record<string, string> = {
    compliance: "compliance",
    coverage: "coverage",
    integrations: "integrations",
    orchestration: "orchestration",
    proactive: "proactive",
    quality: "quality",
    recovery: "recovery",
    taskWorkflow: "task-workflow",
    tracking: "tracking",
    videoWorkflow: "video-workflow",
  };

  for (const [key, dir] of Object.entries(hookMap)) {
    if (config.components.hooks[key as keyof typeof config.components.hooks]) {
      const hookSourcePath = path.join(PACKAGE_ROOT, `dist/templates/.claude/hooks/${dir}`);
      // Skip if hook category doesn't exist in dist (pro-only hooks downloaded separately)
      if (!existsSync(hookSourcePath)) {
        progress.increment();
        continue;
      }
      try {
        const hookChanges = await downloadDirectory(
          `dist/templates/.claude/hooks/${dir}`,
          `.claude/hooks/${dir}`,
          { forceUpdate: true, silent: true }
        );
        // Track modified hook files
        for (const change of hookChanges) {
          if (change.status === "modified") {
            const hookName = `${dir}/${path.basename(change.path, ".ts")}`;
            tracker.track("hooks", hookName, change.path, "", "changed");
          }
        }
      } catch (error) {
        console.error(`Failed to update hooks/${dir}:`, (error as Error).message);
      }
      progress.increment();
    }
  }

  // Update scripts if enabled
  if (config.components.scripts) {
    const scriptChanges = await downloadDirectory(
      "dist/templates/scripts",
      "scripts",
      { forceUpdate: true, silent: true }
    );
    for (const change of scriptChanges) {
      if (change.status === "modified") {
        tracker.track("scripts", path.basename(change.path), change.path, "", "changed");
      }
    }
    progress.increment();
  }

  // Update docs if enabled
  if (config.components.docs) {
    const docChanges = await downloadDirectory(
      "dist/templates/.claude/docs",
      ".claude/docs",
      { forceUpdate: true, silent: true }
    );
    for (const change of docChanges) {
      if (change.status === "modified") {
        tracker.track("docs", path.basename(change.path), change.path, "", "changed");
      }
    }
    progress.increment();
  }

  // Always update .claude/scripts (CSS validation, hook utilities, etc.)
  await downloadDirectory(
    "dist/templates/.claude/scripts",
    ".claude/scripts",
    { forceUpdate: true, silent: true }
  );
  progress.increment();

  // Update slash commands
  const commandChanges = await downloadDirectory(
    "dist/templates/.claude/commands",
    ".claude/commands",
    { forceUpdate: true, silent: true }
  );
  for (const change of commandChanges) {
    if (change.status === "modified") {
      tracker.track("commands", path.basename(change.path, ".md"), change.path, "", "changed");
    }
  }
  progress.increment();

  // Update settings.json with config-aware merge (or replace if force=true)
  updateSettingsWithConfig(config, force);
  progress.increment();

  // Update code quality tool configs
  // Skip updating if files already exist (user may have custom configs)
  const toolConfigs = [
    { dest: "eslint.config.ts", enabled: config.tooling.codeQuality.eslint, src: "dist/templates/eslint.config.template.ts" },
    { dest: "tsconfig.json", enabled: config.tooling.codeQuality.typescript, src: "dist/templates/tsconfig.template.json" },
    { dest: "knip.config.ts", enabled: config.tooling.codeQuality.knip, src: "dist/templates/knip.config.template.ts" },
  ];

  for (const toolConfig of toolConfigs) {
    if (toolConfig.enabled && !existsSync(toolConfig.dest)) {
      try {
        const content = fetchFile(toolConfig.src);
        writeFileSync(toolConfig.dest, content);
      } catch {
        // Silent fail
      }
      progress.increment();
    }
  }

  // Update Tailwind v4 configs if Tailwind mode is enabled
  if (config.tooling.tailwind) {
    const tailwindConfigs = [
      { dest: "tailwind.config.ts", src: "dist/templates/tailwind/tailwind.config.template.ts" },
      { dest: "src/styles/theme.css", skipIfExists: true, src: "dist/templates/tailwind/theme.css" },
      { dest: "src/lib/utils.ts", skipIfExists: true, src: "dist/templates/lib/utils.ts" },
      { dest: "eslint.config.ts", src: "dist/templates/eslint/tailwind.eslint.config.mjs" },
      { dest: ".prettierrc", src: "dist/templates/prettier/tailwind.prettierrc.json" },
    ];

    for (const tailwindConfig of tailwindConfigs) {
      // Skip if exists and skipIfExists is true (preserve user customizations)
      if (tailwindConfig.skipIfExists && existsSync(tailwindConfig.dest)) {
        continue;
      }
      try {
        const dir = path.dirname(tailwindConfig.dest);
        if (dir !== "." && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const content = fetchFile(tailwindConfig.src);
        writeFileSync(tailwindConfig.dest, content);
      } catch {
        // Silent fail - Tailwind templates may not exist in older versions
      }
    }
  }

  // Update base templates
  const baseTemplates = [
    "CLAUDE.template.md",
    "testing-setup.md",
    "backlog-reference.md"
  ];

  const projectName = path.basename(process.cwd());
  const templatesNeedingProcessing = new Set([
    "backlog-reference.md",
    "CLAUDE.template.md"
  ]);

  for (const template of baseTemplates) {
    try {
      const sourcePath = `dist/templates/${template}`;
      const destPath = template === "CLAUDE.template.md"
        ? "CLAUDE.md"
        : `.claude/${template.replace(".template", "")}`;

      let content = fetchFile(sourcePath);

      if (templatesNeedingProcessing.has(template)) {
        content = processTemplateContent(content, template, config, projectName);
      }

      // For CLAUDE.md, preserve user customizations from existing file
      if (template === "CLAUDE.template.md" && existsSync(destPath)) {
        const existingContent = readFileSync(destPath, "utf8");
        content = mergeUserCustomizations(content, existingContent);
      }

      writeFileSync(destPath, content);
    } catch {
      // Silent fail
    }
    progress.increment();
  }

  // Update task template
  try {
    let taskTemplateContent = fetchFile("dist/templates/backlog/templates/task-template.md");
    taskTemplateContent = processTemplateContent(taskTemplateContent, "task-template.md", config, projectName);
    mkdirSync("backlog/templates", { recursive: true });
    writeFileSync("backlog/templates/task-template.md", taskTemplateContent);
  } catch {
    // Silent fail
  }
  progress.increment();

  // Update WORKFLOW-GUIDE.md (root .claude file)
  try {
    const workflowGuideContent = fetchFile("dist/templates/.claude/WORKFLOW-GUIDE.md");
    writeFileSync(".claude/WORKFLOW-GUIDE.md", workflowGuideContent);
  } catch {
    // Silent fail
  }
  progress.increment();

  // Update logo gallery template (always update gallery.html for latest styling)
  try {
    const logoTemplates = [
      { dest: ".claude/logos/gallery.html", skipIfExists: false, src: "dist/templates/.claude/logos/gallery.html" },
      { dest: ".claude/logos/manifest.json", skipIfExists: true, src: "dist/templates/.claude/logos/manifest.json" },
    ];

    for (const template of logoTemplates) {
      // Skip manifest.json if it exists (preserve user's generated logos)
      if (template.skipIfExists && existsSync(template.dest)) {
        continue;
      }
      const content = fetchFile(template.src);
      writeFileSync(template.dest, content);
    }
  } catch {
    // Silent fail
  }
  progress.increment();

  // Update banner gallery template (always update gallery.html for latest styling)
  try {
    const bannerTemplates = [
      { dest: ".claude/banners/gallery.html", skipIfExists: false, src: "dist/templates/.claude/banners/gallery.html" },
      { dest: ".claude/banners/manifest.json", skipIfExists: true, src: "dist/templates/.claude/banners/manifest.json" },
    ];

    for (const template of bannerTemplates) {
      // Skip manifest.json if it exists (preserve user's generated banners)
      if (template.skipIfExists && existsSync(template.dest)) {
        continue;
      }
      const content = fetchFile(template.src);
      writeFileSync(template.dest, content);
    }
  } catch {
    // Silent fail
  }
  progress.increment();

  // Update video gallery template (always update gallery.html for latest styling)
  try {
    const videoTemplates = [
      { dest: ".claude/video/gallery.html", skipIfExists: false, src: "dist/templates/.claude/video/gallery.html" },
      { dest: ".claude/video/manifest.json", skipIfExists: true, src: "dist/templates/.claude/video/manifest.json" },
    ];

    for (const template of videoTemplates) {
      // Skip manifest.json if it exists (preserve user's generated videos)
      if (template.skipIfExists && existsSync(template.dest)) {
        continue;
      }
      const content = fetchFile(template.src);
      writeFileSync(template.dest, content);
    }
  } catch {
    // Silent fail
  }

  // Update architecture templates
  try {
    await downloadDirectory(
      "dist/templates/architecture",
      ".claude/architecture",
      { forceUpdate: true, silent: true }
    );
  } catch {
    // Silent fail
  }
  progress.increment();

  // Update Docker files if docker-compose.yml exists
  if (existsSync(".claude/docker-compose.yml")) {
    // Note: claude-proxy Dockerfile is no longer in templates - it comes from npm package
    // and is copied to ~/.claude-proxy/python/ by ensureFstProxyPythonFiles()
    const dockerFiles = [
      { dest: ".claude/docker/mcp-proxy/Dockerfile", src: "dist/templates/.claude/docker/mcp-proxy/Dockerfile" },
      { dest: ".claude/docker/dashboard/Dockerfile", src: "dist/templates/.claude/docker/dashboard/Dockerfile" },
      { dest: ".claude/docker-compose.yml", src: "dist/templates/.claude/docker-compose.yml" },
    ];

    for (const dockerFile of dockerFiles) {
      try {
        const dir = path.dirname(dockerFile.dest);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const content = fetchFile(dockerFile.src);
        writeFileSync(dockerFile.dest, content);
      } catch {
        // Silent fail - Docker files are optional
      }
    }

    // Skip heavy operations when running from dashboard (LIGHTWEIGHT_UPDATE=1)
    // These operations (lib copy, npm pack, npm install) consume significant memory
    // and aren't needed when the dashboard triggers an update in a container
    const isLightweightUpdate = process.env.LIGHTWEIGHT_UPDATE === "1";

    if (!isLightweightUpdate) {
      // Update lib/ folder for dashboard (replace entirely to avoid stale files)
      try {
        await downloadDirectory(
          "dist/lib",
          ".claude/lib",
          { cleanFirst: true, forceUpdate: true, silent: true }
        );
      } catch {
        // Silent fail - lib files are optional for non-Docker setups
      }

      // Copy claude-workflow tarball for Docker global install
      // This allows the dashboard to run `claude-workflow update` in project directories
      try {
        const { copyFileSync, readdirSync } = await import("node:fs");

        // Get the installed package location (3 levels up from dist/lib/commands/)
        const packageRoot = path.join(
          path.dirname(new URL(import.meta.url).pathname),
          "../../../"
        );

        // Find tarball in order of preference:
        // 1. Existing tarball in package root (monorepo development)
        // 2. Tarball in npm cache (global install)
        let tarballPath: string | undefined;

        // Check package root first (handles monorepo/development case)
        const existingTarballs = readdirSync(packageRoot)
          .filter(f => f.startsWith("claude-workflow-") && f.endsWith(".tgz"));

        if (existingTarballs.length > 0 && existingTarballs[0] !== undefined) {
          tarballPath = path.join(packageRoot, existingTarballs[0]);
        } else {
          // Try to find in npm cache - npm stores tarballs with content-addressable names
          // but also keeps them in _cacache/content-v2/sha512/ with the original filename
          // The easiest way is to check the package-lock or use npm cache ls
          const npmCacheDir = path.join(os.homedir(), ".npm", "_cacache", "content-v2", "sha512");
          if (existsSync(npmCacheDir)) {
            // Search for claude-workflow tarball in npm cache by checking tmp directory
            // npm pack creates tarballs in a predictable location during install
            const tmpTarballs = existsSync("/tmp")
              ? readdirSync("/tmp").filter(f => f.startsWith("claude-workflow-") && f.endsWith(".tgz"))
              : [];
            if (tmpTarballs.length > 0 && tmpTarballs[0] !== undefined) {
              tarballPath = path.join("/tmp", tmpTarballs[0]);
            }
          }
        }

        // If we found a tarball, copy it
        if (tarballPath && existsSync(tarballPath)) {
          const tarballName = path.basename(tarballPath);
          const destPath = path.join(".claude", tarballName);

          // Remove old tarballs first
          const claudeDir = ".claude";
          if (existsSync(claudeDir)) {
            for (const file of readdirSync(claudeDir)) {
              if (file.startsWith("claude-workflow-") && file.endsWith(".tgz")) {
                unlinkSync(path.join(claudeDir, file));
              }
            }
          }

          copyFileSync(tarballPath, destPath);
        }
        // If no tarball found, skip silently - Docker builds will need to provide their own
        // This is fine because:
        // 1. Monorepo users: tarball is created by npm pack during build
        // 2. End users: tarball is not needed unless rebuilding Docker containers
      } catch {
        // Silent fail - tarball is only needed for Docker builds
      }

      // Preserve existing global claude-proxy config (never overwrite on update)
      // Only create if it doesn't exist - user may have customized routing/fallback settings
      const globalConfigPath = path.join(os.homedir(), ".claude-workflow", "claude-proxy-config.yaml");
      if (!existsSync(globalConfigPath)) {
        try {
          const globalWorkflowDir = path.join(os.homedir(), ".claude-workflow");
          if (!existsSync(globalWorkflowDir)) {
            mkdirSync(globalWorkflowDir, { recursive: true });
          }
          const configContent = fetchFile("dist/templates/claude-proxy-config.yaml");
          writeFileSync(globalConfigPath, configContent);
        } catch {
          // Silent fail - config will be created on next init
        }
      }

      // Update claude-proxy Python files from npm package
      // This ensures users get the latest proxy code on update
      ensureFstProxyPythonFiles();
    }
  }
  progress.increment();

  // Smart merge package.json - add new scripts/deps without overwriting
  try {
    if (existsSync("package.json")) {
      const currentPackage = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
      const templatePackage = JSON.parse(fetchFile("dist/templates/package.template.json")) as PackageJson;

      // Filter scripts and deps based on code quality settings
      const filteredScripts = filterPackageScripts(templatePackage.scripts ?? {}, config.tooling.codeQuality);
      const filteredDeps = filterPackageDeps(templatePackage.devDependencies ?? {}, config.tooling.codeQuality);

      // Only add NEW scripts (don't overwrite existing)
      currentPackage.scripts ??= {};
      for (const [name, command] of Object.entries(filteredScripts)) {
        if (currentPackage.scripts[name] === undefined) {
          currentPackage.scripts[name] = command;
        }
      }

      // Only add NEW devDependencies (don't overwrite existing)
      currentPackage.devDependencies ??= {};
      for (const [name, version] of Object.entries(filteredDeps)) {
        if (currentPackage.devDependencies[name] === undefined) {
          currentPackage.devDependencies[name] = version;
        }
      }

      // Add Tailwind v4 dependencies if enabled
      if (config.tooling.tailwind) {
        const tailwindDevDeps: Record<string, string> = {
          "tailwindcss": "^4.0.0",
          "@tailwindcss/vite": "^4.0.0",
          "eslint-plugin-tailwindcss": "^4.0.0-beta.0",
          "prettier-plugin-tailwindcss": "^0.6.0",
        };
        for (const [pkg, version] of Object.entries(tailwindDevDeps)) {
          if (currentPackage.devDependencies[pkg] === undefined) {
            currentPackage.devDependencies[pkg] = version;
          }
        }

        // Add Tailwind-specific lint script
        currentPackage.scripts["lint:tailwind"] ??= "eslint --ext .js,.jsx,.ts,.tsx,.vue .";

        // Add Tailwind runtime dependencies (cn utility with tailwind-merge)
        const tailwindDeps: Record<string, string> = {
          "clsx": "^2.1.0",
          "tailwind-merge": "^3.0.0",
        };
        currentPackage.dependencies ??= {};
        for (const [pkg, version] of Object.entries(tailwindDeps)) {
          if (currentPackage.dependencies[pkg] === undefined) {
            currentPackage.dependencies[pkg] = version;
          }
        }
      }

      writeFileSync("package.json", JSON.stringify(currentPackage, undefined, JSON_INDENT_SPACES));
    }
  } catch {
    // Silent fail
  }
  progress.increment();

  // Regenerate pre-commit hook if git hooks are enabled
  if (existsSync(".git") && config.tooling.gitHooks?.enabled !== false) {
    try {
      // Detect package manager
      const cwd = process.cwd();
      let packageManager = "npm";
      if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) packageManager = "pnpm";
      else if (existsSync(path.join(cwd, "yarn.lock"))) packageManager = "yarn";
      else if (existsSync(path.join(cwd, "bun.lockb")) || existsSync(path.join(cwd, "bun.lock"))) packageManager = "bun";

      // Read package.json scripts
      let scripts: { lint?: string; test?: string; typecheck?: string } = {};
      if (existsSync("package.json")) {
        const pkg = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
        scripts = {
          lint: pkg.scripts?.lint,
          test: pkg.scripts?.test,
          typecheck: pkg.scripts?.typecheck,
        };
      }

      // Detect TypeScript and ESLint
      const hasTypescript = config.tooling.codeQualityDetected?.typescript ??
        existsSync("tsconfig.json");
      const hasEslint = config.tooling.codeQualityDetected?.eslint ?? (
        existsSync("eslint.config.ts") ||
        existsSync("eslint.config.js") ||
        existsSync(".eslintrc.json")
      );
      const hasStylelint = config.tooling.codeQualityDetected?.stylelint ?? (
        existsSync(".stylelintrc.json") ||
        existsSync(".stylelintrc.js") ||
        existsSync("stylelint.config.js")
      );

      const detection = {
        eslint: { hasESLint: hasEslint },
        packageManager,
        scripts,
        stylelint: { hasStylelint },
        typescript: { hasTypeScript: hasTypescript },
      };

      const hookContent = generatePreCommitHook({
        detection,
        gitHooks: config.tooling.gitHooks,
      });

      mkdirSync(".git/hooks", { recursive: true });
      writeFileSync(".git/hooks/pre-commit", hookContent);
      makeExecutable(".git/hooks/pre-commit");
    } catch {
      // Silent fail
    }
    progress.increment();
  }

  // Render completed progress bar
  console.log("");
  renderProgressBar(100);

  // Return tracked changes
  return tracker.getModified();
}

/**
 * Reconfigure code quality tools by prompting for new selections
 */
async function reconfigureCodeQualityTools(config: WorkflowConfig): Promise<void> {
  const codeQualityOptions = [
    { hint: "Linting", label: "ESLint", value: "eslint" as const },
    { hint: "Styles", label: "Stylelint", value: "stylelint" as const },
    { hint: "Types", label: "TypeScript", value: "typescript" as const },
    { hint: "Dead code", label: "Knip", value: "knip" as const },
  ];

  const currentSelections: ("eslint" | "knip" | "stylelint" | "typescript")[] = [];
  if (config.tooling.codeQuality.eslint) currentSelections.push("eslint");
  if (config.tooling.codeQuality.stylelint) currentSelections.push("stylelint");
  if (config.tooling.codeQuality.typescript) currentSelections.push("typescript");
  if (config.tooling.codeQuality.knip) currentSelections.push("knip");

  const selectedCodeQualityTools = await clackMultiSelect(
    "Code quality tools",
    codeQualityOptions,
    currentSelections
  );

  const codeQuality: CodeQualityTools = {
    eslint: selectedCodeQualityTools.includes("eslint"),
    knip: selectedCodeQualityTools.includes("knip"),
    stylelint: selectedCodeQualityTools.includes("stylelint"),
    typescript: selectedCodeQualityTools.includes("typescript"),
  };

  config.tooling.codeQuality = codeQuality;
  saveConfig(config, process.cwd());
}


function testMergeLogic(): boolean {
  console.log(chalk.gray("Testing merge logic..."));

  const templateSettings = {
    permissions: {
      allow: ["Bash:*", "Read:*"],
      ask: [],
      deny: [],
    },
  };

  const userSettings = {
    customField: "preserved",
    permissions: {
      allow: ["Bash:*", "Read:*", "Write:/my-project/*"],
      ask: [],
      deny: ["Write:/etc/*"],
    },
  };

  const templatePermCount = templateSettings.permissions.allow.length;
  const userPermCount = userSettings.permissions.allow.length;

  // Basic validation
  if (templatePermCount > 0 && userPermCount > templatePermCount) {
    console.log(chalk.hex("#dc2626")("Merge test passed"));
  }

  return true;
}

/**
 * Update settings.json with config-aware hook filtering
 * @param config - Workflow configuration for filtering hooks
 * @param forceReplace - When true, replaces settings.json entirely instead of merging
 */
function updateSettingsWithConfig(config?: WorkflowConfig, forceReplace = false): void {
  const templateContent = fetchFile("dist/templates/.claude/settings.template.json");
  const settingsPath = ".claude/settings.json";
  const projectPath = process.cwd();

  // When running in Docker, use the host project root for hook paths
  // Priority: 1) HOST_PATH_FOR_SETTINGS env var, 2) _hostProjectRoot from config, 3) current path
  const hostPathForHooks = process.env.HOST_PATH_FOR_SETTINGS ?? config?._hostProjectRoot ?? projectPath;

  mkdirSync(".claude", { recursive: true });

  const exists = existsSync(settingsPath);

  // If force replace or file doesn't exist, write fresh from template
  if (!exists || forceReplace) {
    const templateSettings = JSON.parse(templateContent) as SettingsJson;
    templateSettings.hooks = convertHooksToAbsolutePaths(templateSettings.hooks, projectPath, hostPathForHooks);

    if (config !== undefined) {
      templateSettings.hooks = filterHooksByConfig(templateSettings.hooks, config);
    }

    writeFileSync(settingsPath, JSON.stringify(templateSettings, undefined, JSON_INDENT_SPACES));
    return;
  }

  // Parse both template and current settings
  const templateSettings = JSON.parse(templateContent) as SettingsJson;
  const currentSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as SettingsJson;

  // Convert hooks to absolute paths (using host path when in Docker)
  const convertedCurrentHooks = convertHooksToAbsolutePaths(currentSettings.hooks, projectPath, hostPathForHooks);
  const convertedTemplateHooks = convertHooksToAbsolutePaths(templateSettings.hooks, projectPath, hostPathForHooks);

  // Remove stale hooks that no longer exist in template
  const { cleanedHooks, removedPaths } = removeStaleHooks(
    convertedCurrentHooks,
    convertedTemplateHooks
  );

  // Delete stale hook files from filesystem
  if (removedPaths.length > 0) {
    console.log(chalk.gray("Cleaning up stale hooks..."));
    deleteStaleHookFiles(removedPaths, projectPath);
  }

  // Merge hooks - append any missing hooks from template
  const mergedHooks = mergeHooksFromTemplate(
    cleanedHooks,
    convertedTemplateHooks
  );

  // List of invalid/deprecated permission patterns to remove
  const invalidPermissions = new Set([
    "Bash(for *)",
    "Bash(for * in *; do backlog *; done)",
    "Bash(git worktree *)",
    "Bash(PROJECT_NAME=* && git worktree *)"
  ]);

  // Helper function to merge permission arrays (allow, ask, deny)
  const mergePermissionArray = (
    templatePerms: string[] = [],
    currentPerms: string[] = []
  ): string[] => {
    const allPermissions = [...templatePerms, ...currentPerms];

    // Migrate deprecated patterns to correct versions
    const migratedPermissions = allPermissions.map(perm => {
      // Migrate Skill(*) to Skill - the glob pattern is incorrectly interpreted
      // as a path restriction rather than a wildcard capability grant
      if (perm === "Skill(*)") {
        return "Skill";
      }
      return perm;
    });

    const filteredPermissions = migratedPermissions.filter(perm => !invalidPermissions.has(perm));
    return [...new Set(filteredPermissions)];
  };

  // Create merged settings object with merged hooks (stale removed, missing added)
  const mergedSettings: SettingsJson = {
    hooks: mergedHooks,
    // outputStyle: prefer current setting, fall back to template
    outputStyle: currentSettings.outputStyle ?? templateSettings.outputStyle,
    permissions: {
      allow: mergePermissionArray(
        templateSettings.permissions?.allow,
        currentSettings.permissions?.allow
      ),
      ask: mergePermissionArray(
        templateSettings.permissions?.ask,
        currentSettings.permissions?.ask
      ),
      deny: mergePermissionArray(
        templateSettings.permissions?.deny,
        currentSettings.permissions?.deny
      )
    },
    // thinkingMode: prefer current setting, fall back to template
    thinkingMode: currentSettings.thinkingMode ?? templateSettings.thinkingMode
  };

  if (config !== undefined) {
    mergedSettings.hooks = filterHooksByConfig(mergedSettings.hooks, config);
  }

  writeFileSync(settingsPath, JSON.stringify(mergedSettings, undefined, JSON_INDENT_SPACES));
}

/**
 * Resolve claude-proxy Python source directory from various locations.
 * Handles npm workspace symlinks, monorepo development paths, and fallbacks.
 *
 * @param packageRoot - Root directory of the claude-workflow package
 * @returns Resolved Python source directory path, or undefined if not found
 */
function resolveFstProxyPythonPath(packageRoot: string): string | undefined {

  // Priority order for finding Python files:
  // 1. Scoped package in node_modules (resolves symlinks for file: dependencies)
  // 2. Direct packages/ directory for monorepo development
  // 3. Legacy unscoped package name

  const pathsToCheck = [
    // Scoped package @fullstacktard/claude-proxy
    path.join(packageRoot, "node_modules", "@fullstacktard", "claude-proxy", "python"),
    // Monorepo development - direct packages path
    path.join(packageRoot, "packages", "claude-proxy", "python"),
    // Legacy unscoped package
    path.join(packageRoot, "node_modules", "claude-proxy", "python"),
  ];

  for (const pythonPath of pathsToCheck) {
    try {
      // Try to resolve the path (handles symlinks created by file: dependencies)
      const resolvedPath = realpathSync(pythonPath);
      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }
    } catch {
      // Path doesn't exist or can't be resolved - try next
      if (existsSync(pythonPath)) {
        return pythonPath;
      }
    }
  }

  return undefined;
}

/**
 * Copy claude-proxy Python source files from npm package to ~/.claude-proxy/python/
 * This allows docker-compose to build the proxy image from a consistent location.
 *
 * Searches for Python files in:
 * 1. node_modules/@fullstacktard/claude-proxy/python (scoped package)
 * 2. packages/claude-proxy/python (monorepo development)
 * 3. node_modules/claude-proxy/python (legacy unscoped)
 *
 * If not found, skips silently - proxy files are optional.
 */
function ensureFstProxyPythonFiles(): void {
  const fstProxyDir = path.join(os.homedir(), ".claude-proxy");
  const pythonTargetDir = path.join(fstProxyDir, "python");

  try {
    // Get the package root (3 levels up from dist/lib/commands/)
    const packageRoot = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../"
    );

    // Try to find the Python source directory
    const pythonSourceDir = resolveFstProxyPythonPath(packageRoot);

    if (!pythonSourceDir) {
      // Silent fail - proxy Python files are optional
      // For monorepo development, use 'npm run install:global' which handles dependencies
      return;
    }

    // Ensure target directories exist
    if (!existsSync(fstProxyDir)) {
      mkdirSync(fstProxyDir, { recursive: true });
    }

    // Copy Python files recursively
    copyDirectoryRecursive(pythonSourceDir, pythonTargetDir);

    // Also copy default config files if they don't exist
    const configFiles = ["litellm_config.yaml", "routing_config.yaml"];
    for (const configFile of configFiles) {
      const targetPath = path.join(fstProxyDir, configFile);
      if (!existsSync(targetPath)) {
        const sourcePath = path.join(pythonSourceDir, configFile);
        if (existsSync(sourcePath)) {
          const content = readFileSync(sourcePath, "utf8");
          writeFileSync(targetPath, content);
        }
      }
    }

    // Copy agent_hashes.json if it doesn't exist
    const hashesTarget = path.join(fstProxyDir, "agent_hashes.json");
    if (!existsSync(hashesTarget)) {
      const hashesSource = path.join(pythonSourceDir, "fst_claude_proxy", "registry", "agent_hashes.json");
      if (existsSync(hashesSource)) {
        const content = readFileSync(hashesSource, "utf8");
        writeFileSync(hashesTarget, content);
      }
    }

  } catch {
    // Silent fail - proxy Python files are optional
  }
}

/**
 * Recursively copy a directory and its contents.
 */
function copyDirectoryRecursive(source: string, target: string): void {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      // Skip __pycache__ and other generated directories
      if (entry.name === "__pycache__" || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      // Skip .pyc files
      if (entry.name.endsWith(".pyc")) {
        continue;
      }
      const content = readFileSync(sourcePath);
      writeFileSync(targetPath, content);
    }
  }
}
