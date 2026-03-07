/**
 * ParticleFlow Component
 * Animated particles flowing between two 3D points along a bezier curve
 *
 * Uses instanced mesh for performance with 100+ particles.
 * Particles fade in at start point and fade out at end point.
 *
 * @module components/visualization/ParticleFlow
 *
 * @example
 * // Basic usage
 * <ParticleFlow
 *   startPosition={[0, 0, 0]}
 *   endPosition={[5, 2, 0]}
 *   color="#3b82f6"
 * />
 *
 * @example
 * // With all props configured
 * <ParticleFlow
 *   startPosition={agentPosition}
 *   endPosition={proxyPosition}
 *   color={PARTICLE_COLORS.agentToProxy}
 *   speed={1.5}
 *   density={15}
 *   maxParticles={30}
 *   particleSize={0.08}
 *   curveHeight={0.5}
 *   active={isDataFlowing}
 * />
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { ParticleFlowProps, Particle } from "../../types/visualization";

/**
 * ParticleFlow - Animated particles flowing between two 3D points
 *
 * @param props - ParticleFlow configuration props
 * @returns JSX element containing instanced mesh of particles
 */
export function ParticleFlow({
  startPosition,
  endPosition,
  color,
  speed = 1,
  density = 10,
  maxParticles = 50,
  active = true,
  particleSize = 0.05,
  curveHeight = 0.3,
}: ParticleFlowProps): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastSpawnRef = useRef<number>(0);

  // Reusable objects to avoid GC pressure in animation loop
  const tempObject = useMemo(() => new THREE.Object3D(), []);

  // Calculate bezier curve control points
  const curvePoints = useMemo(() => {
    const start = new THREE.Vector3(...startPosition);
    const end = new THREE.Vector3(...endPosition);
    const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);

    // Raise mid-point based on distance and curveHeight factor
    const distance = start.distanceTo(end);
    mid.y += distance * curveHeight;

    return { start, mid, end };
  }, [startPosition, endPosition, curveHeight]);

  // Memoize geometry to prevent recreation
  const geometry = useMemo(
    () => new THREE.SphereGeometry(particleSize, 8, 8),
    [particleSize]
  );

  // Memoize material to prevent recreation
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
      }),
    [color]
  );

  // Initialize particle pool
  useEffect(() => {
    particlesRef.current = Array.from({ length: maxParticles }, () => ({
      progress: 0,
      active: false,
      spawnTime: 0,
    }));
  }, [maxParticles]);

  // Cleanup geometry and material on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Animation loop
  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const now = state.clock.elapsedTime;
    const spawnInterval = 1 / density;
    const particles = particlesRef.current;
    const mesh = meshRef.current;

    // Spawn new particles based on density
    if (active && now - lastSpawnRef.current > spawnInterval) {
      const inactiveIndex = particles.findIndex((p) => !p.active);
      if (inactiveIndex !== -1) {
        particles[inactiveIndex] = {
          progress: 0,
          active: true,
          spawnTime: now,
        };
        lastSpawnRef.current = now;
      }
    }

    // Update all particles
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];

      if (particle.active) {
        // Update progress along curve
        particle.progress += delta * speed * 0.5;

        // Deactivate when reaching end
        if (particle.progress >= 1) {
          particle.active = false;
          particle.progress = 0;
        }
      }

      if (particle.active) {
        // Calculate position on quadratic bezier curve
        // B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
        const t = particle.progress;
        const oneMinusT = 1 - t;

        tempObject.position.set(
          oneMinusT * oneMinusT * curvePoints.start.x +
            2 * oneMinusT * t * curvePoints.mid.x +
            t * t * curvePoints.end.x,
          oneMinusT * oneMinusT * curvePoints.start.y +
            2 * oneMinusT * t * curvePoints.mid.y +
            t * t * curvePoints.end.y,
          oneMinusT * oneMinusT * curvePoints.start.z +
            2 * oneMinusT * t * curvePoints.mid.z +
            t * t * curvePoints.end.z
        );

        // Scale for fade in/out effect
        // Fade in over first 20% (t=0 to t=0.2)
        // Fade out over last 20% (t=0.8 to t=1)
        const fadeIn = Math.min(t * 5, 1);
        const fadeOut = Math.min((1 - t) * 5, 1);
        const scale = fadeIn * fadeOut;
        tempObject.scale.setScalar(scale);

        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);
      } else {
        // Hide inactive particles by scaling to 0
        tempObject.scale.setScalar(0);
        tempObject.updateMatrix();
        mesh.setMatrixAt(i, tempObject.matrix);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxParticles]}
      frustumCulled={false}
    />
  );
}
