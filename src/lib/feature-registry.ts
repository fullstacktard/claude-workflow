/**
 * Feature Registry - Defines feature groups that control which components get deployed
 *
 * All components ship in the npm tarball. Features control what gets deployed
 * to `.claude/` during `claude-workflow init`. This enables selective publishing
 * and CLI feature toggles.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getLicenseFeaturesSync,
  TIER_HIERARCHY,
  TIER_DISPLAY_NAMES,
} from "./license-manager.js";
import type { TierName, LicenseInfo } from "./license-manager.js";
import { isFeatureModuleAvailable } from "./pro-module-manager.js";

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

/**
 * All feature group definitions.
 *
 * Components not listed in ANY feature group are implicitly part of "misc"
 * and only deployed when "misc" is enabled or "all" is specified.
 */
export const FEATURE_GROUPS: FeatureGroup[] = [
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

/**
 * Map of feature ID to feature group for O(1) lookup
 */
export const FEATURE_MAP: ReadonlyMap<string, FeatureGroup> = new Map(
  FEATURE_GROUPS.map((f) => [f.id, f])
);

/**
 * Maps license tier names to the feature groups they unlock.
 * "free" = hardcoded defaults (core, qa, lint, setup)
 * "pro"  = free + ui, video, app-build, redesign, meta, migration, misc
 * "all"  = every feature group
 */
export const TIER_FEATURE_MAP: Record<string, string[]> = {
  free: FEATURE_GROUPS.filter((f) => TIER_HIERARCHY[f.requiredTier] <= TIER_HIERARCHY.free).map((f) => f.id),
  pro: FEATURE_GROUPS.filter((f) => TIER_HIERARCHY[f.requiredTier] <= TIER_HIERARCHY.pro).map((f) => f.id),
  all: FEATURE_GROUPS.map((f) => f.id),
};

/**
 * Get all feature IDs
 */
export function getAllFeatureIds(): string[] {
  return FEATURE_GROUPS.map((f) => f.id);
}

/**
 * Determine which license tier matches the given feature set.
 * Compares by checking if the feature set has the same size and members as a tier's features.
 * Checks from most permissive (all) to least (free) to find the best match.
 *
 * @returns "all" | "pro" | "free" | "unknown"
 */
export function getTierForFeatures(features: string[]): string {
  const featureSet = new Set(features);

  // Check tiers from most permissive to least
  for (const tier of ["all", "pro", "free"] as const) {
    const tierFeatures = TIER_FEATURE_MAP[tier];
    if (
      tierFeatures.length === featureSet.size &&
      tierFeatures.every((f) => featureSet.has(f))
    ) {
      return tier;
    }
  }

  return "unknown";
}

/**
 * Get features enabled by default
 */
export function getDefaultFeatures(): string[] {
  // 1. Check environment variable override
  const envDefaults = process.env.CLAUDE_WORKFLOW_DEFAULTS;
  if (envDefaults) {
    const ids = envDefaults.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = ids.filter((id) => FEATURE_MAP.has(id));
    if (valid.length > 0) {
      return valid;
    }
  }

  // 2. Check local override file (~/.claude-workflow/feature-defaults.json)
  try {
    const overridePath = join(homedir(), ".claude-workflow", "feature-defaults.json");
    if (existsSync(overridePath)) {
      const data = JSON.parse(readFileSync(overridePath, "utf8"));
      if (Array.isArray(data.features) && data.features.length > 0) {
        const valid = (data.features as string[]).filter((id) => FEATURE_MAP.has(id));
        if (valid.length > 0) {
          return valid;
        }
      }
    }
  } catch {
    // Ignore errors reading override file
  }

  // 3. Check license JWT for premium features
  try {
    const licenseFeatures = getLicenseFeaturesSync();
    if (licenseFeatures && licenseFeatures.length > 0) {
      // Merge license-entitled features with hardcoded defaults
      const defaults = FEATURE_GROUPS.filter((f) => f.defaultEnabled).map((f) => f.id);
      const merged = new Set([...defaults, ...licenseFeatures]);
      // Only include valid feature IDs
      const valid = [...merged].filter((id) => FEATURE_MAP.has(id));

      // Filter out pro features whose modules are not downloaded on disk
      const available = valid.filter((id) => isFeatureModuleAvailable(id));

      if (available.length > 0) {
        return available;
      }
    }
  } catch {
    // License check failure silently falls back to free tier
  }

  // 4. Fall back to hardcoded defaults (free tier)
  return FEATURE_GROUPS.filter((f) => f.defaultEnabled).map((f) => f.id);
}

/**
 * Resolve feature list with dependencies.
 * Given a list of feature IDs, returns the full set including transitive deps.
 */
export function resolveFeatures(featureIds: string[]): string[] {
  const resolved = new Set<string>();

  function resolve(id: string): void {
    if (resolved.has(id)) return;
    const feature = FEATURE_MAP.get(id);
    if (!feature) return;
    // Resolve dependencies first
    for (const dep of feature.dependencies) {
      resolve(dep);
    }
    resolved.add(id);
  }

  for (const id of featureIds) {
    resolve(id);
  }

  return [...resolved];
}

/**
 * Given a resolved list of feature IDs, return the combined set of
 * agents, skills, commands, and workflows to deploy.
 */
export function getComponentsForFeatures(featureIds: string[]): {
  agents: string[];
  skills: string[];
  commands: string[];
  workflows: string[];
} {
  const resolved = resolveFeatures(featureIds);
  const agents = new Set<string>();
  const skills = new Set<string>();
  const commands = new Set<string>();
  const workflows = new Set<string>();

  for (const id of resolved) {
    const feature = FEATURE_MAP.get(id);
    if (!feature) continue;
    for (const a of feature.agents) agents.add(a);
    for (const s of feature.skills) skills.add(s);
    for (const c of feature.commands) commands.add(c);
    for (const w of feature.workflows) workflows.add(w);
  }

  return {
    agents: [...agents].sort(),
    skills: [...skills].sort(),
    commands: [...commands].sort(),
    workflows: [...workflows].sort(),
  };
}

/**
 * Get a feature group by ID
 */
export function getFeatureById(id: string): FeatureGroup | undefined {
  return FEATURE_MAP.get(id);
}

/**
 * Check if a feature ID is valid
 */
export function isValidFeature(id: string): boolean {
  return FEATURE_MAP.has(id);
}

/**
 * Check if a user's tier has access to a required tier level.
 *
 * @param userTier - The user's current effective tier
 * @param requiredTier - The minimum tier required by a feature
 * @returns true if the user tier is >= the required tier in the hierarchy
 */
export function tierHasAccess(userTier: TierName, requiredTier: TierName): boolean {
  return TIER_HIERARCHY[userTier] >= TIER_HIERARCHY[requiredTier];
}

/**
 * Format feature list for display (CLI output).
 *
 * When licenseInfo is provided, each feature group line includes a tier tag
 * indicating the required tier and whether the user has access.
 *
 * @param enabledFeatures - Array of currently enabled feature IDs
 * @param licenseInfo - Optional license info for tier-aware display
 */
export function formatFeatureList(
  enabledFeatures: string[],
  licenseInfo?: LicenseInfo,
): string {
  const enabledSet = new Set(enabledFeatures);
  const lines: string[] = [];

  for (const feature of FEATURE_GROUPS) {
    const enabled = enabledSet.has(feature.id);
    const status = enabled ? "[enabled]" : "[disabled]";
    const defaultTag = feature.defaultEnabled ? " (default)" : "";
    const depsTag =
      feature.dependencies.length > 0
        ? ` (requires: ${feature.dependencies.join(", ")})`
        : "";

    // Tier tag: show required tier and access status when license info is present
    let tierTag = "";
    if (licenseInfo !== undefined) {
      const tierName = TIER_DISPLAY_NAMES[feature.requiredTier];
      const hasAccess = tierHasAccess(licenseInfo.tier, feature.requiredTier);

      if (feature.requiredTier === "free") {
        tierTag = " (free)";
      } else if (hasAccess) {
        tierTag = ` (${tierName})`;
      } else {
        tierTag = ` (${tierName} - upgrade required)`;
      }
    }

    lines.push(
      `  ${status} ${feature.id}${tierTag}${defaultTag}${depsTag} - ${feature.description}`
    );
  }

  return lines.join("\n");
}
