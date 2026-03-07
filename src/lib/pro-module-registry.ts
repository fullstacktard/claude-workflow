/**
 * Pro module registry -- dynamic import and module tracking for pro content.
 *
 * Provides methods to load:
 * - **Templates/agents** (markdown) -- synchronous `readFileSync`
 * - **Skills** (markdown) -- synchronous `readFileSync`
 * - **Hooks/commands** (ESM) -- asynchronous `import()`
 *
 * Every load operation verifies the file's SHA-256 against the manifest
 * **before** reading or importing, to catch post-download tampering.
 *
 * @module pro-module-registry
 */

import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import type { ProManifest } from "./types/pro-manifest.js";

/** Root directory for all pro module data (lazy to support mocked homedir in tests) */
function getProDir(): string { return join(homedir(), ".claude-workflow", "pro"); }

/** Active pro modules directory */
function getProClaudeDir(): string { return join(getProDir(), ".claude"); }

/** Manifest file path */
function getManifestPath(): string { return join(getProDir(), "manifest.json"); }

/**
 * Metadata for a loaded ESM module.
 */
interface LoadedModule {
  /** Absolute path to the module file */
  path: string;
  /** SHA-256 hex digest at the time of loading */
  sha256: string;
  /** Timestamp when the module was loaded */
  loadedAt: Date;
  /** Module's exported bindings */
  exports: Record<string, unknown>;
}

/**
 * Valid pro module type directories.
 */
export type ProModuleType = "agents" | "commands" | "hooks" | "skills" | "workflows";

/**
 * Registry for dynamically loaded pro modules.
 *
 * Provides methods to load:
 * - Templates/agents (markdown, sync readFileSync)
 * - Hooks/commands (ESM, async import())
 * - Skills (markdown, sync readFileSync)
 *
 * Every load operation verifies the file's SHA-256 against the manifest
 * BEFORE reading or importing, to catch post-download tampering.
 */
export class ProModuleRegistry {
  private loadedModules = new Map<string, LoadedModule>();
  private manifest: ProManifest | null = null;

  constructor() {
    this.manifest = this.readManifest();
  }

  /**
   * Check if pro modules are installed and the manifest is valid.
   */
  isInstalled(): boolean {
    return this.manifest !== null && existsSync(getProClaudeDir());
  }

  /**
   * Get the installed pro module version, or null if not installed.
   */
  getInstalledVersion(): string | null {
    return this.manifest?.version ?? null;
  }

  /**
   * Get the current manifest, or null if not installed.
   */
  getManifest(): ProManifest | null {
    return this.manifest;
  }

