/**
 * CLI Login Routes Module
 *
 * Provides endpoints for managing CLI-based OAuth login flow.
 * Handles spawning `claude login` process, capturing OAuth URL,
 * and streaming CLI output to clients via WebSocket.
 *
 * @module cli-login
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import { spawn, execSync } from "node:child_process";
import { existsSync, readdirSync, lstatSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AccountManager } from "../../account/account-manager.js";

// Claude home directory
// Use CLAUDE_HOME if set (Docker), otherwise fall back to os.homedir()
const CLAUDE_HOME_DIR = process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");

// ============================================================================
// Constants
// ============================================================================

const CLI_LOGIN_TIMEOUT_MS = 300_000; // 5 minutes for OAuth flow (includes Cloudflare + manual auth)
const CLI_DETECTION_TIMEOUT_MS = 30_000; // 30 seconds for Docker/slow systems (CLI init can be slow)

// ============================================================================
// Types
// ============================================================================

/** Configuration options for CLI login routes - exported for external use */
export interface CliLoginRoutesConfig {
  /** Dashboard URL for callbacks (default: http://localhost:3850) */
  dashboardUrl?: string;
}

/**
 * Result of CLI detection check
 */
interface CliDetectionResult {
  /** Whether CLI was found and working */
  installed: boolean;
  /** Error type if not installed */
  error?: "not_found" | "timeout" | "execution_error" | "unknown";
  /** Human-readable error message */
  message?: string;
  /** CLI version if found */
  version?: string;
  /** Path to claude executable if found */
  executablePath?: string;
}

/**
 * Start login response
 */
interface StartLoginResponse {
  /** Error message if login failed to start */
  error?: string;
  /** Session ID for tracking this login attempt */
  sessionId: string;
  /** Current status */
  status: "starting" | "no_cli" | "already_logged_in";
}

// ============================================================================
// Module State
// ============================================================================

/**
 * Track active CLI login sessions
 * Maps session ID to child process
 */
const activeSessions = new Map<string, ReturnType<typeof spawn>>();

/**
 * Track session start times for freshness detection
 * Maps session ID to timestamp when OAuth flow started
 */
const sessionStartTimes = new Map<string, number>();

/**
 * Track login success detection for CLI sessions
 * Maps session ID to a marker value ("LOGIN_SUCCESS" or "LOGIN_SUCCESS_FILE_FALLBACK")
 * Used to know when to read credentials from .credentials.json after CLI exits
 */
const sessionExtractedTokens = new Map<string, string>();

/**
 * Log streamer for broadcasting CLI output
 * Set via setCliLoginLogStreamer()
 * Using 'any' type to avoid circular type dependencies
 */
let logStreamer:
  | {
      broadcast(message: { type: string; payload: unknown }): void;
      broadcastCredentialUpdate(payload: {
        accountId: string;
        action: "added" | "updated";
        email: string;
        subscriptionType: string;
        syncedAt: string;
      }): void;
    }
  | undefined;

/**
 * AccountManager for syncing CLI credentials to dashboard
 * Set via createCliLoginRoutes()
 */
let moduleAccountManager: AccountManager | undefined;

/**
 * Map session IDs to target account IDs for re-auth flow
 */
const sessionAccountMap = new Map<string, string>();

/**
 * Map session IDs to OAuth state parameter extracted from the URL
 * The CLI expects the user to paste `CODE#STATE` (split by #).
 * We extract the state from the OAuth URL and append it automatically.
 */
const sessionOAuthState = new Map<string, string>();

/**
 * Track active CLI login sessions for credential watcher bypass.
 * When a session is in this set, the credential watcher should skip file change events
 * during the /login flow (which may modify credential files).
 */
const activeCliLoginSessions = new Set<string>();

/**
 * Check if a CLI login session is currently active.
 * Used by CliCredentialWatcher to skip spurious file change events
 * during the /login flow (which may modify credential files).
 */
export function isCliLoginSessionActive(): boolean {
  return activeCliLoginSessions.size > 0;
}

/**
 * Active session lock
 * Only ONE CLI login session can be active at a time to prevent credential race conditions.
 * The credentials file (.credentials.json) is shared and can be overwritten by concurrent sessions.
 */
let activeLoginSessionId: string | undefined;

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Validate an OAuth token structurally.
 * OAuth tokens (sk-ant-oat01-*) are for Claude.ai/Claude Code and do NOT work
 * with the public Anthropic Messages API (which returns "OAuth authentication
 * is currently not supported"). Since the CLI already performed the full OAuth
 * flow, we only verify the token structure here.
 */
function validateOAuthToken(token: string): boolean {
  // OAuth tokens (sk-ant-oat01-*) are for Claude.ai/Claude Code, NOT the public
  // Anthropic Messages API. The Messages API returns "OAuth authentication is
  // currently not supported" for these tokens.
  //
  // Since `setup-token` already performed the full OAuth flow and the CLI exited
  // successfully, the token is valid. We just do a structural check here.
  if (!token || token.length < 50) {
    console.warn(`[cli-login] Token too short or empty (${token?.length ?? 0} chars)`);
    return false;
  }

  if (!token.startsWith("sk-ant-oat01-")) {
    console.warn(`[cli-login] Token has unexpected prefix: ${token.slice(0, 15)}...`);
    return false;
  }

  console.log(`[cli-login] Token structural validation passed (${token.length} chars, prefix ok)`);
  return true;
}

// ============================================================================
// Account Creation from Extracted Token
// ============================================================================

/** Credentials data shape from .credentials.json */
interface CliCredentialsData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Populate usage cache for a long-lived token by making an initial request through the proxy.
 * This captures rate limit headers since long-lived tokens can't use the OAuth usage API.
 *
 * @param accessToken - The OAuth access token
 * @param accountId - Account ID for logging
 */
async function populateUsageCacheForLongLivedToken(accessToken: string, accountId: string): Promise<void> {
  // Use Docker service name when running in container, fallback to localhost for local dev
  const PROXY_URL = process.env.CLAUDE_PROXY_URL ?? "http://claude-proxy:4000";

  console.log(`[cli-login] Populating usage cache for long-lived token ${accountId.slice(0, 8)}...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${PROXY_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-app": "cli",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Always consume response body to complete the request
    await response.text();

    // Both 200 (success) and 429 (rate limited) include rate limit headers
    // The proxy captures these headers regardless, so both are "success" for cache population
    if (response.ok || response.status === 429) {
      console.log(`[cli-login] Successfully populated usage cache for ${accountId.slice(0, 8)}... (status: ${response.status})`);
    } else {
      console.warn(`[cli-login] Usage cache population returned status ${response.status} - cache may not be populated`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[cli-login] Failed to populate usage cache: ${message}`);
    // Non-fatal - usage will show defaults until real requests populate the cache
  }
}

