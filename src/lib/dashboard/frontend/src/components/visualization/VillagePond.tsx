/**
 * VillagePond Component
 *
 * Creates a beautiful reflective water feature for the medieval village:
 * - Animated water surface with waves
 * - Reflection of the sky and surroundings
 * - Lily pads and reeds decoration
 * - Ripple effects from agents walking near
 * - Ambient water particles (mist)
 *
 * @module components/visualization/VillagePond
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree, extend } from "@react-three/fiber";
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";

// Extend Three.js with Water
extend({ Water });

// =============================================================================
// Configuration
// =============================================================================

export const POND_CONFIG = {
  /** Default pond size */
  size: 8,
  /** Water color tint */
  waterColor: 0x001e0f,
  /** Sun color for reflection */
  sunColor: 0xffffff,
  /** Wave distortion scale */
  distortionScale: 3.7,
  /** Wave speed */
  flowSpeed: 0.03,
  /** Number of lily pads */
  lilyPadCount: 12,
  /** Number of reeds */
  reedCount: 20,
  /** Mist particle count */
  mistParticleCount: 50,
} as const;

// =============================================================================
// Custom Water Shader Material
// =============================================================================

/**
 * Creates a simple animated water material
 * (Fallback if Water shader has issues)
 */
function createWaterMaterial(): THREE.ShaderMaterial {
  const vertexShader = `
    uniform float time;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Simple wave animation
      float wave1 = sin(pos.x * 2.0 + time) * 0.05;
      float wave2 = sin(pos.y * 3.0 + time * 1.3) * 0.03;
      pos.z += wave1 + wave2;

      vec4 worldPos = modelMatrix * vec4(pos, 1.0);
      vWorldPosition = worldPos.xyz;

      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    uniform float time;
    uniform vec3 waterColor;
    uniform vec3 skyColor;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      // Animated UV distortion
      vec2 distortedUv = vUv;
      distortedUv.x += sin(vUv.y * 10.0 + time) * 0.02;
      distortedUv.y += cos(vUv.x * 10.0 + time * 0.8) * 0.02;

      // Fresnel-like effect for reflection
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 2.0);

      // Mix water color with sky reflection
      vec3 color = mix(waterColor, skyColor, fresnel * 0.5);

      // Add subtle wave highlights
      float highlight = sin(distortedUv.x * 20.0 + time * 2.0) *
                        sin(distortedUv.y * 20.0 + time * 1.5) * 0.1;
      color += vec3(highlight);

      // Transparency
      float alpha = 0.8 + fresnel * 0.2;

      gl_FragColor = vec4(color, alpha);
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      waterColor: { value: new THREE.Color(0x001e0f) },
      skyColor: { value: new THREE.Color(0x87ceeb) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// =============================================================================
// Lily Pad Component
// =============================================================================

interface LilyPadProps {
  position: [number, number, number];
  scale?: number;
  hasFlower?: boolean;
}

/**
 * LilyPad - Decorative lily pad on water surface
 */
function LilyPad({
  position,
  scale = 1,
  hasFlower = false,
}: LilyPadProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  // Gentle bobbing animation
  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;
    groupRef.current.position.y =
      position[1] + Math.sin(time + timeOffset) * 0.02;
    groupRef.current.rotation.z = Math.sin(time * 0.5 + timeOffset) * 0.05;
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {/* Lily pad leaf */}
      <mesh rotation={[-Math.PI / 2, 0, Math.random() * Math.PI * 2]}>
        <circleGeometry args={[0.4, 32]} />
        <meshStandardMaterial
          color={0x2d5a27}
          roughness={0.8}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* V-notch cutout (visual only) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.15, 0.01, 0]}>
        <planeGeometry args={[0.15, 0.4]} />
        <meshBasicMaterial color={0x001e0f} side={THREE.DoubleSide} />
      </mesh>

      {/* Optional flower */}
      {hasFlower && (
        <group position={[0, 0.1, 0]}>
          {/* Flower petals */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh
              key={i}
              position={[Math.cos((i / 6) * Math.PI * 2) * 0.08, 0, Math.sin((i / 6) * Math.PI * 2) * 0.08]}
              rotation={[-Math.PI / 4, 0, (i / 6) * Math.PI * 2]}
            >
              <planeGeometry args={[0.1, 0.15]} />
              <meshStandardMaterial
                color={0xffb6c1}
                side={THREE.DoubleSide}
                roughness={0.7}
              />
            </mesh>
          ))}
          {/* Flower center */}
          <mesh>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color={0xffff00} roughness={0.5} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// =============================================================================
// Reed Component
// =============================================================================

interface ReedProps {
  position: [number, number, number];
  height?: number;
}

/**
 * Reed - Tall grass/cattail decoration
 */
function Reed({ position, height = 1.5 }: ReedProps): JSX.Element {
  const reedRef = useRef<THREE.Group>(null);
  const timeOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  // Swaying animation
  useFrame((state) => {
    if (!reedRef.current) return;
    const time = state.clock.elapsedTime;
    reedRef.current.rotation.x = Math.sin(time * 0.8 + timeOffset) * 0.1;
    reedRef.current.rotation.z = Math.cos(time * 0.6 + timeOffset) * 0.08;
  });

  const segments = 5;
  const segmentHeight = height / segments;

  return (
    <group ref={reedRef} position={position}>
      {/* Reed stalk segments */}
      {Array.from({ length: segments }).map((_, i) => (
        <mesh key={i} position={[0, i * segmentHeight + segmentHeight / 2, 0]}>
          <cylinderGeometry
            args={[0.02 - i * 0.003, 0.02 - (i - 1) * 0.003, segmentHeight, 6]}
          />
          <meshStandardMaterial
            color={0x4a6a3a}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
      ))}

      {/* Cattail head */}
      <mesh position={[0, height - 0.1, 0]}>
        <capsuleGeometry args={[0.03, 0.15, 4, 8]} />
        <meshStandardMaterial color={0x3a2a1a} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Water Mist Particles
// =============================================================================

interface WaterMistProps {
  position: [number, number, number];
  radius: number;
}

/**
 * WaterMist - Subtle mist particles above water surface
 */
function WaterMist({ position, radius }: WaterMistProps): JSX.Element {
  const particlesRef = useRef<THREE.Points>(null);

  const { positions, velocities } = useMemo(() => {
    const { mistParticleCount } = POND_CONFIG;
    const pos = new Float32Array(mistParticleCount * 3);
    const vel = new Float32Array(mistParticleCount * 3);

    for (let i = 0; i < mistParticleCount; i++) {
      // Random position within cylinder above pond
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      pos[i * 3] = position[0] + Math.cos(angle) * r;
      pos[i * 3 + 1] = position[1] + Math.random() * 1.5;
      pos[i * 3 + 2] = position[2] + Math.sin(angle) * r;

      // Slow drift velocity
      vel[i * 3] = (Math.random() - 0.5) * 0.1;
      vel[i * 3 + 1] = Math.random() * 0.05 + 0.01;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }

    return { positions: pos, velocities: vel };
  }, [position, radius]);

  // Animate mist
  useFrame((state, delta) => {
    if (!particlesRef.current) return;

    const { mistParticleCount } = POND_CONFIG;

    for (let i = 0; i < mistParticleCount; i++) {
      // Drift upward
      positions[i * 3] += velocities[i * 3] * delta;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;

      // Reset when too high
      if (positions[i * 3 + 1] > position[1] + 2) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius * 0.8;
        positions[i * 3] = position[0] + Math.cos(angle) * r;
        positions[i * 3 + 1] = position[1];
        positions[i * 3 + 2] = position[2] + Math.sin(angle) * r;
      }
    }

    const posAttr = particlesRef.current.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={0xffffff}
        size={0.1}
        transparent
        opacity={0.15}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// =============================================================================
// Main Village Pond Component
// =============================================================================

export interface VillagePondProps {
  /** Position of the pond center */
  position?: [number, number, number];
  /** Pond size (diameter) */
  size?: number;
  /** Enable mist effect */
  showMist?: boolean;
  /** Enable lily pads */
  showLilyPads?: boolean;
  /** Enable reeds */
  showReeds?: boolean;
}

/**
 * VillagePond component
 *
 * Creates a decorative pond with animated water, lily pads, and reeds.
 *
 * @example
 * ```tsx
 * <VillagePond position={[-10, 0, 5]} size={6} />
 * ```
 */
export function VillagePond({
  position = [0, 0, 0],
  size = POND_CONFIG.size,
  showMist = true,
  showLilyPads = true,
  showReeds = true,
}: VillagePondProps): JSX.Element {
  const waterRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Generate lily pad positions
  const lilyPadPositions = useMemo(() => {
    const positions: Array<{
      pos: [number, number, number];
      scale: number;
      hasFlower: boolean;
    }> = [];

    for (let i = 0; i < POND_CONFIG.lilyPadCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.5) * (size / 2);
      positions.push({
        pos: [
          position[0] + Math.cos(angle) * r,
          position[1] + 0.01,
          position[2] + Math.sin(angle) * r,
        ],
        scale: 0.8 + Math.random() * 0.4,
        hasFlower: Math.random() > 0.7,
      });
    }

    return positions;
  }, [position, size]);

  // Generate reed positions (around edge)
  const reedPositions = useMemo(() => {
    const positions: Array<{
      pos: [number, number, number];
      height: number;
    }> = [];

    for (let i = 0; i < POND_CONFIG.reedCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = (size / 2) * (0.9 + Math.random() * 0.2);
      positions.push({
        pos: [
          position[0] + Math.cos(angle) * r,
          position[1],
          position[2] + Math.sin(angle) * r,
        ],
        height: 1 + Math.random() * 0.8,
      });
    }

    return positions;
  }, [position, size]);

  // Create water material
  useEffect(() => {
    materialRef.current = createWaterMaterial();
    if (waterRef.current) {
      waterRef.current.material = materialRef.current;
    }

    return () => {
      materialRef.current?.dispose();
    };
  }, []);

  // Animate water
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  return (
    <group name="village-pond">
      {/* Pond bed (dark bottom) */}
      <mesh
        position={[position[0], position[1] - 0.3, position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[size / 2, 64]} />
        <meshStandardMaterial
          color={0x0a1a0a}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Water surface */}
      <mesh
        ref={waterRef}
        position={[position[0], position[1], position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[size / 2, 64]} />
        {/* Material set via useEffect */}
      </mesh>

      {/* Edge stones */}
      <group position={position}>
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i / 24) * Math.PI * 2;
          const r = size / 2 + 0.1;
          const stoneSize = 0.15 + Math.random() * 0.1;
          return (
            <mesh
              key={i}
              position={[
                Math.cos(angle) * r,
                stoneSize / 2,
                Math.sin(angle) * r,
              ]}
            >
              <sphereGeometry args={[stoneSize, 6, 6]} />
              <meshStandardMaterial
                color={0x6a6a6a}
                roughness={0.9}
                metalness={0}
              />
            </mesh>
          );
        })}
      </group>

      {/* Lily pads */}
      {showLilyPads &&
        lilyPadPositions.map((lp, i) => (
          <LilyPad
            key={`lilypad-${i}`}
            position={lp.pos}
            scale={lp.scale}
            hasFlower={lp.hasFlower}
          />
        ))}

      {/* Reeds */}
      {showReeds &&
        reedPositions.map((reed, i) => (
          <Reed key={`reed-${i}`} position={reed.pos} height={reed.height} />
        ))}

      {/* Mist effect */}
      {showMist && (
        <WaterMist
          position={[position[0], position[1] + 0.1, position[2]]}
          radius={size / 2}
        />
      )}
    </group>
  );
}

export default VillagePond;
