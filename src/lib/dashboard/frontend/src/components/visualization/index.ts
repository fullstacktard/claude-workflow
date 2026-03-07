/**
 * Visualization Components
 * Barrel file exporting all 3D visualization components
 *
 * @module components/visualization
 */

// Scene wrapper
export { Scene3D } from "./Scene3D";
export type { Scene3DExtendedProps } from "./Scene3D";

// Environment setup - grid, fog, background
export { EnvironmentSetup } from "./EnvironmentSetup";
export type { EnvironmentSetupProps } from "./EnvironmentSetup";

// Project platform - 3D project representation
export { ProjectPlatform } from "./ProjectPlatform";
export type { ProjectPlatformProps } from "./ProjectPlatform";

// Agent visualization
export { AgentCharacter } from "./AgentCharacter";
export type { AgentCharacterProps, AgentStatus } from "./AgentCharacter";

// Particle effects for data flow visualization
export { ParticleFlow } from "./ParticleFlow";

// Skill invocation visual effects
export { SkillEffect } from "./SkillEffect";
export type { SkillEffectProps } from "./SkillEffect";

// Re-export particle flow types for convenience
export type {
  ParticleFlowProps,
  Particle,
  ParticleFlowConfig,
  DataFlowType,
  DataFlow,
} from "../../types/visualization";

// Re-export particle color constants
export { PARTICLE_COLORS } from "../../types/visualization";

// Model loading components
export { ModelLoader, preloadAgentModels, preloadAllAgentModels } from "./ModelLoader";
export type { ModelLoaderProps } from "./ModelLoader";

// Model loading internals (for advanced use cases)
export { GLTFModel } from "./GLTFModel";
export type { GLTFModelProps } from "./GLTFModel";

export { FallbackGeometry } from "./FallbackGeometry";
export type { FallbackGeometryProps } from "./FallbackGeometry";

export { LoadingPlaceholder } from "./LoadingPlaceholder";
export type { LoadingPlaceholderProps } from "./LoadingPlaceholder";

export { ModelErrorBoundary } from "./ModelErrorBoundary";
export type { ModelErrorBoundaryProps } from "./ModelErrorBoundary";

// Medieval village components
export { MedievalResidence, getDoorWorldPosition } from "./MedievalResidence";
export type { MedievalResidenceProps } from "./MedievalResidence";

export { MedievalAtmosphere } from "./MedievalAtmosphere";
export type { MedievalAtmosphereProps } from "./MedievalAtmosphere";

export { ToolStall } from "./ToolStall";
export type { ToolStallProps } from "./ToolStall";

export { SpecialBuilding } from "./SpecialBuilding";
export type { SpecialBuildingProps } from "./SpecialBuilding";

export { CottonField, COTTON_FIELD_POSITION, COTTON_FIELD_WORK_POSITIONS } from "./CottonField";
export type { CottonFieldProps } from "./CottonField";

// Instanced building rendering for performance (single draw call for N buildings)
export { InstancedBuildings } from "./InstancedBuildings";
export type { InstancedBuildingsProps, BuildingInstance } from "./InstancedBuildings";

// Adaptive quality and performance monitoring
export { AdaptiveQuality, useAdaptiveQuality } from "./AdaptiveQuality";
export type {
  QualityLevel,
  QualitySettings,
  AdaptiveQualityContextValue,
} from "./AdaptiveQuality";

export { PerformanceOverlay } from "./PerformanceOverlay";
export type { PerformanceOverlayProps } from "./PerformanceOverlay";

// Game-style FPS counter with medieval theming
export { FPSCounter, FPSOverlay } from "./FPSCounter";
export type { FPSCounterProps, FPSOverlayProps } from "./FPSCounter";

// =============================================================================
// NEW: Epic Visual Effects Components
// =============================================================================

// Day/Night Cycle - Dynamic sky with sun, moon, and stars
export { DayNightCycle, DAY_NIGHT_CONFIG } from "./DayNightCycle";
export type { DayNightCycleProps } from "./DayNightCycle";

