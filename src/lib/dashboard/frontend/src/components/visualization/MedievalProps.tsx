/**
 * MedievalProps Component
 *
 * Environmental decorations for the medieval village visualization:
 * - Brazier - Metal fire bowl with animated flames and point light
 * - Banner - Cloth banner on pole with swaying animation
 * - Cart - Wooden wagon with wheels
 * - Barrels - Stack of wooden barrels
 * - Crates - Wooden crates/boxes
 * - Well - Stone well with bucket
 * - Fence - Wooden fence sections
 * - Signpost - Wooden directional sign
 * - HayBale - Stacked hay
 * - WeaponRack - Medieval weapon display
 *
 * @module components/visualization/MedievalProps
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

export const PROPS_CONFIG = {
  brazier: {
    bowlRadius: 0.4,
    bowlHeight: 0.3,
    standHeight: 0.8,
    flameParticles: 20,
    lightIntensity: 2,
    lightDistance: 6,
    lightColor: 0xff6600,
    flickerSpeed: 8,
  },
  banner: {
    defaultColor: 0xcc2222,
    poleHeight: 3,
    poleRadius: 0.05,
    clothWidth: 0.8,
    clothHeight: 1.2,
    swaySpeed: 1.5,
    swayAmount: 0.15,
  },
  cart: {
    bodyLength: 2,
    bodyWidth: 1.2,
    bodyHeight: 0.4,
    wheelRadius: 0.4,
    wheelWidth: 0.1,
    handleLength: 1.2,
  },
  barrels: {
    radius: 0.25,
    height: 0.5,
    segments: 12,
  },
  crates: {
    size: 0.4,
  },
  well: {
    baseRadius: 0.8,
    baseHeight: 0.6,
    roofHeight: 1.5,
    roofRadius: 1.0,
    bucketRadius: 0.15,
    ropeLength: 0.8,
  },
  fence: {
    postHeight: 1.0,
    postRadius: 0.04,
    railHeight: 0.04,
    railLength: 1.5,
    spacing: 0.25,
  },
  signpost: {
    postHeight: 2.0,
    postRadius: 0.08,
    signWidth: 0.8,
    signHeight: 0.25,
    signDepth: 0.04,
  },
  hay: {
    baleWidth: 0.8,
    baleHeight: 0.4,
    baleDepth: 0.5,
  },
  weaponRack: {
    frameWidth: 1.2,
    frameHeight: 1.5,
    frameDepth: 0.3,
    weaponCount: 3,
  },
} as const;

// =============================================================================
// Type Definitions
// =============================================================================

export interface PropBaseProps {
  /** Position of the prop */
  position?: [number, number, number];
  /** Rotation in radians [x, y, z] */
  rotation?: [number, number, number];
  /** Scale multiplier */
  scale?: number;
}

export interface BannerProps extends PropBaseProps {
  /** Banner cloth color */
  color?: number;
  /** Pole height override */
  poleHeight?: number;
}

export interface SignpostProps extends PropBaseProps {
  /** Sign text labels */
  signs?: Array<{ text: string; direction: number }>;
}

export interface FenceProps extends PropBaseProps {
  /** Number of fence sections */
  sections?: number;
}

export interface PropPlacement {
  type:
    | "brazier"
    | "banner"
    | "cart"
    | "barrels"
    | "crates"
    | "well"
    | "fence"
    | "signpost"
    | "hay"
    | "weaponRack";
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  /** Type-specific props */
  props?: Record<string, unknown>;
}

// =============================================================================
// Brazier Component
// =============================================================================

interface FlameParticle {
  offset: THREE.Vector3;
  speed: number;
  phase: number;
  scale: number;
}

export interface BrazierProps extends PropBaseProps {
  /** Light intensity multiplier */
  intensity?: number;
}

/**
 * Brazier - Metal fire bowl on stand with animated flames and point light
 */
