/**
 * CliCredentialWatcher - Watches ~/.claude/.credentials.json AND ~/.claude.json for changes
 *
 * Monitors BOTH the CLI credentials file and user config file, and automatically imports
 * credentials into AccountManager when users authenticate via Claude CLI. Provides
 * real-time credential synchronization without manual user intervention.
 *
 * Race Condition Fix:
 * When Claude CLI does /login, it writes .credentials.json FIRST, then .claude.json SECOND.
 * To prevent updating the wrong account (old accountUuid before .claude.json is updated),
 * we now watch BOTH files and only trigger import when:
 * 1. Both credentials AND accountUuid changed within 5 seconds (new account login)
 * 2. Only .credentials.json changes (token refresh for existing account) - after 2s timeout
 *
 * Key insight: We track accountUuid changes, not just .claude.json file modifications.
 * This prevents false positives when .claude.json changes for other reasons
 * (session data, settings, etc.) while credentials also happen to change.
 *
 * Features:
 * - Watches both .credentials.json and .claude.json for coordinated imports
 * - Tracks accountUuid to detect actual account changes (not just file modifications)
 * - Handles race condition between file writes during login
 * - Debounces rapid file changes (500ms default)
 * - Coordinates with CredentialSyncService to prevent circular sync loops
 * - Docker-aware path detection (handles read-only mounts)
 * - EventEmitter-based for flexible integration
 * - Lifecycle management (start/stop)
 *
 * @example
 * const watcher = new CliCredentialWatcher(accountManager, credentialSync);
 *
 * watcher.on('credentials-synced', (account) => {
 *   console.log(`Imported account: ${account.metadata.email}`);
 * });
 *
 * watcher.on('error', (error) => {
 *   console.error('Credential sync failed:', error);
 * });
 *
 * await watcher.start();
 */

import chokidar, { type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AccountManager } from "../../account/account-manager.js";
import type { CredentialSyncService } from "../../account/credential-sync.js";
import { isCliLoginSessionActive } from "../routes/cli-login.js";
import { systemLogger } from "./system-logger.js";

// Credential file paths
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CREDENTIALS_FILE = path.join(CLAUDE_DIR, ".credentials.json");
const CLAUDE_JSON_FILE = path.join(os.homedir(), ".claude.json");

// Docker mount path (when running in container)
const DOCKER_CLAUDE_DIR = "/home/dashboard/.claude";
const DOCKER_CREDENTIALS_FILE = path.join(
  DOCKER_CLAUDE_DIR,
  ".credentials.json"
);
// NOTE: .claude.json is accessed via the /app/projects directory mount (which maps to ~)
// instead of a direct file mount. Direct file mounts don't see atomic updates
// (write temp + rename) because the container keeps the old inode mounted.
const DOCKER_CLAUDE_JSON_FILE = "/app/projects/.claude.json";

// Time window for coordinated file changes (ms)
const BOTH_FILES_WINDOW_MS = 5000;
// Timeout for token-refresh-only scenario (ms)
const TOKEN_REFRESH_TIMEOUT_MS = 2000;
// Minimum time between imports to prevent spam (ms)
const MIN_IMPORT_INTERVAL_MS = 30_000;

/**
 * Configuration options for CliCredentialWatcher
 */
export interface CliCredentialWatcherOptions {
  /** Debounce delay for file changes in ms (default: 500)
   *
   * Used for awaitWriteFinish stabilityThreshold to ensure file writes are complete.
   */
  debounceDelay?: number;
  /** Override credentials file path (for testing) */
  credentialsPath?: string;
  /** Override claude.json file path (for testing) */
  claudeJsonPath?: string;
}

