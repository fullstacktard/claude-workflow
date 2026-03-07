/**
 * DataFlowParticles Component
 *
 * Visualizes data flowing between agents and buildings:
 * - Streaming particles showing information transfer
 * - Color-coded based on data type
 * - Pulse effects for active connections
 * - Network graph visualization
 *
 * @module components/visualization/DataFlowParticles
 */

import { useRef, useMemo, useCallback, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

export const DATA_FLOW_CONFIG = {
  /** Particles per active connection */
  particlesPerConnection: 20,
  /** Particle travel speed */
  travelSpeed: 3,
  /** Particle size */
  particleSize: 0.08,
  /** Glow size multiplier */
  glowMultiplier: 2.5,
  /** Trail length (number of positions to remember) */
  trailLength: 5,
  /** Pulse frequency */
  pulseFrequency: 2,
  /** Connection arc height */
  arcHeight: 2,
  /** Data type colors */
  dataColors: {
    default: 0x60a5fa, // Blue
    request: 0x4ade80, // Green
    response: 0xfbbf24, // Yellow
    error: 0xf87171, // Red
    tool: 0xc084fc, // Purple
    skill: 0x22d3ee, // Cyan
  },
} as const;

// =============================================================================
// Types
// =============================================================================

export interface DataConnection {
  /** Unique connection ID */
  id: string;
  /** Start position */
  from: THREE.Vector3;
  /** End position */
  to: THREE.Vector3;
  /** Data type for coloring */
  dataType?: keyof typeof DATA_FLOW_CONFIG.dataColors;
  /** Connection strength (affects particle count) */
  strength?: number;
  /** Is connection active */
  active?: boolean;
}

interface FlowParticle {
  position: THREE.Vector3;
  progress: number; // 0-1 along the path
  speed: number;
  size: number;
  trail: THREE.Vector3[];
}

// =============================================================================
// Bezier Path Utilities
// =============================================================================

/**
 * Calculate point on quadratic bezier curve
 */
function getPointOnBezier(
  start: THREE.Vector3,
  control: THREE.Vector3,
  end: THREE.Vector3,
  t: number
): THREE.Vector3 {
  const result = new THREE.Vector3();
  const u = 1 - t;

  result.x = u * u * start.x + 2 * u * t * control.x + t * t * end.x;
  result.y = u * u * start.y + 2 * u * t * control.y + t * t * end.y;
  result.z = u * u * start.z + 2 * u * t * control.z + t * t * end.z;

  return result;
}

/**
 * Calculate control point for arc between two points
 */
function getArcControlPoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  arcHeight: number
): THREE.Vector3 {
  const midpoint = new THREE.Vector3()
    .addVectors(start, end)
    .multiplyScalar(0.5);

  // Add height to create arc
  midpoint.y += arcHeight;

  return midpoint;
}

// =============================================================================
// Single Connection Flow Component
// =============================================================================

interface ConnectionFlowProps {
  connection: DataConnection;
}

/**
 * ConnectionFlow - Renders flowing particles for a single connection
 */
function ConnectionFlow({ connection }: ConnectionFlowProps): JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<FlowParticle[]>([]);

  const { from, to, dataType = "default", strength = 1, active = true } = connection;

  // Calculate arc control point
  const controlPoint = useMemo(
    () => getArcControlPoint(from, to, DATA_FLOW_CONFIG.arcHeight),
    [from, to]
  );

  // Get color for this connection
  const color = useMemo(
    () => new THREE.Color(DATA_FLOW_CONFIG.dataColors[dataType]),
    [dataType]
  );

  // Initialize particles
  useMemo(() => {
    const count = Math.floor(
      DATA_FLOW_CONFIG.particlesPerConnection * strength
    );
    particlesRef.current = [];

    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        position: from.clone(),
        progress: i / count, // Distribute along path
        speed:
          DATA_FLOW_CONFIG.travelSpeed * (0.8 + Math.random() * 0.4),
        size: DATA_FLOW_CONFIG.particleSize * (0.8 + Math.random() * 0.4),
        trail: [],
      });
    }
  }, [from, strength]);

  // Geometry and materials
  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 6, 6), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(0.1, 6, 6), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      }),
    [color]
  );

  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color]
  );

  // Animation
  useFrame((state, delta) => {
    if (!meshRef.current || !glowMeshRef.current || !active) return;

    const particles = particlesRef.current;
    const dummy = new THREE.Object3D();
    const time = state.clock.elapsedTime;

    // Pulsing effect
    const pulse = 0.8 + Math.sin(time * DATA_FLOW_CONFIG.pulseFrequency) * 0.2;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Update progress
      p.progress += (p.speed * delta) / from.distanceTo(to);

      // Loop back to start
      if (p.progress > 1) {
        p.progress = 0;
        p.trail = [];
      }

      // Calculate position on bezier curve
      const newPos = getPointOnBezier(from, controlPoint, to, p.progress);
      p.position.copy(newPos);

      // Update trail
      p.trail.unshift(newPos.clone());
      if (p.trail.length > DATA_FLOW_CONFIG.trailLength) {
        p.trail.pop();
      }

      // Update instance
      dummy.position.copy(p.position);
      dummy.scale.setScalar(p.size * pulse);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Glow
      dummy.scale.setScalar(p.size * DATA_FLOW_CONFIG.glowMultiplier * pulse);
      dummy.updateMatrix();
      glowMeshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  const particleCount = Math.floor(
    DATA_FLOW_CONFIG.particlesPerConnection * strength
  );

  if (!active) return <></>;

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
// Connection Line Component
// =============================================================================

interface ConnectionLineProps {
  connection: DataConnection;
}

/**
 * ConnectionLine - Renders the arc path as a subtle line
 */
function ConnectionLine({ connection }: ConnectionLineProps): JSX.Element {
  const { from, to, dataType = "default", active = true } = connection;

  // Generate bezier curve points
  const lineObject = useMemo(() => {
    const controlPoint = getArcControlPoint(from, to, DATA_FLOW_CONFIG.arcHeight);
    const points: THREE.Vector3[] = [];
    const segments = 32;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      points.push(getPointOnBezier(from, controlPoint, to, t));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const color = DATA_FLOW_CONFIG.dataColors[dataType];
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: active ? 0.3 : 0.1,
      blending: THREE.AdditiveBlending,
    });

    return new THREE.Line(geometry, material);
  }, [from, to, dataType, active]);

  return <primitive object={lineObject} />;
}

