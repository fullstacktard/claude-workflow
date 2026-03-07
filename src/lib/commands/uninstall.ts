/**
 * Uninstall command for claude-workflow
 *
 * Removes claude-workflow configuration from a project and
 * unregisters it from the global project registry.
 *
 * @module commands/uninstall
 */

import chalk from "chalk";
import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";

import { showHeader } from "../ui.js";
import { getProjectRegistry } from "../services/project-registry.js";

/**
 * Options for the uninstall command
 */
export interface UninstallOptions {
  /** Remove .claude directory and all configuration */
  removeConfig?: boolean;
  /** Remove backlog directory */
  removeBacklog?: boolean;
  /** Skip confirmation prompts */
  force?: boolean;
}

/**
 * Uninstall claude-workflow from a project
 *
 * Removes the project from the global registry and optionally removes
 * configuration files. By default, only unregisters from the registry
 * without removing any files.
 *
 * @param targetDir - Target directory (defaults to current directory)
 * @param options - Uninstall options
 * @returns Promise that resolves when uninstall is complete
 */
export async function uninstall(
  targetDir: string = process.cwd(),
  options: UninstallOptions = {}
): Promise<boolean> {
  const { removeConfig = false, removeBacklog = false, force = false } = options;

  await showHeader();

  const projectPath = path.resolve(targetDir);
  const claudeDir = path.join(projectPath, ".claude");
  const backlogDir = path.join(projectPath, "backlog");

  // Check if this is a claude-workflow project
  const configPath = path.join(claudeDir, "workflow-config.json");
  if (!existsSync(configPath)) {
    console.log(chalk.yellow("This directory is not a claude-workflow project."));
    console.log(chalk.gray(`Expected config file: ${configPath}`));
    return false;
  }

  const projectName = path.basename(projectPath);
  console.log(chalk.gray(`Uninstalling claude-workflow from: ${projectName}`));

  // Unregister from global registry
  try {
    const registry = getProjectRegistry();
    const removed = registry.unregister(projectPath);

    if (removed) {
      console.log(chalk.green("  Removed from global project registry"));
    } else {
      console.log(chalk.gray("  Project was not in registry"));
    }
  } catch (error) {
    console.log(chalk.yellow("  Warning: Could not update registry"));
    console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
  }

  // Optionally remove .claude directory
  if (removeConfig && existsSync(claudeDir)) {
    if (force) {
      try {
        rmSync(claudeDir, { recursive: true, force: true });
        console.log(chalk.green("  Removed .claude directory"));
      } catch (error) {
        console.log(chalk.red("  Failed to remove .claude directory"));
        console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
      }
    } else {
      // In a real implementation, this would use clack prompts
      // For now, require --force to actually remove files
      console.log(chalk.yellow("  Use --force to actually remove files"));
    }
  }

  // Optionally remove backlog directory
  if (removeBacklog && existsSync(backlogDir)) {
    if (force) {
      try {
        rmSync(backlogDir, { recursive: true, force: true });
        console.log(chalk.green("  Removed backlog directory"));
      } catch (error) {
        console.log(chalk.red("  Failed to remove backlog directory"));
        console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
      }
    } else {
      console.log(chalk.yellow("  Use --force to actually remove backlog"));
    }
  }

  console.log();
  console.log(chalk.green("Uninstall complete."));

  if (!removeConfig) {
    console.log(chalk.gray("Configuration files were preserved."));
    console.log(chalk.gray("Use --remove-config to also remove .claude directory."));
  }

  return true;
}
