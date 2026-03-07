/**
 * Preflight Binary Detection Module
 *
 * Detects availability and versions of required binaries (git, gh, npm),
 * checks gh authentication status, and identifies the runtime platform.
 * Used by the init orchestrator to adapt the guided flow based on what
 * tools are available on the user's system.
 *
 * @see docs/research/cross-platform-gh-git-detection.md
 * @see docs/research/gh-cli-programmatic-usage.md
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────

/** Structured semver version information parsed from binary output. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The raw semver string, e.g. "2.43.0" */
  raw: string;
}

/** Detection result for a single binary (git, gh, or npm). */
export interface BinaryInfo {
  /** Whether the binary was found on the system PATH. */
  available: boolean;
  /** Parsed version, if the binary is available and version output was parseable. */
  version?: ParsedVersion;
  /** Whether the detected version meets the minimum requirement. */
  meetsMinimum?: boolean;
}

/** GitHub CLI authentication status for the active account. */
export interface GhAuthStatus {
  /** Whether gh is authenticated to github.com. */
  authenticated: boolean;
  /** The authenticated GitHub username. */
  username?: string;
  /** OAuth scopes granted to the token (comma-separated). */
  scopes?: string;
  /** Git protocol preference (https or ssh). */
  protocol?: string;
}

/** Detected runtime platform with WSL2 differentiation. */
export type PlatformType = "darwin" | "linux" | "win32" | "wsl2" | "other";

/** Aggregated result from all preflight checks. */
export interface PreflightResult {
  git: BinaryInfo;
  gh: BinaryInfo & { auth?: GhAuthStatus };
  npm: BinaryInfo;
  platform: PlatformType;
}

// ── Constants ──────────────────────────────────────────────────────

/** Timeout for binary execution in milliseconds. */
const EXEC_TIMEOUT_MS = 10_000;

/**
 * Minimum required versions for each binary.
 * - git >= 2.28.0: `init.defaultBranch` support
 * - gh >= 2.57.0: reliable `--json hosts` + exit code fixes
 * - npm >= 7.0.0: workspace support
 */
const MINIMUM_VERSIONS: Record<string, string> = {
  gh: "2.57.0",
  git: "2.28.0",
  npm: "7.0.0",
};

// ── Main Entry Point ───────────────────────────────────────────────

/**
 * Run all preflight checks in parallel and return aggregated results.
 *
 * Detects git, gh, and npm availability/versions, checks gh authentication,
 * and identifies the runtime platform. All checks are non-throwing; missing
 * binaries return `{ available: false }`.
 *
 * @returns Aggregated preflight result with binary info and platform
 */
export async function preflight(): Promise<PreflightResult> {
  const platform = detectPlatform();

  const [git, gh, npm] = await Promise.all([
    checkBinary("git"),
    checkBinary("gh"),
    checkBinary("npm", "-v"),
  ]);

  let auth: GhAuthStatus | undefined;
  if (gh.available) {
    auth = await checkGhAuth();
  }

  return {
    git,
    gh: { ...gh, auth },
    npm,
    platform,
  };
}

// ── Binary Detection ───────────────────────────────────────────────

/**
 * Check whether a binary is available on the system PATH, parse its version,
 * and evaluate whether it meets the minimum version requirement.
 *
 * Uses `execFile` (not `exec`) for safety. On Windows, `shell: true` is
 * required to resolve binaries via PATH/PATHEXT.
 *
 * @param name - Binary name (e.g. "git", "gh", "npm")
 * @param versionFlag - Flag to retrieve version output (default: "--version")
 * @returns Binary availability, version, and minimum-version compliance
 */
export async function checkBinary(
  name: string,
  versionFlag = "--version",
): Promise<BinaryInfo> {
  try {
    const { stdout } = await execFileAsync(name, [versionFlag], {
      shell: process.platform === "win32",
      timeout: EXEC_TIMEOUT_MS,
    });

    const version = parseVersion(name, stdout.trim());
    const minVersion = MINIMUM_VERSIONS[name];
    const meetsMinimum =
      version && minVersion ? semverGte(version, minVersion) : undefined;

    return {
      available: true,
      version,
      meetsMinimum,
    };
  } catch {
    // ENOENT = binary not installed, or timeout/other exec failure
    return { available: false };
  }
}

// ── GitHub CLI Auth ────────────────────────────────────────────────

/**
 * JSON shape returned by `gh auth status --json hosts --active`.
 * @see docs/research/gh-cli-programmatic-usage.md
 */
export interface GhAuthEntry {
  active: boolean;
  gitProtocol: string;
  host: string;
  login: string;
  scopes: string;
  state: "error" | "success" | "timeout";
  token: string;
  tokenSource: string;
}

interface GhAuthResponse {
  hosts: Record<string, GhAuthEntry[]>;
}

