
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkflowConfig } from "./types/workflow-config.js";

import { getComponentsForFeatures, resolveFeatures } from "./feature-registry.js";
import { PRO_CLAUDE_DIR, resolveComponentSourceWithLicenseCheck } from "./pro-module-manager.js";
import { showError, showInfo, showSuccess, showWarning } from "./ui.js";
import { getEffectiveCodeQuality, processAgentContent } from "./utils/template-processor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calculate PACKAGE_ROOT correctly - should be the project root where dist/ is located
// Since this file is at src/lib/fileOperations.ts, we need to go up two levels to reach project root
export const PACKAGE_ROOT = path.resolve(__dirname, "../..");

// Use local files flag - always true in this implementation
// This constant is kept for potential future use when adding remote file support
 
const _USE_LOCAL_FILES = true; void _USE_LOCAL_FILES;

interface HookConfig {
  command?: string;
  hooks?: { command?: string; type?: string; }[];
  type?: string;
}

interface SettingsJson {
  hooks: Record<string, boolean | HookConfig[] | number | string>;
}

const JSON_INDENT_SPACES = 2;

export async function downloadClaudeFolder(options: { silent?: boolean; } = {}): Promise<void> {
  const { silent = false } = options;
  const contents = fetchDirectoryContents("dist/templates/.claude");

  const projectPath = process.cwd();

  for (const item of contents) {
    if (item.type === "file") {
      let fileContent = fetchFile(`dist/templates/.claude/${item.name}`);

      let destName = item.name;
      if (destName.endsWith(".template.json")) {
        destName = destName.replace(".template.json", ".json");

        // Special handling for settings.json - convert paths to absolute
        if (destName === "settings.json") {
          const settings = JSON.parse(fileContent) as SettingsJson;
          settings.hooks = convertHooksToAbsolutePaths(settings.hooks, projectPath);
          fileContent = JSON.stringify(settings, undefined, JSON_INDENT_SPACES);
        }
      } else if (destName.endsWith(".template.js")) {
        destName = destName.replace(".template.js", ".js");
      }

      const filePath = path.join(".claude", destName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, fileContent);
      if (!silent) {
        showSuccess(`.claude/${destName}`);
      }
    } else if (item.type === "dir") {
      await downloadDirectory(
        `dist/templates/.claude/${item.name}`,
        `.claude/${item.name}`,
        { silent }
      );
    }
  }
}

/**
 * Download .claude folder with selective component filtering
 * Only downloads components that are enabled in the user's configuration
 *
 * @param config - Workflow configuration specifying which components to download
 * @param options - Download options
 * @param options.silent - Suppress success output messages
 *
 * @example
 * ```typescript
 * const config: WorkflowConfig = {
 *   components: {
 *     agents: ['backend-engineer', 'frontend-engineer'],
 *     skills: ['task-management'],
 *     hooks: { compliance: true, quality: true },
 *     scripts: true,
 *     docs: false
 *   },
 *   workflow: {}
 * };
 * await downloadClaudeFolderSelective(config, { silent: false });
 * ```
 */
