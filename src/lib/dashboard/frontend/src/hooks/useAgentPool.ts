/**
 * useAgentPool Hook
 *
 * Object pooling system for Three.js agent groups to reduce GC pressure
 * during frequent spawn/despawn cycles in the 3D visualization.
 *
 * Features:
 * - Pre-allocates pool of agent objects on mount
 * - acquire() returns pooled or new object
 * - release() resets state and returns to pool
 * - Dynamic pool growth when demand exceeds capacity
 * - Full cleanup on unmount
 *
 * @module hooks/useAgentPool
 */

import { useRef, useCallback, useEffect } from "react";
import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

/**
 * Pooled agent object containing Three.js Group and associated state
 */
export interface PooledAgent {
  /** Unique identifier when acquired (null when in pool) */
  agentId: string | null;
  /** Three.js Group containing agent mesh and children */
  group: THREE.Group;
  /** Whether this object is currently in use */
  inUse: boolean;
  /** Timestamp when acquired (for debug tracking) */
  acquiredAt: number | null;
}

/**
 * Pool statistics for debugging and monitoring
 */
export interface PoolStats {
  /** Total objects in pool (in use + available) */
  totalSize: number;
  /** Objects currently in use */
  inUse: number;
  /** Objects available for acquisition */
  available: number;
  /** Peak concurrent usage */
  peakUsage: number;
  /** Total acquisitions since mount */
  totalAcquisitions: number;
  /** Total releases since mount */
  totalReleases: number;
}

/**
 * Return type for useAgentPool hook
 */
export interface UseAgentPoolResult {
  /** Acquire an agent object from the pool */
  acquire: (agentId: string) => PooledAgent;
  /** Release an agent object back to the pool */
  release: (agentId: string) => void;
  /** Get a pooled agent by ID (if acquired) */
  getAgent: (agentId: string) => PooledAgent | null;
  /** Get current pool statistics */
  getStats: () => PoolStats;
  /** Check if an agent is currently acquired */
  isAcquired: (agentId: string) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Initial pool size (pre-allocated on mount) */
const INITIAL_POOL_SIZE = 20;

/** Growth increment when pool is exhausted */
const POOL_GROWTH_SIZE = 5;

/** Enable debug logging in development */
const DEBUG_LOGGING = process.env.NODE_ENV === "development";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new pooled agent object
 * Creates a minimal Three.js Group that can be populated by AgentCharacter
 */
function createPooledAgent(): PooledAgent {
  const group = new THREE.Group();
  group.name = "pooled-agent";
  group.visible = false; // Hidden until acquired

  return {
    agentId: null,
    group,
    inUse: false,
    acquiredAt: null,
  };
}

/**
 * Reset a pooled agent to initial state for reuse
 * CRITICAL: Must reset ALL state to prevent visual artifacts
 *
 * Reset checklist:
 * - Position reset to [0, 0, 0]
 * - Rotation reset to identity
 * - Scale reset to 1
 * - Walk target cleared
 * - Animation state set to idle
 * - All refs cleared
 */
function resetPooledAgent(agent: PooledAgent): void {
  const { group } = agent;

  // 1. Position reset to [0, 0, 0]
  group.position.set(0, 0, 0);

  // 2. Rotation reset to identity
  group.rotation.set(0, 0, 0);
  group.quaternion.identity();

  // 3. Scale reset to 1
  group.scale.set(1, 1, 1);

  // 4. Reset matrix
  group.updateMatrix();
  group.matrixAutoUpdate = true;

  // 5. Hide until next acquisition
  group.visible = false;

  // 6. Clear name (will be set on acquire)
  group.name = "pooled-agent";

  // 7. Clear user data (walk targets, animation state, etc.)
  group.userData = {};

  // 8. Reset pool state
  agent.agentId = null;
  agent.inUse = false;
  agent.acquiredAt = null;

  // Note: Children (mesh, materials) are managed by AgentCharacter component
  // We don't remove children here as they may be reused
}

/**
 * Dispose all Three.js resources in a group
 * Called during cleanup/unmount
 */
function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Dispose geometry
      if (child.geometry) {
        child.geometry.dispose();
      }

      // Dispose material(s)
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            disposeMaterial(mat);
          });
        } else {
          disposeMaterial(child.material);
        }
      }
    }
  });

  // Clear children array
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

/**
 * Dispose a single material and its textures
 */
function disposeMaterial(material: THREE.Material): void {
  // Dispose all known texture map properties
  const textureProps: Array<keyof THREE.MeshStandardMaterial> = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "emissiveMap",
    "aoMap",
    "alphaMap",
    "bumpMap",
    "displacementMap",
    "envMap",
    "lightMap",
  ];

  for (const prop of textureProps) {
    const value = (material as unknown as Record<string, unknown>)[prop];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }

  material.dispose();
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing a pool of Three.js agent objects
 *
 * Pre-allocates agent objects to reduce garbage collection pressure
 * during frequent spawn/despawn cycles in the visualization.
 *
 * @returns Pool management functions and statistics
 *
 * @example
 * ```tsx
 * function AgentVisualization() {
 *   const { acquire, release, getStats } = useAgentPool();
 *
 *   // When agent spawns
 *   const pooledAgent = acquire("agent-123");
 *   pooledAgent.group.visible = true;
 *
 *   // When agent despawns
 *   release("agent-123");
 *
 *   // Debug: Check pool stats
 *   console.log(getStats());
 * }
 * ```
 */
