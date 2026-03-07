/**
 * ConnectionBeam Component
 * Renders glowing animated connection lines between 3D entities
 *
 * Used to visualize relationships and data flow between:
 * - Agents and their projects
 * - Projects and the central MCP hub
 * - Agent-to-agent connections
 *
 * Features:
 * - Pulsing animation for active connections
 * - Dimmed state for inactive connections
 * - Glow effect via layered lines with additive blending
 * - Smooth position updates
 *
 * @module components/visualization/ConnectionBeam
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

/**
 * Point in 3D space represented as a tuple
 */
export type Point3D = [number, number, number];

/**
 * Props for the ConnectionBeam component
 */
export interface ConnectionBeamProps {
  /** Starting point in 3D space [x, y, z] */
  start: Point3D;
  /** Ending point in 3D space [x, y, z] */
  end: Point3D;
  /** Base color of the beam (hex string, CSS color, or Three.js color name) */
  color: string;
  /** Whether the connection is currently active (shows pulse animation) */
  active?: boolean;
  /** Speed multiplier for the pulse animation (default: 1.0) */
  pulseSpeed?: number;
  /** Width of the core line in pixels (default: 2) */
  lineWidth?: number;
  /** Opacity for inactive connections (default: 0.3) */
  inactiveOpacity?: number;
  /** Intensity of the glow effect (default: 0.5) */
  glowIntensity?: number;
  /** Enable curved beam path (default: false for straight lines) */
  curved?: boolean;
}

/**
 * Connection type for batch rendering
 */
export interface Connection {
  /** Unique identifier for the connection */
  id: string;
  /** Starting point in 3D space */
  start: Point3D;
  /** Ending point in 3D space */
  end: Point3D;
  /** Connection color */
  color: string;
  /** Whether the connection is active */
  active: boolean;
  /** Type of connection for styling/sorting */
  type: "agent-project" | "project-hub" | "agent-agent";
}

/**
 * Props for the ConnectionBeamGroup component
 */
export interface ConnectionBeamGroupProps {
  /** Array of connections to render */
  connections: Connection[];
  /** Pulse speed for active connections */
  pulseSpeed?: number;
  /** Line width for all connections */
  lineWidth?: number;
}

/**
 * Generate points along a curved path between start and end
 * Uses quadratic bezier interpolation with a slight upward arc
 */
function generateCurvedPoints(
  start: Point3D,
  end: Point3D,
  segments: number = 20
): Point3D[] {
  const points: Point3D[] = [];

  // Calculate midpoint with upward arc
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const arcHeight = Math.min(distance * 0.15, 2); // Cap arc height

  const midPoint: Point3D = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2 + arcHeight,
    (start[2] + end[2]) / 2,
  ];

  // Generate points along quadratic bezier curve
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const oneMinusT = 1 - t;

    // Quadratic bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
    const x =
      oneMinusT * oneMinusT * start[0] +
      2 * oneMinusT * t * midPoint[0] +
      t * t * end[0];
    const y =
      oneMinusT * oneMinusT * start[1] +
      2 * oneMinusT * t * midPoint[1] +
      t * t * end[1];
    const z =
      oneMinusT * oneMinusT * start[2] +
      2 * oneMinusT * t * midPoint[2] +
      t * t * end[2];

    points.push([x, y, z]);
  }

  return points;
}

/**
 * ConnectionBeam - Animated glowing connection line between two 3D points
 *
 * Renders a multi-layered line with:
 * - Core line: Bright, thin
 * - Inner glow: Medium width, medium opacity, additive blend
 * - Outer glow: Wide, low opacity, additive blend
 *
 * @example
 * ```tsx
 * <ConnectionBeam
 *   start={[0, 0, 0]}
 *   end={[5, 2, 3]}
 *   color="#00ff88"
 *   active={true}
 *   pulseSpeed={1.5}
 * />
 * ```
 */
