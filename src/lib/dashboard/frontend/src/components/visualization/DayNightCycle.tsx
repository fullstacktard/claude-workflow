/**
 * DayNightCycle Component
 *
 * Creates a dynamic day/night cycle with:
 * - Animated sun/moon positions that orbit the scene
 * - Smooth color transitions for sky, ambient light, fog
 * - Twinkling stars that appear at night
 * - God rays from the sun during golden hours
 *
 * @module components/visualization/DayNightCycle
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Day/night cycle configuration
 */
export const DAY_NIGHT_CONFIG = {
  /** Full cycle duration in seconds (default: 120 = 2 minutes per full day) */
  cycleDuration: 120,

  /** Sun orbit radius */
  sunOrbitRadius: 100,

  /** Moon orbit radius (slightly larger for parallax effect) */
  moonOrbitRadius: 110,

  /** Number of stars in the night sky */
  starCount: 2000,

  /** Star field radius */
  starFieldRadius: 200,

  /** Time of day phases (0-1 normalized) */
  phases: {
    dawn: 0.2, // 4:48 AM equivalent
    sunrise: 0.25, // 6:00 AM
    noon: 0.5, // 12:00 PM
    sunset: 0.75, // 6:00 PM
    dusk: 0.8, // 7:12 PM
    midnight: 0.0, // 12:00 AM
  },

  /** Sky colors for different times */
  skyColors: {
    midnight: new THREE.Color(0x0a0a1a),
    dawn: new THREE.Color(0x4a3a5a),
    sunrise: new THREE.Color(0xff7744),
    day: new THREE.Color(0x87ceeb),
    sunset: new THREE.Color(0xff6633),
    dusk: new THREE.Color(0x3a2a4a),
  },

  /** Ambient light colors */
  ambientColors: {
    night: new THREE.Color(0x1a1a3a),
    dawn: new THREE.Color(0x6a4a5a),
    day: new THREE.Color(0xfff5e6),
    dusk: new THREE.Color(0x5a3a4a),
  },

  /** Fog colors */
  fogColors: {
    night: new THREE.Color(0x0a0a1a),
    dawn: new THREE.Color(0x4a3a5a),
    day: new THREE.Color(0xc0d8e8),
    dusk: new THREE.Color(0x3a2a4a),
  },
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Smoothly interpolate between colors based on time of day
 */
function getTimeBasedColor(
  time: number,
  colors: {
    night: THREE.Color;
    dawn: THREE.Color;
    day: THREE.Color;
    dusk: THREE.Color;
  }
): THREE.Color {
  const { phases } = DAY_NIGHT_CONFIG;
  const result = new THREE.Color();

  if (time < phases.dawn) {
    // Night to dawn
    const t = time / phases.dawn;
    result.lerpColors(colors.night, colors.dawn, t);
  } else if (time < phases.sunrise) {
    // Dawn to day
    const t = (time - phases.dawn) / (phases.sunrise - phases.dawn);
    result.lerpColors(colors.dawn, colors.day, t);
  } else if (time < phases.sunset) {
    // Day
    result.copy(colors.day);
  } else if (time < phases.dusk) {
    // Day to dusk
    const t = (time - phases.sunset) / (phases.dusk - phases.sunset);
    result.lerpColors(colors.day, colors.dusk, t);
  } else {
    // Dusk to night
    const t = (time - phases.dusk) / (1 - phases.dusk);
    result.lerpColors(colors.dusk, colors.night, t);
  }

  return result;
}

/**
 * Calculate sun position based on time of day
 */
function getSunPosition(time: number): THREE.Vector3 {
  const { sunOrbitRadius } = DAY_NIGHT_CONFIG;
  // Sun rises in east (positive X), sets in west (negative X)
  // Angle: 0 at midnight (below horizon), 0.5 at noon (highest)
  const angle = time * Math.PI * 2 - Math.PI / 2;

  return new THREE.Vector3(
    Math.cos(angle) * sunOrbitRadius,
    Math.sin(angle) * sunOrbitRadius * 0.6, // Lower orbit for more dramatic sunrise/sunset
    Math.sin(angle * 0.5) * sunOrbitRadius * 0.3 // Slight Z variation
  );
}

/**
 * Calculate moon position (opposite to sun)
 */
function getMoonPosition(time: number): THREE.Vector3 {
  const { moonOrbitRadius } = DAY_NIGHT_CONFIG;
  const angle = time * Math.PI * 2 + Math.PI / 2; // Opposite to sun

  return new THREE.Vector3(
    Math.cos(angle) * moonOrbitRadius,
    Math.sin(angle) * moonOrbitRadius * 0.5,
    Math.sin(angle * 0.5) * moonOrbitRadius * 0.2
  );
}

// =============================================================================
// Star Field Component
// =============================================================================

interface StarFieldProps {
  /** Visibility (0-1), fades in at night */
  visibility: number;
}

/**
 * StarField - Procedural twinkling stars
 */
function StarField({ visibility }: StarFieldProps): JSX.Element | null {
  const starsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);

  // Generate star positions
  const { positions, sizes, twinkleOffsets } = useMemo(() => {
    const { starCount, starFieldRadius } = DAY_NIGHT_CONFIG;
    const posArray = new Float32Array(starCount * 3);
    const sizeArray = new Float32Array(starCount);
    const offsetArray = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      // Distribute stars in a hemisphere above the scene
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.4 + Math.PI * 0.1; // Upper hemisphere only
      const r = starFieldRadius * (0.8 + Math.random() * 0.2);

      posArray[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      posArray[i * 3 + 1] = r * Math.cos(phi); // Y is up
      posArray[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      sizeArray[i] = 0.5 + Math.random() * 1.5;
      offsetArray[i] = Math.random() * Math.PI * 2;
    }

    return {
      positions: posArray,
      sizes: sizeArray,
      twinkleOffsets: offsetArray,
    };
  }, []);

  // Custom shader material for twinkling
  const starMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  // Animate stars
  useFrame((state, delta) => {
    if (!starsRef.current) return;

    timeRef.current += delta;

    // Update opacity based on visibility (fade stars in/out)
    starMaterial.opacity = visibility * 0.8;

    // Twinkle effect by modifying size
    const geometry = starsRef.current.geometry;
    const sizeAttr = geometry.getAttribute("size") as THREE.BufferAttribute;

    for (let i = 0; i < sizes.length; i++) {
      const twinkle =
        0.5 +
        0.5 * Math.sin(timeRef.current * 2 + twinkleOffsets[i]) *
          Math.sin(timeRef.current * 3.7 + twinkleOffsets[i] * 1.3);
      sizeAttr.setX(i, sizes[i] * twinkle);
    }
    sizeAttr.needsUpdate = true;
  });

  if (visibility < 0.01) return null;

  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <primitive object={starMaterial} attach="material" />
    </points>
  );
}

