/**
 * FPSCounter Component
 *
 * A game-style FPS counter with medieval/parchment theming for the Agent Visualization page.
 * Displays prominently in the top-left corner with color-coded performance indicators.
 *
 * Features:
 * - Medieval parchment visual theme matching the village visualization
 * - Color-coded FPS: green (60+), yellow (30-59), red (<30)
 * - Toggleable via F key keyboard shortcut
 * - Smooth rolling average FPS calculation
 * - Optional detailed metrics (draw calls, triangles)
 *
 * @module components/visualization/FPSCounter
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { createPortal } from "react-dom";

// ============================================================================
// Types
// ============================================================================

/** Props for the FPSCounter component */
export interface FPSCounterProps {
  /** Initial visibility state (default: true) */
  initialVisible?: boolean;
  /** Show extended metrics like draw calls (default: false) */
  showExtendedMetrics?: boolean;
  /** Keyboard shortcut to toggle visibility (default: 'f') */
  toggleKey?: string;
  /** Enable keyboard toggle (default: true) */
  enableKeyboardToggle?: boolean;
  /** Position offset from top-left corner */
  position?: { top?: number; left?: number };
}

/** Performance metrics tracked by the counter */
interface FPSMetrics {
  fps: number;
  rawFps: number;
  drawCalls: number;
  triangles: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get color class based on FPS value.
 * Green for excellent (>= 60), yellow for acceptable (30-59), red for poor (< 30).
 */
function getFpsColorClass(fps: number): string {
  if (fps >= 60) return "text-green-400";
  if (fps >= 30) return "text-yellow-400";
  return "text-red-400";
}

/**
 * Get glow color based on FPS value for the medieval torch effect.
 */
function getFpsGlowColor(fps: number): string {
  if (fps >= 60) return "rgba(74, 222, 128, 0.3)"; // green-400
  if (fps >= 30) return "rgba(250, 204, 21, 0.3)"; // yellow-400
  return "rgba(248, 113, 113, 0.3)"; // red-400
}

/**
 * Format large numbers with K/M suffixes for readability.
 */
function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ============================================================================
// Inner Component (uses R3F hooks)
// ============================================================================

interface FPSCounterInnerProps {
  metricsRef: React.MutableRefObject<FPSMetrics>;
  setUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Inner component that runs inside the R3F Canvas context.
 * Uses useFrame to calculate FPS metrics.
 */
const FPSCounterInner = memo(function FPSCounterInner({
  metricsRef,
  setUpdateTrigger,
}: FPSCounterInnerProps): null {
  const { gl } = useThree();

  // Rolling average calculation
  const frameTimes = useRef<number[]>([]);
  const updateInterval = useRef(0);
  const SAMPLE_SIZE = 30; // Faster updates for game-style feel
  const UPDATE_RATE = 4; // Update display every N frames

  useFrame((_, delta) => {
    // Clamp delta to prevent outliers
    const clampedDelta = Math.max(0.001, Math.min(delta, 0.1));
    const instantFps = 1 / clampedDelta;

    // Add to rolling samples
    frameTimes.current.push(instantFps);
    if (frameTimes.current.length > SAMPLE_SIZE) {
      frameTimes.current.shift();
    }

    // Calculate rolling average
    const avgFps =
      frameTimes.current.reduce((sum, fps) => sum + fps, 0) /
      frameTimes.current.length;

    // Get render info from WebGL renderer
    const renderInfo = gl.info.render;

    // Update metrics ref
    metricsRef.current = {
      fps: Math.round(avgFps),
      rawFps: Math.round(instantFps),
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
    };

    // Trigger React update at reduced rate
    updateInterval.current++;
    if (updateInterval.current >= UPDATE_RATE) {
      updateInterval.current = 0;
      setUpdateTrigger((prev) => prev + 1);
    }
  });

  return null;
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * FPSCounter component - game-style FPS display with medieval theming.
 *
 * Renders as an HTML overlay in the top-left corner of the visualization.
 * Press F key to toggle visibility.
 *
 * @param props - Component props
 * @returns JSX element or null if hidden
 *
 * @example
 * ```tsx
 * // Inside a Canvas component
 * <Canvas>
 *   <FPSCounter />
 *   <YourScene />
 * </Canvas>
 * ```
 */
export const FPSCounter = memo(function FPSCounter({
  initialVisible = true,
  showExtendedMetrics = false,
  toggleKey = "f",
  enableKeyboardToggle = true,
  position = { top: 16, left: 16 },
}: FPSCounterProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(initialVisible);
  const [showExtended, setShowExtended] = useState(showExtendedMetrics);
  const [, setUpdateTrigger] = useState(0);
  const metricsRef = useRef<FPSMetrics>({
    fps: 60,
    rawFps: 60,
    drawCalls: 0,
    triangles: 0,
  });

  // Handle keyboard toggle
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enableKeyboardToggle) return;

      // Ignore if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key.toLowerCase() === toggleKey.toLowerCase()) {
        e.preventDefault();
        setIsVisible((prev) => !prev);
      }

      // Shift+F to toggle extended metrics
      if (e.key.toLowerCase() === toggleKey.toLowerCase() && e.shiftKey) {
        setShowExtended((prev) => !prev);
      }
    },
    [enableKeyboardToggle, toggleKey]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const metrics = metricsRef.current;

  // Create portal to render outside Canvas but still use R3F hooks
  const overlayContent = isVisible ? (
    <div
      className="fixed z-50 pointer-events-none select-none"
      style={{
        top: position.top,
        left: position.left,
        fontFamily: "'Geist', 'Inter', sans-serif",
      }}
    >
      {/* Medieval parchment frame */}
      <div
        className="relative px-4 py-2 rounded-lg border-2"
        style={{
          background: "linear-gradient(145deg, #2a2520 0%, #1f1a16 50%, #15120f 100%)",
          borderColor: "#4a3f35",
          boxShadow: `
            0 4px 12px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 20px ${getFpsGlowColor(metrics.fps)}
          `,
        }}
      >
        {/* Decorative corner accents */}
        <div
          className="absolute -top-px -left-px w-3 h-3"
          style={{
            borderTop: "2px solid #8b7355",
            borderLeft: "2px solid #8b7355",
            borderTopLeftRadius: "6px",
          }}
        />
        <div
          className="absolute -top-px -right-px w-3 h-3"
          style={{
            borderTop: "2px solid #8b7355",
            borderRight: "2px solid #8b7355",
            borderTopRightRadius: "6px",
          }}
        />
        <div
          className="absolute -bottom-px -left-px w-3 h-3"
          style={{
            borderBottom: "2px solid #8b7355",
            borderLeft: "2px solid #8b7355",
            borderBottomLeftRadius: "6px",
          }}
        />
        <div
          className="absolute -bottom-px -right-px w-3 h-3"
          style={{
            borderBottom: "2px solid #8b7355",
            borderRight: "2px solid #8b7355",
            borderBottomRightRadius: "6px",
          }}
        />

        {/* FPS Display */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold tabular-nums ${getFpsColorClass(metrics.fps)}`}
            style={{
              textShadow: `0 0 10px ${getFpsGlowColor(metrics.fps)}`,
            }}
          >
            {metrics.fps}
          </span>
          <span className="text-xs text-amber-200/60 uppercase tracking-wider">
            FPS
          </span>
        </div>

        {/* Extended metrics */}
        {showExtended && (
          <div className="mt-1 pt-1 border-t border-amber-900/30 text-xs font-mono">
            <div className="flex justify-between gap-4 text-amber-200/50">
              <span>Draws:</span>
              <span className="text-amber-200/80">{metrics.drawCalls}</span>
            </div>
            <div className="flex justify-between gap-4 text-amber-200/50">
              <span>Tris:</span>
              <span className="text-amber-200/80">{formatNumber(metrics.triangles)}</span>
            </div>
          </div>
        )}

        {/* Keyboard hint */}
        <div className="mt-1 text-[9px] text-amber-200/30 text-center">
          Press F to toggle
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* R3F hook component - must be inside Canvas */}
      <FPSCounterInner metricsRef={metricsRef} setUpdateTrigger={setUpdateTrigger} />

      {/* Portal overlay to document body */}
      {typeof document !== "undefined" &&
        createPortal(overlayContent, document.body)}
    </>
  );
});

// ============================================================================
// Standalone Overlay (for use outside Canvas)
// ============================================================================

/** Props for standalone FPS overlay */
export interface FPSOverlayProps {
  /** Current FPS value */
  fps: number;
  /** Whether the overlay is visible */
  visible?: boolean;
  /** Show extended metrics */
  showExtended?: boolean;
  /** Draw calls count */
  drawCalls?: number;
  /** Triangle count */
  triangles?: number;
  /** Position offset */
  position?: { top?: number; left?: number };
}

/**
 * Standalone FPS overlay component for use outside R3F context.
 * Useful when FPS is calculated externally or for testing.
 */
export const FPSOverlay = memo(function FPSOverlay({
  fps,
  visible = true,
  showExtended = false,
  drawCalls = 0,
  triangles = 0,
  position = { top: 16, left: 16 },
}: FPSOverlayProps): JSX.Element | null {
  if (!visible) return null;

  return (
    <div
      className="fixed z-50 pointer-events-none select-none"
      style={{
        top: position.top,
        left: position.left,
        fontFamily: "'Geist', 'Inter', sans-serif",
      }}
    >
      {/* Medieval parchment frame */}
      <div
        className="relative px-4 py-2 rounded-lg border-2"
        style={{
          background: "linear-gradient(145deg, #2a2520 0%, #1f1a16 50%, #15120f 100%)",
          borderColor: "#4a3f35",
          boxShadow: `
            0 4px 12px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 20px ${getFpsGlowColor(fps)}
          `,
        }}
      >
        {/* Decorative corner accents */}
        <div
          className="absolute -top-px -left-px w-3 h-3"
          style={{
            borderTop: "2px solid #8b7355",
            borderLeft: "2px solid #8b7355",
            borderTopLeftRadius: "6px",
          }}
        />
        <div
          className="absolute -top-px -right-px w-3 h-3"
          style={{
            borderTop: "2px solid #8b7355",
            borderRight: "2px solid #8b7355",
            borderTopRightRadius: "6px",
          }}
        />
        <div
          className="absolute -bottom-px -left-px w-3 h-3"
          style={{
            borderBottom: "2px solid #8b7355",
            borderLeft: "2px solid #8b7355",
            borderBottomLeftRadius: "6px",
          }}
        />
        <div
          className="absolute -bottom-px -right-px w-3 h-3"
          style={{
            borderBottom: "2px solid #8b7355",
            borderRight: "2px solid #8b7355",
            borderBottomRightRadius: "6px",
          }}
        />

        {/* FPS Display */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold tabular-nums ${getFpsColorClass(fps)}`}
            style={{
              textShadow: `0 0 10px ${getFpsGlowColor(fps)}`,
            }}
          >
            {fps}
          </span>
          <span className="text-xs text-amber-200/60 uppercase tracking-wider">
            FPS
          </span>
        </div>

        {/* Extended metrics */}
        {showExtended && (
          <div className="mt-1 pt-1 border-t border-amber-900/30 text-xs font-mono">
            <div className="flex justify-between gap-4 text-amber-200/50">
              <span>Draws:</span>
              <span className="text-amber-200/80">{drawCalls}</span>
            </div>
            <div className="flex justify-between gap-4 text-amber-200/50">
              <span>Tris:</span>
              <span className="text-amber-200/80">{formatNumber(triangles)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default FPSCounter;