/**
 * Create an account from OAuth credentials
 *
 * @param credentials - The credentials from .credentials.json
 * @param email - User email from .claude.json
 * @param accountId - Optional account ID for re-auth flow
 * @param accountUuid - Optional account UUID from Anthropic
 * @returns Result with success status
 */
async function createAccountFromExtractedToken(
  credentials: CliCredentialsData,
  email: string,
  accountId?: string,
  accountUuid?: string
): Promise<{ success: boolean; error?: string; accountId?: string }> {
  if (!moduleAccountManager) {
    return { success: false, error: "AccountManager not initialized" };
  }

  // Use credentials data from file, with sensible defaults
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const tokenData = {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken ?? "",
    expiresAt: credentials.expiresAt ?? Date.now() + ONE_YEAR_MS,
    rateLimitTier: credentials.rateLimitTier ?? "",
    scopes: credentials.scopes ?? ["user:inference"],
    subscriptionType: credentials.subscriptionType ?? "",
  };

  try {
    if (accountId) {
      // Re-auth flow: update existing account
      console.log(`[cli-login] Updating existing account ${accountId.slice(0, 8)}... with extracted token`);

      const existingAccount = await moduleAccountManager.getAccount(accountId);
      if (!existingAccount) {
        return { success: false, error: "Account not found" };
      }

      await moduleAccountManager.updateAccount(accountId, {
        metadata: { status: "active", email, ...(accountUuid && { accountUuid }) },
        token: tokenData,
      });

      console.log(`[cli-login] Successfully updated account ${accountId.slice(0, 8)}...`);
      return { success: true, accountId };
    } else {
      // New account flow: check for existing account by email first
      const existingAccounts = await moduleAccountManager.getAccounts();
      const existingByEmail = existingAccounts.find(
        (a) => a.metadata.email?.toLowerCase() === email.toLowerCase()
      );

      if (existingByEmail) {
        // Update existing account
        console.log(`[cli-login] Found existing account by email, updating ${existingByEmail.id.slice(0, 8)}...`);
        await moduleAccountManager.updateAccount(existingByEmail.id, {
          metadata: { status: "active", ...(accountUuid && { accountUuid }) },
          token: tokenData,
        });
        return { success: true, accountId: existingByEmail.id };
      }

      // Create new account
      console.log("[cli-login] Creating new account from extracted token...");
      const alias = `CLI: ${email}`;
      const newAccount = await moduleAccountManager.addAccount({
        token: tokenData,
        metadata: {
          alias,
          email,
          status: "active",
          ...(accountUuid && { accountUuid }),
        },
      });

      console.log(`[cli-login] Successfully created account ${newAccount.id.slice(0, 8)}...`);

      // For long-lived tokens, make an initial request to populate usage cache
      // (since they can't use OAuth usage API due to limited scopes)
      const isLongLived = !tokenData.refreshToken || tokenData.refreshToken.length === 0;
      if (isLongLived) {
        // Fire and forget - don't block account creation on cache population
        populateUsageCacheForLongLivedToken(tokenData.accessToken, newAccount.id).catch(() => {
          // Errors already logged in the function
        });
      }

      return { success: true, accountId: newAccount.id };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cli-login] Failed to create account from token:", message);
    return { success: false, error: message };
  }
}

/**
 * Extract OAuth token from CLI setup-token stdout output.
 * Tokens look like: sk-ant-oat01-...
 *
 * The CLI outputs the token after OAuth flow completes successfully.
 * We need to strip ANSI codes and find the token pattern.
 *
 * IMPORTANT: Tokens typically end with "AA" and are ~100+ chars.
 * The Ink CLI may insert cursor positioning codes within the token,
 * so we must REMOVE (not replace) ANSI codes before extraction.
 */
