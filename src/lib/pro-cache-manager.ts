/**
 * Pro module cache directory management.
 *
 * Manages the `~/.claude-workflow/pro/` directory tree including:
 * - Active pro modules in `.claude/`
 * - Staging area `.downloading/` for in-progress downloads
 * - One-generation backup `.backup/` for rollback
 * - Manifest tracking at `manifest.json`
 *
 * Directory permissions are restricted to 0o700 (owner-only) for security.
 *
 * @module pro-cache-manager
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Root directory for all pro module data (lazy to support mocked homedir in tests) */
function getProDir(): string { return join(homedir(), ".claude-workflow", "pro"); }

/** Active pro modules directory (agents, skills, hooks, etc.) */
function getProClaudeDir(): string { return join(getProDir(), ".claude"); }

/** Staging area for in-progress downloads */
function getStagingDir(): string { return join(getProDir(), ".downloading"); }

/** One-generation backup for rollback after failed updates */
function getBackupDir(): string { return join(getProDir(), ".backup"); }

/** Manifest file tracking current version and file list */
function getManifestPath(): string { return join(getProDir(), "manifest.json"); }

/**
 * Cache directory path information.
 */
export interface ProCachePaths {
  /** Root: `~/.claude-workflow/pro/` */
  proDir: string;
  /** Active modules: `~/.claude-workflow/pro/.claude/` */
  claudeDir: string;
  /** Download staging: `~/.claude-workflow/pro/.downloading/` */
  stagingDir: string;
  /** Rollback backup: `~/.claude-workflow/pro/.backup/` */
  backupDir: string;
  /** Manifest: `~/.claude-workflow/pro/manifest.json` */
  manifestPath: string;
}

/**
 * Manages the pro module cache directory structure.
 *
 * Directory layout:
 * ```
 * ~/.claude-workflow/pro/
 *   .claude/            -- Active pro modules (agents, skills, hooks, etc.)
 *   .downloading/       -- Staging area for in-progress downloads
 *   .backup/            -- One-generation backup for rollback
 *   manifest.json       -- Current version metadata
 * ```
 */
export class ProCacheManager {
  /**
   * Ensure the pro cache root directory exists with proper permissions.
   * Safe to call multiple times (idempotent).
   */
  ensureDirectories(): void {
    mkdirSync(getProDir(), { recursive: true, mode: 0o700 });
  }

  /**
   * Create a backup of the current pro modules before an update.
   * Only one generation of backup is kept -- the previous backup is removed.
   *
   * @returns `true` on success (including when there is nothing to back up),
   *          `false` if the backup operation fails
   */
  createBackup(): boolean {
    try {
      if (!existsSync(getProClaudeDir())) {
        return true; // Nothing to back up
      }

      // Remove old backup
      if (existsSync(getBackupDir())) {
        rmSync(getBackupDir(), { recursive: true, force: true });
      }

      // Copy current to backup (not move -- we want the current to stay active
      // until the new version is successfully extracted)
      cpSync(getProClaudeDir(), getBackupDir(), { recursive: true });
      return true;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[pro-cache] Backup failed: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Restore from backup after a failed update.
   * Removes any potentially corrupted cache and replaces it with the backup.
   *
   * @returns `true` on success, `false` if no backup exists or restore fails
   */
  restoreFromBackup(): boolean {
    try {
      if (!existsSync(getBackupDir())) {
        console.warn("[pro-cache] No backup available to restore");
        return false;
      }

      // Remove potentially corrupted cache
      if (existsSync(getProClaudeDir())) {
        rmSync(getProClaudeDir(), { recursive: true, force: true });
      }

      renameSync(getBackupDir(), getProClaudeDir());
      return true;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[pro-cache] Restore failed: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Clean up the staging directory.
   * Called on startup to remove partial downloads from crashed sessions.
   * Best-effort -- errors are silently ignored.
   */
  cleanupStaging(): void {
    try {
      if (existsSync(getStagingDir())) {
        rmSync(getStagingDir(), { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Remove all pro module data (cache, backup, staging, manifest).
   * Used when a license is deactivated or expired.
   */
  purge(): void {
    try {
      if (existsSync(getProDir())) {
        rmSync(getProDir(), { recursive: true, force: true });
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[pro-cache] Purge failed: ${error.message}`);
      }
    }
  }

  /**
   * Check if pro modules are currently installed.
   * Both the `.claude/` directory and `manifest.json` must exist.
   */
  isInstalled(): boolean {
    return existsSync(getProClaudeDir()) && existsSync(getManifestPath());
  }

  /**
   * Check if the staging directory has leftover artifacts from a previous
   * interrupted download.
   */
  hasStagingArtifacts(): boolean {
    if (!existsSync(getStagingDir())) {
      return false;
    }
    try {
      const entries = readdirSync(getStagingDir());
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check for and clean up interrupted downloads.
   *
   * If a `.downloading/` staging directory exists with content, a previous
   * download was interrupted (SIGTERM, power loss, etc.). Cleans it up
   * and logs a warning so the user knows what happened.
   *
   * Called during CLI startup / pro module initialization.
   *
   * @returns `true` if interrupted downloads were found and cleaned up
   */
  cleanupInterruptedDownloads(): boolean {
    if (!existsSync(getStagingDir())) {
      return false;
    }

    // Check if the staging dir actually has content
    let hasContent = false;
    try {
      const entries = readdirSync(getStagingDir());
      hasContent = entries.length > 0;
    } catch {
      // Can't read dir -- attempt cleanup anyway
      hasContent = true;
    }

    if (!hasContent) {
      // Empty staging dir -- just remove it silently
      try {
        rmSync(getStagingDir(), { force: true });
      } catch {
        // Best-effort
      }
      return false;
    }

    console.warn(
      "[pro-cache] Found interrupted download staging directory. " +
      "A previous download was interrupted. Cleaning up...",
    );

    try {
      rmSync(getStagingDir(), { recursive: true, force: true });
      console.warn("[pro-cache] Interrupted download cleanup complete");
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pro-cache] Failed to clean up interrupted download: ${message}`);
      return false;
    }
  }

  /**
   * Get cache directory paths for external reference.
   */
  getPaths(): ProCachePaths {
    return {
      proDir: getProDir(),
      claudeDir: getProClaudeDir(),
      stagingDir: getStagingDir(),
      backupDir: getBackupDir(),
      manifestPath: getManifestPath(),
    };
  }
}
