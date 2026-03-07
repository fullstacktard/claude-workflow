/**
 * AccountManager - Multi-account OAuth credential manager
 *
 * Manages multiple Claude OAuth accounts stored in ~/.claude-workflow/claude-accounts.json
 * for automatic switching when one account hits rate limits.
 *
 * @example
 * const manager = new AccountManager();
 * await manager.load();
 *
 * // Add account from clipboard credentials
 * const account = await manager.addAccount({
 *   token: { accessToken: '...', refreshToken: '...', ... },
 *   metadata: { alias: 'Work Account', email: 'work@example.com' }
 * });
 *
 * // Switch to account
 * await manager.setActiveAccount(account.id);
 *
 * // Listen for changes
 * manager.on('account-switched', (fromId, toId) => {
 *   console.log(`Switched from ${fromId} to ${toId}`);
 * });
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type {
  Account,
  AccountMetadata,
  AccountsFile,
  OAuthToken,
} from "./types/account.js";
import type { CredentialSyncService } from "./credential-sync.js";
import type { UsageMonitor } from "../dashboard/services/usage-monitor.js";
import type { RotationCandidate } from "../dashboard/services/types/usage.js";
import { systemLogger } from "../dashboard/services/system-logger.js";

// File permissions: owner read/write only (0600 in octal)
const FILE_PERMISSIONS = 0o600;

// Primary location (consolidated folder)
const CLAUDE_WORKFLOW_DIR = path.join(os.homedir(), ".claude-workflow");
const ACCOUNTS_FILE = path.join(CLAUDE_WORKFLOW_DIR, "claude-accounts.json");

// Legacy location (for backward compatibility and migration)
const LEGACY_CCPROXY_DIR = path.join(os.homedir(), ".ccproxy");
const LEGACY_ACCOUNTS_FILE = path.join(LEGACY_CCPROXY_DIR, "accounts.json");

const CURRENT_SCHEMA_VERSION = 1;

// Allow overriding home directory for testing
let customHomeDir: string | undefined = undefined;

/**
 * Set custom home directory (for testing only)
 *
 * @internal
 */
export function setCustomHomeDir(dir: string): void {
  customHomeDir = dir;
}

/**
 * Result of account rotation attempt
 *
 * @example
 * const result = await accountManager.rotateToNextAccount();
 * if (!result.success && result.resetsInMs) {
 *   console.log(`All accounts at capacity. Try again in ${formatDuration(result.resetsInMs)}`);
 * }
 * if (result.selectionReason === 'soonest_reset') {
 *   console.log(`Selected account resets at ${result.resetsAt}`);
 * }
 */
export interface RotationResult {
  /** Whether rotation succeeded */
  success: boolean;
  /** Account ID before rotation */
  previousAccountId: string | null;
  /** Account ID after rotation (null if failed) */
  newAccountId: string | null;
  /** Error message if rotation failed */
  error?: string;
  /** Why this account was selected (when successful or on soonest_reset fallback) */
  selectionReason?: "lowest_utilization" | "soonest_reset" | "first_available";
  /** ISO 8601 timestamp when rate limit resets (when selectionReason is 'soonest_reset') */
  resetsAt?: string;
  /** Milliseconds until rate limit resets (when selectionReason is 'soonest_reset') */
  resetsInMs?: number;
}

/**
 * Format milliseconds into human-readable duration string
 *
 * @example
 * formatDuration(8100000)  // "2h 15m"
 * formatDuration(2700000)  // "45m"
 * formatDuration(150000)   // "2m 30s"
 * formatDuration(45000)    // "45s"
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return "0s";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${String(hours)}h`);
  }
  if (remainingMinutes > 0) {
    parts.push(`${String(remainingMinutes)}m`);
  }
  // Only show seconds if less than 1 hour and there are remaining seconds
  if (hours === 0 && remainingSeconds > 0) {
    parts.push(`${String(remainingSeconds)}s`);
  }
  // Edge case: exactly 0 after rounding
  if (parts.length === 0) {
    parts.push("0s");
  }

  return parts.join(" ");
}

/**
 * Infer subscription type from rate limit tier string
 *
 * Claude API returns different rate limit tiers based on subscription:
 * - "default_claude_max_20x" → Max tier (20x higher limits)
 * - "default" → Pro tier (standard limits)
 *
 * @param rateLimitTier - Rate limit tier string from OAuth credentials
 * @returns Inferred subscription type
 */
export function inferSubscriptionTypeFromTier(rateLimitTier: string): string {
  if (rateLimitTier.includes("max") || rateLimitTier.includes("20x")) {
    return "max";
  }
  // Default tier indicates Pro subscription
  return "pro";
}

/**
 * Options for creating a new account
 */
export interface AddAccountOptions {
  metadata?: Partial<AccountMetadata>;
  token: OAuthToken;
}

/**
 * Options for updating an existing account
 */
export interface UpdateAccountOptions {
  metadata?: Partial<AccountMetadata>;
  token?: Partial<OAuthToken>;
}

export class AccountManager extends EventEmitter {
  private accounts: Map<string, Account> = new Map();
  private activeAccountId: string | null = null;
  private loaded = false;
  private credentialSync: CredentialSyncService | null = null;
  private usageMonitor: UsageMonitor | null = null;
  private savePromise: Promise<void> | null = null;
  // Flag to skip forward sync during CLI import (prevents circular sync)
  private skipForwardSync = false;
  // Cooldown: prevents double rotation when multiple triggers fire concurrently
  private lastRotationTimestamp = 0;
  private static readonly ROTATION_COOLDOWN_MS = 10_000; // 10 seconds

  /**
   * Set the credential sync service
   *
   * When set, automatically syncs credentials on account switches.
   * Also retroactively syncs currently active account if one exists.
   *
   * @param syncService - CredentialSyncService instance
   */
  public setCredentialSyncService(syncService: CredentialSyncService): void {
    this.credentialSync = syncService;

    // Wire event listener for account switches
    this.on("account-switched", (_fromId: string | null, toId: string) => {
      const account = this.accounts.get(toId);
      if (account !== undefined && this.credentialSync !== null) {
        // Pass account metadata (email, accountUuid) to sync service
        // This updates ~/.claude.json so CLI credential watcher can correctly identify the account
        const metadata = {
          email: account.metadata.email,
          accountUuid: account.metadata.accountUuid,
        };
        void this.credentialSync.syncCredentials(account.token, metadata).then((result) => {
          if (!result.success) {
            console.error(
              `[AccountManager] Failed to sync credentials for account ${toId}: ${String(result.error)}`
            );
          }
        });
      }
    });

    // NOTE: Retroactive sync on startup has been REMOVED.
    //
    // Previously, we would sync the active account's token to .credentials.json
    // when setCredentialSyncService was called. This caused a race condition:
    //
    // 1. User runs /login in CLI, logs into new account
    // 2. CLI writes new token to .credentials.json
    // 3. CLI writes new account info to .claude.json
    // 4. Dashboard detects file changes, triggers import
    // 5. BUT: If the dashboard had already loaded accounts and the sync service
    //    was being set up, the retroactive sync would OVERWRITE .credentials.json
    //    with the OLD active account's token before the import could complete
    // 6. Result: .credentials.json has old token, .claude.json has new account = corruption
    //
    // The fix: Don't do retroactive sync. The credentials file should be the
    // source of truth for the CLI. Dashboard syncs happen on explicit actions
    // (account switch, token refresh) not on startup.
  }