// =============================================================================
// Sun Component
// =============================================================================

interface CelestialBodyProps {
  position: THREE.Vector3;
  visible: boolean;
}

/**
 * Sun - Glowing sun with lens flare effect
 */
function Sun({ position, visible }: CelestialBodyProps): JSX.Element | null {
  const sunRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Animate sun glow
  useFrame((state) => {
    if (!glowRef.current) return;
    const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    glowRef.current.scale.setScalar(scale);
  });

  if (!visible || position.y < -10) return null;

  return (
    <group position={position}>
      {/* Sun core */}
      <mesh ref={sunRef}>
        <sphereGeometry args={[3, 32, 32]} />
        <meshBasicMaterial color={0xffdd44} />
      </mesh>

      {/* Sun glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[5, 32, 32]} />
        <meshBasicMaterial
          color={0xffaa00}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Sun corona */}
      <mesh>
        <sphereGeometry args={[8, 32, 32]} />
        <meshBasicMaterial
          color={0xff8800}
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Point light from sun */}
      <pointLight
        color={0xffffcc}
        intensity={visible ? 2 : 0}
        distance={500}
        decay={2}
      />
    </group>
  );
}

/**
 * Moon - Luminous moon with subtle glow
 */
function Moon({ position, visible }: CelestialBodyProps): JSX.Element | null {
  const moonRef = useRef<THREE.Mesh>(null);

  if (!visible || position.y < -10) return null;

  return (
    <group position={position}>
      {/* Moon surface */}
      <mesh ref={moonRef}>
        <sphereGeometry args={[2, 32, 32]} />
        <meshStandardMaterial
          color={0xe0e0e0}
          emissive={0xaaaacc}
          emissiveIntensity={0.5}
          roughness={0.8}
          metalness={0}
        />
      </mesh>

      {/* Moon glow */}
      <mesh>
        <sphereGeometry args={[3, 32, 32]} />
        <meshBasicMaterial
          color={0xaabbcc}
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Soft moonlight */}
      <pointLight
        color={0xaabbff}
        intensity={visible ? 0.5 : 0}
        distance={300}
        decay={2}
      />
    </group>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export interface DayNightCycleProps {
  /** Enable/disable the cycle (default: true) */
  enabled?: boolean;
  /** Override time of day (0-1, where 0.5 is noon) - if set, disables auto-cycle */
  fixedTime?: number;
  /** Speed multiplier for the cycle (default: 1) */
  speed?: number;
  /** Show stars (default: true) */
  showStars?: boolean;
  /** Show sun/moon (default: true) */
  showCelestialBodies?: boolean;
  /** Callback when time changes */
  onTimeChange?: (time: number) => void;
}

/**
 * DayNightCycle component
 *
 * Creates a complete animated day/night cycle with sun, moon, stars,
 * and smooth lighting/color transitions.
 *
 * @example
 * ```tsx
 * // Auto-cycling day/night
 * <DayNightCycle speed={2} />
 *
 * // Fixed time (eternal sunset)
 * <DayNightCycle fixedTime={0.75} />
 * ```
 */
export function DayNightCycle({
  enabled = true,
  fixedTime,
  speed = 1,
  showStars = true,
  showCelestialBodies = true,
  onTimeChange,
}: DayNightCycleProps): JSX.Element {
  const { scene } = useThree();
  const timeRef = useRef(fixedTime ?? 0.3); // Start at dawn by default
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight>(null);

  // Calculate current time-based values
  const currentTime = fixedTime ?? timeRef.current;
  const sunPosition = getSunPosition(currentTime);
  const moonPosition = getMoonPosition(currentTime);

  // Determine if it's day or night
  const isDay = currentTime > 0.25 && currentTime < 0.75;
  const nightAmount = isDay
    ? 0
    : currentTime < 0.25
      ? 1 - currentTime / 0.25
      : (currentTime - 0.75) / 0.25;

  // Update time and lighting each frame
  useFrame((state, delta) => {
    if (!enabled) return;

    // Update time if not fixed
    if (fixedTime === undefined) {
      timeRef.current =
        (timeRef.current + (delta * speed) / DAY_NIGHT_CONFIG.cycleDuration) %
        1;
    }

    const time = fixedTime ?? timeRef.current;

    // Update fog color
    if (scene.fog) {
      const fogColor = getTimeBasedColor(time, {
        night: DAY_NIGHT_CONFIG.fogColors.night,
        dawn: DAY_NIGHT_CONFIG.fogColors.dawn,
        day: DAY_NIGHT_CONFIG.fogColors.day,
        dusk: DAY_NIGHT_CONFIG.fogColors.dusk,
      });
      (scene.fog as THREE.Fog).color.copy(fogColor);
    }

    // Update ambient light
    if (ambientLightRef.current) {
      const ambientColor = getTimeBasedColor(time, {
        night: DAY_NIGHT_CONFIG.ambientColors.night,
        dawn: DAY_NIGHT_CONFIG.ambientColors.dawn,
        day: DAY_NIGHT_CONFIG.ambientColors.day,
        dusk: DAY_NIGHT_CONFIG.ambientColors.dusk,
      });
      ambientLightRef.current.color.copy(ambientColor);
      // Lower intensity at night
      ambientLightRef.current.intensity =
        time > 0.25 && time < 0.75 ? 0.4 : 0.15;
    }

    // Update directional light (sun light)
    if (directionalLightRef.current) {
      const sunPos = getSunPosition(time);
      directionalLightRef.current.position.copy(sunPos);

      // Sun color changes throughout day
      if (time > 0.2 && time < 0.3) {
        // Sunrise - golden
        directionalLightRef.current.color.setHex(0xff8844);
      } else if (time > 0.7 && time < 0.8) {
        // Sunset - orange/red
        directionalLightRef.current.color.setHex(0xff6622);
      } else if (time > 0.25 && time < 0.75) {
        // Day - warm white
        directionalLightRef.current.color.setHex(0xffffee);
      } else {
        // Night - dim blue (moonlight)
        directionalLightRef.current.color.setHex(0x4466aa);
      }

      // Intensity based on sun height
      const sunIntensity = Math.max(0, sunPos.y / 100);
      directionalLightRef.current.intensity = sunIntensity * 1.5;
    }

    // Notify callback
    onTimeChange?.(time);
  });

  // Sky parameters based on time
  const skyParams = useMemo(() => {
    const time = currentTime;
    const sunPos = getSunPosition(time);

    // Turbidity affects sky clarity (higher = hazier)
    let turbidity = 4;
    let rayleigh = 2;
    let mieCoefficient = 0.005;

    if (time < 0.25 || time > 0.75) {
      // Night - darker sky
      turbidity = 0.5;
      rayleigh = 0.1;
    } else if (time < 0.3 || time > 0.7) {
      // Dawn/dusk - dramatic colors
      turbidity = 10;
      rayleigh = 0.5;
      mieCoefficient = 0.01;
    }

    return {
      sunPosition: [sunPos.x, sunPos.y, sunPos.z] as [number, number, number],
      turbidity,
      rayleigh,
      mieCoefficient,
      mieDirectionalG: 0.8,
    };
  }, [currentTime]);

  return (
    <>
      {/* Dynamic sky */}
      <Sky
        distance={450000}
        sunPosition={skyParams.sunPosition}
        turbidity={skyParams.turbidity}
        rayleigh={skyParams.rayleigh}
        mieCoefficient={skyParams.mieCoefficient}
        mieDirectionalG={skyParams.mieDirectionalG}
      />

      {/* Stars (visible at night) */}
      {showStars && <StarField visibility={nightAmount} />}

      {/* Celestial bodies */}
      {showCelestialBodies && (
        <>
          <Sun position={sunPosition} visible={isDay} />
          <Moon position={moonPosition} visible={!isDay} />
        </>
      )}

      {/* Dynamic lighting */}
      <ambientLight ref={ambientLightRef} intensity={0.3} />
      <directionalLight
        ref={directionalLightRef}
        position={sunPosition}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={200}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
    </>
  );
}

export default DayNightCycle;
