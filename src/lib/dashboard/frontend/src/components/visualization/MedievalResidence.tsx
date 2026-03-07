/**
 * MedievalResidence Component
 * Represents a project's medieval cottage in the village visualization
 *
 * Projects are displayed as medieval cottages where agents spawn from the door
 * and return to after completing work at the town square.
 *
 * Features:
 * - Simple cottage geometry (walls + conical roof) as fallback
 * - Future GLTF model loading when cottage.glb is available
 * - Floating project name label
 * - Active state glow when agents are working
 * - Torch lights near the door for atmosphere
 *
 * @module components/visualization/MedievalResidence
 */

import { Html } from "@react-three/drei";
import { memo, useMemo } from "react";

/**
 * Props for MedievalResidence component
 */
export interface MedievalResidenceProps {
  /** Unique project identifier */
  projectId: string;
  /** Display name for the project */
  projectName: string;
  /** Position in 3D space [x, y, z] */
  position: [number, number, number];
  /** Whether this project has active agents at the town square */
  hasActiveAgents?: boolean;
  /** Door position offset from residence center [x, y, z] - defaults to front of building */
  doorPosition?: [number, number, number];
  /** Callback when door is clicked (for future interaction) */
  onDoorClick?: () => void;
}

/** Default door offset from cottage center (front of building, ground level) */
const DEFAULT_DOOR_OFFSET: [number, number, number] = [0, 0, 1.2];

/** Cottage geometry dimensions */
const COTTAGE_DIMENSIONS = {
  /** Base/floor dimensions */
  base: { width: 2, depth: 2, height: 0.1 },
  /** Walls dimensions */
  walls: { width: 1.8, depth: 1.8, height: 1.2 },
  /** Roof cone dimensions */
  roof: { radius: 1.4, height: 0.8, segments: 4 },
  /** Door dimensions and position */
  door: { width: 0.4, height: 0.7, depth: 0.05 },
} as const;

/** Material colors for the cottage */
const COTTAGE_COLORS = {
  /** Stone base color */
  base: "#3d3d3d",
  /** Wooden walls color - warm brown */
  walls: "#8b6914",
  /** Thatched roof color - straw yellow/brown */
  roof: "#a67c52",
  /** Dark wooden door color */
  door: "#4a3728",
  /** Active state glow color (emerald) */
  activeGlow: "#34d399",
  /** Active state ring color */
  activeRing: "#10b981",
} as const;

/** Torch light configuration */
const TORCH_CONFIG = {
  /** Warm orange flame color */
  color: "#ffaa33",
  /** Light intensity */
  intensity: 0.8,
  /** Light reach distance */
  distance: 5,
  /** Light decay factor */
  decay: 2,
  /** Offset from door position */
  offset: { x: 0.6, y: 1.2, z: 0.2 },
} as const;

/**
 * Calculate the world position of a residence's door
 *
 * Used by agent spawning logic to position agents at the door
 * when they appear or return to their project.
 *
 * @param residencePosition - The residence's position in world space
 * @param doorOffset - Optional door offset (defaults to DEFAULT_DOOR_OFFSET)
 * @returns World position [x, y, z] of the door
 *
 * @example
 * const doorPos = getDoorWorldPosition([5, 0, 10]);
 * // Returns [5, 0, 11.2] (using default door offset)
 *
 * @example
 * const doorPos = getDoorWorldPosition([5, 0, 10], [1, 0, 1.5]);
 * // Returns [6, 0, 11.5] (with custom offset)
 */
export function getDoorWorldPosition(
  residencePosition: [number, number, number],
  doorOffset: [number, number, number] = DEFAULT_DOOR_OFFSET
): [number, number, number] {
  return [
    residencePosition[0] + doorOffset[0],
    residencePosition[1] + doorOffset[1],
    residencePosition[2] + doorOffset[2],
  ];
}

/**
 * FallbackCottage - Simple house geometry when GLTF model is unavailable
 *
 * Renders a basic medieval cottage using primitive geometry:
 * - Stone base platform
 * - Wooden walls (box)
 * - Thatched conical roof (cone with 4 sides for medieval look)
 * - Simple door cutout indication
 */
