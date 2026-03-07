/**
 * Activate Command - CLI handler for license key activation
 *
 * Usage:
 *   claude-workflow activate <key>          Activate a new license key
 *   claude-workflow activate --refresh      Refresh existing license JWT
 *   claude-workflow activate --sync         Download/update pro modules
 *   claude-workflow activate --deactivate   Remove license and revert to free tier
 *   claude-workflow activate --status       Show current license status
 *
 * @module commands/activate
 */

import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

import {
  activateLicense,
  getMachineFingerprint,
  LICENSE_PATH,
  refreshLicense,
} from "../license-manager.js";
import type { ActivationResult } from "../license-manager.js";
import { FEATURE_GROUPS } from "../feature-registry.js";

// ============================================================================
// Constants
// ============================================================================

export const LICENSE_KEY_PREFIX = "CW_";
export const PURCHASE_URL = "https://polar.sh/claude-workflow";

// ============================================================================
// Types
// ============================================================================

interface ActivateOptions {
  deactivate?: boolean;
  key?: string;
  refresh?: boolean;
  status?: boolean;
  sync?: boolean;
}

// ============================================================================
// Arg Parsing
// ============================================================================

function parseActivateArgs(args: string[]): ActivateOptions {
  const options: ActivateOptions = {};

  for (const arg of args) {
    switch (arg) {
    case "--refresh": {
      options.refresh = true;
      break;
    }
    case "--deactivate": {
      options.deactivate = true;
      break;
    }
    case "--status": {
      options.status = true;
      break;
    }
    case "--sync": {
      options.sync = true;
      break;
    }
    default: {
      if (!arg.startsWith("--")) {
        options.key = arg;
      }
      break;
    }
    }
  }

  return options;
}

// ============================================================================
// Key Validation
// ============================================================================

export function isValidKeyFormat(key: string): boolean {
  return key.startsWith(LICENSE_KEY_PREFIX) && key.length > LICENSE_KEY_PREFIX.length;
}

// ============================================================================
// Display Helpers
// ============================================================================

function displayActivationSuccess(result: ActivationResult): void {
  console.log();
  console.log(chalk.green.bold("  License activated successfully!"));
  console.log();
  console.log(`  ${chalk.bold("Tier:")}       ${chalk.cyan(result.tier.toUpperCase())}`);
  console.log(`  ${chalk.bold("Machine:")}    ${chalk.dim(getMachineFingerprint())}`);
  console.log(`  ${chalk.bold("Expires:")}    ${result.expiresAt.toLocaleDateString()}`);
  console.log();

  if (result.features.length > 0) {
    console.log(chalk.bold("  Unlocked Feature Groups:"));
    console.log();
    for (const featureId of result.features) {
      const group = FEATURE_GROUPS.find((g) => g.id === featureId);
      if (group === undefined) {
        console.log(`    ${chalk.green("+")} ${featureId}`);
      } else {
        console.log(`    ${chalk.green("+")} ${chalk.bold(group.name)} ${chalk.dim(`- ${group.description}`)}`);
      }
    }
    console.log();
  }
}

