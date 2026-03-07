/**
 * EmailVaultWatcher - Watches the email accounts vault file for external mutations.
 *
 * Detects changes made by the mcp-proxy container or CLI tools to the
 * vault file at ~/.claude-workflow/email-accounts.json. Uses MD5 content hashing
 * to deduplicate events (prevents double-broadcasts when both event-driven
 * API routes and file-watcher detect the same change).
 *
 * Follows the XVaultWatcher pattern with EventEmitter + chokidar.
 *
 * @module email-vault-watcher
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import chokidar from "chokidar";

/** Default email vault file path */
const DEFAULT_VAULT_PATH = path.join(
  os.homedir(),
  ".claude-workflow",
  "email-accounts.json"
);

/**
 * Minimal email account summary for WebSocket payloads.
 * Represents the shape of each account entry in the vault file.
 */
export interface EmailAccountSummary {
  id: string;
  email: string;
  provider: string;
  domain?: string;
  createdAt: string;
}

export interface EmailVaultWatcherOptions {
  /** Path to the vault file. Defaults to ~/.claude-workflow/email-accounts.json */
  vaultPath?: string;
  /** Stability threshold in ms for awaitWriteFinish. Defaults to 300. */
  stabilityThreshold?: number;
}

export class EmailVaultWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private lastKnownHash: string | null = null;
  private readonly vaultPath: string;
  private readonly stabilityThreshold: number;

  constructor(options: EmailVaultWatcherOptions = {}) {
    super();
    this.vaultPath = options.vaultPath ?? DEFAULT_VAULT_PATH;
    this.stabilityThreshold = options.stabilityThreshold ?? 300;
  }

  /**
   * Start watching the vault file for changes.
   * Creates the parent directory if it doesn't exist.
   */
  async start(): Promise<void> {
    const dir = path.dirname(this.vaultPath);

    // Ensure parent directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Compute initial hash if file exists (to skip first false-positive)
    if (existsSync(this.vaultPath)) {
      try {
        const content = readFileSync(this.vaultPath, "utf8");
        this.lastKnownHash = createHash("md5").update(content).digest("hex");
      } catch {
        // File may not be readable yet, that's fine
      }
    }

    // Watch the directory (not the file directly) for reliability
    // chokidar has better cross-platform behavior watching directories
    this.watcher = chokidar.watch(dir, {
      awaitWriteFinish: {
        pollInterval: 50,
        stabilityThreshold: this.stabilityThreshold,
      },
      ignoreInitial: true,
      persistent: true,
      depth: 0,
    });

    const filename = path.basename(this.vaultPath);

    this.watcher.on("add", (filePath: string) => {
      if (path.basename(filePath) === filename) {
        console.log("[EmailVaultWatcher] Vault file created");
        this.handleVaultChange();
      }
    });

    this.watcher.on("change", (filePath: string) => {
      if (path.basename(filePath) === filename) {
        this.handleVaultChange();
      }
    });

    this.watcher.on("error", (error: Error) => {
      console.error("[EmailVaultWatcher] Error:", error.message);
      this.emit("error", error);
    });

    this.watcher.on("ready", () => {
      console.log("[EmailVaultWatcher] Ready and watching for vault changes");
    });

    console.log(`[EmailVaultWatcher] Watching ${this.vaultPath}`);
  }

  /**
   * Stop watching and clean up.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
      console.log("[EmailVaultWatcher] Stopped");
    }
  }

  /**
   * Update the content hash after a known mutation.
   * Call this from API routes after they modify the vault to prevent
   * the file watcher from emitting a duplicate event.
   */
  public updateHash(content: string): void {
    this.lastKnownHash = createHash("md5").update(content).digest("hex");
  }

  /**
   * Update hash from current file contents.
   * Convenience method for API routes that don't have the raw content.
   */
  public updateHashFromFile(): void {
    try {
      if (existsSync(this.vaultPath)) {
        const content = readFileSync(this.vaultPath, "utf8");
        this.lastKnownHash = createHash("md5").update(content).digest("hex");
      }
    } catch {
      // Ignore read errors during hash update
    }
  }

  /**
   * Handle a vault file change detected by chokidar.
   * Reads the file, computes MD5 hash, and only emits if content actually changed.
   */
  private handleVaultChange(): void {
    try {
      const content = readFileSync(this.vaultPath, "utf8");
      const hash = createHash("md5").update(content).digest("hex");

      // Deduplicate: skip if content hasn't actually changed
      if (hash === this.lastKnownHash) {
        return;
      }

      this.lastKnownHash = hash;

      console.log(`[EmailVaultWatcher] Vault content changed (hash: ${hash.slice(0, 8)}...)`);
      this.emit("vault_changed", content);
    } catch (error) {
      // File may be locked or in the middle of being written
      console.warn(
        "[EmailVaultWatcher] Could not read vault file:",
        (error as Error).message
      );
    }
  }

  /**
   * Check if the watcher is currently active.
   */
  public isActive(): boolean {
    return this.watcher !== null;
  }
}
