/**
 * Features command - Manage feature toggles for claude-workflow
 *
 * Subcommands:
 *   list                    Show all features and their status
 *   enable <feature,...>    Enable features and redeploy
 *   disable <feature,...>   Disable features and redeploy
 *   reset                  Reset to default features
 */

import chalk from "chalk";

import {
  FEATURE_GROUPS,
  formatFeatureList,
  getAllFeatureIds,
  getComponentsForFeatures,
  getDefaultFeatures,
  isValidFeature,
  resolveFeatures,
} from "../feature-registry.js";
import { getLicenseInfo, TIER_DISPLAY_NAMES } from "../license-manager.js";
import { loadConfig, saveConfig } from "../utils/config-manager.js";
import { updateTemplates } from "./update.js";

/**
 * Get current enabled features from config, falling back to defaults
 */
function getCurrentFeatures(): string[] {
  const config = loadConfig();
  if (config?.features && config.features.length > 0) {
    return config.features;
  }
  return getDefaultFeatures();
}

export async function features(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
  case "list": {
    await listFeatures();
    break;
  }
  case "enable": {
    const featureArg = args[1];
    if (!featureArg) {
      console.error(
        chalk.red("Usage: claude-workflow features enable <feature,...>")
      );
      console.error(
        `Available: ${getAllFeatureIds().join(", ")}`
      );
      process.exit(1);
    }
    await enableFeatures(featureArg.split(",").map((f) => f.trim()));
    break;
  }
  case "disable": {
    const featureArg = args[1];
    if (!featureArg) {
      console.error(
        chalk.red("Usage: claude-workflow features disable <feature,...>")
      );
      console.error(
        `Available: ${getAllFeatureIds().join(", ")}`
      );
      process.exit(1);
    }
    await disableFeatures(featureArg.split(",").map((f) => f.trim()));
    break;
  }
  case "reset": {
    await resetFeatures();
    break;
  }
  default: {
    if (subcommand) {
      console.error(chalk.red(`Unknown features subcommand: ${subcommand}`));
    }
    console.log(chalk.bold("Usage: claude-workflow features <subcommand>"));
    console.log();
    console.log("  list                    Show all features and their status");
    console.log("  enable <feature,...>     Enable features and redeploy");
    console.log("  disable <feature,...>    Disable features and redeploy");
    console.log("  reset                   Reset to default features");
    console.log();
    console.log(chalk.bold("Available features:"));
    console.log(formatFeatureList(getCurrentFeatures(), getLicenseInfo()));
    if (subcommand) {
      process.exit(1);
    }
  }
  }
}

async function listFeatures(): Promise<void> {
  const enabled = getCurrentFeatures();
  const resolved = resolveFeatures(enabled);
  const components = getComponentsForFeatures(resolved);
  const licenseInfo = getLicenseInfo();

  // Tier and license header
  const tierDisplay = TIER_DISPLAY_NAMES[licenseInfo.tier];
  console.log(chalk.bold(`\nCurrent Tier: ${chalk.green(tierDisplay)}`));

  if (licenseInfo.expiresAt !== null) {
    const expiryDate = new Date(licenseInfo.expiresAt);
    const now = new Date();
    if (expiryDate <= now) {
      console.log(chalk.yellow(`  License expired: ${expiryDate.toLocaleDateString()}`));
    } else {
      console.log(chalk.dim(`  Expires: ${expiryDate.toLocaleDateString()}`));
    }
  } else if (licenseInfo.tier === "free") {
    console.log(chalk.dim("  No license active"));
  }

  console.log(chalk.dim(`  Machine ID: ${licenseInfo.machineId}`));

  if (licenseInfo.licenseKey !== null) {
    console.log(chalk.dim(`  License Key: ${licenseInfo.licenseKey}`));
  }

  // Feature groups with tier tags
  console.log(chalk.bold("\nFeature Groups:\n"));
  console.log(formatFeatureList(enabled, licenseInfo));

  console.log(chalk.bold("\n\nResolved Components:\n"));
  console.log(`  Agents:    ${components.agents.length}`);
  console.log(`  Skills:    ${components.skills.length}`);
  console.log(`  Commands:  ${components.commands.length}`);
  console.log(`  Workflows: ${components.workflows.length}`);

  // Show auto-enabled dependencies
  const autoEnabled = resolved.filter((f) => !enabled.includes(f));
  if (autoEnabled.length > 0) {
    console.log(
      chalk.dim(`\n  Auto-enabled via dependencies: ${autoEnabled.join(", ")}`)
    );
  }

  // Upgrade CTA when user is not on the highest tier
  if (licenseInfo.tier !== "all") {
    console.log();
    console.log(
      chalk.yellow(
        `  Upgrade to unlock all features: ${chalk.underline("https://polar.sh/claude-workflow")}`
      )
    );
  }

  console.log();
}

