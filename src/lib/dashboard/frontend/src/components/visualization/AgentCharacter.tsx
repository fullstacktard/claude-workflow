/**
 * AgentCharacter Component
 * 3D representation of an agent using React Three Fiber
 *
 * Renders agents as 3D characters with:
 * - State-based animation system (idle, working, walking, completed)
 * - Smooth interpolated transitions between states
 * - GLTF model loading with fallback to capsule geometry
 * - Color coding based on agent type
 * - Name/type label on hover or persistent display
 *
 * @module components/visualization/AgentCharacter
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { GLTF } from "three-stdlib";

import {
  getAgentHexColor,
  AGENT_GEOMETRY,
  AGENT_STATUS_EMISSION,
  AGENT_LABEL,
} from "../../config/visualization-config";
import { ModelLoader } from "./ModelLoader";
import {
  useAgentAnimations,
  type AgentAnimationState,
  type WalkTarget,
} from "../../hooks/useAgentAnimations";
import { useMedievalModels } from "../../hooks/useMedievalModels";
import { useCharacterAnimations } from "../../hooks/useCharacterAnimations";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent status types (backward compatible)
 * Maps to AgentAnimationState for the animation system
 */
export type AgentStatus = "idle" | "working" | "walking" | "completed";

/**
 * Props for AgentCharacter component
 */
export interface AgentCharacterProps {
  /** Unique identifier for the agent */
  agentId: string;
  /** Type/name of the agent (e.g., 'frontend-engineer') */
  agentType: string;
  /** Project name for display in label (medieval theme) */
  projectName?: string;
  /** Position in 3D space [x, y, z] */
  position: [number, number, number];
  /** Current status of the agent */
  status: AgentStatus;
  /** Target position for walking animation */
  walkTarget?: WalkTarget | null;
  /** Always show label (default: true for gym workflow visibility) */
  alwaysShowLabel?: boolean;
  /** Optional onClick handler */
  onClick?: () => void;
  /** Use GLTF model instead of default capsule geometry */
  useModel?: boolean;
  /** Custom model path (overrides agentType config from manifest) */
  customModelPath?: string;
  /** Callback when GLTF model loads successfully */
  onModelLoaded?: (gltf: GLTF) => void;
  /** Callback when GLTF model fails to load */
  onModelError?: (error: Error) => void;
  /** Callback when agent completes walking to target */
  onWalkComplete?: () => void;
  /** Callback when completed animation finishes */
  onCompletedAnimationEnd?: () => void;
  /** Optional pre-allocated group from pool (performance optimization) */
  pooledGroup?: THREE.Group;
}

// ============================================================================
// Component
// ============================================================================

/**
 * AgentCharacter component
 *
 * Renders an agent as a 3D character with state-based animations
 * and interactive label display. Supports both:
 * - Default capsule geometry (useModel=false, default)
 * - GLTF model loading (useModel=true)
 *
 * Animation states:
 * - idle: Gentle bobbing + slow rotation
 * - working: Faster pulsing scale + visual indicator
 * - walking: Move + bobbing while translating to target
 * - completed: Celebration animation, auto-returns to idle
 *
 * @param props - AgentCharacter props
 * @returns JSX element containing the 3D mesh and label
 *
 * @example
 * // Default capsule geometry with idle state
 * <AgentCharacter
 *   agentId="agent-123"
 *   agentType="frontend-engineer"
 *   position={[0, 0, 0]}
 *   status="idle"
 * />
 *
 * @example
 * // Working state with pulsing animation
 * <AgentCharacter
 *   agentId="agent-123"
 *   agentType="backend-engineer"
 *   position={[2, 0, 0]}
 *   status="working"
 * />
 *
 * @example
 * // Walking to a target position
 * <AgentCharacter
 *   agentId="agent-123"
 *   agentType="debugger"
 *   position={[0, 0, 0]}
 *   status="walking"
 *   walkTarget={{ x: 5, y: 0, z: 5 }}
 *   onWalkComplete={() => console.log('Arrived!')}
 * />
 *
 * @example
 * // Completed state (celebration animation)
 * <AgentCharacter
 *   agentId="agent-123"
 *   agentType="task-maker"
 *   position={[0, 0, 0]}
 *   status="completed"
 *   onCompletedAnimationEnd={() => console.log('Animation finished')}
 * />
 */