function extractOAuthToken(output: string): string | undefined {
  // Step 1: Handle ANSI sequences strategically
  // The Ink CLI uses cursor positioning in weird ways:
  // - [1C] inside token represents missing characters (weird rendering)
  // - [2B] separates token from "Store this token securely" message
  // - [1B] is line wrapping within the token
   
  let cleanOutput = output
    // REPLACE [2B] or larger cursor-down with PIPE as delimiter (separates token from message)
    .replaceAll(/\u001B\[[2-9]\d*B/g, "|")
    // REMOVE single line cursor-down [1B] (line wrap within token)
    .replaceAll(/\u001B\[1?B/g, "")
    // REMOVE cursor-up codes
    .replaceAll(/\u001B\[\d*A/g, "")
    // REMOVE horizontal cursor codes (they represent missing chars in token)
    .replaceAll(/\u001B\[\d*[CD]/g, "")
    // REMOVE other ANSI escape sequences
    .replaceAll(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    // REMOVE carriage returns and newlines
    .replaceAll(/[\r\n]/g, "")
    // REMOVE other control characters
    .replaceAll(/[\u0000-\u001F]/g, "");
   

  // Step 2: Find token - try various prefix patterns
  // The Ink CLI mangles the prefix by replacing chars with cursor codes:
  // - 'sk-ant-oat01-' might become 'sk-nt-oat01-' (missing 'a')
  // - or 'sk-ant-oa01-' (missing 't')
  // - or 'sk-ant-oat1-' (missing '0')
  // - or any combination of missing chars

  // Try common variations in order of likelihood
  const prefixVariants = [
    "sk-ant-oat01-",   // exact match
    "sk-ant-oat1-",    // missing '0'
    "sk-ant-oa01-",    // missing 't'
    "sk-ant-ot01-",    // missing 'a' in 'oat'
    "sk-nt-oat01-",    // missing 'a' in 'ant'
    "sk-ant-oat0-",    // missing '1'
    "sk-ant-oa1-",     // missing 't' and '0'
    "sk-ant-o01-",     // missing 'a' and 't'
    "sk-nt-oat1-",     // missing 'a' and '0'
  ];

  let tokenStart = -1;

  for (const prefix of prefixVariants) {
    const pos = cleanOutput.indexOf(prefix);
    if (pos !== -1) {
      tokenStart = pos;
      if (prefix !== "sk-ant-oat01-") {
        console.log(`[cli-login] Found token with mangled prefix '${prefix}' at position ${pos}, will normalize`);
        // Reconstruct with proper prefix
        cleanOutput = cleanOutput.slice(0, Math.max(0, pos)) + "sk-ant-oat01-" + cleanOutput.slice(Math.max(0, pos + prefix.length));
      }
      break;
    }
  }

  // Fallback: regex pattern match for any sk-*-oat*- pattern
  if (tokenStart === -1) {
    const tokenMatch = cleanOutput.match(/sk-[a-z]*-?o?a?t?\d*-[A-Za-z0-9_-]{50,}/);
    if (tokenMatch) {
      console.log(`[cli-login] Found token via regex pattern: ${tokenMatch[0].slice(0, 25)}...`);
      // Normalize the prefix
      const normalizedToken = tokenMatch[0].replace(/^sk-[a-z]*-?o?a?t?\d*-/, "sk-ant-oat01-");
      cleanOutput = cleanOutput.replace(tokenMatch[0], normalizedToken);
      tokenStart = cleanOutput.indexOf("sk-ant-oat01-");
    }
  }

  if (tokenStart === -1) {
    return undefined;
  }

  // Step 3: Extract token by collecting valid chars from start position
  // Token chars are: A-Z, a-z, 0-9, underscore, hyphen
  let token = "";
  for (let i = tokenStart; i < cleanOutput.length; i++) {
    const char = cleanOutput[i];
    if (/[A-Za-z0-9_-]/.test(char)) {
      token += char;
    } else if (token.length > 0) {
      // Hit a non-token char after we've started - token is complete
      break;
    }
  }

  // Validate: tokens should be 80-120 chars and end with specific patterns
  if (token.length >= 80 && token.length <= 150 && token.startsWith("sk-ant-oat01-")) {
    console.log(`[cli-login] Extracted token from stdout: ${token.slice(0, 20)}...${token.slice(-8)} (${token.length} chars)`);
    return token;
  }

  // Debug: log extraction details for troubleshooting
  console.log("[cli-login] Token extraction debug:");
  console.log(`[cli-login]   - Raw output length: ${output.length} chars`);
  console.log(`[cli-login]   - Token start position: ${tokenStart}`);
  console.log(`[cli-login]   - Extracted length: ${token.length} chars`);
  console.log(`[cli-login]   - Token preview: ${token.slice(0, 30)}...${token.slice(-30)}`);

  // Log the raw bytes around the token end for debugging ANSI/control char issues
  if (tokenStart >= 0) {
    const rawContext = output.slice(tokenStart + 70, tokenStart + 120);
    console.log(`[cli-login]   - Raw context around char 70-120: ${JSON.stringify(rawContext)}`);
  }

  // If token is too long (>150 chars), it likely captured extra text
  if (token.length > 150 && token.startsWith("sk-ant-oat01-")) {
    console.warn(`[cli-login] Token too long (${token.length} chars) - likely captured extra text`);
    // Try to find a valid token by looking for common endings (AA, AAA)
    // OAuth tokens typically end with 'AA' or 'AAA'
    const aaMatch = token.match(/^(sk-ant-oat01-[A-Za-z0-9_-]+?AA)A?(?:[^A-Za-z0-9_-]|[A-Z][a-z])/);
    if (aaMatch?.[1] && aaMatch[1].length >= 80 && aaMatch[1].length <= 150) {
      console.log(`[cli-login] Recovered valid token by finding AA ending: ${aaMatch[1].slice(-10)} (${aaMatch[1].length} chars)`);
      return aaMatch[1];
    }
  }

  return undefined;
}

/**
 * Create account from token extracted from setup-token stdout.
 * Called after CLI exits with token captured.
 *
 * Flow:
 * 1. Validate token structure (OAuth tokens don't work with the public API)
 * 2. Read .claude.json for email and accountUuid
 * 3. Create account with the stdout token
 * 4. CredentialSyncService recreates .credentials.json from accounts.json
 *
 * NOTE: setup-token DELETES .credentials.json during its flow.
 * We do NOT read from .credentials.json here - it won't exist.
 * After account creation, CredentialSyncService recreates it.
 */
async function restoreAndCreateAccount(
  sessionId: string,
  extractedToken: string,
  accountId?: string
): Promise<{ success: boolean; error?: string; email?: string }> {
  const claudeJsonPath = path.join(CLAUDE_HOME_DIR, "..", ".claude.json");

  // Validate the stdout-extracted token structurally
  // OAuth tokens (sk-ant-oat01-*) don't work with the public Messages API,
  // so we can only check structure, not call an endpoint
  console.log(`[cli-login] Validating token from stdout: ${extractedToken.slice(0, 20)}...${extractedToken.slice(-8)} (${extractedToken.length} chars)`);
  const isValid = validateOAuthToken(extractedToken);
  if (!isValid) {
    activeCliLoginSessions.delete(sessionId);
    return { success: false, error: "Token failed structural validation (unexpected format)" };
  }

  // Read email and accountUuid from .claude.json
  let email: string | undefined;
  let accountUuid: string | undefined;
  try {
    if (existsSync(claudeJsonPath)) {
      const content = readFileSync(claudeJsonPath, "utf8");
      const data = JSON.parse(content) as {
        oauthAccount?: { emailAddress?: string; accountUuid?: string };
      };
      email = data.oauthAccount?.emailAddress;
      accountUuid = data.oauthAccount?.accountUuid;
      console.log(`[cli-login] Extracted email from .claude.json: ${email ?? "none"}, accountUuid: ${accountUuid ?? "none"}`);
    }
  } catch (error) {
    console.error("[cli-login] Failed to read .claude.json:", error);
  }

  // Clear bypass flag and clean up
  activeCliLoginSessions.delete(sessionId);
  console.log(`[cli-login] Credential watcher bypass cleared for session ${sessionId}`);

  // Use placeholder email if not available
  if (!email) {
    const tokenSuffix = extractedToken.slice(-8);
    email = `OAuth Account (${tokenSuffix})`;
    console.log(`[cli-login] No email in .claude.json, using placeholder: ${email}`);
  }

  // Build credentials from stdout token - setup-token provides a long-lived token
  // without refresh token (designed for CI/CD / CLAUDE_CODE_OAUTH_TOKEN env var)
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const credentials: CliCredentialsData = {
    accessToken: extractedToken,
    refreshToken: undefined,
    expiresAt: Date.now() + ONE_YEAR_MS,
    scopes: ["user:inference"],
    subscriptionType: undefined,
    rateLimitTier: undefined,
  };

  try {
    const result = await createAccountFromExtractedToken(credentials, email, accountId, accountUuid);
    if (result.success) {
      return { success: true, email };
    }
    return { success: false, error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ============================================================================
// CLI Detection Helpers
// ============================================================================

/**
 * Get common npm global installation paths
 *
 * Includes npm prefix, common fallback paths, and nvm directories
 */
function getNpmGlobalPaths(): string[] {
  const isWindows = process.platform === "win32";
  const homeDir = os.homedir();

  const paths: string[] = [];

  // Try to get npm prefix synchronously
  try {
    const prefix = execSync("npm config get prefix", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();

    if (prefix) {
      if (isWindows) {
        paths.push(prefix);
      } else {
        paths.push(path.join(prefix, "bin"));
      }
    }
  } catch {
    // npm not available, use fallbacks only
  }

  // Add common fallback paths
  if (isWindows) {
    paths.push(
      path.join(homeDir, "AppData", "Roaming", "npm"),
      path.join(homeDir, ".npm-global"),
      path.join("C:", "Program Files", "nodejs")
    );
  } else {
    paths.push(
      "/usr/local/bin",
      "/usr/bin",
      path.join(homeDir, ".npm-global", "bin"),
      path.join(homeDir, ".local", "bin")
    );

    // Add nvm paths if nvm directory exists
    const nvmDir = path.join(homeDir, ".nvm", "versions", "node");
    if (existsSync(nvmDir)) {
      try {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          const binPath = path.join(nvmDir, version, "bin");
          if (existsSync(binPath)) {
            paths.push(binPath);
          }
        }
      } catch {
        // Ignore nvm directory read errors
      }
    }
  }

  return paths;
}

/**
 * Find claude executable in given paths
 *
 * @param searchPaths - Array of directories to search
 * @returns Full path to executable or null if not found
 */
function findClaudeInPaths(searchPaths: string[]): string | null {
  const isWindows = process.platform === "win32";
  const executableNames = isWindows
    ? ["claude.cmd", "claude.exe", "claude"]
    : ["claude"];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) {
      continue;
    }

    for (const execName of executableNames) {
      const fullPath = path.join(searchPath, execName);
      try {
        if (existsSync(fullPath)) {
          // Verify it's a file (not directory)
          const stats = lstatSync(fullPath);
          if (stats.isFile() || stats.isSymbolicLink()) {
            return fullPath;
          }
        }
      } catch {
        // Skip inaccessible paths
      }
    }
  }

  return null;
}

/**
 * Execute a command with timeout and capture output
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise with exit code and output
 */
async function execWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(command, args, {
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        // Expand PATH to include common npm directories
        PATH: [
          process.env.PATH,
          path.join(os.homedir(), ".npm-global", "bin"),
          "/usr/local/bin",
        ]
          .filter(Boolean)
          .join(path.delimiter),
      },
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
      reject(new Error("Command timed out"));
    }, timeoutMs);

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      }
    });
  });
}

