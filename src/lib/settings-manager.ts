
import * as fs from "node:fs";
import * as path from "node:path";

// Import path resolver for monorepo support
import { resolveProjectRoot } from "../templates/.claude/hooks/core/path-resolver.js";
import { fetchFile } from "./file-operations.js";
import { showSuccess } from "./ui.js";

const JSON_INDENT_SPACES = 2;

type JsonArray = JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

interface Settings {
  [key: string]: JsonValue | Record<string, SettingsHookConfig[]> | SettingsPermissions | undefined;
  hooks?: Record<string, SettingsHookConfig[]>;
  permissions?: SettingsPermissions;
}

interface SettingsHook {
  command: string;
  type: string;
}

interface SettingsHookConfig {
  hooks?: SettingsHook[];
}

interface SettingsPermissions {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

export function updateSettings(): void {
  const templateContent = fetchFile("dist/templates/.claude/settings.template.json");

  // Use project root for monorepo support instead of process.cwd()
  // This is where the actual .claude directory exists (container path in Docker)
  const actualProjectPath = resolveProjectRoot();
  const settingsPath = path.join(actualProjectPath, ".claude", "settings.json");

  // When running inside Docker, use the host project root for hook paths
  // Priority: 1) HOST_PATH_FOR_SETTINGS env var, 2) _hostProjectRoot from config, 3) current path
  let configHostPath: string | undefined;
  try {
    const configPath = path.join(actualProjectPath, ".claude", "workflow-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { _hostProjectRoot?: string };
      configHostPath = config._hostProjectRoot;
    }
  } catch {
    // Config read failed, will use fallback
  }
  const hostPathForHooks = process.env.HOST_PATH_FOR_SETTINGS ?? configHostPath ?? actualProjectPath;

  fs.mkdirSync(path.join(actualProjectPath, ".claude"), { recursive: true });

  // Check if file exists
  const exists = fs.existsSync(settingsPath);

  if (!exists) {
    // If file doesn't exist, parse template and convert paths before writing
    const templateSettings = JSON.parse(templateContent) as Settings;
    templateSettings.hooks = convertHooksToAbsolutePaths(templateSettings.hooks, hostPathForHooks);
    fs.writeFileSync(settingsPath, JSON.stringify(templateSettings, undefined, JSON_INDENT_SPACES));
    showSuccess("Created .claude/settings.json with absolute paths");
    return;
  }

  // Parse both template and current settings
  const templateSettings = JSON.parse(templateContent) as Settings;
  const currentSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Settings;

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

    const uniquePermissions = new Set(
      migratedPermissions.filter(perm => !invalidPermissions.has(perm))
    );
    return [...uniquePermissions];
  };

  // Convert hooks to absolute paths using host path (for Claude Code on host machine)
  const convertedTemplateHooks = convertHooksToAbsolutePaths(templateSettings.hooks, hostPathForHooks);
  // Also convert current hooks to ensure they use host paths (fixes Docker/container path mixing)
  const convertedCurrentHooks = convertHooksToAbsolutePaths(currentSettings.hooks, hostPathForHooks);

  // Merge hooks - append any missing hooks from template to current
  // Pass actualProjectPath for file existence checks (different from hostPathForHooks in Docker)
  const mergedHooks = mergeHooks(convertedTemplateHooks, convertedCurrentHooks, actualProjectPath);

  // Create merged settings object
  const mergedSettings = {
    ...templateSettings, // Start with template as base
    ...currentSettings,  // Overlay with current settings (preserves custom fields)
    // Use merged hooks with missing template hooks appended
    hooks: mergedHooks,
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
    }
  };

  // Write merged settings
  fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, undefined, JSON_INDENT_SPACES));
  showSuccess("Updated .claude/settings.json with latest permissions and absolute paths");
}