export function AgentCharacter({
  agentId,
  agentType,
  projectName,
  position,
  status,
  walkTarget,
  alwaysShowLabel = true,
  onClick,
  useModel = false,
  customModelPath,
  onModelLoaded,
  onModelError,
  onWalkComplete,
  onCompletedAnimationEnd,
  pooledGroup: _pooledGroup,
}: AgentCharacterProps): JSX.Element {
  const [isHovered, setIsHovered] = useState(false);

  // Get medieval model configuration from manifest
  // Pass agentId for random model assignment (each agent gets a random character)
  const { getModelConfig, isLoading: modelsLoading } = useMedievalModels();
  const modelConfig = getModelConfig(agentType, agentId);

  // Determine final model path - prioritize: customModelPath > manifest > undefined
  const finalModelPath = customModelPath || modelConfig.path || undefined;
  const modelScale = modelConfig.scale;
  const heightOffset = modelConfig.heightOffset;

  // Character animation system for walk/run animations
  const {
    setAnimationState: setCharacterAnimation,
    attachToModel,
    isReady: animationsReady,
  } = useCharacterAnimations({
    walkAnimationPath: modelConfig.walkAnimationPath,
    runAnimationPath: modelConfig.runAnimationPath,
  });

  // Extract position components for dependency tracking
  const [posX, posY, posZ] = position;

  // Memoize base position to avoid creating new Vector3 on every render
  const basePosition = useMemo(
    () => new THREE.Vector3(posX, posY, posZ),
    [posX, posY, posZ]
  );

  // Use the animation state machine hook
  const {
    meshRef,
    setState: setAnimationState,
    setWalkTarget: setAnimationWalkTarget,
    currentState,
    walkTarget: currentWalkTarget,
  } = useAgentAnimations(status as AgentAnimationState, basePosition);

  // Get styling values
  const color = getAgentHexColor(agentType);
  const emissionIntensity = AGENT_STATUS_EMISSION[status] ?? 0;
  const showLabel = alwaysShowLabel || isHovered;

  // -------------------------------------------------------------------------
  // Sync external state prop with animation state
  // -------------------------------------------------------------------------
  useEffect(() => {
    setAnimationState(status as AgentAnimationState);
  }, [status, setAnimationState]);

  // -------------------------------------------------------------------------
  // Handle walk target changes
  // Buffer walk target until animations are ready to prevent invisible walking
  // (model is hidden until animationsReady, so walks would complete unseen)
  // -------------------------------------------------------------------------
  const pendingWalkTargetRef = useRef<WalkTarget | null | undefined>(undefined);

  useEffect(() => {
    if (useModel && !animationsReady) {
      // Buffer the walk target until model animations are ready
      console.log(`[AgentCharacter] Buffering walkTarget for ${agentType} (animations not ready):`, walkTarget);
      pendingWalkTargetRef.current = walkTarget;
      return;
    }
    console.log(`[AgentCharacter] walkTarget changed for ${agentType}:`, walkTarget, "status:", status);
    setAnimationWalkTarget(walkTarget ?? null);
  }, [walkTarget, setAnimationWalkTarget, agentType, status, animationsReady, useModel]);

  // Apply buffered walk target once animations become ready
  useEffect(() => {
    if (animationsReady && pendingWalkTargetRef.current !== undefined) {
      console.log(`[AgentCharacter] Applying buffered walkTarget for ${agentType}:`, pendingWalkTargetRef.current);
      setAnimationWalkTarget(pendingWalkTargetRef.current ?? null);
      pendingWalkTargetRef.current = undefined;
    }
  }, [animationsReady, setAnimationWalkTarget, agentType]);

  // -------------------------------------------------------------------------
  // Notify when walking completes
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Walking just completed (was walking, now idle, and had a target)
    if (
      currentState === "idle" &&
      walkTarget !== undefined &&
      walkTarget !== null &&
      currentWalkTarget === null &&
      onWalkComplete !== undefined
    ) {
      onWalkComplete();
    }
  }, [currentState, walkTarget, currentWalkTarget, onWalkComplete]);

  // -------------------------------------------------------------------------
  // Notify when completed animation ends
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Completed animation just finished (was completed, now idle)
    if (
      status === "completed" &&
      currentState === "idle" &&
      onCompletedAnimationEnd !== undefined
    ) {
      onCompletedAnimationEnd();
    }
  }, [status, currentState, onCompletedAnimationEnd]);

  // -------------------------------------------------------------------------
  // Sync character animation (walk/run) with movement state
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (currentState === "walking") {
      // Play walk animation when moving
      setCharacterAnimation("walk");
    } else {
      // Return to idle when not walking
      setCharacterAnimation("idle");
    }
  }, [currentState, setCharacterAnimation]);

  // -------------------------------------------------------------------------
  // Model loading callbacks
  // -------------------------------------------------------------------------
  const handleModelLoaded = useCallback(
    (model: GLTF | THREE.Group) => {
      console.log(`[AgentCharacter] Model loaded for ${agentType}`);

      // Type guard: GLTF has 'scene' property, Group doesn't
      const isGLTF = (m: GLTF | THREE.Group): m is GLTF =>
        "scene" in m && "animations" in m;

      if (isGLTF(model)) {
        // GLTF model
        if (model.animations.length > 0) {
          console.log(
            `[AgentCharacter] Found ${model.animations.length} animations`
          );
        }
        attachToModel(model.scene);
      } else {
        // FBX model (THREE.Group)
        attachToModel(model);
      }

      if (onModelLoaded !== undefined) {
        onModelLoaded(model as GLTF);
      }
    },
    [agentType, onModelLoaded, attachToModel]
  );

  const handleModelError = useCallback(
    (error: Error) => {
      console.warn(
        `[AgentCharacter] Using fallback geometry for ${agentType}:`,
        error.message
      );
      if (onModelError !== undefined) {
        onModelError(error);
      }
    },
    [agentType, onModelError]
  );

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------
  const handlePointerOver = useCallback(() => setIsHovered(true), []);
  const handlePointerOut = useCallback(() => setIsHovered(false), []);

  // -------------------------------------------------------------------------
  // Geometry configuration
  // -------------------------------------------------------------------------
  const { radius, length, capSegments, radialSegments } = AGENT_GEOMETRY;

  // Adjust label position based on heightOffset from manifest
  // When using models, the heightOffset already positions the model, so add a bit more for label
  const labelYPosition = useModel
    ? heightOffset + length + radius + AGENT_LABEL.offsetY
    : length + radius + AGENT_LABEL.offsetY;

  // Determine if we should use the model (useModel flag + model path exists + not loading)
  const shouldUseModel = useModel && finalModelPath && !modelsLoading;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  // Note: We don't pass position={position} to the group because the
  // useAgentAnimations hook controls position via basePosition ref.
  // Passing both would cause the position to be applied twice or fight.
  return (
    <group
      ref={meshRef}
      name={`agent-${agentId}`}
      onClick={onClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {shouldUseModel ? (
        // GLTF model rendering with medieval manifest config
        // Hidden until animations load to prevent T-pose flash
        <group visible={animationsReady}>
          <ModelLoader
            agentType={agentType}
            modelPath={finalModelPath}
            onLoaded={handleModelLoaded}
            onError={handleModelError}
            scale={modelScale}
            position={[0, heightOffset, 0]}
          />
        </group>
      ) : (
        // Default capsule geometry (fallback when model not available)
        <mesh castShadow receiveShadow>
          <capsuleGeometry
            args={[radius, length, capSegments, radialSegments]}
          />
          <meshStandardMaterial
            color={color}
            roughness={0.6}
            metalness={0.1}
            emissive={color}
            emissiveIntensity={emissionIntensity}
          />
        </mesh>
      )}

      {/* Working indicator - glowing ring (only visible when working) */}
      {status === "working" && (
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius + 0.15, 0.03, 16, 32]} />
          <meshBasicMaterial color="#ffcc00" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Completed indicator - sparkle ring (only visible when completed) */}
      {status === "completed" && (
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius + 0.2, 0.05, 16, 32]} />
          <meshBasicMaterial color="#4ade80" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Medieval-themed agent label - positioned above the character */}
      {showLabel && (
        <Html
          position={[0, labelYPosition, 0]}
          center
          distanceFactor={AGENT_LABEL.distanceFactor}
          style={{
            pointerEvents: "none",
            userSelect: "none",
            transition: "opacity 0.2s ease",
          }}
        >
          <div className="bg-amber-900/90 border border-amber-700 px-2 py-1 rounded text-xs font-mono whitespace-nowrap shadow-lg">
            <div className="text-amber-100 font-medium">{agentType}</div>
            {projectName && (
              <div className="text-amber-300/80 text-[10px] mt-0.5">
                {projectName}
              </div>
            )}
            {isHovered && (
              <div className="text-amber-400/60 text-[10px] mt-0.5">
                {agentId.slice(0, 8)}... | {currentState}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { AgentAnimationState, WalkTarget };
