/**
 * SkillEffect Component
 * Visual effect for skill invocations using React Three Fiber
 *
 * Renders a visual effect when a skill is invoked:
 * - Floating skill name label above the invoking agent position
 * - Radial particle burst effect with skill-themed color
 * - Scale up/down animation over approximately 1.5 seconds
 * - Automatic cleanup when animation completes via onComplete callback
 *
 * @module components/visualization/SkillEffect
 *
 * @example
 * // Basic usage
 * <SkillEffect
 *   skillName="context7-research"
 *   position={[0, 2, 0]}
 *   onComplete={() => console.log('Effect complete')}
 * />
 *
 * @example
 * // With skill ID tracking
 * <SkillEffect
 *   skillId="skill-123-context7"
 *   skillName="context7-research"
 *   position={agentPosition}
 *   onComplete={() => handleEffectComplete("skill-123-context7")}
 * />
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import {
  getSkillHexColor,
  SKILL_EFFECT_CONFIG,
} from "../../config/visualization-config";

/**
 * Props for SkillEffect component
 */
export interface SkillEffectProps {
  /** Skill name to display */
  skillName: string;
  /** 3D position [x, y, z] where effect should appear */
  position: [number, number, number];
  /** Callback when animation completes (for cleanup) */
  onComplete: () => void;
  /** Optional: skill ID for tracking */
  skillId?: string;
}

/**
 * Animation state for the skill effect
 */
interface AnimationState {
  /** Opacity of the text label (0-1) */
  opacity: number;
  /** Scale of the group (0-1.2) */
  scale: number;
  /** Opacity of the particles (0-1) */
  particleOpacity: number;
}

/**
 * Generate initial particle positions and velocities for radial burst
 * Particles are distributed evenly around a circle with slight random variation
 *
 * @param count - Number of particles to generate
 * @returns Object containing Float32Array for positions and velocities
 */
function generateParticleData(count: number): {
  positions: Float32Array;
  velocities: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    // Start all particles at center
    positions[i3] = 0;
    positions[i3 + 1] = 0;
    positions[i3 + 2] = 0;

    // Compute radial velocity for outward burst
    // Distribute evenly around circle with slight random variation
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 0.8 + Math.random() * 0.4;
    const verticalBias = (Math.random() - 0.3) * 0.5; // Slight upward bias

    velocities[i3] = Math.cos(angle) * speed; // X velocity
    velocities[i3 + 1] = verticalBias; // Y velocity (slight up)
    velocities[i3 + 2] = Math.sin(angle) * speed; // Z velocity
  }

  return { positions, velocities };
}

/**
 * SkillEffect component
 *
 * Renders a visual effect for skill invocations with:
 * - Floating label displaying the skill name
 * - Radial particle burst effect
 * - Pop-in and fade-out animation
 *
 * Animation phases (1.5s total):
 * - 0-0.2s (Pop in): Scale 0->1.2, opacity 0->1
 * - 0.2-0.4s (Settle): Scale 1.2->1.0
 * - 0.4-0.8s (Hold): Full visibility, particles expand
 * - 0.8-1.5s (Fade): Scale 1.0->0.7, opacity 1->0
 *
 * @param props - SkillEffect props
 * @returns JSX element containing the 3D effect group or null when inactive
 */
