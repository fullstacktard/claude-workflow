/**
 * Medieval Character Classes Configuration
 * Maps agent types to medieval character archetypes for visual differentiation
 *
 * This configuration provides unique visual properties for each agent type
 * in the 3D visualization, creating a cohesive medieval village theme.
 *
 * @module config/medieval-character-classes
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Working effect types for particle/visual effects when agent is active
 */
export type WorkingEffectType =
  | "sparks" // Forge sparks (blacksmith)
  | "magic" // Magical particles (alchemist, sage)
  | "scrolls" // Floating paper/scrolls (scribe, herald)
  | "ink" // Ink splatter (artisan, monk)
  | "gears" // Mechanical gears (engineer)
  | "potions" // Bubbling potion effects (alchemist)
  | "confetti" // Celebration particles (jester)
  | "dust" // Dust particles (adventurer)
  | "none"; // No special effect

/**
 * Medieval character class configuration
 * Defines the visual appearance and properties for a character type
 */
export interface MedievalCharacterClass {
  /** Medieval class name (e.g., "Blacksmith", "Scholar") */
  className: string;

  /** Short description of the class role */
  description: string;

  /** Primary color for cloak/clothing (hex) */
  primaryColor: string;

  /** Secondary/accent color for details (hex) */
  secondaryColor: string;

  /** Glow/aura color when agent is active (hex) */
  auraColor: string;

  /** Icon to display - emoji or path to icon asset */
  icon: string;

  /** Props/items the character carries */
  props: string[];

  /** Particle effect type when working */
  workingEffect: WorkingEffectType;

  /** Optional animation modifier (affects movement style) */
  animationStyle?: "steady" | "nimble" | "heavy" | "graceful" | "energetic";

  /** Optional badge/rank indicator */
  rank?: "apprentice" | "journeyman" | "master" | "grandmaster";
}

// =============================================================================
// Character Class Definitions
// =============================================================================

/**
 * Medieval Character Classes Mapping
 *
 * Maps agent types to their medieval counterparts with unique visual properties.
 * Colors are chosen to complement the existing AGENT_HEX_COLORS while providing
 * medieval-themed aesthetics.
 *
 * Color philosophy:
 * - Primary colors: Base outfit color (cloak, tunic, robe)
 * - Secondary colors: Accent details (trim, belt, accessories)
 * - Aura colors: Magical glow when active (often brighter version of primary)
 */
