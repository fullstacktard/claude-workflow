/**
 * ProjectRegistryManager - Manages persistent registry of claude-workflow projects
 * @module registry/manager
 *
 * This manager provides centralized tracking of all claude-workflow projects
 * at ~/.claude-workflow/projects.json. It handles:
 * - Adding/updating project entries
 * - Retrieving projects sorted by recency
 * - Pruning stale/deleted projects
 * - Concurrent access safety via file locking
 */

import lockfile from "lockfile";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ProjectRegistry, ProjectRegistryEntry } from "./types.js";

/**
 * Manages the global project registry for claude-workflow
 *
 * The registry is stored at ~/.claude-workflow/projects.json and tracks
 * all projects that have been initialized with claude-workflow.
 *
 * Thread-safe: Uses lockfile package to prevent concurrent write conflicts
 * when multiple `claude-workflow init` commands run simultaneously.
 */
export class ProjectRegistryManager {
  private lockFilePath: string;
  private registryPath: string;

  constructor(registryPath?: string) {
    if (registryPath !== undefined && registryPath !== "") {
      this.registryPath = registryPath;
    } else {
      const homeDir = os.homedir();
      this.registryPath = path.join(homeDir, ".claude-workflow", "projects.json");
    }
    this.lockFilePath = `${this.registryPath}.lock`;
  }

  /**
   * Add or update project in registry
   *
   * If project exists, only updates lastUsed timestamp.
   * If project is new, adds complete entry with all metadata.
   *
   * @param projectPath - Absolute or relative path to project directory
   * @throws Error if lock acquisition fails or filesystem error occurs
   */
  async addProject(projectPath: string): Promise<void> {
    await this.withLock(async () => {
      const registry = await this.loadRegistry();
      const absolutePath = path.resolve(projectPath);
      const projectName = path.basename(absolutePath);

      const existingIndex = registry.projects.findIndex(
        (p) => p.path === absolutePath
      );

      if (existingIndex === -1) {
        // Add new entry with all fields
        registry.projects.push({
          addedAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          name: projectName,
          path: absolutePath,
        });
      } else {
        // Update existing entry - only touch lastUsed
        const existingProject = registry.projects[existingIndex];
        if (existingProject) {
          existingProject.lastUsed = new Date().toISOString();
        }
      }

      registry.lastSync = new Date().toISOString();
      await this.saveRegistry(registry);
    });
  }

  /**
   * Get all projects sorted by lastUsed (descending)
   *
   * Returns projects in order of most recently used first.
   * If registry doesn't exist, returns empty array.
   *
   * @returns Array of project entries sorted by recency
   */
  async getAllProjects(): Promise<ProjectRegistryEntry[]> {
    const registry = await this.loadRegistry();
    return registry.projects.sort(
      (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
    );
  }

  /**
   * Remove projects where .claude/settings.json no longer exists
   *
   * Checks each project's .claude/settings.json file. If the file
   * doesn't exist, the project is considered stale and removed.
   *
   * @returns Count of removed entries
   */
  async pruneStaleEntries(): Promise<number> {
    let removedCount = 0;

    await this.withLock(async () => {
      const registry = await this.loadRegistry();
      const validProjects: ProjectRegistryEntry[] = [];

      for (const project of registry.projects) {
        const settingsPath = path.join(project.path, ".claude", "settings.json");
        try {
          await fs.access(settingsPath);
          validProjects.push(project);
        } catch {
          // Settings file doesn't exist - project is stale
          removedCount++;
        }
      }

      registry.projects = validProjects;
      registry.lastSync = new Date().toISOString();
      await this.saveRegistry(registry);
    });

    return removedCount;
  }

  /**
   * Update lastUsed timestamp for project
   *
   * No-op if project doesn't exist in registry.
   * Does not modify any other fields.
   *
   * @param projectPath - Absolute or relative path to project directory
   */
  async touchProject(projectPath: string): Promise<void> {
    await this.withLock(async () => {
      const registry = await this.loadRegistry();
      const absolutePath = path.resolve(projectPath);

      const project = registry.projects.find((p) => p.path === absolutePath);
      if (project) {
        project.lastUsed = new Date().toISOString();
        registry.lastSync = new Date().toISOString();
        await this.saveRegistry(registry);
      }
    });
  }

  /**
   * Load registry from disk
   *
   * Returns empty registry if file doesn't exist or contains invalid JSON.
   * This graceful handling ensures the registry can self-heal from corruption.
   *
   * @returns Registry object (empty if file missing/invalid)
   */
  private async loadRegistry(): Promise<ProjectRegistry> {
    try {
      const content = await fs.readFile(this.registryPath, "utf8");
      return JSON.parse(content) as ProjectRegistry;
    } catch {
      // Registry doesn't exist or is invalid - return empty
      return {
        lastSync: new Date().toISOString(),
        projects: [],
      };
    }
  }

  /**
   * Save registry to disk
   *
   * Creates parent directory if it doesn't exist.
   * Writes registry as formatted JSON for human readability.
   *
   * @param registry - Registry object to save
   */
  private async saveRegistry(registry: ProjectRegistry): Promise<void> {
    const dir = path.dirname(this.registryPath);
    const JSON_INDENT_SPACES = 2;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.registryPath, JSON.stringify(registry, undefined, JSON_INDENT_SPACES));
  }

  /**
   * Acquire exclusive lock for concurrent safety
   *
   * Uses lockfile package to ensure only one process can modify
   * the registry at a time. Waits up to 5 seconds for lock acquisition.
   *
   * Lock is automatically released after the provided function completes,
   * even if the function throws an error.
   *
   * @param fn - Function to execute while holding the lock
   * @returns Result of the provided function
   * @throws Error if lock acquisition fails or provided function throws
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    // Ensure lock file directory exists
    const lockDir = path.dirname(this.lockFilePath);
    await fs.mkdir(lockDir, { recursive: true });

    return new Promise((resolve, reject) => {
      lockfile.lock(this.lockFilePath, { wait: 5000 }, (err) => {
        if (err) {
          reject(new Error(`Failed to acquire lock: ${err.message}`));
          return;
        }

        fn()
          .then((result) => {
            lockfile.unlock(this.lockFilePath, (unlockErr) => {
              if (unlockErr) {
                reject(new Error(`Failed to release lock: ${unlockErr.message}`));
              } else {
                resolve(result);
              }
            });
          })
           
          .catch((caughtError: unknown) => {
            const error = caughtError instanceof Error
              ? caughtError
              : new Error(typeof caughtError === "object" && caughtError !== null
                ? JSON.stringify(caughtError)
                : String(caughtError));
            lockfile.unlock(this.lockFilePath, () => {
              reject(error);
            });
          });
      });
    });
  }
}
