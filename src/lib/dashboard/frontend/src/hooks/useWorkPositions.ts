/**
 * useWorkPositions Hook
 *
 * Manages work position allocation in the cotton field.
 * Agents claim positions when arriving and release them when leaving.
 *
 * Features:
 * - Track available and occupied work positions
 * - Assign positions to agents based on availability
 * - Support multiple positions around the field
 * - Provide position coordinates for agent targeting
 *
 * @module hooks/useWorkPositions
 */

import { useRef, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * A work position in the field
 */
export interface WorkPosition {
  /** Unique position identifier */
  id: string;
  /** World position [x, y, z] */
  position: [number, number, number];
  /** Rotation angle (facing direction) in radians */
  rotation: number;
  /** ID of agent currently at this position, or null if empty */
  occupiedBy: string | null;
}

/**
 * Hook result interface
 */
export interface UseWorkPositionsResult {
  /** Get all work positions */
  getAllPositions: () => WorkPosition[];
  /** Get available (unoccupied) positions */
  getAvailablePositions: () => WorkPosition[];
  /** Claim a position for an agent, returns position or null if none available */
  claimPosition: (agentId: string) => WorkPosition | null;
  /** Release a position when agent leaves */
  releasePosition: (agentId: string) => void;
  /** Get the position an agent is at */
  getAgentPosition: (agentId: string) => WorkPosition | null;
  /** Check if an agent has a position */
  hasAgentPosition: (agentId: string) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Cotton field center position (must match COTTON_FIELD_POSITION in CottonField.tsx)
 */
const WORK_AREA_CENTER: [number, number, number] = [0, 0, -14];

/**
 * Work positions around the cotton field perimeter
 * Agents walk to these positions when working in the field
 * Positions are arranged around the field edges for good visibility
 */
const WORK_POSITION_CONFIGS = [
  // East side - facing west (toward field)
  { pos: [6, 0, WORK_AREA_CENTER[2]] as [number, number, number], rot: Math.PI / 2, facingAngle: -Math.PI / 2 },
  // West side - facing east
  { pos: [-6, 0, WORK_AREA_CENTER[2]] as [number, number, number], rot: -Math.PI / 2, facingAngle: Math.PI / 2 },
  // South side - facing north (toward field)
  { pos: [0, 0, WORK_AREA_CENTER[2] + 6] as [number, number, number], rot: 0, facingAngle: Math.PI },
  // North side - facing south
  { pos: [0, 0, WORK_AREA_CENTER[2] - 6] as [number, number, number], rot: Math.PI, facingAngle: 0 },
];

/** Position offset from center (positions on left/right sides) */
const POSITION_OFFSET = 0.35;

/** Position height (standing height above ground) */
const POSITION_HEIGHT = 0.35;

/**
 * Initialize all work positions
 */
function initializePositions(): WorkPosition[] {
  const positions: WorkPosition[] = [];

  WORK_POSITION_CONFIGS.forEach((config, configIndex) => {
    // Calculate position offsets based on orientation
    const isEastWest = configIndex < 2;

    // Two positions per side
    [-1, 1].forEach((side, posIndex) => {
      const posId = `work-${configIndex}-pos-${posIndex}`;

      // Calculate offset based on orientation
      let posX = config.pos[0];
      let posZ = config.pos[2];

      if (isEastWest) {
        // East/West sides: positions offset along Z axis
        posZ += side * POSITION_OFFSET;
      } else {
        // North/South sides: positions offset along X axis
        posX += side * POSITION_OFFSET;
      }

      positions.push({
        id: posId,
        position: [posX, POSITION_HEIGHT, posZ],
        rotation: config.facingAngle,
        occupiedBy: null,
      });
    });
  });

  return positions;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing work position allocation
 *
 * Provides methods to claim, release, and query work positions for agents.
 * Positions are allocated on a first-come-first-served basis.
 *
 * @returns {UseWorkPositionsResult} Hook result with position management functions
 *
 * @example
 * ```tsx
 * function AgentManager() {
 *   const { claimPosition, releasePosition, getAgentPosition } = useWorkPositions();
 *
 *   // When agent arrives at work area
 *   const position = claimPosition(agentId);
 *   if (position) {
 *     // Move agent to position.position
 *   }
 *
 *   // When agent leaves
 *   releasePosition(agentId);
 * }
 * ```
 */
export function useWorkPositions(): UseWorkPositionsResult {
  // Use ref to persist positions across renders without causing re-renders
  const positionsRef = useRef<WorkPosition[]>(initializePositions());

  /**
   * Get all work positions
   */
  const getAllPositions = useCallback((): WorkPosition[] => {
    return [...positionsRef.current];
  }, []);

  /**
   * Get available (unoccupied) positions
   */
  const getAvailablePositions = useCallback((): WorkPosition[] => {
    return positionsRef.current.filter((pos) => pos.occupiedBy === null);
  }, []);

  /**
   * Claim a position for an agent
   * @param agentId - The agent requesting a position
   * @returns The claimed position, or null if no positions available
   */
  const claimPosition = useCallback((agentId: string): WorkPosition | null => {
    // Check if agent already has a position
    const existingPosition = positionsRef.current.find(
      (pos) => pos.occupiedBy === agentId
    );
    if (existingPosition) {
      return existingPosition;
    }

    // Find first available position
    const availablePosition = positionsRef.current.find(
      (pos) => pos.occupiedBy === null
    );

    if (availablePosition) {
      availablePosition.occupiedBy = agentId;
      return availablePosition;
    }

    return null;
  }, []);

  /**
   * Release a position when agent leaves
   * @param agentId - The agent releasing their position
   */
  const releasePosition = useCallback((agentId: string): void => {
    const position = positionsRef.current.find((p) => p.occupiedBy === agentId);
    if (position) {
      position.occupiedBy = null;
    }
  }, []);

  /**
   * Get the position an agent is at
   * @param agentId - The agent to look up
   * @returns The position or null if agent has no position
   */
  const getAgentPosition = useCallback((agentId: string): WorkPosition | null => {
    return positionsRef.current.find((pos) => pos.occupiedBy === agentId) ?? null;
  }, []);

  /**
   * Check if an agent has a position
   * @param agentId - The agent to check
   * @returns True if agent has a claimed position
   */
  const hasAgentPosition = useCallback((agentId: string): boolean => {
    return positionsRef.current.some((pos) => pos.occupiedBy === agentId);
  }, []);

  return {
    getAllPositions,
    getAvailablePositions,
    claimPosition,
    releasePosition,
    getAgentPosition,
    hasAgentPosition,
  };
}

export default useWorkPositions;
