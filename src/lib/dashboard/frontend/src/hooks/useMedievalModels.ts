/**
 * useMedievalModels Hook
 *
 * Fetches and caches the medieval-models.json manifest that maps
 * agent types to character models for the medieval village visualization.
 *
 * Features:
 * - Module-level caching (loaded once, shared across components)
 * - Loading/error states with proper TypeScript types
 * - Helper function to get model config by agent type
 * - Graceful fallback when manifest is not found
 *
 * @module hooks/useMedievalModels
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a single medieval character model
 */
export interface MedievalModelEntry {
  /** Path to GLTF/GLB model file (relative to public directory) */
  path: string;
  /** Scale factor for the model */
  scale: number;
  /** Height offset from ground (Y axis adjustment) */
  heightOffset: number;
  /** Optional paths to animation GLB files */
  animations?: string[];
  /** Path to walk animation (first animation in array) */
  walkAnimationPath?: string;
  /** Path to run animation (second animation in array) */
  runAnimationPath?: string;
}

/**
 * Raw character entry from the manifest JSON
 */
interface RawCharacterEntry {
  modelPath: string;
  scale: number;
  heightOffset: number;
  animations?: string[];
}

/**
 * Medieval models manifest structure (actual JSON format)
 * The manifest directly maps agent types to model configurations in `characters`
 */
export interface MedievalModelsManifest {
  version: string;
  /** Agent type to model config mapping */
  characters: Record<string, RawCharacterEntry>;
  /** Building models */
  buildings?: Record<string, { modelPath: string; scale: number }>;
  /** Prop models */
  props?: Record<string, { modelPath: string; scale: number }>;
  /** Tool stall configurations */
  toolStalls?: Record<string, unknown>;
}

/**
 * Hook result interface
 */