/**
 * Verify a specific claude executable works
 *
 * @param executablePath - Full path to claude executable
 * @param timeoutMs - Timeout in milliseconds
 */
async function verifyClaudeExecutable(
  executablePath: string,
  timeoutMs: number
): Promise<CliDetectionResult> {
  try {
    const result = await execWithTimeout(
      executablePath,
      ["--version"],
      timeoutMs
    );

    if (result.exitCode === 0) {
      return {
        installed: true,
        version: result.stdout.trim(),
        executablePath,
      };
    }

    return {
      installed: false,
      error: "execution_error",
      message: `claude --version returned exit code ${result.exitCode}`,
      executablePath,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Command timed out") {
      return {
        installed: false,
        error: "timeout",
        message: "CLI version check timed out",
        executablePath,
      };
    }
    throw error;
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Check if Claude CLI is installed with detailed error reporting
 *
 * Uses 3-tier detection:
 * 1. Try 'which claude' (Unix) or 'where claude' (Windows)
 * 2. Direct execution 'claude --version' with expanded PATH
 * 3. Search common npm global directories
 */
async function checkClaudeCliInstalled(): Promise<CliDetectionResult> {
  const isWindows = process.platform === "win32";
  const halfTimeout = CLI_DETECTION_TIMEOUT_MS / 2;

  console.log("[cli-login] Starting CLI detection...");

  // Step 1: Try 'which' or 'where' to find claude binary
  const locateCmd = isWindows ? "where" : "which";

  try {
    const locateResult = await execWithTimeout(
      locateCmd,
      ["claude"],
      halfTimeout
    );

    if (locateResult.exitCode === 0 && locateResult.stdout.trim()) {
      // Found via which/where - verify it works
      const claudePath = locateResult.stdout.trim().split("\n")[0];
      console.log(`[cli-login] Found claude via ${locateCmd}: ${claudePath}`);
      return await verifyClaudeExecutable(claudePath, halfTimeout);
    }
  } catch {
    // which/where failed or timed out - continue to next method
    console.log(`[cli-login] ${locateCmd} failed, trying direct execution...`);
  }

  // Step 2: Try direct execution with expanded PATH
  try {
    const directResult = await execWithTimeout(
      "claude",
      ["--version"],
      halfTimeout
    );

    if (directResult.exitCode === 0) {
      console.log("[cli-login] Found claude via direct execution");
      return {
        installed: true,
        version: directResult.stdout.trim(),
      };
    }
  } catch {
    // Direct execution failed - continue to path search
    console.log("[cli-login] Direct execution failed, searching npm paths...");
  }

  // Step 3: Search common npm global directories
  const npmGlobalPaths = getNpmGlobalPaths();
  console.log(
    `[cli-login] Searching ${npmGlobalPaths.length} npm global paths...`
  );

  const claudePath = findClaudeInPaths(npmGlobalPaths);

  if (claudePath === null) {
    console.log("[cli-login] Claude CLI not found in any location");
    return {
      installed: false,
      error: "not_found",
      message:
        "Claude CLI not found in PATH or npm global directories. " +
        "Install with: npm install -g @anthropic-ai/claude-code",
    };
  }

  // Found in npm global path - verify it works
  console.log(`[cli-login] Found claude in npm path: ${claudePath}`);
  return await verifyClaudeExecutable(claudePath, halfTimeout);
}

/**
 * Strip ANSI escape sequences from text
 * Handles cursor movement, colors, and other terminal control codes
 */
function stripAnsi(text: string): string {
  // Replace with space (not empty string) to preserve spacing from cursor movement codes
  // Ink (used by Claude CLI) uses cursor codes like \u001B[1C for spacing
   
  return text.replaceAll(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, " ");
}

/**
 * Parse CLI output to determine error type and provide user-friendly message
 * Returns a clean error message instead of raw CLI output
 */
function parseCliError(output: string, exitCode: number): string {
  const cleanOutput = stripAnsi(output).toLowerCase();

  // Check for specific error conditions

  // User didn't enter code in time (CLI internal timeout)
  if (cleanOutput.includes("paste code here") || cleanOutput.includes("enter code")) {
    return "Login timed out waiting for authorization code. Please try again and complete the OAuth flow faster.";
  }

  // Invalid or expired code
  if (cleanOutput.includes("invalid") && cleanOutput.includes("code")) {
    return "Invalid authorization code. Please try again with a fresh code.";
  }

  // Token exchange failed
  if (cleanOutput.includes("token") && (cleanOutput.includes("failed") || cleanOutput.includes("error"))) {
    return "Token exchange failed. The authorization code may have expired. Please try again.";
  }

  // Network/connection errors
  if (cleanOutput.includes("network") || cleanOutput.includes("connection") || cleanOutput.includes("econnrefused")) {
    return "Network error during login. Please check your internet connection and try again.";
  }

  // Permission/scope errors
  if (cleanOutput.includes("scope") && cleanOutput.includes("error")) {
    return "OAuth scope error. The required permissions could not be granted.";
  }

  // Already logged in
  if (cleanOutput.includes("already logged in") || cleanOutput.includes("already authenticated")) {
    return "Already logged in. Please refresh the accounts list.";
  }

  // Generic fallback - don't show raw CLI output with URLs
  // Check if output is mostly URL-encoded garbage
  if (output.includes("%2F") || output.includes("%3A") || output.includes("oauth/authorize")) {
    return `CLI login failed with exit code ${exitCode}. Please try again.`;
  }

  // If we have a short, clean error message, use it
  const lastLine = stripAnsi(output).trim().split("\n").pop()?.trim() ?? "";
  if (lastLine.length > 0 && lastLine.length < 100 && !lastLine.includes("http")) {
    return lastLine;
  }

  return `CLI login failed with exit code ${exitCode}. Please try again.`;
}

/**
 * Extract OAuth URL from CLI output
 * Looks for URLs matching https://claude.ai/oauth/authorize pattern
 * Handles ANSI escape sequences and line wrapping in terminal output
 */
function extractOAuthUrl(output: string): string | undefined {
  // First strip ANSI codes to get clean text
  const cleanOutput = stripAnsi(output);

  // The URL wraps across multiple lines in terminal output due to line width
  // Remove all whitespace (newlines, carriage returns, spaces) to join URL parts
  // The URL in the output looks like:
  //   https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-59
  //   44d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2
  //   Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=...&state=...
  const joinedOutput = cleanOutput.replaceAll(/[\r\n]+/g, "");

  // Match the OAuth URL - capture everything from https://claude.ai/oauth/authorize?
  // until we hit a space, control character, or the [39m color reset pattern
   
  const urlMatch = joinedOutput.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s\u0000-\u001F]*/);

  if (urlMatch?.[0]) {
    // Clean up any trailing garbage that might have been captured
    let url = urlMatch[0];
    // Remove any trailing brackets, color codes, or non-URL characters
    url = url.replace(/[[\]<>]+$/, "");
    // Remove any trailing ANSI remnants like "39m"
    url = url.replace(/\d+m$/, "");
    return url;
  }

  return undefined;
}

