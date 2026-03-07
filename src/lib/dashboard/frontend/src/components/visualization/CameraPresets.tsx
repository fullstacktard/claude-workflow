/**
 * CameraPresets Component
 *
 * Cinematic camera control system for the visualization:
 * - Pre-defined camera positions/angles
 * - Smooth interpolation between presets
 * - Auto-orbit mode for idle display
 * - Follow agent mode
 * - Keyboard shortcuts for quick switching
 *
 * @module components/visualization/CameraPresets
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

export const CAMERA_PRESETS = {
  /** Overview - high angle looking at entire village */
  overview: {
    position: new THREE.Vector3(0, 35, 35),
    target: new THREE.Vector3(0, 0, 5),
    fov: 50,
  },
  /** Village center - ground level at town square */
  villageCenter: {
    position: new THREE.Vector3(0, 3, 15),
    target: new THREE.Vector3(0, 0, 0),
    fov: 60,
  },
  /** Cotton field - view of work area */
  cottonField: {
    position: new THREE.Vector3(10, 5, 5),
    target: new THREE.Vector3(0, 0, 0),
    fov: 55,
  },
  /** Residences - view of cottage area */
  residences: {
    position: new THREE.Vector3(-5, 8, 25),
    target: new THREE.Vector3(0, 0, 15),
    fov: 50,
  },
  /** MCP Buildings - dramatic angle on special buildings */
  mcpBuildings: {
    position: new THREE.Vector3(-15, 6, -5),
    target: new THREE.Vector3(-8, 0, -8),
    fov: 55,
  },
  /** Cinematic - sweeping low angle */
  cinematic: {
    position: new THREE.Vector3(20, 2, 20),
    target: new THREE.Vector3(0, 2, 0),
    fov: 45,
  },
  /** Birds eye - directly above */
  birdsEye: {
    position: new THREE.Vector3(0, 50, 0),
    target: new THREE.Vector3(0, 0, 0),
    fov: 40,
  },
  /** Windmill - view of the windmill */
  windmill: {
    position: new THREE.Vector3(-15, 8, -10),
    target: new THREE.Vector3(-20, 3, -15),
    fov: 50,
  },
} as const;

export type CameraPresetName = keyof typeof CAMERA_PRESETS;

// =============================================================================
// Camera Controller Hook
// =============================================================================

interface UseCameraControllerOptions {
  /** Initial preset */
  initialPreset?: CameraPresetName;
  /** Transition duration in seconds */
  transitionDuration?: number;
  /** Enable auto-orbit when idle */
  autoOrbit?: boolean;
  /** Auto-orbit speed (radians per second) */
  orbitSpeed?: number;
  /** Idle timeout before auto-orbit (seconds) */
  idleTimeout?: number;
}

interface CameraControllerState {
  currentPreset: CameraPresetName | null;
  isTransitioning: boolean;
  isAutoOrbiting: boolean;
  followTarget: THREE.Vector3 | null;
}

/**
 * useCameraController - Hook for managing camera presets and transitions
 */
