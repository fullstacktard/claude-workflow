/**
 * MagicEffects Component
 *
 * Magical spell/skill visual effects for the medieval village visualization:
 * - Casting Effect: Glowing runes in a circle around the agent
 * - Spell Particles: Sparkles/motes that spiral upward
 * - Magic Aura: Subtle glowing halo around active agents
 * - Portal Effect: Swirling vortex for agent spawn/despawn
 * - Completion Burst: Celebratory particle explosion on task completion
 *
 * Performance optimized with instanced meshes and additive blending.
 *
 * @module components/visualization/MagicEffects
 */

import { useRef, useMemo, useEffect, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getSkillHexColor, DEFAULT_SKILL_HEX_COLOR } from "../../config/visualization-config";

// =============================================================================
// Configuration
// =============================================================================

export const MAGIC_EFFECT_CONFIG = {
  casting: {
    runeCount: 8,
    runeRadius: 1.2,
    runeSize: 0.2,
    rotationSpeed: 1.5,
    pulseSpeed: 3,
    riseSpeed: 0.5,
    duration: 2.5,
  },
  aura: {
    particleCount: 20,
    radius: 0.6,
    particleSize: 0.08,
    floatSpeed: 1,
    pulseSpeed: 2,
  },
  portal: {
    ringCount: 3,
    particlesPerRing: 24,
    radius: 1.5,
    rotationSpeed: 3,
    spiralSpeed: 2,
    duration: 2,
  },
  completion: {
    particleCount: 50,
    burstRadius: 2,
    riseSpeed: 3,
    spreadSpeed: 2,
    duration: 1.5,
  },
  sparkles: {
    particleCount: 30,
    radius: 0.8,
    spiralSpeed: 2,
    riseSpeed: 1.5,
    duration: 2,
  },
} as const;

// =============================================================================
// Types
// =============================================================================

export type MagicEffectType = "casting" | "aura" | "portal" | "completion" | "sparkles";

export interface MagicEffectProps {
  /** Type of magic effect to render */
  type: MagicEffectType;
  /** Position [x, y, z] where the effect appears */
  position: [number, number, number];
  /** Color of the effect (hex string). Defaults to skill color or gray */
  color?: string;
  /** Intensity multiplier (0-1). Defaults to 1 */
  intensity?: number;
  /** Duration in seconds. 0 = infinite (for aura). Defaults to effect-specific duration */
  duration?: number;
  /** Callback when effect completes (for finite effects) */
  onComplete?: () => void;
}

// =============================================================================
// Casting Effect Component
// =============================================================================

interface CastingEffectProps {
  position: [number, number, number];
  color: string;
  intensity: number;
  duration: number;
  onComplete?: () => void;
}

/**
 * CastingEffect - Glowing runes that appear in a circle around the caster
 * Runes rotate, pulse, and slowly rise before fading out
 */