/**
 * CliCredentialWatcher - Watches CLI credentials file for real-time sync
 *
 * Monitors ~/.claude/.credentials.json AND ~/.claude.json and automatically imports
 * credentials when users authenticate via Claude CLI. Coordinates with CredentialSyncService
 * to prevent circular sync loops when dashboard writes to the same file.
 *
 * Race Condition Handling:
 * When Claude CLI does /login, it writes files in this order:
 * 1. .credentials.json (tokens)
 * 2. .claude.json (accountUuid, email)
 *
 * To handle this correctly:
 * - Watch BOTH files
 * - Track accountUuid changes (not just file modification times)
 * - Only trigger import when BOTH credentials AND accountUuid changed within 5s (new account)
 * - OR after 2s timeout if only .credentials.json changes (token refresh)
 *
 * Key insight: .claude.json changes frequently for many reasons (session data, settings).
 * We only care when the accountUuid actually changes, which indicates a real account switch.
 *
 * Events:
 * - 'credentials-synced': (account: Account) => void - Emitted when credentials are successfully synced
 * - 'error': (error: Error) => void - Emitted when credential import fails
 *
 * Implementation details:
 * - Watches parent directories, not specific files (more reliable for creation detection)
 * - Filters chokidar events to only process relevant files
 * - Reads and compares accountUuid to detect actual account changes
 * - Uses sync lock to prevent circular import when dashboard writes credentials
 * - Handles Docker read-only mount detection automatically
 */
export class CliCredentialWatcher extends EventEmitter {
  private credentialsWatcher: FSWatcher | undefined;
  private claudeJsonWatcher: FSWatcher | undefined;
  private readonly accountManager: AccountManager;
  private readonly credentialSync: CredentialSyncService;
  private readonly options: Required<CliCredentialWatcherOptions>;
  private isWatching = false;

  // Track modification times for coordinated import
  private credentialsLastModified: number = 0;
  private tokenRefreshTimeoutId: NodeJS.Timeout | undefined;
  // Track last import time to prevent spam
  private lastImportTime: number = 0;
  // Track accountUuid to detect actual account changes (not just any .claude.json modification)
  private lastKnownAccountUuid: string | undefined;
  // Track when accountUuid last changed (for coordinating with credentials changes)
  private accountUuidLastChanged: number = 0;

  /**
   * Create a new CliCredentialWatcher
   *
   * @param accountManager - AccountManager instance for importing credentials
   * @param credentialSync - CredentialSyncService for sync lock coordination
   * @param options - Configuration options
   */
  constructor(
    accountManager: AccountManager,
    credentialSync: CredentialSyncService,
    options: CliCredentialWatcherOptions = {}
  ) {
    super();
    this.accountManager = accountManager;
    this.credentialSync = credentialSync;
    const paths = this.detectPaths();
    this.options = {
      debounceDelay: options.debounceDelay ?? 500,
      credentialsPath: options.credentialsPath ?? paths.credentialsPath,
      claudeJsonPath: options.claudeJsonPath ?? paths.claudeJsonPath,
    };
  }

  /**
   * Detect file paths based on environment
   *
   * Checks for Docker read-only mount first, falls back to home directory.
   *
   * @returns Object with credentialsPath and claudeJsonPath
   */
  private detectPaths(): { credentialsPath: string; claudeJsonPath: string } {
    // Check if running in Docker (read-only mount exists)
    if (existsSync(DOCKER_CLAUDE_DIR)) {
      return {
        credentialsPath: DOCKER_CREDENTIALS_FILE,
        claudeJsonPath: DOCKER_CLAUDE_JSON_FILE,
      };
    }
    return {
      credentialsPath: CREDENTIALS_FILE,
      claudeJsonPath: CLAUDE_JSON_FILE,
    };
  }

