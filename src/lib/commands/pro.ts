/**
 * Pro Command - CLI handler for pro module lifecycle management
 *
 * Usage:
 *   claude-workflow pro activate <key> [--force]   Activate license and download pro modules
 *   claude-workflow pro status                     Show pro module status and license info
 *   claude-workflow pro update [--force]           Check for and install pro module updates
 *
 * @module commands/pro
 */

import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeLicenseState } from "../license-state.js";

import {
  activateLicense,
  getLicenseInfo,
  LICENSE_PATH,
  TIER_DISPLAY_NAMES,
  TIER_HIERARCHY,
} from "../license-manager.js";
import type { LicenseInfo } from "../license-manager.js";
import { createSpinner, showError, showSuccess, showWarning } from "../ui.js";
import {
  downloadProModules,
  getProModuleVersion,
  areProModulesDownloaded,
  checkProModuleUpdate,
  PRO_MODULES_DIR,
  PRO_CLAUDE_DIR,
} from "../pro-module-manager.js";
import { FEATURE_GROUPS } from "../feature-registry.js";
import { isValidKeyFormat, LICENSE_KEY_PREFIX, PURCHASE_URL } from "./activate.js";

// ============================================================================
// Types
// ============================================================================

interface ProOptions {
  force?: boolean;
  key?: string;
}

// ============================================================================
// Arg Parsing
// ============================================================================

/**
 * Parse pro subcommand arguments.
 * Extracts --force flag and positional key argument.
 */
function parseProArgs(args: string[]): ProOptions {
  const options: ProOptions = {};

  for (const arg of args) {
    if (arg === "--force") {
      options.force = true;
    } else if (!arg.startsWith("--")) {
      options.key = arg;
    }
  }

  return options;
}

// ============================================================================
// Helpers
// ============================================================================

const MS_PER_DAY = 86_400_000;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

/**
 * Recursively calculate the total size of a directory in bytes.
 */
function getDirectorySizeBytes(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        totalSize += statSync(fullPath).size;
      }
    }
  }

  walkDir(dirPath);
  return totalSize;
}

/**
 * Format bytes into a human-readable string (B, KB, MB).
 */
function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${String(bytes)} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * Determine the display string for license state.
 */
function getLicenseState(info: LicenseInfo): string {
  if (info.tier === "free") return chalk.dim("free");
  if (!info.isValid) return chalk.red("expired");

  // Use the real license state machine for accurate state display
  const stateInfo = computeLicenseState();
  switch (stateInfo.state) {
  case "active":
    return chalk.green("active");
  case "grace":
    return chalk.yellow("grace");
  case "expired":
    return chalk.red("expired");
  default:
    return chalk.dim("free");
  }
}

/**
 * Format the days until JWT expiry for display.
 */
function getDaysUntilExpiry(info: LicenseInfo): string {
  if (!info.expiresAt) return chalk.dim("N/A");
  const days = Math.floor(
    (new Date(info.expiresAt).getTime() - Date.now()) / MS_PER_DAY
  );
  if (days < 0) return chalk.red(`${String(Math.abs(days))} days ago`);
  if (days === 0) return chalk.yellow("today");
  return `${String(days)} days`;
}

/**
 * Count pro components across all feature groups that require a paid tier.
 */
function countProComponents(): {
  agents: number;
  skills: number;
  hooks: number;
  commands: number;
  workflows: number;
  } {
  const counts = { agents: 0, skills: 0, hooks: 0, commands: 0, workflows: 0 };

  for (const group of FEATURE_GROUPS) {
    if (TIER_HIERARCHY[group.requiredTier] > TIER_HIERARCHY.free) {
      counts.agents += group.agents.length;
      counts.skills += group.skills.length;
      counts.commands += group.commands.length;
      counts.workflows += group.workflows.length;
    }
  }

  // Count hooks from pro directory if it exists
  const hooksDir = join(PRO_CLAUDE_DIR, "hooks");
  if (existsSync(hooksDir)) {
    const hookEntries = readdirSync(hooksDir, { withFileTypes: true });
    counts.hooks = hookEntries.filter((e) => e.isDirectory() || e.isFile()).length;
  }

  return counts;
}

/**
 * Get the CLI version from package.json.
 * Uses dynamic import to avoid coupling to a specific version constant.
 */
