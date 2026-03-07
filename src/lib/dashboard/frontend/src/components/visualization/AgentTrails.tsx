/**
 * AgentTrails Component
 *
 * Creates magical trailing particle effects that follow walking agents:
 * - Glowing particles that spawn behind moving agents
 * - Color-coded based on agent type
 * - Fading trails with sparkle effects
 * - Performance optimized with object pooling
 *
 * @module components/visualization/AgentTrails
 */

import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getAgentHexColor } from "../../config/visualization-config";

// =============================================================================
// Configuration
// =============================================================================

export const TRAIL_CONFIG = {
  /** Maximum particles per agent trail */
  maxParticlesPerAgent: 30,
  /** Maximum number of agent trails to track */
  maxAgents: 50,
  /** Particle spawn interval (seconds) */
  spawnInterval: 0.05,
  /** Particle lifetime (seconds) */
  particleLifetime: 1.5,
  /** Initial particle size */
  particleSize: 0.15,
  /** Particle rise speed */
  riseSpeed: 0.3,
  /** Spread radius for particles */
  spreadRadius: 0.2,
  /** Trail glow intensity */
  glowIntensity: 0.8,
} as const;

// =============================================================================
// Types
// =============================================================================

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  life: number;
  maxLife: number;
  size: number;
}

interface AgentTrailState {
  agentId: string;
  agentType: string;
  lastPosition: THREE.Vector3;
  particles: Particle[];
  timeSinceSpawn: number;
  isMoving: boolean;
}

// =============================================================================
// Trail Particle System
// =============================================================================

export interface AgentTrailsProps {
  /** Array of agent data to track trails for */
  agents: Array<{
    id: string;
    type: string;
    position: [number, number, number];
    isWalking: boolean;
  }>;
  /** Enable/disable trails */
  enabled?: boolean;
}

/**
 * AgentTrails - Manages particle trails for all walking agents
 */