  /**
   * Start watching credentials file and claude.json for changes
   *
   * Sets up chokidar watchers on parent directories for reliable file creation
   * detection. Filters events to only process the relevant files.
   *
   * @throws Error if watcher is already active
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      return;
    }

    const credentialsDir = path.dirname(this.options.credentialsPath);
    const credentialsFilename = path.basename(this.options.credentialsPath);
    const claudeJsonDir = path.dirname(this.options.claudeJsonPath);
    const claudeJsonFilename = path.basename(this.options.claudeJsonPath);

    const watcherOptions: chokidar.WatchOptions = {
      awaitWriteFinish: {
        pollInterval: 50,
        stabilityThreshold: this.options.debounceDelay,
      },
      ignoreInitial: true, // Only react to changes after watcher starts
      persistent: true,
      depth: 0, // Only watch direct children, not recursive subdirectories
    };

    // Watch credentials file directory
    this.credentialsWatcher = chokidar.watch(credentialsDir, watcherOptions);

    // Filter events to only handle credentials file
    this.credentialsWatcher.on("add", (filePath: string) => {
      if (path.basename(filePath) === credentialsFilename) {
        this.handleCredentialsFileChange();
      }
    });

    this.credentialsWatcher.on("change", (filePath: string) => {
      if (path.basename(filePath) === credentialsFilename) {
        this.handleCredentialsFileChange();
      }
    });

    this.credentialsWatcher.on("unlink", (filePath: string) => {
      if (path.basename(filePath) === credentialsFilename) {
        this.handleCredentialsFileDeleted();
      }
    });

    this.credentialsWatcher.on("error", (error: Error) => {
      this.emit("error", error);
    });

    // Watch claude.json file directory
    this.claudeJsonWatcher = chokidar.watch(claudeJsonDir, watcherOptions);

    // Filter events to only handle claude.json file
    this.claudeJsonWatcher.on("add", (filePath: string) => {
      if (path.basename(filePath) === claudeJsonFilename) {
        this.handleClaudeJsonFileChange();
      }
    });

    this.claudeJsonWatcher.on("change", (filePath: string) => {
      if (path.basename(filePath) === claudeJsonFilename) {
        this.handleClaudeJsonFileChange();
      }
    });

    this.claudeJsonWatcher.on("error", (error: Error) => {
      this.emit("error", error);
    });

    // Wait for both watchers to be ready
    await Promise.all([
      new Promise<void>((resolve) => {
        this.credentialsWatcher!.on("ready", resolve);
      }),
      new Promise<void>((resolve) => {
        this.claudeJsonWatcher!.on("ready", resolve);
      }),
    ]);

    this.isWatching = true;

    // Initialize lastKnownAccountUuid to prevent false positive on first change
    this.lastKnownAccountUuid = this.readAccountUuidFromClaudeJson();

    systemLogger.info("cli-credential-watcher", "Watching credential files", {
      credentialsPath: this.options.credentialsPath,
      claudeJsonPath: this.options.claudeJsonPath,
      initialAccountUuid: this.lastKnownAccountUuid?.slice(0, 8) ?? "none",
    });
  }

  /**
   * Handle credentials file change or creation
   *
   * Records modification time and checks if both files have been recently modified.
   * If only credentials changed, starts a timeout for token-refresh scenario.
   *
   * @private
   */
  private handleCredentialsFileChange(): void {
    // Check if a CLI login session is active - skip to prevent spurious events
    // during /login flow which may modify credential files
    if (isCliLoginSessionActive()) {
      systemLogger.info("cli-credential-watcher", "Skipping import - CLI login session active (/login modifying files)");
      return;
    }

    // Check sync lock to prevent circular sync loop
    if (this.credentialSync.isSyncLocked()) {
      systemLogger.info("cli-credential-watcher", "Skipping import - sync lock active (dashboard wrote this file)");
      return;
    }

    // Token-match guard: Skip if credentials match active account (dashboard just synced)
    // This is a defensive check that catches cases where sync lock timing was imperfect
    if (this.credentialsMatchActiveAccount()) {
      systemLogger.info("cli-credential-watcher", "Skipping import - credentials match active account (dashboard sync)");
      return;
    }

    systemLogger.info("cli-credential-watcher", "Credentials file changed");
    this.credentialsLastModified = Date.now();

    // Check if both files have been recently modified (new account login)
    this.checkAndTriggerImport();
  }