const FallbackCottage = memo(function FallbackCottage({
  hasActiveAgents,
}: {
  hasActiveAgents: boolean;
}): JSX.Element {
  return (
    <group>
      {/* Stone base platform */}
      <mesh position={[0, COTTAGE_DIMENSIONS.base.height / 2, 0]} receiveShadow>
        <boxGeometry
          args={[
            COTTAGE_DIMENSIONS.base.width,
            COTTAGE_DIMENSIONS.base.height,
            COTTAGE_DIMENSIONS.base.depth,
          ]}
        />
        <meshStandardMaterial
          color={COTTAGE_COLORS.base}
          metalness={0.1}
          roughness={0.9}
        />
      </mesh>

      {/* Wooden walls */}
      <mesh
        position={[
          0,
          COTTAGE_DIMENSIONS.base.height + COTTAGE_DIMENSIONS.walls.height / 2,
          0,
        ]}
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={[
            COTTAGE_DIMENSIONS.walls.width,
            COTTAGE_DIMENSIONS.walls.height,
            COTTAGE_DIMENSIONS.walls.depth,
          ]}
        />
        <meshStandardMaterial
          color={hasActiveAgents ? COTTAGE_COLORS.activeRing : COTTAGE_COLORS.walls}
          metalness={0.05}
          roughness={0.85}
          emissive={hasActiveAgents ? COTTAGE_COLORS.activeGlow : "#000000"}
          emissiveIntensity={hasActiveAgents ? 0.15 : 0}
        />
      </mesh>

      {/* Thatched roof (cone with 4 sides for medieval look) */}
      <mesh
        position={[
          0,
          COTTAGE_DIMENSIONS.base.height +
            COTTAGE_DIMENSIONS.walls.height +
            COTTAGE_DIMENSIONS.roof.height / 2,
          0,
        ]}
        rotation={[0, Math.PI / 4, 0]}
        castShadow
      >
        <coneGeometry
          args={[
            COTTAGE_DIMENSIONS.roof.radius,
            COTTAGE_DIMENSIONS.roof.height,
            COTTAGE_DIMENSIONS.roof.segments,
          ]}
        />
        <meshStandardMaterial
          color={COTTAGE_COLORS.roof}
          metalness={0}
          roughness={0.95}
        />
      </mesh>

      {/* Door indication (dark rectangle on front wall) */}
      <mesh
        position={[
          0,
          COTTAGE_DIMENSIONS.base.height + COTTAGE_DIMENSIONS.door.height / 2,
          COTTAGE_DIMENSIONS.walls.depth / 2 + 0.01,
        ]}
      >
        <boxGeometry
          args={[
            COTTAGE_DIMENSIONS.door.width,
            COTTAGE_DIMENSIONS.door.height,
            COTTAGE_DIMENSIONS.door.depth,
          ]}
        />
        <meshStandardMaterial color={COTTAGE_COLORS.door} roughness={0.9} />
      </mesh>
    </group>
  );
});

/**
 * MedievalResidence component
 *
 * Renders a medieval cottage representing a project. Features:
 * - Simple cottage geometry (fallback until GLTF model available)
 * - Floating project name label
 * - Active state glow when agents are working
 * - Torch lights near the door for atmosphere
 *
 * @param props - MedievalResidence props
 * @returns JSX element containing the 3D residence
 *
 * @example
 * <MedievalResidence
 *   projectId="my-project"
 *   projectName="My Project"
 *   position={[5, 0, 6]}
 *   hasActiveAgents={true}
 * />
 */
export const MedievalResidence = memo(function MedievalResidence({
  projectId,
  projectName,
  position,
  hasActiveAgents = false,
  doorPosition = DEFAULT_DOOR_OFFSET,
  onDoorClick,
}: MedievalResidenceProps): JSX.Element {
  // Suppress unused variable warnings - these are used for data binding/events
  void projectId;
  void onDoorClick;

  // Calculate torch positions relative to door
  const leftTorchPos = useMemo<[number, number, number]>(
    () => [
      doorPosition[0] - TORCH_CONFIG.offset.x,
      doorPosition[1] + TORCH_CONFIG.offset.y,
      doorPosition[2] + TORCH_CONFIG.offset.z,
    ],
    [doorPosition]
  );

  const rightTorchPos = useMemo<[number, number, number]>(
    () => [
      doorPosition[0] + TORCH_CONFIG.offset.x,
      doorPosition[1] + TORCH_CONFIG.offset.y,
      doorPosition[2] + TORCH_CONFIG.offset.z,
    ],
    [doorPosition]
  );

  // Label height - above the roof
  const labelHeight =
    COTTAGE_DIMENSIONS.base.height +
    COTTAGE_DIMENSIONS.walls.height +
    COTTAGE_DIMENSIONS.roof.height +
    0.3;

  return (
    <group position={position}>
      {/* Cottage geometry (fallback - future: use ModelLoader with cottage.glb) */}
      <FallbackCottage hasActiveAgents={hasActiveAgents} />

      {/* Active state indicator ring around cottage base */}
      {hasActiveAgents && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.3, 1.5, 32]} />
          <meshBasicMaterial
            color={COTTAGE_COLORS.activeGlow}
            transparent
            opacity={0.6}
          />
        </mesh>
      )}

      {/* Active state ambient glow from base */}
      {hasActiveAgents && (
        <pointLight
          position={[0, 0.5, 0]}
          color={COTTAGE_COLORS.activeGlow}
          intensity={0.4}
          distance={4}
        />
      )}

      {/* Torch lights flanking the door */}
      <pointLight
        position={leftTorchPos}
        color={TORCH_CONFIG.color}
        intensity={TORCH_CONFIG.intensity}
        distance={TORCH_CONFIG.distance}
        decay={TORCH_CONFIG.decay}
      />
      <pointLight
        position={rightTorchPos}
        color={TORCH_CONFIG.color}
        intensity={TORCH_CONFIG.intensity}
        distance={TORCH_CONFIG.distance}
        decay={TORCH_CONFIG.decay}
      />

      {/* Project name label - floating above residence */}
      <Html
        position={[0, labelHeight, 0]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div
          className={`
            bg-gray-900/90 text-gray-100 px-2 py-1 rounded text-xs whitespace-nowrap
            border ${hasActiveAgents ? "border-emerald-500" : "border-gray-700"}
            ${hasActiveAgents ? "shadow-lg shadow-emerald-500/20" : ""}
          `}
        >
          {projectName}
        </div>
      </Html>
    </group>
  );
});