export function AgentTrails({
  agents,
  enabled = true,
}: AgentTrailsProps): JSX.Element | null {
  // Trail state for each agent
  const trailsRef = useRef<Map<string, AgentTrailState>>(new Map());

  // All particles for instanced rendering
  const allParticlesRef = useRef<Particle[]>([]);

  // Instanced mesh ref
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);

  // Total particle count
  const maxTotalParticles =
    TRAIL_CONFIG.maxAgents * TRAIL_CONFIG.maxParticlesPerAgent;

  // Geometry and materials
  const geometry = useMemo(() => new THREE.SphereGeometry(0.1, 8, 8), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(0.2, 8, 8), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
      }),
    []
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Create a new particle at agent position
  const createParticle = useCallback(
    (position: THREE.Vector3, agentType: string): Particle => {
      const color = new THREE.Color(getAgentHexColor(agentType));

      // Add slight position variance
      const spread = TRAIL_CONFIG.spreadRadius;
      const offsetPos = new THREE.Vector3(
        position.x + (Math.random() - 0.5) * spread,
        position.y + Math.random() * 0.1,
        position.z + (Math.random() - 0.5) * spread
      );

      return {
        position: offsetPos,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.2,
          TRAIL_CONFIG.riseSpeed + Math.random() * 0.1,
          (Math.random() - 0.5) * 0.2
        ),
        color: color,
        life: TRAIL_CONFIG.particleLifetime,
        maxLife: TRAIL_CONFIG.particleLifetime,
        size: TRAIL_CONFIG.particleSize * (0.8 + Math.random() * 0.4),
      };
    },
    []
  );

  // Update trails each frame
  useFrame((state, delta) => {
    if (!enabled || !meshRef.current || !glowMeshRef.current) return;

    const trails = trailsRef.current;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Update or create trail state for each agent
    for (const agent of agents) {
      const currentPos = new THREE.Vector3(...agent.position);

      let trail = trails.get(agent.id);

      if (!trail) {
        // Create new trail state
        trail = {
          agentId: agent.id,
          agentType: agent.type,
          lastPosition: currentPos.clone(),
          particles: [],
          timeSinceSpawn: 0,
          isMoving: false,
        };
        trails.set(agent.id, trail);
      }

      // Check if agent is moving
      const distance = trail.lastPosition.distanceTo(currentPos);
      trail.isMoving = agent.isWalking && distance > 0.01;

      // Spawn new particles if moving
      if (trail.isMoving) {
        trail.timeSinceSpawn += delta;

        if (trail.timeSinceSpawn >= TRAIL_CONFIG.spawnInterval) {
          trail.timeSinceSpawn = 0;

          // Remove oldest particle if at max
          if (trail.particles.length >= TRAIL_CONFIG.maxParticlesPerAgent) {
            trail.particles.shift();
          }

          // Add new particle
          trail.particles.push(createParticle(currentPos, trail.agentType));
        }
      }

      trail.lastPosition.copy(currentPos);

      // Update particles
      trail.particles = trail.particles.filter((particle) => {
        particle.life -= delta;
        if (particle.life <= 0) return false;

        // Update position
        particle.position.add(particle.velocity.clone().multiplyScalar(delta));

        // Add some swirl
        const time = state.clock.elapsedTime;
        particle.position.x += Math.sin(time * 3 + particle.maxLife) * delta * 0.1;
        particle.position.z += Math.cos(time * 3 + particle.maxLife) * delta * 0.1;

        return true;
      });
    }

    // Remove trails for agents that no longer exist
    for (const [id] of trails) {
      if (!agents.find((a) => a.id === id)) {
        trails.delete(id);
      }
    }

    // Collect all particles for rendering
    allParticlesRef.current = [];
    for (const trail of trails.values()) {
      allParticlesRef.current.push(...trail.particles);
    }

    // Update instanced meshes
    const particles = allParticlesRef.current;

    for (let i = 0; i < maxTotalParticles; i++) {
      if (i < particles.length) {
        const p = particles[i];
        const lifeRatio = p.life / p.maxLife;

        // Position
        dummy.position.copy(p.position);

        // Scale based on life (shrink as it fades)
        const scale = p.size * lifeRatio;
        dummy.scale.setScalar(scale);

        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);

        // Glow is larger
        dummy.scale.setScalar(scale * 2);
        dummy.updateMatrix();
        glowMeshRef.current.setMatrixAt(i, dummy.matrix);

        // Color with fading alpha
        color.copy(p.color);
        meshRef.current.setColorAt(i, color);

        // Glow color (slightly brighter)
        color.multiplyScalar(1.2);
        glowMeshRef.current.setColorAt(i, color);
      } else {
        // Hide unused instances
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        glowMeshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
    if (glowMeshRef.current.instanceColor) {
      glowMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (!enabled) return null;

  return (
    <group name="agent-trails">
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, maxTotalParticles]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[glowGeometry, glowMaterial, maxTotalParticles]}
        frustumCulled={false}
      />
    </group>
  );
}

// =============================================================================
// Single Agent Trail Component
// =============================================================================

interface SingleAgentTrailProps {
  /** Agent ID */
  agentId: string;
  /** Agent type for color */
  agentType: string;
  /** Current position */
  position: THREE.Vector3;
  /** Whether agent is currently walking */
  isWalking: boolean;
}

/**
 * SingleAgentTrail - Trail effect for a single agent
 * Use this if you need per-agent trail control
 */
export function SingleAgentTrail({
  agentId,
  agentType,
  position,
  isWalking,
}: SingleAgentTrailProps): JSX.Element | null {
  const particlesRef = useRef<Particle[]>([]);
  const lastPositionRef = useRef<THREE.Vector3>(position.clone());
  const timeSinceSpawnRef = useRef(0);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const color = useMemo(
    () => new THREE.Color(getAgentHexColor(agentType)),
    [agentType]
  );

  const geometry = useMemo(() => new THREE.SphereGeometry(0.08, 6, 6), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const particles = particlesRef.current;
    const dummy = new THREE.Object3D();

    // Check if moving
    const distance = lastPositionRef.current.distanceTo(position);
    const isMoving = isWalking && distance > 0.01;

    // Spawn new particles
    if (isMoving) {
      timeSinceSpawnRef.current += delta;

      if (timeSinceSpawnRef.current >= TRAIL_CONFIG.spawnInterval) {
        timeSinceSpawnRef.current = 0;

        if (particles.length < TRAIL_CONFIG.maxParticlesPerAgent) {
          const spread = TRAIL_CONFIG.spreadRadius;
          particles.push({
            position: new THREE.Vector3(
              position.x + (Math.random() - 0.5) * spread,
              position.y,
              position.z + (Math.random() - 0.5) * spread
            ),
            velocity: new THREE.Vector3(
              (Math.random() - 0.5) * 0.1,
              TRAIL_CONFIG.riseSpeed * 0.5,
              (Math.random() - 0.5) * 0.1
            ),
            color: color.clone(),
            life: TRAIL_CONFIG.particleLifetime,
            maxLife: TRAIL_CONFIG.particleLifetime,
            size: TRAIL_CONFIG.particleSize,
          });
        }
      }
    }

    lastPositionRef.current.copy(position);

    // Update and render particles
    for (let i = 0; i < TRAIL_CONFIG.maxParticlesPerAgent; i++) {
      if (i < particles.length) {
        const p = particles[i];
        p.life -= delta;

        if (p.life <= 0) {
          particles.splice(i, 1);
          i--;
          continue;
        }

        // Update position
        p.position.add(p.velocity.clone().multiplyScalar(delta));

        const lifeRatio = p.life / p.maxLife;
        dummy.position.copy(p.position);
        dummy.scale.setScalar(p.size * lifeRatio);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, TRAIL_CONFIG.maxParticlesPerAgent]}
      frustumCulled={false}
    />
  );
}

export default AgentTrails;