/**
 * Start a new CLI login session
 *
 * @param accountId - Optional account ID for re-auth flow. If provided,
 *                    the existing account will be updated after successful login.
 */
async function startCliLogin(
  _req: Request,
  res: Response,
  accountId?: string
): Promise<void> {
  // Auto-clear any stale session lock (user wants to start fresh)
  if (activeLoginSessionId) {
    console.log(`[cli-login] Auto-clearing stale session lock: ${activeLoginSessionId}`);
    const staleProcess = activeSessions.get(activeLoginSessionId);
    if (staleProcess) {
      staleProcess.kill();
      activeSessions.delete(activeLoginSessionId);
    }
    activeLoginSessionId = undefined;
  }

  const sessionId = generateSessionId();
  const sessionStartTime = Date.now();

  // Acquire the session lock
  activeLoginSessionId = sessionId;
  console.log(`[cli-login] Acquired session lock: ${sessionId}`);

  // Track session start time for freshness detection
  sessionStartTimes.set(sessionId, sessionStartTime);

  // Store account ID mapping for re-auth flow
  if (accountId) {
    sessionAccountMap.set(sessionId, accountId);
    console.log(`[cli-login] Starting re-auth session: ${sessionId} for account ${accountId.slice(0, 8)}...`);
  } else {
    console.log(`[cli-login] Starting login session: ${sessionId}`);
  }

  // Spawn CLI directly - works both natively and in Docker
  // In Docker, ~/.claude is mounted so credentials persist to host
  // Check if CLI is installed with improved detection
  const cliCheck = await checkClaudeCliInstalled();
  if (!cliCheck.installed) {
    console.log(
      `[cli-login] CLI detection failed: ${cliCheck.error} - ${cliCheck.message}`
    );

    // Release session lock before early return
    activeLoginSessionId = undefined;
    sessionStartTimes.delete(sessionId);
    if (accountId) {
      sessionAccountMap.delete(sessionId);
    }
    console.log(`[cli-login] Released session lock (CLI not found): ${sessionId}`);

    const response: StartLoginResponse = {
      error: cliCheck.message ?? "Claude CLI is not installed",
      sessionId,
      status: "no_cli",
    };
    res.status(400).json(response);
    return;
  }

  console.log(
    `[cli-login] CLI detected: ${cliCheck.version ?? "version unknown"}${
      cliCheck.executablePath ? ` at ${cliCheck.executablePath}` : ""
    }`
  );

  // Spawn claude setup-token command
  // This outputs a long-lived OAuth token to stdout that works with Messages API
  const claudeCommand = cliCheck.executablePath ?? "claude";
  const isWindows = process.platform === "win32";

  // Use 'script' on Unix to allocate pseudo-TTY (required for OAuth URL output)
  // COLUMNS=300 ensures the PTY is wide enough that the ~108-char token doesn't wrap
  const fullCommand = isWindows
    ? `${claudeCommand} setup-token`
    : `COLUMNS=300 script -qec "${claudeCommand} setup-token" /dev/null`;

  console.log(`[cli-login] Running command: ${fullCommand}`);

  // Mark session as active for credential watcher bypass
  activeCliLoginSessions.add(sessionId);
  console.log(`[cli-login] Credential watcher bypassed for session ${sessionId}`);

  const loginProcess = spawn(fullCommand, [], {
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      // Include expanded PATH for consistency
      PATH: [
        process.env.PATH,
        path.join(os.homedir(), ".npm-global", "bin"),
        "/usr/local/bin",
      ]
        .filter(Boolean)
        .join(path.delimiter),
      // Force color output to be disabled to avoid ANSI codes in output
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      // Prevent CLI from trying to open browser (fails in Docker/headless)
      // CLI will fall back to printing OAuth URL to stdout
      BROWSER: "echo",
      // Wide terminal prevents Ink from wrapping the OAuth token across lines.
      // At 80 cols (Docker default), the ~108-char token wraps and Ink's cursor
      // repositioning codes ([1C]) cause characters to be lost during extraction.
      COLUMNS: "300",
    },
  });

  // Track session
  activeSessions.set(sessionId, loginProcess);

  // Stream CLI output
  let fullOutput = "";
  let oauthUrlExtracted = false;

  loginProcess.stdout?.on("data", (data: Buffer) => {
    const output = data.toString();
    fullOutput += output;

    // Broadcast CLI output to WebSocket
    if (logStreamer) {
      logStreamer.broadcast({
        type: "cli_login_output",
        payload: {
          output,
          sessionId,
        },
      });
    }

    // Try to extract OAuth URL
    if (!oauthUrlExtracted) {
      const oauthUrl = extractOAuthUrl(fullOutput);
      if (oauthUrl) {
        oauthUrlExtracted = true;
        console.log(`[cli-login] OAuth URL extracted for session ${sessionId}`);

        // Extract and store the state parameter from the URL
        // The CLI expects input in format: CODE#STATE (split by #)
        try {
          const urlObj = new URL(oauthUrl);
          const state = urlObj.searchParams.get("state");
          if (state) {
            sessionOAuthState.set(sessionId, state);
            console.log(`[cli-login] OAuth state extracted: ${state.slice(0, 10)}... for session ${sessionId}`);
          }
        } catch {
          console.warn("[cli-login] Failed to parse OAuth URL for state parameter");
        }

        if (logStreamer) {
          logStreamer.broadcast({
            type: "cli_login_url",
            payload: {
              oauthUrl,
              sessionId,
            },
          });
        }
      }
    }

    // Try to extract OAuth token from stdout (setup-token outputs sk-ant-oat01-...)
    if (!sessionExtractedTokens.has(sessionId)) {
      const token = extractOAuthToken(fullOutput);
      if (token) {
        sessionExtractedTokens.set(sessionId, token);
        console.log(`[cli-login] Token extracted from stdout for session ${sessionId}`);
      }
    }
  });

  loginProcess.stderr?.on("data", (data: Buffer) => {
    const output = data.toString();
    fullOutput += output;

    if (logStreamer) {
      logStreamer.broadcast({
        type: "cli_login_output",
        payload: {
          output,
          sessionId,
          isError: true,
        },
      });
    }
  });

  loginProcess.on("exit", (code) => {
    console.log(`[cli-login] Process exited with code ${code} for session ${sessionId}`);
    activeSessions.delete(sessionId);

    // Save raw CLI output for debugging token extraction issues
    const debugDir = path.join(CLAUDE_HOME_DIR, "cli-login-debug");
    try {
      mkdirSync(debugDir, { recursive: true });
      const debugFile = path.join(debugDir, `${sessionId}-output.txt`);
      writeFileSync(debugFile, fullOutput, "utf8");
      console.log(`[cli-login] Saved raw CLI output to: ${debugFile}`);
    } catch (error) {
      console.warn("[cli-login] Failed to save debug output:", error);
    }

    // Release the session lock
    if (activeLoginSessionId === sessionId) {
      activeLoginSessionId = undefined;
      console.log(`[cli-login] Released session lock: ${sessionId}`);
    }

    // Check if token was extracted from stdout
    // setup-token deletes .credentials.json, so stdout is our only source
    const extractedToken = sessionExtractedTokens.get(sessionId);
    const targetAccountId = sessionAccountMap.get(sessionId);

    if (!extractedToken) {
      // No token captured from stdout - clean up and report error
      console.log(`[cli-login] No token extracted for session ${sessionId}`);

      // Clean up bypass flags
      activeCliLoginSessions.delete(sessionId);
      sessionExtractedTokens.delete(sessionId);
      sessionAccountMap.delete(sessionId);
      sessionStartTimes.delete(sessionId);
      sessionOAuthState.delete(sessionId);

      // CRITICAL: Restore credentials.json from existing active account
      // setup-token deletes credentials.json, so we must restore it for Claude CLI to work
      if (moduleAccountManager) {
        void moduleAccountManager.forceSyncActiveCredentials().catch((error) => {
          console.error("[cli-login] Failed to restore credentials.json:", error);
        });
      }

      if (logStreamer) {
        logStreamer.broadcast({
          type: "cli_login_error",
          payload: {
            sessionId,
            exitCode: code ?? -1,
            error: code === 0
              ? "CLI exited successfully but no token was captured. Please try again."
              : parseCliError(fullOutput, code ?? -1),
          },
        });
      }
      return;
    }

    // Token was extracted - wait for file writes to flush, then restore
    // Use 1000ms to handle Docker volume mount latency
    console.log("[cli-login] Token extracted, waiting 1000ms for file flush...");
    setTimeout(() => {
      void restoreAndCreateAccount(sessionId, extractedToken ?? "unknown", targetAccountId)
        .then((result) => {
          console.log("[cli-login] Restore and create result:", result);

          // Clean up remaining session state
          sessionExtractedTokens.delete(sessionId);
          sessionAccountMap.delete(sessionId);
          sessionStartTimes.delete(sessionId);
          sessionOAuthState.delete(sessionId);
    

          if (result.success) {
            // CRITICAL: Ensure credentials.json is synced after successful login
            // setup-token deletes credentials.json, so we must restore it
            if (moduleAccountManager) {
              void moduleAccountManager.forceSyncActiveCredentials().catch((error) => {
                console.error("[cli-login] Failed to sync credentials after success:", error);
              });
            }

            if (logStreamer) {
              logStreamer.broadcast({
                type: "cli_login_complete",
                payload: {
                  sessionId,
                  exitCode: code ?? 0,
                  syncResult: { success: true, email: result.email },
                },
              });

              // Also broadcast credentials_updated so useCredentialUpdates
              // hook fires and other UI components refresh account lists
              logStreamer.broadcastCredentialUpdate({
                accountId: sessionId,
                action: targetAccountId ? "updated" : "added",
                email: result.email ?? "unknown",
                subscriptionType: "unknown",
                syncedAt: new Date().toISOString(),
              });
            }
          } else {
            if (logStreamer) {
              logStreamer.broadcast({
                type: "cli_login_error",
                payload: {
                  sessionId,
                  exitCode: code ?? -1,
                  error: result.error ?? "Failed to create account after token extraction",
                },
              });
            }
          }
        })
        .catch((error: unknown) => {
          console.error("[cli-login] restoreAndCreateAccount error:", error);
          sessionExtractedTokens.delete(sessionId);
          sessionAccountMap.delete(sessionId);
          sessionStartTimes.delete(sessionId);
          sessionOAuthState.delete(sessionId);
    

          if (logStreamer) {
            logStreamer.broadcast({
              type: "cli_login_error",
              payload: {
                sessionId,
                exitCode: code ?? -1,
                error: error instanceof Error ? error.message : "Unknown error during restore",
              },
            });
          }
        });
    }, 1000);
  });

  loginProcess.on("error", (error) => {
    console.error(`[cli-login] Process error: ${error.message}`);
    activeSessions.delete(sessionId);

    if (logStreamer) {
      logStreamer.broadcast({
        type: "cli_login_error",
        payload: {
          sessionId,
          exitCode: -1,
          error: error.message,
        },
      });
    }
  });

  // Timeout handling
  setTimeout(() => {
    if (activeSessions.has(sessionId)) {
      console.log(`[cli-login] Timeout for session ${sessionId}`);
      loginProcess.kill();
      activeSessions.delete(sessionId);

      if (logStreamer) {
        logStreamer.broadcast({
          type: "cli_login_error",
          payload: {
            sessionId,
            exitCode: -1,
            error: "Login timed out after 5 minutes",
          },
        });
      }
    }
  }, CLI_LOGIN_TIMEOUT_MS);

  // Send initial response
  const response: StartLoginResponse = {
    sessionId,
    status: "starting",
  };
  res.json(response);
}