export async function downloadClaudeFolderSelective(
  config: WorkflowConfig,
  options: { silent?: boolean } = {}
): Promise<void> {
  const { silent = false } = options;
  const projectPath = process.cwd();

  // Phase 1: Always download core files
  downloadCoreFiles(projectPath, silent);

  // Phase 2: Download selected components
  downloadSelectedAgents(
    config.components.agents,
    config,
    silent
  );
  await downloadSelectedSkills(config.components.skills, silent);

  // Phase 3: Always download core hooks
  fs.mkdirSync(".claude/hooks/core", { recursive: true });
  await downloadDirectory("dist/templates/.claude/hooks/core", ".claude/hooks/core", { silent });

  // Phase 4: Download enabled hook categories
  await downloadEnabledHookCategories(config.components.hooks, silent);

  // Phase 5: Download optional components
  if (config.components.scripts) {
    await downloadDirectory("dist/templates/.claude/scripts", ".claude/scripts", { silent });
  }

  // Phase 6: Download docs if enabled
  if (config.components.docs) {
    await downloadDirectory("dist/templates/.claude/docs", ".claude/docs", { silent });
  }

  // Phase 7: Download workflows (filtered by features if set)
  fs.mkdirSync(".claude/workflows", { recursive: true });
  if (config.features && config.features.length > 0) {
    const resolved = resolveFeatures(config.features);
    const components = getComponentsForFeatures(resolved);
    await downloadSelectedWorkflows(components.workflows, silent);
  } else {
    // No features configured - download all workflows (backward compat)
    await downloadDirectory("dist/templates/.claude/workflows", ".claude/workflows", { silent });
  }

  // Phase 8: Download slash commands (filtered by features if set)
  fs.mkdirSync(".claude/commands", { recursive: true });
  if (config.features && config.features.length > 0) {
    const resolved = resolveFeatures(config.features);
    const components = getComponentsForFeatures(resolved);
    await downloadSelectedCommands(components.commands, silent);
  } else {
    // No features configured - download all commands (backward compat)
    await downloadDirectory("dist/templates/.claude/commands", ".claude/commands", { silent, skipExistingFiles: true });
  }

  // Phase 9: Process and write settings.json
  processSettingsJson(config, projectPath, silent);
}

export interface FileChangeResult {
  path: string;
  status: "added" | "modified";
}

export async function downloadDirectory(remotePath: string, localPath: string, options: {
  addNewFiles?: boolean;
  /** Remove target directory contents before copying (prevents stale files) */
  cleanFirst?: boolean;
  forceUpdate?: boolean;
  silent?: boolean;
  skipExistingFiles?: boolean;
} = {}): Promise<FileChangeResult[]> {
  const { addNewFiles = false, cleanFirst = false, forceUpdate = false, silent = false, skipExistingFiles = false } = options;
  const changedFiles: FileChangeResult[] = [];

  // Clean target directory first if requested (removes stale files)
  if (cleanFirst && fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }

  fs.mkdirSync(localPath, { recursive: true });
  const contents = fetchDirectoryContents(remotePath);

  for (const item of contents) {
    if (item.type === "file") {
      const filePath = path.join(localPath, item.name);

      // Skip existing files unless forceUpdate is true
      if (!forceUpdate) {
        if (skipExistingFiles && fs.existsSync(filePath)) {
          continue;
        }

        if (addNewFiles && fs.existsSync(filePath)) {
          continue;
        }
      }

      const isNewFile = !fs.existsSync(filePath);
      const sourceFilePath = `${remotePath}/${item.name}`;

      // Read existing content for comparison (text files only)
      let oldContent: string | null = null;
      if (!isNewFile && !isBinaryFile(item.name)) {
        try {
          oldContent = fs.readFileSync(filePath, "utf8");
        } catch {
          // If we can't read, treat as new
        }
      }

      // Use binary copy for binary files, text mode for text files
      if (isBinaryFile(item.name)) {
        copyFileFromPackage(sourceFilePath, filePath);
        // For binary files, just track if new (can't easily compare)
        if (isNewFile) {
          changedFiles.push({ path: filePath, status: "added" });
        }
      } else {
        const fileContent = fetchFile(sourceFilePath);

        // Track if content actually changed
        if (isNewFile) {
          changedFiles.push({ path: filePath, status: "added" });
        } else if (oldContent !== fileContent) {
          changedFiles.push({ path: filePath, status: "modified" });
        }

        fs.writeFileSync(filePath, fileContent);
      }

      if (!silent && (!addNewFiles || isNewFile)) {
        showSuccess(`Downloaded ${sourceFilePath}`);
      }
    } else if (item.type === "dir") {
      const subChanges = await downloadDirectory(
        `${remotePath}/${item.name}`,
        path.join(localPath, item.name),
        options
      );
      changedFiles.push(...subChanges);
    }
  }

  return changedFiles;
}

export function fetchDirectoryContents(dirPath: string): { name: string; type: string }[] {
  try {
    const localPath = path.join(PACKAGE_ROOT, dirPath);
    if (!fs.existsSync(localPath)) {
      return [];
    }

    const items = fs.readdirSync(localPath, { withFileTypes: true });
    return items.map((item: fs.Dirent) => ({
      name: item.name,
      type: item.isDirectory() ? "dir" : "file"
    }));
  } catch (error) {
    showError(`Error reading directory ${dirPath}: ${(error as Error).message}`);
    return [];
  }
}

