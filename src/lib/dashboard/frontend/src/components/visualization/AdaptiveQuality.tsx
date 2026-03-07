/**
 * AdaptiveQuality Component
 *
 * Automatically adjusts rendering quality based on FPS performance.
 * Monitors frame rate and dynamically adjusts:
 * - Device Pixel Ratio (DPR)
 * - Post-processing quality level
 * - Shadow map resolution
 *
 * Quality levels (from highest to lowest):
 * - ultra: DPR 2, effects high, shadows 2048
 * - high: DPR 1.5, effects high, shadows 1024
 * - medium: DPR 1.5, effects medium, shadows 1024
 * - low: DPR 1, effects low, shadows 512
 * - minimal: DPR 1, effects disabled, shadows 256
 *
 * Features:
 * - Smooth quality transitions with cooldown period
 * - Sustained threshold detection (prevents flicker)
 * - localStorage persistence of quality preference
 * - Manual override via localStorage key
 * - Context-based API for child components
 *
 * @module components/visualization/AdaptiveQuality
 */

import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { useThree } from "@react-three/fiber";
import { usePerformanceMonitor } from "../../hooks/usePerformanceMonitor";
import { PERFORMANCE_CONFIG, type EffectQuality } from "../../config/visualization-config";

// ============================================================================
// Types
// ============================================================================

/** Available quality levels ordered from highest to lowest */
export type QualityLevel = "ultra" | "high" | "medium" | "low" | "minimal";

/** Rendering settings for a specific quality level */
export interface QualitySettings {
  /** Device pixel ratio */
  dpr: number;
  /** Post-processing quality (or "disabled" for minimal) */
  effectsQuality: EffectQuality | "disabled";
  /** Shadow map resolution (width and height) */
  shadowMapSize: number;
}

/** Context value exposed to child components via useAdaptiveQuality */
export interface AdaptiveQualityContextValue {
  /** Current quality level */
  qualityLevel: QualityLevel;
  /** Current quality settings */
  settings: QualitySettings;
  /** Whether adaptive quality adjustment is active */
  isAdaptive: boolean;
  /** Manually set quality level (pass null to clear override and re-enable adaptive) */
  setManualQuality: (level: QualityLevel | null) => void;
  /** Current FPS from performance monitor */
  fps: number;
}

// ============================================================================
// Quality Presets
// ============================================================================

/** Quality settings for each level - maps quality name to DPR, effects, and shadow resolution */
const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  ultra: { dpr: 2, effectsQuality: "high", shadowMapSize: 2048 },
  high: { dpr: 1.5, effectsQuality: "high", shadowMapSize: 1024 },
  medium: { dpr: 1.5, effectsQuality: "medium", shadowMapSize: 1024 },
  low: { dpr: 1, effectsQuality: "low", shadowMapSize: 512 },
  minimal: { dpr: 1, effectsQuality: "disabled", shadowMapSize: 256 },
};

/** Ordered quality levels from highest to lowest - used for stepping up/down */
const QUALITY_ORDER: QualityLevel[] = ["ultra", "high", "medium", "low", "minimal"];

/** localStorage key for persisting automatic quality preference */
const STORAGE_KEY = "visualization-quality-preference";

/** localStorage key for manual quality override */
const STORAGE_KEY_MANUAL = "visualization-quality-manual-override";

// ============================================================================
// Context
// ============================================================================

const AdaptiveQualityContext = createContext<AdaptiveQualityContextValue | null>(null);

/**
 * Hook to access the adaptive quality context.
 * Must be used within an AdaptiveQuality provider component.
 *
 * @returns Current quality context value
 * @throws Error if used outside AdaptiveQuality provider
 *
 * @example
 * ```tsx
 * function QualityAwareComponent() {
 *   const { qualityLevel, settings, fps } = useAdaptiveQuality();
 *
 *   if (settings.effectsQuality === "disabled") {
 *     return null; // Skip effects when quality is minimal
 *   }
 *
 *   return <PostProcessingEffects quality={settings.effectsQuality} />;
 * }
 * ```
 */
export function useAdaptiveQuality(): AdaptiveQualityContextValue {
  const context = useContext(AdaptiveQualityContext);
  if (!context) {
    throw new Error("useAdaptiveQuality must be used within an AdaptiveQuality component");
  }
  return context;
}

// ============================================================================
// Component
// ============================================================================

/** Props for the AdaptiveQuality component */
interface AdaptiveQualityProps {
  children: React.ReactNode;
  /** Enable adaptive quality adjustment (default: true) */
  enabled?: boolean;
  /** Initial quality level before adaptive logic kicks in (default: "high") */
  initialQuality?: QualityLevel;
}

