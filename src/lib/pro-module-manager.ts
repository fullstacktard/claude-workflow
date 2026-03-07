/**
 * Pro Module Manager - Central coordination for hybrid free/pro module resolution
 *
 * Manages detection, resolution, download, and cleanup of pro modules.
 * Pro modules are downloaded to ~/.claude-workflow/pro/.claude/ and take
 * precedence over free modules shipped in dist/templates/.claude/.
 *
 * @see docs/research/feature-registry-hybrid-module-architecture.md
 * @module lib/pro-module-manager
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import semver from "semver";
import { FEATURE_GROUPS, FEATURE_MAP } from "./feature-registry.js";
import { PACKAGE_ROOT } from "./file-operations.js";
import type { TierName } from "./license-manager.js";
import { TIER_HIERARCHY, getDownloadCredentials } from "./license-manager.js";
import { computeLicenseState } from "./license-state.js";
import type { LicenseStateInfo } from "./license-state.js";
import { maybeAutoRefresh } from "./license-manager.js";

const __filename_pmm = fileURLToPath(import.meta.url);
const __dirname_pmm = dirname(__filename_pmm);

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------

/** Root directory for downloaded pro modules */
export const PRO_MODULES_DIR = join(homedir(), ".claude-workflow", "pro");

/** Pro modules .claude directory (mirrors dist/templates/.claude structure) */
export const PRO_CLAUDE_DIR = join(PRO_MODULES_DIR, ".claude");

/** Version manifest for downloaded pro modules */
export const PRO_VERSION_PATH = join(PRO_MODULES_DIR, "version.json");

/** Worker API base URL for pro module operations */
const WORKER_API_BASE = "https://api.claudeworkflow.com";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export type ComponentType = "agent" | "command" | "hook" | "skill" | "workflow";

export interface ProModuleVersion {
  version: string;
  checksum: string;
  downloadedAt: string;
  tier: TierName;
  fileCount: number;
}

export interface DownloadResult {
  success: boolean;
  version: string;
  fileCount: number;
  error?: string;
}

// ---------------------------------------------------------------
// Pro Component Detection (cached Set for O(1) lookup)
// ---------------------------------------------------------------

let _proComponentIds: Set<string> | null = null;

/**
 * Build and cache the set of all pro component IDs.
 * Components are keyed as "type:id" for O(1) lookup.
 */
function getProComponentIds(): Set<string> {
  if (_proComponentIds) return _proComponentIds;

  _proComponentIds = new Set<string>();
  for (const group of FEATURE_GROUPS) {
    if (TIER_HIERARCHY[group.requiredTier] > TIER_HIERARCHY.free) {
      for (const a of group.agents) _proComponentIds.add(`agent:${a}`);
      for (const s of group.skills) _proComponentIds.add(`skill:${s}`);
      for (const c of group.commands) _proComponentIds.add(`command:${c}`);
      for (const w of group.workflows) _proComponentIds.add(`workflow:${w}`);
    }
  }
  return _proComponentIds;
}

/**
 * Check if a component ID belongs to a pro feature group.
 * Uses cached Set for O(1) lookup after first call.
 *
 * @param componentId - The component identifier (e.g., "v0-planner")
 * @param componentType - The type of component (agent, skill, command, etc.)
 * @returns true if the component requires a paid tier
 */
export function isProComponent(
  componentId: string,
  componentType: ComponentType
): boolean {
  return getProComponentIds().has(`${componentType}:${componentId}`);
}

// ---------------------------------------------------------------
// Module Resolution
// ---------------------------------------------------------------

/**
 * Resolve the filesystem path for a component file.
 *
 * For free components: returns path under PACKAGE_ROOT/dist/templates/
 * For pro components: returns path under ~/.claude-workflow/pro/ if available
 * Returns null if pro component is not downloaded.
 *
 * @param componentType - The type of component
 * @param componentId - The component identifier
 * @returns Absolute filesystem path or null if pro component is unavailable
 */
