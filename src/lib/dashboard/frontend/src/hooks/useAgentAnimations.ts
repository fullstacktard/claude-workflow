/**
 * useAgentAnimations Hook
 *
 * Animation state machine for 3D agent characters.
 * Uses R3F useFrame for frame-synchronized animation updates with smooth
 * interpolated transitions between states.
 *
 * Performance optimizations:
 * - Visibility API integration to pause when tab is hidden
 * - Delta clamping to prevent animation jumps after tab switch
 *
 * States:
 * - idle: Gentle bobbing + slow rotation (default/resting state)
 * - working: Faster pulsing scale + visual indicator
 * - walking: Move + bobbing while translating to target
 * - completed: Celebration animation, auto-returns to idle
 *
 * @module hooks/useAgentAnimations
 */

import { useFrame } from "@react-three/fiber";
import { useRef, useCallback, useMemo, useEffect } from "react";
import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent animation states
 */
export type AgentAnimationState = "idle" | "working" | "walking" | "completed";

/**
 * Target position for walking animation
 */
export interface WalkTarget {
  x: number;
  y: number;
  z: number;
}

/**
 * Animation configuration for a single state
 */
interface AnimationConfig {
  /** Bobbing amplitude (Y axis oscillation) */
  bobAmplitude: number;
  /** Bobbing speed multiplier */
  bobSpeed: number;
  /** Y-axis rotation speed (radians per second) */
  rotationSpeed: number;
  /** Scale oscillation amplitude */
  scaleAmplitude: number;
  /** Scale oscillation speed */
  scaleSpeed: number;
  /** Base scale value */
  baseScale: number;
}

/**
 * Current animation values applied to mesh
 */
export interface AnimationValues {
  /** Position offset from base position */
  positionOffset: THREE.Vector3;
  /** Rotation in radians */
  rotation: THREE.Euler;
  /** Scale factor */
  scale: THREE.Vector3;
}

/**
 * Return type for useAgentAnimations hook
 */
