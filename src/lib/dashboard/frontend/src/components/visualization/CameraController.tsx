/**
 * CameraController Component
 * Wraps @react-three/drei OrbitControls with configured limits for 3D visualization
 *
 * Features:
 * - Orbit (left-drag), pan (right-drag/two-finger), zoom (scroll/pinch) controls
 * - Polar angle limits (prevent going below ground)
 * - Smooth damping for professional feel
 * - Touch support for mobile/tablet
 * - Configurable via visualization-config.ts
 *
 * @module components/visualization/CameraController
 *
 * @example
 * <Canvas>
 *   <CameraController />
 *   {/* other scene content *\/}
 * </Canvas>
 */

import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useRef } from "react";
import { visualizationConfig } from "../../config/visualization-config";

/** Props for CameraController component */
export interface CameraControllerProps {
  /** Override default target position [x, y, z] */
  target?: [number, number, number];
  /** Disable all controls temporarily */
  enabled?: boolean;
  /** Callback when controls change (called on orbit/pan/zoom) */
  onChange?: () => void;
  /** Callback when interaction starts */
  onStart?: () => void;
  /** Callback when interaction ends */
  onEnd?: () => void;
}

/**
 * CameraController - Interactive camera controls for 3D visualization
 *
 * Provides orbit, pan, and zoom functionality with sensible defaults
 * and configurable limits from visualization-config.ts.
 *
 * Controls:
 * - Left mouse drag: Orbit around target
 * - Right mouse drag / Two-finger pan: Pan camera position
 * - Scroll wheel / Pinch: Zoom in/out
 * - Touch: Single finger orbit, two-finger pan, pinch zoom
 *
 * @param props - CameraController props
 * @returns JSX element containing OrbitControls
 */
export function CameraController({
  target,
  enabled = true,
  onChange,
  onStart,
  onEnd,
}: CameraControllerProps): JSX.Element {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = visualizationConfig;

  return (
    <OrbitControls
      ref={controlsRef}
      // Enable all control modes
      enablePan={true}
      enableRotate={true}
      enableZoom={true}
      // Smooth motion with damping
      enableDamping={camera.enableDamping}
      dampingFactor={camera.dampingFactor}
      // Zoom limits
      minDistance={camera.minDistance}
      maxDistance={camera.maxDistance}
      // Polar angle limits (prevent going below ground)
      minPolarAngle={camera.minPolarAngle}
      maxPolarAngle={camera.maxPolarAngle}
      // Target position (scene center by default)
      target={target}
      // Enable/disable all controls
      enabled={enabled}
      // Make this the default controls
      makeDefault
      // Event callbacks
      onChange={onChange}
      onStart={onStart}
      onEnd={onEnd}
      // Touch support is enabled by default in OrbitControls
      // Default touch config: ONE=ROTATE, TWO=DOLLY_PAN
    />
  );
}
