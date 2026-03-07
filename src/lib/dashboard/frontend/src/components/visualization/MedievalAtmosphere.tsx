/**
 * MedievalAtmosphere Component
 *
 * Creates the atmospheric environment for medieval village visualization:
 * - Warm ambient and directional lighting for sunset feel
 * - Atmospheric fog for depth perception
 * - Torch point lights at configurable positions
 * - Cobblestone ground plane with texture (or fallback color)
 * - LOD (Level of Detail) for distant hills and mountains
 *
 * This component should be placed inside a Canvas from @react-three/fiber.
 *
 * Performance optimizations:
 * - LOD for hills: Higher detail up close, simplified geometry at distance
 * - Memoized geometry and materials
 *
 * @module components/visualization/MedievalAtmosphere
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <MedievalAtmosphere />
 *   {// Village components}
 * </Canvas>
 * ```
 */

import { useThree } from "@react-three/fiber";
import { Sky, Detailed } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { MEDIEVAL_CONFIG } from "../../config/visualization-config";

// =============================================================================
// Sky and Environment Components
// =============================================================================

/**
 * MedievalSky component - uses drei's Sky for realistic atmosphere
 * Configured for a warm sunset/golden hour look
 */
function MedievalSky(): JSX.Element {
  return (
    <Sky
      distance={450000}
      sunPosition={[100, 20, 100]}
      inclination={0.49}
      azimuth={0.25}
      turbidity={8}
      rayleigh={0.5}
      mieCoefficient={0.005}
      mieDirectionalG={0.8}
    />
  );
}

/**
 * LOD distances for hills and mountains
 * Objects further than these distances use lower detail geometry
 */
const LOD_DISTANCES = {
  /** Distance for high detail (full geometry) */
  high: 50,
  /** Distance for medium detail (reduced segments) */
  medium: 100,
  /** Distance for low detail (minimal segments) */
  low: 150,
} as const;

/**
 * Hill with LOD - renders a hill mesh with level of detail
 * Uses drei's Detailed component for automatic LOD switching
 */
