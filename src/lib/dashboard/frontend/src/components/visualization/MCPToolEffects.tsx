/**
 * MCPToolEffects Component
 *
 * Visual spell/magic effects when agents use MCP tools:
 * - Magical circle/rune that appears at the building
 * - Energy beam connecting agent to building
 * - Particle burst explosion effect
 * - Orbiting magical orbs
 * - Color-coded based on MCP tool type
 *
 * @module components/visualization/MCPToolEffects
 */

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { getSkillHexColor } from "../../config/visualization-config";

// =============================================================================
// Configuration
// =============================================================================

export const MCP_EFFECT_CONFIG = {
  /** Magic circle radius */
  circleRadius: 1.5,
  /** Circle rotation speed */
  circleRotationSpeed: 0.5,
  /** Number of runes around circle */
  runeCount: 8,
  /** Energy beam segments */
  beamSegments: 20,
  /** Particle burst count */
  particleCount: 50,
  /** Particle burst duration */
  burstDuration: 1.5,
  /** Orbiting orb count */
  orbCount: 6,
  /** Orb orbit radius */
  orbOrbitRadius: 1.2,
  /** Orb orbit speed */
  orbOrbitSpeed: 2,
  /** Effect duration (seconds) */
  effectDuration: 3,
} as const;

// =============================================================================
// Magic Circle Component
// =============================================================================

interface MagicCircleProps {
  /** Position of the circle */
  position: [number, number, number];
  /** Color of the circle */
  color: THREE.Color;
  /** Intensity (0-1) */
  intensity: number;
}

/**
 * MagicCircle - Rotating magical summoning circle
 */
