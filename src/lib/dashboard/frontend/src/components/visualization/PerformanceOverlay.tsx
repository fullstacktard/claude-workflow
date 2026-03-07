/**
 * PerformanceOverlay Component
 *
 * Displays real-time performance metrics in the 3D scene using drei's Html.
 * Only renders in development mode by default.
 *
 * Shows:
 * - Current FPS (color-coded: green > 50, yellow 30-50, red < 30)
 * - Quality level (ultra/high/medium/low/minimal)
 * - Current DPR setting
 * - Draw calls count
 * - Triangle count (formatted with K/M suffixes)
 * - Adaptive vs manual mode indicator
 * - Performance trend arrow
 *
 * @module components/visualization/PerformanceOverlay
 */

import { Html } from "@react-three/drei";
import { usePerformanceMonitor } from "../../hooks/usePerformanceMonitor";
import { useAdaptiveQuality } from "./AdaptiveQuality";

// ============================================================================
// Types
// ============================================================================

/** Props for the PerformanceOverlay component */
export interface PerformanceOverlayProps {
  /** Force show even in production mode (default: false) */
  forceShow?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get Tailwind color class based on FPS value.
 * Green for good (>= 50), yellow for acceptable (30-49), red for poor (< 30).
 */
function getFpsColor(fps: number): string {
  if (fps >= 50) return "text-green-400";
  if (fps >= 30) return "text-yellow-400";
  return "text-red-400";
}

/**
 * Format large numbers with K/M suffixes for readability.
 */
function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Get trend indicator character.
 */
function getTrendIndicator(trend: string): string {
  if (trend === "improving") return "\u2191"; // up arrow
  if (trend === "degrading") return "\u2193"; // down arrow
  return "\u2192"; // right arrow (stable)
}

// ============================================================================
// Component
// ============================================================================

/**
 * PerformanceOverlay component - shows real-time FPS and quality metrics.
 *
 * Positioned in the top-left area of the 3D scene using drei's Html component
 * for proper 3D positioning relative to the camera.
 *
 * The overlay is non-interactive (pointer-events: none) and will not
 * interfere with scene interactions.
 *
 * @param props - Component props
 * @returns JSX element or null if not in dev mode
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <AdaptiveQuality>
 *     <MyScene />
 *     <PerformanceOverlay />
 *   </AdaptiveQuality>
 * </Canvas>
 * ```
 */
export function PerformanceOverlay({
  forceShow = false,
}: PerformanceOverlayProps): JSX.Element | null {
  // Only render in dev mode unless forced
  if (!forceShow && !import.meta.env.DEV) {
    return null;
  }

  return <PerformanceOverlayInner />;
}

/**
 * Inner component that uses hooks unconditionally.
 * Separated to avoid conditional hook calls in the parent.
 */
function PerformanceOverlayInner(): JSX.Element {
  const { metrics } = usePerformanceMonitor();
  const { qualityLevel, isAdaptive, settings } = useAdaptiveQuality();

  return (
    <Html
      position={[-12, 8, 0]}
      distanceFactor={10}
      style={{
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div className="bg-gray-900/90 text-white text-xs font-mono p-2 rounded-lg shadow-lg min-w-[140px]">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-700 pb-1 mb-1">
          <span className="font-bold">Performance</span>
          <span className={`text-[10px] ${isAdaptive ? "text-blue-400" : "text-gray-500"}`}>
            {isAdaptive ? "AUTO" : "MANUAL"}
          </span>
        </div>

        {/* Metrics */}
        <div className="space-y-0.5">
          {/* FPS */}
          <div className="flex justify-between">
            <span className="text-gray-400">FPS:</span>
            <span className={getFpsColor(metrics.fps)}>
              {metrics.fps}
              <span className="text-gray-500 text-[10px] ml-1">
                ({getTrendIndicator(metrics.trend)})
              </span>
            </span>
          </div>

          {/* Quality Level */}
          <div className="flex justify-between">
            <span className="text-gray-400">Quality:</span>
            <span className="text-purple-400 capitalize">{qualityLevel}</span>
          </div>

          {/* Device Pixel Ratio */}
          <div className="flex justify-between">
            <span className="text-gray-400">DPR:</span>
            <span className="text-cyan-400">{settings.dpr}</span>
          </div>

          {/* Draw Calls */}
          <div className="flex justify-between">
            <span className="text-gray-400">Draws:</span>
            <span className="text-orange-400">{metrics.drawCalls}</span>
          </div>

          {/* Triangles */}
          <div className="flex justify-between">
            <span className="text-gray-400">Tris:</span>
            <span className="text-pink-400">{formatNumber(metrics.triangles)}</span>
          </div>
        </div>
      </div>
    </Html>
  );
}
