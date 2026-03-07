/**
 * ModelLoader Component
 * Loads GLTF/GLB models with Suspense loading states and error fallbacks
 *
 * This is the main component for loading 3D models in the visualization.
 * It composes GLTFModel, LoadingPlaceholder, FallbackGeometry, and
 * ModelErrorBoundary to provide a complete loading solution.
 *
 * Features:
 * - Automatic caching via drei's useGLTF
 * - Loading placeholder during fetch
 * - Error boundary with fallback geometry
 * - Configurable per agent type
 *
 * @module components/visualization/ModelLoader
 */

import { Suspense, useCallback } from "react";
import type { ThreeElements } from "@react-three/fiber";
import type { GLTF } from "three-stdlib";
import type { Group } from "three";
import { GLTFModel } from "./GLTFModel";
import { FBXModel } from "./FBXModel";
import { FallbackGeometry } from "./FallbackGeometry";
import { LoadingPlaceholder } from "./LoadingPlaceholder";
import { ModelErrorBoundary } from "./ModelErrorBoundary";
import {
  getAgentModelConfig,
  MODEL_CONFIG,
  type FallbackGeometryType,
} from "../../config/visualization-config";
import type { UseDisposalManagerResult } from "../../hooks/useDisposalManager";

/**
 * Detects model format from file path
 */
function getModelFormat(path: string): "gltf" | "fbx" {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "fbx") return "fbx";
  return "gltf"; // Default to GLTF for .glb, .gltf, or unknown
}

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface ModelLoaderProps extends Omit<GroupProps, "children"> {
  /** Agent type to load model for (uses config lookup) */
  agentType?: string;
  /** Direct model path (overrides agentType config) */
  modelPath?: string;
  /** Fallback geometry type when model fails */
  fallbackType?: FallbackGeometryType;
  /** Override fallback color */
  fallbackColor?: string;
  /** Callback when model loads successfully (receives GLTF or Group depending on format) */
  onLoaded?: (model: GLTF | Group) => void;
  /** Callback when model fails to load */
  onError?: (error: Error) => void;
  /** Skip model loading and always use fallback */
  useFallback?: boolean;
  /** Optional disposal manager for tracking loaded resources to prevent GPU memory leaks */
  disposalManager?: UseDisposalManagerResult;
}

/**
 * ModelLoader loads GLTF/GLB models with automatic loading states and fallbacks.
 *
 * The component handles three states:
 * 1. Loading: Shows animated LoadingPlaceholder (wireframe capsule)
 * 2. Success: Renders the GLTF model
 * 3. Error: Falls back to FallbackGeometry
 *
 * @example
 * // Load model for a specific agent type
 * <ModelLoader agentType="frontend-engineer" />
 *
 * @example
 * // Load a specific model path
 * <ModelLoader modelPath="/models/custom-character.glb" />
 *
 * @example
 * // With callbacks and positioning
 * <ModelLoader
 *   agentType="backend-engineer"
 *   position={[0, 0, 0]}
 *   onLoaded={(gltf) => handleAnimations(gltf.animations)}
 *   onError={(err) => logError(err)}
 * />
 *
 * @example
 * // Force fallback (useful for testing or missing models)
 * <ModelLoader agentType="default" useFallback />
 *
 * @example
 * // With disposal manager for memory leak prevention
 * const disposal = useDisposalManager();
 * <ModelLoader
 *   agentType="frontend-engineer"
 *   disposalManager={disposal}
 * />
 */
export function ModelLoader({
  agentType = "default",
  modelPath,
  fallbackType,
  fallbackColor,
  onLoaded,
  onError,
  useFallback = false,
  disposalManager,
  ...groupProps
}: ModelLoaderProps): JSX.Element {
  // Get configuration for this agent type
  const config = getAgentModelConfig(agentType);

  // Determine final model path and colors
  const finalModelPath = modelPath ?? config.modelPath;
  const finalFallbackType: FallbackGeometryType =
    fallbackType ?? MODEL_CONFIG.fallbackGeometry;
  const finalFallbackColor = fallbackColor ?? config.fallbackColor;
  const loadingColor = MODEL_CONFIG.loadingColor;

  // Error handler with logging (AC #13: Error messages logged to console)
  const handleError = useCallback(
    (error: Error) => {
      console.error(
        `[ModelLoader] Failed to load model for agent type "${agentType}":`,
        finalModelPath
      );
      console.error("[ModelLoader] Error:", error.message);

      if (onError) {
        onError(error);
      }
    },
    [agentType, finalModelPath, onError]
  );

  // Extract scale from groupProps - use passed scale prop if provided, otherwise use config default
  const { scale: groupScale, ...restGroupProps } = groupProps as {
    scale?: number;
  } & typeof groupProps;
  // Use passed scale if provided, otherwise use config default
  const finalScale = groupScale ?? config.scale;

  // Detect model format
  const modelFormat = getModelFormat(finalModelPath);

  // If useFallback is true, skip loading entirely and show fallback
  if (useFallback) {
    return (
      <FallbackGeometry
        {...restGroupProps}
        type={finalFallbackType}
        color={finalFallbackColor}
        scale={finalScale}
      />
    );
  }

  return (
    <ModelErrorBoundary
      fallbackType={finalFallbackType}
      fallbackColor={finalFallbackColor}
      onError={handleError}
    >
      <Suspense
        fallback={
          <LoadingPlaceholder
            color={loadingColor}
            scale={finalScale}
            {...restGroupProps}
          />
        }
      >
        {modelFormat === "fbx" ? (
          <FBXModel
            modelPath={finalModelPath}
            onLoaded={(group: Group) => {
              if (disposalManager) {
                disposalManager.registerObject3D(group);
              }
              if (onLoaded) {
                onLoaded(group);
              }
            }}
            onError={handleError}
            scale={finalScale}
            {...restGroupProps}
          />
        ) : (
          <GLTFModel
            modelPath={finalModelPath}
            onLoaded={(gltf: GLTF) => {
              if (disposalManager) {
                disposalManager.registerObject3D(gltf.scene);
              }
              if (onLoaded) {
                onLoaded(gltf);
              }
            }}
            onError={handleError}
            scale={finalScale}
            {...restGroupProps}
          />
        )}
      </Suspense>
    </ModelErrorBoundary>
  );
}

/**
 * Preload models for specified agent types
 *
 * Call this in module scope or useEffect to preload models
 * before they're needed. Improves initial render performance.
 *
 * @param agentTypes - Array of agent type names to preload
 *
 * @example
 * // Preload commonly used agent models
 * preloadAgentModels(['frontend-engineer', 'backend-engineer']);
 */
export function preloadAgentModels(agentTypes: string[]): void {
  agentTypes.forEach((type) => {
    const config = getAgentModelConfig(type);
    const format = getModelFormat(config.modelPath);
    if (format === "fbx") {
      FBXModel.preload(config.modelPath);
    } else {
      GLTFModel.preload(config.modelPath);
    }
  });
}

/**
 * Preload all configured agent models
 *
 * This loads all models defined in the agent hex colors config.
 * Use sparingly as it may load many models that aren't needed.
 *
 * @example
 * // In app initialization
 * useEffect(() => {
 *   preloadAllAgentModels();
 * }, []);
 */
export function preloadAllAgentModels(): void {
  // Import AGENT_HEX_COLORS to get all agent types
  // This is a subset - add more as needed
  const commonAgentTypes = [
    "frontend-engineer",
    "backend-engineer",
    "devops-engineer",
    "research",
    "general-purpose",
  ];
  preloadAgentModels(commonAgentTypes);
}