function CastingEffect({
  position,
  color,
  intensity,
  duration,
  onComplete,
}: CastingEffectProps): JSX.Element | null {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  const startTimeRef = useRef<number | null>(null);
  const isCompleteRef = useRef(false);

  const { runeCount, runeRadius, runeSize, rotationSpeed, pulseSpeed, riseSpeed } =
    MAGIC_EFFECT_CONFIG.casting;

  // Rune phases for staggered animation
  const phases = useMemo(() => {
    return Array.from({ length: runeCount }, (_, i) => ({
      angle: (i / runeCount) * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      sizeVariation: 0.8 + Math.random() * 0.4,
    }));
  }, [runeCount]);

  // Geometries and materials
  const geometry = useMemo(() => new THREE.PlaneGeometry(runeSize, runeSize), [runeSize]);
  const glowGeometry = useMemo(() => new THREE.PlaneGeometry(runeSize * 2, runeSize * 2), [runeSize]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      }),
    [color]
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  // Animation loop
  useFrame((state, delta) => {
    if (!meshRef.current || !glowMeshRef.current || !groupRef.current) return;
    if (isCompleteRef.current) return;

    // Initialize start time
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const time = state.clock.elapsedTime;

    // Check completion
    if (progress >= 1 && duration > 0) {
      isCompleteRef.current = true;
      onComplete?.();
      return;
    }

    // Fade in/out
    let opacity = 1;
    if (progress < 0.2) {
      opacity = progress / 0.2; // Fade in
    } else if (progress > 0.7) {
      opacity = (1 - progress) / 0.3; // Fade out
    }

    // Rotate the whole group
    groupRef.current.rotation.y = time * rotationSpeed;

    // Rise effect
    groupRef.current.position.y = position[1] + elapsed * riseSpeed * 0.3;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < runeCount; i++) {
      const { angle, phase, sizeVariation } = phases[i];

      // Calculate position on circle
      const x = Math.cos(angle) * runeRadius;
      const z = Math.sin(angle) * runeRadius;
      const y = Math.sin(time * 2 + phase) * 0.1; // Gentle bob

      // Pulsing scale
      const pulse = 0.8 + 0.2 * Math.sin(time * pulseSpeed + phase);
      const scale = pulse * sizeVariation * intensity * opacity;

      // Update rune instance
      dummy.position.set(x, y, z);
      dummy.rotation.set(-Math.PI / 2, 0, angle + Math.PI / 2); // Face up, rotate toward center
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Glow is larger
      dummy.scale.setScalar(scale * 1.5);
      dummy.updateMatrix();
      glowMeshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;

    // Update material opacity
    material.opacity = opacity * intensity;
    glowMaterial.opacity = 0.4 * opacity * intensity;
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      glowGeometry.dispose();
      material.dispose();
      glowMaterial.dispose();
    };
  }, [geometry, glowGeometry, material, glowMaterial]);

  if (isCompleteRef.current && duration > 0) return null;

  return (
    <group ref={groupRef} position={position}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, runeCount]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[glowGeometry, glowMaterial, runeCount]}
        frustumCulled={false}
      />
    </group>
  );
}

// =============================================================================
// Magic Aura Component
// =============================================================================

interface MagicAuraProps {
  position: [number, number, number];
  color: string;
  intensity: number;
}

/**
 * MagicAura - Subtle glowing particles that orbit around active agents
 * Infinite duration - follows the agent
 */
function MagicAura({ position, color, intensity }: MagicAuraProps): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);

  const { particleCount, radius, particleSize, floatSpeed, pulseSpeed } =
    MAGIC_EFFECT_CONFIG.aura;

  // Particle data
  const particleData = useMemo(() => {
    return Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      height: Math.random() * 0.6,
      radius: radius * (0.7 + Math.random() * 0.6),
      speed: floatSpeed * (0.5 + Math.random() * 1),
      phase: Math.random() * Math.PI * 2,
      size: particleSize * (0.6 + Math.random() * 0.8),
    }));
  }, [particleCount, radius, particleSize, floatSpeed]);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(0.1, 6, 6), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.8,
      }),
    [color]
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state) => {
    if (!meshRef.current || !glowMeshRef.current) return;

    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < particleCount; i++) {
      const p = particleData[i];

      // Orbit around position
      const currentAngle = p.angle + time * p.speed;
      const x = Math.cos(currentAngle) * p.radius;
      const z = Math.sin(currentAngle) * p.radius;
      const y = p.height + Math.sin(time * pulseSpeed + p.phase) * 0.1;

      // Pulsing glow
      const pulse = 0.7 + 0.3 * Math.sin(time * pulseSpeed + p.phase);
      const scale = p.size * pulse * intensity;

      dummy.position.set(position[0] + x, position[1] + y, position[2] + z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Larger glow
      dummy.scale.setScalar(scale * 2);
      dummy.updateMatrix();
      glowMeshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, particleCount]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[glowGeometry, glowMaterial, particleCount]}
        frustumCulled={false}
      />
    </group>
  );
}

// =============================================================================
// Portal Effect Component
// =============================================================================

interface PortalEffectProps {
  position: [number, number, number];
  color: string;
  intensity: number;
  duration: number;
  onComplete?: () => void;
}

/**
 * PortalEffect - Swirling vortex for agent spawn/despawn
 * Multiple rotating rings of particles creating a spiral effect
 */
