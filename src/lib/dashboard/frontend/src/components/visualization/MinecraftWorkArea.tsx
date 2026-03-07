/**
 * MinecraftWorkArea Component
 * Simple fenced farm area where agents work
 *
 * @module components/visualization/MinecraftWorkArea
 */

import { Html } from "@react-three/drei";
import { memo, useMemo } from "react";

// =============================================================================
// EXPORTED CONSTANTS
// =============================================================================

/** Center position of the work area */
export const WORK_AREA_POSITION: [number, number, number] = [0, 0, -14];

/** Work positions within the area where agents can be placed */
export const WORK_AREA_POSITIONS: [number, number, number][] = [
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

const COLORS = {
  grassTop: "#5d8c3e",
  dirt: "#8b6914",
  oakLog: "#6b4423",
  lantern: "#ffcc66",
};

const FARM_SIZE = { width: 10, depth: 8 };

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export interface MinecraftWorkAreaProps {
  position?: [number, number, number];
  activeWorkerCount?: number;
  showLabel?: boolean;
}

/**
 * Simple fenced farm area where agents work.
 * Grass floor with oak fence posts and rails around the perimeter.
 */
export const MinecraftWorkArea = memo(function MinecraftWorkArea({
  activeWorkerCount = 0,
  showLabel = true,
}: MinecraftWorkAreaProps): JSX.Element {
  const halfW = FARM_SIZE.width / 2;
  const halfD = FARM_SIZE.depth / 2;

  // Generate fence posts around perimeter
  const fencePosts = useMemo(() => {
    const posts: [number, number, number][] = [];
    const spacing = 2;

    // Front and back edges
    for (let x = -halfW; x <= halfW; x += spacing) {
      posts.push([x, 0, -halfD]);
      posts.push([x, 0, halfD]);
    }
    // Left and right edges (skip corners already added)
    for (let z = -halfD + spacing; z < halfD; z += spacing) {
      posts.push([-halfW, 0, z]);
      posts.push([halfW, 0, z]);
    }

    return posts;
  }, [halfW, halfD]);

  // Fence rail segments (horizontal rails between posts)
  const fenceRails = useMemo(() => {
    const rails: { pos: [number, number, number]; length: number; rotY: number }[] = [];
    const spacing = 2;

    // Front and back rails
    for (let x = -halfW; x < halfW; x += spacing) {
      // Skip one segment on front for entrance gap
      if (!(x === 0 && true)) {
        rails.push({ pos: [x + spacing / 2, 0, -halfD], length: spacing, rotY: 0 });
      }
      rails.push({ pos: [x + spacing / 2, 0, halfD], length: spacing, rotY: 0 });
    }
    // Left and right rails
    for (let z = -halfD; z < halfD; z += spacing) {
      rails.push({ pos: [-halfW, 0, z + spacing / 2], length: spacing, rotY: Math.PI / 2 });
      rails.push({ pos: [halfW, 0, z + spacing / 2], length: spacing, rotY: Math.PI / 2 });
    }

    return rails;
  }, [halfW, halfD]);

  return (
    <group position={WORK_AREA_POSITION}>
      {/* Grass floor */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FARM_SIZE.width, FARM_SIZE.depth]} />
        <meshBasicMaterial color={COLORS.grassTop} />
      </mesh>

      {/* Dirt border around farm */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FARM_SIZE.width + 1, FARM_SIZE.depth + 1]} />
        <meshBasicMaterial color={COLORS.dirt} />
      </mesh>

      {/* Fence posts */}
      {fencePosts.map((pos, i) => (
        <group key={`post-${i}`} position={pos}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.2, 1, 0.2]} />
            <meshLambertMaterial color={COLORS.oakLog} />
          </mesh>
        </group>
      ))}

      {/* Fence rails */}
      {fenceRails.map((rail, i) => (
        <group key={`rail-${i}`} position={rail.pos} rotation={[0, rail.rotY, 0]}>
          {/* Top rail */}
          <mesh position={[0, 0.7, 0]}>
            <boxGeometry args={[rail.length - 0.2, 0.1, 0.1]} />
            <meshLambertMaterial color={COLORS.oakLog} />
          </mesh>
          {/* Bottom rail */}
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[rail.length - 0.2, 0.1, 0.1]} />
            <meshLambertMaterial color={COLORS.oakLog} />
          </mesh>
        </group>
      ))}

      {/* Corner lanterns */}
      {[[-halfW, halfD], [halfW, halfD], [-halfW, -halfD], [halfW, -halfD]].map(([x, z], i) => (
        <mesh key={`lantern-${i}`} position={[x, 1.1, z]}>
          <boxGeometry args={[0.25, 0.25, 0.25]} />
          <meshBasicMaterial color={COLORS.lantern} />
        </mesh>
      ))}

      {/* Label */}
      {showLabel && (
        <Html position={[0, 1.5, 0]} center distanceFactor={12}>
          <div className="rounded border border-green-700 bg-green-900/90 px-3 py-1 text-sm font-medium text-green-100">
            Farm
            {activeWorkerCount > 0 && (
              <span className="ml-2 text-green-300">({activeWorkerCount})</span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});

export default MinecraftWorkArea;
