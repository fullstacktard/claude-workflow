/**
 * LoadingPlaceholder Component
 * Animated placeholder shown while GLTF models are loading
 *
 * Used as the Suspense fallback when loading GLTF/GLB models.
 * Shows a pulsing wireframe capsule to indicate loading state.
 *
 * @module components/visualization/LoadingPlaceholder
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import type { ThreeElements } from "@react-three/fiber";
import {
  AGENT_GEOMETRY,
  MODEL_CONFIG,
} from "../../config/visualization-config";

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface LoadingPlaceholderProps extends Omit<GroupProps, "children"> {
  /** Color of the placeholder geometry */
  color?: string;
  /** Size scale of the placeholder */
  scale?: number;
}

/**
 * LoadingPlaceholder renders an animated wireframe shape during model loading.
 *
 * Features:
 * - Pulsing scale animation
 * - Slow rotation
 * - Transparent wireframe material
 * - Configurable color and scale
 *
 * @example
 * // Used as Suspense fallback
 * <Suspense fallback={<LoadingPlaceholder />}>
 *   <GLTFModel modelPath="/models/character.glb" />
 * </Suspense>
 *
 * @example
 * // Custom colored placeholder
 * <LoadingPlaceholder color="#ff6600" scale={1.5} />
 */
export function LoadingPlaceholder({
  color = MODEL_CONFIG.loadingColor,
  scale = 1,
  ...groupProps
}: LoadingPlaceholderProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);

  // Pulsing and rotation animation
  useFrame((state) => {
    if (meshRef.current) {
      // Gentle pulse effect (oscillates between 90% and 110% of base scale)
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.1 + 1;
      meshRef.current.scale.setScalar(scale * pulse);

      // Slow rotation
      meshRef.current.rotation.y += 0.02;
    }
  });

  return (
    <group {...groupProps}>
      <mesh ref={meshRef}>
        <capsuleGeometry
          args={[
            AGENT_GEOMETRY.radius,
            AGENT_GEOMETRY.length,
            AGENT_GEOMETRY.capSegments,
            AGENT_GEOMETRY.radialSegments,
          ]}
        />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.6}
          wireframe
        />
      </mesh>
    </group>
  );
}
