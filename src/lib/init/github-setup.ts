/**
 * GitHub Repository Setup Module
 *
 * Guides users through GitHub repository creation as part of the
 * `claude-workflow init` flow. Checks `gh` CLI authentication,
 * creates a GitHub repository from the local project, and provides
 * platform-specific installation instructions when `gh` is not available.
 *
 * IMPORTANT: This module must be called AFTER `git init` AND an initial
 * commit. `gh repo create --source=.` requires at least one commit;
 * without it, gh gives a misleading "not a git repository" error.
 *
 * @see docs/research/gh-cli-programmatic-usage.md
 * @see docs/research/git-init-remote-configuration.md
 * @see docs/research/cross-platform-gh-git-detection.md
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import type { GhAuthEntry, PlatformType, PreflightResult } from "./preflight.js";
import {
  clackNote,
  clackSelect,
  clackText,
  clackYesNo,
  createSpinner,
  showError,
  showSuccess,
  showWarning,
} from "../ui.js";

// ── Types ──────────────────────────────────────────────────────────

/** Options for creating a GitHub repository from the local project. */
export interface GitHubSetupOptions {
  /** Repository name (defaults to directory name). */
  repoName: string;
  /** Public or private visibility. */
  visibility: "public" | "private";
  /** Working directory of the project. */
  cwd: string;
  /** Description for the GitHub repo (optional). */
  description?: string;
}

/** Result of the GitHub repository setup operation. */
export interface GitHubSetupResult {
  /** Whether repo was created successfully. */
  success: boolean;
  /** Full URL of the created repo (e.g., https://github.com/user/repo). */
  repoUrl?: string;
  /** Name of the git remote that was added. */
  remoteName?: string;
  /** Error message if creation failed. */
  error?: string;
  /** Whether user skipped GitHub setup. */
  skipped?: boolean;
}

/** Authentication status returned from `guideGhAuth`. */
export interface GhAuthResult {
  /** Whether the user is authenticated to github.com. */
  authenticated: boolean;
  /** The authenticated GitHub username. */
  login?: string;
  /** OAuth scopes granted to the token. */
  scopes?: string[];
  /** Where the token was sourced from (e.g., "oauth_token"). */
  tokenSource?: string;
}

/**
 * Platform identifiers for gh CLI install instructions.
 * Mapped from PreflightResult.platform with finer Linux distro detection.
 */
type InstallPlatform =
  | "macos"
  | "windows"
  | "wsl"
  | "linux-apt"
  | "linux-dnf"
  | "linux-other";

// ── Constants ──────────────────────────────────────────────────────

/** Timeout for gh CLI commands in milliseconds. */
const GH_COMMAND_TIMEOUT_MS = 60_000;

/** Maximum retries when a GitHub repo name collides with an existing one. */
const MAX_NAME_RETRIES = 3;

/** Max buffer size for command output (1 MB). */
const MAX_BUFFER = 1024 * 1024;

// ── Internal Helpers ───────────────────────────────────────────────

const execFileAsync = promisify(execFile);

/**
 * Execute a `gh` CLI command and return stdout, stderr, and exit code.
 *
 * Unlike the `executeCommand` helper in scaffold.ts, this does NOT throw
 * on non-zero exit codes. This is intentional because `gh auth status`
 * uses non-zero exit codes for legitimate states (exit 4 = not logged in).
 *
 * On Windows, `shell: true` is required for `.cmd`/`.bat` resolution.
 *
 * @param args - Arguments to pass to the `gh` binary
 * @param cwd - Working directory for the command
 * @returns stdout, stderr, and numeric exit code
 */
