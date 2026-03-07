/**
 * Workflow Storage Service
 * Manages workflow YAML files across three storage tiers
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { load as parseYaml, dump as stringifyYaml } from "js-yaml";

/**
 * Storage tier identifier
 */
export type WorkflowTier = "built-in" | "global" | "project";

/**
 * Workflow metadata returned by list operations
 */
export interface WorkflowMetadata {
	/** Workflow file name (without .yml/.yaml extension) */
	name: string;
	/** Storage tier where workflow is stored */
	tier: WorkflowTier;
	/** Absolute path to workflow file */
	path: string;
	/** Last modification timestamp */
	lastModified: Date;
	/** Whether the tier is read-only */
	readOnly: boolean;
}

/**
 * Workflow content structure (simplified - actual structure from workflow schema)
 */
export interface WorkflowContent {
	name: string;
	description?: string;
	[key: string]: unknown;
}

/**
 * Service for managing workflow YAML files across three tiers
 */
export class WorkflowStorageService {
  private readonly builtInPath: string;
  private readonly globalPath: string;

  constructor() {
    // Built-in: packages/claude-workflow/src/templates/.claude/workflows/
    // Resolve from current file's location (dist/lib/dashboard/services/workflow-storage.js)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const distPath = path.resolve(__dirname, "../../../..");
    this.builtInPath = path.join(distPath, "src/templates/.claude/workflows");

    // Global: ~/.claude/workflows/
    this.globalPath = path.join(os.homedir(), ".claude", "workflows");
  }

  /**
	 * Get project-specific workflows path for a given project directory
	 */
  private getProjectPath(projectPath: string): string {
    return path.join(projectPath, ".claude", "workflows");
  }

  /**
	 * List all workflows from all three tiers
	 *
	 * @param projectPath - Optional project path for project tier workflows
	 * @returns Array of workflow metadata sorted by tier then name
	 */
  async listWorkflows(projectPath?: string): Promise<WorkflowMetadata[]> {
    const workflows: WorkflowMetadata[] = [];

    // Read built-in workflows (tier 1)
    try {
      const builtInFiles = await this.readWorkflowsFromDir(
        this.builtInPath,
        "built-in"
      );
      workflows.push(...builtInFiles);
    } catch (error) {
      console.error(
        "[WorkflowStorage] Failed to read built-in workflows:",
        error
      );
      // Built-in workflows missing is a critical error - these should always exist
    }

    // Read global workflows (tier 2)
    try {
      await fs.mkdir(this.globalPath, { recursive: true });
      const globalFiles = await this.readWorkflowsFromDir(
        this.globalPath,
        "global"
      );
      workflows.push(...globalFiles);
    } catch (error) {
      console.error(
        "[WorkflowStorage] Failed to read global workflows:",
        error
      );
      // Global directory not existing is OK - will be created on first write
    }

    // Read project workflows (tier 3) if project path provided
    if (projectPath) {
      try {
        const projectWorkflowsPath = this.getProjectPath(projectPath);
        await fs.mkdir(projectWorkflowsPath, { recursive: true });
        const projectFiles = await this.readWorkflowsFromDir(
          projectWorkflowsPath,
          "project"
        );
        workflows.push(...projectFiles);
      } catch (error) {
        console.error(
          "[WorkflowStorage] Failed to read project workflows:",
          error
        );
        // Project workflows directory not existing is OK
      }
    }

    // Sort: built-in first, then global, then project - within each tier by name
    const tierOrder: Record<WorkflowTier, number> = {
      "built-in": 0,
      "global": 1,
      "project": 2,
    };

    workflows.sort((a, b) => {
      const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return a.name.localeCompare(b.name);
    });

    return workflows;
  }