export function fetchFile(filePath: string): string {
  const localPath = path.join(PACKAGE_ROOT, filePath);
  return fs.readFileSync(localPath, "utf8");
}

/**
 * Check if a template file exists
 */
export function templateFileExists(filePath: string): boolean {
  const localPath = path.join(PACKAGE_ROOT, filePath);
  return fs.existsSync(localPath);
}

// ============================================================================
// HYBRID FILE OPERATIONS (Pro + Free module resolution)
// ============================================================================

/**
 * Convert a dist-relative path to its pro modules equivalent.
 * Example: "dist/templates/.claude/agents/v0-planner.md"
 *       -> "~/.claude-workflow/pro/.claude/agents/v0-planner.md"
 * Returns null if the path does not contain the dist/.claude/ marker.
 */
function distPathToProPath(distRelativePath: string): string | null {
  const marker = "dist/templates/.claude/";
  const idx = distRelativePath.indexOf(marker);
  if (idx === -1) return null;
  const claudeRelative = distRelativePath.slice(idx + marker.length);
  return path.join(PRO_CLAUDE_DIR, claudeRelative);
}

/**
 * Fetch a file from either pro modules directory or npm package (dist/).
 * Checks pro directory first; falls back to dist/ if not found.
 */
export function fetchFileHybrid(distRelativePath: string): string {
  const proPath = distPathToProPath(distRelativePath);
  if (proPath && fs.existsSync(proPath)) {
    return fs.readFileSync(proPath, "utf8");
  }
  return fetchFile(distRelativePath);
}

/**
 * Check if a template file exists in either pro modules or dist/.
 */
export function templateFileExistsHybrid(filePath: string): boolean {
  const proPath = distPathToProPath(filePath);
  if (proPath && fs.existsSync(proPath)) return true;
  return templateFileExists(filePath);
}

/**
 * Download/copy a directory tree from an absolute source path to a local destination.
 * Used for copying from the pro modules directory which is an absolute path.
 */
export async function downloadDirectoryFromAbsolute(
  absoluteSrcPath: string,
  localPath: string,
  options: {
    addNewFiles?: boolean;
    cleanFirst?: boolean;
    forceUpdate?: boolean;
    silent?: boolean;
    skipExistingFiles?: boolean;
  } = {}
): Promise<FileChangeResult[]> {
  const { cleanFirst = false, forceUpdate = false, silent = false, skipExistingFiles = false, addNewFiles = false } = options;
  const changedFiles: FileChangeResult[] = [];

  if (cleanFirst && fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }

  fs.mkdirSync(localPath, { recursive: true });

  if (!fs.existsSync(absoluteSrcPath)) {
    return changedFiles;
  }

  const items = fs.readdirSync(absoluteSrcPath, { withFileTypes: true });

  for (const item of items) {
    const srcItemPath = path.join(absoluteSrcPath, item.name);
    const destItemPath = path.join(localPath, item.name);

    if (item.isFile()) {
      if (!forceUpdate) {
        if (skipExistingFiles && fs.existsSync(destItemPath)) continue;
        if (addNewFiles && fs.existsSync(destItemPath)) continue;
      }

      const isNewFile = !fs.existsSync(destItemPath);

      if (isBinaryFile(item.name)) {
        fs.copyFileSync(srcItemPath, destItemPath);
        if (isNewFile) {
          changedFiles.push({ path: destItemPath, status: "added" });
        }
      } else {
        const newContent = fs.readFileSync(srcItemPath, "utf8");
        let oldContent: string | null = null;
        if (!isNewFile) {
          try { oldContent = fs.readFileSync(destItemPath, "utf8"); } catch { /* treat as new */ }
        }

        if (isNewFile) {
          changedFiles.push({ path: destItemPath, status: "added" });
        } else if (oldContent !== newContent) {
          changedFiles.push({ path: destItemPath, status: "modified" });
        }

        fs.writeFileSync(destItemPath, newContent);
      }

      if (!silent && (!addNewFiles || isNewFile)) {
        showSuccess(`Downloaded ${srcItemPath}`);
      }
    } else if (item.isDirectory()) {
      const subChanges = await downloadDirectoryFromAbsolute(
        srcItemPath,
        destItemPath,
        options
      );
      changedFiles.push(...subChanges);
    }
  }

  return changedFiles;
}

