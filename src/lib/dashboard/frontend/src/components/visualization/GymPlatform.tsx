/**
 * GymPlatform Component
 * Central gym platform where all agents come to work
 *
 * The gym is the central hub in the base-gym workflow. Agents walk from their
 * project bases to the gym, work there, then walk back.
 *
 * @module components/visualization/GymPlatform
 */

import { Html } from "@react-three/drei";
import { memo } from "react";

/**
 * Props for GymPlatform component
 */
export interface GymPlatformProps {
  /** Position in 3D space [x, y, z] (default: center) */
  position?: [number, number, number];
  /** Number of agents currently working at the gym */
  activeAgentCount?: number;
}

/**
 * GymPlatform component
 *
 * Renders the central gym platform where agents work. The platform glows
 * brighter as more agents are actively working at the gym.
 *
 * @param props - GymPlatform props
 * @returns JSX element containing the 3D mesh and label
 *
 * @example
 * <GymPlatform
 *   position={[0, 0, 0]}
 *   activeAgentCount={3}
 * />
 */
export const GymPlatform = memo(function GymPlatform({
  position = [0, 0, 0],
  activeAgentCount = 0,
}: GymPlatformProps): JSX.Element {
  // Glow intensity increases with active agents
  const glowIntensity = Math.min(0.3 + activeAgentCount * 0.1, 0.8);

  return (
    <group position={position}>
      {/* Main platform - octagonal shape, larger than project bases */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <cylinderGeometry args={[3, 3, 0.3, 8]} />
        <meshStandardMaterial
          color="#1e3a5f"
          metalness={0.4}
          roughness={0.6}
          emissive="#0ea5e9"
          emissiveIntensity={glowIntensity}
        />
      </mesh>

      {/* Inner ring decoration */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2, 2.5, 8]} />
        <meshBasicMaterial
          color="#0ea5e9"
          transparent
          opacity={0.4 + glowIntensity * 0.3}
        />
      </mesh>

      {/* Outer ring decoration */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.8, 3.05, 8]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.3} />
      </mesh>

      {/* GYM label - always visible */}
      <Html position={[0, 0.3, 0]} center distanceFactor={12}>
        <div className="bg-blue-900/90 text-blue-100 px-3 py-1 rounded text-sm font-medium border border-blue-700">
          GYM
          {activeAgentCount > 0 && (
            <span className="ml-2 text-cyan-300">({activeAgentCount})</span>
          )}
        </div>
      </Html>
    </group>
  );
});
