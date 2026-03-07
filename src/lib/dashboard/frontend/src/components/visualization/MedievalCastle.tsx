/**
 * MedievalCastle Component
 *
 * Creates an imposing medieval castle/keep as the central structure in the village.
 * This fortress dominates the scene with towers, battlements, and atmospheric lighting.
 *
 * Features:
 * - Central imposing keep tower with battlements and crenellations
 * - Four corner watchtowers
 * - Castle walls connecting towers with walkways (parapets)
 * - Courtyard area in center
 * - Grand entrance gate with portcullis visual
 * - Animated flickering torches with point lights
 * - Animated swaying flags/banners on towers
 *
 * Performance optimizations:
 * - Instanced mesh for repetitive crenellations
 * - Memoized geometries and materials
 * - Configurable features via props
 *
 * @module components/visualization/MedievalCastle
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <MedievalCastle position={[0, 0, -15]} scale={1.2} />
 * </Canvas>
 * ```
 */

import { useRef, useMemo, memo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Castle configuration - all dimensions and settings
 */
export const CASTLE_CONFIG = {
  /** Main keep tower dimensions */
  keep: {
    width: 8,
    depth: 8,
    height: 12,
    wallThickness: 0.8,
    battlementHeight: 1.2,
    battlementWidth: 0.6,
    battlementGap: 0.4,
  },
  /** Corner watchtower dimensions */
  tower: {
    radius: 2,
    height: 10,
    roofHeight: 2.5,
    roofRadius: 2.5,
    battlementCount: 8,
  },
  /** Castle walls connecting towers */
  wall: {
    height: 6,
    thickness: 1.2,
    parapetheight: 1,
    crenellationWidth: 0.5,
    crenellationHeight: 0.8,
    crenellationGap: 0.4,
  },
  /** Gate/entrance configuration */
  gate: {
    width: 3,
    height: 4,
    depth: 2,
    archRadius: 1.5,
    portcullisBarWidth: 0.08,
    portcullisBarGap: 0.25,
  },
  /** Torch configuration */
  torch: {
    baseColor: "#ff6600",
    intensity: 2.5,
    distance: 12,
    decay: 2,
    flickerSpeed: 8,
    flickerAmount: 0.4,
  },
  /** Flag/banner configuration */
  flag: {
    width: 1.5,
    height: 2.5,
    waveSpeed: 2,
    waveAmount: 0.3,
    poleHeight: 3,
    poleRadius: 0.05,
    colors: ["#8b0000", "#1a1a8b", "#006400", "#8b6914"], // Dark red, blue, green, gold
  },
  /** Material colors */
  colors: {
    stone: "#5a5a5a",
    stoneDark: "#3d3d3d",
    stoneLight: "#6b6b6b",
    wood: "#4a3a2a",
    iron: "#2a2a2a",
    gold: "#c9a227",
  },
} as const;

/** Default castle position in the village (behind main work area) */
export const CASTLE_POSITION: [number, number, number] = [0, 0, -42];

// =============================================================================
// Props Interface
// =============================================================================

/**
 * Props for MedievalCastle component
 */
export interface MedievalCastleProps {
  /** Position in 3D space [x, y, z] */
  position?: [number, number, number];
  /** Scale multiplier */
  scale?: number;
  /** Whether to render torches with flickering lights */
  showTorches?: boolean;
  /** Whether to render animated flags on towers */
  showFlags?: boolean;
  /** Whether to render the portcullis gate */
  showGate?: boolean;
  /** Rotation on Y axis (radians) */
  rotation?: number;
}

// =============================================================================
// Instanced Crenellations (Performance Optimized)
// =============================================================================

interface CrenellationConfig {
  positions: [number, number, number][];
  width: number;
  height: number;
  depth: number;
}

/**
 * Instanced crenellations for battlements
 * Uses InstancedMesh for single draw call rendering of all merlons
 */
const InstancedCrenellations = memo(function InstancedCrenellations({
  config,
}: {
  config: CrenellationConfig;
}): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(
    () => new THREE.BoxGeometry(config.width, config.height, config.depth),
    [config.width, config.height, config.depth]
  );

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CASTLE_CONFIG.colors.stone,
        roughness: 0.9,
        metalness: 0.1,
      }),
    []
  );

  // Set up instance matrices
  useMemo(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();
    config.positions.forEach((pos, i) => {
      dummy.position.set(pos[0], pos[1], pos[2]);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [config.positions]);

  if (config.positions.length === 0) return <></>;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, config.positions.length]}
      castShadow
      receiveShadow
    />
  );
});