  /**
   * Check if credentials file token matches the active account's token
   *
   * This is a defensive guard against race conditions - if the credentials
   * file contains the same token as the active account, the dashboard just
   * synced this and we should skip the import.
   *
   * Also checks accountUuid if present in credentials file (new format from dashboard sync).
   *
   * @returns true if credentials match active account (should skip import)
   * @private
   */
  private credentialsMatchActiveAccount(): boolean {
    try {
      // Read current credentials file
      if (!existsSync(this.options.credentialsPath)) {
        return false;
      }
      const content = readFileSync(this.options.credentialsPath, "utf8");
      const credentials = JSON.parse(content) as {
        claudeAiOauth?: { accessToken?: string };
        accountUuid?: string;
      };

      const fileToken = credentials.claudeAiOauth?.accessToken;
      const fileAccountUuid = credentials.accountUuid;

      // Get active account (sync - watcher only runs after manager is loaded)
      const activeAccount = this.accountManager.getActiveAccountSync();
      if (activeAccount === undefined) {
        return false;
      }

      // Check accountUuid match first (most reliable if present)
      if (fileAccountUuid !== undefined && activeAccount.metadata.accountUuid !== undefined && fileAccountUuid === activeAccount.metadata.accountUuid) {
        systemLogger.debug("cli-credential-watcher", "accountUuid in credentials matches active account");
        return true;
      }

      // Check token match
      if (fileToken !== undefined && fileToken === activeAccount.token.accessToken) {
        systemLogger.debug("cli-credential-watcher", "Token in credentials matches active account");
        return true;
      }

      return false;
    } catch {
      // If we can't read the file, allow the import to proceed
      return false;
    }
  }

  /**
   * Handle claude.json file change or creation
   *
   * Reads the file and checks if the accountUuid has actually changed.
   * Only triggers import if it's a genuine account switch (not just any file modification).
   *
   * @private
   */
  private handleClaudeJsonFileChange(): void {
    // Check if a CLI login session is active - skip to prevent spurious events
    if (isCliLoginSessionActive()) {
      systemLogger.info("cli-credential-watcher", "Skipping claude.json change - CLI login session active");
      return;
    }

    // Read the file and extract accountUuid
    const accountUuid = this.readAccountUuidFromClaudeJson();

    // Check if accountUuid actually changed
    if (accountUuid === this.lastKnownAccountUuid) {
      // Same account or no account - ignore this change
      // .claude.json changes for many reasons (session data, settings, etc.)
      systemLogger.debug("cli-credential-watcher", "claude.json changed but accountUuid unchanged, ignoring");
      return;
    }

    // accountUuid changed - this is a genuine account switch
    systemLogger.info("cli-credential-watcher", "claude.json accountUuid changed", {
      previous: this.lastKnownAccountUuid?.slice(0, 8) ?? "none",
      current: accountUuid?.slice(0, 8) ?? "none",
    });
    this.lastKnownAccountUuid = accountUuid;
    this.accountUuidLastChanged = Date.now();

    // Check if both files have been recently modified (new account login)
    this.checkAndTriggerImport();
  }

  /**
   * Read accountUuid from .claude.json file
   *
   * @returns accountUuid if found, undefined otherwise
   * @private
   */
  private readAccountUuidFromClaudeJson(): string | undefined {
    try {
      if (!existsSync(this.options.claudeJsonPath)) {
        return undefined;
      }
      const content = readFileSync(this.options.claudeJsonPath, "utf8");
      const data = JSON.parse(content) as { oauthAccount?: { accountUuid?: string } };
      return data.oauthAccount?.accountUuid;
    } catch {
      // File might be in the middle of being written, or corrupted
      return undefined;
    }
  }

