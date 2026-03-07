/**
 * useWorkAreaPositions Hook
 *
 * Manages work position allocation in the Minecraft-style work area.
 * Agents claim positions when walking to work and release them when leaving.
 *
 * @module hooks/useWorkAreaPositions
 */

import { useRef, useCallback } from "react";
import { WORK_AREA_POSITIONS } from "../components/visualization/MinecraftWorkArea";

// ============================================================================
// Types
// ============================================================================

export interface WorkPosition {
  id: string;
  position: [number, number, number];
  rotation: number;
  occupiedBy: string | null;
}

export interface UseWorkAreaPositionsResult {
  getAllPositions: () => WorkPosition[];
  getAvailablePositions: () => WorkPosition[];
  claimPosition: (agentId: string) => WorkPosition | null;
  releasePosition: (agentId: string) => void;
  getAgentPosition: (agentId: string) => WorkPosition | null;
  hasAgentPosition: (agentId: string) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

const WORK_HEIGHT = 0.5; // Height above ground for agent positioning

function initializePositions(): WorkPosition[] {
  return WORK_AREA_POSITIONS.map((pos, index) => ({
    id: `work-area-${index}`,
    position: [pos[0], WORK_HEIGHT, pos[2]],
    rotation: Math.PI, // Face toward the town square (south)
    occupiedBy: null,
  }));
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWorkAreaPositions(): UseWorkAreaPositionsResult {
  const positionsRef = useRef<WorkPosition[]>(initializePositions());

  const getAllPositions = useCallback((): WorkPosition[] => {
    return [...positionsRef.current];
  }, []);

  const getAvailablePositions = useCallback((): WorkPosition[] => {
    return positionsRef.current.filter((pos) => pos.occupiedBy === null);
  }, []);

  const claimPosition = useCallback((agentId: string): WorkPosition | null => {
    // Check if agent already has a position
    const existingPosition = positionsRef.current.find(
      (pos) => pos.occupiedBy === agentId
    );
    if (existingPosition) {
      return existingPosition;
    }

    // Find an available position
    const availablePosition = positionsRef.current.find(
      (pos) => pos.occupiedBy === null
    );

    if (availablePosition) {
      availablePosition.occupiedBy = agentId;
      return availablePosition;
    }

    return null;
  }, []);

  const releasePosition = useCallback((agentId: string): void => {
    const position = positionsRef.current.find((p) => p.occupiedBy === agentId);
    if (position) {
      position.occupiedBy = null;
    }
  }, []);

  const getAgentPosition = useCallback((agentId: string): WorkPosition | null => {
    return positionsRef.current.find((pos) => pos.occupiedBy === agentId) ?? null;
  }, []);

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

export default useWorkAreaPositions;