// =============================================================================
// Flickering Torch Component
// =============================================================================

interface TorchProps {
  position: [number, number, number];
  intensity?: number;
}

/**
 * Torch with flickering light animation
 */
function FlickeringTorch({ position, intensity = 1 }: TorchProps): JSX.Element {
  const lightRef = useRef<THREE.PointLight>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (!lightRef.current || !flameRef.current) return;

    const time = state.clock.elapsedTime;
    const { flickerSpeed, flickerAmount, intensity: baseIntensity } = CASTLE_CONFIG.torch;

    // Complex flicker pattern combining multiple frequencies
    const flicker =
      1 +
      Math.sin(time * flickerSpeed + timeOffset) * flickerAmount * 0.5 +
      Math.sin(time * flickerSpeed * 1.7 + timeOffset) * flickerAmount * 0.3 +
      Math.sin(time * flickerSpeed * 3.1 + timeOffset) * flickerAmount * 0.2;

    lightRef.current.intensity = baseIntensity * intensity * flicker;

    // Animate flame scale
    flameRef.current.scale.setScalar(0.8 + flicker * 0.2);
    flameRef.current.rotation.y = Math.sin(time * 2 + timeOffset) * 0.2;
  });

  return (
    <group position={position}>
      {/* Torch bracket */}
      <mesh position={[0, -0.3, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.4, 6]} />
        <meshStandardMaterial color={CASTLE_CONFIG.colors.iron} roughness={0.7} metalness={0.5} />
      </mesh>

      {/* Torch head */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.06, 0.25, 8]} />
        <meshStandardMaterial color={CASTLE_CONFIG.colors.wood} roughness={0.9} />
      </mesh>

      {/* Flame core */}
      <mesh ref={flameRef} position={[0, 0.2, 0]}>
        <coneGeometry args={[0.12, 0.3, 8]} />
        <meshBasicMaterial
          color="#ff8800"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Flame glow */}
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshBasicMaterial
          color="#ff6600"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Point light */}
      <pointLight
        ref={lightRef}
        color={CASTLE_CONFIG.torch.baseColor}
        intensity={CASTLE_CONFIG.torch.intensity * intensity}
        distance={CASTLE_CONFIG.torch.distance}
        decay={CASTLE_CONFIG.torch.decay}
        castShadow
        shadow-mapSize-width={256}
        shadow-mapSize-height={256}
      />
    </group>
  );
}

// =============================================================================
// Animated Flag Component
// =============================================================================

interface FlagProps {
  position: [number, number, number];
  color: string;
  rotation?: number;
}

/**
 * Animated flag with swaying motion
 */
