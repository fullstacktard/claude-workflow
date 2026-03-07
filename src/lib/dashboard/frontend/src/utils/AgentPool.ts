/**
 * AgentPool - Object Pooling for Agent Meshes
 *
 * Performance optimization that pre-creates a pool of agent meshes
 * that can be acquired and released instead of creating/destroying
 * on spawn/despawn.
 *
 * Benefits:
 * - Eliminates GC pressure from mesh creation/destruction
 * - Reduces frame drops during agent spawn/despawn
 * - Consistent memory usage during visualization
 *
 * @module utils/AgentPool
 */

import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

/**
 * Pooled agent entry
 */
interface PooledAgent {
  /** Unique identifier for tracking */
  id: string;
  /** The group containing the agent mesh */
  group: THREE.Group;
  /** Whether this agent is currently in use */
  inUse: boolean;
  /** Optional reference to the loaded model scene */
  modelScene?: THREE.Object3D;
}

/**
 * Pool configuration options
 */
export interface AgentPoolConfig {
  /** Initial pool size (default: 20) */
  initialSize?: number;
  /** Maximum pool size (default: 50) */
  maxSize?: number;
  /** Enable automatic pool expansion (default: true) */
  autoExpand?: boolean;
}

/**
 * Acquired agent from the pool
 */
export interface AcquiredAgent {
  /** Pool ID for releasing */
  poolId: string;
  /** The group to use for rendering */
  group: THREE.Group;
  /** Release this agent back to the pool */
  release: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_INITIAL_SIZE = 20;
const DEFAULT_MAX_SIZE = 50;

// ============================================================================
// AgentPool Class
// ============================================================================

/**
 * AgentPool manages a pool of reusable THREE.Group objects
 * for agent visualization.
 *
 * @example
 * ```ts
 * const pool = new AgentPool({ initialSize: 10 });
 *
 * // Acquire an agent for use
 * const agent = pool.acquire('agent-123');
 * if (agent) {
 *   scene.add(agent.group);
 *   // Configure and use agent...
 *
 *   // When done, release back to pool
 *   agent.release();
 * }
 *
 * // Clean up when done
 * pool.dispose();
 * ```
 */
export class AgentPool {
  private pool: Map<string, PooledAgent>;
  private availableIds: string[];
  private config: Required<AgentPoolConfig>;
  private idCounter: number;

  constructor(config: AgentPoolConfig = {}) {
    this.config = {
      initialSize: config.initialSize ?? DEFAULT_INITIAL_SIZE,
      maxSize: config.maxSize ?? DEFAULT_MAX_SIZE,
      autoExpand: config.autoExpand ?? true,
    };

    this.pool = new Map();
    this.availableIds = [];
    this.idCounter = 0;

    // Pre-create initial pool
    this.expandPool(this.config.initialSize);
  }

  /**
   * Expand the pool by creating new agents
   * @param count - Number of agents to create
   */
  private expandPool(count: number): void {
    const currentSize = this.pool.size;
    const maxNewAgents = Math.min(count, this.config.maxSize - currentSize);

    for (let i = 0; i < maxNewAgents; i++) {
      const id = `pool-agent-${this.idCounter++}`;
      const group = this.createAgentGroup();

      this.pool.set(id, {
        id,
        group,
        inUse: false,
      });

      this.availableIds.push(id);
    }
  }

  /**
   * Create a new agent group
   * Creates an empty group that will be populated with model data
   */
  private createAgentGroup(): THREE.Group {
    const group = new THREE.Group();
    group.visible = false; // Hidden by default until acquired
    group.name = 'pooled-agent';
    return group;
  }

  /**
   * Acquire an agent from the pool
   * @param agentId - Optional agent ID for tracking purposes
   * @returns Acquired agent with release function, or null if pool exhausted
   */
  acquire(agentId?: string): AcquiredAgent | null {
    // Try to get an available agent
    let poolId = this.availableIds.pop();

    // If no available agents, try to expand
    if (poolId === undefined) {
      if (this.config.autoExpand && this.pool.size < this.config.maxSize) {
        const expandCount = Math.min(5, this.config.maxSize - this.pool.size);
        this.expandPool(expandCount);
        poolId = this.availableIds.pop();
      }

      if (poolId === undefined) {
        console.warn(
          `[AgentPool] Pool exhausted (size: ${this.pool.size}, max: ${this.config.maxSize})`
        );
        return null;
      }
    }

    const agent = this.pool.get(poolId);
    if (!agent) return null;

    // Mark as in use
    agent.inUse = true;
    agent.group.visible = true;

    // Reset group transforms
    agent.group.position.set(0, 0, 0);
    agent.group.rotation.set(0, 0, 0);
    agent.group.scale.set(1, 1, 1);

    // Update name for debugging
    if (agentId) {
      agent.group.name = `pooled-agent-${agentId}`;
    }

    const finalPoolId = poolId;

    return {
      poolId: finalPoolId,
      group: agent.group,
      release: () => this.release(finalPoolId),
    };
  }

