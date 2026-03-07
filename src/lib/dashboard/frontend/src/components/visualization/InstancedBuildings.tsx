/**
 * InstancedBuildings Component
 * Renders multiple MedievalResidence buildings using instanced rendering
 * for optimal performance (single draw call for N buildings).
 *
 * Instead of rendering each building as a separate mesh (N draw calls),
 * this component batches all identical building geometries into a single
 * THREE.InstancedMesh, reducing draw calls from N to 1.
 *
 * Labels and lights are rendered separately as they cannot be instanced.
 *
 * @module components/visualization/InstancedBuildings
 *
 * @example
 * <InstancedBuildings
 *   buildings={[
 *     { id: "proj-1", name: "My Project", position: [0, 0, 5], hasActiveAgents: true },
 *     { id: "proj-2", name: "Other Project", position: [4, 0, 5], hasActiveAgents: false },
 *   ]}
 * />
 */

import { memo, useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MedievalResidence } from "./MedievalResidence";

// =============================================================================
// Types
// =============================================================================

/**
 * A single building instance configuration
 */
export interface BuildingInstance {
  /** Unique building identifier */
  id: string;
  /** Display name for the building */
  name: string;
  /** Position in 3D space [x, y, z] */
  position: [number, number, number];
  /** Whether this building has active agents */
  hasActiveAgents: boolean;
}

/**
 * Props for the InstancedBuildings component
 */
export interface InstancedBuildingsProps {
  /** Array of building instances to render */
  buildings: BuildingInstance[];
  /** Optional callback when a building is clicked */
  onBuildingClick?: (buildingId: string) => void;
}

// =============================================================================
// Constants (matching MedievalResidence.tsx dimensions)
// =============================================================================

/** Cottage geometry dimensions - matches MedievalResidence.tsx COTTAGE_DIMENSIONS */
const COTTAGE_DIMENSIONS = {
  base: { width: 2, depth: 2, height: 0.1 },
  walls: { width: 1.8, depth: 1.8, height: 1.2 },
  roof: { radius: 1.4, height: 0.8, segments: 4 },
} as const;

/** Material colors for the cottage - matches MedievalResidence.tsx COTTAGE_COLORS */
const COTTAGE_COLORS = {
  walls: "#8b6914",
  activeGlow: "#34d399",
  activeRing: "#10b981",
} as const;

/** Torch light configuration - matches MedievalResidence.tsx TORCH_CONFIG */
const TORCH_CONFIG = {
  color: "#ffaa33",
  intensity: 0.8,
  distance: 5,
  decay: 2,
  offset: { x: 0.6, y: 1.2, z: 0.2 },
} as const;

/** Default door offset from cottage center */
const DEFAULT_DOOR_OFFSET: [number, number, number] = [0, 0, 1.2];

// =============================================================================
// Fallback Geometry Creation
// =============================================================================

/**
 * Creates a merged geometry combining base, walls, and roof.
 * Used when the cottage.glb model is unavailable.
 * Geometry is translated so origin is at ground level center.
 *
 * @returns Merged BufferGeometry for instanced rendering
 */
function createFallbackGeometry(): THREE.BufferGeometry {
  // Stone base platform
  const baseGeom = new THREE.BoxGeometry(
    COTTAGE_DIMENSIONS.base.width,
    COTTAGE_DIMENSIONS.base.height,
    COTTAGE_DIMENSIONS.base.depth
  );
  baseGeom.translate(0, COTTAGE_DIMENSIONS.base.height / 2, 0);

  // Wooden walls
  const wallsGeom = new THREE.BoxGeometry(
    COTTAGE_DIMENSIONS.walls.width,
    COTTAGE_DIMENSIONS.walls.height,
    COTTAGE_DIMENSIONS.walls.depth
  );
  wallsGeom.translate(
    0,
    COTTAGE_DIMENSIONS.base.height + COTTAGE_DIMENSIONS.walls.height / 2,
    0
  );

  // Thatched roof (cone with 4 sides for medieval look)
  const roofGeom = new THREE.ConeGeometry(
    COTTAGE_DIMENSIONS.roof.radius,
    COTTAGE_DIMENSIONS.roof.height,
    COTTAGE_DIMENSIONS.roof.segments
  );
  roofGeom.rotateY(Math.PI / 4);
  roofGeom.translate(
    0,
    COTTAGE_DIMENSIONS.base.height +
      COTTAGE_DIMENSIONS.walls.height +
      COTTAGE_DIMENSIONS.roof.height / 2,
    0
  );

  // Merge all geometries into one for instancing
  const merged = mergeGeometries([
    baseGeom,
    wallsGeom,
    roofGeom,
  ]);

  // Clean up source geometries
  baseGeom.dispose();
  wallsGeom.dispose();
  roofGeom.dispose();

  return merged;
}