function MagicCircle({
  position,
  color,
  intensity,
}: MagicCircleProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const innerCircleRef = useRef<THREE.Mesh>(null);

  // Create circle geometry
  const { outerRing, innerRing, runes } = useMemo(() => {
    const { circleRadius, runeCount } = MCP_EFFECT_CONFIG;

    // Outer ring
    const outerGeo = new THREE.RingGeometry(
      circleRadius * 0.9,
      circleRadius,
      64
    );

    // Inner ring
    const innerGeo = new THREE.RingGeometry(
      circleRadius * 0.4,
      circleRadius * 0.5,
      64
    );

    // Rune positions around the circle
    const runePositions: [number, number, number][] = [];
    for (let i = 0; i < runeCount; i++) {
      const angle = (i / runeCount) * Math.PI * 2;
      const r = circleRadius * 0.7;
      runePositions.push([Math.cos(angle) * r, 0.01, Math.sin(angle) * r]);
    }

    return { outerRing: outerGeo, innerRing: innerGeo, runes: runePositions };
  }, []);

  // Animate rotation
  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y =
      state.clock.elapsedTime * MCP_EFFECT_CONFIG.circleRotationSpeed;

    // Inner circle spins opposite direction
    if (innerCircleRef.current) {
      innerCircleRef.current.rotation.y =
        -state.clock.elapsedTime * MCP_EFFECT_CONFIG.circleRotationSpeed * 2;
    }
  });

  const materialProps = {
    color: color,
    transparent: true,
    opacity: intensity * 0.8,
    blending: THREE.AdditiveBlending as THREE.Blending,
    side: THREE.DoubleSide as THREE.Side,
    depthWrite: false,
  };

  return (
    <group ref={groupRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Outer ring */}
      <mesh>
        <primitive object={outerRing} />
        <meshBasicMaterial {...materialProps} />
      </mesh>

      {/* Inner ring (counter-rotating) */}
      <mesh ref={innerCircleRef}>
        <primitive object={innerRing} />
        <meshBasicMaterial {...materialProps} opacity={intensity * 0.6} />
      </mesh>

      {/* Rune markers */}
      {runes.map((pos, i) => (
        <mesh key={i} position={pos} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.1, 0.1, 0.02]} />
          <meshBasicMaterial {...materialProps} opacity={intensity} />
        </mesh>
      ))}

      {/* Center glow */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={intensity * 0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// Energy Beam Component
// =============================================================================

interface EnergyBeamProps {
  /** Start position (agent) */
  start: THREE.Vector3;
  /** End position (building) */
  end: THREE.Vector3;
  /** Beam color */
  color: THREE.Color;
  /** Intensity (0-1) */
  intensity: number;
}

/**
 * EnergyBeam - Animated energy stream between two points
 */
function EnergyBeam({
  start,
  end,
  color,
  intensity,
}: EnergyBeamProps): JSX.Element {
  const lineRef = useRef<THREE.Line | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);

  // Create beam geometry with animated displacement
  const { lineGeometry, particlePositions } = useMemo(() => {
    const { beamSegments } = MCP_EFFECT_CONFIG;

    // Line points
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= beamSegments; i++) {
      const t = i / beamSegments;
      points.push(
        new THREE.Vector3(
          start.x + (end.x - start.x) * t,
          start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * 0.5,
          start.z + (end.z - start.z) * t
        )
      );
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

    // Particles along beam
    const particlePos = new Float32Array(beamSegments * 3);
    for (let i = 0; i < beamSegments; i++) {
      const t = i / beamSegments;
      particlePos[i * 3] = start.x + (end.x - start.x) * t;
      particlePos[i * 3 + 1] =
        start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * 0.5;
      particlePos[i * 3 + 2] = start.z + (end.z - start.z) * t;
    }

    return { lineGeometry: lineGeo, particlePositions: particlePos };
  }, [start, end]);

  // Animate beam
  useFrame((state) => {
    if (!lineRef.current || !particlesRef.current) return;

    const time = state.clock.elapsedTime;
    const { beamSegments } = MCP_EFFECT_CONFIG;

    // Update line geometry with wave effect
    const positions = lineRef.current.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;

    for (let i = 0; i <= beamSegments; i++) {
      const t = i / beamSegments;
      const wave = Math.sin(t * Math.PI * 4 + time * 5) * 0.1 * intensity;

      positions.setY(
        i,
        start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * 0.5 + wave
      );
    }
    positions.needsUpdate = true;

    // Update particle positions (traveling along beam)
    const particleAttr = particlesRef.current.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;

    for (let i = 0; i < beamSegments; i++) {
      const t = ((i / beamSegments + time * 2) % 1);
      particleAttr.setXYZ(
        i,
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * 0.5,
        start.z + (end.z - start.z) * t
      );
    }
    particleAttr.needsUpdate = true;
  });

  if (intensity < 0.01) return <></>;

  return (
    <group>
      {/* Main beam line */}
      <primitive
        ref={lineRef}
        object={new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: intensity * 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }))}
      />

      {/* Particles traveling along beam */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={0.15}
          transparent
          opacity={intensity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// =============================================================================
// Particle Burst Component
// =============================================================================

interface ParticleBurstProps {
  /** Center position of burst */
  position: [number, number, number];
  /** Burst color */
  color: THREE.Color;
  /** Progress (0-1) of the burst animation */
  progress: number;
}

/**
 * ParticleBurst - Explosive particle effect
 */
function ParticleBurst({
  position,
  color,
  progress,
}: ParticleBurstProps): JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Generate burst directions
  const directions = useMemo(() => {
    const { particleCount } = MCP_EFFECT_CONFIG;
    const dirs: THREE.Vector3[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Random direction on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      dirs.push(
        new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
          Math.cos(phi)
        )
      );
    }

    return dirs;
  }, []);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame(() => {
    if (!meshRef.current) return;

    const { particleCount } = MCP_EFFECT_CONFIG;
    const dummy = new THREE.Object3D();

    // Ease out for smooth deceleration
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const fade = 1 - progress;

    for (let i = 0; i < particleCount; i++) {
      const dir = directions[i];
      const speed = 1 + Math.random() * 2;

      // Position based on progress
      dummy.position.set(
        position[0] + dir.x * easedProgress * speed,
        position[1] + dir.y * easedProgress * speed,
        position[2] + dir.z * easedProgress * speed
      );

      // Scale shrinks over time
      dummy.scale.setScalar(fade * 0.5);

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    material.opacity = fade;
  });

  if (progress >= 1) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MCP_EFFECT_CONFIG.particleCount]}
      frustumCulled={false}
    />
  );
}

// =============================================================================
// Orbiting Orbs Component
// =============================================================================

interface OrbitingOrbsProps {
  /** Center position */
  position: [number, number, number];
  /** Orb color */
  color: THREE.Color;
  /** Intensity (0-1) */
  intensity: number;
}

/**
 * OrbitingOrbs - Magical orbs that circle around a point
 */
