/**
 * usePerformanceMonitor Hook
 *
 * Tracks real-time performance metrics for the R3F scene.
 * Uses a rolling average to smooth out frame-to-frame variations.
 *
 * Features:
 * - Rolling FPS average over configurable sample size
 * - Visibility API integration (pauses when tab hidden)
 * - Draw call tracking via gl.info.render
 * - Trend detection (improving/degrading/stable)
 *
 * @module hooks/usePerformanceMonitor
 */

import { useRef, useEffect, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PERFORMANCE_CONFIG } from "../config/visualization-config";

// ============================================================================
// Types
// ============================================================================

/** Direction of performance trend over recent frames */
export type PerformanceTrend = "improving" | "degrading" | "stable";

/** Real-time performance metrics from the R3F scene */
export interface PerformanceMetrics {
  /** Current FPS (rolling average) */
  fps: number;
  /** Raw FPS from last frame (unaveraged) */
  rawFps: number;
  /** Number of draw calls in last frame */
  drawCalls: number;
  /** Number of triangles rendered */
  triangles: number;
  /** Performance trend over recent frames */
  trend: PerformanceTrend;
  /** Whether FPS is below reduction threshold */
  isLowPerformance: boolean;
  /** Whether FPS is above increase threshold */
  isHighPerformance: boolean;
}

/** Configuration options for the performance monitor hook */
export interface UsePerformanceMonitorOptions {
  /** Number of frames to average (default: PERFORMANCE_CONFIG.rollingSampleSize) */
  sampleSize?: number;
  /** Enable/disable monitoring (default: true) */
  enabled?: boolean;
}

/** Return value from the usePerformanceMonitor hook */
export interface UsePerformanceMonitorResult {
  /** Current performance metrics (read from ref, updated every frame) */
  metrics: PerformanceMetrics;
  /** Reset the rolling average and all tracked metrics */
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for tracking real-time R3F scene performance metrics.
 *
 * Uses `useFrame` to measure frame timing and calculates a rolling
 * average FPS. Includes visibility API integration to pause tracking
 * when the browser tab is hidden, and delta clamping to prevent
 * outlier measurements from tab switches.
 *
 * @param options - Configuration options for sample size and enabled state
 * @returns Object containing current metrics and a reset function
 *
 * @example
 * ```tsx
 * function PerformanceDisplay() {
 *   const { metrics } = usePerformanceMonitor({ sampleSize: 60 });
 *
 *   return (
 *     <Html>
 *       <div>FPS: {metrics.fps}</div>
 *       <div>Draw calls: {metrics.drawCalls}</div>
 *     </Html>
 *   );
 * }
 * ```
 */
export function usePerformanceMonitor(
  options: UsePerformanceMonitorOptions = {}
): UsePerformanceMonitorResult {
  const { sampleSize = PERFORMANCE_CONFIG.rollingSampleSize, enabled = true } = options;
  const { gl } = useThree();

  // Refs to avoid re-renders on every frame
  const frameTimes = useRef<number[]>([]);
  const metricsRef = useRef<PerformanceMetrics>({
    fps: 60,
    rawFps: 60,
    drawCalls: 0,
    triangles: 0,
    trend: "stable",
    isLowPerformance: false,
    isHighPerformance: false,
  });

  // Visibility API integration - pause tracking when tab is hidden
  const isPausedRef = useRef(false);

  useEffect(() => {
    function handleVisibilityChange(): void {
      isPausedRef.current = document.hidden;
      if (!document.hidden) {
        // Clear samples when returning to tab to avoid stale data
        frameTimes.current = [];
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Reset function - clears all tracked data
  const reset = useCallback(() => {
    frameTimes.current = [];
    metricsRef.current = {
      fps: 60,
      rawFps: 60,
      drawCalls: 0,
      triangles: 0,
      trend: "stable",
      isLowPerformance: false,
      isHighPerformance: false,
    };
  }, []);

  // Frame update - runs every animation frame
  useFrame((_, delta) => {
    if (!enabled || isPausedRef.current) return;

    // Clamp delta to prevent outliers from tab switch (same pattern as useCharacterAnimations)
    const clampedDelta = Math.max(0.001, Math.min(delta, 0.1));
    const instantFps = 1 / clampedDelta;

    // Add to rolling samples
    frameTimes.current.push(instantFps);
    if (frameTimes.current.length > sampleSize) {
      frameTimes.current.shift();
    }

    // Calculate rolling average
    const avgFps =
      frameTimes.current.reduce((sum, fps) => sum + fps, 0) /
      frameTimes.current.length;

    // Calculate trend (compare first and second half of samples)
    let trend: PerformanceTrend = "stable";
    if (frameTimes.current.length >= sampleSize) {
      const half = Math.floor(sampleSize / 2);
      const firstHalf = frameTimes.current.slice(0, half);
      const secondHalf = frameTimes.current.slice(half);
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const diff = secondAvg - firstAvg;

      if (diff > 3) trend = "improving";
      else if (diff < -3) trend = "degrading";
    }

    // Get render info from WebGL renderer
    const renderInfo = gl.info.render;

    // Update metrics ref (no React state update = no re-render)
    metricsRef.current = {
      fps: Math.round(avgFps),
      rawFps: Math.round(instantFps),
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
      trend,
      isLowPerformance: avgFps < PERFORMANCE_CONFIG.reduceQualityThreshold,
      isHighPerformance: avgFps > PERFORMANCE_CONFIG.increaseQualityThreshold,
    };
  });

  return useMemo(
    () => ({
      metrics: metricsRef.current,
      reset,
    }),
    [reset]
  );
}