function PortalEffect({
  position,
  color,
  intensity,
  duration,
  onComplete,
}: PortalEffectProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startTimeRef = useRef<number | null>(null);
  const isCompleteRef = useRef(false);

  const { ringCount, particlesPerRing, radius, rotationSpeed, spiralSpeed } =
    MAGIC_EFFECT_CONFIG.portal;

  const totalParticles = ringCount * particlesPerRing;

  // Particle configuration
  const particleConfig = useMemo(() => {
    const config = [];
    for (let ring = 0; ring < ringCount; ring++) {
      for (let i = 0; i < particlesPerRing; i++) {
        config.push({
          ring,
          angle: (i / particlesPerRing) * Math.PI * 2,
          ringRadius: radius * (0.3 + (ring / ringCount) * 0.7),
          phase: ring * (Math.PI / ringCount),
          size: 0.08 * (1 - ring * 0.2), // Inner rings larger
        });
      }
    }
    return config;
  }, [ringCount, particlesPerRing, radius]);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state) => {
    if (!meshRef.current) return;
    if (isCompleteRef.current) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const time = state.clock.elapsedTime;

    if (progress >= 1 && duration > 0) {
      isCompleteRef.current = true;
      onComplete?.();
      return;
    }

    // Opacity fade
    let opacity = 1;
    if (progress < 0.15) {
      opacity = progress / 0.15;
    } else if (progress > 0.7) {
      opacity = (1 - progress) / 0.3;
    }

    const dummy = new THREE.Object3D();

    for (let i = 0; i < totalParticles; i++) {
      const p = particleConfig[i];

      // Spiral rotation (outer rings rotate faster)
      const spiralOffset = time * spiralSpeed * (1 + p.ring * 0.5);
      const currentAngle = p.angle + spiralOffset + time * rotationSpeed;

      // Position on ring
      const x = Math.cos(currentAngle) * p.ringRadius;
      const z = Math.sin(currentAngle) * p.ringRadius;

      // Vertical spiral - particles rise in a helix
      const y = (p.ring / ringCount) * 1.5 + Math.sin(currentAngle * 2 + p.phase) * 0.2;

      // Pulsing
      const pulse = 0.8 + 0.2 * Math.sin(time * 4 + p.phase);
      const scale = p.size * pulse * intensity * opacity;

      dummy.position.set(position[0] + x, position[1] + y, position[2] + z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    material.opacity = opacity * intensity;
  });

  if (isCompleteRef.current && duration > 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, totalParticles]}
      frustumCulled={false}
    />
  );
}

// =============================================================================
// Completion Burst Component
// =============================================================================

interface CompletionBurstProps {
  position: [number, number, number];
  color: string;
  intensity: number;
  duration: number;
  onComplete?: () => void;
}

/**
 * CompletionBurst - Celebratory particle explosion when task completes
 * Particles burst outward and upward with gravity-like falloff
 */
function CompletionBurst({
  position,
  color,
  intensity,
  duration,
  onComplete,
}: CompletionBurstProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startTimeRef = useRef<number | null>(null);
  const isCompleteRef = useRef(false);

  const { particleCount, burstRadius, riseSpeed, spreadSpeed } = MAGIC_EFFECT_CONFIG.completion;

  // Particle velocities
  const velocities = useMemo(() => {
    const vel = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      // Random direction for burst
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // Hemisphere (upward)
      const speed = spreadSpeed * (0.5 + Math.random() * 0.5);

      vel[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      vel[i * 3 + 1] = Math.cos(phi) * riseSpeed + Math.random() * 0.5; // Upward bias
      vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    return vel;
  }, [particleCount, riseSpeed, spreadSpeed]);

  // Current positions
  const positions = useMemo(() => new Float32Array(particleCount * 3), [particleCount]);

  // Particle sizes
  const sizes = useMemo(() => {
    return Array.from({ length: particleCount }, () => 0.06 + Math.random() * 0.08);
  }, [particleCount]);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    if (isCompleteRef.current) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

    if (progress >= 1 && duration > 0) {
      isCompleteRef.current = true;
      onComplete?.();
      return;
    }

    // Ease-out for natural deceleration
    const easeOut = 1 - Math.pow(1 - progress, 2);

    // Opacity fade (quick burst, slow fade)
    let opacity = 1;
    if (progress > 0.3) {
      opacity = (1 - progress) / 0.7;
    }

    const dummy = new THREE.Object3D();
    const gravity = -2; // Simulated gravity

    for (let i = 0; i < particleCount; i++) {
      // Update position based on velocity and time
      const vx = velocities[i * 3];
      const vy = velocities[i * 3 + 1];
      const vz = velocities[i * 3 + 2];

      // Physics-based movement with gravity
      const x = vx * elapsed;
      const y = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const z = vz * elapsed;

      // Keep particles within burst radius
      const scale = sizes[i] * intensity * opacity * (1 - easeOut * 0.5);

      dummy.position.set(
        position[0] + x,
        position[1] + Math.max(0, y), // Don't go below ground
        position[2] + z
      );
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    material.opacity = opacity * intensity;
  });

  if (isCompleteRef.current && duration > 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, particleCount]}
      frustumCulled={false}
    />
  );
}