async function displayLicenseStatus(): Promise<void> {
  console.log();
  console.log(chalk.bold("  License Status"));
  const SEPARATOR_LENGTH = 40;
  console.log(chalk.dim("  " + "=".repeat(SEPARATOR_LENGTH)));
  console.log();

  const machineId = getMachineFingerprint();

  if (!existsSync(LICENSE_PATH)) {
    console.log(`  ${chalk.bold("Tier:")}       ${chalk.cyan("FREE")}`);
    console.log(`  ${chalk.bold("Machine:")}    ${chalk.dim(machineId)}`);
    console.log();
    console.log(chalk.dim(`  No active license. Purchase at:`));
    console.log(chalk.dim(`  ${PURCHASE_URL}`));
    console.log();
    return;
  }

  const token = readFileSync(LICENSE_PATH, "utf8").trim();
  if (!token) {
    console.log(`  ${chalk.bold("Tier:")}       ${chalk.cyan("FREE")}`);
    console.log(`  ${chalk.bold("Machine:")}    ${chalk.dim(machineId)}`);
    console.log();
    console.log(chalk.dim(`  License file is empty. Re-activate with:`));
    console.log(chalk.dim(`  claude-workflow activate <your-license-key>`));
    console.log();
    return;
  }

  try {
    // Decode without verification (for display only; JWT may be expired)
    const { decodeJwt } = await import("jose");
    const payload = decodeJwt(token);

    const tier = (payload as { tier?: string }).tier ?? "unknown";
    const features = (payload as { features?: string[] }).features ?? [];
    const jwtMachineId = (payload as { machineId?: string }).machineId ?? "unknown";
    const exp = payload.exp;
    const iat = payload.iat;

    console.log(`  ${chalk.bold("Tier:")}       ${chalk.cyan(tier.toUpperCase())}`);
    console.log(`  ${chalk.bold("Machine:")}    ${chalk.dim(jwtMachineId)}`);

    if (exp !== undefined) {
      const MS_PER_SECOND = 1000;
      const expiresAt = new Date(exp * MS_PER_SECOND);
      const isExpired = expiresAt < new Date();
      console.log(`  ${chalk.bold("Expires:")}    ${isExpired ? chalk.red(expiresAt.toLocaleDateString() + " (EXPIRED)") : expiresAt.toLocaleDateString()}`);
    }

    if (iat !== undefined) {
      const MS_PER_SECOND = 1000;
      console.log(`  ${chalk.bold("Issued:")}     ${new Date(iat * MS_PER_SECOND).toLocaleDateString()}`);
    }

    // Check machine mismatch
    if (jwtMachineId !== machineId) {
      console.log();
      console.log(chalk.yellow("  Warning: License was activated on a different machine."));
      console.log(chalk.dim(`  Current machine: ${machineId}`));
    }

    if (features.length > 0) {
      console.log();
      console.log(chalk.bold("  Unlocked Features:"));
      for (const featureId of features) {
        const group = FEATURE_GROUPS.find((g) => g.id === featureId);
        const name = group === undefined ? featureId : group.name;
        console.log(`    ${chalk.green("+")} ${name}`);
      }
    }
  } catch {
    console.log(chalk.yellow("  Could not decode license file. It may be corrupted."));
    console.log(chalk.dim(`  Re-activate with: claude-workflow activate <your-license-key>`));
  }

  console.log();
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleActivate(key: string): Promise<void> {
  if (!isValidKeyFormat(key)) {
    console.error(chalk.red(`  Invalid license key format. Keys must start with "${LICENSE_KEY_PREFIX}".`));
    console.error();
    console.error(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
    process.exit(1);
  }

  console.log(chalk.dim("  Validating license key..."));

  const result = await activateLicense(key);

  if (result === null) {
    console.error();
    console.error(chalk.red("  Activation failed."));
    console.error();
    console.error(chalk.dim("  Possible causes:"));
    console.error(chalk.dim("    - Invalid or expired license key"));
    console.error(chalk.dim("    - Network connectivity issue"));
    console.error(chalk.dim("    - License server temporarily unavailable"));
    console.error();
    console.error(chalk.dim("  To retry: claude-workflow activate <key>"));
    console.error(chalk.dim(`  Purchase a license at: ${PURCHASE_URL}`));
    process.exit(1);
  }

  displayActivationSuccess(result);

  // Download pro modules after successful activation
  try {
    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (token) {
      console.log(chalk.dim("  Downloading pro modules..."));
      const { downloadProModules } = await import("../pro-module-manager.js");
      const dlResult = await downloadProModules(token);
      if (dlResult.success) {
        console.log(chalk.green(`  Pro modules downloaded (v${dlResult.version}, ${String(dlResult.fileCount)} files)`));
      } else {
        console.log(chalk.yellow(`  Pro module download skipped: ${dlResult.error ?? "unknown error"}`));
        console.log(chalk.dim("  Run 'claude-workflow activate --sync' to retry later."));
      }
    }
  } catch {
    // Non-fatal: pro module download is best-effort after activation
    console.log(chalk.dim("  Pro module download deferred. Run 'claude-workflow activate --sync' to download."));
  }
}

async function handleRefresh(): Promise<void> {
  if (!existsSync(LICENSE_PATH)) {
    console.error(chalk.red("  No cached license found."));
    console.error();
    console.error(chalk.dim("  Activate a license first:"));
    console.error(chalk.dim("    claude-workflow activate <your-license-key>"));
    process.exit(1);
  }

  console.log(chalk.dim("  Refreshing license..."));

  const result = await refreshLicense();

  if (result === null) {
    console.error();
    console.error(chalk.red("  License refresh failed."));
    console.error();
    console.error(chalk.dim("  Possible causes:"));
    console.error(chalk.dim("    - License expired or revoked"));
    console.error(chalk.dim("    - Network connectivity issue"));
    console.error(chalk.dim("    - License server temporarily unavailable"));
    console.error();
    console.error(chalk.dim("  Try re-activating: claude-workflow activate <your-license-key>"));
    process.exit(1);
  }

  console.log(chalk.green.bold("  License refreshed successfully!"));
  console.log();
  console.log(`  ${chalk.bold("Tier:")}    ${chalk.cyan(result.tier.toUpperCase())}`);
  console.log(`  ${chalk.bold("Expires:")} ${result.expiresAt.toLocaleDateString()}`);
  console.log();
}

async function handleDeactivate(): Promise<void> {
  if (!existsSync(LICENSE_PATH)) {
    console.log(chalk.yellow("  No active license found. Already on free tier."));
    console.log();
    return;
  }

  try {
    unlinkSync(LICENSE_PATH);
    console.log(chalk.green.bold("  License deactivated."));
    console.log(chalk.dim("  Reverted to free tier."));
  } catch {
    console.error(chalk.red("  Failed to remove license file."));
    console.error(chalk.dim(`  Manually delete: ${LICENSE_PATH}`));
    process.exit(1);
  }

  // Clean up pro modules on deactivation
  try {
    const { removeProModules, areProModulesDownloaded } = await import("../pro-module-manager.js");
    if (areProModulesDownloaded()) {
      removeProModules();
      console.log(chalk.dim("  Pro modules removed."));
    }
  } catch {
    // Non-fatal: cleanup failure is not critical
  }

  console.log();
}

async function handleSync(): Promise<void> {
  if (!existsSync(LICENSE_PATH)) {
    console.error(chalk.red("  No active license found."));
    console.error();
    console.error(chalk.dim("  Activate a license first:"));
    console.error(chalk.dim("    claude-workflow activate <your-license-key>"));
    process.exit(1);
  }

  const token = readFileSync(LICENSE_PATH, "utf8").trim();
  if (!token) {
    console.error(chalk.red("  License file is empty. Re-activate with:"));
    console.error(chalk.dim("    claude-workflow activate <your-license-key>"));
    process.exit(1);
  }

  console.log(chalk.dim("  Syncing pro modules..."));

  const { downloadProModules } = await import("../pro-module-manager.js");
  const result = await downloadProModules(token);

  if (result.success) {
    console.log(chalk.green.bold("  Pro modules synced successfully!"));
    console.log(`  ${chalk.bold("Version:")}  ${result.version}`);
    console.log(`  ${chalk.bold("Files:")}    ${String(result.fileCount)}`);
  } else {
    console.error(chalk.red(`  Sync failed: ${result.error ?? "unknown error"}`));
    console.error();
    console.error(chalk.dim("  Possible causes:"));
    console.error(chalk.dim("    - License expired or revoked"));
    console.error(chalk.dim("    - Network connectivity issue"));
    console.error(chalk.dim("    - Pro module server temporarily unavailable"));
    process.exit(1);
  }
  console.log();
}

// ============================================================================
// Main Export
// ============================================================================

export async function activate(args: string[]): Promise<void> {
  const options = parseActivateArgs(args);

  // Handle flags in priority order
  if (options.status === true) {
    await displayLicenseStatus();
    return;
  }

  if (options.deactivate === true) {
    await handleDeactivate();
    return;
  }

  if (options.refresh === true) {
    await handleRefresh();
    return;
  }

  if (options.sync === true) {
    await handleSync();
    return;
  }

  if (options.key !== undefined) {
    await handleActivate(options.key);
    return;
  }

  // No args - show usage
  console.log(chalk.bold("Usage: claude-workflow activate <key> [options]"));
  console.log();
  console.log("  claude-workflow activate CW_XXXXXXXX    Activate a license key");
  console.log("  claude-workflow activate --refresh       Refresh existing license");
  console.log("  claude-workflow activate --sync          Download/update pro modules");
  console.log("  claude-workflow activate --deactivate    Remove license");
  console.log("  claude-workflow activate --status        Show current status");
  console.log();
  console.log(chalk.dim(`Purchase a license at: ${PURCHASE_URL}`));
  process.exit(1);
}