  /**
   * Set the usage monitor service
   *
   * When set, enables usage-based rotation selection in rotateToNextAccount().
   *
   * @param monitor - UsageMonitor instance
   */
  public setUsageMonitor(monitor: UsageMonitor): void {
    this.usageMonitor = monitor;
  }

  /**
   * Add a new account to the manager
   *
   * @param options - Account creation options with token and metadata
   * @returns The created account with generated ID
   * @throws Error if account with same accessToken, refreshToken, or email already exists
   */
  public async addAccount(options: AddAccountOptions): Promise<Account> {
    await this.ensureLoaded();

    const operationId = `add-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[AccountManager:ADD] ${operationId} - Starting addAccount`, {
      hasEmail: Boolean(options.metadata?.email),
      email: options.metadata?.email,
      hasAccountUuid: Boolean(options.metadata?.accountUuid),
      accountUuid: options.metadata?.accountUuid?.slice(0, 8),
      currentAccountCount: this.accounts.size,
    });

    // Check for duplicate accounts by multiple criteria
    for (const existing of this.accounts.values()) {
      // Check for duplicate access token
      if (existing.token.accessToken === options.token.accessToken) {
        console.error(`[AccountManager:ADD] ${operationId} - DUPLICATE ACCESS TOKEN detected for existing account ${existing.id.slice(0, 8)}... (${existing.metadata.email ?? "unknown"})`);
        throw new Error("Account with this access token already exists");
      }
      // Check for duplicate refresh token (more stable identifier)
      // Skip when both are empty (long-lived tokens have no refresh token)
      if (
        existing.token.refreshToken &&
        options.token.refreshToken &&
        existing.token.refreshToken === options.token.refreshToken
      ) {
        console.error(`[AccountManager:ADD] ${operationId} - DUPLICATE REFRESH TOKEN detected for existing account ${existing.id.slice(0, 8)}... (${existing.metadata.email ?? "unknown"})`);
        throw new Error("Account with this refresh token already exists");
      }
      // Check for duplicate accountUuid (most stable identifier)
      if (
        options.metadata?.accountUuid &&
        existing.metadata.accountUuid &&
        existing.metadata.accountUuid === options.metadata.accountUuid
      ) {
        console.error(`[AccountManager:ADD] ${operationId} - DUPLICATE ACCOUNT UUID detected for existing account ${existing.id.slice(0, 8)}... (${existing.metadata.email ?? "unknown"})`);
        throw new Error(`Account with accountUuid ${options.metadata.accountUuid} already exists`);
      }
      // Check for duplicate email (case-insensitive, if both have email set)
      if (
        options.metadata?.email &&
        existing.metadata.email &&
        existing.metadata.email.toLowerCase() === options.metadata.email.toLowerCase()
      ) {
        console.error(`[AccountManager:ADD] ${operationId} - DUPLICATE EMAIL detected for existing account ${existing.id.slice(0, 8)}... (${existing.metadata.email})`);
        throw new Error(`Account with email ${options.metadata.email} already exists`);
      }
    }

    const account: Account = {
      id: randomUUID(),
      metadata: {
        addedAt: Date.now(),
        ...options.metadata,
      },
      token: options.token,
    };

    console.log(`[AccountManager:ADD] ${operationId} - Generated new account ID: ${account.id.slice(0, 8)}...`);

    this.accounts.set(account.id, account);

    // If this is the first account, make it active
    const wasFirstAccount = this.accounts.size === 1;
    if (wasFirstAccount) {
      console.log(`[AccountManager:ADD] ${operationId} - First account added, setting as active`);
      this.activeAccountId = account.id;
    }

    console.log(`[AccountManager:ADD] ${operationId} - Saving accounts to disk (total: ${this.accounts.size})`);
    await this.save();

    console.log(`[AccountManager:ADD] ${operationId} - Emitting account-added event`);
    this.emit("account-added", account);

    // Emit account-switched if this account is now active
    if (this.activeAccountId === account.id) {
      console.log(`[AccountManager:ADD] ${operationId} - Emitting account-switched event (first account auto-activated)`);
      this.emit("account-switched", null, account.id);
    }

    console.log(`[AccountManager:ADD] ${operationId} - SUCCESS: Account ${account.id.slice(0, 8)}... added`, {
      email: account.metadata.email,
      isActive: this.activeAccountId === account.id,
      totalAccounts: this.accounts.size,
    });