export function useCameraController({
  initialPreset = "overview",
  transitionDuration = 2,
  autoOrbit = false,
  orbitSpeed = 0.1,
  idleTimeout = 10,
}: UseCameraControllerOptions = {}) {
  const { camera } = useThree();

  // State
  const [state, setState] = useState<CameraControllerState>({
    currentPreset: initialPreset,
    isTransitioning: false,
    isAutoOrbiting: false,
    followTarget: null,
  });

  // Refs for animation
  const startPositionRef = useRef(new THREE.Vector3());
  const startTargetRef = useRef(new THREE.Vector3());
  const endPositionRef = useRef(new THREE.Vector3());
  const endTargetRef = useRef(new THREE.Vector3());
  const transitionProgressRef = useRef(0);
  const currentTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  const lastActivityRef = useRef(Date.now());
  const orbitAngleRef = useRef(0);

  // Initialize camera position
  useEffect(() => {
    if (initialPreset && CAMERA_PRESETS[initialPreset]) {
      const preset = CAMERA_PRESETS[initialPreset];
      camera.position.copy(preset.position);
      currentTargetRef.current.copy(preset.target);
      camera.lookAt(preset.target);
    }
  }, []);

  // Smooth easing function
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // Transition to a preset
  const goToPreset = useCallback(
    (presetName: CameraPresetName) => {
      const preset = CAMERA_PRESETS[presetName];
      if (!preset) return;

      // Record start state
      startPositionRef.current.copy(camera.position);
      startTargetRef.current.copy(currentTargetRef.current);

      // Set end state
      endPositionRef.current.copy(preset.position);
      endTargetRef.current.copy(preset.target);

      // Start transition
      transitionProgressRef.current = 0;
      setState((s) => ({
        ...s,
        currentPreset: presetName,
        isTransitioning: true,
        isAutoOrbiting: false,
        followTarget: null,
      }));

      lastActivityRef.current = Date.now();
    },
    [camera]
  );

  // Follow a target (agent)
  const followAgent = useCallback(
    (targetPosition: THREE.Vector3) => {
      setState((s) => ({
        ...s,
        currentPreset: null,
        isAutoOrbiting: false,
        followTarget: targetPosition.clone(),
      }));
      lastActivityRef.current = Date.now();
    },
    []
  );

  // Stop following
  const stopFollowing = useCallback(() => {
    setState((s) => ({
      ...s,
      followTarget: null,
    }));
  }, []);

  // Start auto-orbit
  const startAutoOrbit = useCallback(() => {
    orbitAngleRef.current = Math.atan2(
      camera.position.x - currentTargetRef.current.x,
      camera.position.z - currentTargetRef.current.z
    );
    setState((s) => ({
      ...s,
      isAutoOrbiting: true,
      followTarget: null,
    }));
  }, [camera]);

  // Stop auto-orbit
  const stopAutoOrbit = useCallback(() => {
    setState((s) => ({
      ...s,
      isAutoOrbiting: false,
    }));
    lastActivityRef.current = Date.now();
  }, []);

  // Animation frame update
  useFrame((_, delta) => {
    // Handle transition
    if (state.isTransitioning) {
      transitionProgressRef.current += delta / transitionDuration;

      if (transitionProgressRef.current >= 1) {
        transitionProgressRef.current = 1;
        setState((s) => ({ ...s, isTransitioning: false }));
      }

      const t = easeInOutCubic(transitionProgressRef.current);

      // Interpolate position
      camera.position.lerpVectors(
        startPositionRef.current,
        endPositionRef.current,
        t
      );

      // Interpolate target
      currentTargetRef.current.lerpVectors(
        startTargetRef.current,
        endTargetRef.current,
        t
      );

      camera.lookAt(currentTargetRef.current);
      return;
    }

    // Handle follow target
    if (state.followTarget) {
      const idealOffset = new THREE.Vector3(5, 4, 5);
      const idealPosition = state.followTarget.clone().add(idealOffset);

      // Smooth follow
      camera.position.lerp(idealPosition, delta * 2);
      currentTargetRef.current.lerp(state.followTarget, delta * 3);
      camera.lookAt(currentTargetRef.current);
      return;
    }

    // Handle auto-orbit
    if (state.isAutoOrbiting && autoOrbit) {
      orbitAngleRef.current += orbitSpeed * delta;

      const distance = camera.position.distanceTo(currentTargetRef.current);
      const height = camera.position.y;

      camera.position.x =
        currentTargetRef.current.x + Math.sin(orbitAngleRef.current) * distance;
      camera.position.z =
        currentTargetRef.current.z + Math.cos(orbitAngleRef.current) * distance;
      camera.position.y = height;

      camera.lookAt(currentTargetRef.current);
      return;
    }

    // Check for idle timeout
    if (autoOrbit && !state.isAutoOrbiting) {
      const idleTime = (Date.now() - lastActivityRef.current) / 1000;
      if (idleTime > idleTimeout) {
        startAutoOrbit();
      }
    }
  });

  // Record activity on user input
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (state.isAutoOrbiting) {
      stopAutoOrbit();
    }
  }, [state.isAutoOrbiting, stopAutoOrbit]);

  return {
    state,
    goToPreset,
    followAgent,
    stopFollowing,
    startAutoOrbit,
    stopAutoOrbit,
    recordActivity,
    presets: Object.keys(CAMERA_PRESETS) as CameraPresetName[],
  };
}

// =============================================================================
// Camera Preset UI Component
// =============================================================================

export interface CameraPresetUIProps {
  /** Camera controller from useCameraController */
  controller: ReturnType<typeof useCameraController>;
  /** Position of the UI */
  position?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
  /** Show labels */
  showLabels?: boolean;
}

/**
 * CameraPresetUI - On-screen buttons for camera presets
 */