function AnimatedFlag({ position, color, rotation = 0 }: FlagProps): JSX.Element {
  const flagRef = useRef<THREE.Mesh>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  // Create flag geometry with segments for wave deformation
  const flagGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
      CASTLE_CONFIG.flag.width,
      CASTLE_CONFIG.flag.height,
      8,
      8
    );
    return geometry;
  }, []);

  const flagMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        roughness: 0.8,
      }),
    [color]
  );

  useFrame((state) => {
    if (!flagRef.current) return;

    const time = state.clock.elapsedTime;
    const { waveSpeed, waveAmount } = CASTLE_CONFIG.flag;

    // Get position attribute for wave deformation
    const positionAttribute = flagRef.current.geometry.getAttribute("position");
    const positions = positionAttribute.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const originalY = positions[i + 1];

      // Wave effect based on x position (distance from pole)
      const waveOffset = (x / CASTLE_CONFIG.flag.width + 0.5) * Math.PI;
      const wave = Math.sin(time * waveSpeed + waveOffset + timeOffset) * waveAmount;

      // Apply wave to z position
      positions[i + 2] = wave * (x / CASTLE_CONFIG.flag.width + 0.5);

      // Slight y wobble
      positions[i + 1] = originalY + wave * 0.1;
    }

    positionAttribute.needsUpdate = true;
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Flag pole */}
      <mesh position={[0, CASTLE_CONFIG.flag.poleHeight / 2, 0]}>
        <cylinderGeometry
          args={[
            CASTLE_CONFIG.flag.poleRadius,
            CASTLE_CONFIG.flag.poleRadius,
            CASTLE_CONFIG.flag.poleHeight,
            8,
          ]}
        />
        <meshStandardMaterial color={CASTLE_CONFIG.colors.wood} roughness={0.8} />
      </mesh>

      {/* Pole top ornament */}
      <mesh position={[0, CASTLE_CONFIG.flag.poleHeight, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color={CASTLE_CONFIG.colors.gold} roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Flag */}
      <mesh
        ref={flagRef}
        position={[CASTLE_CONFIG.flag.width / 2, CASTLE_CONFIG.flag.poleHeight - 0.5, 0]}
        geometry={flagGeometry}
        material={flagMaterial}
      />
    </group>
  );
}

// =============================================================================
// Corner Watchtower Component
// =============================================================================

interface WatchtowerProps {
  position: [number, number, number];
  showTorch?: boolean;
  showFlag?: boolean;
  flagColor?: string;
}

/**
 * Corner watchtower with conical roof and battlements
 */
const Watchtower = memo(function Watchtower({
  position,
  showTorch = true,
  showFlag = true,
  flagColor = CASTLE_CONFIG.flag.colors[0],
}: WatchtowerProps): JSX.Element {
  const { tower, colors } = CASTLE_CONFIG;

  // Generate battlement positions around tower top
  const battlementPositions = useMemo((): [number, number, number][] => {
    const positions: [number, number, number][] = [];
    const count = tower.battlementCount;
    const radius = tower.radius + 0.2;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      positions.push([
        Math.cos(angle) * radius,
        tower.height + 0.4,
        Math.sin(angle) * radius,
      ]);
    }
    return positions;
  }, [tower.battlementCount, tower.height, tower.radius]);

  return (
    <group position={position}>
      {/* Main tower cylinder */}
      <mesh position={[0, tower.height / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tower.radius, tower.radius * 1.1, tower.height, 16]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Tower base (slightly wider) */}
      <mesh position={[0, 0.5, 0]} receiveShadow>
        <cylinderGeometry args={[tower.radius * 1.2, tower.radius * 1.3, 1, 16]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Battlements around top */}
      {battlementPositions.map((pos, i) => (
        <mesh key={`battlement-${i}`} position={pos} castShadow>
          <boxGeometry args={[0.4, 0.8, 0.4]} />
          <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
        </mesh>
      ))}

      {/* Conical roof */}
      <mesh position={[0, tower.height + tower.roofHeight / 2 + 0.5, 0]} castShadow>
        <coneGeometry args={[tower.roofRadius, tower.roofHeight, 16]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Roof peak ornament */}
      <mesh position={[0, tower.height + tower.roofHeight + 0.8, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={colors.gold} roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Arrow slit windows */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, i) => (
        <mesh
          key={`window-${i}`}
          position={[
            Math.cos(angle) * (tower.radius + 0.01),
            tower.height * 0.6,
            Math.sin(angle) * (tower.radius + 0.01),
          ]}
          rotation={[0, -angle + Math.PI / 2, 0]}
        >
          <boxGeometry args={[0.15, 0.8, 0.1]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
      ))}

      {/* Torch */}
      {showTorch && (
        <FlickeringTorch
          position={[tower.radius + 0.3, tower.height * 0.7, 0]}
          intensity={0.8}
        />
      )}

      {/* Flag */}
      {showFlag && (
        <AnimatedFlag
          position={[0, tower.height + tower.roofHeight + 0.5, 0]}
          color={flagColor}
        />
      )}
    </group>
  );
});

