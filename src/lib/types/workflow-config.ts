/**
 * Workflow configuration schema for .claude/workflow-config.json
 * @version 1.0
 */

/**
 * Code quality tool configuration
 * Controls which linting/type-checking tools are configured during init
 */
export interface CodeQualityTools {
  /** Enable ESLint configuration (eslint.config.js, lint scripts) */
  eslint: boolean;
  /** Enable Knip for dead code detection (knip.json, knip script) */
  knip: boolean;
  /** Enable Stylelint configuration (.stylelintrc.json, lint:css scripts) */
  stylelint: boolean;
  /** Enable TypeScript configuration (tsconfig.json, typecheck script) */
  typescript: boolean;
}

/**
 * Component metadata definition
 * Used for agents, skills, and hook categories
 */
export interface ComponentDefinition {
  /** Optional category for grouping */
  category?: string;
  /** Brief description of component functionality */
  description: string;
  /** Unique identifier (kebab-case) */
  id: string;
  /** Human-readable display name */
  name: string;
}

/**
 * Hook category toggles
 * Each category maps to a hooks subdirectory
 */
export interface HookCategories {
  compliance: boolean;
  integrations: boolean;
  orchestration: boolean;
  proactive: boolean;
  quality: boolean;
  recovery: boolean;
  taskWorkflow: boolean;
  tracking: boolean;
  videoWorkflow: boolean;
}

/**
 * Preset configuration bundle
 * Pre-defined component selections for quick setup
 */
export interface Preset {
  /** Agent IDs or "all" for complete selection */
  agents: "all" | string[];
  /** Brief description */
  description: string;
  /** Hook category flags or "all" for all enabled */
  hooks: "all" | Partial<HookCategories>;
  /** Preset display name */
  name: string;
  /** Skill IDs or "all" for complete selection */
  skills: "all" | string[];
}

/**
 * Main workflow configuration interface
 * Stores user preferences for CLI customization
 */
export interface WorkflowConfig {
  /** Path to claude-workflow package dist folder (for hook imports) */
  _packagePath?: string;
  /** Absolute path to project root (for monorepo support) */
  _projectRoot?: string;
  /** Host system project root when running in Docker (used for hook paths in settings.json) */
  _hostProjectRoot?: string;

  /** Selected components */
  components: {
    /** Selected agent IDs */
    agents: string[];
    /** Agent IDs user explicitly declined during init */
    declinedAgents?: string[];
    /** Include documentation */
    docs: boolean;
    /** Hook category toggles */
    hooks: HookCategories;
    /** Include utility scripts */
    scripts: boolean;
    /** Skill IDs user explicitly declined during init */
    declinedSkills?: string[];
    /** Selected skill IDs */
    skills: string[];
  };
  /** ISO timestamp when config was created */
  created: string;
  /**
   * Optional custom AI endpoint configuration
   * Allows routing to custom LLMs or local models
   */
  customEndpoint?: {
    /** API authentication key */
    apiKey: string;
    /** Model identifier/name */
    model: string;
    /** Display name for the endpoint */
    name: string;
    /** Full API endpoint URL */
    url: string;
  };

  /** MCP server configuration */
  mcpServers: {
    /** Local MCP servers to run directly */
    localServers: string[];
    /** Port for proxy connection (if useProxy is true) */
    proxyPort?: number;
    /** Whether to connect to Docker mcp-proxy */
    useProxy: boolean;
  };

  /** Tooling options */
  tooling: {
    /** Code quality tools configuration (ESLint, TypeScript, Knip) - what user SELECTED to install */
    codeQuality: CodeQualityTools;
    /** Code quality tools detected in project - what already EXISTS */
    codeQualityDetected?: CodeQualityTools;
    /** Enable Tailwind CSS v4 mode */
    tailwind?: boolean;
    /** Git hooks configuration */
    gitHooks?: {
      /** Enable pre-commit hooks */
      enabled: boolean;
      /** Include ESLint validation in hooks */
      eslint: boolean;
      /** Include Stylelint validation in hooks */
      stylelint: boolean;
      /** Include Tailwind ESLint validation in hooks */
      tailwind?: boolean;
      /** Include TypeScript type checking in hooks */
      typescript: boolean;
    };
  };

  /** ISO timestamp when config was last updated */
  updated: string;

  /** Schema version for future migrations */
  version: "1.0";

  /** Package version when last init/update was run (for outdated detection) */
  packageVersion?: string;

  /** Enabled feature group IDs (e.g. ["core", "qa", "lint"]) */
  features?: string[];

  /** Permission preset applied to settings.json (yolo | supervised | strict) */
  permissions?: "yolo" | "supervised" | "strict";

  /** Workflow feature flags (reserved for future use) */
  workflow: object;
}