export function CameraPresetUI({
  controller,
  position = "bottom-right",
  showLabels = true,
}: CameraPresetUIProps): JSX.Element {
  const { state, goToPreset, presets, startAutoOrbit, stopAutoOrbit } =
    controller;

  const positionClasses = {
    "top-right": "top-4 right-4",
    "bottom-right": "bottom-4 right-4",
    "top-left": "top-4 left-4",
    "bottom-left": "bottom-4 left-4",
  };

  return (
    <div
      className={`absolute ${positionClasses[position]} flex flex-col gap-1 bg-gray-900/80 rounded-lg p-2 backdrop-blur-sm`}
    >
      <div className="text-xs text-gray-400 mb-1 font-medium">Camera</div>

      {presets.map((preset) => (
        <button
          key={preset}
          onClick={() => goToPreset(preset)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            state.currentPreset === preset
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {showLabels
            ? preset.replace(/([A-Z])/g, " $1").trim()
            : preset.slice(0, 3).toUpperCase()}
        </button>
      ))}

      <div className="border-t border-gray-700 my-1" />

      <button
        onClick={() =>
          state.isAutoOrbiting ? stopAutoOrbit() : startAutoOrbit()
        }
        className={`px-2 py-1 text-xs rounded transition-colors ${
          state.isAutoOrbiting
            ? "bg-green-600 text-white"
            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
        }`}
      >
        {state.isAutoOrbiting ? "Stop Orbit" : "Auto Orbit"}
      </button>

      {state.isTransitioning && (
        <div className="text-xs text-blue-400 animate-pulse">Moving...</div>
      )}
    </div>
  );
}

// =============================================================================
// Keyboard Shortcuts Component
// =============================================================================

export interface CameraKeyboardShortcutsProps {
  /** Camera controller */
  controller: ReturnType<typeof useCameraController>;
  /** Enable shortcuts */
  enabled?: boolean;
}

/**
 * CameraKeyboardShortcuts - Handles keyboard input for camera control
 */
export function CameraKeyboardShortcuts({
  controller,
  enabled = true,
}: CameraKeyboardShortcutsProps): null {
  const { goToPreset, startAutoOrbit, stopAutoOrbit, recordActivity, state } =
    controller;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      recordActivity();

      switch (e.key) {
        case "1":
          goToPreset("overview");
          break;
        case "2":
          goToPreset("villageCenter");
          break;
        case "3":
          goToPreset("cottonField");
          break;
        case "4":
          goToPreset("residences");
          break;
        case "5":
          goToPreset("mcpBuildings");
          break;
        case "6":
          goToPreset("cinematic");
          break;
        case "7":
          goToPreset("birdsEye");
          break;
        case "8":
          goToPreset("windmill");
          break;
        case "o":
        case "O":
          if (state.isAutoOrbiting) {
            stopAutoOrbit();
          } else {
            startAutoOrbit();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    goToPreset,
    startAutoOrbit,
    stopAutoOrbit,
    recordActivity,
    state.isAutoOrbiting,
  ]);

  return null;
}

// =============================================================================
// Cinematic Camera Path Component
// =============================================================================

export interface CinematicPathPoint {
  position: THREE.Vector3;
  target: THREE.Vector3;
  duration: number; // seconds to reach this point from previous
}

export interface CinematicCameraPathProps {
  /** Path points */
  path: CinematicPathPoint[];
  /** Play on mount */
  autoPlay?: boolean;
  /** Loop the path */
  loop?: boolean;
  /** Callback when path completes */
  onComplete?: () => void;
}

/**
 * CinematicCameraPath - Plays a scripted camera path
 */
export function CinematicCameraPath({
  path,
  autoPlay = true,
  loop = false,
  onComplete,
}: CinematicCameraPathProps): null {
  const { camera } = useThree();

  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentSegment, setCurrentSegment] = useState(0);
  const progressRef = useRef(0);
  const currentTargetRef = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!isPlaying || path.length < 2) return;

    const segment = path[currentSegment];
    const nextSegment = path[(currentSegment + 1) % path.length];

    progressRef.current += delta / segment.duration;

    if (progressRef.current >= 1) {
      progressRef.current = 0;

      if (currentSegment >= path.length - 2) {
        if (loop) {
          setCurrentSegment(0);
        } else {
          setIsPlaying(false);
          onComplete?.();
        }
      } else {
        setCurrentSegment(currentSegment + 1);
      }
    }

    // Smooth interpolation
    const t = progressRef.current;
    const smoothT = t * t * (3 - 2 * t); // Smoothstep

    camera.position.lerpVectors(segment.position, nextSegment.position, smoothT);
    currentTargetRef.current.lerpVectors(
      segment.target,
      nextSegment.target,
      smoothT
    );
    camera.lookAt(currentTargetRef.current);
  });

  return null;
}

export default useCameraController;
