/**
 * TownSquare Component
 * Central gathering area where agents congregate to work
 *
 * Replaces GymPlatform with a medieval village theme. Features a stone well
 * at the center, wooden benches, decorative barrels/crates, and a bonfire
 * that glows brighter as more agents are active.
 *
 * @module components/visualization/TownSquare
 */

import { Html } from "@react-three/drei";
import { memo } from "react";

/**
 * Position of the well center - used by agents to target town square
 * Other components import this to know where agents should walk to
 */
export const WELL_POSITION: [number, number, number] = [0, 0, 0];

/**
 * Props for TownSquare component
 */
export interface TownSquareProps {
  /** Position in 3D space [x, y, z] (default: [0, 0, 0]) */
  position?: [number, number, number];
  /** Number of agents currently at the town square */
  activeAgentCount?: number;
  /** Whether to show the bonfire (default: true) */
  showBonfire?: boolean;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Fallback geometry for the well when GLTF model is unavailable
 */
function WellFallback(): JSX.Element {
  return (
    <group>
      {/* Cylindrical stone base */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.6, 0.7, 0.6, 12]} />
        <meshStandardMaterial color="#6b7280" roughness={0.9} />
      </mesh>
      {/* Torus rim at top */}
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.08, 8, 16]} />
        <meshStandardMaterial color="#4b5563" roughness={0.85} />
      </mesh>
      {/* Well opening (dark circle) */}
      <mesh position={[0, 0.61, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 16]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      {/* Wooden support posts */}
      <mesh position={[-0.45, 0.9, 0]}>
        <boxGeometry args={[0.08, 0.6, 0.08]} />
        <meshStandardMaterial color="#8B4513" roughness={0.9} />
      </mesh>
      <mesh position={[0.45, 0.9, 0]}>
        <boxGeometry args={[0.08, 0.6, 0.08]} />
        <meshStandardMaterial color="#8B4513" roughness={0.9} />
      </mesh>
      {/* Crossbeam */}
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[1.0, 0.06, 0.06]} />
        <meshStandardMaterial color="#654321" roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Central well - renders custom fallback geometry for the well
 */
function CentralWell(): JSX.Element {
  return <WellFallback />;
}

/**
 * Single bench component - wooden plank seat with two legs
 */
function Bench({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation: number;
}): JSX.Element {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat plank */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[1.2, 0.08, 0.35]} />
        <meshStandardMaterial color="#8B4513" roughness={0.8} />
      </mesh>
      {/* Left leg */}
      <mesh position={[-0.4, 0.12, 0]}>
        <boxGeometry args={[0.08, 0.24, 0.3]} />
        <meshStandardMaterial color="#654321" roughness={0.9} />
      </mesh>
      {/* Right leg */}
      <mesh position={[0.4, 0.12, 0]}>
        <boxGeometry args={[0.08, 0.24, 0.3]} />
        <meshStandardMaterial color="#654321" roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Benches arranged in a circular pattern around the well
 */
function Benches(): JSX.Element {
  const benchPositions: Array<{ pos: [number, number, number]; rot: number }> = [
    { pos: [2, 0, 0], rot: Math.PI / 2 },
    { pos: [-2, 0, 0], rot: -Math.PI / 2 },
    { pos: [0, 0, 2], rot: 0 },
    { pos: [0, 0, -2], rot: Math.PI },
  ];

  return (
    <group>
      {benchPositions.map((bench, i) => (
        <Bench key={i} position={bench.pos} rotation={bench.rot} />
      ))}
    </group>
  );
}

/**
 * Single barrel - cylinder shape
 */
function Barrel({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}): JSX.Element {
  return (
    <mesh position={[position[0], position[1] + 0.25 * scale, position[2]]} scale={scale}>
      <cylinderGeometry args={[0.2, 0.25, 0.5, 12]} />
      <meshStandardMaterial color="#8B4513" roughness={0.85} />
    </mesh>
  );
}

/**
 * Single crate - box shape
 */
function Crate({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}): JSX.Element {
  return (
    <mesh position={[position[0], position[1] + 0.15 * scale, position[2]]} scale={scale}>
      <boxGeometry args={[0.35, 0.3, 0.35]} />
      <meshStandardMaterial color="#A0522D" roughness={0.9} />
    </mesh>
  );
}

/**
 * Decorative props scattered around the town square
 */
function DecorativeProps(): JSX.Element {
  return (
    <group>
      <Barrel position={[1.5, 0, 1.5]} />
      <Barrel position={[1.8, 0, 1.2]} scale={0.8} />
      <Crate position={[-1.6, 0, 1.4]} />
      <Crate position={[-1.4, 0.35, 1.5]} scale={0.7} />
      <Barrel position={[-1.8, 0, -1.3]} />
      <Crate position={[1.7, 0, -1.5]} />
    </group>
  );
}

interface BonfireProps {
  intensity: number;
}

function Bonfire({ intensity }: BonfireProps): JSX.Element {
  return (
    <group position={[0, 0, -2.5]}>
      <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 6]}>
        <cylinderGeometry args={[0.08, 0.1, 0.6, 8]} />
        <meshStandardMaterial color="#3d2914" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[0, Math.PI / 3, Math.PI / 6]}>
        <cylinderGeometry args={[0.08, 0.1, 0.6, 8]} />
        <meshStandardMaterial color="#3d2914" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[0, -Math.PI / 3, Math.PI / 6]}>
        <cylinderGeometry args={[0.08, 0.1, 0.6, 8]} />
        <meshStandardMaterial color="#3d2914" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <coneGeometry args={[0.2, 0.5, 12]} />
        <meshStandardMaterial
          color="#ff4500"
          emissive="#ff6600"
          emissiveIntensity={intensity}
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <coneGeometry args={[0.1, 0.35, 8]} />
        <meshStandardMaterial
          color="#ffcc00"
          emissive="#ff8800"
          emissiveIntensity={intensity * 1.2}
          transparent
          opacity={0.9}
        />
      </mesh>
      <pointLight
        position={[0, 0.5, 0]}
        color="#ff6600"
        intensity={intensity * 2}
        distance={5}
        decay={2}
      />
    </group>
  );
}

function CobblestoneGround(): JSX.Element {
  return (
    <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[4, 32]} />
      <meshStandardMaterial
        color="#4a4a4a"
        roughness={0.95}
        metalness={0.1}
      />
    </mesh>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const TownSquare = memo(function TownSquare({
  position = [0, 0, 0],
  activeAgentCount = 0,
  showBonfire = true,
}: TownSquareProps): JSX.Element {
  const bonfireIntensity = Math.min(0.3 + activeAgentCount * 0.1, 0.8);

  return (
    <group position={position}>
      <CobblestoneGround />
      <CentralWell />
      <Benches />
      <DecorativeProps />
      {showBonfire && <Bonfire intensity={bonfireIntensity} />}
      <Html position={[0, 1.5, 0]} center distanceFactor={12}>
        <div className="rounded border border-amber-700 bg-amber-900/90 px-3 py-1 text-sm font-medium text-amber-100">
          Town Square
          {activeAgentCount > 0 && (
            <span className="ml-2 text-orange-300">({activeAgentCount})</span>
          )}
        </div>
      </Html>
    </group>
  );
});
