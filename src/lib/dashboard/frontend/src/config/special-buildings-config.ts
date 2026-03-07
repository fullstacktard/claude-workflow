/**
 * Special Buildings Configuration
 * Buildings for Skills and MCP servers in the medieval village visualization
 *
 * Each MCP tool/server gets its own building. No generic tool stalls.
 *
 * @module config/special-buildings-config
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Types of special buildings in the village
 * Each MCP tool gets its own building
 */
export type SpecialBuildingType =
  | "skills"
  | "exa"
  | "context7"
  | "ref-research"
  | "chrome-devtools"
  | "playwright"
  | "serena"
  | "sequential-thinking";

/**
 * Visual configuration for special buildings
 */
export interface SpecialBuildingConfig {
  /** Display label for the building */
  label: string;
  /** Primary color (hex) */
  color: string;
  /** Emissive/glow color (hex) */
  emissiveColor: string;
  /** Description of the building's purpose */
  description: string;
  /** Position in the scene [x, y, z] */
  position: [number, number, number];
  /** Scale of the building */
  scale: number;
}

// =============================================================================
// Special Buildings Configuration
// =============================================================================

/**
 * Building positions arranged around the town square
 *
 * Layout (top-down view):
 * ```
 *                    [residences at z+10 and beyond]
 *                              ↑ z+
 *
 *     [skills]                                    [exa]
 *      (-8, 4)                                   (8, 4)
 *
 *  [context7]                                  [ref-research]
 *   (-8, 0)          TOWN SQUARE (well)          (8, 0)
 *
 *     [serena]                               [seq-thinking]
 *      (-8, -4)                                 (8, -4)
 *
 *  [chrome]                                   [playwright]
 *   (-6, -8)                                    (6, -8)
 *                            ↓ z-
 * ```
 */

export const SPECIAL_BUILDINGS: Record<SpecialBuildingType, SpecialBuildingConfig> = {
  // Skills Guild Hall - prominent position
  skills: {
    label: "Guild Hall",
    color: "#5c4033",
    emissiveColor: "#daa520",
    description: "Guild Hall where agents learn and activate skills",
    position: [-8, 0, 4],
    scale: 1.2,
  },

  // EXA - Web Search
  exa: {
    label: "EXA Search",
    color: "#1a1a2e",
    emissiveColor: "#00d4ff",
    description: "Neural web search tower",
    position: [8, 0, 4],
    scale: 1.0,
  },

  // Context7 - Library Documentation
  context7: {
    label: "Context7",
    color: "#2d3436",
    emissiveColor: "#6c5ce7",
    description: "Library documentation archive",
    position: [-8, 0, 0],
    scale: 0.9,
  },

  // Ref Research - Documentation Search
  "ref-research": {
    label: "Ref Research",
    color: "#2c3e50",
    emissiveColor: "#3498db",
    description: "Documentation research center",
    position: [8, 0, 0],
    scale: 0.9,
  },

  // Serena - LSP Code Navigation
  serena: {
    label: "Serena",
    color: "#1e3a29",
    emissiveColor: "#27ae60",
    description: "Code navigation and symbol library",
    position: [-8, 0, -4],
    scale: 1.0,
  },

  // Sequential Thinking
  "sequential-thinking": {
    label: "Thinking Chapel",
    color: "#1a237e",
    emissiveColor: "#9c27b0",
    description: "Structured reasoning chamber",
    position: [8, 0, -4],
    scale: 0.9,
  },

  // Chrome DevTools - positioned to left of cotton field
  "chrome-devtools": {
    label: "Chrome Forge",
    color: "#4a4a4a",
    emissiveColor: "#4285f4",
    description: "Browser automation workshop",
    position: [-12, 0, -12],
    scale: 0.8,
  },

  // Playwright - positioned to right of cotton field
  playwright: {
    label: "Playwright",
    color: "#2d2d2d",
    emissiveColor: "#e91e63",
    description: "Browser testing theater",
    position: [12, 0, -12],
    scale: 0.8,
  },
};

// =============================================================================
// MCP Tool to Building Mapping
// =============================================================================

/**
 * Map MCP tool patterns to their buildings
 */
export const MCP_TOOL_MAP: Record<string, SpecialBuildingType> = {
  // EXA tools
  "mcp__mcp-proxy__web_search_exa": "exa",
  web_search_exa: "exa",

  // Context7 tools
  "mcp__mcp-proxy__resolve-library-id": "context7",
  "mcp__mcp-proxy__query-docs": "context7",
  "resolve-library-id": "context7",
  "query-docs": "context7",

  // Ref Research tools
  "mcp__mcp-proxy__ref_search_documentation": "ref-research",
  ref_search_documentation: "ref-research",

  // Chrome DevTools
  "mcp__chrome-devtools__": "chrome-devtools",

  // Playwright
  "mcp__playwright__": "playwright",

  // Serena
  "mcp__serena__": "serena",

  // Sequential Thinking
  "mcp__sequential-thinking__": "sequential-thinking",
};

/**
 * Skills that go to the Guild Hall
 */
export const SKILL_PATTERNS = [
  "exa-research",
  "context7-research",
  "serena-integration",
  "playwright-testing",
  "sequential-thinking",
  "chrome-devtools",
  "task-management",
  "testing-workflow",
  "tailwind-v4",
  "react-development",
  "workflow",
  "replicate-models",
  "cloudflare-dns",
];

/**
 * Get the building type for a skill activation
 */
export function getBuildingForSkill(_skillName: string): SpecialBuildingType {
  return "skills";
}

/**
 * Get the building type for an MCP tool call
 */
export function getBuildingForMcpTool(toolName: string): SpecialBuildingType | undefined {
  // Direct match first
  if (MCP_TOOL_MAP[toolName]) {
    return MCP_TOOL_MAP[toolName];
  }

  // Pattern matching for MCP prefixes
  for (const [pattern, buildingType] of Object.entries(MCP_TOOL_MAP)) {
    if (pattern.endsWith("__") && toolName.startsWith(pattern)) {
      return buildingType;
    }
  }

  return undefined;
}

/**
 * Get all special building types
 */
export function getAllSpecialBuildingTypes(): SpecialBuildingType[] {
  return Object.keys(SPECIAL_BUILDINGS) as SpecialBuildingType[];
}

/**
 * Get configuration for a special building
 */
export function getSpecialBuildingConfig(type: SpecialBuildingType): SpecialBuildingConfig {
  return SPECIAL_BUILDINGS[type];
}
