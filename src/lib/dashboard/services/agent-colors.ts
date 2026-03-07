/**
 * Agent Colors Service
 * Parses and caches agent colors from markdown frontmatter
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Parsed agent metadata
 */
interface AgentMetadata {
  color?: string;
  id: string;
  name: string;
}

/**
 * Parse frontmatter from agent markdown file
 */
function parseAgentFrontmatter(content: string): { color?: string; name?: string } {
  const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { color?: string; name?: string } = {};

  if (frontmatter) {
    const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
    if (nameMatch?.[1]) {
      result.name = nameMatch[1].trim();
    }

    const colorMatch = /^color:\s*(.+)$/m.exec(frontmatter);
    if (colorMatch?.[1]) {
      result.color = colorMatch[1].trim().replaceAll(/['"]/g, "");
    }
  }

  return result;
}

/**
 * Parse an agent markdown file
 */
function parseAgentFile(filePath: string): AgentMetadata {
  const content = fs.readFileSync(filePath, "utf8");
  const { color, name } = parseAgentFrontmatter(content);
  const id = path.basename(filePath, ".md");

  return {
    color,
    id,
    name: name ?? id,
  };
}

/**
 * Scan for agent directories
 */
function scanAgentDirectories(projectRoot: string): string[] {
  const agentDir = path.join(projectRoot, ".claude", "agents");
  if (!fs.existsSync(agentDir)) {
    return [];
  }

  return fs.readdirSync(agentDir)
    .filter(f => f.endsWith(".md") && !f.startsWith("_"))
    .map(f => path.join(agentDir, f));
}

/**
 * Get agents directory modification time
 */
function getAgentsDirMtime(projectRoot: string): number {
  const agentDir = path.join(projectRoot, ".claude", "agents");
  try {
    const stat = fs.statSync(agentDir);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Service for managing agent color mappings
 */
export class AgentColorsService {
  private colorMap: Record<string, string> = {};
  private lastMtime: number = 0;
  private lastUpdated: Date = new Date();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.refreshColors();
  }

  /**
   * Get all agent colors (refreshes if files changed)
   */
  getAgentColors(): Record<string, string> {
    this.refreshIfNeeded();
    return { ...this.colorMap };
  }

  /**
   * Get color for specific agent
   * @returns Color string or undefined if not found
   */
  getAgentColor(agentName: string): string | undefined {
    this.refreshIfNeeded();
    // Try exact match first, then lowercase
    return this.colorMap[agentName] ?? this.colorMap[agentName.toLowerCase()];
  }

  /**
   * Get timestamp of last color refresh
   */
  getLastUpdated(): Date {
    return this.lastUpdated;
  }

  /**
   * Check if refresh needed and refresh if so
   */
  private refreshIfNeeded(): void {
    const currentMtime = getAgentsDirMtime(this.projectRoot);
    if (currentMtime > this.lastMtime) {
      this.refreshColors();
    }
  }

  /**
   * Refresh color mappings from agent files
   */
  private refreshColors(): void {
    const newColorMap: Record<string, string> = {};

    try {
      const agentPaths = scanAgentDirectories(this.projectRoot);

      for (const agentPath of agentPaths) {
        try {
          const metadata = parseAgentFile(agentPath);
          if (metadata.color) {
            // Store by both id (kebab-case) and display name
            newColorMap[metadata.id] = metadata.color;
            newColorMap[metadata.name.toLowerCase()] = metadata.color;
          }
        } catch (error) {
          console.warn(`[AgentColorsService] Failed to parse ${agentPath}:`, (error as Error).message);
        }
      }

      this.colorMap = newColorMap;
      this.lastMtime = getAgentsDirMtime(this.projectRoot);
      this.lastUpdated = new Date();

      console.log(`[AgentColorsService] Loaded ${Object.keys(newColorMap).length / 2} agent colors`);
    } catch (error) {
      console.error("[AgentColorsService] Failed to refresh colors:", error);
    }
  }
}
