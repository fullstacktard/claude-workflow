/**
 * TypeScript interfaces for Persona management dashboard.
 * Based on ElizaOS character file format (v2).
 * See: docs/research/elizaos-character-format-and-generation-pipeline.md
 *
 * SECURITY: Backend maps full persona files -> DashboardPersona at route handler level,
 * stripping any sensitive settings (API keys, chain configs, etc.).
 */

/** Persona lifecycle states */
export type PersonaStatus = "active" | "draft" | "archived";

/**
 * Complete character file structure for editor.
 * Based on ElizaOS Character interface -- only two fields required: name and bio.
 */
export interface PersonaCharacterFile {
  /** Display name (required) */
  name: string;
  /** Background/personality description -- array of bio segments (required) */
  bio: string[];
  /** Backstory and context */
  lore: string[];
  /** Conversation topics / areas of expertise */
  topics: string[];
  /** Character trait words (e.g., "helpful", "sarcastic") */
  adjectives: string[];
  /** Writing style rules by context */
  style: {
    /** Universal rules applied to ALL outputs */
    all: string[];
    /** Social media post rules */
    post: string[];
    /** Chat/DM rules */
    chat: string[];
  };
  /** Example tweets for training/consistency */
  postExamples: string[];
  /** Conversation examples -- array of exchanges */
  messageExamples: Array<Array<{ user: string; content: string }>>;
  /** Optional configuration */
  settings?: Record<string, unknown>;
}

/**
 * Dashboard-safe persona summary for list display.
 * Lightweight DTO -- full character file loaded on demand in editor.
 */
export interface DashboardPersona {
  /** Unique persona ID */
  id: string;
  /** Display name */
  name: string;
  /** First bio entry (summary) */
  bio: string;
  /** Number of topics defined */
  topicCount: number;
  /** IDs of linked X accounts */
  linkedAccountIds: string[];
  /** Persona lifecycle status */
  status: PersonaStatus;
  /** Creation timestamp (ISO 8601) */
  created_at: string;
  /** Last update timestamp (ISO 8601) */
  updated_at: string;
}

/** Result shape returned by usePersonas hook */
export interface UsePersonasResult {
  /** Current persona list (reactive) */
  personas: DashboardPersona[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Re-fetch personas from API */
  refetch: () => Promise<void>;
}

/**
 * Create an empty character file with sensible defaults.
 * Used when creating a new persona via the "Create New" button.
 */
export function createEmptyCharacterFile(): PersonaCharacterFile {
  return {
    name: "",
    bio: [""],
    lore: [],
    topics: [],
    adjectives: [],
    style: { all: [], post: [], chat: [] },
    postExamples: [],
    messageExamples: [],
  };
}

/**
 * Validate that an imported JSON object conforms to the PersonaCharacterFile shape.
 * Returns null if valid, error message string if invalid.
 */
export function validateCharacterFile(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "Character file must be a JSON object";
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    return "Character file must have a non-empty 'name' field";
  }
  if (!Array.isArray(obj.bio) && typeof obj.bio !== "string") {
    return "Character file must have a 'bio' field (string or string array)";
  }
  if (obj.style !== undefined) {
    if (typeof obj.style !== "object" || obj.style === null) {
      return "'style' must be an object with all/post/chat arrays";
    }
  }
  if (obj.topics !== undefined && !Array.isArray(obj.topics)) {
    return "'topics' must be an array of strings";
  }
  if (obj.adjectives !== undefined && !Array.isArray(obj.adjectives)) {
    return "'adjectives' must be an array of strings";
  }
  if (obj.postExamples !== undefined && !Array.isArray(obj.postExamples)) {
    return "'postExamples' must be an array of strings";
  }
  return null;
}
