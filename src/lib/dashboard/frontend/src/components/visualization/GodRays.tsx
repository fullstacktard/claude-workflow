/**
 * GodRays Component
 *
 * Creates dramatic volumetric light effects (god rays) for the medieval visualization:
 * - Sun God Rays: Visible light shafts from the sun during golden hour
 * - Moon Glow: Subtle ethereal glow at night
 * - Window Light: Light shafts through building windows (optional)
 *
 * Uses @react-three/postprocessing's GodRays effect with a mesh-based light source.
 * Time-of-day aware and integrates with DayNightCycle component.
 *
 * @module components/visualization/GodRays
 */

import { useRef, useMemo, useEffect, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

/**
 * God rays configuration defaults
 */
export const GOD_RAYS_CONFIG = {
  /** Sun god ray settings */
  sun: {
    /** Number of samples for ray quality (higher = better quality, more expensive) */
    samples: 60,
    /** Light ray density (0-1) */
    density: 0.96,
    /** Illumination decay factor (0-1) */
    decay: 0.93,
    /** Light ray weight factor (0-1) */
    weight: 0.4,
    /** Constant attenuation coefficient */
    exposure: 0.6,
    /** Upper bound for saturation */
    clampMax: 1,
    /** Whether to apply blur to reduce artifacts */
    blur: true,
  },
  /** Moon glow settings (less intense than sun) */
  moon: {
    samples: 40,
    density: 0.92,
    decay: 0.9,
    weight: 0.2,
    exposure: 0.3,
    clampMax: 0.8,
    blur: true,
  },
  /** Quality presets */
  quality: {
    low: { samples: 30, blur: false },
    medium: { samples: 60, blur: true },
    high: { samples: 100, blur: true },
  },
  /** Time-based intensity multipliers */
  timeMultipliers: {
    /** Time window for golden hour (morning) */
    goldenHourMorning: { start: 0.2, peak: 0.27, end: 0.35 },
    /** Time window for golden hour (evening) */
    goldenHourEvening: { start: 0.65, peak: 0.73, end: 0.8 },
    /** Intensity at peak golden hour */
    peakIntensity: 1.0,
    /** Base intensity during regular day */
    dayIntensity: 0.3,
    /** Intensity at night (moon) */
    nightIntensity: 0.15,
  },
} as const;

// =============================================================================
// Types
// =============================================================================

export interface GodRaysProps {
  /** Enable/disable god rays effect (default: true) */
  enabled?: boolean;
  /** Sun position [x, y, z] - should come from DayNightCycle */
  sunPosition?: [number, number, number];
  /** Base intensity multiplier (default: 1) */
  intensity?: number;
  /** Time of day (0-1, where 0.5 is noon) - used to calculate intensity */
  timeOfDay?: number;
  /** Quality preset (affects samples and blur) */
  quality?: "low" | "medium" | "high";
  /** Custom color for the light source */
  color?: string;
  /** Whether to show moon glow at night (default: true) */
  enableMoonGlow?: boolean;
  /** Weather factor (0-1) - reduces intensity in bad weather */
  weatherFactor?: number;
}

export interface GodRaysSettingsProps {
  /** Number of samples per pixel */
  samples: number;
  /** Density of light rays (0-1) */
  density: number;
  /** Illumination decay factor (0-1) */
  decay: number;
  /** Light ray weight factor (0-1) */
  weight: number;
  /** Constant attenuation coefficient */
  exposure: number;
  /** Upper bound for saturation */
  clampMax: number;
  /** Whether to blur rays to reduce artifacts */
  blur: boolean;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate intensity multiplier based on time of day
 * Peaks during golden hours (sunrise/sunset)
 */
function getTimeBasedIntensity(timeOfDay: number): number {
  const { timeMultipliers } = GOD_RAYS_CONFIG;
  const { goldenHourMorning, goldenHourEvening, peakIntensity, dayIntensity, nightIntensity } = timeMultipliers;

  // Night time (before sunrise or after sunset)
  if (timeOfDay < goldenHourMorning.start || timeOfDay > goldenHourEvening.end) {
    return nightIntensity;
  }

  // Morning golden hour
  if (timeOfDay >= goldenHourMorning.start && timeOfDay <= goldenHourMorning.end) {
    const t = (timeOfDay - goldenHourMorning.start) / (goldenHourMorning.end - goldenHourMorning.start);
    // Parabolic curve peaking at golden hour center
    const normalized = 1 - Math.abs(t - 0.35) / 0.35;
    return dayIntensity + (peakIntensity - dayIntensity) * normalized;
  }

  // Evening golden hour
  if (timeOfDay >= goldenHourEvening.start && timeOfDay <= goldenHourEvening.end) {
    const t = (timeOfDay - goldenHourEvening.start) / (goldenHourEvening.end - goldenHourEvening.start);
    // Parabolic curve peaking at golden hour center
    const normalized = 1 - Math.abs(t - 0.53) / 0.47;
    return dayIntensity + (peakIntensity - dayIntensity) * normalized;
  }

  // Regular daytime
  return dayIntensity;
}

/**
 * Get sun color based on time of day
 */
function getSunColor(timeOfDay: number): THREE.Color {
  const color = new THREE.Color();

  // Night - no sun
  if (timeOfDay < 0.2 || timeOfDay > 0.8) {
    return color.setHex(0x000000);
  }

  // Early morning - deep orange/red
  if (timeOfDay < 0.28) {
    return color.setHex(0xff6622);
  }

  // Morning - warm orange
  if (timeOfDay < 0.35) {
    return color.setHex(0xff8844);
  }

  // Midday - warm white/yellow
  if (timeOfDay < 0.65) {
    return color.setHex(0xffffcc);
  }

  // Afternoon to sunset - orange
  if (timeOfDay < 0.75) {
    return color.setHex(0xff9944);
  }

  // Sunset - deep orange/red
  return color.setHex(0xff5522);
}

/**
 * Check if sun should be visible (above horizon)
 */
function isSunVisible(sunPosition: [number, number, number]): boolean {
  return sunPosition[1] > -5; // Allow slight below horizon for dramatic rays
}

// =============================================================================
// Light Source Mesh Component
// =============================================================================

interface LightSourceMeshProps {
  position: [number, number, number];
  color: THREE.Color;
  isSun: boolean;
  intensity: number;
}

/**
 * Light source mesh for god rays
 * Must be transparent and not write to depth buffer for god rays to work
 */
export const LightSourceMesh = forwardRef<THREE.Mesh, LightSourceMeshProps>(
  function LightSourceMesh({ position, color, isSun, intensity }, ref) {
    const materialRef = useRef<THREE.MeshBasicMaterial>(null);

    // Animate glow pulsation
    useFrame((state) => {
      if (!materialRef.current) return;
      const pulse = isSun
        ? 0.8 + Math.sin(state.clock.elapsedTime * 2) * 0.2
        : 0.7 + Math.sin(state.clock.elapsedTime * 1.5) * 0.3;
      materialRef.current.opacity = Math.min(1, intensity * pulse);
    });

    const size = isSun ? 8 : 4;

    return (
      <mesh ref={ref} position={position}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshBasicMaterial
          ref={materialRef}
          color={color}
          transparent
          opacity={intensity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    );
  }
);

// =============================================================================
// God Rays Settings Hook
// =============================================================================

/**
 * Hook to calculate god rays settings based on props and time
 */
export function useGodRaysSettings(
  timeOfDay: number,
  quality: "low" | "medium" | "high",
  baseIntensity: number,
  weatherFactor: number,
  isSun: boolean
): GodRaysSettingsProps {
  return useMemo(() => {
    const baseSettings = isSun ? GOD_RAYS_CONFIG.sun : GOD_RAYS_CONFIG.moon;
    const qualitySettings = GOD_RAYS_CONFIG.quality[quality];
    const timeIntensity = getTimeBasedIntensity(timeOfDay);

    // Calculate final intensity
    const finalIntensity = baseIntensity * timeIntensity * weatherFactor;

    return {
      samples: qualitySettings.samples,
      density: baseSettings.density * finalIntensity,
      decay: baseSettings.decay,
      weight: baseSettings.weight * finalIntensity,
      exposure: baseSettings.exposure * finalIntensity,
      clampMax: baseSettings.clampMax,
      blur: qualitySettings.blur,
    };
  }, [timeOfDay, quality, baseIntensity, weatherFactor, isSun]);
}

// =============================================================================
// Sun Rays Component (Scene-based, not post-processing)
// =============================================================================

interface SunRaysVisualizationProps {
  sunPosition: [number, number, number];
  timeOfDay: number;
  intensity: number;
  weatherFactor: number;
}

/**
 * Visual sun rays using billboard sprites and animated beams
 * A performant alternative to full post-processing god rays
 */
function SunRaysVisualization({
  sunPosition,
  timeOfDay,
  intensity,
  weatherFactor,
}: SunRaysVisualizationProps): JSX.Element | null {
  const raysRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  // Calculate color and visibility
  const sunColor = useMemo(() => getSunColor(timeOfDay), [timeOfDay]);
  const isVisible = isSunVisible(sunPosition);
  const timeIntensity = getTimeBasedIntensity(timeOfDay);
  const finalIntensity = intensity * timeIntensity * weatherFactor;

  // Create ray geometry
  const rayCount = 12;
  const rays = useMemo(() => {
    return Array.from({ length: rayCount }, (_, i) => ({
      angle: (i / rayCount) * Math.PI * 2,
      length: 50 + Math.random() * 30,
      width: 3 + Math.random() * 4,
      offset: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random() * 0.3,
    }));
  }, []);

  // Animate rays
  useFrame((state, delta) => {
    if (!raysRef.current || !isVisible) return;
    timeRef.current += delta;

    // Rotate entire group slightly
    raysRef.current.rotation.z = Math.sin(timeRef.current * 0.1) * 0.02;

    // Update individual ray opacities (only for ray meshes, not glow spheres)
    raysRef.current.children.forEach((child, i) => {
      const ray = rays[i];
      if (!ray) return; // Skip non-ray children (glow spheres)
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const pulse = 0.3 + 0.7 * Math.sin(timeRef.current * ray.speed + ray.offset);
        child.material.opacity = finalIntensity * 0.15 * pulse;
      }
    });
  });

  if (!isVisible || finalIntensity < 0.1) {
    return null;
  }

  return (
    <group ref={raysRef} position={sunPosition}>
      {rays.map((ray, i) => (
        <mesh
          key={i}
          rotation={[0, 0, ray.angle]}
          position={[
            Math.cos(ray.angle) * ray.length * 0.5,
            Math.sin(ray.angle) * ray.length * 0.5,
            0,
          ]}
        >
          <planeGeometry args={[ray.length, ray.width]} />
          <meshBasicMaterial
            color={sunColor}
            transparent
            opacity={finalIntensity * 0.15}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Central glow */}
      <mesh>
        <sphereGeometry args={[15, 32, 32]} />
        <meshBasicMaterial
          color={sunColor}
          transparent
          opacity={finalIntensity * 0.2}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Outer corona */}
      <mesh>
        <sphereGeometry args={[25, 32, 32]} />
        <meshBasicMaterial
          color={sunColor}
          transparent
          opacity={finalIntensity * 0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// Moon Glow Component
// =============================================================================

interface MoonGlowProps {
  moonPosition: [number, number, number];
  timeOfDay: number;
  intensity: number;
  weatherFactor: number;
}

/**
 * Ethereal moon glow for nighttime
 */
function MoonGlow({
  moonPosition,
  timeOfDay,
  intensity,
  weatherFactor,
}: MoonGlowProps): JSX.Element | null {
  const glowRef = useRef<THREE.Mesh>(null);

  // Moon is visible at night (roughly time < 0.25 or > 0.75)
  const isNight = timeOfDay < 0.25 || timeOfDay > 0.75;

  // Calculate night depth for intensity
  const nightDepth = useMemo(() => {
    if (!isNight) return 0;
    if (timeOfDay < 0.25) {
      return 1 - timeOfDay / 0.25;
    }
    return (timeOfDay - 0.75) / 0.25;
  }, [timeOfDay, isNight]);

  const finalIntensity = intensity * nightDepth * weatherFactor;

  // Animate moon glow
  useFrame((state) => {
    if (!glowRef.current) return;
    const pulse = 0.8 + Math.sin(state.clock.elapsedTime * 0.5) * 0.2;
    glowRef.current.scale.setScalar(pulse);
  });

  if (!isNight || finalIntensity < 0.05) {
    return null;
  }

  return (
    <group position={moonPosition}>
      {/* Inner glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[8, 32, 32]} />
        <meshBasicMaterial
          color={0xaabbff}
          transparent
          opacity={finalIntensity * 0.3}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Outer ethereal glow */}
      <mesh>
        <sphereGeometry args={[15, 32, 32]} />
        <meshBasicMaterial
          color={0x8899cc}
          transparent
          opacity={finalIntensity * 0.15}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Faint corona */}
      <mesh>
        <sphereGeometry args={[25, 32, 32]} />
        <meshBasicMaterial
          color={0x6677aa}
          transparent
          opacity={finalIntensity * 0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// Main GodRays Component
// =============================================================================

/**
 * GodRays component
 *
 * Creates dramatic volumetric light effects that integrate with the day/night cycle.
 * Renders as scene objects with additive blending for performance.
 *
 * @example
 * ```tsx
 * // Basic usage with DayNightCycle
 * <GodRays
 *   sunPosition={sunPosition}
 *   timeOfDay={currentTime}
 *   quality="medium"
 * />
 *
 * // Eternal golden hour
 * <GodRays
 *   sunPosition={[-50, 20, -30]}
 *   timeOfDay={0.75}
 *   intensity={1.2}
 * />
 * ```
 */
export function GodRays({
  enabled = true,
  sunPosition = [100, 50, 0],
  intensity = 1,
  timeOfDay = 0.5,
  quality = "medium",
  enableMoonGlow = true,
  weatherFactor = 1,
}: GodRaysProps): JSX.Element | null {
  // Calculate moon position (opposite sun)
  const moonPosition = useMemo<[number, number, number]>(() => {
    // Moon is roughly opposite to sun
    return [-sunPosition[0] * 0.9, Math.max(20, sunPosition[1] * 0.8), -sunPosition[2] * 0.9];
  }, [sunPosition]);

  if (!enabled) {
    return null;
  }

  return (
    <group name="god-rays">
      {/* Sun rays (daytime) */}
      <SunRaysVisualization
        sunPosition={sunPosition}
        timeOfDay={timeOfDay}
        intensity={intensity}
        weatherFactor={weatherFactor}
      />

      {/* Moon glow (nighttime) */}
      {enableMoonGlow && (
        <MoonGlow
          moonPosition={moonPosition}
          timeOfDay={timeOfDay}
          intensity={intensity}
          weatherFactor={weatherFactor}
        />
      )}
    </group>
  );
}

export default GodRays;