/**
 * Check gh CLI authentication status for the active github.com account.
 *
 * Uses `gh auth status --json hosts --active` which always exits 0 in JSON
 * mode. We inspect the `state` field of the active account entry instead of
 * relying on exit codes.
 *
 * @returns Authentication status with username, scopes, and protocol if authenticated
 */
export async function checkGhAuth(): Promise<GhAuthStatus> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["auth", "status", "--json", "hosts", "--active"],
      {
        shell: process.platform === "win32",
        timeout: EXEC_TIMEOUT_MS,
      },
    );

    const data = JSON.parse(stdout) as GhAuthResponse;
    const githubAccounts = data.hosts["github.com"] ?? [];
    const activeAccount = githubAccounts.find((account) => account.active);

    if (!activeAccount || activeAccount.state !== "success") {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      username: activeAccount.login,
      scopes: activeAccount.scopes || undefined,
      protocol: activeAccount.gitProtocol || undefined,
    };
  } catch {
    // gh not available, auth check fails, or JSON parse error
    return { authenticated: false };
  }
}

// ── Platform Detection ─────────────────────────────────────────────

/**
 * Detect the runtime platform, differentiating WSL2 from native Linux.
 *
 * WSL2 detection reads `/proc/version` and checks for "microsoft" in the
 * kernel version string (e.g. "Linux version 5.15.146.1-microsoft-standard-WSL2").
 *
 * @returns Platform identifier
 */
export function detectPlatform(): PlatformType {
  const platform = os.platform();

  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";

  if (platform === "linux") {
    try {
      const procVersion = readFileSync("/proc/version", "utf8");
      if (procVersion.toLowerCase().includes("microsoft")) {
        return "wsl2";
      }
    } catch {
      // Cannot read /proc/version, treat as regular Linux
    }
    return "linux";
  }

  return "other";
}

// ── Version Parsing ────────────────────────────────────────────────

/**
 * Route version parsing to the appropriate binary-specific parser.
 *
 * @param binary - Binary name to select the parser
 * @param output - Raw stdout from the version command
 * @returns Parsed version or undefined if unparseable
 */
function parseVersion(
  binary: string,
  output: string,
): ParsedVersion | undefined {
  switch (binary) {
  case "git": {
    return parseGitVersion(output);
  }
  case "gh": {
    return parseGhVersion(output);
  }
  case "npm": {
    return parseNpmVersion(output);
  }
  default: {
    return parseGenericVersion(output);
  }
  }
}

/**
 * Parse git version from `git --version` output.
 * Handles: "git version 2.43.0", "git version 2.39.3 (Apple Git-146)",
 *          "git version 2.43.0.windows.1"
 */
function parseGitVersion(output: string): ParsedVersion | undefined {
  const match = /git version (\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return undefined;
  return buildParsedVersion(match);
}

/**
 * Parse gh CLI version from `gh --version` output.
 * Example input: "gh version 2.65.0 (2025-01-06)\nhttps://..."
 */
function parseGhVersion(output: string): ParsedVersion | undefined {
  const match = /gh version (\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return undefined;
  return buildParsedVersion(match);
}

/**
 * Parse npm version from `npm -v` output.
 * Example input: "10.2.4"
 */
function parseNpmVersion(output: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(output.trim());
  if (!match) return undefined;
  return buildParsedVersion(match);
}

/**
 * Fallback generic version parser for unknown binaries.
 * Extracts the first semver-like triplet from any output string.
 */
function parseGenericVersion(output: string): ParsedVersion | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return undefined;
  return buildParsedVersion(match);
}

/**
 * Build a ParsedVersion from a RegExpExecArray with 3 capture groups.
 * Extracts groups [1], [2], [3] as major, minor, patch.
 */
function buildParsedVersion(match: RegExpExecArray): ParsedVersion {
  const major = Number.parseInt(match[1] ?? "0", 10);
  const minor = Number.parseInt(match[2] ?? "0", 10);
  const patch = Number.parseInt(match[3] ?? "0", 10);
  return { major, minor, patch, raw: `${major}.${minor}.${patch}` };
}

// ── Version Comparison ─────────────────────────────────────────────

/**
 * Compare a parsed version against a minimum version string.
 * Returns true if `version` >= `required` using standard semver precedence.
 *
 * @param version - Parsed version to check
 * @param required - Minimum version string (e.g. "2.28.0")
 * @returns true if version meets or exceeds the requirement
 */
function semverGte(version: ParsedVersion, required: string): boolean {
  const parts = required.split(".").map(Number);
  const rMajor = parts[0] ?? 0;
  const rMinor = parts[1] ?? 0;
  const rPatch = parts[2] ?? 0;

  if (version.major !== rMajor) return version.major > rMajor;
  if (version.minor !== rMinor) return version.minor > rMinor;
  return version.patch >= rPatch;
}
