#!/usr/bin/env node

// Clean SIGINT handler -- must be registered BEFORE @clack/prompts.
// When Ctrl+C is pressed during a clack interactive prompt, clack tries to
// re-render its Unicode symbols (◆, ●) during cleanup. If the process exits
// mid-render, partial UTF-8 bytes appear as garbled characters (â instead of ◆).
// This handler intercepts SIGINT first, restores cursor visibility, and exits
// cleanly before clack can produce garbled output.
process.on("SIGINT", () => {
  // Show cursor (clack hides it during prompts) + move to new line
  process.stdout.write("\u001B[?25h\n");
  process.exit(130); // Standard SIGINT exit code (128 + 2)
});

// Patch picocolors BEFORE any other imports to override clack spinner colors
import pc from "picocolors";

// Define proper type for picocolors color functions
type ColorFunction = (str: string) => string;

interface PicocolorsWithColors {
  cyan: ColorFunction;
  green: ColorFunction;
  magenta: ColorFunction;
  red: ColorFunction;
}

// Type-safe patching of picocolors
const colors = pc as PicocolorsWithColors;
colors.cyan = (str: string): string => colors.red(str);
colors.green = (str: string): string => colors.red(str);
colors.magenta = (str: string): string => colors.red(str);

import chalk from "chalk";

import { scaffold } from "./commands/scaffold.js";
import { updateTemplates } from "./commands/update.js";
import { uninstall } from "./commands/uninstall.js";
import { draft } from "./commands/draft.js";
import { generateAgentHashes } from "./commands/generate-agent-hashes.js";
import { goal } from "./commands/goal.js";
import { run } from "./commands/run.js";
import { features as featuresCommand } from "./commands/features.js";
import { activate, PURCHASE_URL } from "./commands/activate.js";
import { pro } from "./commands/pro.js";
import { getLicenseInfo } from "./license-manager.js";
import type { PermissionPreset } from "./utils/permissions.js";

interface CLIOptions {
  features?: string[];
  force?: boolean;
  permissions?: PermissionPreset;
  reconfigureTools?: boolean;
  removeBacklog?: boolean;
  removeConfig?: boolean;
  tailwind?: boolean;
  test?: boolean;
  verbose?: boolean;
  withMcpProxy?: boolean;
}

// Gate pro-only commands behind license check
function requireProTier(command: string): void {
  const info = getLicenseInfo();
  if (info.tier === "free") {
    console.error(chalk.red(`  The '${command}' command requires a Pro subscription.`));
    console.error();
    console.error(chalk.dim(`  Purchase at: ${PURCHASE_URL}`));
    console.error(chalk.dim("  Already have a key? Run: claude-workflow activate <key>"));
    process.exit(1);
  }
}

// Helper function for error handling
function formatError(error: Error | string | { message: string }): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  // At this point, error must be { message: string }
  return error.message;
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }

    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    }

    if (arg === "--force") {
      options.force = true;
    }

    if (arg === "--test") {
      options.test = true;
    }

    if (arg === "--reconfigure-tools") {
      options.reconfigureTools = true;
    }

    if (arg === "--remove-config") {
      options.removeConfig = true;
    }

    if (arg === "--remove-backlog") {
      options.removeBacklog = true;
    }

    if (arg === "--with-mcp-proxy") {
      options.withMcpProxy = true;
    }

    if (arg === "--skip-mcp-proxy") {
      options.withMcpProxy = false;
    }

    if (arg === "--tailwind") {
      options.tailwind = true;
    }

    if (arg === "--no-tailwind") {
      options.tailwind = false;
    }

    if (arg === "--features" && i + 1 < args.length) {
      options.features = args[++i].split(",").map((f) => f.trim());
    }

    if (arg.startsWith("--permissions=")) {
      const value = arg.split("=")[1];
      if (value === "yolo" || value === "supervised" || value === "strict") {
        options.permissions = value;
      } else {
        console.error(chalk.red(`Invalid permissions preset: ${value}`));
        console.error("Valid options: yolo, supervised, strict");
        process.exit(1);
      }
    }
  }

  return options;
}