export function ConnectionBeam({
  start,
  end,
  color,
  active = false,
  pulseSpeed = 1.0,
  lineWidth = 2,
  inactiveOpacity = 0.3,
  glowIntensity = 0.5,
  curved = false,
}: ConnectionBeamProps): JSX.Element {
  // Refs for animated materials
  const coreMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const innerGlowMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const outerGlowMaterialRef = useRef<THREE.LineBasicMaterial>(null);

  // Memoize Three.js color object
  const threeColor = useMemo(() => new THREE.Color(color), [color]);

  // Memoize points array - straight line or curved path
  const points = useMemo((): Point3D[] => {
    if (curved) {
      return generateCurvedPoints(start, end);
    }
    return [start, end];
  }, [start, end, curved]);

  // Animation loop for pulse effect
  useFrame((state) => {
    if (
      !coreMaterialRef.current ||
      !innerGlowMaterialRef.current ||
      !outerGlowMaterialRef.current
    ) {
      return;
    }

    if (active) {
      // Pulsing animation using sine wave for smooth transitions
      // Frequency controlled by pulseSpeed, amplitude creates subtle pulse
      const pulse =
        Math.sin(state.clock.elapsedTime * pulseSpeed * Math.PI * 2) * 0.2 +
        0.8;
      const glowPulse =
        Math.sin(state.clock.elapsedTime * pulseSpeed * Math.PI * 2 + 0.5) *
          0.15 +
        0.85;

      coreMaterialRef.current.opacity = pulse;
      innerGlowMaterialRef.current.opacity = glowPulse * glowIntensity * 0.6;
      outerGlowMaterialRef.current.opacity = glowPulse * glowIntensity * 0.3;
    } else {
      // Static dimmed state for inactive connections
      coreMaterialRef.current.opacity = inactiveOpacity;
      innerGlowMaterialRef.current.opacity = inactiveOpacity * 0.3;
      outerGlowMaterialRef.current.opacity = inactiveOpacity * 0.15;
    }
  });

  return (
    <group name="connection-beam">
      {/* Outer glow layer - widest, most transparent */}
      <Line points={points} lineWidth={lineWidth * 4}>
        <lineBasicMaterial
          ref={outerGlowMaterialRef}
          color={threeColor}
          transparent
          opacity={active ? glowIntensity * 0.3 : inactiveOpacity * 0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </Line>

      {/* Inner glow layer - medium width */}
      <Line points={points} lineWidth={lineWidth * 2.5}>
        <lineBasicMaterial
          ref={innerGlowMaterialRef}
          color={threeColor}
          transparent
          opacity={active ? glowIntensity * 0.6 : inactiveOpacity * 0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </Line>

      {/* Core line - thin and bright */}
      <Line points={points} lineWidth={lineWidth}>
        <lineBasicMaterial
          ref={coreMaterialRef}
          color={threeColor}
          transparent
          opacity={active ? 0.9 : inactiveOpacity}
          depthWrite={false}
        />
      </Line>
    </group>
  );
}

/**
 * ConnectionBeamGroup - Efficiently render multiple connection beams
 *
 * Handles sorting to minimize z-fighting and provides consistent
 * styling across all connections.
 *
 * @example
 * ```tsx
 * const connections = [
 *   { id: 'c1', start: [0,0,0], end: [5,0,0], color: '#0ff', active: true, type: 'agent-project' },
 *   { id: 'c2', start: [0,0,0], end: [0,5,0], color: '#ff0', active: false, type: 'project-hub' },
 * ];
 *
 * <ConnectionBeamGroup connections={connections} pulseSpeed={1.2} />
 * ```
 */
export function ConnectionBeamGroup({
  connections,
  pulseSpeed = 1.0,
  lineWidth = 2,
}: ConnectionBeamGroupProps): JSX.Element {
  // Sort connections by type for consistent rendering order
  // This reduces z-fighting issues with overlapping transparent lines
  const sortedConnections = useMemo(() => {
    const typeOrder: Record<Connection["type"], number> = {
      "agent-project": 0,
      "project-hub": 1,
      "agent-agent": 2,
    };

    return [...connections].sort((a, b) => {
      return typeOrder[a.type] - typeOrder[b.type];
    });
  }, [connections]);

  return (
    <group name="connection-beam-group">
      {sortedConnections.map((conn) => (
        <ConnectionBeam
          key={conn.id}
          start={conn.start}
          end={conn.end}
          color={conn.color}
          active={conn.active}
          pulseSpeed={pulseSpeed}
          lineWidth={lineWidth}
        />
      ))}
    </group>
  );
}

export default ConnectionBeam;
