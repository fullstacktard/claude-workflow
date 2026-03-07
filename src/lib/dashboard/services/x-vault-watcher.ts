/**
 * XVaultWatcher - Watches the X accounts vault file for external mutations.
 *
 * Detects changes made by the mcp-proxy container or CLI tools to the encrypted
 * vault file at ~/.claude-workflow/x-accounts.json. Uses MD5 content hashing
 * to deduplicate events (prevents double-broadcasts when both event-driven
 * API routes and file-watcher detect the same change).
 *
 * Follows the SessionStateWatcher pattern with EventEmitter + chokidar.
 *
 * @module x-vault-watcher
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import chokidar from "chokidar";

/** Default vault file path */
const DEFAULT_VAULT_PATH = path.join(
  os.homedir(),
  ".claude-workflow",
  "x-accounts.json"
);

/**
 * Minimal vault structure for parsing account summaries.
 * The actual vault may be encrypted; this represents the decrypted shape
 * that the watcher reads after the vault library handles decryption.
 * For the file watcher, we only need to detect content changes via hash,
 * not parse the encrypted content.
 */
export interface VaultAccountSummary {
  id: string;
  handle: string;
  state: string;
  creationMethod?: string;
  warmingDay?: number;
  warmingActionsToday?: number;
  createdAt: string;
  updatedAt: string;
}

export interface XVaultWatcherOptions {
  /** Path to the vault file. Defaults to ~/.claude-workflow/x-accounts.json */
  vaultPath?: string;
  /** Stability threshold in ms for awaitWriteFinish. Defaults to 300. */
  stabilityThreshold?: number;
}

export class XVaultWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private lastKnownHash: string | null = null;
  private readonly vaultPath: string;
  private readonly stabilityThreshold: number;

  constructor(options: XVaultWatcherOptions = {}) {
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
        console.log("[XVaultWatcher] Vault file created");
        this.handleVaultChange();
      }
    });

    this.watcher.on("change", (filePath: string) => {
      if (path.basename(filePath) === filename) {
        this.handleVaultChange();
      }
    });

    this.watcher.on("error", (error: Error) => {
      console.error("[XVaultWatcher] Error:", error.message);
      this.emit("error", error);
    });

    this.watcher.on("ready", () => {
      console.log("[XVaultWatcher] Ready and watching for vault changes");
    });

    console.log(`[XVaultWatcher] Watching ${this.vaultPath}`);
  }

  /**
   * Stop watching and clean up.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
      console.log("[XVaultWatcher] Stopped");
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

      console.log(`[XVaultWatcher] Vault content changed (hash: ${hash.slice(0, 8)}...)`);
      this.emit("vault_changed", content);
    } catch (error) {
      // File may be locked or in the middle of being written
      console.warn(
        "[XVaultWatcher] Could not read vault file:",
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