// =============================================================================
// Sparkles Effect Component
// =============================================================================

interface SparklesEffectProps {
  position: [number, number, number];
  color: string;
  intensity: number;
  duration: number;
  onComplete?: () => void;
}

/**
 * SparklesEffect - Magical sparkles/motes that spiral upward
 * Creates a column of rising, swirling particles
 */
function SparklesEffect({
  position,
  color,
  intensity,
  duration,
  onComplete,
}: SparklesEffectProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  const startTimeRef = useRef<number | null>(null);
  const isCompleteRef = useRef(false);

  const { particleCount, radius, spiralSpeed, riseSpeed } = MAGIC_EFFECT_CONFIG.sparkles;

  // Particle initial data
  const particleData = useMemo(() => {
    return Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      height: Math.random() * 0.5,
      radiusOffset: Math.random() * 0.3,
      speed: spiralSpeed * (0.7 + Math.random() * 0.6),
      riseRate: riseSpeed * (0.8 + Math.random() * 0.4),
      size: 0.04 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [particleCount, spiralSpeed, riseSpeed]);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.03, 6, 6), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(0.08, 6, 6), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
      }),
    [color]
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state, delta) => {
    if (!meshRef.current || !glowMeshRef.current) return;
    if (isCompleteRef.current) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const time = state.clock.elapsedTime;

    if (progress >= 1 && duration > 0) {
      isCompleteRef.current = true;
      onComplete?.();
      return;
    }

    // Opacity transitions
    let opacity = 1;
    if (progress < 0.1) {
      opacity = progress / 0.1;
    } else if (progress > 0.7) {
      opacity = (1 - progress) / 0.3;
    }

    const dummy = new THREE.Object3D();

    for (let i = 0; i < particleCount; i++) {
      const p = particleData[i];

      // Spiral upward motion
      const currentAngle = p.angle + time * p.speed;
      const currentHeight = (p.height + elapsed * p.riseRate) % 2; // Loop at 2 units
      const currentRadius = radius + p.radiusOffset + Math.sin(time * 2 + p.phase) * 0.1;

      const x = Math.cos(currentAngle) * currentRadius;
      const z = Math.sin(currentAngle) * currentRadius;
      const y = currentHeight;

      // Twinkling effect
      const twinkle = 0.5 + 0.5 * Math.sin(time * 8 + p.phase);
      const scale = p.size * twinkle * intensity * opacity;

      dummy.position.set(position[0] + x, position[1] + y, position[2] + z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Glow
      dummy.scale.setScalar(scale * 2.5);
      dummy.updateMatrix();
      glowMeshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;

    material.opacity = opacity * intensity;
    glowMaterial.opacity = 0.4 * opacity * intensity;
  });

  if (isCompleteRef.current && duration > 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, particleCount]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[glowGeometry, glowMaterial, particleCount]}
        frustumCulled={false}
      />
    </group>
  );
}

// =============================================================================
// Main MagicEffect Component
// =============================================================================