// =============================================================================
// Main Data Flow Manager Component
// =============================================================================

export interface DataFlowParticlesProps {
  /** Active connections to visualize */
  connections: DataConnection[];
  /** Show connection lines */
  showLines?: boolean;
  /** Global intensity multiplier */
  intensity?: number;
}

/**
 * DataFlowParticles - Manages all data flow visualizations
 *
 * @example
 * ```tsx
 * const connections = [
 *   {
 *     id: 'agent-to-mcp',
 *     from: new THREE.Vector3(0, 1, 0),
 *     to: new THREE.Vector3(5, 1, 5),
 *     dataType: 'request',
 *     active: true
 *   }
 * ];
 *
 * <DataFlowParticles connections={connections} />
 * ```
 */
export function DataFlowParticles({
  connections,
  showLines = true,
  intensity = 1,
}: DataFlowParticlesProps): JSX.Element {
  return (
    <group name="data-flow-particles">
      {/* Connection lines */}
      {showLines &&
        connections.map((conn) => (
          <ConnectionLine key={`line-${conn.id}`} connection={conn} />
        ))}

      {/* Flowing particles */}
      {connections
        .filter((c) => c.active !== false)
        .map((conn) => (
          <ConnectionFlow
            key={`flow-${conn.id}`}
            connection={{
              ...conn,
              strength: (conn.strength ?? 1) * intensity,
            }}
          />
        ))}
    </group>
  );
}

// =============================================================================
// Network Graph Component
// =============================================================================

export interface NetworkNode {
  id: string;
  position: THREE.Vector3;
  label?: string;
  type?: "agent" | "building" | "tool";
}

export interface NetworkGraphProps {
  /** Nodes in the network */
  nodes: NetworkNode[];
  /** Connections between nodes */
  connections: Array<{
    from: string;
    to: string;
    dataType?: keyof typeof DATA_FLOW_CONFIG.dataColors;
    active?: boolean;
  }>;
  /** Show node labels */
  showLabels?: boolean;
}

/**
 * NetworkGraph - Visualizes a network of nodes with flowing data
 */
export function NetworkGraph({
  nodes,
  connections: connectionDefs,
  showLabels = false,
}: NetworkGraphProps): JSX.Element {
  // Convert node IDs to positions
  const connections = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    return connectionDefs
      .map((c) => {
        const fromNode = nodeMap.get(c.from);
        const toNode = nodeMap.get(c.to);

        if (!fromNode || !toNode) return null;

        return {
          id: `${c.from}-${c.to}`,
          from: fromNode.position,
          to: toNode.position,
          dataType: c.dataType,
          active: c.active,
        } as DataConnection;
      })
      .filter((c): c is DataConnection => c !== null);
  }, [nodes, connectionDefs]);

  return (
    <group name="network-graph">
      {/* Node markers */}
      {nodes.map((node) => (
        <group key={node.id} position={node.position}>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial
              color={
                node.type === "agent"
                  ? 0x60a5fa
                  : node.type === "building"
                    ? 0xfbbf24
                    : 0xc084fc
              }
              transparent
              opacity={0.8}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial
              color={0xffffff}
              transparent
              opacity={0.2}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}

      {/* Data flow */}
      <DataFlowParticles connections={connections} />
    </group>
  );
}

export default DataFlowParticles;