  /**
   * Release an agent back to the pool
   * @param poolId - The pool ID from the acquired agent
   */
  release(poolId: string): void {
    const agent = this.pool.get(poolId);
    if (!agent) {
      console.warn(`[AgentPool] Unknown pool ID: ${poolId}`);
      return;
    }

    if (!agent.inUse) {
      console.warn(`[AgentPool] Agent already released: ${poolId}`);
      return;
    }

    // Mark as available
    agent.inUse = false;
    agent.group.visible = false;
    agent.group.name = 'pooled-agent';

    // Clear children (model data) but keep the group
    while (agent.group.children.length > 0) {
      agent.group.remove(agent.group.children[0]);
    }

    // Clear model reference
    agent.modelScene = undefined;

    // Add back to available pool
    this.availableIds.push(poolId);
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    inUse: number;
    available: number;
    maxSize: number;
  } {
    let inUse = 0;
    for (const agent of this.pool.values()) {
      if (agent.inUse) inUse++;
    }

    return {
      total: this.pool.size,
      inUse,
      available: this.availableIds.length,
      maxSize: this.config.maxSize,
    };
  }

  /**
   * Dispose of all pooled agents
   * Call this when the pool is no longer needed
   */
  dispose(): void {
    for (const agent of this.pool.values()) {
      // Dispose of any geometries/materials in children
      agent.group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m.dispose());
          } else {
            object.material?.dispose();
          }
        }
      });

      // Clear children
      while (agent.group.children.length > 0) {
        agent.group.remove(agent.group.children[0]);
      }
    }

    this.pool.clear();
    this.availableIds = [];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global agent pool instance
 * Use this for application-wide agent pooling
 */
let globalPool: AgentPool | null = null;

/**
 * Get the global agent pool instance
 * Creates one if it doesn't exist
 */
export function getAgentPool(): AgentPool {
  if (!globalPool) {
    globalPool = new AgentPool({
      initialSize: 20,
      maxSize: 50,
      autoExpand: true,
    });
  }
  return globalPool;
}

/**
 * Dispose of the global agent pool
 * Call this when shutting down the visualization
 */
export function disposeAgentPool(): void {
  if (globalPool) {
    globalPool.dispose();
    globalPool = null;
  }
}

// ============================================================================
// React Hook
// ============================================================================

import { useRef, useEffect, useCallback } from "react";

/**
 * Hook for using the agent pool in React components
 *
 * @returns Functions to acquire and release pooled agents
 *
 * @example
 * ```tsx
 * function MyComponent({ agentId }) {
 *   const { acquire, release } = useAgentPool();
 *   const agentRef = useRef<AcquiredAgent | null>(null);
 *
 *   useEffect(() => {
 *     agentRef.current = acquire(agentId);
 *     return () => {
 *       agentRef.current?.release();
 *     };
 *   }, [agentId, acquire, release]);
 * }
 * ```
 */
export function useAgentPool(): {
  acquire: (agentId?: string) => AcquiredAgent | null;
  release: (poolId: string) => void;
  getStats: () => ReturnType<AgentPool['getStats']>;
} {
  const poolRef = useRef<AgentPool | null>(null);

  // Initialize pool on first use
  if (!poolRef.current) {
    poolRef.current = getAgentPool();
  }

  const acquire = useCallback((agentId?: string) => {
    return poolRef.current?.acquire(agentId) ?? null;
  }, []);

  const release = useCallback((poolId: string) => {
    poolRef.current?.release(poolId);
  }, []);

  const getStats = useCallback(() => {
    return poolRef.current?.getStats() ?? {
      total: 0,
      inUse: 0,
      available: 0,
      maxSize: 0,
    };
  }, []);

  // Cleanup on unmount (optional - pool persists for reuse)
  useEffect(() => {
    return () => {
      // Note: We don't dispose the global pool on component unmount
      // as other components may still be using it
    };
  }, []);

  return { acquire, release, getStats };
}