// =============================================================================
// Castle Wall Segment Component
// =============================================================================

interface WallSegmentProps {
  start: [number, number, number];
  end: [number, number, number];
  showTorches?: boolean;
}

/**
 * Castle wall segment with parapet walkway and crenellations
 */
const WallSegment = memo(function WallSegment({
  start,
  end,
  showTorches = true,
}: WallSegmentProps): JSX.Element {
  const { wall, colors } = CASTLE_CONFIG;

  // Calculate wall properties
  const length = Math.sqrt(
    Math.pow(end[0] - start[0], 2) + Math.pow(end[2] - start[2], 2)
  );
  const angle = Math.atan2(end[2] - start[2], end[0] - start[0]);
  const midX = (start[0] + end[0]) / 2;
  const midZ = (start[2] + end[2]) / 2;

  // Generate crenellation positions
  const crenellationPositions = useMemo((): [number, number, number][] => {
    const positions: [number, number, number][] = [];
    const spacing = wall.crenellationWidth + wall.crenellationGap;
    const count = Math.floor(length / spacing) - 1;
    const startOffset = (length - count * spacing) / 2;

    for (let i = 0; i < count; i++) {
      const dist = startOffset + i * spacing;
      const localX = dist - length / 2;
      positions.push([localX, wall.height + wall.crenellationHeight / 2, 0]);
    }
    return positions;
  }, [length, wall.crenellationWidth, wall.crenellationGap, wall.height, wall.crenellationHeight]);

  return (
    <group position={[midX, 0, midZ]} rotation={[0, -angle, 0]}>
      {/* Main wall body */}
      <mesh position={[0, wall.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, wall.height, wall.thickness]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Parapet walkway (top of wall) */}
      <mesh position={[0, wall.height - 0.05, 0]} receiveShadow>
        <boxGeometry args={[length, 0.1, wall.thickness + 0.3]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Inner parapet wall (towards courtyard) */}
      <mesh position={[0, wall.height + wall.parapetheight / 2, -wall.thickness / 2 - 0.15]}>
        <boxGeometry args={[length, wall.parapetheight, 0.3]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Crenellations (merlons) on outer edge */}
      {crenellationPositions.map((pos, i) => (
        <mesh
          key={`crenellation-${i}`}
          position={[pos[0], pos[1], wall.thickness / 2 + 0.15]}
          castShadow
        >
          <boxGeometry args={[wall.crenellationWidth, wall.crenellationHeight, 0.3]} />
          <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
        </mesh>
      ))}

      {/* Wall torches */}
      {showTorches && (
        <>
          <FlickeringTorch position={[-length / 3, wall.height * 0.6, wall.thickness / 2 + 0.3]} />
          <FlickeringTorch position={[length / 3, wall.height * 0.6, wall.thickness / 2 + 0.3]} />
        </>
      )}
    </group>
  );
});

// =============================================================================
// Main Keep Tower Component
// =============================================================================

/**
 * Central keep tower - the imposing main structure
 */
