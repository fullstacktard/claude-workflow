/**
 * Feature Toggle Types
 *
 * Frontend-compatible types for the Feature Toggle Matrix page.
 * Mirrors the FeatureGroup interface from feature-registry.ts
 * without Node.js dependencies (fs, os, path).
 */

/** Valid tier names matching the backend TierName type */
export type TierName = "all" | "free" | "pro";

/** Feature group data structure used by the matrix UI */
export interface FeatureGroup {
  /** Unique feature identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Brief description */
  description: string;
  /** Agent IDs included in this feature */
  agents: string[];
  /** Skill IDs included in this feature */
  skills: string[];
  /** Slash command filenames (without .md) included in this feature */
  commands: string[];
  /** Workflow YAML filenames (without .yml) included in this feature */
  workflows: string[];
  /** Feature IDs this feature depends on (auto-enabled) */
  dependencies: string[];
  /** Whether this feature is enabled by default */
  defaultEnabled: boolean;
  /** Minimum tier required to access this feature group */
  requiredTier: TierName;
}

/** Sub-item type categories within a feature group */
export type SubItemType = "agents" | "commands" | "skills" | "workflows";

/** Tier hierarchy levels for constraint enforcement */
export const TIER_HIERARCHY: Record<TierName, number> = {
  free: 0,
  pro: 1,
  all: 2,
};

/** Ordered list of tiers from lowest to highest */
export const TIERS: readonly TierName[] = ["free", "pro", "all"] as const;

/** Ordered list of sub-item type keys */
export const SUB_ITEM_TYPES: readonly SubItemType[] = [
  "agents",
  "skills",
  "commands",
  "workflows",
] as const;

/**
 * Hardcoded feature groups data from feature-registry.ts.
 *
 * This mirrors FEATURE_GROUPS from the backend. In a production scenario,
 * this would be fetched from an API endpoint. For now, the data is embedded
 * to avoid importing a Node.js module into the frontend bundle.
 */