export function SkillEffect({
  skillName,
  position,
  onComplete,
}: SkillEffectProps): JSX.Element | null {
  const [isActive, setIsActive] = useState(true);
  const startTimeRef = useRef<number | null>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Get skill color based on category
  const color = getSkillHexColor(skillName);

  // Animation state for opacity and scale
  const [animState, setAnimState] = useState<AnimationState>({
    opacity: 0,
    scale: 0,
    particleOpacity: 0,
  });

  // Generate particle data once on mount (memoized)
  const particleData = useMemo(
    () => generateParticleData(SKILL_EFFECT_CONFIG.particleCount),
    []
  );
  const velocities = particleData.velocities;

  // Create positions array for buffer geometry (must be cloned to allow updates)
  const positionsArray = useMemo(() => {
    return particleData.positions.slice();
  }, [particleData.positions]);

  // Create buffer geometry with positions attribute
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positionsArray, 3));
    return geom;
  }, [positionsArray]);

  // Clean up geometry on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // Handle animation completion - called once at end
  const handleComplete = useCallback(() => {
    setIsActive(false);
    onComplete();
  }, [onComplete]);

  // Main animation loop - runs every frame
  useFrame((state) => {
    if (!isActive) return;

    // Initialize start time on first frame
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.getElapsedTime();
    }

    const elapsed = state.clock.getElapsedTime() - startTimeRef.current;
    const progress = Math.min(elapsed / SKILL_EFFECT_CONFIG.duration, 1);

    // Animation complete - trigger cleanup
    if (progress >= 1) {
      handleComplete();
      return;
    }

    // Calculate animation phases
    // Phase 1 (0-0.2): Pop in - scale 0 -> 1.2, opacity 0 -> 1
    // Phase 2 (0.2-0.4): Settle - scale 1.2 -> 1.0
    // Phase 3 (0.4-0.8): Hold - scale 1.0, particles expand
    // Phase 4 (0.8-1.0): Fade out - opacity 1 -> 0
    let scale = 0;
    let opacity = 0;
    let particleOpacity = 0;

    if (progress < 0.2) {
      // Phase 1: Pop in
      const t = progress / 0.2;
      scale = t * 1.2;
      opacity = t;
      particleOpacity = t;
    } else if (progress < 0.4) {
      // Phase 2: Settle
      const t = (progress - 0.2) / 0.2;
      scale = 1.2 - t * 0.2; // 1.2 -> 1.0
      opacity = 1;
      particleOpacity = 1;
    } else if (progress < 0.8) {
      // Phase 3: Hold
      scale = 1;
      opacity = 1;
      particleOpacity = 1 - ((progress - 0.4) / 0.4) * 0.5; // Slow fade to 0.5
    } else {
      // Phase 4: Fade out
      const t = (progress - 0.8) / 0.2;
      scale = 1 - t * 0.3; // 1.0 -> 0.7
      opacity = 1 - t;
      particleOpacity = 0.5 - t * 0.5;
    }

    setAnimState({ opacity, scale, particleOpacity });

    // Update particle positions for burst effect
    if (pointsRef.current) {
      const geometry = pointsRef.current.geometry;
      const posAttr = geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;
      const array = posAttr.array as Float32Array;

      // Expand particles based on progress (full expansion by 60%)
      const expansionProgress = Math.min(progress / 0.6, 1);
      const easeOut = 1 - Math.pow(1 - expansionProgress, 3); // Ease-out cubic

      for (let i = 0; i < SKILL_EFFECT_CONFIG.particleCount; i++) {
        const i3 = i * 3;
        array[i3] =
          velocities[i3] * SKILL_EFFECT_CONFIG.particleSpreadRadius * easeOut;
        array[i3 + 1] =
          velocities[i3 + 1] *
            SKILL_EFFECT_CONFIG.particleSpreadRadius *
            easeOut +
          0.1;
        array[i3 + 2] =
          velocities[i3 + 2] * SKILL_EFFECT_CONFIG.particleSpreadRadius * easeOut;
      }

      posAttr.needsUpdate = true;
    }

    // Update group scale for overall animation
    if (groupRef.current) {
      groupRef.current.scale.setScalar(scale);
    }
  });

  // Don't render if animation has completed
  if (!isActive) {
    return null;
  }

  return (
    <group position={position} ref={groupRef}>
      {/* Particle burst effect - Points geometry for performance */}
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial
          size={SKILL_EFFECT_CONFIG.particleSize}
          color={color}
          transparent
          opacity={animState.particleOpacity}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      {/* Skill name label - HTML overlay positioned above center */}
      <Html
        position={[0, SKILL_EFFECT_CONFIG.labelOffsetY, 0]}
        center
        distanceFactor={SKILL_EFFECT_CONFIG.labelDistanceFactor}
        style={{
          pointerEvents: "none",
          userSelect: "none",
          opacity: animState.opacity,
          transform: `scale(${animState.scale})`,
          transition: "none",
        }}
      >
        <div
          className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shadow-lg"
          style={{
            backgroundColor: `${color}20`, // 12.5% opacity background
            border: `1px solid ${color}`,
            color: color,
          }}
        >
          {skillName}
        </div>
      </Html>

      {/* Center glow point - gives focal point to the effect */}
      <mesh>
        <sphereGeometry args={[SKILL_EFFECT_CONFIG.glowSphereRadius, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={animState.particleOpacity * 0.6}
        />
      </mesh>
    </group>
  );
}
