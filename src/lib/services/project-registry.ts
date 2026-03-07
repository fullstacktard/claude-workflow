/**
 * ProjectRegistryService - Global project registry for claude-workflow
 *
 * Maintains a registry of all projects using claude-workflow at ~/.claude-workflow/registry.json
 * This enables fast project discovery for the dashboard without filesystem scanning.
 *
 * Features:
 * - Atomic writes to prevent data corruption
 * - Proper file permissions (0600 for file, 0700 for directory)
 * - Stale entry cleanup
 * - Backward compatible with legacy projects
 *
 * @module project-registry
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Individual project entry in the registry
 */
export interface ProjectEntry {
  /** Installed claude-workflow version */
  installedVersion: string;
  /** Last activity timestamp (ISO 8601) */
  lastActivity?: string;
  /** Project name (typically directory name) */
  name: string;
  /** Absolute path to project directory */
  pwd: string;
  /** When the project was first registered (ISO 8601) */
  registeredAt: string;
}

/**
 * Global project registry structure
 */
export interface ProjectRegistry {
  /** Map of project paths to entries */
  projects: Record<string, ProjectEntry>;
  /** Registry schema version */
  version: "1.0";
}

/**
 * Options for registering a project
 */
export interface RegisterOptions {
  /** Installed version of claude-workflow */
  installedVersion: string;
  /** Project name */
  name: string;
  /** Absolute path to project directory */
  pwd: string;
}

/**
 * Service for managing the global project registry
 *
 * @example
 * ```typescript
 * const registry = new ProjectRegistryService();
 *
 * // Register a project
 * registry.register({
 *   name: "my-app",
 *   pwd: "/home/user/projects/my-app",
 *   installedVersion: "1.0.13",
 * });
 *
 * // List all projects
 * const projects = registry.list();
 *
 * // Remove stale entries
 * const removed = registry.cleanup();
 * ```
 */
export class ProjectRegistryService {
  private readonly registryDir: string;
  private readonly registryPath: string;

  constructor() {
    this.registryDir = join(homedir(), ".claude-workflow");
    this.registryPath = join(this.registryDir, "registry.json");
  }

  /**
   * Register a project in the global registry
   *
   * If the project is already registered, updates the entry.
   *
   * @param options - Project registration options
   */
  register(options: RegisterOptions): void {
    const registry = this.ensureRegistry();
    const now = new Date().toISOString();

    const existingEntry = registry.projects[options.pwd];

    registry.projects[options.pwd] = {
      installedVersion: options.installedVersion,
      lastActivity: now,
      name: options.name,
      pwd: options.pwd,
      registeredAt: existingEntry?.registeredAt ?? now,
    };

    this.saveRegistry(registry);
  }

  /**
   * Unregister a project from the global registry
   *
   * @param projectPath - Absolute path to the project directory
   * @returns true if project was removed, false if not found
   */
  unregister(projectPath: string): boolean {
    const registry = this.ensureRegistry();

    if (registry.projects[projectPath] === undefined) {
      return false;
    }

    delete registry.projects[projectPath];
    this.saveRegistry(registry);
    return true;
  }

  /**
   * Get all registered projects
   *
   * @returns Array of project entries
   */
  list(): ProjectEntry[] {
    const registry = this.loadRegistry();
    return Object.values(registry.projects);
  }

  /**
   * Get a specific project by path
   *
   * @param projectPath - Absolute path to the project directory
   * @returns Project entry or undefined if not found
   */
  get(projectPath: string): ProjectEntry | undefined {
    const registry = this.loadRegistry();
    return registry.projects[projectPath];
  }

  /**
   * Update the last activity timestamp for a project
   *
   * @param projectPath - Absolute path to the project directory
   * @returns true if updated, false if project not found
   */
  updateActivity(projectPath: string): boolean {
    const registry = this.ensureRegistry();

    if (registry.projects[projectPath] === undefined) {
      return false;
    }

    registry.projects[projectPath].lastActivity = new Date().toISOString();
    this.saveRegistry(registry);
    return true;
  }