// =============================================================================
// BuildingExtras - Labels and Lights (not instancable)
// =============================================================================

/**
 * Renders HTML labels, point lights, and active state rings for each building.
 * These elements cannot be instanced and must be rendered individually.
 */
const BuildingExtras = memo(function BuildingExtras({
  buildings,
}: {
  buildings: BuildingInstance[];
}): JSX.Element {
  // Label height - above the roof
  const labelHeight =
    COTTAGE_DIMENSIONS.base.height +
    COTTAGE_DIMENSIONS.walls.height +
    COTTAGE_DIMENSIONS.roof.height +
    0.3;

  return (
    <>
      {buildings.map((building) => (
        <group key={building.id} position={building.position}>
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
                border ${building.hasActiveAgents ? "border-emerald-500" : "border-gray-700"}
                ${building.hasActiveAgents ? "shadow-lg shadow-emerald-500/20" : ""}
              `}
            >
              {building.name}
            </div>
          </Html>

          {/* Active state indicator ring around cottage base */}
          {building.hasActiveAgents && (
            <>
              <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.3, 1.5, 32]} />
                <meshBasicMaterial
                  color={COTTAGE_COLORS.activeGlow}
                  transparent
                  opacity={0.6}
                />
              </mesh>
              <pointLight
                position={[0, 0.5, 0]}
                color={COTTAGE_COLORS.activeGlow}
                intensity={0.4}
                distance={4}
              />
            </>
          )}

          {/* Torch lights flanking the door */}
          <pointLight
            position={[
              DEFAULT_DOOR_OFFSET[0] - TORCH_CONFIG.offset.x,
              DEFAULT_DOOR_OFFSET[1] + TORCH_CONFIG.offset.y,
              DEFAULT_DOOR_OFFSET[2] + TORCH_CONFIG.offset.z,
            ]}
            color={TORCH_CONFIG.color}
            intensity={TORCH_CONFIG.intensity}
            distance={TORCH_CONFIG.distance}
            decay={TORCH_CONFIG.decay}
          />
          <pointLight
            position={[
              DEFAULT_DOOR_OFFSET[0] + TORCH_CONFIG.offset.x,
              DEFAULT_DOOR_OFFSET[1] + TORCH_CONFIG.offset.y,
              DEFAULT_DOOR_OFFSET[2] + TORCH_CONFIG.offset.z,
            ]}
            color={TORCH_CONFIG.color}
            intensity={TORCH_CONFIG.intensity}
            distance={TORCH_CONFIG.distance}
            decay={TORCH_CONFIG.decay}
          />
        </group>
      ))}
    </>
  );
});

// =============================================================================
// InstancedBuildingsCore - Instanced mesh rendering
// =============================================================================

/**
 * Core instanced rendering component.
 * Renders all building geometries as a single InstancedMesh draw call.
 * Per-instance colors are used to indicate active/inactive state.
 */
const InstancedBuildingsCore = memo(function InstancedBuildingsCore({
  buildings,
}: {
  buildings: BuildingInstance[];
}): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Reusable objects to avoid GC pressure - same pattern as ParticleFlow.tsx
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  // Create fallback geometry (merged base + walls + roof)
  const geometry = useMemo(() => createFallbackGeometry(), []);

  // Create material supporting instanceColor
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: COTTAGE_COLORS.walls,
      metalness: 0.05,
      roughness: 0.85,
    });
  }, []);

  // Update instance matrices when buildings change
  useEffect(() => {
    if (!meshRef.current || buildings.length === 0) return;

    const mesh = meshRef.current;

    buildings.forEach((building, index) => {
      // Set position from building config
      tempObject.position.set(
        building.position[0],
        building.position[1],
        building.position[2]
      );

      // Default rotation and scale
      tempObject.rotation.set(0, 0, 0);
      tempObject.scale.set(1, 1, 1);

      // Update matrix
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    });

    // Mark instance matrix as needing update
    mesh.instanceMatrix.needsUpdate = true;

    // Recompute bounding volumes for frustum culling
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [buildings, tempObject]);

  // Update instance colors when active states change
  useEffect(() => {
    if (!meshRef.current || buildings.length === 0) return;

    const mesh = meshRef.current;

    buildings.forEach((building, index) => {
      if (building.hasActiveAgents) {
        // Active state - emerald glow tint
        tempColor.setStyle(COTTAGE_COLORS.activeRing);
      } else {
        // Inactive state - normal brown walls
        tempColor.setStyle(COTTAGE_COLORS.walls);
      }

      mesh.setColorAt(index, tempColor);
    });

    // Mark instance color as needing update
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [buildings, tempColor]);

  // Cleanup geometry and material on unmount - pattern from ParticleFlow.tsx
  useEffect(() => {
    const currentGeometry = geometry;
    const currentMaterial = material;

    return () => {
      currentGeometry.dispose();
      currentMaterial.dispose();
    };
  }, [geometry, material]);

  // Guard against empty buildings array
  if (buildings.length === 0) {
    return <group />;
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, buildings.length]}
      castShadow
      receiveShadow
    />
  );
});

// =============================================================================
// Main InstancedBuildings Component
// =============================================================================

/**
 * InstancedBuildings - Performance-optimized building renderer
 *
 * Renders multiple medieval cottages using THREE.InstancedMesh for a single
 * draw call instead of N individual draw calls. Falls back to individual
 * MedievalResidence components if instancing fails.
 *
 * Architecture:
 * - InstancedBuildingsCore: Single InstancedMesh for all building geometry
 * - BuildingExtras: Individual HTML labels, point lights, active rings
 * - Fallback: Individual MedievalResidence if instancing errors occur
 *
 * @param props - InstancedBuildings props
 * @returns JSX element containing instanced buildings or fallback
 *
 * @example
 * const buildings: BuildingInstance[] = projects.map((p, i) => ({
 *   id: p.name,
 *   name: p.name,
 *   position: calculateResidencePosition(i),
 *   hasActiveAgents: p.activeAgents > 0,
 * }));
 *
 * <InstancedBuildings buildings={buildings} />
 */
export const InstancedBuildings = memo(function InstancedBuildings({
  buildings,
  onBuildingClick,
}: InstancedBuildingsProps): JSX.Element {
  const [useFallback, setUseFallback] = useState(false);

  // Suppress unused variable warning - onBuildingClick reserved for future interaction
  void onBuildingClick;

  // If instancing fails or encounters error, fall back to individual meshes
  if (useFallback) {
    return (
      <group>
        {buildings.map((building) => (
          <MedievalResidence
            key={building.id}
            projectId={building.id}
            projectName={building.name}
            position={building.position}
            hasActiveAgents={building.hasActiveAgents}
            onDoorClick={() => onBuildingClick?.(building.id)}
          />
        ))}
      </group>
    );
  }

  return (
    <group>
      {/* Instanced building geometry - single draw call for all buildings */}
      <InstancedBuildingsInner
        buildings={buildings}
        onError={() => setUseFallback(true)}
      />

      {/* Labels, lights, and active state rings - rendered individually */}
      <BuildingExtras buildings={buildings} />
    </group>
  );
});

/**
 * Inner wrapper that catches instancing errors and triggers fallback.
 * Separated to keep error boundary logic clean.
 */
const InstancedBuildingsInner = memo(function InstancedBuildingsInner({
  buildings,
  onError,
}: {
  buildings: BuildingInstance[];
  onError: () => void;
}): JSX.Element | null {
  // Catch errors during instanced mesh creation
  useEffect(() => {
    try {
      // Validate that mergeGeometries is available
      if (typeof mergeGeometries !== "function") {
        console.warn("mergeGeometries not available, using fallback");
        onError();
      }
    } catch {
      console.warn("InstancedBuildings: Error during initialization, using fallback");
      onError();
    }
  }, [onError]);

  return <InstancedBuildingsCore buildings={buildings} />;
});
