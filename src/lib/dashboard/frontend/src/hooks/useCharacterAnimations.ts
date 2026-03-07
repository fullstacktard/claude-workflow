/**
 * useCharacterAnimations Hook
 *
 * Manages animation playback for rigged 3D characters.
 * Loads walk/run animations from separate GLB files and plays them
 * using Three.js AnimationMixer.
 *
 * Features:
 * - Load animations from external GLB files
 * - Blend between idle/walk/run states
 * - Automatic animation transitions
 * - Support for characters without animations (graceful fallback)
 * - Visibility API integration to pause when tab is hidden
 * - Delta clamping to prevent animation jumps
 *
 * @module hooks/useCharacterAnimations
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

// ============================================================================
// Types
// ============================================================================

/**
 * Animation state for character
 */
export type CharacterAnimationState = "idle" | "walk" | "run" | "sit";

/**
 * Configuration for a character's animations
 */
export interface CharacterAnimationConfig {
  /** Path to walk animation GLB (optional) */
  walkAnimationPath?: string;
  /** Path to run animation GLB (optional) */
  runAnimationPath?: string;
}

/**
 * Hook result interface
 */
export interface UseCharacterAnimationsResult {
  /** Set the current animation state */
  setAnimationState: (state: CharacterAnimationState) => void;
  /** Current animation state */
  currentState: CharacterAnimationState;
  /** Whether animations are loaded and ready */
  isReady: boolean;
  /** Attach the mixer to a model (call after model loads) */
  attachToModel: (model: THREE.Object3D) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Crossfade duration between animations (seconds) */
const CROSSFADE_DURATION = 0.3;

/**
 * Maximum allowed delta time (100ms = 10fps minimum)
 * Prevents large jumps when returning from hidden tab
 */
const MAX_DELTA = 0.1;

/**
 * Minimum delta time to prevent divide-by-zero issues
 */
const MIN_DELTA = 0.001;

/** Animation cache to avoid reloading (stores clip or null for failed loads) */
const animationCache = new Map<string, THREE.AnimationClip | null>();

/**
 * Map of paths currently being loaded to their loading promises.
 * This allows multiple concurrent callers to await the same load operation,
 * fixing the race condition where the 100ms wait was insufficient.
 */
const loadingPromises = new Map<string, Promise<THREE.AnimationClip | null>>();

// ============================================================================
// Loader
// ============================================================================

const gltfLoader = new GLTFLoader();

/**
 * Load an animation clip from a GLB file
 * Caches both successful loads and failures to prevent spam.
 * Uses promise-based deduplication so concurrent callers await the same load.
 */
async function loadAnimationClip(
  path: string
): Promise<THREE.AnimationClip | null> {
  // Check cache first (includes failed loads as null)
  if (animationCache.has(path)) {
    return animationCache.get(path) ?? null;
  }

  // If already loading this path, await the existing promise
  // This fixes the race condition where multiple agents loading simultaneously
  // would cause the second caller to get null before the first load completed
  const existingPromise = loadingPromises.get(path);
  if (existingPromise) {
    return existingPromise;
  }

  // Create the loading promise
  const loadPromise = new Promise<THREE.AnimationClip | null>((resolve) => {
    gltfLoader.load(
      path,
      (gltf) => {
        loadingPromises.delete(path);
        if (gltf.animations.length > 0) {
          const clip = gltf.animations[0];
          animationCache.set(path, clip);
          resolve(clip);
        } else {
          animationCache.set(path, null); // Cache the failure
          resolve(null);
        }
      },
      undefined,
      () => {
        loadingPromises.delete(path);
        animationCache.set(path, null); // Cache the failure to prevent retry
        resolve(null);
      }
    );
  });

  // Store the promise so concurrent callers can await it
  loadingPromises.set(path, loadPromise);

  return loadPromise;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing character animations
 *
 * Loads walk/run animations from separate GLB files and plays them
 * using Three.js AnimationMixer with smooth crossfade transitions.
 *
 * @param config - Animation configuration with paths to animation GLBs
 * @returns {UseCharacterAnimationsResult} Hook result
 *
 * @example
 * ```tsx
 * function AnimatedCharacter({ modelPath, walkPath, runPath }) {
 *   const { setAnimationState, attachToModel } = useCharacterAnimations({
 *     walkAnimationPath: walkPath,
 *     runAnimationPath: runPath,
 *   });
 *
 *   const handleModelLoaded = (gltf) => {
 *     attachToModel(gltf.scene);
 *   };
 *
 *   // When character starts walking
 *   setAnimationState("walk");
 *
 *   // When character stops
 *   setAnimationState("idle");
 * }
 * ```
 */
export function useCharacterAnimations(
  config: CharacterAnimationConfig
): UseCharacterAnimationsResult {
  // Refs for animation system
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const currentStateRef = useRef<CharacterAnimationState>("idle");
  // Use state instead of ref so consumers re-render when animations become ready
  const [isReady, setIsReady] = useState(false);

  // Visibility API integration for tab switching
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

  // State to trigger animation loading after model attachment
  // This is needed because the loadAnimations effect needs to re-run when attachToModel is called
  const [modelAttached, setModelAttached] = useState(false);

  // Animation actions
  const actionsRef = useRef<{
    walk: THREE.AnimationAction | null;
    run: THREE.AnimationAction | null;
    idle: THREE.AnimationAction | null;
  }>({
    walk: null,
    run: null,
    idle: null,
  });

  // Current playing action
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  /**
   * Load animations when model is attached or config changes
   *
   * IMPORTANT: The modelAttached state is needed to trigger this effect
   * after attachToModel is called, since refs don't trigger re-renders.
   */
  useEffect(() => {
    const loadAnimations = async () => {
      if (!modelRef.current || !mixerRef.current) {
        console.log("[useCharacterAnimations] Model or mixer not ready, skipping animation load");
        return;
      }

      const mixer = mixerRef.current;
      console.log("[useCharacterAnimations] Loading animations...", {
        walkPath: config.walkAnimationPath,
        runPath: config.runAnimationPath
      });

      // Load walk animation
      if (config.walkAnimationPath) {
        const walkClip = await loadAnimationClip(config.walkAnimationPath);
        console.log("[useCharacterAnimations] Walk clip loaded:", walkClip ? `${walkClip.name} (${walkClip.duration}s)` : "null");
        if (walkClip) {
          actionsRef.current.walk = mixer.clipAction(walkClip);
          actionsRef.current.walk.setLoop(THREE.LoopRepeat, Infinity);
        }
      } else {
        console.log("[useCharacterAnimations] No walk animation path configured");
      }

      // Load run animation
      if (config.runAnimationPath) {
        const runClip = await loadAnimationClip(config.runAnimationPath);
        console.log("[useCharacterAnimations] Run clip loaded:", runClip ? `${runClip.name} (${runClip.duration}s)` : "null");
        if (runClip) {
          actionsRef.current.run = mixer.clipAction(runClip);
          actionsRef.current.run.setLoop(THREE.LoopRepeat, Infinity);
        }
      }

      console.log("[useCharacterAnimations] Animations loaded. Actions:", {
        walk: !!actionsRef.current.walk,
        run: !!actionsRef.current.run,
        idle: !!actionsRef.current.idle
      });

      // CRITICAL: After animations load, immediately play the current state's animation
      // This fixes the race condition where setAnimationState("idle") was called before
      // animations loaded, causing the character to stay in T-pose
      const currentState = currentStateRef.current;
      console.log("[useCharacterAnimations] Post-load: Playing animation for state:", currentState);

      let animationApplied = false;

      if (currentState === "idle" || currentState === "sit") {
        // For idle state, try to play walk animation paused at first frame as fallback
        const idleAction = actionsRef.current.idle || actionsRef.current.walk;
        console.log("[useCharacterAnimations] Idle action:", idleAction ? "found" : "NOT FOUND - T-POSE WILL OCCUR");
        if (idleAction) {
          idleAction.reset();
          idleAction.play();
          if (!actionsRef.current.idle) {
            // Using walk as idle - pause at ~20% for natural pose with arms down
            // Frame 0 is T-pose, 50% still has arms spread during swing
            // ~20% is typically when one foot is planted and arms are more neutral
            const idleTime = (idleAction.getClip().duration * 0.2);
            idleAction.paused = true;
            idleAction.time = idleTime;
            console.log("[useCharacterAnimations] Using walk animation as idle (paused at 20%:", idleTime.toFixed(2) + "s)");
          }
          currentActionRef.current = idleAction;
          animationApplied = true;
        } else {
          console.error("[useCharacterAnimations] NO ANIMATION AVAILABLE - character will T-pose!");
        }
      } else if (currentState === "walk" && actionsRef.current.walk) {
        actionsRef.current.walk.reset();
        actionsRef.current.walk.play();
        currentActionRef.current = actionsRef.current.walk;
        console.log("[useCharacterAnimations] Playing walk animation");
        animationApplied = true;
      } else if (currentState === "run" && actionsRef.current.run) {
        actionsRef.current.run.reset();
        actionsRef.current.run.play();
        currentActionRef.current = actionsRef.current.run;
        console.log("[useCharacterAnimations] Playing run animation");
        animationApplied = true;
      } else {
        console.error("[useCharacterAnimations] Could not play animation for state:", currentState);
      }

      // IMPORTANT: Only set ready AFTER animation is applied to the model
      // This prevents T-pose flash by ensuring model stays hidden until animation is playing
      if (animationApplied) {
        // Force a mixer update to apply the first frame of the animation
        // This ensures the pose is set BEFORE we make the model visible
        mixerRef.current?.update(0);
        setIsReady(true);
        console.log("[useCharacterAnimations] Animation applied, model now visible");
      } else {
        // No animation available - don't show model (keeps T-pose hidden)
        console.warn("[useCharacterAnimations] No animation applied, keeping model hidden");
      }
    };

    void loadAnimations();
  }, [config.walkAnimationPath, config.runAnimationPath, modelAttached]);

  /**
   * Attach animation mixer to a model
   * This triggers the animation loading effect via setModelAttached
   */
  const attachToModel = useCallback((model: THREE.Object3D) => {
    modelRef.current = model;
    mixerRef.current = new THREE.AnimationMixer(model);

    // Check if model has embedded animations (for idle)
    // Note: model.animations is not standard - it's only on GLTF results
    // Check for animations on the GLTF userData or scene
    const modelAnimations = (model as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
    if (modelAnimations && modelAnimations.length > 0) {
      // Find an idle animation if it exists
      const idleClip = modelAnimations.find(
        (clip) =>
          clip.name.toLowerCase().includes("idle") ||
          clip.name.toLowerCase().includes("stand")
      );
      if (idleClip) {
        actionsRef.current.idle = mixerRef.current.clipAction(idleClip);
        actionsRef.current.idle.setLoop(THREE.LoopRepeat, Infinity);
      }
    }

    // Trigger the animation loading effect
    setModelAttached(true);
  }, []);

  /**
   * Set the current animation state
   */
  const setAnimationState = useCallback(
    (state: CharacterAnimationState): void => {
      if (!mixerRef.current) return;
      if (state === currentStateRef.current) return;

      currentStateRef.current = state;

      // Get the action for the new state
      let newAction: THREE.AnimationAction | null = null;
      // Track if we're using walk animation as idle fallback
      let usingWalkAsIdle = false;

      switch (state) {
        case "walk":
          newAction = actionsRef.current.walk;
          break;
        case "run":
          newAction = actionsRef.current.run;
          break;
        case "idle":
        case "sit":
          // Prefer idle animation, but fall back to walk animation paused at first frame
          // This prevents T-pose when no idle animation exists
          if (actionsRef.current.idle) {
            newAction = actionsRef.current.idle;
          } else {
            newAction = actionsRef.current.walk;
            usingWalkAsIdle = true;
          }
          break;
      }

      // Crossfade to new action
      if (newAction) {
        if (currentActionRef.current && currentActionRef.current !== newAction) {
          // Crossfade from current to new
          currentActionRef.current.fadeOut(CROSSFADE_DURATION);
          newAction.reset();
          newAction.fadeIn(CROSSFADE_DURATION);
          newAction.play();
        } else if (!currentActionRef.current) {
          // No current action, just play
          newAction.reset();
          newAction.play();
        }
        // Same action but state changed (e.g., walk animation used for both walk and idle)
        // Just update pause state, don't reset
        currentActionRef.current = newAction;

        // Handle pause/unpause based on state
        if (usingWalkAsIdle) {
          // Using walk animation for idle - pause at ~20% for natural pose with arms down
          const idleTime = (newAction.getClip().duration * 0.2);
          newAction.paused = true;
          newAction.time = idleTime;
        } else if (state === "walk" || state === "run") {
          // Active movement state - ensure animation is playing
          newAction.paused = false;
        }
      } else if (currentActionRef.current) {
        // No animation available at all - pause current animation at mid-cycle
        // This is a last resort to avoid T-pose (frame 0 is often T-pose)
        const midCycleTime = (currentActionRef.current.getClip().duration * 0.5);
        currentActionRef.current.paused = true;
        currentActionRef.current.time = midCycleTime;
      }
    },
    []
  );

  /**
   * Update animation mixer every frame
   * Includes visibility check and delta clamping for performance
   */
  useFrame((_, rawDelta) => {
    // Skip updates when tab is hidden
    if (isPausedRef.current) return;
    if (!mixerRef.current) return;

    // Clamp delta to prevent animation jumps after tab switch
    const delta = Math.max(MIN_DELTA, Math.min(rawDelta, MAX_DELTA));
    mixerRef.current.update(delta);
  });

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }
    };
  }, []);

  return {
    setAnimationState,
    currentState: currentStateRef.current,
    isReady,
    attachToModel,
  };
}

export default useCharacterAnimations;