// Helper function to convert relative paths in hooks to absolute paths
// Uses a wrapper script that dynamically resolves project root at runtime
function convertHooksToAbsolutePaths(
  hooks: Record<string, SettingsHookConfig[]> | undefined,
  projectPath: string
): Record<string, SettingsHookConfig[]> | undefined {
  if (hooks === undefined) {
    return undefined;
  }

  const convertedHooks: Record<string, SettingsHookConfig[]> = {};
  for (const [hookType, hookConfigs] of Object.entries(hooks)) {
    convertedHooks[hookType] = hookConfigs.map((config: SettingsHookConfig) => {
      if (config.hooks !== undefined) {
        config.hooks = config.hooks.map((hook: SettingsHook) => {
          if (hook.type !== "command") {
            return hook;
          }

          const cmd = hook.command;

          // Extract optional env var prefix (e.g. "CLAUDE_HOOK_EVENT_NAME=Stop ")
          const envPrefixMatch = cmd.match(/^((?:[A-Z_]+=\S+\s+)+)/);
          const envPrefix = envPrefixMatch ? envPrefixMatch[1] : "";
          const cmdWithoutEnv = envPrefix ? cmd.slice(envPrefix.length) : cmd;

          // Check if the remaining command references a .claude/ path
          if (
            cmdWithoutEnv.startsWith(".claude/") ||
            cmdWithoutEnv.startsWith("node .claude/")
          ) {
            // Strip "node " if present to get just the script path
            const scriptPath = cmdWithoutEnv.startsWith("node ")
              ? cmdWithoutEnv.slice(5)
              : cmdWithoutEnv;

            // Skip if already an absolute path
            if (scriptPath.startsWith("/")) {
              return hook;
            }

            // Convert .claude/... to absolute path
            const scriptName = scriptPath.startsWith(".claude/")
              ? scriptPath.slice(".claude/".length)
              : scriptPath;
            const parts = scriptName.split(" ");
            const scriptFile = parts[0];
            const scriptArgs = parts.slice(1).join(" ");

            if (scriptFile !== undefined && scriptFile.length > 0) {
              const absolutePath = path.join(projectPath, ".claude", scriptFile);
              // Always include "node " prefix since these are .js files
              const resolvedCmd = scriptArgs.length > 0
                ? `node ${absolutePath} ${scriptArgs}`
                : `node ${absolutePath}`;
              hook.command = `${envPrefix}${resolvedCmd}`;
            }
          }
          return hook;
        });
      }
      return config;
    });
  }
  return convertedHooks;
}

/**
 * Extract the script filename from a hook command for comparison
 * e.g., "node /path/to/.claude/hooks/core/foo.js" -> "hooks/core/foo.js"
 */
