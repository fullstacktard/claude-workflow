/**
 * useBenchSeating Hook
 *
 * Manages bench seating allocation in the town square.
 * Agents claim seats when entering the square and release them when leaving.
 *
 * @module hooks/useBenchSeating
 */

import { useRef, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

export interface BenchSeat {
  id: string;
  position: [number, number, number];
  rotation: number;
  occupiedBy: string | null;
}

export interface UseBenchSeatingResult {
  getAllSeats: () => BenchSeat[];
  getAvailableSeats: () => BenchSeat[];
  claimSeat: (agentId: string) => BenchSeat | null;
  releaseSeat: (agentId: string) => void;
  getAgentSeat: (agentId: string) => BenchSeat | null;
  hasAgentSeat: (agentId: string) => boolean;
}

// ============================================================================
// Constants
// ============================================================================

const BENCH_CONFIGS = [
  { pos: [2, 0, 0] as [number, number, number], rot: Math.PI / 2, facingAngle: -Math.PI / 2 },
  { pos: [-2, 0, 0] as [number, number, number], rot: -Math.PI / 2, facingAngle: Math.PI / 2 },
  { pos: [0, 0, 2] as [number, number, number], rot: 0, facingAngle: Math.PI },
  { pos: [0, 0, -2] as [number, number, number], rot: Math.PI, facingAngle: 0 },
];

const SEAT_OFFSET = 0.35;
const SEAT_HEIGHT = 0.35;

function initializeSeats(): BenchSeat[] {
  const seats: BenchSeat[] = [];

  BENCH_CONFIGS.forEach((bench, benchIndex) => {
    const isEastWest = benchIndex < 2;

    [-1, 1].forEach((side, seatIndex) => {
      const seatId = `bench-${benchIndex}-seat-${seatIndex}`;

      let seatX = bench.pos[0];
      let seatZ = bench.pos[2];

      if (isEastWest) {
        seatZ += side * SEAT_OFFSET;
      } else {
        seatX += side * SEAT_OFFSET;
      }

      seats.push({
        id: seatId,
        position: [seatX, SEAT_HEIGHT, seatZ],
        rotation: bench.facingAngle,
        occupiedBy: null,
      });
    });
  });

  return seats;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useBenchSeating(): UseBenchSeatingResult {
  const seatsRef = useRef<BenchSeat[]>(initializeSeats());

  const getAllSeats = useCallback((): BenchSeat[] => {
    return [...seatsRef.current];
  }, []);

  const getAvailableSeats = useCallback((): BenchSeat[] => {
    return seatsRef.current.filter((seat) => seat.occupiedBy === null);
  }, []);

  const claimSeat = useCallback((agentId: string): BenchSeat | null => {
    const existingSeat = seatsRef.current.find(
      (seat) => seat.occupiedBy === agentId
    );
    if (existingSeat) {
      return existingSeat;
    }

    const availableSeat = seatsRef.current.find(
      (seat) => seat.occupiedBy === null
    );

    if (availableSeat) {
      availableSeat.occupiedBy = agentId;
      return availableSeat;
    }

    return null;
  }, []);

  const releaseSeat = useCallback((agentId: string): void => {
    const seat = seatsRef.current.find((s) => s.occupiedBy === agentId);
    if (seat) {
      seat.occupiedBy = null;
    }
  }, []);

  const getAgentSeat = useCallback((agentId: string): BenchSeat | null => {
    return seatsRef.current.find((seat) => seat.occupiedBy === agentId) ?? null;
  }, []);

  const hasAgentSeat = useCallback((agentId: string): boolean => {
    return seatsRef.current.some((seat) => seat.occupiedBy === agentId);
  }, []);

  return {
    getAllSeats,
    getAvailableSeats,
    claimSeat,
    releaseSeat,
    getAgentSeat,
    hasAgentSeat,
  };
}

export default useBenchSeating;
