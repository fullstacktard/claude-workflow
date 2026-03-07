/**
 * CredentialSyncService - Syncs active account token to ~/.claude/.credentials.json
 *
 * Bridges AccountManager (multi-account in ~/.claude-workflow/claude-accounts.json) to the proxy
 * (single account in ~/.claude/.credentials.json). When an account is marked
 * as "active" in AccountManager, syncs its credentials to .credentials.json
 * for use by claude-proxy's oauth hook.
 *
 * Also updates ~/.claude.json with the account's email and accountUuid so that
 * CLI credential watchers can correctly identify which account the credentials
 * belong to.
 *
 * Features:
 * - Atomic file writes (temp file + rename)
 * - In-memory locking for concurrent write safety
 * - Automatic directory creation
 * - Secure file permissions (0600)
 * - Updates ~/.claude.json with account metadata (email, accountUuid)
 *
 * @example
 * const credentialSync = new CredentialSyncService();
 *
 * // Listen for account switches
 * accountManager.on('account-switched', async (fromId, toId) => {
 *   const account = await accountManager.getAccount(toId);
 *   if (account) {
 *     // Pass account metadata to ensure ~/.claude.json is updated
 *     const metadata = {
 *       email: account.metadata.email,
 *       accountUuid: account.metadata.accountUuid,
 *     };
 *     await credentialSync.syncCredentials(account.token, metadata);
 *   }
 * });
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { OAuthToken } from "./types/account.js";
import { systemLogger } from "../dashboard/services/system-logger.js";

// File permissions: owner read/write only (0600 in octal)
const FILE_PERMISSIONS = 0o600;
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CREDENTIALS_FILE = path.join(CLAUDE_DIR, ".credentials.json");
const CLAUDE_JSON_FILE = path.join(os.homedir(), ".claude.json");

// Claude-proxy URL for cache invalidation (Docker: http://claude-proxy:4000, local: http://localhost:4000)
const CLAUDE_PROXY_URL = process.env.FST_PROXY_URL ?? "http://localhost:4000";
const PROXY_CACHE_INVALIDATE_TIMEOUT_MS = 2000;

// Docker mount paths (when running in container)
// NOTE: .claude.json is accessed via the /app/projects directory mount (which maps to host ~)
// instead of a direct file mount. Direct file mounts don't see atomic updates
// (write temp + rename) because the container keeps the old inode mounted.
const DOCKER_CLAUDE_DIR = "/home/dashboard/.claude";
const DOCKER_CLAUDE_JSON_FILE = "/app/projects/.claude.json";

/**
 * Check if running in Docker container with the expected mount structure
 */
function isDockerEnvironment(): boolean {
  return existsSync(DOCKER_CLAUDE_DIR) && existsSync("/app/projects");
}

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
 * Credential file format expected by claude-proxy oauth hook
 *
 * Note: accountUuid is added by dashboard sync to enable single-file
 * account identification, eliminating race conditions with .claude.json
 */
export interface ClaudeCredentialsFile {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    rateLimitTier: string;
    scopes: string[];
    subscriptionType: string;
  };
  /** Account UUID for single-file identification (added by dashboard sync) */
  accountUuid?: string;
}

/**
 * Account metadata needed for syncing to ~/.claude.json
 */
export interface SyncAccountMetadata {
  /** Email associated with the account */
  email?: string;
  /** Anthropic account UUID - stable identifier for the account */
  accountUuid?: string;
}

/**
 * Result of a credential sync operation
 */
export interface SyncResult {
  /** Whether sync was successful */
  success: boolean;
  /** Error message if sync failed */
  error?: string;
  /** Path where credentials were written */
  path: string;
}

/**
 * CredentialSyncService - Syncs active account token to ~/.claude/.credentials.json
 *
 * Uses atomic file writes with in-memory locking to prevent race conditions
 * during concurrent sync operations.
 *
 * Provides sync lock mechanism to coordinate with CliCredentialWatcher and
 * prevent circular sync loops when dashboard writes credentials.
 */
export class CredentialSyncService {
  /**
   * Lock queue for serializing concurrent sync operations.
   * Each sync operation chains onto this promise to ensure writes don't overlap.
   */
  private lockQueue: Promise<void> = Promise.resolve();

  /** Whether sync lock is active (prevents CliCredentialWatcher from importing during writes) */
  private syncLockActive = false;

  /** Timeout handle for clearing sync lock after delay */
  private syncLockTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Delay in ms to keep sync lock active after write.
   * Accounts for filesystem event propagation delay in chokidar and Docker volume mounts.
   * Increased from 500ms to 2000ms to handle Docker mount latency race conditions.
   */
  private static readonly SYNC_LOCK_DELAY_MS = 2000;

  /**
   * Check if sync lock is active
   *
   * Used by CliCredentialWatcher to determine whether to skip import
   * when file change is detected. Returns true when dashboard is
   * actively writing to credentials file.
   *
   * @returns true if sync lock is active (dashboard is writing)
   */
  isSyncLocked(): boolean {
    return this.syncLockActive;
  }