/**
 * MagicEffect - Main entry point for magical visual effects
 *
 * Renders one of five effect types:
 * - casting: Glowing runes circling the position
 * - aura: Subtle particles orbiting (infinite duration)
 * - portal: Swirling vortex for spawn/despawn
 * - completion: Celebratory burst explosion
 * - sparkles: Rising spiral of magical motes
 *
 * @example
 * ```tsx
 * // Casting effect when skill is used
 * <MagicEffect
 *   type="casting"
 *   position={[0, 0, 0]}
 *   color="#60A5FA"
 *   onComplete={() => console.log('Casting complete')}
 * />
 *
 * // Infinite aura around active agent
 * <MagicEffect
 *   type="aura"
 *   position={agentPosition}
 *   color="#4ADE80"
 *   duration={0}
 * />
 *
 * // Portal for agent spawn
 * <MagicEffect
 *   type="portal"
 *   position={spawnPoint}
 *   color="#C084FC"
 * />
 * ```
 */
export function MagicEffect({
  type,
  position,
  color = DEFAULT_SKILL_HEX_COLOR,
  intensity = 1,
  duration,
  onComplete,
}: MagicEffectProps): JSX.Element | null {
  // Determine duration based on type if not provided
  const effectDuration = useMemo(() => {
    if (duration !== undefined) return duration;

    switch (type) {
      case "casting":
        return MAGIC_EFFECT_CONFIG.casting.duration;
      case "aura":
        return 0; // Infinite
      case "portal":
        return MAGIC_EFFECT_CONFIG.portal.duration;
      case "completion":
        return MAGIC_EFFECT_CONFIG.completion.duration;
      case "sparkles":
        return MAGIC_EFFECT_CONFIG.sparkles.duration;
      default:
        return 2;
    }
  }, [type, duration]);

  switch (type) {
    case "casting":
      return (
        <CastingEffect
          position={position}
          color={color}
          intensity={intensity}
          duration={effectDuration}
          onComplete={onComplete}
        />
      );

    case "aura":
      return (
        <MagicAura
          position={position}
          color={color}
          intensity={intensity}
        />
      );

    case "portal":
      return (
        <PortalEffect
          position={position}
          color={color}
          intensity={intensity}
          duration={effectDuration}
          onComplete={onComplete}
        />
      );

    case "completion":
      return (
        <CompletionBurst
          position={position}
          color={color}
          intensity={intensity}
          duration={effectDuration}
          onComplete={onComplete}
        />
      );

    case "sparkles":
      return (
        <SparklesEffect
          position={position}
          color={color}
          intensity={intensity}
          duration={effectDuration}
          onComplete={onComplete}
        />
      );

    default:
      return null;
  }
}

// =============================================================================
// Magic Effects Manager
// =============================================================================

export interface ActiveMagicEffect {
  id: string;
  type: MagicEffectType;
  position: [number, number, number];
  color?: string;
  intensity?: number;
  duration?: number;
}

export interface MagicEffectsManagerProps {
  /** Array of active effects to render */
  effects: ActiveMagicEffect[];
  /** Callback when an effect completes */
  onEffectComplete?: (effectId: string) => void;
}

/**
 * MagicEffectsManager - Manages multiple magic effects
 *
 * Use this component when you need to manage a dynamic list of effects,
 * such as multiple agents casting spells simultaneously.
 *
 * @example
 * ```tsx
 * const [effects, setEffects] = useState<ActiveMagicEffect[]>([]);
 *
 * const addEffect = (agentId: string, type: MagicEffectType, position: [number, number, number]) => {
 *   setEffects(prev => [...prev, { id: `${agentId}-${Date.now()}`, type, position }]);
 * };
 *
 * const handleComplete = (effectId: string) => {
 *   setEffects(prev => prev.filter(e => e.id !== effectId));
 * };
 *
 * <MagicEffectsManager effects={effects} onEffectComplete={handleComplete} />
 * ```
 */
export function MagicEffectsManager({
  effects,
  onEffectComplete,
}: MagicEffectsManagerProps): JSX.Element {
  const handleComplete = useCallback(
    (effectId: string) => {
      onEffectComplete?.(effectId);
    },
    [onEffectComplete]
  );

  return (
    <group name="magic-effects-manager">
      {effects.map((effect) => (
        <MagicEffect
          key={effect.id}
          type={effect.type}
          position={effect.position}
          color={effect.color}
          intensity={effect.intensity}
          duration={effect.duration}
          onComplete={() => handleComplete(effect.id)}
        />
      ))}
    </group>
  );
}

export default MagicEffect;