export function resolveComponentSource(
  componentType: ComponentType,
  componentId: string
): string | null {
  if (!isProComponent(componentId, componentType)) {
    return resolveDistPath(componentType, componentId);
  }

  const proPath = resolveProPath(componentType, componentId);
  if (proPath && existsSync(proPath)) {
    return proPath;
  }

  return null;
}

function resolveDistPath(
  componentType: ComponentType,
  componentId: string
): string {
  const subPath = componentTypeToPath(componentType, componentId);
  return join(PACKAGE_ROOT, "dist", "templates", ".claude", subPath);
}

function resolveProPath(
  componentType: ComponentType,
  componentId: string
): string {
  const subPath = componentTypeToPath(componentType, componentId);
  return join(PRO_CLAUDE_DIR, subPath);
}

function componentTypeToPath(
  componentType: ComponentType,
  componentId: string,
): string {
  switch (componentType) {
  case "agent": {
    return `agents/${componentId}.md`;
  }
  case "skill": {
    return `skills/${componentId}`;
  }
  case "hook": {
    return `hooks/${componentId}`;
  }
  case "command": {
    return `commands/${componentId}.md`;
  }
  case "workflow": {
    return `workflows/${componentId}.yml`;
  }
  }
}

// ---------------------------------------------------------------
// Availability Checks
// ---------------------------------------------------------------

/**
 * Check if pro modules have been downloaded (version.json exists).
 */
export function areProModulesDownloaded(): boolean {
  return existsSync(PRO_VERSION_PATH);
}

/**
 * Check if a feature's module files are available on disk.
 *
 * - Free features always return true (shipped in npm package)
 * - Pro features return true only when pro modules are downloaded AND
 *   at least one component file exists in the pro directory
 *
 * @param featureId - Feature group ID from FEATURE_GROUPS
 * @returns true if the feature's components can be resolved
 */
export function isFeatureModuleAvailable(featureId: string): boolean {
  const feature = FEATURE_MAP.get(featureId);
  if (!feature) return false;
  if (feature.requiredTier === "free") return true;
  if (!areProModulesDownloaded()) return false;

  // Check if at least one component file exists in pro directory
  for (const agentId of feature.agents) {
    if (existsSync(join(PRO_CLAUDE_DIR, "agents", `${agentId}.md`))) {
      return true;
    }
  }
  for (const skillId of feature.skills) {
    if (existsSync(join(PRO_CLAUDE_DIR, "skills", skillId))) {
      return true;
    }
  }
  for (const commandId of feature.commands) {
    if (existsSync(join(PRO_CLAUDE_DIR, "commands", `${commandId}.md`))) {
      return true;
    }
  }
  for (const workflowId of feature.workflows) {
    if (existsSync(join(PRO_CLAUDE_DIR, "workflows", `${workflowId}.yml`))) {
      return true;
    }
  }

  return false;
}

/**
 * Read the pro module version manifest from disk.
 * Returns null if not found or corrupted.
 */