async function enableFeatures(featureIds: string[]): Promise<void> {
  // Validate all feature IDs
  const invalid = featureIds.filter((f) => !isValidFeature(f));
  if (invalid.length > 0) {
    console.error(chalk.red(`Invalid feature(s): ${invalid.join(", ")}`));
    console.error(`Available: ${getAllFeatureIds().join(", ")}`);
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "No workflow config found. Run 'claude-workflow init' first."
      )
    );
    process.exit(1);
  }

  const current = new Set(getCurrentFeatures());
  for (const f of featureIds) {
    current.add(f);
  }

  const newFeatures = [...current];
  const resolved = resolveFeatures(newFeatures);

  // Check auto-enabled dependencies
  const autoEnabled = resolved.filter((f) => !newFeatures.includes(f));
  if (autoEnabled.length > 0) {
    console.log(
      chalk.yellow(
        `Auto-enabling dependencies: ${autoEnabled.join(", ")}`
      )
    );
  }

  config.features = resolved;
  saveConfig(config);

  console.log(chalk.green(`Enabled: ${featureIds.join(", ")}`));

  // Redeploy with new features
  await redeployComponents(resolved);
}

async function disableFeatures(featureIds: string[]): Promise<void> {
  const invalid = featureIds.filter((f) => !isValidFeature(f));
  if (invalid.length > 0) {
    console.error(chalk.red(`Invalid feature(s): ${invalid.join(", ")}`));
    console.error(`Available: ${getAllFeatureIds().join(", ")}`);
    process.exit(1);
  }

  if (featureIds.includes("core")) {
    console.error(chalk.red("Cannot disable 'core' - it is required."));
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "No workflow config found. Run 'claude-workflow init' first."
      )
    );
    process.exit(1);
  }

  // Check if disabling would break dependencies
  const current = getCurrentFeatures();
  const remaining = current.filter((f) => !featureIds.includes(f));
  for (const group of FEATURE_GROUPS) {
    if (
      remaining.includes(group.id) &&
      group.dependencies.some((dep) => featureIds.includes(dep))
    ) {
      console.error(
        chalk.red(
          `Cannot disable '${group.dependencies.find((dep) => featureIds.includes(dep))}' - required by enabled feature '${group.id}'`
        )
      );
      console.error(
        `Disable '${group.id}' first, or disable both together.`
      );
      process.exit(1);
    }
  }

  const resolved = resolveFeatures(remaining);
  config.features = resolved;
  saveConfig(config);

  console.log(chalk.green(`Disabled: ${featureIds.join(", ")}`));

  // Redeploy with new features
  await redeployComponents(resolved);
}

async function resetFeatures(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "No workflow config found. Run 'claude-workflow init' first."
      )
    );
    process.exit(1);
  }

  const defaults = getDefaultFeatures();
  const resolved = resolveFeatures(defaults);
  config.features = resolved;
  saveConfig(config);

  console.log(chalk.green(`Reset to default features: ${resolved.join(", ")}`));

  await redeployComponents(resolved);
}

/**
 * Redeploy components after feature change by running update
 */
async function redeployComponents(features: string[]): Promise<void> {
  const components = getComponentsForFeatures(features);
  console.log(chalk.dim(`\nRedeploying ${components.agents.length} agents, ${components.skills.length} skills, ${components.commands.length} commands, ${components.workflows.length} workflows...`));

  await updateTemplates({ force: true });

  console.log(chalk.green("Done."));
}
