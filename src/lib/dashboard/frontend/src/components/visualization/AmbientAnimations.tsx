/**
 * AmbientAnimations Component
 *
 * Animated environmental elements for the medieval village:
 * - Rotating windmill with cloth sails
 * - Chimney smoke particles rising from cottages
 * - Swaying trees and vegetation
 * - Flickering torch flames
 * - Flying birds in the distance
 *
 * @module components/visualization/AmbientAnimations
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

export const AMBIENT_CONFIG = {
  windmill: {
    bladeCount: 4,
    bladeLength: 3,
    rotationSpeed: 0.3,
    towerHeight: 6,
    towerRadius: 0.8,
  },
  smoke: {
    particleCount: 30,
    riseSpeed: 0.8,
    spreadSpeed: 0.2,
    maxHeight: 6,
    particleSize: 0.15,
    emitInterval: 0.1,
  },
  birds: {
    flockSize: 8,
    orbitRadius: 50,
    orbitSpeed: 0.1,
    flapSpeed: 5,
  },
  torch: {
    flameParticles: 15,
    flickerSpeed: 10,
    flameHeight: 0.4,
  },
} as const;

// =============================================================================
// Windmill Component
// =============================================================================

export interface WindmillProps {
  /** Position of the windmill */
  position?: [number, number, number];
  /** Rotation speed multiplier */
  speed?: number;
}

/**
 * Windmill - Animated windmill with rotating blades
 */
