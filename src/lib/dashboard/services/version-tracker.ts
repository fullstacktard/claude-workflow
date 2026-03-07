/**
 * Version Tracker - Detect installed claude-workflow versions in projects
 * @module dashboard/services/version-tracker
 *
 * Detects and compares installed claude-workflow versions across projects
 * to identify which projects need updates.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getPackageVersion } from "../../utils/config-manager.js";

/**
 * Parse a semver version string into numeric array
 * Strips pre-release suffixes for comparison
 *
 * @param v - Version string (e.g., "1.2.3")
 * @returns Array of version parts [major, minor, patch]
 */
export function parseVersion(v: string): number[] {
  const clean = v.replace(/-.*$/, "");
  return clean.split(".").map((n) => Number.parseInt(n, 10) || 0);
}

/**
 * Compare two semver versions
 *
 * Parses version strings (e.g., "1.2.3") into numeric arrays
 * and compares them element by element. Handles pre-release versions
 * by stripping suffixes before comparison.
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns Negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

/**
 * Get current claude-workflow package version (what dashboard is running)
 * Delegates to shared getPackageVersion from config-manager.
 *
 * @returns Current version string, fallback to '0.0.0' if unreadable
 */
export function getCurrentVersion(): string {
  return getPackageVersion();
}

/**
 * Get installed claude-workflow version for a project
 * Checks package.json dependencies or .claude/workflow-config.json
 *
 * @param projectPath - Path to project directory
 * @returns Version string or null if not determinable
 */
export async function getInstalledVersion(
  projectPath: string
): Promise<string | null> {
  // Strategy 1: Check package.json devDependencies/dependencies
  const packageJsonPath = path.join(projectPath, "package.json");
  try {
    const content = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const version =
      pkg.devDependencies?.["claude-workflow"] ??
      pkg.dependencies?.["claude-workflow"];

    if (version) {
      // Strip semver range prefixes (^, ~, >=, etc.)
      return version.replace(/^[\^~>=<]+/, "");
    }
  } catch {
    // package.json doesn't exist or can't parse - continue to strategy 2
  }

  // Strategy 2: Check .claude/workflow-config.json for packageVersion
  const configPath = path.join(projectPath, ".claude", "workflow-config.json");
  try {
    const content = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(content) as { packageVersion?: string };
    if (config.packageVersion) {
      return config.packageVersion;
    }
  } catch {
    // Config doesn't exist or can't parse
  }

  return null;
}

/**
 * Check if installed version is outdated compared to latest
 *
 * @param installed - Installed version string
 * @param latest - Latest version string
 * @returns True if installed is older than latest
 */
export function isVersionOutdated(
  installed: string | null,
  latest: string
): boolean {
  if (installed === null) {
    return false; // Can't determine, don't show as outdated
  }
  return compareVersions(installed, latest) < 0;
}