function showHelp(): void {
  console.log(chalk.bold("claude-workflow - Claude Code project scaffolding & management"));
  console.log();
  console.log(chalk.bold("Commands:"));
  console.log("  claude-workflow init [options]                Initialize a new project");
  console.log("  claude-workflow update [options]              Update Claude Code components");
  console.log("  claude-workflow uninstall [options]           Remove from project registry");
  console.log("  claude-workflow features [subcommand]         Manage feature toggles");
  console.log("  claude-workflow draft <name> [--type <type>]   Create a workflow brief template");
  console.log("  claude-workflow goal <text> [options]          Run a goal across multiple sessions");
  console.log("  claude-workflow activate <key> [options]       Activate a license key");
  console.log("  claude-workflow pro <subcommand>              Pro module lifecycle management");
  console.log("  claude-workflow generate-agent-hashes [opts]  Generate agent hash registry");
  console.log();
  console.log(chalk.bold("Init Options:"));
  console.log("  --features <list>    Comma-separated feature groups to enable (e.g. core,qa,lint)");
  console.log("  --permissions=<preset> Permission preset: yolo, supervised (default), strict");
  console.log("  --tailwind           Enable Tailwind CSS v4 mode with design token enforcement");
  console.log("  --no-tailwind        Use semantic CSS mode (default)");
  console.log("  --with-mcp-proxy     Enable mcp-proxy setup (overrides CI mode)");
  console.log("  --skip-mcp-proxy     Skip mcp-proxy setup");
  console.log();
  console.log(chalk.bold("Features Subcommands:"));
  console.log("  features list                    Show all features and their status");
  console.log("  features enable <feature,...>     Enable features and redeploy");
  console.log("  features disable <feature,...>    Disable features and redeploy");
  console.log("  features reset                   Reset to default features");
  console.log();
  console.log(chalk.bold("Pro Subcommands:"));
  console.log("  pro activate <key> [--force]     Activate license and download pro modules");
  console.log("  pro status                       Show pro module status and license info");
  console.log("  pro update [--force]             Check for and install pro module updates");
  console.log();
  console.log(chalk.bold("Update Options:"));
  console.log("  --force              Force overwrite existing files");
  console.log("  --test               Test update without applying changes");
  console.log("  --reconfigure-tools  Reconfigure code quality tools");
  console.log("  --verbose, -v        Show detailed output");
  console.log();
  console.log(chalk.bold("Uninstall Options:"));
  console.log("  --remove-config      Also remove .claude directory");
  console.log("  --remove-backlog     Also remove backlog directory");
  console.log("  --force              Skip confirmation prompts");
  console.log();
  console.log(chalk.bold("Draft Options:"));
  console.log("  --type <type>        Brief type: feature (default), qa, ui, lint, video");
  console.log();
  console.log(chalk.bold("Goal Options:"));
  console.log("  --max-attempts <n>   Max claude -p attempts (default: 10)");
  console.log("  --timeout <dur>      Timeout: 2h, 30m, 3600s (default: 1h)");
  console.log("  --model <model>      Claude model to use");
  console.log("  --file <path>        Read goal text from file");
  console.log("  --status             Show current goal progress");
  console.log("  --abort              Stop current goal");
  console.log("  --resume             Resume last incomplete goal");
  console.log();
  console.log(chalk.bold("Global Options:"));
  console.log("  --help, -h           Show this help message");
}

// Main CLI logic
const ARGV_COMMAND_OFFSET = 2; // Skip 'node' and script path
const args = process.argv.slice(ARGV_COMMAND_OFFSET);
const command = args[0];

// Handle help flags before command parsing
if (command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

// Main async handler
async function main(): Promise<void> {
  try {
    switch (command) {
    case "init": {
      const cliOptions = parseArgs(args.slice(1));
      await scaffold({
        features: cliOptions.features,
        permissions: cliOptions.permissions,
        tailwind: cliOptions.tailwind,
        withMcpProxy: cliOptions.withMcpProxy,
      });
      break;
    }
    case "update": {
      const options = parseArgs(args.slice(1));
      await updateTemplates(options);
      break;
    }
    case "uninstall": {
      const options = parseArgs(args.slice(1));
      await uninstall(process.cwd(), {
        force: options.force,
        removeBacklog: options.removeBacklog,
        removeConfig: options.removeConfig,
      });
      break;
    }
    case "generate-agent-hashes": {
      const hashArgs = args.slice(1);
      const hashOptions: { agentsDir?: string; dryRun?: boolean; help?: boolean; output?: string } = {};
      for (let i = 0; i < hashArgs.length; i++) {
        if (hashArgs[i] === "--help" || hashArgs[i] === "-h") {
          hashOptions.help = true;
        } else if (hashArgs[i] === "--dry-run") {
          hashOptions.dryRun = true;
        } else if (hashArgs[i] === "--output" && hashArgs[i + 1]) {
          hashOptions.output = hashArgs[++i];
        } else if (hashArgs[i] === "--agents-dir" && hashArgs[i + 1]) {
          hashOptions.agentsDir = hashArgs[++i];
        }
      }
      generateAgentHashes(hashOptions);
      break;
    }
    case "draft": {
      const draftArgs = args.slice(1);
      let draftType: string | undefined;
      const nameWords: string[] = [];
      for (let i = 0; i < draftArgs.length; i++) {
        if (draftArgs[i] === "--type" && i + 1 < draftArgs.length) {
          draftType = draftArgs[i + 1];
          i++; // skip value
        } else if (!draftArgs[i].startsWith("--")) {
          nameWords.push(draftArgs[i]);
        }
      }
      await draft({ name: nameWords.join(" ") || undefined, type: draftType });
      break;
    }
    case "goal": {
      requireProTier("goal");
      await goal(args.slice(1));
      break;
    }
    case "run": {
      requireProTier("run");
      await run(args.slice(1));
      break;
    }
    case "features": {
      await featuresCommand(args.slice(1));
      break;
    }
    case "activate": {
      await activate(args.slice(1));
      break;
    }
    case "pro": {
      await pro(args.slice(1));
      break;
    }
    default: {
      console.error(chalk.red("Unknown command:"), command);
      console.error("Use 'claude-workflow init' to initialize a project");
      console.error("Use 'claude-workflow update' to update components");
      console.error("Use 'claude-workflow uninstall' to remove from registry");
      console.error("Use 'claude-workflow features list' to see available features");
      console.error("Use 'claude-workflow draft <name>' to create a feature brief");
      console.error("Use 'claude-workflow goal <text>' to run a persistent goal loop");
      console.error("Use 'claude-workflow run <workflow> <description>' to run a workflow headlessly");
      console.error("Use 'claude-workflow activate <key>' to activate a license");
      console.error("Use 'claude-workflow pro <subcommand>' to manage pro modules");
      console.error("Use 'claude-workflow generate-agent-hashes' to regenerate agent hashes");
      console.error("Use 'claude-workflow --help' for usage information");
      process.exit(1);
    }
    }
  } catch (error) {
    console.error(chalk.red("Error:"), formatError(error as Error | string | { message: string }));
    process.exit(1);
  }
}

// Execute main function with top-level await
await main();