export function useAgentPool(): UseAgentPoolResult {
  // Pool storage - uses ref to avoid re-renders on pool changes
  const poolRef = useRef<PooledAgent[]>([]);

  // Map of agentId -> pooled agent for O(1) lookup
  const activeMapRef = useRef<Map<string, PooledAgent>>(new Map());

  // Statistics tracking
  const statsRef = useRef<PoolStats>({
    totalSize: 0,
    inUse: 0,
    available: 0,
    peakUsage: 0,
    totalAcquisitions: 0,
    totalReleases: 0,
  });

  // Initialize pool on mount, cleanup on unmount
  useEffect(() => {
    if (DEBUG_LOGGING) {
      console.log(
        "[useAgentPool] Initializing pool with",
        INITIAL_POOL_SIZE,
        "objects"
      );
    }

    // Pre-allocate pool
    for (let i = 0; i < INITIAL_POOL_SIZE; i++) {
      poolRef.current.push(createPooledAgent());
    }

    // Update stats
    statsRef.current.totalSize = INITIAL_POOL_SIZE;
    statsRef.current.available = INITIAL_POOL_SIZE;

    // Cleanup on unmount
    return () => {
      if (DEBUG_LOGGING) {
        console.log(
          "[useAgentPool] Cleaning up pool, disposing",
          poolRef.current.length,
          "objects"
        );
      }

      // Dispose all objects in pool
      for (const agent of poolRef.current) {
        disposeGroup(agent.group);
      }

      // Clear references
      poolRef.current = [];
      activeMapRef.current.clear();
    };
  }, []);

  /**
   * Acquire an agent object from the pool
   * Returns existing if already acquired (idempotent)
   * Grows pool if exhausted
   */
  const acquire = useCallback((agentId: string): PooledAgent => {
    // Check if already acquired (idempotent)
    const existing = activeMapRef.current.get(agentId);
    if (existing) {
      if (DEBUG_LOGGING) {
        console.warn("[useAgentPool] Agent already acquired:", agentId);
      }
      return existing;
    }

    // Find available object in pool
    let agent = poolRef.current.find((a) => !a.inUse);

    // If pool exhausted, grow it
    if (!agent) {
      if (DEBUG_LOGGING) {
        console.log(
          "[useAgentPool] Pool exhausted, growing by",
          POOL_GROWTH_SIZE
        );
      }

      for (let i = 0; i < POOL_GROWTH_SIZE; i++) {
        poolRef.current.push(createPooledAgent());
      }

      statsRef.current.totalSize += POOL_GROWTH_SIZE;
      agent = poolRef.current[poolRef.current.length - POOL_GROWTH_SIZE];
    }

    // Mark as in use
    agent.agentId = agentId;
    agent.inUse = true;
    agent.acquiredAt = Date.now();
    agent.group.name = `agent-${agentId}`;
    agent.group.visible = true;

    // Add to active map
    activeMapRef.current.set(agentId, agent);

    // Update stats
    statsRef.current.inUse++;
    statsRef.current.available =
      statsRef.current.totalSize - statsRef.current.inUse;
    statsRef.current.totalAcquisitions++;

    if (statsRef.current.inUse > statsRef.current.peakUsage) {
      statsRef.current.peakUsage = statsRef.current.inUse;
    }

    if (DEBUG_LOGGING) {
      console.log(
        "[useAgentPool] Acquired:",
        agentId,
        "| In use:",
        statsRef.current.inUse,
        "| Available:",
        statsRef.current.available
      );
    }

    return agent;
  }, []);

  /**
   * Release an agent object back to the pool
   * Resets all state to prevent visual artifacts on reuse
   */
  const release = useCallback((agentId: string): void => {
    const agent = activeMapRef.current.get(agentId);

    if (!agent) {
      if (DEBUG_LOGGING) {
        console.warn(
          "[useAgentPool] Attempting to release unknown agent:",
          agentId
        );
      }
      return;
    }

    // Remove from active map
    activeMapRef.current.delete(agentId);

    // Reset state for reuse (prevents visual artifacts)
    resetPooledAgent(agent);

    // Update stats
    statsRef.current.inUse--;
    statsRef.current.available =
      statsRef.current.totalSize - statsRef.current.inUse;
    statsRef.current.totalReleases++;

    if (DEBUG_LOGGING) {
      console.log(
        "[useAgentPool] Released:",
        agentId,
        "| Available:",
        statsRef.current.available
      );
    }
  }, []);

  /**
   * Get a pooled agent by ID (if acquired)
   */
  const getAgent = useCallback((agentId: string): PooledAgent | null => {
    return activeMapRef.current.get(agentId) ?? null;
  }, []);

  /**
   * Get current pool statistics (returns a snapshot copy)
   */
  const getStats = useCallback((): PoolStats => {
    return { ...statsRef.current };
  }, []);

  /**
   * Check if an agent is currently acquired from the pool
   */
  const isAcquired = useCallback((agentId: string): boolean => {
    return activeMapRef.current.has(agentId);
  }, []);

  return {
    acquire,
    release,
    getAgent,
    getStats,
    isAcquired,
  };
}

export default useAgentPool;
