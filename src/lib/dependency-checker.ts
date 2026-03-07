
import { AGENT_OPTIONS, MCP_OPTIONS, SKILL_OPTIONS } from "./mcp-config.js";

/**
 * Python version information
 * Used for checking Python version requirements
 */
export interface PythonVersion {
  major: number;
  minor: number;
  patch: number;
}

// Type definitions
interface Dependency {
  description: string;
  label: string;
  type: "mcp" | "skill";
  value: string;
}

interface DependencyCheckResult {
  errors: DependencyError[];
  warnings: string[];
}

interface DependencyError {
  dependency: string;
  item: string;
  message: string;
}

// Check if all dependencies are satisfied
export function checkDependencies(selectedMcps: string[], selectedSkills: string[], selectedAgents: string[]): DependencyCheckResult {
  const warnings: string[] = [];
  const errors: DependencyError[] = [];

  // Check skill dependencies
  for (const skillValue of selectedSkills) {
    const deps = getSkillDependencies(skillValue);
    for (const dep of deps) {
      if (dep.type === "mcp" && !selectedMcps.includes(dep.value)) {
        const skillLabel = SKILL_OPTIONS.find(s => s.value === skillValue)?.label ?? "Unknown";
        errors.push({
          dependency: dep.label,
          item: `Skill: ${skillLabel}`,
          message: `Skill "${skillLabel}" requires ${dep.label} MCP`
        });
      }
    }
  }

  // Check agent dependencies
  for (const agentValue of selectedAgents) {
    const deps = getAgentDependencies(agentValue);
    const agentLabel = AGENT_OPTIONS.find(a => a.value === agentValue)?.label ?? "Unknown";
    for (const dep of deps) {
      if (dep.type === "skill" && !selectedSkills.includes(dep.value)) {
        errors.push({
          dependency: dep.label,
          item: `Agent: ${agentLabel}`,
          message: `Agent "${agentLabel}" requires ${dep.label} skill`
        });
      } else if (dep.type === "mcp" && !selectedMcps.includes(dep.value)) {
        errors.push({
          dependency: dep.label,
          item: `Agent: ${agentLabel}`,
          message: `Agent "${agentLabel}" requires ${dep.label} MCP`
        });
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check if installed Python version meets the requirement
 * @param installed - Installed Python version
 * @param required - Required Python version
 * @returns true if installed meets requirement, false otherwise
 */
export function checkPythonVersionMeetsRequirement(
  installed: PythonVersion | undefined,
  required: PythonVersion | undefined
): boolean {
  if (!installed || !required) return false;

  if (installed.major !== required.major) {
    return installed.major > required.major;
  }
  if (installed.minor !== required.minor) {
    return installed.minor > required.minor;
  }
  return installed.patch >= required.patch;
}

// Get all dependencies for an agent
export function getAgentDependencies(agentValue: string): Dependency[] {
  const agent = AGENT_OPTIONS.find(a => a.value === agentValue);
  if (!agent) return [];

  const deps: Dependency[] = [];

  // Check skill dependencies
  if (agent.requiresSkill !== undefined && agent.requiresSkill !== "") {
    const skill = SKILL_OPTIONS.find(s => s.value === agent.requiresSkill);
    if (skill) {
      deps.push({
        description: `Requires ${skill.label} skill`,
        label: skill.label,
        type: "skill",
        value: agent.requiresSkill
      });

      // Recursively check skill's dependencies
      const skillDeps = getSkillDependencies(agent.requiresSkill);
      deps.push(...skillDeps);
    }
  }

  // Check MCP dependencies
  if (agent.requiresMcp !== undefined && agent.requiresMcp !== "") {
    const mcp = MCP_OPTIONS.find(m => m.value === agent.requiresMcp);
    if (mcp) {
      deps.push({
        description: `Requires ${mcp.label} MCP`,
        label: mcp.label,
        type: "mcp",
        value: agent.requiresMcp
      });
    }
  }

  return deps;
}

// Get missing dependencies for selected items
export function getMissingDependencies(selectedMcps: string[], selectedSkills: string[], selectedAgents: string[]): { mcps: string[]; skills: string[] } {
  const missing = {
    mcps: new Set<string>(),
    skills: new Set<string>()
  };

  // Check skills
  for (const skillValue of selectedSkills) {
    const skill = SKILL_OPTIONS.find(s => s.value === skillValue);
    if (skill?.requiresMcp !== undefined && skill.requiresMcp !== "" && !selectedMcps.includes(skill.requiresMcp)) {
      missing.mcps.add(skill.requiresMcp);
    }
  }

  // Check agents
  for (const agentValue of selectedAgents) {
    const agent = AGENT_OPTIONS.find(a => a.value === agentValue);
    if (agent?.requiresSkill !== undefined && agent.requiresSkill !== "" && !selectedSkills.includes(agent.requiresSkill)) {
      missing.skills.add(agent.requiresSkill);
    }
    if (agent?.requiresMcp !== undefined && agent.requiresMcp !== "" && !selectedMcps.includes(agent.requiresMcp)) {
      missing.mcps.add(agent.requiresMcp);
    }
  }

  return {
    mcps: [...missing.mcps],
    skills: [...missing.skills]
  };
}

/**
 * Extract Python version from command output
 * @param output - Output from python --version command
 * @returns Version string or undefined if not found
 */
export function getPythonVersion(output: string): string | undefined {
  const match = /Python\s+(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1];
}

// Get all dependencies for a skill
export function getSkillDependencies(skillValue: string): Dependency[] {
  const skill = SKILL_OPTIONS.find(s => s.value === skillValue);
  if (!skill) return [];

  const deps: Dependency[] = [];

  // Check MCP dependencies
  if (skill.requiresMcp !== undefined && skill.requiresMcp !== "") {
    const mcp = MCP_OPTIONS.find(m => m.value === skill.requiresMcp);
    if (mcp) {
      deps.push({
        description: `Requires ${mcp.label} MCP`,
        label: mcp.label,
        type: "mcp",
        value: skill.requiresMcp
      });
    }
  }

  return deps;
}

/**
 * Parse a Python version string into structured format
 * @param versionString - Version string (e.g., "Python 3.10.5" or "3.10.5")
 * @returns Parsed version object or undefined if invalid
 */
export function parsePythonVersion(versionString: string): PythonVersion | undefined {
  if (!versionString) return undefined;

  // Remove "Python " prefix if present
  const cleaned = versionString.replace(/^Python\s+/, "");

  // Match version pattern (e.g., "3.10.5")
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  if (!match) return undefined;

  const DEFAULT_VERSION_PART = 0;

  return {
    major: Number.parseInt(match[1] ?? String(DEFAULT_VERSION_PART), 10),
    minor: Number.parseInt(match[2] ?? String(DEFAULT_VERSION_PART), 10),
    patch: Number.parseInt(match[3] ?? String(DEFAULT_VERSION_PART), 10)
  };
}