async function executeGhCommand(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      shell: process.platform === "win32",
      timeout: GH_COMMAND_TIMEOUT_MS,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

/**
 * Map the PlatformType from preflight to a finer-grained install platform.
 *
 * For Linux, probes for `apt` and `dnf` to determine distro family.
 * WSL2 is treated the same as linux-apt (Ubuntu-based in most cases)
 * but with a WSL-specific note about separate installation.
 */
function mapToInstallPlatform(platform: PlatformType): InstallPlatform {
  switch (platform) {
  case "darwin":
    return "macos";
  case "win32":
    return "windows";
  case "wsl2":
    return "wsl";
  case "linux": {
    // Detect package manager for Linux distro
    try {
      execFileSync("which", ["apt"], { stdio: "pipe" });
      return "linux-apt";
    } catch {
      try {
        execFileSync("which", ["dnf"], { stdio: "pipe" });
        return "linux-dnf";
      } catch {
        return "linux-other";
      }
    }
  }
  default:
    return "linux-other";
  }
}

// ── JSON response shape from gh auth status ────────────────────────

interface GhAuthJsonResponse {
  hosts: Record<string, GhAuthEntry[]>;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Guide the user through GitHub CLI authentication.
 *
 * Uses the `PreflightResult` from the preflight module to determine
 * whether `gh` is installed and whether the user is already authenticated.
 *
 * If not authenticated, offers to open browser-based OAuth login via
 * `gh auth login --web`.
 *
 * @param preflightResult - Result from the preflight checks module
 * @returns Authentication status with login name and scopes if authenticated
 */
export async function guideGhAuth(
  preflightResult: PreflightResult,
): Promise<GhAuthResult> {
  // If preflight says gh is not installed, show install instructions
  if (!preflightResult.gh.available) {
    const installPlatform = mapToInstallPlatform(preflightResult.platform);
    const instructions = getInstallInstructions(installPlatform);
    clackNote(instructions, "Install GitHub CLI");
    return { authenticated: false };
  }

  // If preflight already determined auth status, use it
  if (preflightResult.gh.auth?.authenticated) {
    showSuccess(
      `Authenticated as ${preflightResult.gh.auth.username ?? "unknown"} on GitHub`,
    );
    return {
      authenticated: true,
      login: preflightResult.gh.auth.username,
      scopes: preflightResult.gh.auth.scopes
        ? preflightResult.gh.auth.scopes.split(",").map((s) => s.trim())
        : undefined,
    };
  }

  // Check if gh version supports --json on auth status (>= 2.57.0)
  const ghVersion = preflightResult.gh.version;
  const supportsJson =
    ghVersion !== undefined &&
    (ghVersion.major > 2 || (ghVersion.major === 2 && ghVersion.minor >= 57));

  if (supportsJson) {
    // Use JSON mode -- exit code is always 0, check state field
    const result = await executeGhCommand(
      ["auth", "status", "--json", "hosts", "--active"],
      process.cwd(),
    );

    if (result.exitCode === 0 && result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout) as GhAuthJsonResponse;
        const githubHosts = parsed.hosts["github.com"];
        if (Array.isArray(githubHosts) && githubHosts.length > 0) {
          const activeHost = githubHosts.find(
            (h) => h.state === "success" && h.active,
          );
          if (activeHost) {
            showSuccess(`Authenticated as ${activeHost.login} on GitHub`);
            return {
              authenticated: true,
              login: activeHost.login,
              scopes: activeHost.scopes
                ? activeHost.scopes.split(",").map((s) => s.trim())
                : undefined,
              tokenSource: activeHost.tokenSource,
            };
          }
        }
      } catch {
        // JSON parse failed, fall through to login prompt
      }
    }
  } else {
    // Legacy fallback: use exit code based detection
    const result = await executeGhCommand(
      ["auth", "status"],
      process.cwd(),
    );
    // Exit 0 = authenticated, exit 1 = bad token, exit 4 = not logged in
    if (result.exitCode === 0) {
      const loginMatch = /Logged in to github\.com account (\S+)/.exec(
        result.stderr,
      );
      showSuccess(
        `Authenticated on GitHub${loginMatch ? ` as ${loginMatch[1]}` : ""}`,
      );
      return {
        authenticated: true,
        login: loginMatch?.[1],
      };
    }
  }

  // Not authenticated -- offer to log in
  const shouldLogin = await clackYesNo(
    "GitHub CLI is not authenticated. Log in now with browser?",
    true,
  );

  if (!shouldLogin) {
    return { authenticated: false };
  }

  clackNote(
    "A browser window will open for GitHub authentication.\n" +
      "Complete the login flow in your browser, then return here.",
    "GitHub Login",
  );

  const spinner = createSpinner("Waiting for GitHub authentication...");
  spinner.start();

  const loginResult = await executeGhCommand(
    ["auth", "login", "--web", "--git-protocol", "https"],
    process.cwd(),
  );

  spinner.stop();

  if (loginResult.exitCode === 0) {
    // Re-check auth to get login name
    const recheckResult = await executeGhCommand(
      ["auth", "status", "--json", "hosts", "--active"],
      process.cwd(),
    );
    let login: string | undefined;
    try {
      const parsed = JSON.parse(recheckResult.stdout) as GhAuthJsonResponse;
      const host = parsed.hosts["github.com"]?.[0];
      login = host?.login;
    } catch {
      /* ignore parse error */
    }

    showSuccess(`Successfully authenticated${login ? ` as ${login}` : ""}`);
    return { authenticated: true, login };
  }

  showError(
    "GitHub authentication failed. You can try again later with: gh auth login",
  );
  return { authenticated: false };
}