  /**
   * Check if conditions are met to trigger import
   *
   * Import is triggered when:
   * 1. BOTH credentials AND accountUuid changed within BOTH_FILES_WINDOW_MS (new account login)
   * 2. Only credentials changed and TOKEN_REFRESH_TIMEOUT_MS elapsed (token refresh)
   *
   * Key insight: We track accountUuid changes, not just .claude.json modifications.
   * This prevents false positives when .claude.json changes for other reasons
   * (session data, settings, etc.) while credentials also happen to change.
   *
   * @private
   */
  private checkAndTriggerImport(): void {
    const now = Date.now();

    // Check if credentials and accountUuid both changed within the time window
    const credentialsRecent =
      now - this.credentialsLastModified < BOTH_FILES_WINDOW_MS;
    const accountUuidRecent =
      now - this.accountUuidLastChanged < BOTH_FILES_WINDOW_MS;

    if (credentialsRecent && accountUuidRecent) {
      // Both credentials and accountUuid changed recently - this is a new account login
      // Cancel any pending token refresh timeout
      if (this.tokenRefreshTimeoutId !== undefined) {
        clearTimeout(this.tokenRefreshTimeoutId);
        this.tokenRefreshTimeoutId = undefined;
      }

      systemLogger.info("cli-credential-watcher", "Both credentials and accountUuid changed - triggering import for new account");
      void this.performImport();
      return;
    }

    // Only credentials changed - might be token refresh
    // Start a timeout to handle token-refresh-only scenario
    if (credentialsRecent && !accountUuidRecent) {
      // Skip if we recently imported (prevent spam from frequent token refreshes)
      const timeSinceLastImport = now - this.lastImportTime;
      if (timeSinceLastImport < MIN_IMPORT_INTERVAL_MS) {
        // Silently skip - don't log to avoid spam
        return;
      }

      // Cancel any existing timeout
      if (this.tokenRefreshTimeoutId !== undefined) {
        clearTimeout(this.tokenRefreshTimeoutId);
      }

      systemLogger.info("cli-credential-watcher", "Only credentials changed - waiting for accountUuid change or timeout");
      this.tokenRefreshTimeoutId = setTimeout(() => {
        this.tokenRefreshTimeoutId = undefined;

        // Double-check credentials is still recent and accountUuid didn't change
        const stillCredentialsRecent =
          Date.now() - this.credentialsLastModified <
          BOTH_FILES_WINDOW_MS + TOKEN_REFRESH_TIMEOUT_MS;
        const stillNoAccountUuidChange =
          Date.now() - this.accountUuidLastChanged > BOTH_FILES_WINDOW_MS;

        // Also check we haven't imported recently (another safety check)
        const recentlyImported =
          Date.now() - this.lastImportTime < MIN_IMPORT_INTERVAL_MS;

        if (stillCredentialsRecent && stillNoAccountUuidChange && !recentlyImported) {
          systemLogger.info("cli-credential-watcher", "Token refresh detected - importing with existing account");
          void this.performImport();
        }
      }, TOKEN_REFRESH_TIMEOUT_MS);
    }
  }

  /**
   * Perform the actual import operation
   *
   * Calls AccountManager.importFromClaudeCli() and emits events based on result.
   *
   * @private
   */
  private async performImport(): Promise<void> {
    try {
      systemLogger.info("cli-credential-watcher", "Importing credentials...");

      // Import credentials from CLI file
      const account = await this.accountManager.importFromClaudeCli();

      if (account === null) {
        systemLogger.info("cli-credential-watcher", "No credentials to import");
        return;
      }

      // Track import time to prevent spam
      this.lastImportTime = Date.now();

      // If CLI switched accounts (UUID changed), set the imported account as active
      // This handles the case where an existing account was updated but the CLI
      // switched to it, so we should follow the CLI's account selection
      const cliAccountUuid = this.lastKnownAccountUuid;
      const importedAccountUuid = account.metadata.accountUuid;
      const currentActiveAccount = this.accountManager.getActiveAccountSync();
      const currentActiveUuid = currentActiveAccount?.metadata.accountUuid;

      if (
        importedAccountUuid !== undefined &&
        cliAccountUuid !== undefined &&
        importedAccountUuid === cliAccountUuid &&
        currentActiveUuid !== importedAccountUuid
      ) {
        systemLogger.info("cli-credential-watcher", "CLI switched accounts - setting imported account as active", {
          importedAccountId: account.id.slice(0, 8),
          previousActiveUuid: currentActiveUuid?.slice(0, 8) ?? "none",
          newActiveUuid: importedAccountUuid.slice(0, 8),
        });
        await this.accountManager.setActiveAccount(account.id);
      }

      systemLogger.info("cli-credential-watcher", `Imported account: ${account.id.slice(0, 8)}...`);

      // For long-lived tokens, make an initial request to populate usage cache
      // (since they can't use OAuth usage API due to limited scopes)
      const isLongLived = !account.token.refreshToken || account.token.refreshToken.length === 0;
      if (isLongLived) {
        systemLogger.info("cli-credential-watcher", `Long-lived token detected, populating usage cache for ${account.id.slice(0, 8)}...`);
        // Fire and forget - don't block import on cache population
        this.populateUsageCacheForLongLivedToken(account.token.accessToken, account.id).catch(() => {
          // Errors already logged in the function
        });
      }

      this.emit("credentials-synced", account);
    } catch (error) {
      systemLogger.error("cli-credential-watcher", "Import failed", { error: (error as Error).message });
      this.emit("error", error as Error);
    }
  }