export const FEATURE_GROUPS_DATA: FeatureGroup[] = [
  {
    id: "core",
    name: "Core Workflow",
    description:
      "Main feature-development workflow with planning, research, implementation, and review",
    agents: [
      "research-planner",
      "research",
      "feature-planner",
      "task-maker",
      "code-reviewer",
      "frontend-engineer",
      "backend-engineer",
      "devops-engineer",
      "Explore",
      "workflow-aggregator",
      "debugger",
      "pr-document-maker",
    ],
    skills: [
      "context7-research",
      "exa-research",
      "serena-integration",
      "sequential-thinking",
      "ref-research",
      "replicate-models",
      "playwright-testing",
      "chrome-devtools",
      "workflow-generator",
      "task-management",
      "testing-workflow",
      "react-development",
      "behavioral-testing",
      "worktree",
      "tailwind-v4",
      "d",
    ],
    commands: ["workflow", "draft", "fork"],
    workflows: ["feature-development"],
    dependencies: [],
    defaultEnabled: true,
    requiredTier: "free",
  },
  {
    id: "qa",
    name: "QA Testing",
    description: "End-to-end testing with Playwright MCP",
    agents: ["qa-engineer", "qa-resolution-planner"],
    skills: ["qa-testing"],
    commands: ["qa", "draft-qa"],
    workflows: ["qa-testing"],
    dependencies: ["core"],
    defaultEnabled: true,
    requiredTier: "pro",
  },
  {
    id: "lint",
    name: "Lint & Auto-fix",
    description: "Automated lint error resolution and auto-fixing",
    agents: ["lint-fixer", "lint-resolution-planner", "auto-fixer"],
    skills: ["lint-fix"],
    commands: ["lint-fix", "draft-lint"],
    workflows: ["lint-fix", "lint-fix-verify"],
    dependencies: ["core"],
    defaultEnabled: true,
    requiredTier: "pro",
  },
  {
    id: "ui",
    name: "UI Generation",
    description: "UI component generation with v0 AI and style analysis",
    agents: [
      "v0-planner",
      "v0-ui-generator",
      "ui-style-analyzer",
      "style-guide-generator",
    ],
    skills: ["frontend-building", "tailwind-v4"],
    commands: ["ui", "draft-ui"],
    workflows: ["frontend-building"],
    dependencies: ["core"],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "video",
    name: "Video Creation",
    description:
      "Demo recording, surreal video generation, and video compositing",
    agents: [
      "demo-planner",
      "demo-recorder",
      "demo-reviewer",
      "surreal-clip-compositor",
      "surreal-clip-generator",
      "surreal-video-reviewer",
    ],
    skills: [
      "demo-recording",
      "demo-video-audio",
      "demo-video-captions",
      "demo-video-device-frame",
      "demo-video-gif",
      "demo-video-lottie",
      "demo-video-motion-blur",
      "demo-video-voiceover",
      "video-analysis",
      "surrealist-prompting",
      "youtube-download",
    ],
    commands: ["demo", "draft-demo", "surreal", "draft-surreal"],
    workflows: ["demo-recording", "surreal-video"],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "3d",
    name: "3D Engineering",
    description: "3D model rigging, scene configuration, and visualization",
    agents: ["3d-engineer", "rigging-agent", "scene-configurator"],
    skills: ["meshy-auto-rig"],
    commands: [],
    workflows: [],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "all",
  },
  {
    id: "setup",
    name: "Project Setup",
    description:
      "Architecture design, config generation, and project cleanup",
    agents: ["cto-architect", "config-setup-agent", "cleanup-agent"],
    skills: ["project-setup"],
    commands: ["setup", "draft-setup", "deploy"],
    workflows: ["project-setup"],
    dependencies: ["core"],
    defaultEnabled: true,
    requiredTier: "pro",
  },
  {
    id: "x-twitter",
    name: "X/Twitter",
    description: "X account creation, profile setup, and operations",
    agents: ["x-account-creator", "x-account-operator", "x-profile-setup"],
    skills: [
      "x-browser-automation",
      "x-account-management",
      "x-handle-checker",
    ],
    commands: ["x-manage", "x-onboard"],
    workflows: ["x-account-onboarding", "x-account-operations"],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "all",
  },
  {
    id: "redesign",
    name: "Website Redesign",
    description: "Redesign existing websites with modern UI/UX",
    agents: [],
    skills: [],
    commands: ["redesign", "draft-redesign"],
    workflows: ["website-redesign"],
    dependencies: ["ui"],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "app-build",
    name: "App Build",
    description:
      "Build complete applications from scratch with architecture planning",
    agents: ["app-architect", "deployment-engineer"],
    skills: [],
    commands: ["build-app"],
    workflows: ["app-build"],
    dependencies: ["core"],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "meta",
    name: "Meta Tools",
    description:
      "Agent/skill analysis, task auditing, documentation generation",
    agents: [
      "agent-analyzer",
      "skill-analyzer",
      "task-reviewer",
      "task-status-auditor",
      "backlog-plan-generator",
      "docs-generator",
    ],
    skills: ["agent-developer", "skill-developer"],
    commands: [],
    workflows: [],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "migration",
    name: "Migration Tools",
    description: "Vue-to-React conversion and Tailwind CSS migration",
    agents: [
      "vue-react-converter",
      "vue-react-planner",
      "tailwind-migration-planner",
      "tailwind-migrator",
    ],
    skills: [],
    commands: [],
    workflows: [],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "pro",
  },
  {
    id: "misc",
    name: "Miscellaneous",
    description:
      "Domain tools, email provisioning, logo design, pitch decks, and more",
    agents: [
      "banner-designer",
      "domain-namer",
      "domain-purchaser",
      "email-provisioner",
      "logo-designer",
      "pitch-deck-generator",
    ],
    skills: ["cloudflare-dns", "solana-cli", "x-handle-checker"],
    commands: [],
    workflows: [],
    dependencies: [],
    defaultEnabled: false,
    requiredTier: "pro",
  },
];