  /**
   * Clear the sync lock timeout (for cleanup in tests)
   *
   * @internal
   */
  clearSyncLockTimeout(): void {
    if (this.syncLockTimeout !== null) {
      clearTimeout(this.syncLockTimeout);
      this.syncLockTimeout = null;
    }
    this.syncLockActive = false;
  }

  /**
   * Invalidate the claude-proxy's credential cache
   *
   * After writing new credentials to disk, the proxy needs to be told to
   * reload them. Otherwise it continues using cached (possibly invalid) tokens
   * for up to 60 seconds.
   *
   * This is fire-and-forget - doesn't block credential sync completion and
   * doesn't fail if the proxy isn't running.
   */
  private async invalidateProxyCache(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, PROXY_CACHE_INVALIDATE_TIMEOUT_MS);

      const response = await fetch(`${CLAUDE_PROXY_URL}/api/invalidate-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        systemLogger.debug("credential-sync", "Proxy credential cache invalidated");
      } else {
        // Non-fatal - proxy might have different endpoints or be unavailable
        systemLogger.debug(
          "credential-sync",
          `Proxy cache invalidation returned ${String(response.status)}`
        );
      }
    } catch (error) {
      // Expected when proxy isn't running - don't log as error
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("abort") || message.includes("ECONNREFUSED")) {
        systemLogger.debug("credential-sync", "Proxy not available for cache invalidation");
      } else {
        systemLogger.debug("credential-sync", `Proxy cache invalidation failed: ${message}`);
      }
    }
  }

  /**
   * Sync OAuth token to credentials file and update account metadata in ~/.claude.json
   *
   * Performs atomic write with file locking:
   * 1. Ensure directory exists
   * 2. Convert OAuthToken to ClaudeCredentialsFile format
   * 3. Write to temporary file
   * 4. Atomic rename to final file
   * 5. Set secure permissions (0600)
   * 6. Update ~/.claude.json with oauthAccount metadata (email, accountUuid)
   *
   * @param token - OAuth token to sync
   * @param metadata - Optional account metadata (email, accountUuid) to write to ~/.claude.json
   * @returns SyncResult with success status and any error
   */
  async syncCredentials(token: OAuthToken, metadata?: SyncAccountMetadata): Promise<SyncResult> {
    // Create a deferred promise that will hold our result
    let resolveResult: (result: SyncResult) => void;
    const resultPromise = new Promise<SyncResult>((resolve) => {
      resolveResult = resolve;
    });

    // Chain the actual work onto the lock queue
    // This ensures operations execute sequentially, not in parallel
    this.lockQueue = this.lockQueue.then(async () => {
      try {
        // Set sync lock before writing (prevents CliCredentialWatcher from importing)
        this.syncLockActive = true;

        // Clear any existing timeout
        if (this.syncLockTimeout !== null) {
          clearTimeout(this.syncLockTimeout);
          this.syncLockTimeout = null;
        }

        // Perform the actual sync
        await this.performSync(token, metadata);

        // Invalidate proxy cache so it picks up new credentials immediately
        // Don't block on this - proxy might not be running
        void this.invalidateProxyCache();

        // Keep sync lock active for delay after write to handle filesystem event delays
        this.syncLockTimeout = setTimeout(() => {
          this.syncLockActive = false;
          this.syncLockTimeout = null;
        }, CredentialSyncService.SYNC_LOCK_DELAY_MS);

        const credentialsFile =
          customHomeDir === undefined
            ? CREDENTIALS_FILE
            : path.join(customHomeDir, ".claude", ".credentials.json");

        resolveResult({
          success: true,
          path: credentialsFile,
        });
      } catch (error) {
        this.syncLockActive = false;
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        const credentialsFile =
          customHomeDir === undefined
            ? CREDENTIALS_FILE
            : path.join(customHomeDir, ".claude", ".credentials.json");
        resolveResult({
          success: false,
          error: message,
          path: credentialsFile,
        });
      }
    });

    return resultPromise;
  }

  /**
   * Read current credentials from file
   *
   * @returns Parsed credentials file or undefined if not found
   * @throws Error if file exists but contains invalid JSON
   */
  async readCredentials(): Promise<ClaudeCredentialsFile | undefined> {
    const credentialsFile =
      customHomeDir === undefined
        ? CREDENTIALS_FILE
        : path.join(customHomeDir, ".claude", ".credentials.json");

    if (!existsSync(credentialsFile)) {
      return undefined;
    }

    const content = await readFile(credentialsFile, "utf8");
    return JSON.parse(content) as ClaudeCredentialsFile;
  }

  /**
   * Perform the actual sync operation
   *
   * @param token - OAuth token to sync
   * @param metadata - Optional account metadata to write to ~/.claude.json
   * @private
   */
  private async performSync(token: OAuthToken, metadata?: SyncAccountMetadata): Promise<void> {
    // Use custom home directory if set (for testing)
    const claudeDir =
      customHomeDir === undefined
        ? CLAUDE_DIR
        : path.join(customHomeDir, ".claude");
    const credentialsFile =
      customHomeDir === undefined
        ? CREDENTIALS_FILE
        : path.join(customHomeDir, ".claude", ".credentials.json");

    // For .claude.json, use Docker mount path when in container
    // This is critical because direct file mounts don't see atomic updates
    // (write temp + rename) - we must use the directory mount at /app/projects
    let claudeJsonFile: string;
    if (customHomeDir !== undefined) {
      claudeJsonFile = path.join(customHomeDir, ".claude.json");
    } else if (isDockerEnvironment()) {
      claudeJsonFile = DOCKER_CLAUDE_JSON_FILE;
    } else {
      claudeJsonFile = CLAUDE_JSON_FILE;
    }

    // Ensure directory exists
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { mode: 0o700, recursive: true });
    }

    // FIX: Write .claude.json FIRST to establish identity before credentials
    // This prevents race condition where watcher sees credentials change but reads stale identity
    if (metadata !== undefined && (metadata.email !== undefined || metadata.accountUuid !== undefined)) {
      await this.updateClaudeJson(claudeJsonFile, metadata);
    }

    // Convert OAuthToken to ClaudeCredentialsFile format
    // Include accountUuid directly in credentials file for single-file identification
    const credentials: ClaudeCredentialsFile = {
      claudeAiOauth: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        rateLimitTier: token.rateLimitTier,
        scopes: token.scopes,
        subscriptionType: token.subscriptionType,
      },
      // Include accountUuid directly in credentials file for reliable identification
      // This eliminates the race condition where watcher reads stale .claude.json
      ...(metadata?.accountUuid !== undefined && { accountUuid: metadata.accountUuid }),
    };

    const content = JSON.stringify(credentials, null, 2);
    const tempFile = `${credentialsFile}.tmp.${String(Date.now())}`;

    try {
      // Write to temp file
      await writeFile(tempFile, content, {
        encoding: "utf8",
        mode: FILE_PERMISSIONS,
      });

      // Atomic rename
      await rename(tempFile, credentialsFile);

      // Ensure permissions are correct (rename may preserve old permissions)
      await chmod(credentialsFile, FILE_PERMISSIONS);
    } catch (error) {
      // Clean up temp file on error
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Update ~/.claude.json with oauthAccount metadata
   *
   * Uses read-merge-write approach to preserve existing fields while updating
   * the oauthAccount section with the new account's email and accountUuid.
   *
   * @param filePath - Path to .claude.json file
   * @param metadata - Account metadata to write
   * @private
   */
  private async updateClaudeJson(filePath: string, metadata: SyncAccountMetadata): Promise<void> {
    // Read existing .claude.json or start with empty object
    let existingData: Record<string, unknown> = {};
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, "utf8");
        existingData = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // If file exists but can't be parsed, start fresh
        // This handles corrupted files gracefully
        systemLogger.warn("CredentialSyncService", "Could not parse ~/.claude.json, will create new oauthAccount section");
      }
    }

    // Merge in the new oauthAccount data
    // Preserve existing oauthAccount fields if present, but update email/accountUuid
    const existingOauthAccount = (existingData.oauthAccount as Record<string, unknown> | undefined) ?? {};
    const updatedData = {
      ...existingData,
      oauthAccount: {
        ...existingOauthAccount,
        ...(metadata.email !== undefined && { emailAddress: metadata.email }),
        ...(metadata.accountUuid !== undefined && { accountUuid: metadata.accountUuid }),
      },
    };

    const content = JSON.stringify(updatedData, null, 2);
    const tempFile = `${filePath}.tmp.${String(Date.now())}`;

    try {
      // Write to temp file
      await writeFile(tempFile, content, {
        encoding: "utf8",
        mode: FILE_PERMISSIONS,
      });

      // Atomic rename
      await rename(tempFile, filePath);

      // Ensure permissions are correct
      await chmod(filePath, FILE_PERMISSIONS);

      systemLogger.info("CredentialSyncService", "Updated ~/.claude.json with oauthAccount", {
        email: metadata.email ?? "unchanged",
        accountUuid: metadata.accountUuid?.slice(0, 8) ?? "unchanged",
      });
    } catch (error) {
      // Clean up temp file on error
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch {
        // Ignore cleanup errors
      }
      // Log but don't throw - updating .claude.json is best-effort
      // The credentials file has already been written successfully at this point
      systemLogger.error("CredentialSyncService", "Failed to update ~/.claude.json", { error: (error as Error).message });
    }
  }

  /**
   * Get credentials file path (for testing purposes)
   *
   * @returns Absolute path to credentials file
   */
  static getCredentialsFilePath(): string {
    if (customHomeDir !== undefined) {
      return path.join(customHomeDir, ".claude", ".credentials.json");
    }
    return CREDENTIALS_FILE;
  }

  /**
   * Get Claude directory path (for testing purposes)
   *
   * @returns Absolute path to Claude config directory
   */
  static getClaudeDirPath(): string {
    if (customHomeDir !== undefined) {
      return path.join(customHomeDir, ".claude");
    }
    return CLAUDE_DIR;
  }
}