  /**
   * Remove stale entries from the registry
   *
   * Checks if each registered project still exists on the filesystem.
   * Removes entries for projects that no longer exist.
   *
   * @returns Number of stale entries removed
   */
  cleanup(): number {
    const registry = this.ensureRegistry();
    let removedCount = 0;

    for (const [path, entry] of Object.entries(registry.projects)) {
      const configPath = join(entry.pwd, ".claude", "workflow-config.json");
      if (!existsSync(configPath)) {
        delete registry.projects[path];
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.saveRegistry(registry);
    }

    return removedCount;
  }

  /**
   * Get the raw registry data
   *
   * @returns The full registry object
   */
  getRegistry(): ProjectRegistry {
    return this.loadRegistry();
  }

  /**
   * Check if registry file exists
   *
   * @returns true if registry file exists
   */
  exists(): boolean {
    return existsSync(this.registryPath);
  }

  /**
   * Get registry file path
   *
   * @returns Absolute path to registry file
   */
  getRegistryPath(): string {
    return this.registryPath;
  }

  /**
   * Load registry from disk (read-only, no directory creation)
   *
   * Use this for read operations that should work on read-only filesystems.
   */
  private loadRegistry(): ProjectRegistry {
    // If file doesn't exist, return empty registry (no directory creation)
    if (!existsSync(this.registryPath)) {
      return this.createEmptyRegistry();
    }

    try {
      const content = readFileSync(this.registryPath, "utf8");
      const data = JSON.parse(content) as unknown;

      if (this.validateRegistry(data)) {
        return data;
      }

      // Invalid registry format, return empty (don't try to fix on read-only)
      console.warn("[project-registry] Invalid registry format, returning empty registry");
      return this.createEmptyRegistry();
    } catch {
      // Corrupted registry, return empty (don't try to fix on read-only)
      console.warn("[project-registry] Corrupted registry file, returning empty registry");
      return this.createEmptyRegistry();
    }
  }

  /**
   * Ensure registry directory and file exist, load or create registry
   *
   * Use this for write operations that need to ensure the registry can be saved.
   */
  private ensureRegistry(): ProjectRegistry {
    // Create directory with proper permissions (only needed for writes)
    if (!existsSync(this.registryDir)) {
      mkdirSync(this.registryDir, { recursive: true, mode: 0o700 });
    }

    return this.loadRegistry();
  }

  /**
   * Validate registry data structure
   */
  private validateRegistry(data: unknown): data is ProjectRegistry {
    if (typeof data !== "object" || data === null) {
      return false;
    }

    const reg = data as Record<string, unknown>;

    if (reg.version !== "1.0") {
      return false;
    }

    if (typeof reg.projects !== "object" || reg.projects === null) {
      return false;
    }

    return true;
  }

  /**
   * Create an empty registry
   */
  private createEmptyRegistry(): ProjectRegistry {
    return {
      projects: {},
      version: "1.0",
    };
  }

  /**
   * Save registry to disk using atomic write pattern
   *
   * Writes to a temporary file first, then renames to prevent corruption.
   */
  private saveRegistry(registry: ProjectRegistry): void {
    const tempPath = `${this.registryPath}.tmp.${process.pid}`;

    try {
      // Ensure directory exists
      if (!existsSync(this.registryDir)) {
        mkdirSync(this.registryDir, { recursive: true, mode: 0o700 });
      }

      // Write to temp file with proper permissions
      writeFileSync(tempPath, JSON.stringify(registry, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });

      // Atomic rename
      renameSync(tempPath, this.registryPath);
    } catch (error) {
      // Clean up temp file on error
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}

/**
 * Singleton instance for convenience
 */
let registryInstance: ProjectRegistryService | undefined;

/**
 * Get the shared ProjectRegistryService instance
 *
 * @returns Shared registry service instance
 */
export function getProjectRegistry(): ProjectRegistryService {
  if (registryInstance === undefined) {
    registryInstance = new ProjectRegistryService();
  }
  return registryInstance;
}