/**
 * AdaptiveQuality component - wraps scene content and manages quality state machine.
 *
 * Monitors FPS via usePerformanceMonitor and adjusts rendering quality
 * automatically. Quality changes require sustained performance above/below
 * thresholds and respect a cooldown period to prevent visual flicker.
 *
 * @param props - Component props
 * @returns JSX element wrapping children with quality context
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <AdaptiveQuality enabled={true} initialQuality="high">
 *     <MyScene />
 *     <QualityAwareEffects />
 *     <PerformanceOverlay />
 *   </AdaptiveQuality>
 * </Canvas>
 * ```
 */
export function AdaptiveQuality({
  children,
  enabled = true,
  initialQuality = "high",
}: AdaptiveQualityProps): JSX.Element {
  const { gl } = useThree();
  const { metrics } = usePerformanceMonitor({ enabled });

  // Initialize quality level from localStorage or props
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(() => {
    // Check for manual override first
    const manualOverride = localStorage.getItem(STORAGE_KEY_MANUAL);
    if (manualOverride && QUALITY_ORDER.includes(manualOverride as QualityLevel)) {
      return manualOverride as QualityLevel;
    }
    // Then check for saved preference
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && QUALITY_ORDER.includes(saved as QualityLevel)) {
      return saved as QualityLevel;
    }
    return initialQuality;
  });

  const [isManualOverride, setIsManualOverride] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY_MANUAL) !== null;
  });

  // Timing refs for sustained threshold detection
  const lastChangeRef = useRef<number>(Date.now());
  const lowFpsStartRef = useRef<number | null>(null);
  const highFpsStartRef = useRef<number | null>(null);

  // Apply DPR changes to the WebGL renderer
  useEffect(() => {
    const settings = QUALITY_PRESETS[qualityLevel];
    gl.setPixelRatio(settings.dpr);
  }, [qualityLevel, gl]);

  // Persist quality preference to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, qualityLevel);
  }, [qualityLevel]);

  // Adaptive quality adjustment logic
  useEffect(() => {
    if (!enabled || isManualOverride) return;

    const now = Date.now();
    const timeSinceLastChange = now - lastChangeRef.current;

    // Enforce cooldown between quality changes to prevent flicker
    if (timeSinceLastChange < PERFORMANCE_CONFIG.qualityCooldown * 1000) {
      return;
    }

    const currentIndex = QUALITY_ORDER.indexOf(qualityLevel);

    // Handle low performance - reduce quality
    if (metrics.isLowPerformance) {
      if (lowFpsStartRef.current === null) {
        lowFpsStartRef.current = now;
      } else if (now - lowFpsStartRef.current > PERFORMANCE_CONFIG.reduceQualitySustained * 1000) {
        // Sustained low FPS - step down quality
        if (currentIndex < QUALITY_ORDER.length - 1) {
          setQualityLevel(QUALITY_ORDER[currentIndex + 1]);
          lastChangeRef.current = now;
          lowFpsStartRef.current = null;
        }
      }
      // Reset high FPS timer when low
      highFpsStartRef.current = null;
    }
    // Handle high performance - increase quality
    else if (metrics.isHighPerformance) {
      if (highFpsStartRef.current === null) {
        highFpsStartRef.current = now;
      } else if (now - highFpsStartRef.current > PERFORMANCE_CONFIG.increaseQualitySustained * 1000) {
        // Sustained high FPS - step up quality
        if (currentIndex > 0) {
          setQualityLevel(QUALITY_ORDER[currentIndex - 1]);
          lastChangeRef.current = now;
          highFpsStartRef.current = null;
        }
      }
      // Reset low FPS timer when high
      lowFpsStartRef.current = null;
    }
    // Reset timers if performance is within normal range
    else {
      lowFpsStartRef.current = null;
      highFpsStartRef.current = null;
    }
  }, [metrics, enabled, isManualOverride, qualityLevel]);

  // Manual quality setter - allows users to override adaptive behavior
  const setManualQuality = useCallback((level: QualityLevel | null) => {
    if (level === null) {
      // Clear manual override and re-enable adaptive quality
      localStorage.removeItem(STORAGE_KEY_MANUAL);
      setIsManualOverride(false);
    } else {
      // Set manual override and disable adaptive quality
      localStorage.setItem(STORAGE_KEY_MANUAL, level);
      setIsManualOverride(true);
      setQualityLevel(level);
    }
  }, []);

  const contextValue: AdaptiveQualityContextValue = {
    qualityLevel,
    settings: QUALITY_PRESETS[qualityLevel],
    isAdaptive: enabled && !isManualOverride,
    setManualQuality,
    fps: metrics.fps,
  };

  return (
    <AdaptiveQualityContext.Provider value={contextValue}>
      {children}
    </AdaptiveQualityContext.Provider>
  );
}