/**
 * Download a directory from either pro modules or dist/.
 * Checks pro directory first; falls back to dist/.
 */
export async function downloadDirectoryHybrid(
  distRelativePath: string,
  localPath: string,
  options: Parameters<typeof downloadDirectory>[2] = {}
): Promise<FileChangeResult[]> {
  const proPath = distPathToProPath(distRelativePath);
  if (proPath && fs.existsSync(proPath)) {
    return downloadDirectoryFromAbsolute(proPath, localPath, options);
  }
  return downloadDirectory(distRelativePath, localPath, options);
}

/**
 * Binary file extensions that should be copied as-is without text encoding
 */
const BINARY_EXTENSIONS = new Set([
  ".woff", ".woff2", ".ttf", ".otf", ".eot", // fonts
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg", // images
  ".pdf", ".zip", ".gz", ".tar", ".rar", // archives
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", // media
  ".wasm", // webassembly
  ".glb", ".bin", // 3D models (GLTF binary)
]);

/**
 * Check if a file should be treated as binary based on extension
 */
function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Copy a file from package to local path, preserving binary content
 */
export function copyFileFromPackage(remotePath: string, localPath: string): void {
  const sourcePath = path.join(PACKAGE_ROOT, remotePath);
  fs.copyFileSync(sourcePath, localPath);
}

// ============================================================================
// SELECTIVE DOWNLOAD FUNCTIONS (Task 320c)
// ============================================================================

export function makeExecutable(filePath: string): void {
  try {
    fs.chmodSync(filePath, "755");
  } catch {
    // Windows doesn't support chmod - silently ignore
  }
}

// Helper function to convert relative paths in hooks to absolute paths
// When hostProjectRoot is provided (e.g., running in Docker), use it for hook paths
function convertHooksToAbsolutePaths(
  hooks: Record<string, boolean | HookConfig[] | number | string>,
  projectPath: string,
  hostProjectRoot?: string
): Record<string, boolean | HookConfig[] | number | string> {
  // Guard: if projectPath ends with .claude, strip it to avoid .claude/.claude duplication
  // This happens when users accidentally run commands from inside the .claude directory
  let normalizedProjectPath = hostProjectRoot ?? projectPath;
  if (normalizedProjectPath.endsWith("/.claude") || normalizedProjectPath.endsWith(String.raw`\.claude`)) {
    normalizedProjectPath = normalizedProjectPath.slice(0, -7); // Remove "/.claude" or "\.claude"
  }

  const convertedHooks: Record<string, boolean | HookConfig[] | number | string> = {};

  for (const [hookType, hookConfigs] of Object.entries(hooks)) {
    if (!Array.isArray(hookConfigs)) {
      convertedHooks[hookType] = hookConfigs;
      continue;
    }

    convertedHooks[hookType] = hookConfigs.map((config: HookConfig) => {
      if (!config.hooks || !Array.isArray(config.hooks)) {
        return config;
      }

      const updatedConfig = { ...config };
      updatedConfig.hooks = config.hooks.map((hook) => {

        // Only convert if it starts with a relative .claude/ path
        // Skip if already absolute (contains /.claude/ in the middle)
        if (hook.type === "command" && typeof hook.command === "string" &&
            (hook.command.startsWith(".claude/") || hook.command.startsWith("node .claude/"))) {
          // Convert .claude/ paths to absolute paths
          // Handles both "node .claude/hooks/..." and ".claude/hooks/..." formats
          const command = hook.command;

          // Find the .claude/ portion and extract it
          const claudeIndex = command.indexOf(".claude/");
          if (claudeIndex === -1) return hook;

          const prefix = command.slice(0, claudeIndex).trim(); // e.g., "node" or ""
          const claudePath = command.slice(claudeIndex); // e.g., ".claude/hooks/foo.js arg1 arg2"

          // Split the .claude path from any arguments
          const pathParts = claudePath.split(" ");
          const relativePath = pathParts[0]; // e.g., ".claude/hooks/foo.js"
          const args = pathParts.slice(1).join(" "); // e.g., "arg1 arg2"

          if (relativePath === undefined) return hook;

          // Convert to absolute path
          const absolutePath = path.join(normalizedProjectPath, relativePath);

          // Reconstruct command with absolute path
          let newCommand = prefix ? `${prefix} ${absolutePath}` : absolutePath;
          if (args) {
            newCommand += ` ${args}`;
          }

          return {
            ...hook,
            command: newCommand
          };
        }
        return hook;
      });
      return updatedConfig;
    });
  }
  return convertedHooks;
}