export function Windmill({
  position = [0, 0, 0],
  speed = 1,
}: WindmillProps): JSX.Element {
  const bladesRef = useRef<THREE.Group>(null);
  const { bladeCount, bladeLength, rotationSpeed, towerHeight, towerRadius } =
    AMBIENT_CONFIG.windmill;

  // Animate blade rotation
  useFrame((state) => {
    if (!bladesRef.current) return;
    bladesRef.current.rotation.z += rotationSpeed * speed * 0.01;
  });

  return (
    <group position={position}>
      {/* Tower base (tapered cylinder) */}
      <mesh position={[0, towerHeight / 2, 0]}>
        <cylinderGeometry
          args={[towerRadius * 0.7, towerRadius, towerHeight, 8]}
        />
        <meshStandardMaterial color={0x8b7355} roughness={0.9} />
      </mesh>

      {/* Tower cap (cone) */}
      <mesh position={[0, towerHeight + 0.5, 0]}>
        <coneGeometry args={[towerRadius * 0.9, 1, 8]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.8} />
      </mesh>

      {/* Blade axle */}
      <mesh position={[0, towerHeight * 0.85, towerRadius * 0.7]}>
        <cylinderGeometry args={[0.15, 0.15, 0.5, 8]} />
        <meshStandardMaterial color={0x3a3a3a} roughness={0.7} metalness={0.3} />
      </mesh>

      {/* Rotating blades */}
      <group
        ref={bladesRef}
        position={[0, towerHeight * 0.85, towerRadius * 0.7 + 0.3]}
      >
        {Array.from({ length: bladeCount }).map((_, i) => {
          const angle = (i / bladeCount) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, 0, angle]}>
              {/* Blade frame */}
              <mesh position={[0, bladeLength / 2 + 0.2, 0]}>
                <boxGeometry args={[0.1, bladeLength, 0.05]} />
                <meshStandardMaterial color={0x5a4a3a} roughness={0.8} />
              </mesh>

              {/* Blade sail (cloth) */}
              <mesh position={[0.15, bladeLength / 2 + 0.3, 0]}>
                <planeGeometry args={[0.6, bladeLength * 0.8]} />
                <meshStandardMaterial
                  color={0xe8dcc8}
                  side={THREE.DoubleSide}
                  roughness={0.9}
                />
              </mesh>

              {/* Cross supports */}
              <mesh position={[0, bladeLength * 0.3, 0]}>
                <boxGeometry args={[0.6, 0.05, 0.05]} />
                <meshStandardMaterial color={0x5a4a3a} roughness={0.8} />
              </mesh>
              <mesh position={[0, bladeLength * 0.7, 0]}>
                <boxGeometry args={[0.6, 0.05, 0.05]} />
                <meshStandardMaterial color={0x5a4a3a} roughness={0.8} />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Door */}
      <mesh position={[0, 1, towerRadius]}>
        <planeGeometry args={[0.6, 1.5]} />
        <meshStandardMaterial color={0x3a2a1a} roughness={0.9} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Chimney Smoke Component
// =============================================================================

interface SmokeParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  size: number;
  opacity: number;
}

export interface ChimneySmokeProps {
  /** Position of the chimney top */
  position: [number, number, number];
  /** Smoke intensity (0-1) */
  intensity?: number;
  /** Smoke color */
  color?: number;
}

/**
 * ChimneySmoke - Rising smoke particles from a chimney
 */
export function ChimneySmoke({
  position,
  intensity = 1,
  color = 0x666666,
}: ChimneySmokeProps): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<SmokeParticle[]>([]);
  const lastEmitRef = useRef(0);

  const { particleCount, riseSpeed, spreadSpeed, maxHeight, particleSize, emitInterval } =
    AMBIENT_CONFIG.smoke;

  const geometry = useMemo(() => new THREE.SphereGeometry(0.1, 8, 8), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [color]
  );

  // Create new smoke particle
  const emitParticle = (): SmokeParticle => ({
    position: new THREE.Vector3(
      position[0] + (Math.random() - 0.5) * 0.2,
      position[1],
      position[2] + (Math.random() - 0.5) * 0.2
    ),
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * spreadSpeed,
      riseSpeed * (0.8 + Math.random() * 0.4),
      (Math.random() - 0.5) * spreadSpeed
    ),
    life: 1,
    size: particleSize * (0.8 + Math.random() * 0.4),
    opacity: 0.5,
  });

  // Animation
  useFrame((state, delta) => {
    if (!meshRef.current || intensity < 0.01) return;

    const particles = particlesRef.current;
    const dummy = new THREE.Object3D();
    const time = state.clock.elapsedTime;

    // Emit new particles
    if (time - lastEmitRef.current > emitInterval / intensity) {
      lastEmitRef.current = time;
      if (particles.length < particleCount) {
        particles.push(emitParticle());
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      // Update position with wind influence
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      p.position.x += Math.sin(time + i) * delta * 0.1;

      // Slow down rise over time
      p.velocity.y *= 0.995;

      // Decrease life
      const heightProgress =
        (p.position.y - position[1]) / maxHeight;
      p.life = Math.max(0, 1 - heightProgress);

      // Remove dead particles
      if (p.life <= 0 || p.position.y > position[1] + maxHeight) {
        particles.splice(i, 1);
        continue;
      }

      // Update instance
      dummy.position.copy(p.position);
      dummy.scale.setScalar(p.size * (1 + (1 - p.life) * 2)); // Grow as it rises
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    // Hide unused instances
    for (let i = particles.length; i < particleCount; i++) {
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (intensity < 0.01) return <></>;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, particleCount]}
      frustumCulled={false}
    />
  );
}

// =============================================================================
// Flying Birds Component
// =============================================================================

export interface FlyingBirdsProps {
  /** Center position for bird orbit */
  center?: [number, number, number];
  /** Orbit radius */
  radius?: number;
}

/**
 * FlyingBirds - Flock of birds circling in the distance
 */
export function FlyingBirds({
  center = [0, 30, 0],
  radius = AMBIENT_CONFIG.birds.orbitRadius,
}: FlyingBirdsProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const wingsRef = useRef<THREE.Group[]>([]);

  const { flockSize, orbitSpeed, flapSpeed } = AMBIENT_CONFIG.birds;

  // Bird positions within flock
  const birdOffsets = useMemo(() => {
    return Array.from({ length: flockSize }, (_, i) => ({
      angleOffset: (i / flockSize) * Math.PI * 0.3 + (Math.random() - 0.5) * 0.2,
      heightOffset: (Math.random() - 0.5) * 5,
      radiusOffset: (Math.random() - 0.5) * 10,
      flapOffset: Math.random() * Math.PI * 2,
      scale: 0.8 + Math.random() * 0.4,
    }));
  }, [flockSize]);

  // Animation
  useFrame((state) => {
    if (!groupRef.current) return;

    const time = state.clock.elapsedTime;

    // Orbit the flock
    groupRef.current.rotation.y = time * orbitSpeed;

    // Flap wings
    wingsRef.current.forEach((wingGroup, i) => {
      if (!wingGroup) return;
      const flapAngle =
        Math.sin(time * flapSpeed + birdOffsets[i].flapOffset) * 0.5;
      // Left and right wings
      if (wingGroup.children[0]) {
        wingGroup.children[0].rotation.z = flapAngle;
      }
      if (wingGroup.children[1]) {
        wingGroup.children[1].rotation.z = -flapAngle;
      }
    });
  });

  return (
    <group ref={groupRef} position={center}>
      {birdOffsets.map((bird, i) => {
        const x = Math.cos(bird.angleOffset) * (radius + bird.radiusOffset);
        const z = Math.sin(bird.angleOffset) * (radius + bird.radiusOffset);

        return (
          <group
            key={i}
            position={[x, bird.heightOffset, z]}
            scale={bird.scale}
            ref={(el) => {
              if (el) {
                // Store the wings group for animation
                wingsRef.current[i] = el.children[0] as THREE.Group;
              }
            }}
          >
            {/* Wings container */}
            <group>
              {/* Left wing */}
              <mesh position={[-0.3, 0, 0]} rotation={[0, 0, 0]}>
                <planeGeometry args={[0.5, 0.15]} />
                <meshBasicMaterial color={0x1a1a1a} side={THREE.DoubleSide} />
              </mesh>

              {/* Right wing */}
              <mesh position={[0.3, 0, 0]} rotation={[0, 0, 0]}>
                <planeGeometry args={[0.5, 0.15]} />
                <meshBasicMaterial color={0x1a1a1a} side={THREE.DoubleSide} />
              </mesh>
            </group>

            {/* Body */}
            <mesh>
              <sphereGeometry args={[0.1, 6, 6]} />
              <meshBasicMaterial color={0x1a1a1a} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// =============================================================================
// Torch Flame Component
// =============================================================================

export interface TorchFlameProps {
  /** Position of the torch */
  position: [number, number, number];
  /** Flame intensity */
  intensity?: number;
}

/**
 * TorchFlame - Animated flickering flame effect
 */
export function TorchFlame({
  position,
  intensity = 1,
}: TorchFlameProps): JSX.Element {
  const flameRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const { flameParticles, flickerSpeed, flameHeight } = AMBIENT_CONFIG.torch;

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Animation
  useFrame((state) => {
    if (!flameRef.current || !particlesRef.current || !lightRef.current) return;

    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();

    // Flicker the main flame
    const flicker = 0.8 + Math.sin(time * flickerSpeed) * 0.2;
    flameRef.current.scale.setScalar(flicker * intensity);

    // Flicker the light
    lightRef.current.intensity =
      1.5 * intensity * (0.8 + Math.sin(time * flickerSpeed * 1.3) * 0.2);

    // Animate flame particles
    for (let i = 0; i < flameParticles; i++) {
      const angle = (i / flameParticles) * Math.PI * 2 + time * 2;
      const height = (i / flameParticles) * flameHeight;
      const radius = (1 - i / flameParticles) * 0.1;

      const flickerOffset =
        Math.sin(time * flickerSpeed + i) * 0.02;

      dummy.position.set(
        position[0] + Math.cos(angle) * radius + flickerOffset,
        position[1] + height,
        position[2] + Math.sin(angle) * radius + flickerOffset
      );

      const scale = (1 - i / flameParticles) * 0.8 * intensity;
      dummy.scale.setScalar(scale);

      dummy.updateMatrix();
      particlesRef.current.setMatrixAt(i, dummy.matrix);
    }

    particlesRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={position}>
      {/* Main flame core */}
      <mesh ref={flameRef}>
        <coneGeometry args={[0.08, 0.2, 8]} />
        <meshBasicMaterial
          color={0xffaa00}
          transparent
          opacity={0.9 * intensity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Flame particles */}
      <instancedMesh
        ref={particlesRef}
        args={[geometry, material, flameParticles]}
        frustumCulled={false}
      />

      {/* Flame glow */}
      <mesh>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial
          color={0xff8800}
          transparent
          opacity={0.3 * intensity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Point light */}
      <pointLight
        ref={lightRef}
        color={0xff6600}
        intensity={1.5 * intensity}
        distance={5}
        decay={2}
      />
    </group>
  );
}

// =============================================================================
// Swaying Tree Component
// =============================================================================

export interface SwayingTreeProps {
  /** Position of the tree */
  position: [number, number, number];
  /** Tree height */
  height?: number;
  /** Sway amount */
  swayAmount?: number;
}

/**
 * SwayingTree - Tree with gentle swaying animation
 */
export function SwayingTree({
  position,
  height = 4,
  swayAmount = 0.1,
}: SwayingTreeProps): JSX.Element {
  const crownRef = useRef<THREE.Group>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  // Sway animation
  useFrame((state) => {
    if (!crownRef.current) return;
    const time = state.clock.elapsedTime;
    crownRef.current.rotation.x = Math.sin(time * 0.5 + timeOffset) * swayAmount;
    crownRef.current.rotation.z = Math.cos(time * 0.3 + timeOffset) * swayAmount * 0.5;
  });

  return (
    <group position={position}>
      {/* Trunk */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.1, 0.2, height, 8]} />
        <meshStandardMaterial color={0x4a3a2a} roughness={0.9} />
      </mesh>

      {/* Crown (multiple spheres for foliage) */}
      <group ref={crownRef} position={[0, height, 0]}>
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[1.2, 8, 8]} />
          <meshStandardMaterial color={0x2d5a27} roughness={0.9} />
        </mesh>
        <mesh position={[0.5, 0.3, 0.3]}>
          <sphereGeometry args={[0.8, 8, 8]} />
          <meshStandardMaterial color={0x3a6a32} roughness={0.9} />
        </mesh>
        <mesh position={[-0.4, 0.2, -0.3]}>
          <sphereGeometry args={[0.7, 8, 8]} />
          <meshStandardMaterial color={0x2a4a22} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

// =============================================================================
// Main Ambient Animations Manager
// =============================================================================

export interface AmbientAnimationsProps {
  /** Show windmill */
  showWindmill?: boolean;
  /** Windmill position */
  windmillPosition?: [number, number, number];
  /** Chimney positions for smoke */
  chimneyPositions?: [number, number, number][];
  /** Show flying birds */
  showBirds?: boolean;
  /** Show trees */
  showTrees?: boolean;
  /** Tree positions */
  treePositions?: [number, number, number][];
}

/**
 * AmbientAnimations - Manages all ambient animated elements
 */
export function AmbientAnimations({
  showWindmill = true,
  windmillPosition = [-20, 0, -15],
  chimneyPositions = [],
  showBirds = true,
  showTrees = true,
  treePositions = [],
}: AmbientAnimationsProps): JSX.Element {
  return (
    <group name="ambient-animations">
      {/* Windmill */}
      {showWindmill && <Windmill position={windmillPosition} />}

      {/* Chimney smoke */}
      {chimneyPositions.map((pos, i) => (
        <ChimneySmoke key={`smoke-${i}`} position={pos} />
      ))}

      {/* Flying birds */}
      {showBirds && <FlyingBirds />}

      {/* Trees */}
      {showTrees &&
        treePositions.map((pos, i) => (
          <SwayingTree key={`tree-${i}`} position={pos} />
        ))}
    </group>
  );
}

export default AmbientAnimations;
