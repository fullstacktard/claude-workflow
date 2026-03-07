/**
 * WeatherSystem Component
 *
 * Particle-based atmospheric effects for the medieval village:
 * - Fireflies that glow and float around at dusk/night
 * - Rain particles with splash effects
 * - Falling leaves in autumn mode
 * - Dust motes in sunbeams
 *
 * Performance optimized with instanced rendering and LOD.
 *
 * @module components/visualization/WeatherSystem
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

export const WEATHER_CONFIG = {
  fireflies: {
    count: 150,
    radius: 25,
    heightMin: 0.5,
    heightMax: 4,
    speed: 0.5,
    glowSize: 0.15,
    pulseSpeed: 2,
    colors: [0xffff66, 0xccff66, 0xffcc33, 0x99ff33],
  },
  rain: {
    count: 3000,
    radius: 40,
    fallSpeed: 15,
    dropLength: 0.3,
    splashCount: 50,
  },
  leaves: {
    count: 100,
    radius: 30,
    fallSpeed: 1,
    swayAmount: 2,
    colors: [0xcc6633, 0xff9933, 0xcc3300, 0xffcc00],
  },
  dust: {
    count: 200,
    radius: 15,
    floatSpeed: 0.3,
    size: 0.05,
  },
} as const;

// =============================================================================
// Fireflies Component
// =============================================================================

interface FirefliesProps {
  /** Visibility (0-1), typically based on time of day */
  visibility?: number;
  /** Center position for the firefly swarm */
  center?: [number, number, number];
}

/**
 * Fireflies - Magical glowing particles that float around
 */
export function Fireflies({
  visibility = 1,
  center = [0, 0, 0],
}: FirefliesProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);

  // Instance data
  const { positions, velocities, phases, colors } = useMemo(() => {
    const { count, radius, heightMin, heightMax, colors: colorOptions } =
      WEATHER_CONFIG.fireflies;

    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const pha = new Float32Array(count);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Random position within cylinder
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      pos[i * 3] = center[0] + Math.cos(angle) * r;
      pos[i * 3 + 1] = center[1] + heightMin + Math.random() * (heightMax - heightMin);
      pos[i * 3 + 2] = center[2] + Math.sin(angle) * r;

      // Random velocity
      vel[i * 3] = (Math.random() - 0.5) * 2;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 2;

      // Random phase for pulsing
      pha[i] = Math.random() * Math.PI * 2;

      // Random color from options
      const color = new THREE.Color(
        colorOptions[Math.floor(Math.random() * colorOptions.length)]
      );
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
    }

    return {
      positions: pos,
      velocities: vel,
      phases: pha,
      colors: col,
    };
  }, [center]);

  // Geometry and material
  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 8, 8), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(0.15, 8, 8), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffff66,
        transparent: true,
        opacity: 1,
      }),
    []
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffff33,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Animation
  useFrame((state, delta) => {
    if (!meshRef.current || !glowMeshRef.current || visibility < 0.01) return;

    const { count, radius, heightMin, heightMax, speed, pulseSpeed } =
      WEATHER_CONFIG.fireflies;
    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Update position with wandering behavior
      positions[i * 3] +=
        velocities[i * 3] * delta * speed +
        Math.sin(time + phases[i]) * delta * 0.5;
      positions[i * 3 + 1] +=
        velocities[i * 3 + 1] * delta * speed +
        Math.sin(time * 0.7 + phases[i] * 2) * delta * 0.3;
      positions[i * 3 + 2] +=
        velocities[i * 3 + 2] * delta * speed +
        Math.cos(time + phases[i]) * delta * 0.5;

      // Boundary wrapping
      const dx = positions[i * 3] - center[0];
      const dz = positions[i * 3 + 2] - center[2];
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > radius) {
        // Wrap to opposite side
        positions[i * 3] = center[0] - dx * 0.5;
        positions[i * 3 + 2] = center[2] - dz * 0.5;
      }

      // Height bounds
      if (positions[i * 3 + 1] < center[1] + heightMin) {
        positions[i * 3 + 1] = center[1] + heightMin;
        velocities[i * 3 + 1] = Math.abs(velocities[i * 3 + 1]);
      }
      if (positions[i * 3 + 1] > center[1] + heightMax) {
        positions[i * 3 + 1] = center[1] + heightMax;
        velocities[i * 3 + 1] = -Math.abs(velocities[i * 3 + 1]);
      }

      // Random direction changes
      if (Math.random() < 0.01) {
        velocities[i * 3] = (Math.random() - 0.5) * 2;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
      }

      // Pulsing glow
      const pulse = 0.5 + 0.5 * Math.sin(time * pulseSpeed + phases[i]);
      const scale = 0.5 + pulse * 0.5;

      // Update instance
      dummy.position.set(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2]
      );
      dummy.scale.setScalar(scale * visibility);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Glow is larger
      dummy.scale.setScalar(scale * 2 * visibility);
      dummy.updateMatrix();
      glowMeshRef.current.setMatrixAt(i, dummy.matrix);

      // Set color with pulse
      color.setRGB(
        colors[i * 3] * pulse,
        colors[i * 3 + 1] * pulse,
        colors[i * 3 + 2] * pulse
      );
      meshRef.current.setColorAt(i, color);
      glowMeshRef.current.setColorAt(i, color);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor)
      meshRef.current.instanceColor.needsUpdate = true;
    if (glowMeshRef.current.instanceColor)
      glowMeshRef.current.instanceColor.needsUpdate = true;
  });

  if (visibility < 0.01) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, WEATHER_CONFIG.fireflies.count]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[glowGeometry, glowMaterial, WEATHER_CONFIG.fireflies.count]}
        frustumCulled={false}
      />
    </group>
  );
}