function extractHookScriptName(command: string): string {
  // Strip env var prefix if present (e.g. "CLAUDE_HOOK_EVENT_NAME=Stop ")
  const envPrefixMatch = command.match(/^((?:[A-Z_]+=\S+\s+)+)/);
  let scriptPath = envPrefixMatch ? command.slice(envPrefixMatch[1].length) : command;

  // Remove "node " prefix if present
  if (scriptPath.startsWith("node ")) {
    scriptPath = scriptPath.slice(5);
  }

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
 * Remove hooks that reference non-existent script files.
 * This cleans up obsolete hooks when hook files are deleted from the template.
 *
 * @param hooks - The hooks to clean up
 * @param actualProjectPath - The actual filesystem path where .claude directory exists
 *                           (container path when in Docker, host path otherwise)
 */
function removeObsoleteHooks(
  hooks: Record<string, SettingsHookConfig[]> | undefined,
  actualProjectPath: string
): Record<string, SettingsHookConfig[]> | undefined {
  if (hooks === undefined) {
    return undefined;
  }

  let removedCount = 0;
  const cleanedHooks: Record<string, SettingsHookConfig[]> = {};

  for (const [hookType, hookConfigs] of Object.entries(hooks)) {
    cleanedHooks[hookType] = hookConfigs.map((config: SettingsHookConfig) => {
      if (config.hooks === undefined) {
        return config;
      }

      const validHooks = config.hooks.filter((hook: SettingsHook) => {
        if (hook.type !== "command") {
          return true;
        }

        // Extract the script name (relative to .claude/)
        const scriptName = extractHookScriptName(hook.command);

        // Check if it's a .claude hook path
        if (!hook.command.includes(".claude/")) {
          return true; // Keep non-.claude hooks
        }

        // Check if the file exists using actual project path
        // (handles Docker scenario where hooks have host paths but we need to check container filesystem)
        const actualScriptPath = path.join(actualProjectPath, ".claude", scriptName);
        const exists = fs.existsSync(actualScriptPath);
        if (!exists) {
          console.log(`  - Removed obsolete hook: ${scriptName}`);
          removedCount++;
          return false;
        }

        return true;
      });

      return { ...config, hooks: validHooks };
    }).filter((config: SettingsHookConfig) =>
      // Remove configs with empty hooks arrays
      config.hooks === undefined || config.hooks.length > 0
    );
  }

  if (removedCount > 0) {
    console.log(`Removed ${removedCount} obsolete hook(s) referencing deleted files`);
  }

  return cleanedHooks;
}

/**
 * Merge hooks from template into current settings, appending any missing hooks.
 * Missing hooks are identified by their script filename (ignoring path prefix).
 *
 * @param templateHooks - Hooks from template (already converted to host paths)
 * @param currentHooks - Hooks from current settings (already converted to host paths)
 * @param actualProjectPath - The actual filesystem path for checking if files exist
 */
function mergeHooks(
  templateHooks: Record<string, SettingsHookConfig[]> | undefined,
  currentHooks: Record<string, SettingsHookConfig[]> | undefined,
  actualProjectPath: string
): Record<string, SettingsHookConfig[]> | undefined {
  // If no template hooks, just return current
  if (templateHooks === undefined) {
    return currentHooks;
  }

  // If no current hooks, return template hooks
  if (currentHooks === undefined) {
    return templateHooks;
  }

  // First, remove obsolete hooks from current settings
  const cleanedCurrentHooks = removeObsoleteHooks(currentHooks, actualProjectPath);
  if (cleanedCurrentHooks === undefined) {
    return templateHooks;
  }

  // Remove hook types from current that don't exist in the template.
  // This cleans up invalid/deprecated hook event keys (e.g. PostCompact)
  // that Claude Code would reject, causing the entire settings file to be skipped.
  const templateHookTypes = new Set(Object.keys(templateHooks));
  const mergedHooks: Record<string, SettingsHookConfig[]> = {};
  let removedTypeCount = 0;
  for (const [hookType, configs] of Object.entries(cleanedCurrentHooks)) {
    if (templateHookTypes.has(hookType)) {
      mergedHooks[hookType] = configs;
    } else {
      console.log(`  - Removed invalid hook type: ${hookType}`);
      removedTypeCount++;
    }
  }
  if (removedTypeCount > 0) {
    console.log(`Removed ${removedTypeCount} invalid hook type(s) not in template`);
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
      if (config.hooks !== undefined) {
        for (const hook of config.hooks) {
          if (hook.type === "command") {
            existingScriptNames.add(extractHookScriptName(hook.command));
          }
        }
      }
    }

    // Find missing hooks from template
    for (const templateConfig of templateConfigs) {
      if (templateConfig.hooks === undefined) continue;

      for (const templateHook of templateConfig.hooks) {
        if (templateHook.type !== "command") continue;

        const scriptName = extractHookScriptName(templateHook.command);

        // Check if this hook is missing from current settings
        if (!existingScriptNames.has(scriptName)) {
          // Find the first config with a hooks array, or create one
          let targetConfig = mergedHooks[hookType].find(c => c.hooks !== undefined);
          if (targetConfig === undefined) {
            targetConfig = { hooks: [] };
            mergedHooks[hookType].push(targetConfig);
          }

          // Add the missing hook with absolute path
          targetConfig.hooks?.push({
            ...templateHook,
            command: templateHook.command // Already converted to absolute path
          });

          existingScriptNames.add(scriptName);
          addedCount++;
          console.log(`  + Added missing hook: ${scriptName}`);
        }
      }
    }
  }

  if (addedCount > 0) {
    console.log(`Added ${addedCount} missing hook(s) from template`);
  }

  return mergedHooks;
}