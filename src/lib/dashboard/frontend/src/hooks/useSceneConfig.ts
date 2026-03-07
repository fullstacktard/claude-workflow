/**
 * useSceneConfig Hook
 *
 * Loads and manages scene configuration for the 3D visualization.
 * Supports loading custom scene configs or falling back to defaults.
 *
 * @module hooks/useSceneConfig
 */

import { useState, useEffect, useCallback } from "react";
import type {
  SceneConfig,
  SceneProject,
  Position3D,
  SpawnPoint,
} from "../types/visualization";
import { DEFAULT_SCENE_CONFIG } from "../types/visualization";

// ============================================================================
// Types
// ============================================================================

/**
 * Scene config loading state
 */
export interface UseSceneConfigResult {
  /** Current scene configuration */
  config: SceneConfig;
  /** Whether config is currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Reload configuration from source */
  reload: () => Promise<void>;
  /** Get spawn point for a project (round-robin assignment) */
  getSpawnPoint: (projectId: string, agentIndex: number) => Position3D;
  /** Get project config by ID */
  getProject: (projectId: string) => SceneProject | undefined;
  /** Get model config for agent type */
  getAgentModel: (agentType: string) => { path: string; scale: number; heightOffset: number };
}

// ============================================================================
// Constants
// ============================================================================

/** Default config file path */
const CONFIG_PATH = "/config/scene-config.json";

/** Grid layout for fallback (when no custom config) */
const GRID_COLUMNS = 3;
const GRID_SPACING = 4;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate programmatic grid position for a project
 */
function getGridPosition(index: number): Position3D {
  const col = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  const x = (col - (GRID_COLUMNS - 1) / 2) * GRID_SPACING;
  const z = row * GRID_SPACING;
  return [x, 0, z];
}

/**
 * Generate default spawn points around a position
 */
function generateDefaultSpawnPoints(
  center: Position3D,
  count: number = 4,
  radius: number = 1.2
): SpawnPoint[] {
  const points: SpawnPoint[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push({
      slot: String(i + 1),
      position: [
        center[0] + Math.cos(angle) * radius * 0.5,
        center[1] + 0.5, // Height offset
        center[2] + Math.sin(angle) * radius * 0.5,
      ],
    });
  }
  return points;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for loading and managing scene configuration
 *
 * @param configPath - Optional custom path to config file
 * @returns Scene configuration and utilities
 *
 * @example
 * ```tsx
 * function Visualization() {
 *   const { config, isLoading, getSpawnPoint } = useSceneConfig();
 *
 *   if (isLoading) return <Loading />;
 *
 *   return (
 *     <Scene3D>
 *       {agents.map((agent, i) => (
 *         <Agent
 *           position={getSpawnPoint(agent.projectId, i)}
 *         />
 *       ))}
 *     </Scene3D>
 *   );
 * }
 * ```
 */
export function useSceneConfig(configPath?: string): UseSceneConfigResult {
  const [config, setConfig] = useState<SceneConfig>(DEFAULT_SCENE_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load configuration from file
   */
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(configPath || CONFIG_PATH);

      if (!response.ok) {
        // Config file doesn't exist - use defaults
        if (response.status === 404) {
          console.log("[useSceneConfig] No custom config found, using defaults");
          setConfig(DEFAULT_SCENE_CONFIG);
          return;
        }
        throw new Error(`Failed to load scene config: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate required fields
      if (!data.projects) {
        data.projects = [];
      }
      if (!data.cameras) {
        data.cameras = DEFAULT_SCENE_CONFIG.cameras;
      }
      if (!data.agentModels) {
        data.agentModels = DEFAULT_SCENE_CONFIG.agentModels;
      }

      setConfig({
        ...DEFAULT_SCENE_CONFIG,
        ...data,
      });

      console.log("[useSceneConfig] Loaded config:", data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading config";
      console.warn("[useSceneConfig] Error:", message);
      setError(message);
      setConfig(DEFAULT_SCENE_CONFIG);
    } finally {
      setIsLoading(false);
    }
  }, [configPath]);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /**
   * Get project configuration by ID
   */
  const getProject = useCallback(
    (projectId: string): SceneProject | undefined => {
      return config.projects.find((p) => p.id === projectId || p.name === projectId);
    },
    [config.projects]
  );

  /**
   * Get spawn point for an agent
   * Uses round-robin assignment within project's spawn points
   */
  const getSpawnPoint = useCallback(
    (projectId: string, agentIndex: number): Position3D => {
      const project = getProject(projectId);

      if (project && project.spawnPoints.length > 0) {
        // Use configured spawn points (round-robin)
        const spawnIndex = agentIndex % project.spawnPoints.length;
        return project.spawnPoints[spawnIndex].position;
      }

      if (project) {
        // Project exists but no spawn points - generate around project position
        const generatedPoints = generateDefaultSpawnPoints(
          project.position,
          4,
          config.defaultWanderRadius || 1.2
        );
        const spawnIndex = agentIndex % generatedPoints.length;
        return generatedPoints[spawnIndex].position;
      }

      // No project config - use grid layout
      // Find project index from all known projects
      const projectIds = Array.from(
        new Set([...config.projects.map((p) => p.id), projectId])
      );
      const projectIndex = projectIds.indexOf(projectId);
      const gridPos = getGridPosition(projectIndex >= 0 ? projectIndex : 0);

      // Generate spawn point offset from grid position
      const spawnOffset = agentIndex % 4;
      const angle = (spawnOffset / 4) * Math.PI * 2;
      const radius = (config.defaultWanderRadius || 1.2) * 0.5;

      return [
        gridPos[0] + Math.cos(angle) * radius,
        (config.defaultHeightOffset || 0.5),
        gridPos[2] + Math.sin(angle) * radius,
      ];
    },
    [config, getProject]
  );

  /**
   * Get model configuration for an agent type
   */
  const getAgentModel = useCallback(
    (agentType: string): { path: string; scale: number; heightOffset: number } => {
      const modelConfig = config.agentModels[agentType] || config.agentModels["default"];
      return {
        path: modelConfig?.path || "",
        scale: modelConfig?.scale || 1,
        heightOffset: modelConfig?.heightOffset || config.defaultHeightOffset || 0.5,
      };
    },
    [config]
  );

  return {
    config,
    isLoading,
    error,
    reload: loadConfig,
    getSpawnPoint,
    getProject,
    getAgentModel,
  };
}

export default useSceneConfig;