// =============================================================================
// Rain Component
// =============================================================================

interface RainProps {
  /** Rain intensity (0-1) */
  intensity?: number;
}

/**
 * Rain - Falling rain particles with subtle visual effect
 */
export function Rain({ intensity = 1 }: RainProps): JSX.Element | null {
  const linesRef = useRef<THREE.LineSegments>(null);
  const positionsRef = useRef<Float32Array | null>(null);

  // Initialize rain drop positions
  const { geometry, positions: initialPositions } = useMemo(() => {
    const { count, radius, dropLength } = WEATHER_CONFIG.rain;

    // Each rain drop is a line segment (2 points)
    const pos = new Float32Array(count * 6);
    positionsRef.current = pos;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = Math.random() * 30;

      // Start point
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = z;

      // End point (below start)
      pos[i * 6 + 3] = x;
      pos[i * 6 + 4] = y - dropLength;
      pos[i * 6 + 5] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    return { geometry: geo, positions: pos };
  }, []);

  // Rain material
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x8888aa,
        transparent: true,
        opacity: 0.4,
        blending: THREE.NormalBlending,
      }),
    []
  );

  // Animation
  useFrame((state, delta) => {
    if (!linesRef.current || !positionsRef.current || intensity < 0.01) return;

    const { count, radius, fallSpeed, dropLength } = WEATHER_CONFIG.rain;
    const positions = positionsRef.current;
    const fallAmount = fallSpeed * delta * intensity;

    for (let i = 0; i < count; i++) {
      // Move drop down
      positions[i * 6 + 1] -= fallAmount;
      positions[i * 6 + 4] -= fallAmount;

      // Reset when below ground
      if (positions[i * 6 + 4] < 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const y = 25 + Math.random() * 10;

        positions[i * 6] = x;
        positions[i * 6 + 1] = y;
        positions[i * 6 + 2] = z;
        positions[i * 6 + 3] = x;
        positions[i * 6 + 4] = y - dropLength;
        positions[i * 6 + 5] = z;
      }
    }

    const posAttr = linesRef.current.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  });

  // Update material opacity based on intensity
  useEffect(() => {
    material.opacity = 0.4 * intensity;
  }, [intensity, material]);

  if (intensity < 0.01) return null;

  return <lineSegments ref={linesRef} geometry={geometry} material={material} />;
}

// =============================================================================
// Falling Leaves Component
// =============================================================================

interface FallingLeavesProps {
  /** Whether leaves are falling */
  enabled?: boolean;
}

/**
 * FallingLeaves - Autumn leaves drifting down
 */
export function FallingLeaves({
  enabled = true,
}: FallingLeavesProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { positions, rotations, velocities, colors } = useMemo(() => {
    const { count, radius, colors: colorOptions } = WEATHER_CONFIG.leaves;

    const pos = new Float32Array(count * 3);
    const rot = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Random starting position
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      pos[i * 3] = Math.cos(angle) * r;
      pos[i * 3 + 1] = 5 + Math.random() * 20;
      pos[i * 3 + 2] = Math.sin(angle) * r;

      // Random rotation
      rot[i * 3] = Math.random() * Math.PI * 2;
      rot[i * 3 + 1] = Math.random() * Math.PI * 2;
      rot[i * 3 + 2] = Math.random() * Math.PI * 2;

      // Velocity for spinning
      vel[i * 3] = (Math.random() - 0.5) * 2;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 2;

      // Random autumn color
      const color = new THREE.Color(
        colorOptions[Math.floor(Math.random() * colorOptions.length)]
      );
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
    }

    return { positions: pos, rotations: rot, velocities: vel, colors: col };
  }, []);

  // Leaf geometry (flat plane)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.2, 0.15);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xcc6633,
        side: THREE.DoubleSide,
        roughness: 0.8,
      }),
    []
  );

  // Animation
  useFrame((state, delta) => {
    if (!meshRef.current || !enabled) return;

    const { count, radius, fallSpeed, swayAmount } = WEATHER_CONFIG.leaves;
    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Fall with swaying
      positions[i * 3] +=
        Math.sin(time + i) * delta * swayAmount +
        velocities[i * 3] * delta * 0.1;
      positions[i * 3 + 1] -= fallSpeed * delta * (0.5 + Math.random() * 0.5);
      positions[i * 3 + 2] +=
        Math.cos(time * 0.7 + i) * delta * swayAmount +
        velocities[i * 3 + 2] * delta * 0.1;

      // Rotate while falling
      rotations[i * 3] += velocities[i * 3] * delta;
      rotations[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      rotations[i * 3 + 2] += velocities[i * 3 + 2] * delta;

      // Reset when below ground
      if (positions[i * 3 + 1] < 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        positions[i * 3] = Math.cos(angle) * r;
        positions[i * 3 + 1] = 20 + Math.random() * 10;
        positions[i * 3 + 2] = Math.sin(angle) * r;
      }

      // Update instance
      dummy.position.set(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2]
      );
      dummy.rotation.set(
        rotations[i * 3],
        rotations[i * 3 + 1],
        rotations[i * 3 + 2]
      );
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Set color
      color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      meshRef.current.setColorAt(i, color);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor)
      meshRef.current.instanceColor.needsUpdate = true;
  });

  if (!enabled) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, WEATHER_CONFIG.leaves.count]}
      castShadow
      receiveShadow
    />
  );
}

