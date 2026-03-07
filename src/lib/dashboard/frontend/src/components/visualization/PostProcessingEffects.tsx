/**
 * PostProcessingEffects Component
 * Applies visual enhancement effects to the 3D scene
 *
 * Effects applied:
 * - Bloom: Makes emissive/bright elements glow (optimized with mipmapBlur and KernelSize.SMALL)
 * - Vignette: Darkens edges to focus attention on center
 * - ToneMapping: ACES Filmic for accurate color reproduction
 *
 * God Rays Support:
 * - When enableGodRays is true, bloom settings are adjusted for better volumetric light
 * - Lower luminance threshold allows god ray meshes to bloom more dramatically
 * - Higher intensity during golden hours (configured via godRaysIntensity)
 *
 * Performance optimizations:
 * - mipmapBlur: true - Uses efficient mipmap-based blur
 * - KernelSize.SMALL - Reduces shader complexity
 * - luminanceThreshold: 0.9 - Only bright elements glow (reduces computation)
 *
 * @module components/visualization/PostProcessingEffects
 *
 * @example
 * // Inside Canvas, after scene content:
 * <PostProcessingEffects enabled={!prefersReducedMotion} quality="high" />
 *
 * // With god rays enhancement:
 * <PostProcessingEffects
 *   enabled={true}
 *   quality="medium"
 *   enableGodRays={true}
 *   godRaysIntensity={0.8}
 * />
 */

import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode, KernelSize } from "postprocessing";

import {
  POST_PROCESSING_CONFIG,
  BLOOM_QUALITY_SETTINGS,
  type EffectQuality,
} from "../../config/visualization-config";

/** Props for PostProcessingEffects component */
interface PostProcessingEffectsProps {
  /** Enable/disable all post-processing effects (default: true) */
  enabled?: boolean;
  /** Quality preset - affects bloom quality and performance (default: 'medium') */
  quality?: EffectQuality;
  /** Enable enhanced bloom for god rays effect (default: false) */
  enableGodRays?: boolean;
  /** God rays intensity multiplier (0-1, default: 0.5) */
  godRaysIntensity?: number;
}

/**
 * PostProcessingEffects component
 *
 * Wraps @react-three/postprocessing EffectComposer with pre-configured
 * effects for the 3D visualization. Effects are optimized for performance
 * while maintaining visual quality.
 *
 * @param props - Component props
 * @returns EffectComposer with configured effects, or null if disabled
 *
 * @remarks
 * - Must be placed inside Canvas, after all scene content
 * - Effects are automatically merged by EffectComposer for optimal performance
 * - Bloom is selective (luminance-based) to avoid global glow
 * - Uses ACES Filmic tone mapping for realistic color reproduction
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <mesh>...</mesh>
 *   <PostProcessingEffects enabled={effectsEnabled} quality="medium" />
 * </Canvas>
 * ```
 */
export function PostProcessingEffects({
  enabled = true,
  quality = "medium",
  enableGodRays = false,
  godRaysIntensity = 0.5,
}: PostProcessingEffectsProps): JSX.Element | null {
  // Early return if disabled (no-op for performance)
  if (!enabled) {
    return null;
  }

  const { bloom, vignette } = POST_PROCESSING_CONFIG;
  const qualitySettings = BLOOM_QUALITY_SETTINGS[quality];

  // Calculate bloom settings - enhanced when god rays are enabled
  // God rays need lower luminance threshold and higher intensity to bloom properly
  const bloomIntensity = enableGodRays
    ? bloom.intensity + godRaysIntensity * 0.5 // Boost bloom for god rays
    : bloom.intensity;

  const bloomThreshold = enableGodRays
    ? Math.max(0.3, bloom.luminanceThreshold - godRaysIntensity * 0.4) // Lower threshold for rays
    : bloom.luminanceThreshold;

  const bloomRadius = enableGodRays
    ? Math.min(1, qualitySettings.radius + 0.15) // Wider bloom for softer rays
    : qualitySettings.radius;

  return (
    <EffectComposer>
      {/* Bloom - optimized with mipmapBlur and KernelSize.SMALL for performance */}
      {/* When god rays enabled: lower threshold, higher intensity for dramatic effect */}
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={bloom.luminanceSmoothing}
        mipmapBlur={qualitySettings.mipmapBlur}
        radius={bloomRadius}
        kernelSize={enableGodRays ? KernelSize.MEDIUM : KernelSize.SMALL}
      />

      {/* Vignette - subtle edge darkening for focus */}
      <Vignette
        offset={vignette.offset}
        darkness={vignette.darkness}
        eskil={false} // Use standard algorithm, not Eskil's technique
      />

      {/* Tone Mapping - ACES Filmic for realistic color reproduction */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