  /**
   * Populate usage cache for a long-lived token by making an initial request through the proxy.
   * This captures rate limit headers since long-lived tokens can't use the OAuth usage API.
   *
   * @param accessToken - The OAuth access token
   * @param accountId - Account ID for logging
   */
  private async populateUsageCacheForLongLivedToken(accessToken: string, accountId: string): Promise<void> {
    // Use Docker service name when running in container, fallback to localhost for local dev
    const PROXY_URL = process.env.CLAUDE_PROXY_URL ?? "http://claude-proxy:4000";

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
        systemLogger.info("cli-credential-watcher", `Successfully populated usage cache for ${accountId.slice(0, 8)}... (status: ${response.status})`);
      } else {
        systemLogger.warn("cli-credential-watcher", `Usage cache population returned status ${response.status} - cache may not be populated`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      systemLogger.warn("cli-credential-watcher", `Failed to populate usage cache: ${message}`);
      // Non-fatal - usage will show defaults until real requests populate the cache
    }
  }

  /**
   * Handle credentials file deletion
   *
   * Logs warning and resets modification time. Continues watching.
   *
   * @private
   */
  private handleCredentialsFileDeleted(): void {
    // Check if a CLI login session is active - skip to prevent spurious events
    // /login flow may delete or overwrite .credentials.json
    if (isCliLoginSessionActive()) {
      systemLogger.info("cli-credential-watcher", "Skipping credentials deletion - CLI login session active (expected during /login)");
      return;
    }

    systemLogger.warn("cli-credential-watcher", "Credentials file deleted, continuing to watch for recreation");
    this.credentialsLastModified = 0;
    // Chokidar will automatically emit "add" when file is recreated
  }

  /**
   * Stop watching credentials file and claude.json
   *
   * Closes chokidar watchers and cleans up resources.
   */
  stop(): void {
    if (this.isWatching) {
      // Cancel any pending timeout
      if (this.tokenRefreshTimeoutId !== undefined) {
        clearTimeout(this.tokenRefreshTimeoutId);
        this.tokenRefreshTimeoutId = undefined;
      }

      // Close credentials watcher
      if (this.credentialsWatcher !== undefined) {
        void this.credentialsWatcher.close();
        this.credentialsWatcher = undefined;
      }

      // Close claude.json watcher
      if (this.claudeJsonWatcher !== undefined) {
        void this.claudeJsonWatcher.close();
        this.claudeJsonWatcher = undefined;
      }

      this.isWatching = false;
      this.credentialsLastModified = 0;
      this.accountUuidLastChanged = 0;
      this.lastImportTime = 0;
      this.lastKnownAccountUuid = undefined;
      systemLogger.info("cli-credential-watcher", "Stopped watching credentials and claude.json files");
    }
  }

  /**
   * Check if watcher is currently active
   *
   * @returns true if watcher is active
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get the credentials file path being watched
   *
   * @returns Absolute path to credentials file
   */
  getCredentialsPath(): string {
    return this.options.credentialsPath;
  }

  /**
   * Get the claude.json file path being watched
   *
   * @returns Absolute path to claude.json file
   */
  getClaudeJsonPath(): string {
    return this.options.claudeJsonPath;
  }
}