async function getCliVersion(): Promise<string> {
  try {
    const nodePath = await import("node:path");
    const nodeUrl = await import("node:url");

    const __filename_pro = nodeUrl.fileURLToPath(import.meta.url);
    const __dirname_pro = nodePath.dirname(__filename_pro);
    const packageJsonPath = nodePath.join(__dirname_pro, "..", "..", "..", "package.json");
    if (existsSync(packageJsonPath)) {
      const raw = readFileSync(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw) as { version: string };
      return pkg.version;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ============================================================================
// Pro Module Download
// ============================================================================

/**
 * Download pro modules with spinner feedback.
 * Reads the JWT from disk and calls the download API.
 *
 * @param force - If true, re-download even when modules exist
 */
async function downloadProModulesWithProgress(force: boolean): Promise<void> {
  const existing = getProModuleVersion();

  if (existing && !force) {
    showSuccess(`Pro modules already installed (v${existing.version}, ${String(existing.fileCount)} files)`);
    console.log(chalk.dim("  Use --force to re-download."));
    return;
  }

  if (!existsSync(LICENSE_PATH)) {
    showError("No license found. Activate first with: claude-workflow pro activate <key>");
    process.exit(1);
  }

  const jwt = readFileSync(LICENSE_PATH, "utf8").trim();
  if (!jwt) {
    showError("License file is empty. Re-activate with: claude-workflow pro activate <key>");
    process.exit(1);
  }

  const spinner = createSpinner("Downloading pro modules...");
  spinner.start();

  const downloadResult = await downloadProModules(jwt);

  if (!downloadResult.success) {
    spinner.fail("Pro module download failed.");
    console.log();
    console.log(chalk.dim(`  Error: ${downloadResult.error ?? "Unknown error"}`));
    console.log(chalk.dim("  Check your network connection and try again."));
    process.exit(1);
  }

  spinner.succeed(
    `Pro modules installed: v${downloadResult.version} (${String(downloadResult.fileCount)} files)`
  );
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle `claude-workflow pro activate <key>`.
 * Validates the license key, activates with the API, and downloads pro modules.
 */
async function handleProActivate(key: string, force: boolean): Promise<void> {
  if (!isValidKeyFormat(key)) {
    showError(`Invalid license key format. Keys must start with "${LICENSE_KEY_PREFIX}".`);
    console.log();
    console.log(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
    process.exit(1);
  }

  const spinner = createSpinner("Validating license key...");
  spinner.start();

  const result = await activateLicense(key);

  if (result === null) {
    spinner.fail("Activation failed.");
    console.log();
    console.log(chalk.dim("  Possible causes:"));
    console.log(chalk.dim("    - Invalid or expired license key"));
    console.log(chalk.dim("    - Network connectivity issue"));
    console.log(chalk.dim("    - License server temporarily unavailable"));
    console.log();
    console.log(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
    process.exit(1);
  }

  spinner.succeed(`License activated: ${chalk.cyan(TIER_DISPLAY_NAMES[result.tier])} tier`);
  console.log(`  ${chalk.bold("Expires:")}  ${result.expiresAt.toLocaleDateString()}`);
  console.log();

  // Download pro modules after activation
  await downloadProModulesWithProgress(force);
}

/**
 * Handle `claude-workflow pro status`.
 * Displays comprehensive pro module and license status information.
 */
async function handleProStatus(): Promise<void> {
  const SEPARATOR_LENGTH = 50;
  console.log();
  console.log(chalk.bold("  Pro Module Status"));
  console.log(chalk.dim("  " + "=".repeat(SEPARATOR_LENGTH)));
  console.log();

  // License info
  const info = getLicenseInfo();
  const tierDisplay = TIER_DISPLAY_NAMES[info.tier] ?? info.tier;

  console.log(`  ${chalk.bold("License Tier:")}     ${chalk.cyan(tierDisplay.toUpperCase())}`);
  console.log(`  ${chalk.bold("License State:")}    ${getLicenseState(info)}`);

  if (info.expiresAt) {
    const expiryDate = new Date(info.expiresAt).toLocaleDateString();
    const isExpired = new Date(info.expiresAt) < new Date();
    console.log(
      `  ${chalk.bold("Expiry Date:")}      ${isExpired ? chalk.red(expiryDate + " (EXPIRED)") : expiryDate}`
    );
    console.log(`  ${chalk.bold("Days Remaining:")}   ${getDaysUntilExpiry(info)}`);
  }

  if (info.machineId) {
    console.log(`  ${chalk.bold("Machine ID:")}       ${chalk.dim(info.machineId)}`);
  }

  console.log();
  console.log(chalk.dim("  " + "-".repeat(SEPARATOR_LENGTH)));
  console.log();

  // Pro module version info
  const version = getProModuleVersion();

  if (version) {
    console.log(`  ${chalk.bold("Module Version:")}   v${version.version}`);
    console.log(`  ${chalk.bold("Downloaded At:")}    ${new Date(version.downloadedAt).toLocaleDateString()}`);
    console.log(`  ${chalk.bold("Module Tier:")}      ${chalk.cyan((version.tier ?? "unknown").toUpperCase())}`);
    console.log(`  ${chalk.bold("File Count:")}       ${String(version.fileCount)}`);
  } else {
    console.log(`  ${chalk.bold("Module Version:")}   ${chalk.dim("Not installed")}`);
  }

  // Cache info
  console.log(`  ${chalk.bold("Cache Location:")}   ${chalk.dim(PRO_MODULES_DIR)}`);
  const cacheSize = getDirectorySizeBytes(PRO_MODULES_DIR);
  console.log(`  ${chalk.bold("Cache Size:")}       ${formatBytes(cacheSize)}`);

  console.log();
  console.log(chalk.dim("  " + "-".repeat(SEPARATOR_LENGTH)));
  console.log();

  // Component counts
  const counts = countProComponents();
  console.log(chalk.bold("  Pro Components Available:"));
  console.log(`    Agents:      ${String(counts.agents)}`);
  console.log(`    Skills:      ${String(counts.skills)}`);
  console.log(`    Hooks:       ${String(counts.hooks)}`);
  console.log(`    Commands:    ${String(counts.commands)}`);
  console.log(`    Workflows:   ${String(counts.workflows)}`);

  // CLI version
  console.log();
  const cliVersion = await getCliVersion();
  console.log(`  ${chalk.bold("CLI Version:")}      v${cliVersion}`);

  if (!areProModulesDownloaded() && info.tier !== "free") {
    console.log();
    showWarning("Pro modules not downloaded. Run: claude-workflow pro activate <key>");
  }

  console.log();
}

/**
 * Handle `claude-workflow pro update`.
 * Checks for newer pro module version and downloads if available.
 */
async function handleProUpdate(force: boolean): Promise<void> {
  if (!existsSync(LICENSE_PATH)) {
    showError("No license found. Activate first with: claude-workflow pro activate <key>");
    process.exit(1);
  }

  const jwt = readFileSync(LICENSE_PATH, "utf8").trim();
  if (!jwt) {
    showError("License file is empty. Re-activate with: claude-workflow pro activate <key>");
    process.exit(1);
  }

  // Check license validity
  const info = getLicenseInfo();
  if (!info.isValid || info.tier === "free") {
    showError("License is expired or inactive. Refresh with: claude-workflow activate --refresh");
    process.exit(1);
  }

  if (force) {
    console.log(chalk.dim("  Forcing re-download..."));
    console.log();
    await downloadProModulesWithProgress(true);
    return;
  }

  const spinner = createSpinner("Checking for pro module updates...");
  spinner.start();

  const updateCheck = await checkProModuleUpdate(jwt);

  if (!updateCheck.updateAvailable) {
    const currentDisplay = updateCheck.currentVersion
      ? `v${updateCheck.currentVersion}`
      : "none";
    spinner.succeed(`Pro modules are up to date (${currentDisplay})`);
    console.log(chalk.dim("  Use --force to re-download anyway."));
    return;
  }

  spinner.succeed(
    `Update available: ${updateCheck.currentVersion ?? "none"} -> v${updateCheck.latestVersion}`
  );
  console.log();

  await downloadProModulesWithProgress(true);
}

// ============================================================================
// Backward Compatibility Helper
// ============================================================================

/**
 * Called from activate.ts after successful license activation.
 * Downloads pro modules with progress feedback (best-effort, errors are non-fatal).
 */
export async function downloadProModulesAfterActivation(): Promise<void> {
  const info = getLicenseInfo();
  if (info.tier === "free") return; // No pro modules for free tier

  console.log();
  console.log(chalk.dim("  Downloading pro modules..."));

  if (!existsSync(LICENSE_PATH)) return;
  const jwt = readFileSync(LICENSE_PATH, "utf8").trim();
  if (!jwt) return;

  const existing = getProModuleVersion();
  if (existing) {
    showSuccess(`Pro modules already installed (v${existing.version})`);
    return;
  }

  const downloadResult = await downloadProModules(jwt);
  if (downloadResult.success) {
    showSuccess(
      `Pro modules installed: v${downloadResult.version} (${String(downloadResult.fileCount)} files)`
    );
  } else {
    showWarning(`Pro module download failed: ${downloadResult.error ?? "Unknown error"}`);
    console.log(chalk.dim("  Run 'claude-workflow pro update' to retry."));
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Main `pro` command entry point.
 * Routes to the appropriate subcommand handler based on arguments.
 *
 * @param args - CLI arguments after the `pro` command
 */
export async function pro(args: string[]): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);
  const options = parseProArgs(subArgs);

  switch (subcommand) {
  case "activate": {
    if (!options.key) {
      showError("Usage: claude-workflow pro activate <key> [--force]");
      console.log();
      console.log(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
      process.exit(1);
    }
    await handleProActivate(options.key, options.force === true);
    break;
  }
  case "status": {
    await handleProStatus();
    break;
  }
  case "update": {
    await handleProUpdate(options.force === true);
    break;
  }
  default: {
    if (subcommand) {
      console.error(chalk.red(`Unknown pro subcommand: ${subcommand}`));
      console.log();
    }
    console.log(chalk.bold("Usage: claude-workflow pro <subcommand>"));
    console.log();
    console.log("  activate <key> [--force]   Activate license and download pro modules");
    console.log("  status                     Show pro module status and license info");
    console.log("  update [--force]           Check for and install pro module updates");
    console.log();
    console.log(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
    if (subcommand) {
      process.exit(1);
    }
  }
  }
}
