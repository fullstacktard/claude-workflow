/**
 * CottonField Component
 * Agricultural work area where agents labor picking cotton
 *
 * Renders a procedural cotton field using Three.js geometry.
 * Cotton plants consist of brown stems, green leaves, and white cotton balls.
 * Provides work positions within the field for agent placement.
 *
 * @module components/visualization/CottonField
 */

import { Html } from "@react-three/drei";
import { memo, useMemo } from "react";

// =============================================================================
// EXPORTED CONSTANTS
// =============================================================================

/**
 * Center position of the cotton field
 * Positioned behind MCP buildings (z=-8) with some spacing
 * Exported for agent targeting and camera positioning
 */
export const COTTON_FIELD_POSITION: [number, number, number] = [0, 0, -14];

/**
 * Work positions within the field where agents can be placed
 * Arranged in a grid pattern for even distribution
 */
export const COTTON_FIELD_WORK_POSITIONS: [number, number, number][] = [
  [-3, 0, -16],
  [0, 0, -16],
  [3, 0, -16],
  [-3, 0, -14],
  [0, 0, -14],
  [3, 0, -14],
  [-3, 0, -12],
  [0, 0, -12],
  [3, 0, -12],
];

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Field grid configuration */
const FIELD_CONFIG = {
  rows: 6,
  columns: 8,
  spacing: 1.8,
  /** Slight random offset range for natural look */
  positionJitter: 0.25,
  /** Scale variation range [min, max] - larger plants for visibility */
  scaleRange: [2.5, 3.5] as [number, number],
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Props for individual cotton plant
 */
interface CottonPlantProps {
  position: [number, number, number];
  scale?: number;
  /** Seed for deterministic random variations */
  seed?: number;
}

/**
 * Single cotton plant with stem, leaves, and cotton balls
 * Height approximately 1.5-2.5 units for good visibility
 */
function CottonPlant({
  position,
  scale = 1,
  seed = 0,
}: CottonPlantProps): JSX.Element {
  // Deterministic pseudo-random based on seed for consistent renders
  const random = (offset: number): number => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  // Vary plant height slightly
  const heightVariation = 0.8 + random(0) * 0.4;
  const stemHeight = 0.7 * scale * heightVariation;

  return (
    <group position={position}>
      {/* Brown stem - thin cylinder */}
      <mesh position={[0, stemHeight / 2, 0]}>
        <cylinderGeometry args={[0.015 * scale, 0.02 * scale, stemHeight, 6]} />
        <meshStandardMaterial color="#5D4037" roughness={0.9} />
      </mesh>

      {/* Green leaves - small angled planes at stem base */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rotation, i) => (
        <mesh
          key={`leaf-${i}`}
          position={[
            Math.cos(rotation) * 0.05 * scale,
            stemHeight * 0.3,
            Math.sin(rotation) * 0.05 * scale,
          ]}
          rotation={[Math.PI / 4, rotation, 0]}
        >
          <planeGeometry args={[0.08 * scale, 0.12 * scale]} />
          <meshStandardMaterial
            color="#2E7D32"
            side={2} // DoubleSide
            roughness={0.8}
          />
        </mesh>
      ))}

      {/* White cotton balls - cluster of small spheres at top */}
      {[
        [0, stemHeight + 0.04, 0],
        [0.03, stemHeight + 0.02, 0.02],
        [-0.02, stemHeight + 0.03, -0.03],
        [0.01, stemHeight + 0.05, -0.02],
      ].map((offset, i) => (
        <mesh
          key={`cotton-${i}`}
          position={[
            offset[0] * scale,
            offset[1],
            offset[2] * scale,
          ]}
        >
          <sphereGeometry args={[0.025 * scale * (0.8 + random(i + 10) * 0.4), 6, 6]} />
          <meshStandardMaterial
            color="#FAFAFA"
            roughness={0.95}
            emissive="#FFFFFF"
            emissiveIntensity={0.05}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Ground plane for the cotton field
 * Dark earth/soil color to contrast with green and white plants
 */
function FieldGround({ size }: { size: [number, number] }): JSX.Element {
  return (
    <mesh
      position={[0, -0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={size} />
      <meshStandardMaterial
        color="#3E2723"
        roughness={0.95}
        metalness={0.05}
      />
    </mesh>
  );
}

/**
 * Single fence post with vertical post and horizontal rails
 */
function FencePost({ position }: { position: [number, number, number] }): JSX.Element {
  return (
    <group position={position}>
      {/* Vertical post */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.12, 1.0, 0.12]} />
        <meshStandardMaterial color="#5D4037" roughness={0.9} />
      </mesh>
      {/* Post top cap */}
      <mesh position={[0, 1.05, 0]}>
        <coneGeometry args={[0.1, 0.15, 4]} />
        <meshStandardMaterial color="#4E342E" roughness={0.85} />
      </mesh>
    </group>
  );
}

/**
 * Horizontal fence rail connecting posts
 */
function FenceRail({
  start,
  end,
  height
}: {
  start: [number, number, number];
  end: [number, number, number];
  height: number;
}): JSX.Element {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dx, dz);
  const midX = (start[0] + end[0]) / 2;
  const midZ = (start[2] + end[2]) / 2;

  return (
    <mesh position={[midX, height, midZ]} rotation={[0, angle, 0]}>
      <boxGeometry args={[0.06, 0.08, length]} />
      <meshStandardMaterial color="#6D4C41" roughness={0.9} />
    </mesh>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Props for CottonField component
 */
export interface CottonFieldProps {
  /** Position in 3D space [x, y, z] (default: COTTON_FIELD_POSITION) */
  position?: [number, number, number];
  /** Number of active workers in the field */
  activeWorkerCount?: number;
  /** Whether to show the field label */
  showLabel?: boolean;
}

/**
 * CottonField component
 *
 * Renders a cotton field with procedural plants arranged in a grid.
 * Plants have natural variation in position and scale for visual depth.
 *
 * @param props - CottonField props
 * @returns JSX element containing the 3D cotton field
 *
 * @example
 * <CottonField
 *   position={COTTON_FIELD_POSITION}
 *   activeWorkerCount={3}
 *   showLabel={true}
 * />
 */
export const CottonField = memo(function CottonField({
  position = COTTON_FIELD_POSITION,
  activeWorkerCount = 0,
  showLabel = true,
}: CottonFieldProps): JSX.Element {
  // Generate plant positions with variations
  const plants = useMemo(() => {
    const result: Array<{
      position: [number, number, number];
      scale: number;
      seed: number;
    }> = [];

    const { rows, columns, spacing, positionJitter, scaleRange } = FIELD_CONFIG;
    const startX = -((columns - 1) * spacing) / 2;
    const startZ = -((rows - 1) * spacing) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const seed = row * columns + col;
        const random = (offset: number): number => {
          const x = Math.sin(seed + offset) * 10000;
          return x - Math.floor(x);
        };

        // Base position with jitter
        const x = startX + col * spacing + (random(0) - 0.5) * positionJitter * 2;
        const z = startZ + row * spacing + (random(1) - 0.5) * positionJitter * 2;

        // Scale variation
        const scale = scaleRange[0] + random(2) * (scaleRange[1] - scaleRange[0]);

        result.push({
          position: [x, 0, z],
          scale,
          seed,
        });
      }
    }

    return result;
  }, []);

  // Calculate field bounds for ground plane
  const fieldSize: [number, number] = [
    FIELD_CONFIG.columns * FIELD_CONFIG.spacing + 1,
    FIELD_CONFIG.rows * FIELD_CONFIG.spacing + 1,
  ];

  return (
    <group position={position}>
      {/* Soil ground plane */}
      <FieldGround size={fieldSize} />

      {/* Wooden fence around field - TODO: restore FieldFence component */}

      {/* Cotton plants grid */}
      {plants.map((plant, index) => (
        <CottonPlant
          key={index}
          position={plant.position}
          scale={plant.scale}
          seed={plant.seed}
        />
      ))}

      {/* Field label */}
      {showLabel && (
        <Html position={[0, 1, 0]} center distanceFactor={12}>
          <div className="rounded border border-green-700 bg-green-900/90 px-3 py-1 text-sm font-medium text-green-100">
            Cotton Field
            {activeWorkerCount > 0 && (
              <span className="ml-2 text-green-300">({activeWorkerCount})</span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});