export const MEDIEVAL_CHARACTER_CLASSES: Record<string, MedievalCharacterClass> =
  {
    // =========================================================================
    // Core Engineering Roles
    // =========================================================================

    /**
     * Backend Engineer -> Blacksmith
     * The backbone of the village, forging the infrastructure
     */
    "backend-engineer": {
      className: "Blacksmith",
      description: "Master of the forge, crafting robust server infrastructure",
      primaryColor: "#4A3728", // Dark brown leather apron
      secondaryColor: "#8B4513", // Saddle brown trim
      auraColor: "#FF6B35", // Forge fire orange
      icon: "hammer-and-anvil",
      props: ["hammer", "apron", "tongs", "anvil"],
      workingEffect: "sparks",
      animationStyle: "heavy",
      rank: "master",
    },

    /**
     * Frontend Engineer -> Artisan/Painter
     * Brings color and beauty to the village through craft
     */
    "frontend-engineer": {
      className: "Artisan",
      description: "Creative craftsman painting beautiful interfaces",
      primaryColor: "#8B5CF6", // Purple artist smock
      secondaryColor: "#F472B6", // Pink accent (matches existing hex)
      auraColor: "#C4B5FD", // Light purple glow
      icon: "paint-brush-palette",
      props: ["brush", "palette", "easel", "color-pots"],
      workingEffect: "ink",
      animationStyle: "graceful",
      rank: "journeyman",
    },

    /**
     * QA Engineer -> Guard/Watchman
     * Vigilant protector ensuring quality and safety
     */
    "qa-engineer": {
      className: "Guard",
      description: "Vigilant watchman protecting code quality",
      primaryColor: "#374151", // Steel gray armor
      secondaryColor: "#4ADE80", // Green trim (matches existing)
      auraColor: "#86EFAC", // Light green vigilance glow
      icon: "shield-sword",
      props: ["spear", "shield", "lantern", "horn"],
      workingEffect: "none",
      animationStyle: "steady",
      rank: "journeyman",
    },

    /**
     * DevOps Engineer -> Siege Engineer
     * Master of deployment machinery and infrastructure
     */
    "devops-engineer": {
      className: "Siege Engineer",
      description: "Constructor of deployment engines and pipelines",
      primaryColor: "#78350F", // Dark amber/brown
      secondaryColor: "#FB923C", // Orange accent (matches existing)
      auraColor: "#FDBA74", // Light orange glow
      icon: "gears-blueprint",
      props: ["blueprints", "compass", "tools", "gears"],
      workingEffect: "gears",
      animationStyle: "steady",
      rank: "master",
    },

    // =========================================================================
    // Problem Solving & Analysis Roles
    // =========================================================================

    /**
     * Debugger -> Alchemist
     * Transforms problematic code through mysterious processes
     */
    debugger: {
      className: "Alchemist",
      description: "Mysterious solver transmuting bugs into solutions",
      primaryColor: "#312E81", // Deep indigo robes
      secondaryColor: "#818CF8", // Light indigo trim
      auraColor: "#A78BFA", // Purple mystical glow
      icon: "potion-flask",
      props: ["robes", "potions", "staff", "glowing-orb"],
      workingEffect: "potions",
      animationStyle: "nimble",
      rank: "master",
    },

    /**
     * Code Reviewer -> Scribe/Monk
     * Studious examiner of code scrolls
     */
    "code-reviewer": {
      className: "Scribe",
      description: "Learned monk reviewing and annotating code scrolls",
      primaryColor: "#451A03", // Dark brown monk robes
      secondaryColor: "#FACC15", // Gold accents (matches existing)
      auraColor: "#FDE047", // Golden wisdom glow
      icon: "scroll-quill",
      props: ["robes", "scrolls", "quill", "inkwell"],
      workingEffect: "scrolls",
      animationStyle: "steady",
      rank: "journeyman",
    },

    /**
     * Research -> Scholar/Sage
     * Wise seeker of knowledge and understanding
     */
    research: {
      className: "Scholar",
      description: "Wise sage seeking knowledge in ancient tomes",
      primaryColor: "#1E3A5F", // Deep navy scholar robes
      secondaryColor: "#C084FC", // Purple accent (matches existing)
      auraColor: "#E9D5FF", // Light purple wisdom glow
      icon: "book-glasses",
      props: ["books", "spectacles", "staff", "beard"],
      workingEffect: "magic",
      animationStyle: "graceful",
      rank: "grandmaster",
    },

    // =========================================================================
    // Planning & Leadership Roles
    // =========================================================================

    /**
     * Task Maker -> Steward/Herald
     * Official announcer and task delegator
     */
    "task-maker": {
      className: "Herald",
      description: "Official steward proclaiming tasks and duties",
      primaryColor: "#7C2D12", // Burgundy official attire
      secondaryColor: "#4ADE80", // Green trim (matches existing)
      auraColor: "#BBF7D0", // Light green announcement glow
      icon: "scroll-trumpet",
      props: ["scroll", "trumpet", "official-attire", "seal"],
      workingEffect: "scrolls",
      animationStyle: "energetic",
      rank: "journeyman",
    },

    /**
     * Feature Planner -> Architect
     * Master planner designing the village's future
     */
    "feature-planner": {
      className: "Architect",
      description: "Master planner designing grand structures",
      primaryColor: "#1E40AF", // Royal blue (matches existing)
      secondaryColor: "#60A5FA", // Light blue trim
      auraColor: "#93C5FD", // Bright blue planning glow
      icon: "compass-ruler",
      props: ["blueprints", "compass", "ruler", "model"],
      workingEffect: "ink",
      animationStyle: "graceful",
      rank: "master",
    },

    /**
     * CTO Architect -> Lord/Noble
     * Noble leader with commanding presence
     */
    "cto-architect": {
      className: "Lord",
      description: "Noble leader commanding the technical realm",
      primaryColor: "#4C1D95", // Royal purple
      secondaryColor: "#C084FC", // Light purple (matches existing)
      auraColor: "#DDD6FE", // Regal purple glow
      icon: "crown-scepter",
      props: ["fine-clothes", "scepter", "ring", "cape"],
      workingEffect: "magic",
      animationStyle: "graceful",
      rank: "grandmaster",
    },

    // =========================================================================
    // Special/Unique Roles
    // =========================================================================

    /**
     * Fullstacktard -> Adventurer/Hero
     * Versatile hero capable of any quest
     */
    fullstacktard: {
      className: "Adventurer",
      description: "Versatile hero mastering all disciplines",
      primaryColor: "#065F46", // Forest green
      secondaryColor: "#D4A574", // Tan leather
      auraColor: "#6EE7B7", // Emerald glow
      icon: "sword-staff",
      props: ["sword", "staff", "backpack", "multi-tool"],
      workingEffect: "dust",
      animationStyle: "nimble",
      rank: "master",
    },

    /**
     * Erlich Bachman -> Court Jester
     * Colorful entertainer with unconventional wisdom
     */
    "erlich-bachman": {
      className: "Court Jester",
      description: "Flamboyant entertainer with surprising insights",
      primaryColor: "#DC2626", // Bright red
      secondaryColor: "#FBBF24", // Gold/yellow
      auraColor: "#FEF08A", // Bright festive glow
      icon: "jester-hat",
      props: ["bells", "colorful-attire", "scepter", "cards"],
      workingEffect: "confetti",
      animationStyle: "energetic",
      rank: "master",
    },

    // =========================================================================
    // Additional Agent Types (from visualization-config.ts)
    // =========================================================================

    /**
     * Explore -> Scout/Ranger
     * Explores unknown territories and gathers intelligence
     */
    Explore: {
      className: "Scout",
      description: "Nimble ranger exploring uncharted code territories",
      primaryColor: "#2D5016", // Forest green
      secondaryColor: "#60A5FA", // Blue accent (matches existing)
      auraColor: "#86EFAC", // Light green exploration glow
      icon: "compass-map",
      props: ["bow", "cloak", "map", "spyglass"],
      workingEffect: "dust",
      animationStyle: "nimble",
      rank: "journeyman",
    },

    /**
     * Skill Analyzer -> Lore Keeper
     * Studies and catalogs skills and knowledge
     */
    "skill-analyzer": {
      className: "Lore Keeper",
      description: "Keeper of ancient skill knowledge",
      primaryColor: "#164E63", // Teal robes
      secondaryColor: "#22D3EE", // Cyan accent (matches existing)
      auraColor: "#67E8F9", // Cyan knowledge glow
      icon: "tome-magnifier",
      props: ["tome", "magnifier", "spectacles", "scrolls"],
      workingEffect: "scrolls",
      animationStyle: "steady",
      rank: "master",
    },

    /**
     * Task Reviewer -> Magistrate
     * Reviews and judges completed work
     */
    "task-reviewer": {
      className: "Magistrate",
      description: "Just judge evaluating completed quests",
      primaryColor: "#1E3A5F", // Dark navy robes
      secondaryColor: "#22D3EE", // Cyan accent (matches existing)
      auraColor: "#A5F3FC", // Light cyan judgment glow
      icon: "gavel-scale",
      props: ["gavel", "scales", "robes", "seal"],
      workingEffect: "scrolls",
      animationStyle: "steady",
      rank: "master",
    },

    /**
     * Auto Fixer -> Tinker
     * Automatically repairs and improves
     */
    "auto-fixer": {
      className: "Tinker",
      description: "Ingenious mechanic with automatic repair skills",
      primaryColor: "#7F1D1D", // Dark red
      secondaryColor: "#F87171", // Red accent (matches existing)
      auraColor: "#FCA5A5", // Light red repair glow
      icon: "wrench-cog",
      props: ["wrench", "cogs", "oil-can", "toolbox"],
      workingEffect: "gears",
      animationStyle: "nimble",
      rank: "journeyman",
    },

    /**
     * Lint Fixer -> Tailor
     * Fixes styling and formatting issues
     */
    "lint-fixer": {
      className: "Tailor",
      description: "Precise craftsman perfecting code attire",
      primaryColor: "#854D0E", // Brown
      secondaryColor: "#FACC15", // Yellow accent (matches existing)
      auraColor: "#FEF08A", // Light yellow precision glow
      icon: "needle-thread",
      props: ["needle", "thread", "shears", "measuring-tape"],
      workingEffect: "ink",
      animationStyle: "nimble",
      rank: "journeyman",
    },

    /**
     * Workflow Aggregator -> Quartermaster
     * Manages workflow resources and aggregation
     */
    "workflow-aggregator": {
      className: "Quartermaster",
      description: "Organizer managing workflow supplies and logistics",
      primaryColor: "#78350F", // Amber brown
      secondaryColor: "#FB923C", // Orange accent (matches existing)
      auraColor: "#FED7AA", // Light orange logistics glow
      icon: "ledger-key",
      props: ["ledger", "keys", "satchel", "abacus"],
      workingEffect: "scrolls",
      animationStyle: "steady",
      rank: "journeyman",
    },

    /**
     * V0 Planner -> Oracle
     * Plans and envisions future interfaces
     */
    "v0-planner": {
      className: "Oracle",
      description: "Mystical seer envisioning interface futures",
      primaryColor: "#4C1D95", // Deep purple
      secondaryColor: "#C084FC", // Purple accent (matches existing)
      auraColor: "#E9D5FF", // Light purple vision glow
      icon: "crystal-ball",
      props: ["crystal-ball", "robes", "veil", "incense"],
      workingEffect: "magic",
      animationStyle: "graceful",
      rank: "master",
    },

    /**
     * V0 UI Generator -> Enchanter
     * Creates magical UI components
     */
    "v0-ui-generator": {
      className: "Enchanter",
      description: "Spellcaster conjuring interface enchantments",
      primaryColor: "#831843", // Deep magenta
      secondaryColor: "#F472B6", // Pink accent (matches existing)
      auraColor: "#F9A8D4", // Light pink magic glow
      icon: "wand-sparkle",
      props: ["wand", "spell-book", "runes", "crystals"],
      workingEffect: "magic",
      animationStyle: "graceful",
      rank: "master",
    },

    /**
     * Style Guide Generator -> Illuminator
     * Creates beautiful style manuscripts
     */
    "style-guide-generator": {
      className: "Illuminator",
      description: "Artist creating magnificent style manuscripts",
      primaryColor: "#581C87", // Deep purple
      secondaryColor: "#C084FC", // Purple accent (matches existing)
      auraColor: "#D8B4FE", // Light purple artistic glow
      icon: "quill-gold",
      props: ["gold-leaf", "quill", "pigments", "vellum"],
      workingEffect: "ink",
      animationStyle: "graceful",
      rank: "master",
    },
  };