export function getProModuleVersion(): ProModuleVersion | null {
  try {
    if (!existsSync(PRO_VERSION_PATH)) return null;
    return JSON.parse(readFileSync(PRO_VERSION_PATH, "utf8")) as ProModuleVersion;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Download / Sync
// ---------------------------------------------------------------

/**
 * Download pro modules using HMAC-authenticated Worker API.
 *
 * Uses download credentials saved during license activation (downloadToken + downloadUrl).
 * The Worker endpoint authenticates via `?token=` query parameter (HMAC download token).
 * Computes SHA-256 checksum after download for integrity recording.
 *
 * @param jwt - License JWT (kept for backward compatibility; internally uses download credentials)
 * @returns Download result with success status and metadata
 */
export async function downloadProModules(jwt: string): Promise<DownloadResult> {
  // Suppress unused parameter warning -- jwt kept for caller backward compat
  void jwt;

  try {
    // Read download credentials saved during license activation
    const creds = getDownloadCredentials();
    if (!creds) {
      return {
        success: false, version: "", fileCount: 0,
        error: "No download credentials. Re-activate with: claude-workflow activate <key>",
      };
    }

    // Worker download endpoint authenticates via ?token= query param
    const downloadUrl = `${creds.downloadUrl}?token=${encodeURIComponent(creds.downloadToken)}`;

    const tarballPath = join(PRO_MODULES_DIR, ".download.tar.gz");
    mkdirSync(PRO_MODULES_DIR, { recursive: true });

    const response = await fetch(downloadUrl, {
      headers: { "Accept": "application/gzip" },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        success: false, version: creds.version, fileCount: 0,
        error: `Download failed (${String(response.status)}): ${errorText}`,
      };
    }

    if (!response.body) {
      return {
        success: false, version: creds.version, fileCount: 0,
        error: "Download response body is empty",
      };
    }

    // Stream tarball to disk
    const fileStream = createWriteStream(tarballPath, { mode: 0o600 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(response.body as any, fileStream);

    // Compute SHA-256 checksum for integrity recording
    const tarballContent = readFileSync(tarballPath);
    const checksum = createHash("sha256").update(tarballContent).digest("hex");

    // Extract tarball (clean existing pro modules first)
    if (existsSync(PRO_CLAUDE_DIR)) {
      rmSync(PRO_CLAUDE_DIR, { recursive: true, force: true });
    }
    const { execSync } = await import("node:child_process");
    execSync(`tar -xzf "${tarballPath}" -C "${PRO_MODULES_DIR}"`, {
      stdio: "pipe",
    });

    // Count extracted files
    const fileCount = countFilesRecursive(PRO_CLAUDE_DIR);

    // Write version.json
    const versionInfo: ProModuleVersion = {
      version: creds.version,
      checksum,
      downloadedAt: new Date().toISOString(),
      tier: "pro" as TierName,
      fileCount,
    };
    writeFileSync(PRO_VERSION_PATH, JSON.stringify(versionInfo, null, 2));

    // Cleanup tarball
    rmSync(tarballPath, { force: true });

    return { success: true, version: creds.version, fileCount };
  } catch (error) {
    return {
      success: false, version: "", fileCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a pro module update is available via the Worker API.
 *
 * Calls `GET /api/pro/check-update?version=x.y.z&licenseKey=...` on the Worker.
 * The license key identifier is extracted from the JWT's `sub` claim.
 *
 * @param jwt - License JWT (sub claim used as license key identifier)
 * @returns Update availability info
 */
export async function checkProModuleUpdate(jwt: string): Promise<{
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string | null;
}> {
  const current = getProModuleVersion();
  const currentVersion = current?.version ?? null;

  try {
    // Extract license key hash from JWT subject claim
    let licenseKey = "licensed";
    const parts = jwt.split(".");
    if (parts.length === 3 && parts[1]) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string };
        if (typeof payload.sub === "string") licenseKey = payload.sub;
      } catch { /* use default */ }
    }

    const params = new URLSearchParams({
      version: currentVersion ?? "0.0.0",
      licenseKey,
    });

    const response = await fetch(
      `${WORKER_API_BASE}/api/pro/check-update?${params.toString()}`,
      { headers: { "Accept": "application/json" } },
    );

    if (!response.ok) {
      return { updateAvailable: false, latestVersion: "", currentVersion };
    }

    const data = await response.json() as {
      hasUpdate: boolean;
      latestVersion: string;
    };

    return {
      updateAvailable: data.hasUpdate,
      latestVersion: data.latestVersion,
      currentVersion,
    };
  } catch {
    return { updateAvailable: false, latestVersion: "", currentVersion };
  }
}

/**
 * Recursively count files in a directory.
 * Used to report file count after tarball extraction.
 */
function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFilesRecursive(join(dir, entry.name));
  }
  return count;
}

/**
 * Remove all downloaded pro modules from disk.
 * Safe to call even when pro directory does not exist.
 */
export function removeProModules(): void {
  if (existsSync(PRO_MODULES_DIR)) {
    rmSync(PRO_MODULES_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------
// License State Integration
// ---------------------------------------------------------------

/**
 * Resolve a component source with license state check.
 *
 * For pro components, this gates loading on the license state machine:
 * - `active` or `grace` state: pro modules load normally
 * - `expired` or `free` state: pro modules are disabled, returns null
 *
 * Also triggers proactive auto-refresh when within 48h of expiry.
 *
 * @param componentType - The type of component
 * @param componentId - The component identifier
 * @returns Absolute filesystem path or null if component unavailable
 */
export function resolveComponentSourceWithLicenseCheck(
  componentType: ComponentType,
  componentId: string,
): string | null {
  // Free components bypass license check entirely
  if (!isProComponent(componentId, componentType)) {
    return resolveDistPath(componentType, componentId);
  }

  // Check license state for pro components
  const stateInfo: LicenseStateInfo = computeLicenseState();

  // Display warning if present (pre-expiry, grace, or expired)
  if (stateInfo.warning) {
    console.warn(`[pro] ${stateInfo.warning}`);
  }

  // Trigger auto-refresh when approaching expiry (non-blocking)
  maybeAutoRefresh();

  if (!stateInfo.proModulesEnabled) {
    return null;
  }

  // Proceed with normal pro path resolution
  const proPath = resolveProPath(componentType, componentId);
  if (proPath && existsSync(proPath)) {
    return proPath;
  }

  return null;
}

// ---------------------------------------------------------------
// CLI Compatibility Validation
// ---------------------------------------------------------------

/**
 * Get the current CLI version from package.json.
 *
 * Walks up from the current file to find the package root's package.json.
 * Works both in development (src/lib/) and production (dist/lib/).
 *
 * @returns Semver version string, or null if not found
 */
function getCliVersionFromPackageJson(): string | null {
  try {
    const packageJsonPath = join(__dirname_pmm, "..", "..", "package.json");
    if (existsSync(packageJsonPath)) {
      const raw = readFileSync(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw) as { version: string };
      return pkg.version;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that the current CLI version is compatible with the
 * pro module manifest's `compatibleCli` semver range.
 *
 * Uses `semver.satisfies()` to check if the CLI version falls within
 * the range specified in the manifest. This prevents loading pro modules
 * that require a newer (or incompatible) CLI version.
 *
 * @param manifestPath - Absolute path to the pro module manifest.json
 * @returns `true` if compatible (or if validation cannot be performed), `false` if incompatible
 */
export function validateCliCompatibility(manifestPath: string): boolean {
  try {
    if (!existsSync(manifestPath)) {
      console.warn("[pro] Manifest file not found for compatibility check");
      return false;
    }

    const manifestJson = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestJson) as { compatibleCli?: string };

    if (!manifest.compatibleCli) {
      console.warn("[pro] Manifest missing compatibleCli field, skipping version check");
      return true;
    }

    const cliVersion = getCliVersionFromPackageJson();
    if (!cliVersion) {
      console.warn("[pro] Could not determine CLI version for compatibility check");
      return true; // Permissive: don't block if we can't determine version
    }

    const cleanVersion = semver.valid(cliVersion);
    if (!cleanVersion) {
      console.warn(`[pro] Invalid CLI version: ${cliVersion}`);
      return false;
    }

    if (!semver.satisfies(cleanVersion, manifest.compatibleCli)) {
      console.warn(
        `[pro] CLI version ${cleanVersion} is not compatible with pro modules ` +
        `(requires ${manifest.compatibleCli}). Please update claude-workflow.`,
      );
      return false;
    }

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pro] Failed to validate CLI compatibility: ${message}`);
    return false;
  }
}

/**
 * Reset cached pro component IDs (for testing only).
 * Do not call in production code.
 */
export function _resetProComponentCache(): void {
  _proComponentIds = null;
}