export function Brazier({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  intensity = 1,
}: BrazierProps): JSX.Element {
  const flameRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const {
    bowlRadius,
    bowlHeight,
    standHeight,
    flameParticles,
    lightIntensity,
    lightDistance,
    lightColor,
    flickerSpeed,
  } = PROPS_CONFIG.brazier;

  // Generate flame particle data
  const particles = useMemo<FlameParticle[]>(() => {
    return Array.from({ length: flameParticles }, (_, i) => ({
      offset: new THREE.Vector3(
        (Math.random() - 0.5) * bowlRadius * 0.6,
        Math.random() * 0.3,
        (Math.random() - 0.5) * bowlRadius * 0.6
      ),
      speed: 0.8 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      scale: 0.5 + Math.random() * 0.5,
    }));
  }, [flameParticles, bowlRadius]);

  const flameGeometry = useMemo(() => new THREE.SphereGeometry(0.06, 6, 6), []);
  const flameMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Animation
  useFrame((state) => {
    if (!flameRef.current || !lightRef.current) return;

    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();

    // Update flame particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const flickerY = Math.sin(time * flickerSpeed + p.phase) * 0.1;
      const flickerX = Math.cos(time * flickerSpeed * 0.7 + p.phase) * 0.03;

      dummy.position.set(
        p.offset.x + flickerX,
        standHeight + bowlHeight + p.offset.y + flickerY,
        p.offset.z + flickerX
      );

      const scaleFlicker = p.scale * (0.8 + Math.sin(time * flickerSpeed + p.phase) * 0.2);
      dummy.scale.setScalar(scaleFlicker * scale);
      dummy.updateMatrix();
      flameRef.current.setMatrixAt(i, dummy.matrix);
    }

    flameRef.current.instanceMatrix.needsUpdate = true;

    // Flicker the light
    lightRef.current.intensity =
      lightIntensity *
      intensity *
      (0.8 + Math.sin(time * flickerSpeed * 1.3) * 0.2);

    // Flicker the glow
    if (glowRef.current) {
      const glowScale = 0.9 + Math.sin(time * flickerSpeed) * 0.1;
      glowRef.current.scale.setScalar(glowScale);
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Stand legs (4 legs) */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2;
        const legX = Math.cos(angle) * bowlRadius * 0.6;
        const legZ = Math.sin(angle) * bowlRadius * 0.6;
        return (
          <mesh
            key={`leg-${i}`}
            position={[legX, standHeight / 2, legZ]}
            rotation={[0, angle, 0.2]}
          >
            <cylinderGeometry args={[0.03, 0.04, standHeight, 6]} />
            <meshStandardMaterial color={0x2a2a2a} roughness={0.6} metalness={0.7} />
          </mesh>
        );
      })}

      {/* Support ring */}
      <mesh position={[0, standHeight * 0.7, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[bowlRadius * 0.5, 0.025, 8, 16]} />
        <meshStandardMaterial color={0x2a2a2a} roughness={0.6} metalness={0.7} />
      </mesh>

      {/* Fire bowl */}
      <mesh position={[0, standHeight + bowlHeight / 2, 0]}>
        <cylinderGeometry
          args={[bowlRadius, bowlRadius * 0.7, bowlHeight, 12, 1, true]}
        />
        <meshStandardMaterial
          color={0x1a1a1a}
          roughness={0.5}
          metalness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Bowl rim */}
      <mesh position={[0, standHeight + bowlHeight, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[bowlRadius, 0.03, 8, 16]} />
        <meshStandardMaterial color={0x3a3a3a} roughness={0.5} metalness={0.8} />
      </mesh>

      {/* Coal/ember base */}
      <mesh position={[0, standHeight + bowlHeight * 0.3, 0]}>
        <sphereGeometry args={[bowlRadius * 0.6, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={0x331100} emissive={0x441100} emissiveIntensity={0.5} roughness={0.9} />
      </mesh>

      {/* Flame particles */}
      <instancedMesh
        ref={flameRef}
        args={[flameGeometry, flameMaterial, flameParticles]}
        frustumCulled={false}
      />

      {/* Glow */}
      <mesh ref={glowRef} position={[0, standHeight + bowlHeight + 0.2, 0]}>
        <sphereGeometry args={[bowlRadius * 0.8, 8, 8]} />
        <meshBasicMaterial
          color={0xff8800}
          transparent
          opacity={0.2 * intensity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Point light */}
      <pointLight
        ref={lightRef}
        position={[0, standHeight + bowlHeight + 0.3, 0]}
        color={lightColor}
        intensity={lightIntensity * intensity}
        distance={lightDistance}
        decay={2}
        castShadow
      />
    </group>
  );
}

// =============================================================================
// Banner Component
// =============================================================================

/**
 * Banner - Cloth banner on pole with animated swaying
 */
export function Banner({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  color = PROPS_CONFIG.banner.defaultColor,
  poleHeight = PROPS_CONFIG.banner.poleHeight,
}: BannerProps): JSX.Element {
  const clothRef = useRef<THREE.Mesh>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  const { poleRadius, clothWidth, clothHeight, swaySpeed, swayAmount } =
    PROPS_CONFIG.banner;

  // Sway animation
  useFrame((state) => {
    if (!clothRef.current) return;
    const time = state.clock.elapsedTime;

    // Rotate the cloth to create swaying effect
    clothRef.current.rotation.y = Math.sin(time * swaySpeed + timeOffset) * swayAmount;
    clothRef.current.rotation.x = Math.cos(time * swaySpeed * 0.7 + timeOffset) * swayAmount * 0.3;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Pole */}
      <mesh position={[0, poleHeight / 2, 0]}>
        <cylinderGeometry args={[poleRadius, poleRadius * 1.2, poleHeight, 8]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
      </mesh>

      {/* Pole cap */}
      <mesh position={[0, poleHeight, 0]}>
        <sphereGeometry args={[poleRadius * 1.5, 8, 8]} />
        <meshStandardMaterial color={0x8b7355} roughness={0.7} metalness={0.3} />
      </mesh>

      {/* Banner cloth */}
      <group ref={clothRef} position={[clothWidth / 2, poleHeight - clothHeight / 2 - 0.1, 0]}>
        <mesh>
          <planeGeometry args={[clothWidth, clothHeight]} />
          <meshStandardMaterial
            color={color}
            side={THREE.DoubleSide}
            roughness={0.9}
          />
        </mesh>

        {/* Banner trim */}
        <mesh position={[0, -clothHeight / 2 + 0.02, 0.01]}>
          <planeGeometry args={[clothWidth, 0.05]} />
          <meshStandardMaterial color={0xdaa520} roughness={0.7} metalness={0.3} />
        </mesh>

        {/* Triangular bottom */}
        <mesh position={[0, -clothHeight / 2 - 0.15, 0]}>
          <coneGeometry args={[clothWidth / 4, 0.3, 4]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      </group>

      {/* Mounting bracket */}
      <mesh position={[0.05, poleHeight - 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.15, 6]} />
        <meshStandardMaterial color={0x2a2a2a} roughness={0.5} metalness={0.7} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Cart Component
// =============================================================================

/**
 * Cart - Wooden wagon with wheels
 */
export function Cart({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const { bodyLength, bodyWidth, bodyHeight, wheelRadius, wheelWidth, handleLength } =
    PROPS_CONFIG.cart;

  const wheelY = wheelRadius;
  const bodyY = wheelRadius + bodyHeight / 2 + 0.1;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Cart body (box) */}
      <mesh position={[0, bodyY, 0]}>
        <boxGeometry args={[bodyLength, bodyHeight, bodyWidth]} />
        <meshStandardMaterial color={0x6b4423} roughness={0.9} />
      </mesh>

      {/* Cart sides (taller) */}
      {[-1, 1].map((side) => (
        <mesh
          key={`side-${side}`}
          position={[0, bodyY + bodyHeight / 2 + 0.15, (side * bodyWidth) / 2]}
        >
          <boxGeometry args={[bodyLength, 0.3, 0.05]} />
          <meshStandardMaterial color={0x5a3a1a} roughness={0.9} />
        </mesh>
      ))}

      {/* Front and back walls */}
      {[-1, 1].map((end) => (
        <mesh
          key={`end-${end}`}
          position={[(end * bodyLength) / 2, bodyY + bodyHeight / 2 + 0.15, 0]}
        >
          <boxGeometry args={[0.05, 0.3, bodyWidth]} />
          <meshStandardMaterial color={0x5a3a1a} roughness={0.9} />
        </mesh>
      ))}

      {/* Wheels */}
      {[
        [-bodyLength / 2 + 0.2, wheelY, bodyWidth / 2 + wheelWidth / 2],
        [-bodyLength / 2 + 0.2, wheelY, -bodyWidth / 2 - wheelWidth / 2],
        [bodyLength / 2 - 0.2, wheelY, bodyWidth / 2 + wheelWidth / 2],
        [bodyLength / 2 - 0.2, wheelY, -bodyWidth / 2 - wheelWidth / 2],
      ].map((pos, i) => (
        <group key={`wheel-${i}`} position={pos as [number, number, number]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 16]} />
            <meshStandardMaterial color={0x3a2a1a} roughness={0.8} />
          </mesh>
          {/* Wheel spokes */}
          {[0, 1, 2, 3, 4, 5].map((spoke) => (
            <mesh
              key={`spoke-${spoke}`}
              rotation={[Math.PI / 2, (spoke / 6) * Math.PI * 2, 0]}
            >
              <boxGeometry args={[0.04, wheelRadius * 1.8, 0.02]} />
              <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
            </mesh>
          ))}
          {/* Wheel hub */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.08, wheelWidth + 0.02, 8]} />
            <meshStandardMaterial color={0x2a2a2a} roughness={0.6} metalness={0.5} />
          </mesh>
        </group>
      ))}

      {/* Axles */}
      {[-1, 1].map((end) => (
        <mesh
          key={`axle-${end}`}
          position={[end * (bodyLength / 2 - 0.2), wheelY, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.04, 0.04, bodyWidth + wheelWidth * 2 + 0.1, 8]} />
          <meshStandardMaterial color={0x2a2a2a} roughness={0.6} metalness={0.5} />
        </mesh>
      ))}

      {/* Handle/tongue */}
      <mesh
        position={[-bodyLength / 2 - handleLength / 2, bodyY - 0.1, 0]}
        rotation={[0, 0, 0.1]}
      >
        <boxGeometry args={[handleLength, 0.08, 0.08]} />
        <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
      </mesh>

      {/* Handle crossbar */}
      <mesh position={[-bodyLength / 2 - handleLength, bodyY - 0.05, 0]}>
        <boxGeometry args={[0.08, 0.08, 0.6]} />
        <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Barrels Component
// =============================================================================

/**
 * Barrels - Stack of wooden barrels
 */
export function Barrels({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const { radius, height, segments } = PROPS_CONFIG.barrels;

  // Barrel layout: 3 on bottom, 2 on top
  const barrelPositions: Array<[number, number, number]> = [
    // Bottom row
    [0, height / 2, 0],
    [radius * 2.2, height / 2, 0],
    [radius * 1.1, height / 2, radius * 1.8],
    // Top row (nestled between bottom barrels)
    [radius * 0.55, height * 1.5, radius * 0.6],
    [radius * 1.65, height * 1.5, radius * 0.6],
  ];

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {barrelPositions.map((pos, i) => (
        <group key={`barrel-${i}`} position={pos}>
          {/* Barrel body */}
          <mesh>
            <cylinderGeometry args={[radius * 0.9, radius, height, segments]} />
            <meshStandardMaterial color={0x6b4423} roughness={0.85} />
          </mesh>

          {/* Metal bands */}
          {[-0.35, 0, 0.35].map((yOffset) => (
            <mesh
              key={`band-${yOffset}`}
              position={[0, yOffset * height, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[radius * 0.92, 0.015, 8, 16]} />
              <meshStandardMaterial color={0x3a3a3a} roughness={0.5} metalness={0.7} />
            </mesh>
          ))}

          {/* Top lid */}
          <mesh position={[0, height / 2, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[radius * 0.85, radius * 0.85, 0.04, segments]} />
            <meshStandardMaterial color={0x5a3a1a} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// =============================================================================
// Crates Component
// =============================================================================

/**
 * Crates - Wooden crates/boxes stacked
 */
export function Crates({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const { size } = PROPS_CONFIG.crates;

  // Crate layout: 2x2 base, 1 on top offset
  const crateData: Array<{ pos: [number, number, number]; rot: number; s: number }> = [
    // Base layer
    { pos: [0, size / 2, 0], rot: 0, s: 1 },
    { pos: [size * 1.1, size / 2, 0], rot: 0.1, s: 1 },
    { pos: [0, size / 2, size * 1.1], rot: -0.05, s: 1 },
    { pos: [size * 1.1, size / 2, size * 1.1], rot: 0.15, s: 0.9 },
    // Top layer
    { pos: [size * 0.55, size * 1.5, size * 0.55], rot: 0.3, s: 0.85 },
  ];

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {crateData.map((crate, i) => (
        <group
          key={`crate-${i}`}
          position={crate.pos}
          rotation={[0, crate.rot, 0]}
          scale={crate.s}
        >
          {/* Main box */}
          <mesh>
            <boxGeometry args={[size, size, size]} />
            <meshStandardMaterial color={0x8b7355} roughness={0.9} />
          </mesh>

          {/* Planks (horizontal lines) */}
          {[-0.3, 0, 0.3].map((y) => (
            <mesh key={`plank-${y}`} position={[0, y * size, size / 2 + 0.01]}>
              <boxGeometry args={[size, 0.02, 0.01]} />
              <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
            </mesh>
          ))}

          {/* Corner reinforcements */}
          {[
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ].map(([x, z], j) => (
            <mesh
              key={`corner-${j}`}
              position={[(x * size) / 2, 0, (z * size) / 2]}
            >
              <boxGeometry args={[0.04, size, 0.04]} />
              <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// =============================================================================
// Well Component
// =============================================================================

/**
 * Well - Stone well with bucket and rope
 */
export function Well({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const bucketRef = useRef<THREE.Group>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  const { baseRadius, baseHeight, roofHeight, roofRadius, bucketRadius, ropeLength } =
    PROPS_CONFIG.well;

  // Gentle bucket sway
  useFrame((state) => {
    if (!bucketRef.current) return;
    const time = state.clock.elapsedTime;
    bucketRef.current.rotation.z = Math.sin(time * 0.5 + timeOffset) * 0.05;
    bucketRef.current.rotation.x = Math.cos(time * 0.3 + timeOffset) * 0.03;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Stone base (cylindrical wall) */}
      <mesh position={[0, baseHeight / 2, 0]}>
        <cylinderGeometry
          args={[baseRadius, baseRadius * 1.1, baseHeight, 16, 1, true]}
        />
        <meshStandardMaterial color={0x7a7a7a} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* Stone top rim */}
      <mesh position={[0, baseHeight, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[baseRadius, 0.08, 8, 16]} />
        <meshStandardMaterial color={0x8a8a8a} roughness={0.9} />
      </mesh>

      {/* Water inside (dark) */}
      <mesh position={[0, baseHeight * 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[baseRadius * 0.85, 16]} />
        <meshStandardMaterial color={0x1a3a4a} roughness={0.3} metalness={0.1} />
      </mesh>

      {/* Roof support posts */}
      {[0, Math.PI].map((angle, i) => {
        const x = Math.cos(angle) * baseRadius * 0.9;
        const z = Math.sin(angle) * baseRadius * 0.9;
        return (
          <mesh
            key={`post-${i}`}
            position={[x, baseHeight + roofHeight / 2, z]}
          >
            <cylinderGeometry args={[0.06, 0.06, roofHeight, 8]} />
            <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
          </mesh>
        );
      })}

      {/* Roof crossbeam */}
      <mesh position={[0, baseHeight + roofHeight, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, baseRadius * 2.2, 8]} />
        <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
      </mesh>

      {/* Roof (small A-frame) */}
      <group position={[0, baseHeight + roofHeight + 0.3, 0]}>
        {/* Roof planks */}
        <mesh position={[0, 0.2, -0.3]} rotation={[0.6, 0, 0]}>
          <boxGeometry args={[roofRadius * 1.2, 0.05, 0.8]} />
          <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.2, 0.3]} rotation={[-0.6, 0, 0]}>
          <boxGeometry args={[roofRadius * 1.2, 0.05, 0.8]} />
          <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
        </mesh>
      </group>

      {/* Rope wheel/crank */}
      <mesh position={[baseRadius * 1.1, baseHeight + roofHeight * 0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.12, 0.08, 12]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
      </mesh>

      {/* Crank handle */}
      <mesh position={[baseRadius * 1.2, baseHeight + roofHeight * 0.6, 0.15]}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
        <meshStandardMaterial color={0x2a2a2a} roughness={0.6} metalness={0.5} />
      </mesh>

      {/* Rope */}
      <mesh position={[0, baseHeight + roofHeight * 0.4, 0]}>
        <cylinderGeometry args={[0.015, 0.015, ropeLength, 6]} />
        <meshStandardMaterial color={0x8b7355} roughness={0.95} />
      </mesh>

      {/* Bucket */}
      <group ref={bucketRef} position={[0, baseHeight + roofHeight * 0.4 - ropeLength / 2 - bucketRadius, 0]}>
        {/* Bucket body */}
        <mesh>
          <cylinderGeometry args={[bucketRadius, bucketRadius * 0.8, bucketRadius * 1.5, 8]} />
          <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
        </mesh>

        {/* Bucket bands */}
        {[-0.4, 0.4].map((y) => (
          <mesh key={`bband-${y}`} position={[0, y * bucketRadius, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[bucketRadius * 0.95, 0.01, 6, 12]} />
            <meshStandardMaterial color={0x3a3a3a} roughness={0.6} metalness={0.5} />
          </mesh>
        ))}

        {/* Handle */}
        <mesh position={[0, bucketRadius * 0.8, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[bucketRadius * 0.6, 0.015, 6, 12, Math.PI]} />
          <meshStandardMaterial color={0x3a3a3a} roughness={0.6} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

// =============================================================================
// Fence Component
// =============================================================================

/**
 * Fence - Wooden fence sections
 */
export function Fence({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  sections = 3,
}: FenceProps): JSX.Element {
  const { postHeight, postRadius, railHeight, railLength, spacing } = PROPS_CONFIG.fence;

  const totalLength = sections * railLength;
  const postsPerSection = Math.ceil(railLength / spacing);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Generate fence sections */}
      {Array.from({ length: sections }).map((_, sectionIndex) => {
        const sectionX = sectionIndex * railLength - totalLength / 2 + railLength / 2;

        return (
          <group key={`section-${sectionIndex}`} position={[sectionX, 0, 0]}>
            {/* Posts for this section */}
            {Array.from({ length: postsPerSection + 1 }).map((_, postIndex) => {
              // Skip posts that would overlap with next section (except last section)
              if (postIndex === postsPerSection && sectionIndex < sections - 1) return null;

              const postX = postIndex * spacing - railLength / 2;
              return (
                <mesh
                  key={`post-${postIndex}`}
                  position={[postX, postHeight / 2, 0]}
                >
                  <cylinderGeometry args={[postRadius, postRadius * 1.2, postHeight, 6]} />
                  <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
                </mesh>
              );
            })}

            {/* Top rail */}
            <mesh position={[0, postHeight * 0.85, 0]}>
              <boxGeometry args={[railLength, railHeight, railHeight]} />
              <meshStandardMaterial color={0x6b5b4a} roughness={0.9} />
            </mesh>

            {/* Middle rail */}
            <mesh position={[0, postHeight * 0.5, 0]}>
              <boxGeometry args={[railLength, railHeight, railHeight]} />
              <meshStandardMaterial color={0x6b5b4a} roughness={0.9} />
            </mesh>

            {/* Bottom rail */}
            <mesh position={[0, postHeight * 0.2, 0]}>
              <boxGeometry args={[railLength, railHeight, railHeight]} />
              <meshStandardMaterial color={0x6b5b4a} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// =============================================================================
// Signpost Component
// =============================================================================

/**
 * Signpost - Wooden directional sign
 */
export function Signpost({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  signs = [
    { text: "", direction: 0.3 },
    { text: "", direction: -0.4 },
  ],
}: SignpostProps): JSX.Element {
  const { postHeight, postRadius, signWidth, signHeight, signDepth } = PROPS_CONFIG.signpost;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Main post */}
      <mesh position={[0, postHeight / 2, 0]}>
        <cylinderGeometry args={[postRadius, postRadius * 1.3, postHeight, 8]} />
        <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
      </mesh>

      {/* Post cap */}
      <mesh position={[0, postHeight + 0.05, 0]}>
        <coneGeometry args={[postRadius * 1.5, 0.15, 8]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
      </mesh>

      {/* Sign boards */}
      {signs.map((sign, i) => {
        const yPos = postHeight - 0.2 - i * 0.35;
        return (
          <group
            key={`sign-${i}`}
            position={[signWidth / 2 + postRadius, yPos, 0]}
            rotation={[0, sign.direction, 0]}
          >
            {/* Sign board */}
            <mesh>
              <boxGeometry args={[signWidth, signHeight, signDepth]} />
              <meshStandardMaterial color={0x6b5b4a} roughness={0.9} />
            </mesh>

            {/* Pointed end */}
            <mesh position={[signWidth / 2 + 0.08, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[signHeight / 2, 0.15, 4]} />
              <meshStandardMaterial color={0x6b5b4a} roughness={0.9} />
            </mesh>

            {/* Border detail */}
            <mesh position={[0, 0, signDepth / 2 + 0.005]}>
              <planeGeometry args={[signWidth * 0.9, signHeight * 0.7]} />
              <meshStandardMaterial color={0x8b7355} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// =============================================================================
// HayBale Component
// =============================================================================

/**
 * HayBale - Stacked hay bales
 */
export function HayBale({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const { baleWidth, baleHeight, baleDepth } = PROPS_CONFIG.hay;

  // Stack configuration: 2 bales base, 1 on top
  const baleData: Array<{ pos: [number, number, number]; rot: number }> = [
    { pos: [0, baleHeight / 2, 0], rot: 0 },
    { pos: [baleWidth * 1.1, baleHeight / 2, 0], rot: 0.1 },
    { pos: [baleWidth * 0.55, baleHeight * 1.5, 0], rot: -0.05 },
  ];

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {baleData.map((bale, i) => (
        <group key={`bale-${i}`} position={bale.pos} rotation={[0, bale.rot, 0]}>
          {/* Main bale body */}
          <mesh>
            <boxGeometry args={[baleWidth, baleHeight, baleDepth]} />
            <meshStandardMaterial color={0xc4a84a} roughness={0.95} />
          </mesh>

          {/* Binding twine */}
          {[-0.25, 0.25].map((x) => (
            <mesh key={`twine-${x}`} position={[x * baleWidth, 0, 0]}>
              <boxGeometry args={[0.02, baleHeight + 0.02, baleDepth + 0.02]} />
              <meshStandardMaterial color={0x8b7355} roughness={0.9} />
            </mesh>
          ))}

          {/* Straw texture lines (front) */}
          {[-0.3, -0.1, 0.1, 0.3].map((y) => (
            <mesh key={`straw-${y}`} position={[0, y * baleHeight, baleDepth / 2 + 0.005]}>
              <planeGeometry args={[baleWidth * 0.9, 0.03]} />
              <meshStandardMaterial color={0xa89040} roughness={0.95} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Loose straw on ground */}
      {Array.from({ length: 8 }).map((_, i) => {
        const x = (Math.random() - 0.5) * baleWidth * 2.5;
        const z = (Math.random() - 0.5) * baleDepth * 2;
        const rotY = Math.random() * Math.PI;
        return (
          <mesh
            key={`loose-${i}`}
            position={[x, 0.01, z]}
            rotation={[-Math.PI / 2, rotY, 0]}
          >
            <planeGeometry args={[0.15, 0.02]} />
            <meshStandardMaterial
              color={0xb8984a}
              side={THREE.DoubleSide}
              roughness={0.95}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// =============================================================================
// WeaponRack Component
// =============================================================================

/**
 * WeaponRack - Medieval weapon display rack
 */
export function WeaponRack({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PropBaseProps): JSX.Element {
  const { frameWidth, frameHeight, frameDepth, weaponCount } = PROPS_CONFIG.weaponRack;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Back panel */}
      <mesh position={[0, frameHeight / 2, -frameDepth / 2]}>
        <boxGeometry args={[frameWidth, frameHeight, 0.05]} />
        <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
      </mesh>

      {/* Side supports */}
      {[-1, 1].map((side) => (
        <mesh
          key={`side-${side}`}
          position={[(side * frameWidth) / 2, frameHeight / 2, 0]}
        >
          <boxGeometry args={[0.08, frameHeight, frameDepth]} />
          <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
        </mesh>
      ))}

      {/* Top crossbar */}
      <mesh position={[0, frameHeight, 0]}>
        <boxGeometry args={[frameWidth, 0.08, frameDepth]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
      </mesh>

      {/* Weapon holders (horizontal bars) */}
      {[0.3, 0.7].map((yRatio) => (
        <mesh key={`holder-${yRatio}`} position={[0, frameHeight * yRatio, frameDepth / 4]}>
          <boxGeometry args={[frameWidth * 0.9, 0.06, 0.06]} />
          <meshStandardMaterial color={0x3a3a3a} roughness={0.6} metalness={0.5} />
        </mesh>
      ))}

      {/* Weapons */}
      {Array.from({ length: weaponCount }).map((_, i) => {
        const x = (i - (weaponCount - 1) / 2) * (frameWidth / (weaponCount + 1));
        const weaponType = i % 3; // 0: sword, 1: axe, 2: mace

        return (
          <group key={`weapon-${i}`} position={[x, frameHeight * 0.5, frameDepth / 4 + 0.05]}>
            {weaponType === 0 && (
              // Sword
              <>
                {/* Blade */}
                <mesh position={[0, 0.3, 0]}>
                  <boxGeometry args={[0.04, 0.6, 0.01]} />
                  <meshStandardMaterial color={0xaaaaaa} roughness={0.3} metalness={0.8} />
                </mesh>
                {/* Guard */}
                <mesh position={[0, 0, 0]}>
                  <boxGeometry args={[0.15, 0.03, 0.03]} />
                  <meshStandardMaterial color={0x4a3a2a} roughness={0.7} metalness={0.5} />
                </mesh>
                {/* Handle */}
                <mesh position={[0, -0.15, 0]}>
                  <cylinderGeometry args={[0.02, 0.02, 0.2, 6]} />
                  <meshStandardMaterial color={0x3a2a1a} roughness={0.9} />
                </mesh>
                {/* Pommel */}
                <mesh position={[0, -0.27, 0]}>
                  <sphereGeometry args={[0.03, 6, 6]} />
                  <meshStandardMaterial color={0x4a3a2a} roughness={0.7} metalness={0.5} />
                </mesh>
              </>
            )}

            {weaponType === 1 && (
              // Axe
              <>
                {/* Handle */}
                <mesh position={[0, 0, 0]}>
                  <cylinderGeometry args={[0.025, 0.03, 0.8, 6]} />
                  <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
                </mesh>
                {/* Axe head */}
                <mesh position={[0.08, 0.3, 0]} rotation={[0, 0, -0.2]}>
                  <boxGeometry args={[0.15, 0.2, 0.02]} />
                  <meshStandardMaterial color={0x666666} roughness={0.4} metalness={0.7} />
                </mesh>
              </>
            )}

            {weaponType === 2 && (
              // Mace
              <>
                {/* Handle */}
                <mesh position={[0, -0.1, 0]}>
                  <cylinderGeometry args={[0.025, 0.03, 0.5, 6]} />
                  <meshStandardMaterial color={0x5a4a3a} roughness={0.9} />
                </mesh>
                {/* Mace head */}
                <mesh position={[0, 0.25, 0]}>
                  <dodecahedronGeometry args={[0.08, 0]} />
                  <meshStandardMaterial color={0x555555} roughness={0.4} metalness={0.7} />
                </mesh>
                {/* Spikes */}
                {[0, 1, 2, 3].map((spike) => {
                  const angle = (spike / 4) * Math.PI * 2;
                  return (
                    <mesh
                      key={`spike-${spike}`}
                      position={[Math.cos(angle) * 0.1, 0.25, Math.sin(angle) * 0.1]}
                      rotation={[0, 0, -angle - Math.PI / 2]}
                    >
                      <coneGeometry args={[0.02, 0.06, 4]} />
                      <meshStandardMaterial color={0x555555} roughness={0.4} metalness={0.7} />
                    </mesh>
                  );
                })}
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

// =============================================================================
// Main MedievalProps Manager Component
// =============================================================================

export interface MedievalPropsProps {
  /** Array of prop placements */
  placements: PropPlacement[];
}

/**
 * MedievalProps - Renders multiple medieval props from placement configuration
 *
 * @example
 * ```tsx
 * const placements: PropPlacement[] = [
 *   { type: 'brazier', position: [5, 0, 5] },
 *   { type: 'banner', position: [-5, 0, 5], props: { color: 0x2222cc } },
 *   { type: 'cart', position: [0, 0, 10], rotation: [0, Math.PI / 4, 0] },
 * ];
 *
 * <MedievalProps placements={placements} />
 * ```
 */
export function MedievalProps({ placements }: MedievalPropsProps): JSX.Element {
  return (
    <group name="medieval-props">
      {placements.map((placement, index) => {
        const { type, position, rotation = [0, 0, 0], scale = 1, props = {} } = placement;
        const key = `prop-${type}-${index}`;

        switch (type) {
          case "brazier":
            return (
              <Brazier
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
                {...(props as Partial<BrazierProps>)}
              />
            );
          case "banner":
            return (
              <Banner
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
                {...(props as Partial<BannerProps>)}
              />
            );
          case "cart":
            return (
              <Cart
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          case "barrels":
            return (
              <Barrels
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          case "crates":
            return (
              <Crates
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          case "well":
            return (
              <Well
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          case "fence":
            return (
              <Fence
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
                {...(props as Partial<FenceProps>)}
              />
            );
          case "signpost":
            return (
              <Signpost
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
                {...(props as Partial<SignpostProps>)}
              />
            );
          case "hay":
            return (
              <HayBale
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          case "weaponRack":
            return (
              <WeaponRack
                key={key}
                position={position}
                rotation={rotation}
                scale={scale}
              />
            );
          default:
            console.warn(`Unknown prop type: ${type}`);
            return null;
        }
      })}
    </group>
  );
}

export default MedievalProps;