// Weather System - Fireflies, rain, falling leaves, dust motes
export {
  WeatherSystem,
  Fireflies,
  Rain,
  FallingLeaves,
  DustMotes,
  WEATHER_CONFIG,
} from "./WeatherSystem";
export type { WeatherSystemProps, WeatherType } from "./WeatherSystem";

// Agent Trails - Magical particle trails following walking agents
export { AgentTrails, SingleAgentTrail, TRAIL_CONFIG } from "./AgentTrails";
export type { AgentTrailsProps } from "./AgentTrails";

// MCP Tool Effects - Magical spell effects for tool usage
export {
  MCPToolEffect,
  MCPToolEffectsManager,
  MCP_EFFECT_CONFIG,
} from "./MCPToolEffects";
export type {
  MCPToolEffectProps,
  ActiveMCPEffect,
} from "./MCPToolEffects";

// Village Pond - Reflective water feature with lily pads
export { VillagePond, POND_CONFIG } from "./VillagePond";
export type { VillagePondProps } from "./VillagePond";

// Ambient Animations - Windmill, chimney smoke, birds, trees
export {
  AmbientAnimations,
  Windmill,
  ChimneySmoke,
  FlyingBirds,
  TorchFlame,
  SwayingTree,
  AMBIENT_CONFIG,
} from "./AmbientAnimations";
export type {
  AmbientAnimationsProps,
  WindmillProps,
  ChimneySmokeProps,
  FlyingBirdsProps,
  TorchFlameProps,
  SwayingTreeProps,
} from "./AmbientAnimations";

// Medieval Props - Environmental decorations (braziers, banners, carts, etc.)
export {
  MedievalProps,
  Brazier,
  Banner,
  Cart,
  Barrels,
  Crates,
  Well,
  Fence,
  Signpost,
  HayBale,
  WeaponRack,
  PROPS_CONFIG,
} from "./MedievalProps";
export type {
  MedievalPropsProps,
  PropPlacement,
  PropBaseProps,
  BrazierProps,
  BannerProps,
  FenceProps,
  SignpostProps,
} from "./MedievalProps";

// Data Flow Particles - Visualize data streaming between nodes
export {
  DataFlowParticles,
  NetworkGraph,
  DATA_FLOW_CONFIG,
} from "./DataFlowParticles";
export type {
  DataFlowParticlesProps,
  DataConnection,
  NetworkGraphProps,
  NetworkNode,
} from "./DataFlowParticles";

// Camera Presets - Cinematic camera control system
export {
  useCameraController,
  CameraPresetUI,
  CameraKeyboardShortcuts,
  CinematicCameraPath,
  CAMERA_PRESETS,
} from "./CameraPresets";
export type {
  CameraPresetName,
  CameraPresetUIProps,
  CameraKeyboardShortcutsProps,
  CinematicPathPoint,
  CinematicCameraPathProps,
} from "./CameraPresets";

// Enhanced Visualization - All-in-one wrapper for visual effects
export { EnhancedVisualization, ENHANCED_DEFAULTS } from "./EnhancedVisualization";
export type { EnhancedVisualizationProps } from "./EnhancedVisualization";

// Magic Effects - Magical spell/skill visual effects
export {
  MagicEffect,
  MagicEffectsManager,
  MAGIC_EFFECT_CONFIG,
} from "./MagicEffects";
export type {
  MagicEffectProps,
  MagicEffectType,
  ActiveMagicEffect,
  MagicEffectsManagerProps,
} from "./MagicEffects";

// Medieval Castle - Central imposing fortress with towers and battlements
export { MedievalCastle, CASTLE_POSITION, CASTLE_CONFIG } from "./MedievalCastle";
export type { MedievalCastleProps } from "./MedievalCastle";

// God Rays - Volumetric lighting effects (sun shafts, moon glow)
export {
  GodRays,
  LightSourceMesh,
  useGodRaysSettings,
  GOD_RAYS_CONFIG,
} from "./GodRays";
export type {
  GodRaysProps,
  GodRaysSettingsProps,
} from "./GodRays";

// Medieval Music Player - Bardcore music links with medieval UI
export { MedievalMusicPlayer, MEDIEVAL_MUSIC_CONFIG } from "./MedievalMusicPlayer";
export type { MedievalMusicPlayerProps } from "./MedievalMusicPlayer";