    return account;
  }

  /**
   * Import credentials from Claude CLI credentials file
   *
   * Reads ~/.claude/.credentials.json (or Docker mount path) and imports
   * credentials into AccountManager. If account already exists (matched by
   * email), updates the existing account. Otherwise, creates new account.
   *
   * @returns The imported/updated account, or null if no credentials found
   * @throws Error if credentials file exists but is invalid JSON
   */
  public async importFromClaudeCli(): Promise<Account | null> {
    await this.ensureLoaded();

    // Set flag to skip forward sync during import - the CLI just wrote fresh
    // credentials, we don't want updateAccount() to overwrite them
    this.skipForwardSync = true;

    try {
      return await this.performCliImport();
    } finally {
      // Always reset the flag, even if import fails
      this.skipForwardSync = false;
    }
  }

  /**
   * Internal implementation of CLI import
   * Separated to allow try/finally wrapper for skipForwardSync flag
   * @private
   */
  private async performCliImport(): Promise<Account | null> {
    // Detect credentials file path
    const credentialsPath = this.detectCliCredentialsPath();

    // Check if credentials file exists
    if (!existsSync(credentialsPath)) {
      systemLogger.info("AccountManager", "CLI credentials file not found");
      return null;
    }

    // Read credentials file
    // Note: accountUuid may be present if dashboard sync wrote the file (new format)
    let credentialsData: {
      claudeAiOauth?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        rateLimitTier: string;
        scopes: string[];
        subscriptionType: string;
      };
      /** Account UUID if present (added by dashboard sync for reliable identification) */
      accountUuid?: string;
    };

    try {
      const content = await readFile(credentialsPath, "utf8");
      credentialsData = JSON.parse(content) as typeof credentialsData;
    } catch (error) {
      throw new Error(
        `Failed to parse CLI credentials file: ${(error as Error).message}`
      );
    }

    // Check if claudeAiOauth exists
    if (
      credentialsData.claudeAiOauth === null ||
      credentialsData.claudeAiOauth === undefined
    ) {
      systemLogger.info("AccountManager", "No claudeAiOauth credentials in CLI file");
      return null;
    }

    const cliToken = credentialsData.claudeAiOauth;

    // Check for accountUuid directly in credentials file (new format from dashboard sync)
    // This is the most reliable source as it's in the same file as the token
    const credentialsAccountUuid = credentialsData.accountUuid;
    if (credentialsAccountUuid !== undefined) {
      console.log(`[AccountManager] Found accountUuid in credentials file: ${credentialsAccountUuid.slice(0, 8)}...`);
    }

    // Get credentials file modification time to detect stale .claude.json
    let credentialsMtime: number | undefined;
    try {
      const credentialsStats = await stat(credentialsPath);
      credentialsMtime = credentialsStats.mtimeMs;
    } catch {
      // If we can't stat the file, proceed without timestamp validation
    }

    // Get email and accountUuid from ~/.claude.json (fallback if not in credentials file)
    // This file is always updated when user authenticates with Claude CLI
    // accountUuid is the most stable identifier (survives token refresh, email changes)
    // Pass credentials mtime to ensure .claude.json is fresh (fixes race condition)
    const { email, accountUuid: claudeJsonAccountUuid } = await this.findEmailFromClaudeJson(credentialsMtime);

    // Prefer accountUuid from credentials file (always fresh), fallback to .claude.json
    const accountUuid = credentialsAccountUuid ?? claudeJsonAccountUuid;

    // Find existing account with priority matching:
    // 1. Match by accountUuid (most reliable - survives token refresh, email changes)
    // 2. Match by email (case-insensitive - handles email case variations)
    // 3. Match by token (handles stale .credentials.json scenarios)
    let existingAccount: Account | undefined;
    // Track how the account was matched for stale credentials detection below
    // (read at line ~436 to handle token-matched-but-identity-mismatch scenario)
    let matchedByToken = false;

    // Priority 1: Match by accountUuid (most reliable)
    if (accountUuid !== undefined) {
      for (const account of this.accounts.values()) {
        if (account.metadata.accountUuid === accountUuid) {
          existingAccount = account;
          console.log(`[AccountManager] Found existing account by accountUuid match: ${account.id.slice(0, 8)}...`);
          break;
        }
      }
    }

    // Priority 2: Match by email (case-insensitive)
    if (existingAccount === undefined && email !== undefined) {
      const emailLower = email.toLowerCase();
      for (const account of this.accounts.values()) {
        if (account.metadata.email?.toLowerCase() === emailLower) {
          existingAccount = account;
          console.log(`[AccountManager] Found existing account by email match: ${account.id.slice(0, 8)}...`);
          break;
        }
      }
    }

    // Priority 3: Match by token (handles stale .credentials.json where .claude.json
    // has new account info but .credentials.json still has old token)
    // This prevents "Account with this access token already exists" errors
    if (existingAccount === undefined) {
      for (const account of this.accounts.values()) {
        if (account.token.accessToken === cliToken.accessToken ||
            account.token.refreshToken === cliToken.refreshToken) {
          existingAccount = account;
          matchedByToken = true;
          console.log(`[AccountManager] Found existing account by token match: ${account.id.slice(0, 8)}... (stale credentials scenario)`);
          console.log(`[AccountManager] Token belongs to account with email: ${account.metadata.email ?? "unknown"}`);
          console.log(`[AccountManager] But .claude.json has email: ${email ?? "unknown"}`);
          break;
        }
      }
    }

    // Infer subscription type from rateLimitTier if not explicitly provided
    const subscriptionType = cliToken.subscriptionType ?? inferSubscriptionTypeFromTier(cliToken.rateLimitTier);

    const token: OAuthToken = {
      accessToken: cliToken.accessToken,
      refreshToken: cliToken.refreshToken,
      expiresAt: cliToken.expiresAt,
      rateLimitTier: cliToken.rateLimitTier,
      scopes: cliToken.scopes,
      subscriptionType,
    };

    // Update existing account or create new one
    if (existingAccount === undefined) {
      systemLogger.info("AccountManager", "Creating new account from CLI credentials");
      const alias = email === undefined ? "CLI Account" : `CLI: ${email}`;
      const newAccount = await this.addAccount({
        token,
        metadata: {
          alias,
          email,
          accountUuid,
        },
      });

      // Set the newly imported account as active - user just logged in with it,
      // so they expect to use it. Don't sync credentials back since CLI just wrote them.
      systemLogger.info("AccountManager", `Setting newly imported account as active: ${newAccount.id.slice(0, 8)}...`);
      this.activeAccountId = newAccount.id;
      await this.save();
      this.emit("account-switched", null, newAccount.id);

      return newAccount;
    }

    // Handle stale credentials scenario: token matched but email/accountUuid don't match
    // This means .credentials.json has old token but .claude.json was updated to new account
    // This is an error state - the user tried to log into a different account but the
    // credentials file wasn't properly updated. We should NOT import and instead return null
    // to signal that the import failed.
    if (matchedByToken) {
      const existingEmail = existingAccount.metadata.email;
      const existingUuid = existingAccount.metadata.accountUuid;

      // Check if this is actually a mismatch (stale credentials)
      const emailMismatch = email !== undefined && existingEmail !== undefined &&
        email.toLowerCase() !== existingEmail.toLowerCase();
      const uuidMismatch = accountUuid !== undefined && existingUuid !== undefined &&
        accountUuid !== existingUuid;

      if (emailMismatch || uuidMismatch) {
        systemLogger.error("AccountManager", "Stale credentials detected - import aborted!", {
          credentialsFileBelongsTo: existingEmail ?? existingUuid ?? "unknown",
          claudeJsonClaimsAccount: email ?? accountUuid ?? "unknown",
          instruction: "Please try logging in again with: claude login",
        });

        // Return null to indicate import failed - don't modify any accounts
        // The user needs to re-login to get fresh credentials
        return null;
      }
    }

    console.log(
      `[AccountManager] Updating existing account: ${existingAccount.id.slice(0, 8)}...`
    );
    await this.updateAccount(existingAccount.id, {
      token,
      metadata: {
        lastUsedAt: Date.now(),
        status: "active",
        // Update accountUuid if we now have it (for accounts created before this field existed)
        ...(accountUuid !== undefined && { accountUuid }),
        // Update email if we now have it (case may have changed, or it was missing)
        ...(email !== undefined && { email }),
      },
    });

    // DO NOT auto-switch for existing accounts - this is likely a token refresh,
    // not a new login. User may have manually selected a different account and
    // shouldn't have it changed without their explicit action.
    // Only NEW accounts (created above) are auto-set as active since that's a fresh login.
    systemLogger.info("AccountManager", `Updated existing account tokens: ${existingAccount.id.slice(0, 8)}... (active account unchanged)`);

    return existingAccount;
  }

  /**
   * Find email and accountUuid from ~/.claude.json oauthAccount field
   *
   * This is the most reliable source as it's always updated when the user
   * authenticates with Claude CLI. The accountUuid is the most stable identifier
   * for matching returning users (survives token refresh, email changes, etc.).
   *
   * @param credentialsMtime - Optional timestamp (ms) of credentials file.
   *   If provided, waits for .claude.json to be at least as fresh to avoid
   *   race conditions where credentials are written before account info.
   * @returns Object with email and accountUuid if found
   * @private
   */
  private async findEmailFromClaudeJson(
    credentialsMtime?: number
  ): Promise<{ email?: string; accountUuid?: string }> {
    // Check both Docker mount and standard home paths
    // PRIORITY ORDER: Docker mount path FIRST, then homedir
    //
    // Why Docker mount first:
    // - In Docker, /app/projects maps to host's home directory via volume mount
    // - /app/projects/.claude.json reflects the host's actual ~/.claude.json
    // - Container-local /home/dashboard/.claude.json can become stale if CLI login
    //   runs inside Docker but doesn't complete properly (the file persists across restarts)
    // - The host file is authoritative since users typically run `claude login` on host
    //
    // In native mode: /app/projects doesn't exist, falls back to homedir path
    const claudeJsonPaths = [
      "/app/projects/.claude.json",          // Docker mount (authoritative)
      path.join(os.homedir(), ".claude.json"), // Homedir (fallback for native mode)
    ];

    // Freshness tolerance: .claude.json should be within 30 seconds of credentials file
    // This handles slight timing differences in how CLI writes the files
    const FRESHNESS_TOLERANCE_MS = 30_000;
    // Max time to wait for .claude.json to be updated
    const MAX_WAIT_MS = 10_000;
    // Poll interval while waiting
    const POLL_INTERVAL_MS = 500;

    const startTime = Date.now();

    while (true) {
      for (const claudeJsonPath of claudeJsonPaths) {
        if (!existsSync(claudeJsonPath)) {
          continue;
        }

        try {
          // Check if file is fresh enough (if we have a reference timestamp)
          if (credentialsMtime !== undefined) {
            const claudeJsonStats = await stat(claudeJsonPath);
            const claudeJsonMtime = claudeJsonStats.mtimeMs;

            // If .claude.json is older than credentials by more than tolerance, it's stale
            if (credentialsMtime - claudeJsonMtime > FRESHNESS_TOLERANCE_MS) {
              const staleness = Math.round((credentialsMtime - claudeJsonMtime) / 1000);
              console.log(`[AccountManager] ${claudeJsonPath} is ${staleness}s older than credentials, waiting for update...`);

              // Check if we've exceeded max wait time
              if (Date.now() - startTime >= MAX_WAIT_MS) {
                console.warn("[AccountManager] Timed out waiting for fresh .claude.json, using stale data");
                // Fall through to read the file anyway
              } else {
                // Wait and retry
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
                break; // Break inner loop to retry all paths
              }
            }
          }

          const content = await readFile(claudeJsonPath, "utf8");
          const data = JSON.parse(content) as {
            oauthAccount?: {
              emailAddress?: string;
              accountUuid?: string;
              displayName?: string;
            };
          };

          const email = data.oauthAccount?.emailAddress;
          const accountUuid = data.oauthAccount?.accountUuid;

          if (email || accountUuid) {
            console.log(`[AccountManager] Found from ${claudeJsonPath}: email=${email ?? "none"}, accountUuid=${accountUuid?.slice(0, 8) ?? "none"}...`);
            return { email, accountUuid };
          }
        } catch (error) {
          // Log but continue to try other paths
          systemLogger.warn("AccountManager", `Failed to read ${claudeJsonPath}`, { error: (error as Error).message });
        }
      }

      // If we've exceeded max wait time or no freshness check needed, exit loop
      if (credentialsMtime === undefined || Date.now() - startTime >= MAX_WAIT_MS) {
        break;
      }

      // Wait before next poll iteration
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return {};
  }

  /**
   * Detect CLI credentials file path based on environment
   *
   * @returns Absolute path to CLI credentials file
   * @private
   */
  private detectCliCredentialsPath(): string {
    // Docker mount path (when running in container)
    const dockerPath = "/home/dashboard/.claude/.credentials.json";
    if (existsSync(path.dirname(dockerPath))) {
      return dockerPath;
    }

    // Standard home directory path
    return path.join(os.homedir(), ".claude", ".credentials.json");
  }

  /**
   * Get the currently active account
   *
   * @returns The active account or undefined if none set
   */
  public async getActiveAccount(): Promise<Account | undefined> {
    await this.ensureLoaded();

    if (this.activeAccountId === null) {
      return undefined;
    }

    return this.accounts.get(this.activeAccountId);
  }

  /**
   * Get the currently active account synchronously (no ensureLoaded)
   *
   * WARNING: Only use this when you know the account manager is already loaded.
   * This is primarily for file watchers that need synchronous access.
   *
   * @returns The active account or undefined if none set or not loaded
   */
  public getActiveAccountSync(): Account | undefined {
    if (this.activeAccountId === null) {
      return undefined;
    }
    return this.accounts.get(this.activeAccountId);
  }

  /**
   * Force sync the active account's credentials to ~/.claude/.credentials.json
   *
   * This is useful when the CLI deletes credentials.json (e.g., during setup-token)
   * and we need to restore it from the active account.
   *
   * @returns Promise that resolves when sync completes (or immediately if no active account)
   */
  public async forceSyncActiveCredentials(): Promise<void> {
    await this.ensureLoaded();

    if (this.activeAccountId === null || this.credentialSync === null) {
      console.log("[AccountManager] forceSyncActiveCredentials: No active account or sync service");
      return;
    }

    const account = this.accounts.get(this.activeAccountId);
    if (account === undefined) {
      console.log("[AccountManager] forceSyncActiveCredentials: Active account not found");
      return;
    }

    console.log(`[AccountManager] forceSyncActiveCredentials: Syncing account ${this.activeAccountId.slice(0, 8)}...`);
    const metadata = {
      email: account.metadata.email,
      accountUuid: account.metadata.accountUuid,
    };

    const result = await this.credentialSync.syncCredentials(account.token, metadata);
    if (result.success) {
      console.log(`[AccountManager] forceSyncActiveCredentials: SUCCESS - credentials synced to ${result.path}`);
    } else {
      console.error(`[AccountManager] forceSyncActiveCredentials: FAILED - ${result.error}`);
    }
  }

  /**
   * Get all stored accounts
   *
   * @returns Array of all accounts
   */
  public async getAccounts(): Promise<Account[]> {
    await this.ensureLoaded();
    return [...this.accounts.values()];
  }

  /**
   * Get a specific account by ID
   *
   * @param accountId - The account ID to retrieve
   * @returns The account or undefined if not found
   */
  public async getAccount(accountId: string): Promise<Account | undefined> {
    await this.ensureLoaded();
    return this.accounts.get(accountId);
  }

  /**
   * Fetch and update email for an account from the Claude API
   *
   * Uses the account's access token to fetch profile information
   * and updates the account's email field if successful.
   *
   * @param accountId - The account ID to fetch email for
   * @returns The email if found and updated, undefined if failed
   */
  public async fetchAccountEmail(accountId: string): Promise<string | undefined> {
    await this.ensureLoaded();

    const account = this.accounts.get(accountId);
    if (account === undefined) {
      console.log(`[AccountManager] Account ${accountId} not found`);
      return undefined;
    }

    // Don't refetch if we already have an email
    if (account.metadata.email) {
      console.log(`[AccountManager] Account ${accountId} already has email: ${account.metadata.email}`);
      return account.metadata.email;
    }

    // Check if token is expired
    if (account.token.expiresAt < Date.now()) {
      console.log(`[AccountManager] Account ${accountId} token is expired`);
      return undefined;
    }

    try {
      const profileResponse = await fetch("https://api.claude.ai/api/me", {
        headers: {
          Authorization: `Bearer ${account.token.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!profileResponse.ok) {
        console.warn(
          `[AccountManager] Profile API returned ${profileResponse.status}: ${profileResponse.statusText}`
        );
        return undefined;
      }

      const profileData = (await profileResponse.json()) as {
        email?: string;
        email_address?: string;
        account?: { email_address?: string };
      };

      // Try multiple possible field names for email
      const email = profileData.email ?? profileData.email_address ?? profileData.account?.email_address;

      if (email === undefined) {
        systemLogger.info("AccountManager", "Profile API did not return email");
        return undefined;
      }

      // Update account with email
      await this.updateAccount(accountId, {
        metadata: {
          email,
          alias: `CLI: ${email}`,
        },
      });

      console.log(`[AccountManager] Updated email for ${accountId}: ${email}`);
      return email;
    } catch (error) {
      console.warn(
        "[AccountManager] Failed to fetch user profile for email:",
        error
      );
      return undefined;
    }
  }

  /**
   * Fetch emails for all accounts that don't have one
   *
   * Iterates through all accounts and attempts to fetch email
   * from the API for accounts missing this information.
   *
   * @returns Map of account ID to fetched email (only includes successful fetches)
   */
  public async fetchAllMissingEmails(): Promise<Map<string, string>> {
    await this.ensureLoaded();

    const results = new Map<string, string>();

    for (const account of this.accounts.values()) {
      // Skip accounts that already have email
      if (account.metadata.email) {
        continue;
      }

      // Skip expired tokens
      if (account.token.expiresAt < Date.now()) {
        continue;
      }

      const email = await this.fetchAccountEmail(account.id);
      if (email !== undefined) {
        results.set(account.id, email);
      }
    }

    return results;
  }

  /**
   * Load accounts from disk
   * Creates empty file if it doesn't exist
   * Checks new location first (~/.claude-workflow/), falls back to legacy (~/.ccproxy/)
   */
  public async load(): Promise<void> {
    // Use custom home directory if set (for testing)
    const workflowDir =
      customHomeDir === undefined
        ? CLAUDE_WORKFLOW_DIR
        : path.join(customHomeDir, ".claude-workflow");
    const accountsFile =
      customHomeDir === undefined
        ? ACCOUNTS_FILE
        : path.join(customHomeDir, ".claude-workflow", "claude-accounts.json");
    const legacyAccountsFile =
      customHomeDir === undefined
        ? LEGACY_ACCOUNTS_FILE
        : path.join(customHomeDir, ".ccproxy", "accounts.json");

    // Ensure primary directory exists
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { mode: 0o700, recursive: true });
    }

    // Determine which file to load: new location first, then legacy
    let fileToLoad: string | null = null;
    if (existsSync(accountsFile)) {
      fileToLoad = accountsFile;
    } else if (existsSync(legacyAccountsFile)) {
      fileToLoad = legacyAccountsFile;
      systemLogger.info("AccountManager", "Using legacy accounts file, will migrate on next save");
    }

    // Load existing file or create empty structure
    if (fileToLoad !== null) {
      try {
        const content = await readFile(fileToLoad, "utf8");
        const data = JSON.parse(content) as AccountsFile;

        // Validate schema version
        if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
          console.warn(
            `[AccountManager] Schema version mismatch: expected ${String(CURRENT_SCHEMA_VERSION)}, got ${String(data.schemaVersion)}`
          );
          // Future: add migration logic here
        }

        // Load accounts into map
        this.accounts.clear();
        for (const account of data.accounts) {
          this.accounts.set(account.id, account);
        }

        this.activeAccountId = data.activeAccountId;
      } catch (error) {
        console.error(
          `[AccountManager] Failed to load accounts: ${(error as Error).message}`
        );
        // Start with empty state on error
        this.accounts.clear();
        this.activeAccountId = null;
      }
    }

    this.loaded = true;

    // Initial import of CLI credentials if no accounts exist yet
    // This handles the case where user already has CLI credentials but dashboard
    // is starting fresh. The credential watcher only reacts to CHANGES, not existing files.
    if (this.accounts.size === 0) {
      systemLogger.info("AccountManager", "No accounts found, checking for existing CLI credentials to import");
      try {
        const imported = await this.importFromClaudeCli();
        if (imported === null) {
          systemLogger.info("AccountManager", "No CLI credentials found to import");
        } else {
          systemLogger.info("AccountManager", `Initial import successful: ${imported.id.slice(0, 8)}... (${imported.metadata.email ?? "unknown"})`);
        }
      } catch (error) {
        // Don't fail startup if initial import fails
        systemLogger.warn("AccountManager", `Initial CLI import failed: ${(error as Error).message}`);
      }
    } else {
      systemLogger.info("AccountManager", `Loaded ${this.accounts.size} existing account(s)`);
    }
  }

  /**
   * Remove an account by ID
   *
   * @param accountId - The account ID to remove
   * @returns true if account was removed, false if not found
   * @throws Error if trying to remove the only active account
   */
  public async removeAccount(accountId: string): Promise<boolean> {
    await this.ensureLoaded();

    const operationId = `remove-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[AccountManager:REMOVE] ${operationId} - Starting removeAccount for ${accountId.slice(0, 8)}...`);

    if (!this.accounts.has(accountId)) {
      console.warn(`[AccountManager:REMOVE] ${operationId} - Account ${accountId.slice(0, 8)}... not found`);
      return false;
    }

    const account = this.accounts.get(accountId)!;
    const wasActive = this.activeAccountId === accountId;

    console.log(`[AccountManager:REMOVE] ${operationId} - Removing account ${accountId.slice(0, 8)}...`, {
      email: account.metadata.email,
      wasActive,
      totalAccountsBefore: this.accounts.size,
    });

    // If removing active account, switch to another or clear
    if (this.activeAccountId === accountId) {
      const remainingAccounts = [...this.accounts.keys()].filter(
        (id) => id !== accountId
      );

      console.log(`[AccountManager:REMOVE] ${operationId} - Removing active account, ${remainingAccounts.length} accounts remaining`);

      if (remainingAccounts.length > 0) {
        // Prefer healthy accounts (not needs_reauth, not expired) over degraded ones
        const healthyAccount = remainingAccounts.find((id) => {
          const a = this.accounts.get(id);
          return a !== undefined &&
            a.metadata.status !== "needs_reauth" &&
            a.token.expiresAt > Date.now();
        });
        const newActiveId = healthyAccount ?? remainingAccounts[0];
        const oldActiveId = this.activeAccountId;
        this.activeAccountId = newActiveId;

        console.log(`[AccountManager:REMOVE] ${operationId} - Switching active account from ${oldActiveId?.slice(0, 8)}... to ${newActiveId.slice(0, 8)}...`);
        this.emit("account-switched", oldActiveId, newActiveId);
      } else {
        console.log(`[AccountManager:REMOVE] ${operationId} - No remaining accounts, clearing active account`);
        this.activeAccountId = null;
      }
    }

    this.accounts.delete(accountId);

    console.log(`[AccountManager:REMOVE] ${operationId} - Saving accounts to disk (remaining: ${this.accounts.size})`);
    await this.save();

    console.log(`[AccountManager:REMOVE] ${operationId} - Emitting account-removed event`);
    this.emit("account-removed", accountId);

    console.log(`[AccountManager:REMOVE] ${operationId} - SUCCESS: Account ${accountId.slice(0, 8)}... removed`, {
      totalAccountsAfter: this.accounts.size,
      newActiveAccount: this.activeAccountId?.slice(0, 8),
    });

    return true;
  }

  /**
   * Set the active account
   *
   * @param accountId - The account ID to make active
   * @throws Error if account doesn't exist
   */
  public async setActiveAccount(accountId: string): Promise<void> {
    await this.ensureLoaded();

    const operationId = `setActive-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Request to set account ${accountId.slice(0, 8)}... as active`);

    if (!this.accounts.has(accountId)) {
      console.error(`[AccountManager:SET-ACTIVE] ${operationId} - ERROR: Account ${accountId.slice(0, 8)}... not found`);
      throw new Error(`Account not found: ${accountId}`);
    }

    const previousId = this.activeAccountId;
    const account = this.accounts.get(accountId)!;

    console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Switching active account`, {
      from: previousId?.slice(0, 8),
      fromEmail: previousId ? this.accounts.get(previousId)?.metadata.email : null,
      to: accountId.slice(0, 8),
      toEmail: account.metadata.email,
    });

    this.activeAccountId = accountId;

    // Update lastUsedAt
    if (account !== undefined) {
      account.metadata.lastUsedAt = Date.now();
    }

    console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Saving accounts to disk`);
    await this.save();

    // Sync credentials.json so claude-proxy uses the new active account
    console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Syncing credentials.json for new active account`);
    await this.forceSyncActiveCredentials();

    if (previousId === accountId) {
      console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Account was already active, no event emitted`);
    } else {
      console.log(`[AccountManager:SET-ACTIVE] ${operationId} - Emitting account-switched event`);
      this.emit("account-switched", previousId, accountId);
    }

    console.log(`[AccountManager:SET-ACTIVE] ${operationId} - SUCCESS: Account ${accountId.slice(0, 8)}... is now active`);
  }

  /** Backoff schedule for needs_reauth retries: 5min, 15min, 1h, 4h */
  private static readonly REAUTH_BACKOFF_MS = [
    5 * 60 * 1000,     // 5 minutes
    15 * 60 * 1000,    // 15 minutes
    60 * 60 * 1000,    // 1 hour
    4 * 60 * 60 * 1000, // 4 hours
  ];

  /**
   * Refresh OAuth token for an account
   *
   * Attempts to refresh the access token using the stored refresh token.
   * Updates the account with new tokens on success, or marks it as
   * needing re-authentication on permanent failure.
   *
   * For accounts already marked needs_reauth, uses exponential backoff
   * (5min, 15min, 1h, 4h) before retrying. After 4 retries exhausted,
   * stops retrying.
   *
   * @param accountId - The account ID to refresh
   * @returns true if refresh succeeded, false if account not found or refresh failed permanently
   * @throws Error if refresh fails due to network or API issues (non-permanent)
   */
  public async refreshAccountToken(accountId: string): Promise<boolean> {
    await this.ensureLoaded();

    const account = this.accounts.get(accountId);
    if (account === undefined) {
      return false;
    }

    // Backoff-aware guard for needs_reauth accounts
    if (account.metadata.status === "needs_reauth") {
      const retryCount = account.metadata.refreshRetryCount ?? 0;
      const maxRetries = AccountManager.REAUTH_BACKOFF_MS.length;

      // All retries exhausted - permanently dead
      if (retryCount >= maxRetries) {
        systemLogger.info("AccountManager", `Account ${accountId.slice(0, 8)} exhausted all ${maxRetries} re-auth retries, skipping refresh`);
        return false;
      }

      // Check if enough time has passed since last retry
      const lastRetryAt = account.metadata.lastRefreshRetryAt;
      if (lastRetryAt) {
        const backoffMs = AccountManager.REAUTH_BACKOFF_MS[retryCount];
        const elapsed = Date.now() - new Date(lastRetryAt).getTime();
        if (elapsed < backoffMs) {
          const remainingMs = backoffMs - elapsed;
          systemLogger.info("AccountManager", `Account ${accountId.slice(0, 8)} re-auth retry ${retryCount + 1}/${maxRetries} not yet due (${formatDuration(remainingMs)} remaining)`);
          return false;
        }
      }

      // Backoff window has passed - attempt retry
      systemLogger.info("AccountManager", `Account ${accountId.slice(0, 8)} attempting re-auth retry ${retryCount + 1}/${maxRetries}`);
    }

    // Don't refresh long-lived tokens (they have no refresh token)
    if (!account.token.refreshToken || account.token.refreshToken.length === 0) {
      systemLogger.info("AccountManager", `Account ${accountId.slice(0, 8)} is a long-lived token, skipping refresh`);
      return true; // Return true since the token is still valid (doesn't need refresh)
    }

    const wasNeedsReauth = account.metadata.status === "needs_reauth";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10_000);

      try {
        const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "anthropic-beta": "oauth-2025-04-20",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: account.token.refreshToken,
          }).toString(),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Check for permanent failures (401, 403, 400)
          if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 400
          ) {
            const now = new Date().toISOString();
            const retryCount = (account.metadata.refreshRetryCount ?? 0) + (wasNeedsReauth ? 1 : 0);

            // Mark account as needing re-authentication with retry tracking
            await this.updateAccount(accountId, {
              metadata: {
                status: "needs_reauth",
                needsReauthSince: account.metadata.needsReauthSince ?? now,
                refreshRetryCount: retryCount,
                lastRefreshRetryAt: wasNeedsReauth ? now : account.metadata.lastRefreshRetryAt,
              },
            });
            systemLogger.error("AccountManager", `Token refresh failed for ${accountId.slice(0, 8)}: Refresh token invalid or expired (retry ${retryCount}/${AccountManager.REAUTH_BACKOFF_MS.length})`);
            return false;
          }

          throw new Error(`OAuth refresh failed: HTTP ${response.status}`);
        }

        const tokenData = (await response.json()) as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
          token_type: string;
        };

        const newExpiresAt = Date.now() + tokenData.expires_in * 1000;

        // Update account with new tokens and clear all retry metadata
        await this.updateAccount(accountId, {
          token: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token ?? account.token.refreshToken,
            expiresAt: newExpiresAt,
          },
          metadata: {
            status: "active",
            needsReauthSince: undefined,
            refreshRetryCount: undefined,
            lastRefreshRetryAt: undefined,
          },
        });

        systemLogger.info("AccountManager", `Token refreshed successfully for ${accountId.slice(0, 8)}, expires at ${new Date(newExpiresAt).toISOString()}`);
        return true;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      systemLogger.error("AccountManager", `Token refresh failed for ${accountId.slice(0, 8)}`, { error: String(error) });
      throw error; // Re-throw for caller to handle
    }
  }

  /**
   * Update an existing account
   *
   * @param accountId - The account ID to update
   * @param options - Fields to update
   * @returns The updated account
   * @throws Error if account doesn't exist
   */
  public async updateAccount(
    accountId: string,
    options: UpdateAccountOptions
  ): Promise<Account> {
    await this.ensureLoaded();

    const account = this.accounts.get(accountId);
    if (account === undefined) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Update token fields
    if (options.token !== undefined) {
      account.token = {
        ...account.token,
        ...options.token,
      };
    }

    // Update metadata fields
    if (options.metadata !== undefined) {
      account.metadata = {
        ...account.metadata,
        ...options.metadata,
      };
    }

    await this.save();
    this.emit("account-updated", account);

    // Forward sync: If this is the active account AND token was updated,
    // sync to .credentials.json so proxy container has fresh tokens
    // SKIP if we're importing from CLI (skipForwardSync flag) - the CLI just wrote
    // fresh credentials, don't overwrite them with the active account's old credentials
    if (
      this.credentialSync !== null &&
      this.activeAccountId === accountId &&
      options.token !== undefined &&
      !this.skipForwardSync
    ) {
      // Pass account metadata (email, accountUuid) to sync service
      // This updates ~/.claude.json so CLI credential watcher can correctly identify the account
      const metadata = {
        email: account.metadata.email,
        accountUuid: account.metadata.accountUuid,
      };
      void this.credentialSync
        .syncCredentials(account.token, metadata)
        .then((result) => {
          if (result.success) {
            console.log(
              `[AccountManager] Forward sync complete for active account ${accountId.slice(0, 8)}`
            );
          } else {
            // Log failure but don't block - sync errors are non-critical
            console.error(
              `[AccountManager] Forward sync failed for account ${accountId.slice(0, 8)}: ${String(result.error)}`
            );
          }
        });
    }

    return account;
  }

  /**
   * Mark an account as rate-limited
   *
   * When an account hits a rate limit (429 error), mark it as temporarily
   * unavailable. This is different from token expiration - the token is
   * still valid, but usage limits have been reached.
   *
   * IMPORTANT: Do NOT attempt to refresh the token when rate-limited.
   * Long-lived OAuth tokens (sk-ant-oat01-...) are valid for 1 year
   * and don't need refreshing - they just need to cool down.
   *
   * @param accountId - The account ID to mark as rate-limited
   * @param resetsAt - Optional ISO 8601 timestamp when rate limit resets (from usage API)
   * @returns true if account was marked, false if not found
   *
   * @example
   * // On 429 error from API:
   * await manager.markAccountRateLimited(accountId, response.headers['x-ratelimit-reset']);
   * await manager.rotateToNextAccount();
   */
  public async markAccountRateLimited(
    accountId: string,
    resetsAt?: string
  ): Promise<boolean> {
    await this.ensureLoaded();

    const account = this.accounts.get(accountId);
    if (account === undefined) {
      return false;
    }

    const now = new Date().toISOString();

    await this.updateAccount(accountId, {
      metadata: {
        status: "rate_limited",
        rateLimitedAt: now,
        rateLimitResetsAt: resetsAt,
      },
    });

    console.log(
      `[AccountManager] Account ${accountId.slice(0, 8)}... marked as rate_limited` +
        (resetsAt === undefined ? "" : ` (resets at ${resetsAt})`)
    );

    return true;
  }

  /**
   * Clear rate-limited status from an account
   *
   * Called when cooldown period has passed or when manually clearing.
   *
   * @param accountId - The account ID to clear rate limit status from
   * @returns true if cleared, false if not found or not rate-limited
   */
  public async clearRateLimitStatus(accountId: string): Promise<boolean> {
    await this.ensureLoaded();

    const account = this.accounts.get(accountId);
    if (account === undefined || account.metadata.status !== "rate_limited") {
      return false;
    }

    await this.updateAccount(accountId, {
      metadata: {
        status: "active",
        rateLimitedAt: undefined,
        rateLimitResetsAt: undefined,
      },
    });

    console.log(
      `[AccountManager] Account ${accountId.slice(0, 8)}... rate limit cleared, now active`
    );

    return true;
  }

  /**
   * Check if a rate-limited account's cooldown has expired
   *
   * @param account - The account to check
   * @returns true if cooldown has expired (account is available again)
   */
  private isRateLimitCooldownExpired(account: { metadata: { status?: string; rateLimitResetsAt?: string } }): boolean {
    // Not rate-limited, so no cooldown
    if (account.metadata.status !== "rate_limited") {
      return true;
    }

    // If we have a reset time, check if it's passed
    if (account.metadata.rateLimitResetsAt !== undefined) {
      const resetTime = new Date(account.metadata.rateLimitResetsAt).getTime();
      const now = Date.now();
      return now >= resetTime;
    }

    // No reset time available - conservatively say cooldown hasn't expired
    // This is a fallback when the API doesn't provide reset timing
    return false;
  }

  /**
   * Rotate to the next available account for rate limit handling.
   *
   * Selection logic:
   * 1. When UsageMonitor is available: Use getBestAccountForRotation() to select
   *    account with lowest utilization (or soonest reset if all exhausted)
   * 2. When UsageMonitor unavailable: Fall back to first available account
   *
   * Filters applied to all candidates:
   * - Not the current account
   * - Not needing re-authentication
   * - Not expired
   * - Not rate-limited (unless cooldown has expired)
   *
   * @returns RotationResult with selection reason and reset timing info
   *
   * @example
   * const result = await manager.rotateToNextAccount();
   * if (!result.success && result.resetsInMs) {
   *   console.log(`Try again in ${formatDuration(result.resetsInMs)}`);
   * }
   */
  public async rotateToNextAccount(): Promise<RotationResult> {
    await this.ensureLoaded();

    // Cooldown guard: if we rotated within the last 10s, return current account as success
    // Prevents double rotation when proactive (UsageMonitor) and reactive (hooks) triggers fire concurrently
    const now = Date.now();
    if (now - this.lastRotationTimestamp < AccountManager.ROTATION_COOLDOWN_MS) {
      const currentId = this.activeAccountId;
      systemLogger.info("AccountManager", `Rotation cooldown active (last rotation ${String(now - this.lastRotationTimestamp)}ms ago), skipping`);
      return {
        success: true,
        previousAccountId: currentId,
        newAccountId: currentId,
        selectionReason: "first_available",
      };
    }

    const currentId = this.activeAccountId;

    // Check if current active account is pinned - refuse rotation
    if (currentId !== null) {
      const currentAccount = this.accounts.get(currentId);
      if (currentAccount?.metadata.pinned === true) {
        systemLogger.info("AccountManager", `Account ${currentId.slice(0, 8)}... is pinned, refusing auto-rotation`);
        return {
          success: false,
          previousAccountId: currentId,
          newAccountId: null,
          error: "Account is pinned",
        };
      }
    }

    const accounts = [...this.accounts.values()];

    // Clear rate-limit status for accounts whose cooldown has expired
    // This allows them to be candidates again
    for (const account of accounts) {
      if (
        account.metadata.status === "rate_limited" &&
        this.isRateLimitCooldownExpired(account)
      ) {
        // Fire-and-forget - don't block rotation on this
        void this.clearRateLimitStatus(account.id);
        // Update in-memory status for immediate candidate consideration
        account.metadata.status = "active";
        account.metadata.rateLimitedAt = undefined;
        account.metadata.rateLimitResetsAt = undefined;
      }
    }

    // Find next available account:
    // - Not current account
    // - Not needing re-authentication
    // - Not expired
    // - Not rate-limited (unless cooldown has expired - handled above)
    const candidates = accounts.filter(
      (a) =>
        a.id !== currentId &&
        a.metadata.status !== "needs_reauth" &&
        a.metadata.status !== "rate_limited" &&
        a.token.expiresAt > Date.now()
    );

    if (candidates.length === 0) {
      // No candidates available - check if we can provide reset timing info
      // from UsageMonitor for the soonest-to-reset account
      if (this.usageMonitor !== null && currentId !== null) {
        // Get best candidate considering ALL accounts (even the current one)
        // since we have no valid candidates to switch to
        const soonestCandidate = this.usageMonitor.getBestAccountForRotation();

        if (
          soonestCandidate !== undefined &&
          soonestCandidate.selectionReason === "soonest_reset"
        ) {
          const humanReadable = formatDuration(soonestCandidate.resetsInMs);
          const errorMsg = `No available accounts for rotation (all accounts exhausted, soonest reset in ${humanReadable})`;

          console.log(
            `[AccountManager] All accounts exhausted. Soonest reset: ${soonestCandidate.accountId.slice(0, 8)}... in ${humanReadable}`
          );

          return {
            success: false,
            previousAccountId: currentId,
            newAccountId: null,
            error: errorMsg,
            selectionReason: "soonest_reset",
            resetsAt: soonestCandidate.resetsAt,
            resetsInMs: soonestCandidate.resetsInMs,
          };
        }
      }

      return {
        success: false,
        previousAccountId: currentId,
        newAccountId: null,
        error: "No available accounts for rotation",
      };
    }

    // Select next account using usage-based selection if available
    let nextAccountId: string;
    let selectionReason: RotationResult["selectionReason"];
    let rotationCandidate: RotationCandidate | undefined;

    if (this.usageMonitor !== null && currentId !== null) {
      rotationCandidate = this.usageMonitor.getBestAccountForRotation(currentId);

      if (rotationCandidate === undefined) {
        // UsageMonitor has no data - fall back to first available
        nextAccountId = candidates[0].id;
        selectionReason = "first_available";
        console.log(
          "[AccountManager] No usage data available, selecting first available account"
        );
      } else {
        // Verify the suggested account is in our filtered candidates
        const isValidCandidate = candidates.some(
          (c) => c.id === rotationCandidate!.accountId
        );

        if (isValidCandidate) {
          nextAccountId = rotationCandidate.accountId;
          selectionReason = rotationCandidate.selectionReason;
          console.log(
            `[AccountManager] Usage-based selection: ${nextAccountId.slice(0, 8)}... ` +
              `(reason: ${selectionReason}, utilization: ${String(rotationCandidate.utilization)}%)`
          );
        } else {
          // UsageMonitor suggested an account we filtered out - fall back to first available
          nextAccountId = candidates[0].id;
          selectionReason = "first_available";
          rotationCandidate = undefined;
          console.log(
            "[AccountManager] Usage-based candidate not in filtered list, falling back to first available"
          );
        }
      }
    } else {
      // No UsageMonitor available - use first available (existing behavior)
      nextAccountId = candidates[0].id;
      selectionReason = "first_available";
    }

    const nextAccount = candidates.find((c) => c.id === nextAccountId);
    if (nextAccount === undefined) {
      // Should never happen, but handle gracefully
      return {
        success: false,
        previousAccountId: currentId,
        newAccountId: null,
        error: "Selected account not found in candidates",
      };
    }

    await this.setActiveAccount(nextAccount.id);

    // Wait for credential sync to complete (critical for rotation to be effective)
    if (this.credentialSync !== null) {
      // Pass account metadata (email, accountUuid) to sync service
      // This updates ~/.claude.json so CLI credential watcher can correctly identify the account
      const metadata = {
        email: nextAccount.metadata.email,
        accountUuid: nextAccount.metadata.accountUuid,
      };
      const syncResult = await this.credentialSync.syncCredentials(
        nextAccount.token,
        metadata
      );
      if (!syncResult.success) {
        console.error(
          `[AccountManager] Rotation sync failed: ${String(syncResult.error)}`
        );
        return {
          success: false,
          previousAccountId: currentId,
          newAccountId: nextAccount.id,
          selectionReason,
          error: `Rotation succeeded but credential sync failed: ${String(syncResult.error)}`,
          // Include reset timing if soonest_reset was the selection reason
          ...(rotationCandidate !== undefined &&
            selectionReason === "soonest_reset" && {
            resetsAt: rotationCandidate.resetsAt,
            resetsInMs: rotationCandidate.resetsInMs,
          }),
        };
      }
    }

    console.log(
      `[AccountManager] Rotated from ${currentId?.slice(0, 8) ?? "none"}... to ${nextAccount.id.slice(0, 8)}...`
    );

    // Stamp cooldown to prevent concurrent triggers from double-rotating
    this.lastRotationTimestamp = Date.now();

    return {
      success: true,
      previousAccountId: currentId,
      newAccountId: nextAccount.id,
      selectionReason,
      // Include reset timing if soonest_reset was the selection reason
      ...(rotationCandidate !== undefined &&
        selectionReason === "soonest_reset" && {
        resetsAt: rotationCandidate.resetsAt,
        resetsInMs: rotationCandidate.resetsInMs,
      }),
    };
  }

  /**
   * Get the file path for accounts storage
   * Returns new location if exists, otherwise legacy location if exists,
   * otherwise returns new location (for new installations)
   */
  public static getAccountsFilePath(): string {
    if (existsSync(ACCOUNTS_FILE)) {
      return ACCOUNTS_FILE;
    }
    if (existsSync(LEGACY_ACCOUNTS_FILE)) {
      return LEGACY_ACCOUNTS_FILE;
    }
    // Default to new location for new installations
    return ACCOUNTS_FILE;
  }

  /**
   * Ensure accounts are loaded before operations
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Save accounts to disk atomically
   * Writes to temp file then renames to ensure atomic operation
   * Always saves to new location (~/.claude-workflow/)
   */
  private async save(): Promise<void> {
    const saveId = `save-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[AccountManager:SAVE] ${saveId} - Starting save operation`, {
      accountCount: this.accounts.size,
      activeAccountId: this.activeAccountId?.slice(0, 8),
    });

    // Use custom home directory if set (for testing)
    const workflowDir =
      customHomeDir === undefined
        ? CLAUDE_WORKFLOW_DIR
        : path.join(customHomeDir, ".claude-workflow");
    const accountsFile =
      customHomeDir === undefined
        ? ACCOUNTS_FILE
        : path.join(customHomeDir, ".claude-workflow", "claude-accounts.json");

    // Wait for any pending save to complete before starting a new one
    // This prevents race conditions where two saves execute concurrently
    if (this.savePromise !== null) {
      console.log(`[AccountManager:SAVE] ${saveId} - Waiting for pending save to complete`);
      try {
        await this.savePromise;
        console.log(`[AccountManager:SAVE] ${saveId} - Previous save completed`);
      } catch {
        console.warn(`[AccountManager:SAVE] ${saveId} - Previous save failed, proceeding anyway`);
        // Previous save failed - proceed with our save anyway
      }
    }

    const saveOperation = (async () => {
      const data: AccountsFile = {
        activeAccountId: this.activeAccountId,
        accounts: [...this.accounts.values()],
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      const content = JSON.stringify(data, null, 2);
      const tempFile = `${accountsFile}.tmp.${String(Date.now())}`;

      console.log(`[AccountManager:SAVE] ${saveId} - Writing to temp file: ${tempFile}`);

      try {
        // Ensure directory exists right before writing (critical for concurrent scenarios)
        if (!existsSync(workflowDir)) {
          console.log(`[AccountManager:SAVE] ${saveId} - Creating directory: ${workflowDir}`);
          mkdirSync(workflowDir, { mode: 0o700, recursive: true });
        }

        // Write to temp file
        console.log(`[AccountManager:SAVE] ${saveId} - Writing ${content.length} bytes to temp file`);
        await writeFile(tempFile, content, {
          encoding: "utf8",
          mode: FILE_PERMISSIONS,
        });

        // Atomic rename
        console.log(`[AccountManager:SAVE] ${saveId} - Atomic rename to: ${accountsFile}`);
        await rename(tempFile, accountsFile);

        // Ensure permissions are correct (rename may preserve old permissions)
        await chmod(accountsFile, FILE_PERMISSIONS);

        console.log(`[AccountManager:SAVE] ${saveId} - SUCCESS: Accounts saved to disk`);
      } catch (error) {
        // Clean up temp file on error
        console.error(`[AccountManager:SAVE] ${saveId} - ERROR during save: ${(error as Error).message}`);
        try {
          if (existsSync(tempFile)) {
            console.log(`[AccountManager:SAVE] ${saveId} - Cleaning up temp file: ${tempFile}`);
            unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          console.error(`[AccountManager:SAVE] ${saveId} - Failed to cleanup temp file:`, cleanupError);
          // Ignore cleanup errors
        }
        // Log instead of throw — in-memory state remains correct even if disk write fails
        console.error(`[AccountManager:SAVE] ${saveId} - FAILED to save accounts to disk: ${(error as Error).message}`);
      }
    })();

    // Set our promise and await it
    this.savePromise = saveOperation;
    await this.savePromise;

    // Clear promise after completion
    this.savePromise = null;
    console.log(`[AccountManager:SAVE] ${saveId} - Save operation complete`);
  }
}