const MainKeep = memo(function MainKeep({
  showTorches = true,
  showFlag = true,
}: {
  showTorches?: boolean;
  showFlag?: boolean;
}): JSX.Element {
  const { keep, colors, flag } = CASTLE_CONFIG;

  // Generate battlement positions for keep top
  const battlementConfig = useMemo((): CrenellationConfig => {
    const positions: [number, number, number][] = [];
    const spacing = keep.battlementWidth + keep.battlementGap;

    // Each side of the keep
    const sides = [
      { start: [-keep.width / 2, 0, keep.depth / 2], dir: [1, 0, 0] },
      { start: [keep.width / 2, 0, keep.depth / 2], dir: [0, 0, -1] },
      { start: [keep.width / 2, 0, -keep.depth / 2], dir: [-1, 0, 0] },
      { start: [-keep.width / 2, 0, -keep.depth / 2], dir: [0, 0, 1] },
    ];

    sides.forEach((side) => {
      const sideLength = side.dir[0] !== 0 ? keep.width : keep.depth;
      const count = Math.floor(sideLength / spacing) - 1;
      const startOffset = (sideLength - count * spacing) / 2;

      for (let i = 0; i < count; i++) {
        const dist = startOffset + i * spacing;
        positions.push([
          side.start[0] + side.dir[0] * dist,
          keep.height + keep.battlementHeight / 2,
          side.start[2] + side.dir[2] * dist,
        ]);
      }
    });

    return {
      positions,
      width: keep.battlementWidth,
      height: keep.battlementHeight,
      depth: keep.wallThickness,
    };
  }, [keep]);

  return (
    <group>
      {/* Main keep body */}
      <mesh position={[0, keep.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[keep.width, keep.height, keep.depth]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Keep base (slightly wider) */}
      <mesh position={[0, 0.5, 0]} receiveShadow>
        <boxGeometry args={[keep.width + 0.5, 1, keep.depth + 0.5]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Battlement parapet around top */}
      <mesh position={[0, keep.height + 0.1, 0]} receiveShadow>
        <boxGeometry args={[keep.width + 0.4, 0.2, keep.depth + 0.4]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Instanced crenellations */}
      <InstancedCrenellations config={battlementConfig} />

      {/* Corner towers on keep */}
      {[
        [-keep.width / 2 + 0.5, keep.depth / 2 - 0.5],
        [keep.width / 2 - 0.5, keep.depth / 2 - 0.5],
        [-keep.width / 2 + 0.5, -keep.depth / 2 + 0.5],
        [keep.width / 2 - 0.5, -keep.depth / 2 + 0.5],
      ].map((pos, i) => (
        <mesh
          key={`keep-tower-${i}`}
          position={[pos[0], keep.height / 2 + 1.5, pos[1]]}
          castShadow
        >
          <cylinderGeometry args={[0.8, 1, keep.height + 3, 8]} />
          <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
        </mesh>
      ))}

      {/* Arrow slit windows */}
      {[
        [0, keep.height * 0.5, keep.depth / 2 + 0.01],
        [0, keep.height * 0.7, keep.depth / 2 + 0.01],
        [keep.width / 2 + 0.01, keep.height * 0.5, 0],
        [keep.width / 2 + 0.01, keep.height * 0.7, 0],
        [-keep.width / 2 - 0.01, keep.height * 0.5, 0],
        [-keep.width / 2 - 0.01, keep.height * 0.7, 0],
        [0, keep.height * 0.5, -keep.depth / 2 - 0.01],
        [0, keep.height * 0.7, -keep.depth / 2 - 0.01],
      ].map((pos, i) => (
        <mesh
          key={`keep-window-${i}`}
          position={pos as [number, number, number]}
          rotation={[0, pos[0] === 0 ? 0 : Math.PI / 2, 0]}
        >
          <boxGeometry args={[0.2, 1, 0.1]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
      ))}

      {/* Keep entrance */}
      <mesh position={[0, 2, keep.depth / 2 + 0.1]}>
        <boxGeometry args={[2, 4, 0.3]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>

      {/* Entrance arch */}
      <mesh position={[0, 4, keep.depth / 2 + 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1, 0.15, 8, 16, Math.PI]} />
        <meshStandardMaterial color={colors.stoneDark} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Torches flanking entrance */}
      {showTorches && (
        <>
          <FlickeringTorch position={[-1.5, 3, keep.depth / 2 + 0.5]} />
          <FlickeringTorch position={[1.5, 3, keep.depth / 2 + 0.5]} />
        </>
      )}

      {/* Royal banner on keep */}
      {showFlag && <AnimatedFlag position={[0, keep.height + 0.5, 0]} color={flag.colors[0]} />}
    </group>
  );
});

// =============================================================================
// Grand Entrance Gate Component
// =============================================================================

/**
 * Grand entrance gate with portcullis
 */
const EntranceGate = memo(function EntranceGate(): JSX.Element {
  const { gate, colors, wall } = CASTLE_CONFIG;

  // Portcullis bar positions
  const portcullisBars = useMemo((): { x: number; y: number }[] => {
    const bars: { x: number; y: number }[] = [];
    const horizontalCount = Math.floor(gate.width / gate.portcullisBarGap) + 1;
    const verticalCount = Math.floor(gate.height / gate.portcullisBarGap) + 1;

    // Vertical bars
    for (let i = 0; i < horizontalCount; i++) {
      bars.push({
        x: -gate.width / 2 + i * gate.portcullisBarGap,
        y: gate.height / 2,
      });
    }

    return bars;
  }, [gate.width, gate.height, gate.portcullisBarGap]);

  const horizontalBars = useMemo((): number[] => {
    const bars: number[] = [];
    const count = Math.floor(gate.height / gate.portcullisBarGap);
    for (let i = 1; i < count; i++) {
      bars.push(i * gate.portcullisBarGap);
    }
    return bars;
  }, [gate.height, gate.portcullisBarGap]);

  return (
    <group position={[0, 0, wall.thickness * 6 + gate.depth / 2]}>
      {/* Gate towers on either side */}
      {[-gate.width / 2 - 1.5, gate.width / 2 + 1.5].map((x, i) => (
        <group key={`gate-tower-${i}`} position={[x, 0, 0]}>
          <mesh position={[0, (wall.height + 2) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.5, wall.height + 2, 2.5]} />
            <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
          </mesh>
          {/* Tower roof */}
          <mesh position={[0, wall.height + 3.5, 0]} castShadow>
            <coneGeometry args={[1.8, 2.5, 4]} />
            <meshStandardMaterial color={colors.stoneDark} roughness={0.85} metalness={0.1} />
          </mesh>
        </group>
      ))}

      {/* Gate arch lintel */}
      <mesh position={[0, gate.height + 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[gate.width + 1, 1.5, gate.depth]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Gate passage (dark interior) */}
      <mesh position={[0, gate.height / 2, 0]}>
        <boxGeometry args={[gate.width, gate.height, gate.depth + 0.1]} />
        <meshBasicMaterial color="#0a0a0a" />
      </mesh>

      {/* Portcullis (raised position - partially visible) */}
      <group position={[0, gate.height * 0.8, gate.depth / 2 - 0.2]}>
        {/* Vertical bars */}
        {portcullisBars.map((bar, i) => (
          <mesh key={`v-bar-${i}`} position={[bar.x, 0, 0]}>
            <boxGeometry args={[gate.portcullisBarWidth, gate.height * 0.5, gate.portcullisBarWidth]} />
            <meshStandardMaterial color={colors.iron} roughness={0.6} metalness={0.6} />
          </mesh>
        ))}
        {/* Horizontal bars */}
        {horizontalBars.slice(0, 3).map((y, i) => (
          <mesh key={`h-bar-${i}`} position={[0, y - gate.height * 0.25, 0]}>
            <boxGeometry args={[gate.width, gate.portcullisBarWidth, gate.portcullisBarWidth]} />
            <meshStandardMaterial color={colors.iron} roughness={0.6} metalness={0.6} />
          </mesh>
        ))}
      </group>

      {/* Torches on gate */}
      <FlickeringTorch position={[-gate.width / 2 - 0.8, gate.height * 0.7, gate.depth / 2 + 0.3]} />
      <FlickeringTorch position={[gate.width / 2 + 0.8, gate.height * 0.7, gate.depth / 2 + 0.3]} />
    </group>
  );
});

// =============================================================================
// Courtyard Component
// =============================================================================

/**
 * Castle courtyard area
 */
const Courtyard = memo(function Courtyard(): JSX.Element {
  const { keep, wall, colors } = CASTLE_CONFIG;
  const courtyardSize = keep.width + wall.thickness * 4;

  return (
    <group>
      {/* Courtyard floor (cobblestone-like) */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[courtyardSize, courtyardSize]} />
        <meshStandardMaterial color="#4a4540" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Well in courtyard */}
      <group position={[keep.width / 2 + 2, 0, 0]}>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.8, 12]} />
          <meshStandardMaterial color={colors.stone} roughness={0.9} metalness={0.1} />
        </mesh>
        {/* Well roof supports */}
        {[0, Math.PI].map((angle, i) => (
          <mesh
            key={`well-post-${i}`}
            position={[Math.cos(angle) * 0.6, 1.2, Math.sin(angle) * 0.6]}
          >
            <boxGeometry args={[0.1, 1.6, 0.1]} />
            <meshStandardMaterial color={colors.wood} roughness={0.9} />
          </mesh>
        ))}
        {/* Well roof */}
        <mesh position={[0, 2, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[1, 0.8, 4]} />
          <meshStandardMaterial color={colors.wood} roughness={0.85} />
        </mesh>
      </group>
    </group>
  );
});

// =============================================================================
// Main MedievalCastle Component
// =============================================================================

/**
 * MedievalCastle component
 *
 * Creates an epic medieval castle/keep as the central imposing structure in the village.
 * Features a main keep tower, corner watchtowers, connecting walls with battlements,
 * a grand entrance gate with portcullis, flickering torches, and animated flags.
 *
 * @param props - MedievalCastle props
 * @returns JSX element containing the complete castle structure
 *
 * @example
 * // Basic usage with defaults
 * <MedievalCastle />
 *
 * // Customized castle
 * <MedievalCastle
 *   position={[0, 0, -20]}
 *   scale={1.5}
 *   showTorches={true}
 *   showFlags={true}
 * />
 */
export const MedievalCastle = memo(function MedievalCastle({
  position = CASTLE_POSITION,
  scale = 1,
  showTorches = true,
  showFlags = true,
  showGate = true,
  rotation = 0,
}: MedievalCastleProps): JSX.Element {
  const { keep, tower, wall } = CASTLE_CONFIG;

  // Calculate corner tower positions (outside the walls)
  const towerPositions = useMemo((): [number, number, number][] => {
    const offset = keep.width / 2 + wall.thickness * 2 + tower.radius;
    return [
      [-offset, 0, offset], // Front-left
      [offset, 0, offset], // Front-right
      [-offset, 0, -offset], // Back-left
      [offset, 0, -offset], // Back-right
    ];
  }, [keep.width, wall.thickness, tower.radius]);

  // Calculate wall segments connecting towers
  const wallSegments = useMemo((): { start: [number, number, number]; end: [number, number, number] }[] => {
    const offset = keep.width / 2 + wall.thickness * 2;
    return [
      // Front wall (with gate gap in middle)
      { start: [-offset - tower.radius, 0, offset + wall.thickness], end: [-wall.thickness * 2, 0, offset + wall.thickness] },
      { start: [wall.thickness * 2, 0, offset + wall.thickness], end: [offset + tower.radius, 0, offset + wall.thickness] },
      // Right wall
      { start: [offset + wall.thickness, 0, offset + tower.radius], end: [offset + wall.thickness, 0, -offset - tower.radius] },
      // Back wall
      { start: [offset + tower.radius, 0, -offset - wall.thickness], end: [-offset - tower.radius, 0, -offset - wall.thickness] },
      // Left wall
      { start: [-offset - wall.thickness, 0, -offset - tower.radius], end: [-offset - wall.thickness, 0, offset + tower.radius] },
    ];
  }, [keep.width, wall.thickness, tower.radius]);

  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      {/* Main keep tower */}
      <MainKeep showTorches={showTorches} showFlag={showFlags} />

      {/* Corner watchtowers */}
      {towerPositions.map((pos, i) => (
        <Watchtower
          key={`tower-${i}`}
          position={pos}
          showTorch={showTorches}
          showFlag={showFlags}
          flagColor={CASTLE_CONFIG.flag.colors[i % CASTLE_CONFIG.flag.colors.length]}
        />
      ))}

      {/* Connecting walls */}
      {wallSegments.map((segment, i) => (
        <WallSegment
          key={`wall-${i}`}
          start={segment.start}
          end={segment.end}
          showTorches={showTorches && i !== 0 && i !== 1} // No torches on front wall sections
        />
      ))}

      {/* Grand entrance gate */}
      {showGate && <EntranceGate />}

      {/* Courtyard */}
      <Courtyard />
    </group>
  );
});

export default MedievalCastle;