function OrbitingOrbs({
  position,
  color,
  intensity,
}: OrbitingOrbsProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);

  const { orbCount, orbOrbitRadius } = MCP_EFFECT_CONFIG;

  // Create orb positions
  const orbs = useMemo(() => {
    return Array.from({ length: orbCount }, (_, i) => ({
      angle: (i / orbCount) * Math.PI * 2,
      height: 0.5 + Math.sin(i * 1.5) * 0.3,
      speed: 1 + Math.random() * 0.5,
      size: 0.08 + Math.random() * 0.04,
    }));
  }, [orbCount]);

  // Animate orbs
  useFrame((state) => {
    if (!groupRef.current) return;

    const time = state.clock.elapsedTime * MCP_EFFECT_CONFIG.orbOrbitSpeed;

    groupRef.current.children.forEach((child, i) => {
      if (i >= orbs.length) return;
      const orb = orbs[i];
      const angle = orb.angle + time * orb.speed;

      child.position.set(
        Math.cos(angle) * orbOrbitRadius,
        orb.height + Math.sin(time * 2 + i) * 0.1,
        Math.sin(angle) * orbOrbitRadius
      );
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {orbs.map((orb, i) => (
        <mesh key={i}>
          <sphereGeometry args={[orb.size, 8, 8]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={intensity * 0.9}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================================
// Main MCP Tool Effect Component
// =============================================================================

export interface MCPToolEffectProps {
  /** Unique ID for this effect */
  id: string;
  /** Tool name for color coding */
  toolName: string;
  /** Agent position (beam start) */
  agentPosition: [number, number, number];
  /** Building position (effect center) */
  buildingPosition: [number, number, number];
  /** Callback when effect completes */
  onComplete?: () => void;
}

/**
 * MCPToolEffect - Complete visual effect for MCP tool usage
 */
export function MCPToolEffect({
  id,
  toolName,
  agentPosition,
  buildingPosition,
  onComplete,
}: MCPToolEffectProps): JSX.Element {
  const [progress, setProgress] = useState(0);
  const [burstTriggered, setBurstTriggered] = useState(false);
  const startTimeRef = useRef<number | null>(null);

  const color = useMemo(
    () => new THREE.Color(getSkillHexColor(toolName)),
    [toolName]
  );

  const agentVec = useMemo(
    () => new THREE.Vector3(...agentPosition),
    [agentPosition]
  );
  const buildingVec = useMemo(
    () => new THREE.Vector3(...buildingPosition),
    [buildingPosition]
  );

  // Animate effect progress
  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const newProgress = Math.min(1, elapsed / MCP_EFFECT_CONFIG.effectDuration);
    setProgress(newProgress);

    // Trigger burst at midpoint
    if (newProgress > 0.3 && !burstTriggered) {
      setBurstTriggered(true);
    }

    // Complete
    if (newProgress >= 1 && onComplete) {
      onComplete();
    }
  });

  // Calculate intensities based on progress
  const circleIntensity = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;
  const beamIntensity = progress < 0.7 ? progress / 0.3 : 1 - (progress - 0.7) / 0.3;
  const burstProgress = burstTriggered ? Math.min(1, (progress - 0.3) / 0.5) : 0;

  return (
    <group name={`mcp-effect-${id}`}>
      {/* Magic circle at building */}
      <MagicCircle
        position={[buildingPosition[0], 0.05, buildingPosition[2]]}
        color={color}
        intensity={circleIntensity}
      />

      {/* Energy beam from agent to building */}
      <EnergyBeam
        start={agentVec}
        end={buildingVec}
        color={color}
        intensity={beamIntensity}
      />

      {/* Particle burst */}
      {burstTriggered && (
        <ParticleBurst
          position={buildingPosition}
          color={color}
          progress={burstProgress}
        />
      )}

      {/* Orbiting orbs around building */}
      <OrbitingOrbs
        position={buildingPosition}
        color={color}
        intensity={circleIntensity}
      />

      {/* Tool name label */}
      <Html
        position={[buildingPosition[0], buildingPosition[1] + 3, buildingPosition[2]]}
        center
        style={{ pointerEvents: "none", opacity: circleIntensity }}
      >
        <div className="bg-purple-900/80 border border-purple-500 px-2 py-1 rounded text-xs font-mono text-purple-200 whitespace-nowrap">
          {toolName}
        </div>
      </Html>
    </group>
  );
}

// =============================================================================
// Effects Manager Component
// =============================================================================

export interface ActiveMCPEffect {
  id: string;
  toolName: string;
  agentPosition: [number, number, number];
  buildingPosition: [number, number, number];
}

interface MCPToolEffectsManagerProps {
  /** Active effects to render */
  effects: ActiveMCPEffect[];
  /** Callback when an effect completes */
  onEffectComplete?: (id: string) => void;
}

/**
 * MCPToolEffectsManager - Manages multiple active MCP tool effects
 */
export function MCPToolEffectsManager({
  effects,
  onEffectComplete,
}: MCPToolEffectsManagerProps): JSX.Element {
  return (
    <group name="mcp-effects-manager">
      {effects.map((effect) => (
        <MCPToolEffect
          key={effect.id}
          id={effect.id}
          toolName={effect.toolName}
          agentPosition={effect.agentPosition}
          buildingPosition={effect.buildingPosition}
          onComplete={() => onEffectComplete?.(effect.id)}
        />
      ))}
    </group>
  );
}

export default MCPToolEffect;