// =============================================================================
// Dust Motes Component
// =============================================================================

interface DustMotesProps {
  /** Whether dust is visible */
  enabled?: boolean;
  /** Light beam direction for dust to appear in */
  lightDirection?: [number, number, number];
}

/**
 * DustMotes - Floating dust particles visible in light beams
 */
export function DustMotes({
  enabled = true,
  lightDirection = [1, -1, 0],
}: DustMotesProps): JSX.Element | null {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, velocities } = useMemo(() => {
    const { count, radius } = WEATHER_CONFIG.dust;

    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Cluster dust along light beam direction
      const t = Math.random();
      const spread = 3;
      pos[i * 3] = lightDirection[0] * t * radius + (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = 2 + Math.random() * 6;
      pos[i * 3 + 2] = lightDirection[2] * t * radius + (Math.random() - 0.5) * spread;

      // Slow drift
      vel[i * 3] = (Math.random() - 0.5) * 0.5;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    return { positions: pos, velocities: vel };
  }, [lightDirection]);

  // Point material
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: 0xffffee,
        size: WEATHER_CONFIG.dust.size,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Animation
  useFrame((state, delta) => {
    if (!pointsRef.current || !enabled) return;

    const { count, floatSpeed } = WEATHER_CONFIG.dust;
    const time = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      // Gentle floating
      positions[i * 3] +=
        Math.sin(time * 0.5 + i) * delta * floatSpeed + velocities[i * 3] * delta;
      positions[i * 3 + 1] +=
        Math.sin(time * 0.3 + i * 0.5) * delta * floatSpeed * 0.5;
      positions[i * 3 + 2] +=
        Math.cos(time * 0.4 + i) * delta * floatSpeed + velocities[i * 3 + 2] * delta;
    }

    const posAttr = pointsRef.current.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  });

  if (!enabled) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}

// =============================================================================
// Main Weather System Component
// =============================================================================

export type WeatherType = "clear" | "fireflies" | "rain" | "autumn" | "dusty";

export interface WeatherSystemProps {
  /** Current weather type */
  weather?: WeatherType;
  /** Time of day (0-1) for automatic firefly visibility */
  timeOfDay?: number;
  /** Force firefly visibility regardless of time */
  forceFireflies?: boolean;
  /** Rain intensity (0-1) when weather is 'rain' */
  rainIntensity?: number;
}

/**
 * WeatherSystem component
 *
 * Manages all weather effects based on current conditions.
 *
 * @example
 * ```tsx
 * // Auto fireflies based on time
 * <WeatherSystem timeOfDay={0.8} />
 *
 * // Rainy weather
 * <WeatherSystem weather="rain" rainIntensity={0.7} />
 *
 * // Autumn leaves
 * <WeatherSystem weather="autumn" />
 * ```
 */
export function WeatherSystem({
  weather = "fireflies",
  timeOfDay = 0.75,
  forceFireflies = false,
  rainIntensity = 1,
}: WeatherSystemProps): JSX.Element {
  // Calculate firefly visibility based on time (dusk to dawn)
  const fireflyVisibility = useMemo(() => {
    if (forceFireflies) return 1;
    if (weather !== "fireflies" && weather !== "clear") return 0;

    // Fireflies appear at dusk (0.75) and disappear at dawn (0.25)
    if (timeOfDay > 0.7 || timeOfDay < 0.3) {
      if (timeOfDay > 0.7) {
        // Fade in after 0.7
        return Math.min(1, (timeOfDay - 0.7) / 0.1);
      } else {
        // Fade out before 0.3
        return Math.min(1, (0.3 - timeOfDay) / 0.1);
      }
    }
    return 0;
  }, [timeOfDay, forceFireflies, weather]);

  return (
    <group name="weather-system">
      {/* Fireflies - visible at night */}
      {(weather === "fireflies" || weather === "clear") && (
        <Fireflies visibility={fireflyVisibility} />
      )}

      {/* Rain */}
      {weather === "rain" && <Rain intensity={rainIntensity} />}

      {/* Autumn leaves */}
      {weather === "autumn" && <FallingLeaves enabled={true} />}

      {/* Dust motes (visible during day) */}
      {weather === "dusty" && <DustMotes enabled={true} />}
    </group>
  );
}

export default WeatherSystem;
