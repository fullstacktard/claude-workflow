/**
 * Registry types for tracking claude-workflow projects
 * @module registry/types
 */

/**
 * Complete project registry structure
 */
export interface ProjectRegistry {
  /** ISO 8601 timestamp of last registry modification */
  lastSync: string;
  /** Array of registered projects */
  projects: ProjectRegistryEntry[];
}

/**
 * Registry entry for a single project
 */
export interface ProjectRegistryEntry {
  /** ISO 8601 timestamp when project was first added to registry */
  addedAt: string;
  /** ISO 8601 timestamp when project was last used/accessed */
  lastUsed: string;
  /** Project name (basename of path) */
  name: string;
  /** Absolute path to the project directory */
  path: string;
}