/**
 * Download core files that are always required
 *
 * NOTE: settings.json is handled separately by processSettingsJson() which:
 *   1. Applies hook filtering based on config
 *   2. Converts hook paths to absolute paths
 *   3. Respects skipIfExists to preserve user customizations
 *
 * Legacy files removed:
 *   - agent-rules.json - Deprecated
 *   - skill-rules.json - Deprecated
 *   - routing-registry.json - Deprecated (was for semantic routing recommendations)
 *
 * @param _projectPath - Absolute path to project root (unused but kept for future use)
 * @param silent - Suppress success messages
 */
function downloadCoreFiles(_projectPath: string, silent: boolean): void {
  // Settings handled by processSettingsJson()
  // Legacy files removed: agent-rules.json, skill-rules.json, routing-registry.json
  // agent-skill-config.json removed - skill injection system deprecated
  const coreFiles: string[] = [];

  for (const file of coreFiles) {
    try {
      const content = fetchFile(`dist/templates/.claude/${file}`);
      const destName = file.replace(".template", "");
      const destPath = `.claude/${destName}`;

      // Skip if file already exists (preserve user customizations)
      if (fs.existsSync(destPath)) {
        if (!silent) {
          showInfo(`.claude/${destName} already exists (skipped)`);
        }
        continue;
      }

      fs.writeFileSync(destPath, content);
      if (!silent) {
        showSuccess(`.claude/${destName}`);
      }
    } catch (error) {
      showError(`Failed to download core file ${file}: ${(error as Error).message}`);
      throw error; // Core files are required, so throw
    }
  }
}

/**
 * Download enabled hook categories based on configuration
 * @param hooks - Hook category configuration object
 * @param silent - Suppress success messages
 */
async function downloadEnabledHookCategories(
  hooks: WorkflowConfig["components"]["hooks"],
  silent: boolean
): Promise<void> {
  // Map config keys to hook directory names
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

  for (const [configKey, dirName] of Object.entries(hookCategoryMap)) {
    if (hooks[configKey as keyof typeof hooks]) {
      const sourcePath = `dist/templates/.claude/hooks/${dirName}`;
      const fullSourcePath = path.join(PACKAGE_ROOT, sourcePath);

      // Skip if hook category doesn't exist in dist (pro-only hooks downloaded separately)
      if (!fs.existsSync(fullSourcePath)) {
        continue;
      }

      try {
        await downloadDirectory(
          sourcePath,
          `.claude/hooks/${dirName}`,
          { silent }
        );
        if (!silent) {
          showSuccess(`Hooks: ${dirName}`);
        }
      } catch {
        showWarning(`Hook category not found: ${dirName} (skipping)`);
      }
    }
  }
}

