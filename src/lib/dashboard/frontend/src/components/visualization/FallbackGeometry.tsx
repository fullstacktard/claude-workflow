/**
 * FallbackGeometry Component
 * Default geometry displayed when GLTF model fails to load
 *
 * Provides a simple, animated 3D shape as a fallback visual
 * when custom models are unavailable or fail to load.
 *
 * @module components/visualization/FallbackGeometry
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import type { ThreeElements } from "@react-three/fiber";
import type { FallbackGeometryType } from "../../config/visualization-config";
import {
  AGENT_GEOMETRY,
  DEFAULT_AGENT_HEX_COLOR,
} from "../../config/visualization-config";

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface FallbackGeometryProps
  extends Omit<GroupProps, "children" | "scale"> {
  /** Type of fallback geometry to render */
  type?: FallbackGeometryType;
  /** Color of the geometry (hex string) */
  color?: string;
  /** Size scale multiplier (number only, not Vector3) */
  scale?: number;
  /** Whether to animate the geometry */
  animated?: boolean;
}

/**
 * FallbackGeometry renders a simple 3D shape when GLTF models fail to load.
 *
 * Features:
 * - Three geometry types: capsule (default), box, sphere
 * - Optional idle animation (rotation and floating)
 * - Configurable color and scale
 *
 * @example
 * // Basic usage with defaults (animated capsule)
 * <FallbackGeometry />
 *
 * @example
 * // Custom box geometry in blue
 * <FallbackGeometry type="box" color="#3b82f6" scale={1.5} />
 *
 * @example
 * // Static sphere without animation
 * <FallbackGeometry type="sphere" animated={false} />
 */
export function FallbackGeometry({
  type = "capsule",
  color = DEFAULT_AGENT_HEX_COLOR,
  scale = 1,
  animated = true,
  ...groupProps
}: FallbackGeometryProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (meshRef.current && animated) {
      // Gentle idle animation: slow rotation and vertical bob
      meshRef.current.rotation.y += 0.005;
      meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.05;
    }
  });

  /**
   * Render the appropriate geometry based on type
   */
  const renderGeometry = (): JSX.Element => {
    switch (type) {
      case "box":
        return <boxGeometry args={[0.6, 1, 0.4]} />;
      case "sphere":
        return <sphereGeometry args={[0.5, 32, 32]} />;
      case "capsule":
      default:
        return (
          <capsuleGeometry
            args={[
              AGENT_GEOMETRY.radius,
              AGENT_GEOMETRY.length,
              AGENT_GEOMETRY.capSegments,
              AGENT_GEOMETRY.radialSegments,
            ]}
          />
        );
    }
  };

  return (
    <group {...groupProps}>
      <mesh ref={meshRef} scale={scale}>
        {renderGeometry()}
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}
