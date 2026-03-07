/**
 * Tool Stall Configuration
 * Mapping of tools to medieval-themed stall types for visualization
 *
 * Tool stalls are specific locations in the town square where agents walk
 * when using different categories of tools. Each stall has a unique visual
 * design representing its tool category.
 *
 * @module config/tool-stall-config
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Available stall types in the medieval village
 *
 * Each stall represents a category of tools:
 * - blacksmith: Editing/modification tools (forge theme)
 * - scribe: Reading/documentation tools (scroll theme)
 * - alchemist: Research/knowledge tools (potion theme)
 * - map: Navigation/search tools (cartography theme)
 * - messenger: Communication/web tools (pigeon post theme)
 */
export type StallType = "blacksmith" | "scribe" | "alchemist" | "map" | "messenger";

/**
 * Visual configuration for each stall type
 */
export interface StallVisualConfig {
  /** Display label for the stall */
  label: string;
  /** Primary color (hex) */
  color: string;
  /** Emissive/glow color (hex) */
  emissiveColor: string;
  /** Description of the stall's purpose */
  description: string;
}

// =============================================================================
// Tool to Stall Mapping
// =============================================================================

/**
 * Tool to stall type mapping
 *
 * Maps tool names/types to their corresponding medieval stall.
 * Used to determine which stall an agent should visit when using a tool.
 *
 * Categories:
 * - blacksmith: Editing/modification tools (forge theme)
 * - scribe: Reading/documentation tools (scroll theme)
 * - alchemist: Research/knowledge tools (potion theme)
 * - map: Navigation/search tools (cartography theme)
 * - messenger: Communication/web tools (pigeon post theme)
 */
export const TOOL_STALL_MAP: Record<string, StallType> = {
  // Blacksmith - editing and modification tools
  Edit: "blacksmith",
  Write: "blacksmith",
  Bash: "blacksmith",
  NotebookEdit: "blacksmith",

  // Scribe - reading and documentation tools
  Read: "scribe",
  Glob: "scribe", // File listing is like reading a catalog

  // Alchemist - research and knowledge tools
  "context7-research": "alchemist",
  "exa-research": "alchemist",
  "ref-research": "alchemist",
  "sequential-thinking": "alchemist",
  research: "alchemist",

  // Map - navigation and search tools
  "serena-integration": "map",
  Grep: "map",
  mcp__serena__find_symbol: "map",
  mcp__serena__find_referencing_symbols: "map",
  mcp__serena__get_symbols_overview: "map",
  mcp__serena__search_for_pattern: "map",
  mcp__serena__list_dir: "map",
  mcp__serena__find_file: "map",

  // Messenger - communication and web tools
  WebFetch: "messenger",
  WebSearch: "messenger",
  Task: "messenger",
  mcp__mcp_proxy__web_search_exa: "messenger",
  mcp__playwright__browser_navigate: "messenger",
  mcp__playwright__browser_snapshot: "messenger",
};

/**
 * Get the stall type for a given tool name
 *
 * Uses direct lookup first, then pattern matching for MCP tools
 * and other tools that may have dynamic naming.
 *
 * @param toolName - Name of the tool being invoked
 * @returns StallType or undefined if tool not mapped
 *
 * @example
 * getStallForTool("Edit") // returns "blacksmith"
 * getStallForTool("WebSearch") // returns "messenger"
 * getStallForTool("mcp__serena__find_symbol") // returns "map"
 */
export function getStallForTool(toolName: string): StallType | undefined {
  // Direct match
  if (TOOL_STALL_MAP[toolName]) {
    return TOOL_STALL_MAP[toolName];
  }

  // Pattern matching for MCP tools and variants
  const lowerName = toolName.toLowerCase();

  // Map - navigation and search tools
  if (
    lowerName.includes("serena") ||
    lowerName.includes("grep") ||
    lowerName.includes("glob") ||
    lowerName.includes("find_symbol") ||
    lowerName.includes("list_dir") ||
    lowerName.includes("find_file")
  ) {
    return "map";
  }

  // Blacksmith - editing and modification tools
  if (
    lowerName.includes("edit") ||
    lowerName.includes("write") ||
    lowerName.includes("bash") ||
    lowerName.includes("notebook")
  ) {
    return "blacksmith";
  }

  // Scribe - reading tools
  if (lowerName.includes("read")) {
    return "scribe";
  }

  // Alchemist - research and knowledge tools
  if (
    lowerName.includes("research") ||
    lowerName.includes("context7") ||
    lowerName.includes("exa") ||
    lowerName.includes("thinking") ||
    lowerName.includes("sequential")
  ) {
    return "alchemist";
  }

  // Messenger - communication and web tools
  if (
    lowerName.includes("web") ||
    lowerName.includes("fetch") ||
    lowerName.includes("search") ||
    lowerName.includes("browser") ||
    lowerName.includes("playwright") ||
    lowerName.includes("task")
  ) {
    return "messenger";
  }

  return undefined;
}

// =============================================================================
// Stall Position Configuration
// =============================================================================

/**
 * Stall positions around the town square
 *
 * Arranged in a pattern around the central area.
 * Positions are [x, y, z] coordinates where:
 * - x: left (-) / right (+)
 * - y: up/down (0 = ground level)
 * - z: front (+) / back (-)
 *
 * Layout (top-down view):
 * ```
 *              [messenger]
 *                (0, 4)
 *
 *   [blacksmith]         [scribe]
 *    (-4, 2)              (4, 2)
 *
 *               CENTER
 *
 *   [alchemist]          [map]
 *    (-4, -2)             (4, -2)
 * ```
 */