/**
 * Stop all active CLI login sessions
 * Called when dashboard server shuts down
 */
export function stopAllCliLoginSessions(): void {
  console.log(
    `[cli-login] Stopping ${activeSessions.size} active sessions`
  );
  for (const [sessionId, process] of activeSessions.entries()) {
    console.log(`[cli-login] Killing session ${sessionId}`);
    process.kill();
  }
  activeSessions.clear();
  sessionStartTimes.clear();
  sessionExtractedTokens.clear();
  sessionOAuthState.clear();
  activeCliLoginSessions.clear();
  activeLoginSessionId = undefined;
}

/**
 * Set the log streamer for broadcasting CLI output
 * Called during server initialization
 */
export function setCliLoginLogStreamer(
  streamer:
    | {
        broadcast(message: { type: string; payload: unknown }): void;
        broadcastCredentialUpdate(payload: {
          accountId: string;
          action: "added" | "updated";
          email: string;
          subscriptionType: string;
          syncedAt: string;
        }): void;
      }
    | undefined
): void {
  logStreamer = streamer ?? undefined;
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `cli-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create CLI login routes
 *
 * @param accountManager - AccountManager instance for credential operations
 * @param config - Route configuration
 * @returns Express router with CLI login endpoints
 */
export function createCliLoginRoutes(
  accountManager: AccountManager
): Router {
  // Store accountManager at module level for credential sync
  moduleAccountManager = accountManager;

   
  const router = express.Router() as Router;

  // POST /cli-login/start - Start new CLI login session
  // Optional body: { accountId?: string } for re-auth flow
  router.post("/start", async (req: Request, res: Response) => {
    const { accountId } = req.body as { accountId?: string };
    await startCliLogin(req, res, accountId);
  });

  // POST /cli-login/stop - Stop specific login session
  router.post("/stop", (req: Request, res: Response) => {
    const { sessionId } = req.body as { sessionId?: string };

    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    const process = activeSessions.get(sessionId);
    if (process) {
      process.kill();
      activeSessions.delete(sessionId);
      // Release the session lock
      if (activeLoginSessionId === sessionId) {
        activeLoginSessionId = undefined;
        console.log(`[cli-login] Released session lock on stop: ${sessionId}`);
      }
      console.log(`[cli-login] Stopped session ${sessionId}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  // POST /cli-login/submit-code - Submit OAuth code to CLI stdin
  router.post("/submit-code", (req: Request, res: Response) => {
    const { sessionId, code } = req.body as { sessionId?: string; code?: string };

    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }

    // First check if this is a local session
    const cliProcess = activeSessions.get(sessionId);
    if (cliProcess) {
      console.log(`[cli-login] Submitting OAuth code for local session ${sessionId}`);
      console.log(`[cli-login] Code length: ${code.length}, first 20 chars: ${code.slice(0, 20)}...`);

      if (!cliProcess.stdin) {
        console.error(`[cli-login] stdin not available for session ${sessionId}`);
        res.status(500).json({ error: "CLI process stdin not available" });
        return;
      }

      // The CLI expects input in format: AUTHORIZATION_CODE#STATE
      // It splits by '#' and uses both parts for the PKCE token exchange.
      // We extract the state from the OAuth URL during URL extraction phase.
      const oauthState = sessionOAuthState.get(sessionId);
      const fullCode = oauthState ? `${code}#${oauthState}` : code;
      if (oauthState) {
        console.log(`[cli-login] Appending OAuth state to code: ${oauthState.slice(0, 10)}...`);
      } else {
        console.warn(`[cli-login] No OAuth state found for session ${sessionId} - code may be rejected`);
      }

      // Write the code to the CLI process stdin wrapped in bracketed paste markers
      // The CLI uses Ink which enables bracketed paste mode ([?2004h)
      // Without these markers (\x1b[200~ start, \x1b[201~ end), Ink doesn't
      // recognize the input as a paste submission and silently ignores it.
      // CRITICAL: The paste end marker (\x1b[201~) and Enter (\r) MUST be sent
      // separately with a delay. Ink's input parser doesn't process \r correctly
      // when it arrives in the same chunk as the paste end marker.
      const writeSuccess = cliProcess.stdin.write(`\u001B[200~${fullCode}\u001B[201~`);
      console.log(`[cli-login] stdin.write (paste) returned: ${writeSuccess}`);

      // Send Enter after a short delay to ensure Ink processes the paste first
      setTimeout(() => {
        if (cliProcess.stdin) {
          const enterSuccess = cliProcess.stdin.write("\r");
          console.log(`[cli-login] stdin.write (enter) returned: ${enterSuccess}`);
        }
      }, 500);

      // Progress updates to keep user informed while waiting for CLI to complete.
      // All account creation now happens in the process exit handler via restoreAndCreateAccount.
      const maxWaitTime = 120_000; // 2 minutes
      let elapsedTime = 0;
      const pollInterval = 5000;

      // Send an additional Enter keystroke after a short delay
      // The CLI may wait for user acknowledgment after OAuth exchange completes
      setTimeout(() => {
        const proc = activeSessions.get(sessionId);
        if (proc?.stdin) {
          console.log(`[cli-login] Sending follow-up Enter keystroke for session ${sessionId}`);
          proc.stdin.write("\r");
        }
      }, 3000);

      const progressTimer = setInterval(() => {
        elapsedTime += pollInterval;

        if (!activeSessions.has(sessionId)) {
          clearInterval(progressTimer);
          return;
        }

        // Send Enter keystroke periodically - CLI may be waiting for acknowledgment
        const proc = activeSessions.get(sessionId);
        if (proc?.stdin) {
          proc.stdin.write("\r");
        }

        // Broadcast progress
        if (logStreamer) {
          logStreamer.broadcast({
            type: "cli_login_progress",
            payload: {
              sessionId,
              message: `Exchanging OAuth code... (${elapsedTime / 1000}s)`,
              elapsedTime,
            },
          });
        }

        // Check for timeout
        if (elapsedTime >= maxWaitTime) {
          clearInterval(progressTimer);
          if (logStreamer) {
            logStreamer.broadcast({
              type: "cli_login_progress",
              payload: {
                sessionId,
                message: "Finalizing authentication...",
                elapsedTime,
              },
            });
          }
          const proc = activeSessions.get(sessionId);
          if (proc) {
            console.log(`[cli-login] Killing timed out process for session ${sessionId}`);
            proc.kill();
          }
        }
      }, pollInterval);

      res.json({ success: true });
      return;
    }

    console.log(`[cli-login] Session not found: ${sessionId}`);
    console.log(`[cli-login] Active local sessions: ${[...activeSessions.keys()].join(", ") || "(none)"}`);
    res.status(404).json({ error: "Session not found" });
  });

  // GET /cli-login/sessions - List active sessions
  router.get("/sessions", (_req: Request, res: Response) => {
    res.json({
      sessions: [...activeSessions.keys()],
      count: activeSessions.size,
    });
  });

  return router;
}