// =============================================================================
// Default Character Class
// =============================================================================

/**
 * Default character class for unknown agent types
 * Provides a neutral villager appearance
 */
export const DEFAULT_CHARACTER_CLASS: MedievalCharacterClass = {
  className: "Villager",
  description: "Humble worker contributing to the realm",
  primaryColor: "#6B7280", // Gray
  secondaryColor: "#9CA3AF", // Light gray
  auraColor: "#D1D5DB", // Silver glow
  icon: "person",
  props: ["simple-clothes", "pouch"],
  workingEffect: "none",
  animationStyle: "steady",
  rank: "apprentice",
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get character class configuration for an agent type
 *
 * @param agentType - Name of the agent (e.g., 'frontend-engineer')
 * @returns MedievalCharacterClass configuration
 *
 * @example
 * const characterClass = getCharacterClass('frontend-engineer');
 * console.log(characterClass.className); // "Artisan"
 * console.log(characterClass.primaryColor); // "#8B5CF6"
 */
export function getCharacterClass(agentType: string): MedievalCharacterClass {
  if (!agentType) {
    return DEFAULT_CHARACTER_CLASS;
  }

  // Normalize agent type name (remove common suffixes)
  const normalizedName = agentType.replace(/ invoked$/i, "").trim();

  return MEDIEVAL_CHARACTER_CLASSES[normalizedName] ?? DEFAULT_CHARACTER_CLASS;
}

/**
 * Get primary color for an agent type's character class
 *
 * @param agentType - Name of the agent (e.g., 'backend-engineer')
 * @returns Hex color string for the character's primary color
 *
 * @example
 * const color = getCharacterColor('backend-engineer');
 * // Returns '#4A3728' (Blacksmith's dark brown)
 */
export function getCharacterColor(agentType: string): string {
  const characterClass = getCharacterClass(agentType);
  return characterClass.primaryColor;
}

/**
 * Get working effect type for an agent type's character class
 *
 * @param agentType - Name of the agent (e.g., 'debugger')
 * @returns WorkingEffectType string for particle effects
 *
 * @example
 * const effect = getCharacterEffect('debugger');
 * // Returns 'potions' (Alchemist's bubbling potions effect)
 */
export function getCharacterEffect(agentType: string): WorkingEffectType {
  const characterClass = getCharacterClass(agentType);
  return characterClass.workingEffect;
}

/**
 * Get aura color for an agent type (used for active/working state glow)
 *
 * @param agentType - Name of the agent
 * @returns Hex color string for the character's aura
 *
 * @example
 * const aura = getCharacterAuraColor('cto-architect');
 * // Returns '#DDD6FE' (Lord's regal purple glow)
 */
export function getCharacterAuraColor(agentType: string): string {
  const characterClass = getCharacterClass(agentType);
  return characterClass.auraColor;
}

/**
 * Get all props for an agent type's character
 *
 * @param agentType - Name of the agent
 * @returns Array of prop names for the character
 *
 * @example
 * const props = getCharacterProps('backend-engineer');
 * // Returns ['hammer', 'apron', 'tongs', 'anvil']
 */
export function getCharacterProps(agentType: string): string[] {
  const characterClass = getCharacterClass(agentType);
  return characterClass.props;
}

/**
 * Get character class name (display name) for an agent type
 *
 * @param agentType - Name of the agent
 * @returns Medieval class name string
 *
 * @example
 * const className = getCharacterClassName('frontend-engineer');
 * // Returns 'Artisan'
 */
export function getCharacterClassName(agentType: string): string {
  const characterClass = getCharacterClass(agentType);
  return characterClass.className;
}

/**
 * Check if an agent type has a defined character class
 *
 * @param agentType - Name of the agent
 * @returns true if character class exists, false for default
 *
 * @example
 * hasDefinedCharacterClass('frontend-engineer'); // true
 * hasDefinedCharacterClass('unknown-agent'); // false
 */
export function hasDefinedCharacterClass(agentType: string): boolean {
  if (!agentType) {
    return false;
  }
  const normalizedName = agentType.replace(/ invoked$/i, "").trim();
  return normalizedName in MEDIEVAL_CHARACTER_CLASSES;
}

/**
 * Get all defined agent types with character classes
 *
 * @returns Array of agent type names that have character class definitions
 *
 * @example
 * const types = getDefinedAgentTypes();
 * // Returns ['backend-engineer', 'frontend-engineer', 'qa-engineer', ...]
 */
export function getDefinedAgentTypes(): string[] {
  return Object.keys(MEDIEVAL_CHARACTER_CLASSES);
}

/**
 * Get character classes grouped by working effect type
 * Useful for creating effect-based visual groupings
 *
 * @returns Map of effect types to arrays of agent types
 *
 * @example
 * const byEffect = getCharactersByEffect();
 * byEffect.get('magic'); // ['debugger', 'research', 'cto-architect', ...]
 */
export function getCharactersByEffect(): Map<WorkingEffectType, string[]> {
  const byEffect = new Map<WorkingEffectType, string[]>();

  for (const [agentType, config] of Object.entries(MEDIEVAL_CHARACTER_CLASSES)) {
    const effect = config.workingEffect;
    const existing = byEffect.get(effect) ?? [];
    existing.push(agentType);
    byEffect.set(effect, existing);
  }

  return byEffect;
}

// =============================================================================
// Type Exports
// =============================================================================

/** All available medieval class names */
export type MedievalClassName = MedievalCharacterClass["className"];

/** Agent types with defined character classes */
export type DefinedAgentType = keyof typeof MEDIEVAL_CHARACTER_CLASSES;