export interface UseMedievalModelsResult {
  /** The loaded manifest data */
  manifest: MedievalModelsManifest | null;
  /** Whether the manifest is currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Get model configuration for an agent type (or random if agentId provided) */
  getModelConfig: (agentType: string, agentId?: string) => MedievalModelEntry;
  /** Reload the manifest */
  reload: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

/** Path to medieval models manifest */
const MANIFEST_PATH = "/models/medieval/medieval-models.json";

/** Default model configuration (fallback when manifest unavailable) */
const DEFAULT_MODEL_CONFIG: MedievalModelEntry = {
  path: "",
  scale: 1,
  heightOffset: 0.5,
};

// ============================================================================
// Module-level cache
// ============================================================================

let cachedManifest: MedievalModelsManifest | null = null;
let cachePromise: Promise<MedievalModelsManifest> | null = null;

/** Cache of random model assignments per agent ID */
const agentModelCache = new Map<string, string>();

/** Get all character model keys (excluding 'default') */
function getCharacterKeys(manifest: MedievalModelsManifest): string[] {
  return Object.keys(manifest.characters).filter((key) => key !== "default");
}

/** Pick a random character key from the manifest */
function pickRandomCharacter(manifest: MedievalModelsManifest): string {
  const keys = getCharacterKeys(manifest);
  if (keys.length === 0) return "default";
  return keys[Math.floor(Math.random() * keys.length)];
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for loading and accessing medieval character models manifest
 *
 * Features:
 * - Module-level caching (loaded once, shared across components)
 * - Loading/error states
 * - Helper function to get model config by agent type
 * - Graceful 404 handling with default fallback
 *
 * @returns {UseMedievalModelsResult} Hook result with manifest, loading state, and helper functions
 *
 * @example
 * ```tsx
 * function AgentCharacter({ agentType }: Props) {
 *   const { getModelConfig, isLoading } = useMedievalModels();
 *
 *   if (isLoading) return <LoadingPlaceholder />;
 *
 *   const { path, scale, heightOffset } = getModelConfig(agentType);
 *   return <ModelLoader modelPath={path} scale={scale} />;
 * }
 * ```
 */
export function useMedievalModels(): UseMedievalModelsResult {
  const [manifest, setManifest] = useState<MedievalModelsManifest | null>(
    cachedManifest
  );
  const [isLoading, setIsLoading] = useState(!cachedManifest);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  /**
   * Load manifest from server
   */
  const loadManifest = useCallback(async (): Promise<void> => {
    // If already cached, use it
    if (cachedManifest) {
      setManifest(cachedManifest);
      setIsLoading(false);
      return;
    }

    // If already loading, wait for that promise
    if (cachePromise) {
      try {
        const result = await cachePromise;
        if (mountedRef.current) {
          setManifest(result);
          setIsLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setIsLoading(false);
        }
      }
      return;
    }

    // Start new fetch
    setIsLoading(true);
    setError(null);

    cachePromise = (async (): Promise<MedievalModelsManifest> => {
      const response = await fetch(MANIFEST_PATH);

      if (!response.ok) {
        // Handle 404 gracefully - manifest may not exist yet
        if (response.status === 404) {
          console.warn(
            "[useMedievalModels] Manifest not found at",
            MANIFEST_PATH,
            "- using defaults"
          );
          const defaultManifest: MedievalModelsManifest = {
            version: "1.0.0",
            characters: {
              default: {
                modelPath: "",
                scale: 1,
                heightOffset: 0.5,
              },
            },
          };
          cachedManifest = defaultManifest;
          return defaultManifest;
        }
        throw new Error(`Failed to load manifest: ${response.statusText}`);
      }

      const data = (await response.json()) as MedievalModelsManifest;
      cachedManifest = data;
      return cachedManifest;
    })();

    try {
      const result = await cachePromise;
      if (mountedRef.current) {
        setManifest(result);
        setIsLoading(false);
      }
    } catch (err) {
      cachePromise = null; // Allow retry on error
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
      }
    }
  }, []);

  // Load on mount
  useEffect(() => {
    mountedRef.current = true;
    void loadManifest();
    return () => {
      mountedRef.current = false;
    };
  }, [loadManifest]);

  /**
   * Get model configuration for a given agent type
   *
   * When agentId is provided, randomly assigns a model from available characters
   * and caches the assignment so the same agent always gets the same model.
   * Without agentId, falls back to agent type lookup (legacy behavior).
   *
   * @param agentType - The agent type (e.g., "frontend-engineer") - used as fallback
   * @param agentId - Optional unique agent ID for random model assignment
   * @returns MedievalModelEntry with path, scale, and heightOffset
   */
  const getModelConfig = useCallback(
    (agentType: string, agentId?: string): MedievalModelEntry => {
      if (!manifest) {
        return DEFAULT_MODEL_CONFIG;
      }

      // Determine which character config to use
      let characterKey: string;

      if (agentId) {
        // Random assignment: check cache first, then assign randomly
        if (agentModelCache.has(agentId)) {
          characterKey = agentModelCache.get(agentId)!;
        } else {
          // Randomly pick a character and cache it
          characterKey = pickRandomCharacter(manifest);
          agentModelCache.set(agentId, characterKey);
          console.log(
            `[useMedievalModels] Randomly assigned model "${characterKey}" to agent ${agentId}`
          );
        }
      } else {
        // Legacy behavior: look up by agent type
        characterKey = manifest.characters[agentType]
          ? agentType
          : "default";
      }

      const rawConfig = manifest.characters[characterKey];

      if (!rawConfig) {
        console.warn(
          `[useMedievalModels] No model config found for character "${characterKey}"`
        );
        return DEFAULT_MODEL_CONFIG;
      }

      // Transform raw config to MedievalModelEntry (modelPath -> path)
      // Extract walk and run animation paths from animations array
      const animations = rawConfig.animations || [];
      const walkAnimationPath = animations.length > 0 ? animations[0] : undefined;
      const runAnimationPath = animations.length > 1 ? animations[1] : undefined;

      return {
        path: rawConfig.modelPath,
        scale: rawConfig.scale,
        heightOffset: rawConfig.heightOffset,
        animations,
        walkAnimationPath,
        runAnimationPath,
      };
    },
    [manifest]
  );

  return {
    manifest,
    isLoading,
    error,
    getModelConfig,
    reload: loadManifest,
  };
}

export default useMedievalModels;
