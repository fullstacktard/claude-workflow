/**
 * Component Registry - Discovers and manages available agents, skills, and hooks
 * Auto-discovers components by scanning template directories
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ComponentDefinition,
  HookCategories,
  Preset,
} from "./types/workflow-config.js";
import { PRO_CLAUDE_DIR } from "./pro-module-manager.js";

// Re-export ComponentDefinition for use by other modules


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directory path - relative to dist/lib after compilation
const TEMPLATES_DIR = path.resolve(__dirname, "../templates/.claude");

/**
 * Discover all available agents by scanning template directories.
 * Scans pro directory first so pro agents override free ones with the same ID.
 */
function discoverAgents(): ComponentDefinition[] {
  // Pro directory first = pro components override free ones with same ID
  const sources = [
    path.join(PRO_CLAUDE_DIR, "agents"),   // Pro agents (precedence)
    path.join(TEMPLATES_DIR, "agents"),     // Free agents (dist/)
  ];

  const agentMap = new Map<string, ComponentDefinition>();

  for (const agentsDir of sources) {
    if (!fs.existsSync(agentsDir)) continue;

    try {
      const files = fs
        .readdirSync(agentsDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
        .toSorted();

      for (const file of files) {
        const id = path.basename(file, ".md");
        if (agentMap.has(id)) continue; // First source wins (pro)

        const filePath = path.join(agentsDir, file);
        const content = fs.readFileSync(filePath, "utf8");
        const { description, name } = parseFrontmatter(content);

        agentMap.set(id, {
          category: "agent",
          description: description ?? "No description available",
          id,
          name: name ?? toTitleCase(id),
        });
      }
    } catch (error) {
      console.warn(
        `Error discovering agents from ${agentsDir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return [...agentMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Discover all available skills by scanning skill directories.
 * Scans pro directory first so pro skills override free ones with the same ID.
 */
function discoverSkills(): ComponentDefinition[] {
  // Pro directory first = pro skills override free ones with same ID
  const sources = [
    path.join(PRO_CLAUDE_DIR, "skills"),   // Pro skills (precedence)
    path.join(TEMPLATES_DIR, "skills"),     // Free skills (dist/)
  ];

  const skillMap = new Map<string, ComponentDefinition>();

  for (const skillsDir of sources) {
    if (!fs.existsSync(skillsDir)) continue;

    try {
      const dirs = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => d.name)
        .toSorted();

      for (const dir of dirs) {
        if (skillMap.has(dir)) continue; // First source wins (pro)

        const skillPath = path.join(skillsDir, dir, "SKILL.md");
        const id = dir;

        if (!fs.existsSync(skillPath)) {
          skillMap.set(id, {
            category: "skill",
            description: "No description available",
            id,
            name: toTitleCase(id),
          });
          continue;
        }

        const content = fs.readFileSync(skillPath, "utf8");
        const { description, name } = parseFrontmatter(content);

        skillMap.set(id, {
          category: "skill",
          description: description ?? "No description available",
          id,
          name: name ?? toTitleCase(id),
        });
      }
    } catch (error) {
      console.warn(
        `Error discovering skills from ${skillsDir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return [...skillMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Get all available hook categories
 * These map to hooks subdirectories
 */
function getHookCategories(): ComponentDefinition[] {
  return [
    {
      category: "hooks",
      description: "Enforce compliance rules and restrictions",
      id: "compliance",
      name: "Compliance",
    },
    {
      category: "hooks",
      description: "Third-party service integrations (Chrome DevTools, etc.)",
      id: "integrations",
      name: "Integrations",
    },
    {
      category: "hooks",
      description: "Agent spawning and workflow orchestration",
      id: "orchestration",
      name: "Orchestration",
    },
    {
      category: "hooks",
      description: "Proactive suggestions and monitoring",
      id: "proactive",
      name: "Proactive",
    },
    {
      category: "hooks",
      description: "Code quality checks and validation",
      id: "quality",
      name: "Quality",
    },
    {
      category: "hooks",
      description: "Error recovery and retry logic",
      id: "recovery",
      name: "Recovery",
    },
    {
      category: "hooks",
      description: "Task lifecycle management and enforcement",
      id: "taskWorkflow",
      name: "Task Workflow",
    },
    {
      category: "hooks",
      description: "Analytics and usage tracking",
      id: "tracking",
      name: "Tracking",
    },
    {
      category: "hooks",
      description: "Video creation workflow enforcement",
      id: "videoWorkflow",
      name: "Video Workflow",
    },
  ];
}

/**
 * Parse YAML frontmatter from markdown content
 * Simple parser that extracts name and description fields
 */
function parseFrontmatter(content: string): {
  description?: string;
  name?: string;
} {
  const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { description?: string; name?: string; } = {};

  // Parse name field
  if (frontmatter !== undefined && frontmatter !== "") {
    const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
    const nameValue = nameMatch?.[1];
    if (nameValue !== undefined && nameValue !== "") {
      result.name = nameValue.trim();
    }

    // Parse description field
    const descMatch = /^description:\s*(.+)$/m.exec(frontmatter);
    const descValue = descMatch?.[1];
    if (descValue !== undefined && descValue !== "") {
      result.description = descValue.trim();
    }
  }

  return result;
}

/**
 * Convert kebab-case or snake_case to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .replaceAll(/[-_]/g, " ")
    .replaceAll(/\b\w/g, (char) => char.toUpperCase());
}

// Discovered components - exported for use by other modules
export const availableAgents: ComponentDefinition[] = discoverAgents();
export const availableSkills: ComponentDefinition[] = discoverSkills();
export const availableHookCategories: ComponentDefinition[] =
  getHookCategories();

/**
 * Preset definitions
 */
export const presets: Record<string, Preset> = {
  full: {
    agents: "all",
    description: "Complete feature set with all components",
    hooks: "all",
    name: "Full",
    skills: "all",
  },
  minimal: {
    agents: ["task-maker", "backend-engineer"],
    description: "Bare minimum for basic task workflow",
    hooks: {
      compliance: true,
      integrations: false,
      orchestration: false,
      proactive: false,
      quality: false,
      recovery: false,
      taskWorkflow: true,
      tracking: false,
      videoWorkflow: false,
    },
    name: "Minimal",
    skills: ["task-management"],
  },
  standard: {
    agents: [
      "task-maker",
      "task-reviewer",
      "backend-engineer",
      "frontend-engineer",
      "devops-engineer",
    ],
    description: "Balanced feature set for most projects",
    hooks: {
      compliance: true,
      integrations: false,
      orchestration: false,
      proactive: false,
      quality: true,
      recovery: false,
      taskWorkflow: true,
      tracking: true,
      videoWorkflow: false,
    },
    name: "Standard",
    skills: ["task-management", "testing-workflow"],
  },
};

/**
 * Expand a preset to full component lists
 */
export function expandPreset(presetName: string): undefined | {
  agents: string[];
  hooks: HookCategories;
  skills: string[];
} {
  const preset = presets[presetName];
  if (!preset) {
    return undefined;
  }

  const agents =
    preset.agents === "all" ? getAllAgentIds() : (preset.agents);

  const skills =
    preset.skills === "all" ? getAllSkillIds() : (preset.skills);

  const hooks: HookCategories =
    preset.hooks === "all"
      ? {
        compliance: true,
        integrations: true,
        orchestration: true,
        proactive: true,
        quality: true,
        recovery: true,
        taskWorkflow: true,
        tracking: true,
        videoWorkflow: true,
      }
      : {
        compliance: preset.hooks.compliance ?? false,
        integrations: preset.hooks.integrations ?? false,
        orchestration: preset.hooks.orchestration ?? false,
        proactive: preset.hooks.proactive ?? false,
        quality: preset.hooks.quality ?? false,
        recovery: preset.hooks.recovery ?? false,
        taskWorkflow: preset.hooks.taskWorkflow ?? false,
        tracking: preset.hooks.tracking ?? false,
        videoWorkflow: preset.hooks.videoWorkflow ?? false,
      };

  return { agents, hooks, skills };
}

/**
 * Get an agent by its ID
 */
export function getAgentById(id: string): ComponentDefinition | undefined {
  return availableAgents.find((a) => a.id === id);
}

/**
 * Get all agent IDs
 */
export function getAllAgentIds(): string[] {
  return availableAgents.map((a) => a.id);
}

/**
 * Get all skill IDs
 */
export function getAllSkillIds(): string[] {
  return availableSkills.map((s) => s.id);
}

/**
 * Get a skill by its ID
 */
export function getSkillById(id: string): ComponentDefinition | undefined {
  return availableSkills.find((s) => s.id === id);
}

/**
 * Check if an agent ID is valid
 */
export function isValidAgent(id: string): boolean {
  return availableAgents.some((a) => a.id === id);
}

/**
 * Check if a skill ID is valid
 */
export function isValidSkill(id: string): boolean {
  return availableSkills.some((s) => s.id === id);
}