function HillWithLOD({
  position,
  scale,
  color,
  isMountain = false,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: THREE.Color;
  isMountain?: boolean;
}): JSX.Element {
  // Memoize material to prevent re-creation
  const material = useMemo(
    () => (
      <meshStandardMaterial
        color={color}
        roughness={isMountain ? 0.95 : 0.9}
        metalness={0}
      />
    ),
    [color, isMountain]
  );

  // High detail geometry
  const highDetail = useMemo(
    () => (
      <mesh>
        <sphereGeometry args={[1, isMountain ? 12 : 16, isMountain ? 6 : 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {material}
      </mesh>
    ),
    [isMountain, material]
  );

  // Medium detail geometry (fewer segments)
  const mediumDetail = useMemo(
    () => (
      <mesh>
        <sphereGeometry args={[1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {material}
      </mesh>
    ),
    [material]
  );

  // Low detail geometry (minimal segments)
  const lowDetail = useMemo(
    () => (
      <mesh>
        <sphereGeometry args={[1, 4, 2, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {material}
      </mesh>
    ),
    [material]
  );

  return (
    <Detailed distances={[LOD_DISTANCES.high, LOD_DISTANCES.medium, LOD_DISTANCES.low]} position={position} scale={scale}>
      {highDetail}
      {mediumDetail}
      {lowDetail}
    </Detailed>
  );
}

/**
 * RollingHills component - creates distant rolling hills in the background
 * Uses a ring of gentle hills around the village with LOD for performance
 *
 * Performance: Uses drei's Detailed (THREE.LOD) to reduce polygon count
 * for distant hills, improving rendering performance.
 */
function RollingHills(): JSX.Element {
  // Generate procedural hills with deterministic random for mountains
  const hillsGeometry = useMemo(() => {
    const hills: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      isMountain: boolean;
    }> = [];

    // Create a ring of hills around the scene
    const hillCount = 24;
    const baseRadius = 80;

    for (let i = 0; i < hillCount; i++) {
      const angle = (i / hillCount) * Math.PI * 2;
      const radiusVariation = Math.sin(i * 1.7) * 15;
      const radius = baseRadius + radiusVariation;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // Vary hill heights
      const heightBase = 8 + Math.sin(i * 2.3) * 4;
      const widthX = 15 + Math.sin(i * 1.1) * 8;
      const widthZ = 12 + Math.cos(i * 0.9) * 6;

      hills.push({
        position: [x, heightBase / 2 - 2, z],
        scale: [widthX, heightBase, widthZ],
        isMountain: false,
      });
    }

    // Add some larger background mountains with deterministic "random"
    const mountainCount = 8;
    for (let i = 0; i < mountainCount; i++) {
      const angle = (i / mountainCount) * Math.PI * 2 + 0.2;
      const radius = 120 + Math.sin(i * 2.1) * 20;

      // Use deterministic pseudo-random based on index
      const pseudoRandom1 = Math.sin(i * 12.9898) * 43758.5453 % 1;
      const pseudoRandom2 = Math.sin(i * 78.233) * 43758.5453 % 1;
      const pseudoRandom3 = Math.sin(i * 45.164) * 43758.5453 % 1;

      hills.push({
        position: [
          Math.cos(angle) * radius,
          12,
          Math.sin(angle) * radius,
        ],
        scale: [
          25 + Math.abs(pseudoRandom1) * 10,
          20 + Math.abs(pseudoRandom2) * 10,
          20 + Math.abs(pseudoRandom3) * 8,
        ],
        isMountain: true,
      });
    }

    return hills;
  }, []);

  // Hill colors - varying greens and browns
  const hillColor = useMemo(() => new THREE.Color(0x4a7c4e), []); // Forest green
  const mountainColor = useMemo(() => new THREE.Color(0x5a6a5a), []); // Darker gray-green

  return (
    <group>
      {/* Rolling hills and mountains with LOD */}
      {hillsGeometry.map((hill, i) => (
        <HillWithLOD
          key={`hill-${i}`}
          position={hill.position}
          scale={hill.scale}
          color={hill.isMountain ? mountainColor : hillColor}
          isMountain={hill.isMountain}
        />
      ))}
    </group>
  );
}

/**
 * Props for MedievalAtmosphere component
 */
export interface MedievalAtmosphereProps {
  /** Override fog enabled state (default: true) */
  fog?: boolean;
  /** Override torches enabled state (default: true) */
  torches?: boolean;
  /** Custom torch positions (overrides config defaults) */
  torchPositions?: [number, number, number][];
  /** Override ground enabled state (default: true) */
  ground?: boolean;
  /** Override ambient light intensity */
  ambientIntensity?: number;
  /** Override directional light intensity */
  directionalIntensity?: number;
  /** Override sky dome enabled state (default: true) */
  sky?: boolean;
  /** Override rolling hills enabled state (default: true) */
  hills?: boolean;
}

/**
 * TorchLight component - individual torch point light
 *
 * Creates a warm point light that simulates a torch flame.
 * Configured from MEDIEVAL_CONFIG.torches settings.
 *
 * @param position - World position [x, y, z] for the torch light
 * @returns JSX element with pointLight
 */
function TorchLight({
  position,
}: {
  position: [number, number, number];
}): JSX.Element {
  const { torches } = MEDIEVAL_CONFIG;

  return (
    <pointLight
      position={position}
      color={torches.color}
      intensity={torches.intensity}
      distance={torches.distance}
      decay={torches.decay}
      castShadow
      shadow-mapSize-width={512}
      shadow-mapSize-height={512}
    />
  );
}

/**
 * GrassyTerrain component - improved ground with grass-like appearance
 *
 * Uses a larger ground plane with grass coloring and subtle height variations
 * through vertex displacement for a more natural look.
 *
 * @returns JSX element with grassy terrain mesh
 */
function GrassyTerrain(): JSX.Element {
  const { ground } = MEDIEVAL_CONFIG;

  // Create a custom grass material with subtle variation
  const grassMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x4a7344), // Medium grass green
      roughness: 0.95,
      metalness: 0,
    });
  }, []);

  return (
    <group>
      {/* Main grass ground - extended to cover more area */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ground.positionY - 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          color={0x4a7344}
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* Dirt path area in village center - cobblestone colored */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ground.positionY, 0]}
        receiveShadow
      >
        <planeGeometry args={[30, 40]} />
        <primitive object={grassMaterial} attach="material" />
      </mesh>

      {/* Central cobblestone plaza around town square */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ground.positionY + 0.01, 0]}
        receiveShadow
      >
        <circleGeometry args={[8, 32]} />
        <meshStandardMaterial
          color={0x6b5b4f} // Brownish cobblestone
          roughness={0.9}
          metalness={0.05}
        />
      </mesh>

      {/* Dirt path from cottages to town square */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, ground.positionY + 0.005, 11]}
        receiveShadow
      >
        <planeGeometry args={[4, 14]} />
        <meshStandardMaterial
          color={0x8b7355} // Sandy brown path
          roughness={0.95}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/**
 * MedievalAtmosphere component
 *
 * Provides the complete atmospheric environment for medieval village:
 * - Warm sunset lighting (ambient + directional)
 * - Atmospheric fog with depth fade
 * - Torch point lights for local illumination
 * - Cobblestone ground plane
 *
 * @param props - MedievalAtmosphere props
 * @returns JSX element with complete atmosphere setup
 *
 * @example
 * ```tsx
 * // Basic usage with defaults
 * <MedievalAtmosphere />
 *
 * // Customized usage
 * <MedievalAtmosphere
 *   fog={true}
 *   torches={true}
 *   torchPositions={[[-5, 2, 5], [5, 2, 5]]}
 *   ambientIntensity={0.4}
 * />
 * ```
 */