export interface UseAgentAnimationsResult {
  /** Current animation state */
  currentState: AgentAnimationState;
  /** Set the animation state */
  setState: (state: AgentAnimationState) => void;
  /** Set walk target (triggers walking state) */
  setWalkTarget: (target: WalkTarget | null) => void;
  /** Ref to attach to the mesh/group for animations */
  meshRef: React.RefObject<THREE.Group | null>;
  /** Whether currently transitioning between states */
  isTransitioning: boolean;
  /** Current walk target (if any) */
  walkTarget: WalkTarget | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Animation configurations per state
 *
 * Each state defines unique animation parameters that are smoothly
 * interpolated during transitions.
 */
const ANIMATION_CONFIGS: Record<AgentAnimationState, AnimationConfig> = {
  idle: {
    bobAmplitude: 0.05,
    bobSpeed: 1.5,
    rotationSpeed: 0.3,
    scaleAmplitude: 0,
    scaleSpeed: 0,
    baseScale: 1,
  },
  working: {
    bobAmplitude: 0.02,
    bobSpeed: 3,
    rotationSpeed: 0,
    scaleAmplitude: 0.08,
    scaleSpeed: 4,
    baseScale: 1,
  },
  walking: {
    bobAmplitude: 0.1,
    bobSpeed: 6,
    rotationSpeed: 0,
    scaleAmplitude: 0,
    scaleSpeed: 0,
    baseScale: 1,
  },
  completed: {
    bobAmplitude: 0.15,
    bobSpeed: 8,
    rotationSpeed: 6,
    scaleAmplitude: 0.12,
    scaleSpeed: 6,
    baseScale: 1.1,
  },
};

/** Transition duration in seconds */
const TRANSITION_DURATION = 0.3;

/** Completed state duration before returning to idle (seconds) */
const COMPLETED_DURATION = 1.5;

/** Walking movement speed in units per second */
const WALK_SPEED = 2;

/** Distance threshold for arrival at walk target */
const ARRIVAL_THRESHOLD = 0.1;

/**
 * Maximum allowed delta time (100ms = 10fps minimum)
 * Prevents large jumps when returning from hidden tab
 */
const MAX_DELTA = 0.1;

/**
 * Minimum delta time to prevent divide-by-zero issues
 */
const MIN_DELTA = 0.001;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook for agent character animations with state machine.
 *
 * Uses R3F useFrame for frame-synchronized animation updates. All animation
 * calculations happen in refs to avoid React re-renders on every frame.
 *
 * @param initialState - Initial animation state (default: 'idle')
 * @param basePosition - Base position for the agent
 * @returns Animation controls and mesh ref
 *
 * @example
 * ```tsx
 * function AgentCharacter({ state, position }) {
 *   const basePos = useMemo(() => new THREE.Vector3(...position), [position]);
 *   const { meshRef, setState } = useAgentAnimations('idle', basePos);
 *
 *   useEffect(() => {
 *     setState(state);
 *   }, [state, setState]);
 *
 *   return (
 *     <group ref={meshRef} position={position}>
 *       <mesh>
 *         <sphereGeometry args={[0.5, 32, 32]} />
 *         <meshStandardMaterial color="blue" />
 *       </mesh>
 *     </group>
 *   );
 * }
 * ```
 */
export function useAgentAnimations(
  initialState: AgentAnimationState = "idle",
  basePosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
): UseAgentAnimationsResult {
  const meshRef = useRef<THREE.Group>(null);

  // -------------------------------------------------------------------------
  // Visibility API integration for tab switching
  // -------------------------------------------------------------------------
  const isPausedRef = useRef(false);

  useEffect(() => {
    function handleVisibilityChange(): void {
      isPausedRef.current = document.hidden;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // -------------------------------------------------------------------------
  // State management refs (avoid React state in animation loop)
  // -------------------------------------------------------------------------
  const currentStateRef = useRef<AgentAnimationState>(initialState);
  const targetStateRef = useRef<AgentAnimationState>(initialState);
  const transitionProgressRef = useRef(1); // 1 = fully transitioned
  const walkTargetRef = useRef<WalkTarget | null>(null);
  const completedTimerRef = useRef(0);

  // Interpolated config values for smooth transitions
  const currentConfigRef = useRef<AnimationConfig>({
    ...ANIMATION_CONFIGS[initialState],
  });

  // Accumulated rotation for continuous rotation
  const accumulatedRotationRef = useRef(0);

  // Base position ref (updated when basePosition prop changes)
  const basePositionRef = useRef<THREE.Vector3>(basePosition.clone());

  // Update base position ref when prop changes
  if (!basePositionRef.current.equals(basePosition)) {
    basePositionRef.current.copy(basePosition);
  }

  // -------------------------------------------------------------------------
  // Set initial position when mesh ref first attaches
  // This prevents the character from briefly appearing at origin
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.copy(basePositionRef.current);
    }
  }, []);

  // Update position when basePosition changes (for non-walking states)
  useEffect(() => {
    if (meshRef.current && currentStateRef.current !== "walking") {
      meshRef.current.position.x = basePosition.x;
      meshRef.current.position.z = basePosition.z;
    }
  }, [basePosition.x, basePosition.y, basePosition.z]);

  // -------------------------------------------------------------------------
  // State setters
  // -------------------------------------------------------------------------

  /**
   * Set animation state with transition
   */
  const setState = useCallback((state: AgentAnimationState): void => {
    if (
      state === currentStateRef.current &&
      transitionProgressRef.current >= 1
    ) {
      return; // Already in this state
    }
    targetStateRef.current = state;
    transitionProgressRef.current = 0;

    if (state === "completed") {
      completedTimerRef.current = 0;
    }
  }, []);

  /**
   * Set walk target position
   * Setting a target automatically triggers the walking state
   */
  const setWalkTarget = useCallback(
    (target: WalkTarget | null): void => {
      console.log("[useAgentAnimations] setWalkTarget called:", {
        target,
        currentState: currentStateRef.current,
        hasMesh: !!meshRef.current,
      });
      walkTargetRef.current = target;
      if (target !== null) {
        console.log("[useAgentAnimations] Setting state to walking");
        setState("walking");
      }
    },
    [setState]
  );

  // -------------------------------------------------------------------------
  // Animation frame update
  // -------------------------------------------------------------------------

  useFrame((state, rawDelta) => {
    // Skip updates when tab is hidden
    if (isPausedRef.current) return;
    if (meshRef.current === null) return;

    // Clamp delta to prevent animation jumps after tab switch
    const delta = Math.max(MIN_DELTA, Math.min(rawDelta, MAX_DELTA));

    const mesh = meshRef.current;
    const elapsed = state.clock.elapsedTime;

    // ---------------------------------------------------------------------
    // Handle state transitions (interpolate config values)
    // ---------------------------------------------------------------------
    if (transitionProgressRef.current < 1) {
      transitionProgressRef.current = Math.min(
        transitionProgressRef.current + delta / TRANSITION_DURATION,
        1
      );

      // Interpolate config values using THREE.MathUtils.lerp
      const targetConfig = ANIMATION_CONFIGS[targetStateRef.current];
      const t = transitionProgressRef.current;

      currentConfigRef.current.bobAmplitude = THREE.MathUtils.lerp(
        currentConfigRef.current.bobAmplitude,
        targetConfig.bobAmplitude,
        t
      );
      currentConfigRef.current.bobSpeed = THREE.MathUtils.lerp(
        currentConfigRef.current.bobSpeed,
        targetConfig.bobSpeed,
        t
      );
      currentConfigRef.current.rotationSpeed = THREE.MathUtils.lerp(
        currentConfigRef.current.rotationSpeed,
        targetConfig.rotationSpeed,
        t
      );
      currentConfigRef.current.scaleAmplitude = THREE.MathUtils.lerp(
        currentConfigRef.current.scaleAmplitude,
        targetConfig.scaleAmplitude,
        t
      );
      currentConfigRef.current.scaleSpeed = THREE.MathUtils.lerp(
        currentConfigRef.current.scaleSpeed,
        targetConfig.scaleSpeed,
        t
      );
      currentConfigRef.current.baseScale = THREE.MathUtils.lerp(
        currentConfigRef.current.baseScale,
        targetConfig.baseScale,
        t
      );

      // Mark transition complete
      if (transitionProgressRef.current >= 1) {
        currentStateRef.current = targetStateRef.current;
      }
    }

    const config = currentConfigRef.current;
    const basePos = basePositionRef.current;

    // ---------------------------------------------------------------------
    // Apply bobbing (Y-axis oscillation)
    // ---------------------------------------------------------------------
    const bobOffset = Math.sin(elapsed * config.bobSpeed) * config.bobAmplitude;
    mesh.position.y = basePos.y + bobOffset;

    // ---------------------------------------------------------------------
    // Apply rotation (continuous Y-axis rotation)
    // Only applies when not walking (walking overrides rotation)
    // ---------------------------------------------------------------------
    if (currentStateRef.current !== "walking" && targetStateRef.current !== "walking") {
      accumulatedRotationRef.current += config.rotationSpeed * delta;
      mesh.rotation.y = accumulatedRotationRef.current;
    }

    // ---------------------------------------------------------------------
    // Apply scale pulsing
    // ---------------------------------------------------------------------
    const scalePulse =
      1 + Math.sin(elapsed * config.scaleSpeed) * config.scaleAmplitude;
    const finalScale = config.baseScale * scalePulse;
    mesh.scale.setScalar(finalScale);

    // ---------------------------------------------------------------------
    // Handle walking movement
    // Also move during transition TO walking so movement starts instantly
    // (without this, the agent floats for TRANSITION_DURATION before moving)
    // ---------------------------------------------------------------------
    if (
      (currentStateRef.current === "walking" || targetStateRef.current === "walking") &&
      walkTargetRef.current !== null
    ) {
      const target = walkTargetRef.current;

      const dx = target.x - mesh.position.x;
      const dz = target.z - mesh.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Log walking progress periodically (every ~60 frames)
      if (Math.random() < 0.016) {
        console.log("[useAgentAnimations] Walking:", {
          from: { x: mesh.position.x.toFixed(2), z: mesh.position.z.toFixed(2) },
          to: { x: target.x.toFixed(2), z: target.z.toFixed(2) },
          distance: distance.toFixed(2),
        });
      }

      if (distance > ARRIVAL_THRESHOLD) {
        // Move toward target (frame-rate independent)
        const moveAmount = Math.min(WALK_SPEED * delta, distance);
        mesh.position.x += (dx / distance) * moveAmount;
        mesh.position.z += (dz / distance) * moveAmount;

        // Face movement direction
        mesh.rotation.y = Math.atan2(dx, dz);
        accumulatedRotationRef.current = mesh.rotation.y;
      } else {
        // Arrived at target - update base position so agent stays here
        // Without this, the idle state would snap position back to the original basePos
        console.log("[useAgentAnimations] Arrived at target:", target);
        mesh.position.x = target.x;
        mesh.position.z = target.z;
        basePositionRef.current.x = target.x;
        basePositionRef.current.z = target.z;
        walkTargetRef.current = null;
        setState("idle");
      }
    } else if (currentStateRef.current !== "walking" && targetStateRef.current !== "walking") {
      // Maintain X and Z position when not walking (or transitioning to walking)
      mesh.position.x = basePos.x;
      mesh.position.z = basePos.z;
    }

    // ---------------------------------------------------------------------
    // Handle completed state timer (auto-return to idle)
    // ---------------------------------------------------------------------
    if (currentStateRef.current === "completed") {
      completedTimerRef.current += delta;
      if (completedTimerRef.current >= COMPLETED_DURATION) {
        setState("idle");
      }
    }
  });

  // -------------------------------------------------------------------------
  // Return memoized result
  // -------------------------------------------------------------------------

  const isTransitioning = transitionProgressRef.current < 1;
  const walkTarget = walkTargetRef.current;

  return useMemo(
    () => ({
      currentState: currentStateRef.current,
      setState,
      setWalkTarget,
      meshRef,
      isTransitioning,
      walkTarget,
    }),
    [setState, setWalkTarget, isTransitioning, walkTarget]
  );
}