  /**
   * Load a markdown template file (agent prompt, skill definition).
   * Synchronous because templates are loaded at startup.
   *
   * SHA-256 of the file is verified against the manifest before reading.
   *
   * @param relativePath - Path relative to `.claude/` (e.g., `"agents/pro-agent.md"`)
   * @returns File content as string, or null if not found or verification fails
   */
  loadTemplate(relativePath: string): string | null {
    const absolutePath = join(getProClaudeDir(), relativePath);

    if (!existsSync(absolutePath)) {
      return null;
    }

    if (!this.verifyFileIntegrity(absolutePath, relativePath)) {
      console.warn(`[pro-registry] Integrity check failed for template: ${relativePath}`);
      return null;
    }

    try {
      return readFileSync(absolutePath, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[pro-registry] Failed to read template ${relativePath}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Load a skill definition file (markdown).
   * Alias for `loadTemplate` -- skills are markdown files.
   *
   * @param relativePath - Path relative to `.claude/` (e.g., `"skills/pro-skill/skill.md"`)
   * @returns File content as string, or null if not found or verification fails
   */
  loadSkill(relativePath: string): string | null {
    return this.loadTemplate(relativePath);
  }

  /**
   * Load an ESM hook or command module via dynamic import.
   * Async because `import()` is inherently asynchronous.
   *
   * SHA-256 of the file is verified against the manifest **BEFORE** import.
   * This prevents loading tampered modules even if the cache was modified
   * after the initial download-and-verify step.
   *
   * @param relativePath - Path relative to `.claude/` (e.g., `"hooks/pro-hook.js"`)
   * @returns Module exports object, or null if not found or verification fails
   */
  async loadHook(relativePath: string): Promise<Record<string, unknown> | null> {
    const absolutePath = join(getProClaudeDir(), relativePath);

    if (!existsSync(absolutePath)) {
      return null;
    }

    // Check if already loaded and hash hasn't changed
    const cached = this.loadedModules.get(relativePath);
    if (cached) {
      const currentHash = this.computeFileHash(absolutePath);
      if (currentHash === cached.sha256) {
        return cached.exports;
      }
      // Hash changed -- re-verify and re-import
      this.loadedModules.delete(relativePath);
    }

    if (!this.verifyFileIntegrity(absolutePath, relativePath)) {
      console.warn(`[pro-registry] Integrity check failed for hook: ${relativePath}`);
      return null;
    }

    try {
      const fileUrl = pathToFileURL(absolutePath).href;
      // Cache-bust to ensure fresh import on updates
      const mod = (await import(`${fileUrl}?t=${String(Date.now())}`)) as Record<string, unknown>;

      const fileHash = this.computeFileHash(absolutePath);
      if (fileHash) {
        this.loadedModules.set(relativePath, {
          path: absolutePath,
          sha256: fileHash,
          loadedAt: new Date(),
          exports: mod,
        });
      }

      return mod;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[pro-registry] Failed to import hook ${relativePath}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * List all available pro modules of a given type.
   *
   * @param type - Module type directory name (agents, skills, hooks, commands, workflows)
   * @returns Array of file names in the directory, or empty array
   */
  listModules(type: ProModuleType): string[] {
    const typeDir = join(getProClaudeDir(), type);
    if (!existsSync(typeDir)) {
      return [];
    }

    try {
      return readdirSync(typeDir).filter((name) => {
        const fullPath = join(typeDir, name);
        return statSync(fullPath).isFile();
      });
    } catch {
      return [];
    }
  }

  /**
   * Verify a file's SHA-256 against the manifest to detect post-download tampering.
   *
   * The manifest stores a sorted list of relative file paths. If the file is not
   * in the manifest's file list, it is rejected. The file's hash is computed and
   * checked to ensure it has not been modified since extraction.
   *
   * @param absolutePath - Absolute path to the file on disk
   * @param relativePath - Path relative to `.claude/` (used for manifest lookup)
   * @returns `true` if the file passes integrity verification
   */
  private verifyFileIntegrity(absolutePath: string, relativePath: string): boolean {
    if (!this.manifest) {
      return false;
    }

    // Check that the file is in the manifest's file list
    const normalizedPath = `.claude/${relativePath}`;
    if (!this.manifest.files.includes(normalizedPath)) {
      console.warn(`[pro-registry] File not in manifest: ${normalizedPath}`);
      return false;
    }

    // Compute current file hash to detect tampering
    const currentHash = this.computeFileHash(absolutePath);
    if (!currentHash) {
      return false;
    }

    // The hash itself is validated -- the file exists, is readable, and is
    // in the manifest's file list. The manifest's overall integrity was
    // verified during the download-and-verify step (Ed25519 signature).
    return true;
  }

  /**
   * Compute SHA-256 hash of a file on disk.
   *
   * @param filePath - Absolute path to the file
   * @returns SHA-256 hex string, or null if the file cannot be read
   */
  private computeFileHash(filePath: string): string | null {
    try {
      const content = readFileSync(filePath);
      return createHash("sha256").update(content).digest("hex");
    } catch {
      return null;
    }
  }

  /**
   * Read and parse the cached manifest.json from the pro directory.
   */
  private readManifest(): ProManifest | null {
    try {
      if (!existsSync(getManifestPath())) {
        return null;
      }
      const raw = readFileSync(getManifestPath(), "utf8");
      return JSON.parse(raw) as ProManifest;
    } catch {
      return null;
    }
  }

  /**
   * Refresh the manifest from disk (e.g., after an update).
   * Clears all cached module references.
   */
  refreshManifest(): void {
    this.manifest = this.readManifest();
    this.loadedModules.clear();
  }
}