export function MedievalAtmosphere({
  fog = true,
  torches = true,
  torchPositions,
  ground = true,
  ambientIntensity,
  directionalIntensity,
  sky = true,
  hills = true,
}: MedievalAtmosphereProps): JSX.Element {
  const { scene } = useThree();
  const { lighting, fog: fogConfig, torches: torchConfig } = MEDIEVAL_CONFIG;

  // Convert hex colors to Three.js Color objects (memoized)
  const fogColor = useMemo(
    () => new THREE.Color(fogConfig.color),
    [fogConfig.color]
  );
  const ambientColor = useMemo(
    () => new THREE.Color(lighting.ambientColor),
    [lighting.ambientColor]
  );
  const directionalColor = useMemo(
    () => new THREE.Color(lighting.directionalColor),
    [lighting.directionalColor]
  );

  // Get torch positions from props or config
  const positions = torchPositions ?? torchConfig.positions;

  // Set scene fog
  useEffect(() => {
    // Store original fog for cleanup
    const originalFog = scene.fog;

    if (fog) {
      scene.fog = new THREE.Fog(fogColor, fogConfig.near, fogConfig.far);
    } else {
      scene.fog = null;
    }

    // Cleanup on unmount
    return () => {
      scene.fog = originalFog;
    };
  }, [scene, fog, fogColor, fogConfig.near, fogConfig.far]);

  return (
    <>
      {/* Sky with realistic atmosphere from drei */}
      {sky && <MedievalSky />}

      {/* Rolling hills in background */}
      {hills && <RollingHills />}

      {/* Warm ambient light for base visibility */}
      <ambientLight
        color={ambientColor}
        intensity={ambientIntensity ?? lighting.ambientIntensity}
      />

      {/* Directional sunset light */}
      <directionalLight
        color={directionalColor}
        intensity={directionalIntensity ?? lighting.directionalIntensity}
        position={lighting.directionalPosition}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      {/* Torch point lights */}
      {torches &&
        positions.map((position, index) => (
          <TorchLight key={`torch-${index}`} position={position} />
        ))}

      {/* Ground with grass and paths */}
      {ground && <GrassyTerrain />}
    </>
  );
}

export default MedievalAtmosphere;