/** Recursively copy a directory tree, skipping generated artifacts */
function copyDirRecursive(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__" || entry.name === "node_modules") continue;
      copyDirRecursive(src, dest);
    } else {
      if (entry.name.endsWith(".pyc")) continue;
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * Download selected agents from configuration
 * @param agentIds - Array of agent IDs to download
 * @param config - Workflow configuration (uses effective code quality: selected OR detected)
 * @param silent - Suppress success messages
 */
function downloadSelectedAgents(
  agentIds: string[],
  config: WorkflowConfig,
  silent: boolean
): void {
  // Always create the agents directory, even if no agents are selected
  fs.mkdirSync(".claude/agents", { recursive: true });

  if (agentIds.length === 0) {
    if (!silent) {
      showInfo("No agents selected - skipping agent download");
    }
    return;
  }

  // Use effective code quality (selected OR detected in project)
  const effectiveCodeQuality = getEffectiveCodeQuality(config);

  for (const agentId of agentIds) {
    const dest = `.claude/agents/${agentId}.md`;

    // Resolve source: free agents from dist/templates, pro agents from ~/.claude-workflow/pro-modules
    const resolvedPath = resolveComponentSourceWithLicenseCheck("agent", agentId);
    if (!resolvedPath) {
      // Pro agent not downloaded or license expired — skip silently
      continue;
    }

    try {
      const content = fs.readFileSync(resolvedPath, "utf8");

      // Process conditional markers using effective code quality
      const processed = processAgentContent(content, effectiveCodeQuality);

      fs.writeFileSync(dest, processed);
      if (!silent) {
        showSuccess(`Agent: ${agentId}`);
      }
    } catch {
      // Unexpected error reading agent file
      showWarning(`Could not read agent: ${agentId} (skipping)`);
    }
  }
}

/**
 * Download selected skills from configuration
 * @param skillIds - Array of skill IDs to download
 * @param silent - Suppress success messages
 */
async function downloadSelectedSkills(skillIds: string[], silent: boolean): Promise<void> {
  if (skillIds.length === 0) {
    if (!silent) {
      showInfo("No skills selected - skipping skill download");
    }
    return;
  }

  fs.mkdirSync(".claude/skills", { recursive: true });

  for (const skillId of skillIds) {
    // Resolve source: free skills from dist/templates, pro skills from ~/.claude-workflow/pro-modules
    const resolvedPath = resolveComponentSourceWithLicenseCheck("skill", skillId);
    if (!resolvedPath) {
      // Pro skill not downloaded or license expired — skip silently
      continue;
    }

    try {
      const destDir = `.claude/skills/${skillId}`;
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        copyDirRecursive(resolvedPath, destDir);
      } else {
        // Fallback: try downloadDirectory from dist/templates (free skill)
        await downloadDirectory(
          `dist/templates/.claude/skills/${skillId}`,
          destDir,
          { silent }
        );
      }
      if (!silent) {
        showSuccess(`Skill: ${skillId}`);
      }
    } catch {
      showWarning(`Skill not found: ${skillId} (skipping)`);
    }
  }
}

/**
 * Download only selected workflow YAML files
 */
async function downloadSelectedWorkflows(
  workflowIds: string[],
  silent: boolean
): Promise<void> {
  if (workflowIds.length === 0) {
    if (!silent) {
      showInfo("No workflows selected - skipping workflow download");
    }
    return;
  }

  for (const workflowId of workflowIds) {
    const dest = `.claude/workflows/${workflowId}.yml`;

    // Resolve source: free workflows from dist/templates, pro from ~/.claude-workflow/pro-modules
    const resolvedPath = resolveComponentSourceWithLicenseCheck("workflow", workflowId);
    if (!resolvedPath) {
      continue;
    }

    try {
      const content = fs.readFileSync(resolvedPath, "utf8");
      fs.writeFileSync(dest, content);
      if (!silent) {
        showSuccess(`Workflow: ${workflowId}`);
      }
    } catch {
      showWarning(`Could not read workflow: ${workflowId} (skipping)`);
    }
  }
}

/**
 * Download only selected slash command files
 */
async function downloadSelectedCommands(
  commandIds: string[],
  silent: boolean
): Promise<void> {
  if (commandIds.length === 0) {
    if (!silent) {
      showInfo("No commands selected - skipping command download");
    }
    return;
  }

  for (const commandId of commandIds) {
    const dest = `.claude/commands/${commandId}.md`;

    // Skip if already exists (same as downloadDirectory skipExistingFiles)
    if (fs.existsSync(dest)) {
      continue;
    }

    // Resolve source: free commands from dist/templates, pro from ~/.claude-workflow/pro-modules
    const resolvedPath = resolveComponentSourceWithLicenseCheck("command", commandId);
    if (!resolvedPath) {
      continue;
    }

    try {
      const content = fs.readFileSync(resolvedPath, "utf8");
      fs.writeFileSync(dest, content);
      if (!silent) {
        showSuccess(`Command: ${commandId}`);
      }
    } catch {
      showWarning(`Could not read command: ${commandId} (skipping)`);
    }
  }
}