export const STALL_POSITIONS: Record<StallType, [number, number, number]> = {
  blacksmith: [-4, 0, 2], // Left front - forge near entrance
  scribe: [4, 0, 2], // Right front - scroll tent
  alchemist: [-4, 0, -2], // Left back - potion lab
  map: [4, 0, -2], // Right back - cartography table
  messenger: [0, 0, 4], // Center front - pigeon post
};

/**
 * Get all stall positions as an array for iteration
 *
 * Useful for rendering all stalls in a scene or for
 * calculating distances to stalls.
 *
 * @returns Array of [stallType, position] tuples
 *
 * @example
 * getAllStallPositions().forEach(([type, pos]) => {
 *   console.log(`${type} is at ${pos.join(', ')}`);
 * });
 */
export function getAllStallPositions(): Array<[StallType, [number, number, number]]> {
  return Object.entries(STALL_POSITIONS) as Array<[StallType, [number, number, number]]>;
}

/**
 * Get position for a specific stall type
 *
 * @param stallType - Type of stall to get position for
 * @returns Position tuple [x, y, z]
 *
 * @example
 * const blacksmithPos = getStallPosition("blacksmith");
 * // Returns [-4, 0, 2]
 */
export function getStallPosition(stallType: StallType): [number, number, number] {
  return STALL_POSITIONS[stallType];
}

// =============================================================================
// Stall Visual Configuration
// =============================================================================

/**
 * Visual styling for each stall type
 *
 * Colors chosen to match the medieval theme and be distinct from each other:
 * - blacksmith: Dark brown base with orange forge glow
 * - scribe: Dark blue-gray with parchment glow
 * - alchemist: Dark green with bright green potion bubbles
 * - map: Tan/olive with gold treasure highlight
 * - messenger: Purple-gray with sky blue communication glow
 */
export const STALL_VISUALS: Record<StallType, StallVisualConfig> = {
  blacksmith: {
    label: "Blacksmith",
    color: "#4a3728", // Dark brown - wooden stall
    emissiveColor: "#ff6b35", // Orange - forge fire glow
    description: "Forge for editing and crafting code",
  },
  scribe: {
    label: "Scribe",
    color: "#2d3b4a", // Dark blue-gray - ink color
    emissiveColor: "#c9b896", // Parchment glow
    description: "Scrolls and documents for reading",
  },
  alchemist: {
    label: "Alchemist",
    color: "#1e3a29", // Dark green - potion color
    emissiveColor: "#7cfc00", // Bright green - bubbling potion
    description: "Potions of knowledge and research",
  },
  map: {
    label: "Cartographer",
    color: "#3d3d29", // Tan/olive - old map color
    emissiveColor: "#ffd700", // Gold - treasure map glow
    description: "Maps for navigating the codebase",
  },
  messenger: {
    label: "Messenger",
    color: "#3a2d4a", // Purple-gray - mystical
    emissiveColor: "#87ceeb", // Sky blue - communication
    description: "Carrier pigeons for web communication",
  },
};

/**
 * Get visual configuration for a stall type
 *
 * @param stallType - Type of stall
 * @returns StallVisualConfig for the specified stall
 *
 * @example
 * const config = getStallVisuals("blacksmith");
 * console.log(config.label); // "Blacksmith"
 * console.log(config.emissiveColor); // "#ff6b35"
 */
export function getStallVisuals(stallType: StallType): StallVisualConfig {
  return STALL_VISUALS[stallType];
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a stall type is valid
 *
 * @param type - String to check
 * @returns true if the string is a valid StallType
 */
export function isValidStallType(type: string): type is StallType {
  return ["blacksmith", "scribe", "alchemist", "map", "messenger"].includes(type);
}

/**
 * Get all stall types as an array
 *
 * @returns Array of all StallType values
 */
export function getAllStallTypes(): StallType[] {
  return ["blacksmith", "scribe", "alchemist", "map", "messenger"];
}

// =============================================================================
// Animation Timing Configuration
// =============================================================================

/**
 * Animation timing configuration for stall visits
 *
 * Defines the timing for the stall visit animation sequence:
 * 1. Agent at well receives tool call
 * 2. Agent walks to target stall (walkToStallDurationMs)
 * 3. Agent pauses at stall while "using" tool (pauseAtStallDurationMs)
 * 4. Agent walks back to well (walkToWellDurationMs)
 * 5. Agent returns to working status
 */
export const STALL_ANIMATION_CONFIG = {
  /** Time to walk from well to stall (ms) */
  walkToStallDurationMs: 1000,

  /** Time to pause at stall while tool executes (ms) */
  pauseAtStallDurationMs: 750,

  /** Time to walk from stall back to well (ms) */
  walkToWellDurationMs: 1000,

  /** Debounce time for rapid tool calls (ms) - prevents interrupting animations */
  toolDebounceMs: 200,

  /** Minimum time between stall visits for same agent (ms) */
  minTimeBetweenVisitsMs: 500,
} as const;

/** Type export for animation config */
export type StallAnimationConfig = typeof STALL_ANIMATION_CONFIG;

/**
 * Central well position (town square center)
 * Re-exported for use by visualization state
 */
export const WELL_POSITION: [number, number, number] = [0, 0.5, 0];
