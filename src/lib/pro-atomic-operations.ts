/**
 * Atomic file operations for the pro module cache.
 *
 * Provides crash-safe file writes, inter-process file locking, and
 * backup/restore for the `~/.claude-workflow/pro/` directory.
 *
 * - **Atomic writes** via `write-file-atomic` (temp file + rename)
 * - **File locking** via `proper-lockfile` (10s stale, auto-retry)
 * - **Backup/restore** for rollback after failed updates
 *
 * All operations use restricted permissions (0o600 files, 0o700 dirs)
 * matching the conventions in license-manager.ts.
 *
 * @module pro-atomic-operations
 */

import writeFileAtomic from "write-file-atomic";
import lockfile from "proper-lockfile";
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { dirname } from "node:path";

/** Root directory for all pro module data (lazy for test mocking) */
function getProDir(): string {
  return join(homedir(), ".claude-workflow", "pro");
}

/** Sentinel file used as the lock target for pro cache operations */
function getLockTarget(): string {
  return join(getProDir(), ".cache-lock");
}

/** Active pro modules directory */
function getProClaudeDir(): string {
  return join(getProDir(), ".claude");
}

/** One-generation backup directory for rollback */
function getBackupDir(): string {
  return join(getProDir(), ".backup");
}

// ---------------------------------------------------------------
// Atomic file writes
// ---------------------------------------------------------------

/**
 * Atomically write a file using write-file-atomic.
 *
 * Creates a temp file in the same directory, writes content, then
 * does an atomic `fs.rename()`. If the process dies mid-write, only
 * the temp file is orphaned -- the original file remains intact.
 *
 * @param filePath - Absolute path to write
 * @param content  - File content (string or Buffer)
 * @param mode     - File permission mode (default: 0o600)
 */
export async function atomicWriteFile(
  filePath: string,
  content: string | Buffer,
  mode: number = 0o600,
): Promise<void> {
  // Ensure parent directory exists with restricted permissions
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(filePath, content, { mode });
}

/**
 * Synchronous atomic write variant.
 *
 * @param filePath - Absolute path to write
 * @param content  - File content (string or Buffer)
 * @param mode     - File permission mode (default: 0o600)
 */
export function atomicWriteFileSync(
  filePath: string,
  content: string | Buffer,
  mode: number = 0o600,
): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileAtomic.sync(filePath, content, { mode });
}

// ---------------------------------------------------------------
// File locking
// ---------------------------------------------------------------

/**
 * Acquire an exclusive lock on the pro cache directory.
 *
 * Returns a release function that MUST be called when done.
 * Uses a 10-second stale timeout to auto-clean abandoned locks
 * (e.g., after a crash).
 *
 * @returns Release function to call when the critical section is done
 * @throws If lock cannot be acquired after retries
 */
export async function acquireProCacheLock(): Promise<() => Promise<void>> {
  const proDir = getProDir();
  const lockTarget = getLockTarget();

  // Ensure lock target file exists (proper-lockfile needs an existing file)
  mkdirSync(proDir, { recursive: true, mode: 0o700 });
  if (!existsSync(lockTarget)) {
    writeFileSync(lockTarget, "", { mode: 0o600 });
  }

  const release = await lockfile.lock(lockTarget, {
    stale: 10_000, // 10 second stale timeout
    update: 2000, // Update lock mtime every 2s
    retries: {
      retries: 5,
      minTimeout: 200,
      maxTimeout: 2000,
      randomize: true,
    },
    onCompromised: (err: Error) => {
      console.warn("[pro] Cache lock compromised:", err.message);
    },
  });

  return release;
}

/**
 * Execute a function while holding the pro cache lock.
 * Automatically acquires and releases the lock.
 *
 * The lock is released in the `finally` block, guaranteeing cleanup
 * even if the function throws.
 *
 * @param fn - Async function to execute within the critical section
 * @returns The return value of `fn`
 */
export async function withProCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireProCacheLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------

/**
 * Create a backup of the current pro module cache.
 *
 * Copies `~/.claude-workflow/pro/.claude/` to `~/.claude-workflow/pro/.backup/`.
 * Only one generation of backup is kept (previous is overwritten).
 *
 * Safe to call when no modules are installed (returns silently).
 */
export function createProCacheBackup(): void {
  const modulesDir = getProClaudeDir();
  const backupDir = getBackupDir();

  if (!existsSync(modulesDir)) {
    return; // Nothing to back up
  }

  // Remove old backup if exists
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }

  // Copy current modules to backup
  cpSync(modulesDir, backupDir, { recursive: true });
  console.warn("[pro] Cache backup created");
}

/**
 * Restore pro module cache from backup.
 * Used when an update fails at any point.
 *
 * Removes the potentially corrupted/partial modules directory and
 * replaces it with the backup (via rename for atomicity).
 *
 * @returns true if backup was restored, false if no backup exists
 */
export function restoreProCacheFromBackup(): boolean {
  const modulesDir = getProClaudeDir();
  const backupDir = getBackupDir();

  if (!existsSync(backupDir)) {
    console.warn("[pro] No backup available to restore");
    return false;
  }

  // Remove corrupted/partial modules
  if (existsSync(modulesDir)) {
    rmSync(modulesDir, { recursive: true, force: true });
  }

  // Restore from backup (atomic rename)
  renameSync(backupDir, modulesDir);
  console.warn("[pro] Cache restored from backup");
  return true;
}

/**
 * Clean up backup after a successful update.
 * Called when the update completes without errors.
 */
export function cleanupProCacheBackup(): void {
  const backupDir = getBackupDir();
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
}