/**
 * Create a GitHub repository from the local project.
 *
 * Uses `gh repo create <name> --source=. --remote=origin [--public|--private]`
 * to create the repo and add the remote in one command. Does NOT use `--push`
 * so the user can review before pushing.
 *
 * Handles known error patterns:
 * - Name collision ("Name already exists on this account") -- prompts for alternative
 * - Existing remote ("remote origin already exists") -- reports existing URL
 * - No commits ("not a git repository") -- shows actionable error
 *
 * @param options - Repository creation options (name, visibility, cwd, description)
 * @returns Result with success status, repo URL, and remote name
 */
export async function createGitHubRepo(
  options: GitHubSetupOptions,
  retryCount = 0,
): Promise<GitHubSetupResult> {
  const { repoName, visibility, cwd, description } = options;

  // Build gh repo create args
  const args = [
    "repo",
    "create",
    repoName,
    "--source=.",
    "--remote=origin",
    visibility === "public" ? "--public" : "--private",
  ];

  if (description) {
    args.push("--description", description);
  }

  const spinner = createSpinner(
    `Creating ${visibility} repository "${repoName}" on GitHub...`,
  );
  spinner.start();

  const result = await executeGhCommand(args, cwd);

  spinner.stop();

  if (result.exitCode === 0) {
    // gh outputs the repo URL on success
    const repoUrl = result.stdout.trim();
    showSuccess(`Repository created: ${repoUrl}`);
    return {
      success: true,
      repoUrl,
      remoteName: "origin",
    };
  }

  // Handle known error patterns
  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  if (combinedOutput.includes("Name already exists on this account")) {
    showWarning(
      `Repository "${repoName}" already exists on your GitHub account.`,
    );
    const newName = await clackText(
      "Enter a different repository name (or leave empty to skip):",
      `${repoName}-2`,
      "",
    );

    if (newName && typeof newName === "string" && newName.trim()) {
      if (retryCount >= MAX_NAME_RETRIES) {
        showError(`Maximum retries (${MAX_NAME_RETRIES}) exceeded for repository name. Skipping GitHub setup.`);
        return {
          success: false,
          error: `Repository name collision: exceeded ${MAX_NAME_RETRIES} retries`,
          skipped: true,
        };
      }
      return createGitHubRepo({ ...options, repoName: newName.trim() }, retryCount + 1);
    }

    return {
      success: false,
      error: `Repository "${repoName}" already exists`,
      skipped: true,
    };
  }

  if (combinedOutput.includes("remote origin already exists")) {
    showWarning(
      'Remote "origin" already exists. Skipping GitHub repo creation.',
    );
    // Try to get the existing remote URL
    try {
      const { stdout: remoteUrl } = await execFileAsync(
        "git",
        ["remote", "get-url", "origin"],
        {
          cwd,
          shell: process.platform === "win32",
          timeout: GH_COMMAND_TIMEOUT_MS,
        },
      );
      return {
        success: true,
        repoUrl: remoteUrl.trim(),
        remoteName: "origin",
      };
    } catch {
      return {
        success: false,
        error:
          "Remote origin already exists but could not determine URL",
      };
    }
  }

  if (
    combinedOutput.includes("not a git repository") ||
    combinedOutput.includes("no commits")
  ) {
    showError(
      "Cannot create GitHub repo: no commits found.\n" +
        "Make sure git init and an initial commit were done before calling this function.",
    );
    return {
      success: false,
      error:
        "No commits in repository. gh repo create --source=. requires at least one commit.",
    };
  }

  // Unknown error
  showError(
    `Failed to create GitHub repository: ${result.stderr.trim() || result.stdout.trim()}`,
  );
  return {
    success: false,
    error: result.stderr.trim() || result.stdout.trim(),
  };
}