/**
 * Filter hooks configuration to only include enabled categories
 * @param hooks - Original hooks configuration from settings.template.json
 * @param config - User's workflow configuration
 * @returns Filtered hooks object with only enabled categories
 */
function filterHooksByConfig(
  hooks: Record<string, boolean | HookConfig[] | number | string>,
  config: WorkflowConfig
): Record<string, boolean | HookConfig[] | number | string> {
  const filtered: Record<string, boolean | HookConfig[] | number | string> = {};

  for (const [eventType, hookConfigs] of Object.entries(hooks)) {
    if (!Array.isArray(hookConfigs)) {
      filtered[eventType] = hookConfigs;
      continue;
    }

    filtered[eventType] = hookConfigs.filter((hookConfig: HookConfig) => {
      const firstHook = hookConfig.hooks?.[0];
      const command = firstHook?.command ?? "";

      // Always include core hooks
      if (command.includes("/hooks/core/")) {
        return true;
      }

      // Check each category
      const categoryChecks = [
        { enabled: config.components.hooks.compliance, path: "/hooks/compliance/" },
        { enabled: config.components.hooks.integrations, path: "/hooks/integrations/" },
        { enabled: config.components.hooks.orchestration, path: "/hooks/orchestration/" },
        { enabled: config.components.hooks.proactive, path: "/hooks/proactive/" },
        { enabled: config.components.hooks.quality, path: "/hooks/quality/" },
        { enabled: config.components.hooks.recovery, path: "/hooks/recovery/" },
        { enabled: config.components.hooks.taskWorkflow, path: "/hooks/task-workflow/" },
        { enabled: config.components.hooks.tracking, path: "/hooks/tracking/" },
        { enabled: config.components.hooks.videoWorkflow, path: "/hooks/video-workflow/" },
      ];

      for (const check of categoryChecks) {
        if (command.includes(check.path)) {
          return check.enabled;
        }
      }

      // Unknown hook path - include by default (safety)
      return true;
    });

    // Remove event type if no hooks remain
    const filteredArray = filtered[eventType];
    if (Array.isArray(filteredArray) && filteredArray.length === 0) {
       
      delete filtered[eventType];
    }
  }

  return filtered;
}

/**
 * Process settings.json template and write configured version
 * - Filters hooks based on enabled categories
 * - Converts hook paths to absolute paths
 * - Respects skipIfExists: does NOT overwrite existing settings.json
 * @param config - User's workflow configuration
 * @param projectPath - Absolute path to project root
 * @param silent - Suppress success messages
 */
function processSettingsJson(
  config: WorkflowConfig,
  projectPath: string,
  silent: boolean
): void {
  const settingsPath = ".claude/settings.json";

  // Skip if settings.json already exists (preserve user customizations)
  if (fs.existsSync(settingsPath)) {
    if (!silent) {
      showInfo(".claude/settings.json already exists (skipped)");
    }
    return;
  }

  try {
    const templateContent = fetchFile("dist/templates/.claude/settings.template.json");
    const settings = JSON.parse(templateContent) as SettingsJson;

    // Filter hooks based on enabled categories
    settings.hooks = filterHooksByConfig(settings.hooks, config);

    // Convert hook paths to absolute
    settings.hooks = convertHooksToAbsolutePaths(settings.hooks, projectPath);

    // Write settings.json
    const settingsJson = JSON.stringify(settings, undefined, JSON_INDENT_SPACES);
    fs.writeFileSync(settingsPath, settingsJson);

    if (!silent) {
      showSuccess(".claude/settings.json (filtered)");
    }
  } catch (error) {
    showError(`Failed to process settings.json: ${(error as Error).message}`);
    throw error; // Settings.json is required
  }
}