  /**
	 * Read workflows from a specific directory
	 */
  private async readWorkflowsFromDir(
    dirPath: string,
    tier: WorkflowTier
  ): Promise<WorkflowMetadata[]> {
    const workflows: WorkflowMetadata[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) {
          continue;
        }

        const filePath = path.join(dirPath, entry.name);
        const stats = await fs.stat(filePath);

        // Remove .yml or .yaml extension for workflow name
        const name = entry.name.replace(/\.(yml|yaml)$/, "");

        workflows.push({
          name,
          tier,
          path: filePath,
          lastModified: stats.mtime,
          readOnly: tier === "built-in",
        });
      }
    } catch {
      // Directory doesn't exist or not readable - return empty array
      return [];
    }

    return workflows;
  }

  /**
	 * Read workflow content from any tier
	 *
	 * @param tier - Storage tier
	 * @param name - Workflow name (without extension)
	 * @param projectPath - Required if tier is 'project'
	 * @returns Parsed workflow content
	 * @throws Error if workflow not found or invalid YAML
	 */
  async readWorkflow(
    tier: WorkflowTier,
    name: string,
    projectPath?: string
  ): Promise<WorkflowContent> {
    const filePath = this.resolveWorkflowPath(tier, name, projectPath);

    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = parseYaml(content) as WorkflowContent;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Workflow not found: ${name} in ${tier} tier`);
      }
      throw new Error(
        `Failed to read workflow: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
	 * Create a new workflow in global or project tier
	 *
	 * @param tier - Storage tier (must be 'global' or 'project')
	 * @param name - Workflow name (will be sanitized)
	 * @param content - Workflow YAML content
	 * @param projectPath - Required if tier is 'project'
	 * @throws Error if tier is 'built-in' or if workflow already exists
	 */
  async createWorkflow(
    tier: WorkflowTier,
    name: string,
    content: WorkflowContent,
    projectPath?: string
  ): Promise<void> {
    if (tier === "built-in") {
      throw new Error("Cannot create workflows in built-in tier (read-only)");
    }

    const sanitizedName = this.sanitizeWorkflowName(name);
    const filePath = this.resolveWorkflowPath(tier, sanitizedName, projectPath);

    // Check if workflow already exists
    try {
      await fs.access(filePath);
      throw new Error(
        `Workflow already exists: ${sanitizedName} in ${tier} tier`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error; // Re-throw if error is NOT "file doesn't exist"
      }
    }

    // Ensure directory exists
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });

    // Write YAML with proper formatting
    const yamlContent = stringifyYaml(content, {
      indent: 2,
      lineWidth: 100,
    });

    await fs.writeFile(filePath, yamlContent, "utf8");
  }

  /**
	 * Update existing workflow in global or project tier
	 *
	 * @param tier - Storage tier (must be 'global' or 'project')
	 * @param name - Workflow name
	 * @param content - Updated workflow YAML content
	 * @param projectPath - Required if tier is 'project'
	 * @throws Error if tier is 'built-in' or if workflow doesn't exist
	 */
  async updateWorkflow(
    tier: WorkflowTier,
    name: string,
    content: WorkflowContent,
    projectPath?: string
  ): Promise<void> {
    if (tier === "built-in") {
      throw new Error("Cannot update workflows in built-in tier (read-only)");
    }

    const filePath = this.resolveWorkflowPath(tier, name, projectPath);

    // Verify workflow exists
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Workflow not found: ${name} in ${tier} tier`);
    }

    // Write updated YAML (atomic write using temp file + rename for safety)
    const tempPath = `${filePath}.tmp`;
    const yamlContent = stringifyYaml(content, {
      indent: 2,
      lineWidth: 100,
    });

    await fs.writeFile(tempPath, yamlContent, "utf8");
    await fs.rename(tempPath, filePath);
  }

  /**
	 * Delete workflow from global or project tier
	 *
	 * @param tier - Storage tier (must be 'global' or 'project')
	 * @param name - Workflow name
	 * @param projectPath - Required if tier is 'project'
	 * @throws Error if tier is 'built-in' or if workflow doesn't exist
	 */
  async deleteWorkflow(
    tier: WorkflowTier,
    name: string,
    projectPath?: string
  ): Promise<void> {
    if (tier === "built-in") {
      throw new Error(
        "Cannot delete workflows from built-in tier (read-only)"
      );
    }

    const filePath = this.resolveWorkflowPath(tier, name, projectPath);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Workflow not found: ${name} in ${tier} tier`);
      }
      throw error;
    }
  }

  /**
	 * Resolve workflow file path for a given tier and name
	 * Validates paths to prevent directory traversal attacks
	 */
  private resolveWorkflowPath(
    tier: WorkflowTier,
    name: string,
    projectPath?: string
  ): string {
    // Sanitize name first
    const sanitizedName = this.sanitizeWorkflowName(name);

    let basePath: string;
    switch (tier) {
    case "built-in": {
      basePath = this.builtInPath;
      break;
    }
    case "global": {
      basePath = this.globalPath;
      break;
    }
    case "project": {
      if (!projectPath) {
        throw new Error("Project path required for project tier workflows");
      }
      basePath = this.getProjectPath(projectPath);
      break;
    }
    }

    // Construct file path (prefer .yml extension)
    const filePath = path.join(basePath, `${sanitizedName}.yml`);

    // Security: Validate resolved path is within expected directory
    const normalizedBasePath = path.normalize(basePath);
    const normalizedFilePath = path.normalize(filePath);

    if (!normalizedFilePath.startsWith(normalizedBasePath)) {
      throw new Error("Invalid workflow path: directory traversal detected");
    }

    return filePath;
  }

  /**
	 * Sanitize workflow name for file system compatibility
	 * Removes/replaces dangerous characters and patterns
	 */
  private sanitizeWorkflowName(name: string): string {
    if (!name || typeof name !== "string") {
      throw new Error("Workflow name must be a non-empty string");
    }

    // Decode URL encoding if present
    const decoded = decodeURIComponent(name);

    // Check for path traversal patterns
    if (
      decoded.includes("..") ||
			decoded.includes("/") ||
			decoded.includes("\\") ||
			decoded.includes("\0") || // Null byte
			/[<>:"|?*]/.test(decoded) // Invalid Windows filename chars
    ) {
      throw new Error("Invalid workflow name: contains illegal characters");
    }

    // Remove .yml/.yaml extension if user included it
    const withoutExt = decoded.replace(/\.(yml|yaml)$/i, "");

    // Trim whitespace
    const trimmed = withoutExt.trim();

    if (trimmed.length === 0) {
      throw new Error("Workflow name cannot be empty after sanitization");
    }

    // Limit length to prevent filesystem issues
    const MAX_NAME_LENGTH = 100;
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(
        `Workflow name too long (max ${MAX_NAME_LENGTH} characters)`
      );
    }

    return trimmed;
  }
}