/**
 * Get platform-specific installation instructions for the GitHub CLI.
 *
 * Covers macOS (Homebrew), Windows (winget), WSL (apt with separate note),
 * Ubuntu/Debian (apt), Fedora/RHEL (dnf), and a generic fallback.
 *
 * @param platform - Target platform identifier. If not provided, auto-detects.
 * @returns Multi-line string with installation commands
 */
export function getInstallInstructions(platform?: InstallPlatform): string {
  const detectedPlatform = platform ?? mapToInstallPlatform(
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux",
  );

  const instructions: Record<InstallPlatform, string> = {
    "macos": [
      "Install GitHub CLI on macOS:",
      "",
      "  brew install gh",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),

    "windows": [
      "Install GitHub CLI on Windows:",
      "",
      "  winget install --id GitHub.cli",
      "",
      "Or download from: https://cli.github.com",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),

    "wsl": [
      "Install GitHub CLI in WSL (separate from Windows):",
      "",
      "  (type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \\",
      "  && sudo mkdir -p -m 755 /etc/apt/keyrings \\",
      "  && out=$(mktemp) \\",
      "  && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \\",
      "  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \\",
      "  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\",
      '  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\',
      "  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\",
      "  && sudo apt update \\",
      "  && sudo apt install gh -y",
      "",
      "Note: WSL requires its own gh installation, separate from Windows.",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),

    "linux-apt": [
      "Install GitHub CLI on Ubuntu/Debian:",
      "",
      "  (type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \\",
      "  && sudo mkdir -p -m 755 /etc/apt/keyrings \\",
      "  && out=$(mktemp) \\",
      "  && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \\",
      "  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \\",
      "  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\",
      '  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\',
      "  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\",
      "  && sudo apt update \\",
      "  && sudo apt install gh -y",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),

    "linux-dnf": [
      "Install GitHub CLI on Fedora/RHEL:",
      "",
      "  sudo dnf install 'dnf-command(config-manager)'",
      "  sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo",
      "  sudo dnf install gh",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),

    "linux-other": [
      "Install GitHub CLI:",
      "",
      "  See https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
      "",
      "Or download a binary from: https://cli.github.com",
      "",
      "Then authenticate:",
      "  gh auth login --web",
    ].join("\n"),
  };

  return instructions[detectedPlatform];
}

/**
 * Orchestrate the full GitHub repository setup flow.
 *
 * This is a higher-level function that combines auth checking and repo
 * creation into a single interactive flow. It:
 * 1. Checks/guides gh authentication
 * 2. Asks user if they want to create a GitHub repo
 * 3. Prompts for repo name and visibility
 * 4. Creates the repo via `gh repo create`
 *
 * @param preflightResult - Result from the preflight checks module
 * @param cwd - Working directory of the project
 * @param defaultRepoName - Default repository name (usually directory name)
 * @returns Result of the GitHub setup operation
 */
export async function setupGitHubRepo(
  preflightResult: PreflightResult,
  cwd: string,
  defaultRepoName: string,
): Promise<GitHubSetupResult> {
  // Step 1: Check/guide authentication
  const authResult = await guideGhAuth(preflightResult);

  if (!authResult.authenticated) {
    return {
      success: false,
      skipped: true,
      error: "GitHub CLI not authenticated",
    };
  }

  // Step 2: Ask if user wants to create a GitHub repo
  const wantRepo = await clackYesNo(
    "Create a GitHub repository for this project?",
    true,
  );

  if (!wantRepo) {
    return {
      success: false,
      skipped: true,
    };
  }

  // Step 3: Get repo name
  const repoName = await clackText(
    "Repository name:",
    defaultRepoName,
    defaultRepoName,
  );

  // Step 4: Get visibility
  const visibility = await clackSelect<"public" | "private">(
    "Repository visibility:",
    [
      {
        value: "private" as const,
        label: "Private",
        hint: "Only you can see this repository",
      },
      {
        value: "public" as const,
        label: "Public",
        hint: "Anyone on GitHub can see this repository",
      },
    ],
    "private",
  );

  // Step 5: Create the repo
  return createGitHubRepo({
    repoName,
    visibility,
    cwd,
  });
}
