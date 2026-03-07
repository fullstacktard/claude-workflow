/**
 * Visualization Configuration
 * Centralized configuration for 3D visualization components
 *
 * Converts Tailwind agent colors from agentColors.ts to hex values
 * for use with Three.js materials.
 *
 * @module config/visualization-config
 */

/**
 * Agent hex color mapping
 * Maps agent names to hex color values corresponding to Tailwind color classes.
 *
 * Tailwind color reference:
 * - blue-400: #60A5FA
 * - cyan-400: #22D3EE
 * - green-400: #4ADE80
 * - orange-400: #FB923C
 * - pink-400: #F472B6
 * - purple-400: #C084FC
 * - red-400: #F87171
 * - yellow-400: #FACC15
 * - gray-400: #9CA3AF (default)
 */
export const AGENT_HEX_COLORS: Record<string, string> = {
  // Blue agents
  Explore: "#60A5FA",
  "feature-planner": "#60A5FA",

  // Cyan agents
  "skill-analyzer": "#22D3EE",
  "backend-engineer": "#22D3EE",
  "3d-engineer": "#22D3EE",
  "task-reviewer": "#22D3EE",
  "css-fixer": "#22D3EE",
  "tailwind-migrator": "#22D3EE",

  // Green agents
  "backlog-plan-generator": "#4ADE80",
  "qa-resolution-planner": "#4ADE80",
  "pr-document-maker": "#4ADE80",
  "qa-engineer": "#4ADE80",
  "task-maker": "#4ADE80",

  // Orange agents
  "workflow-aggregator": "#FB923C",
  "config-setup-agent": "#FB923C",
  debugger: "#FB923C",
  "cleanup-agent": "#FB923C",
  "devops-engineer": "#FB923C",

  // Pink agents
  "frontend-engineer": "#F472B6",
  "v0-ui-generator": "#F472B6",

  // Purple agents
  "css-resolution-planner": "#C084FC",
  research: "#C084FC",
  "v0-planner": "#C084FC",
  "cto-architect": "#C084FC",
  "style-guide-generator": "#C084FC",

  // Red agents
  "auto-fixer": "#F87171",
  "lint-resolution-planner": "#F87171",

  // Yellow agents
  "lint-fixer": "#FACC15",
  "task-status-auditor": "#FACC15",
  "code-reviewer": "#FACC15",
  "agent-analyzer": "#FACC15",
};

/** Default color for unknown agent types */
export const DEFAULT_AGENT_HEX_COLOR = "#9CA3AF";

/**
 * Get hex color for an agent type
 *
 * @param agentType - Name of the agent (e.g., 'frontend-engineer')
 * @returns Hex color string for Three.js materials
 *
 * @example
 * const color = getAgentHexColor('frontend-engineer');
 * // Returns '#F472B6' (pink-400)
 */
export function getAgentHexColor(agentType: string | undefined): string {
  if (!agentType) {
    return DEFAULT_AGENT_HEX_COLOR;
  }
  // Strip common suffixes that may be appended
  const normalizedName = agentType.replace(/ invoked$/i, "").trim();
  return AGENT_HEX_COLORS[normalizedName] ?? DEFAULT_AGENT_HEX_COLOR;
}

/**
 * Agent geometry configuration
 * Defines the physical dimensions of agent capsule meshes
 */
export const AGENT_GEOMETRY = {
  /** Capsule radius */
  radius: 0.3,
  /** Capsule body length (excluding caps) */
  length: 0.6,
  /** Cap curve segments (higher = smoother) */
  capSegments: 8,
  /** Radial segments around circumference */
  radialSegments: 16,
} as const;

/**
 * Agent animation configuration
 * Defines animation parameters for breathing/floating effects
 */
export const AGENT_ANIMATION = {
  /** Breathing (vertical bob) animation settings */
  breathing: {
    /** Amplitude when idle */
    idleAmplitude: 0.02,
    /** Amplitude when working */
    workingAmplitude: 0.05,
    /** Speed when idle */
    idleSpeed: 1.5,
    /** Speed when working */
    workingSpeed: 3,
  },
  /** Rotation animation settings */
  rotation: {
    /** Max rotation angle (radians) */
    maxAngle: 0.1,
    /** Rotation speed */
    speed: 0.5,
  },
} as const;

/**
 * Agent status emission intensity
 * Controls the glow/emission effect based on agent status
 */
export const AGENT_STATUS_EMISSION: Record<string, number> = {
  idle: 0,
  working: 0.3,
  walking: 0.1,
  completed: 0.5,
};

/**
 * Agent label configuration
 * Settings for the HTML labels displayed above agents
 */
export const AGENT_LABEL = {
  /** Vertical offset above the capsule top */
  offsetY: 0.3,
  /** Distance factor for scaling based on camera distance */
  distanceFactor: 8,
} as const;

/**
 * Post-processing effect configuration
 *
 * Bloom settings tuned for performance and subtle glow on emissive elements:
 * - intensity: 0.5 - visible but not overwhelming
 * - luminanceThreshold: 0.9 - only very bright elements glow (performance optimization)
 * - luminanceSmoothing: 0.3 - smooth transition
 *
 * Performance note: Higher luminanceThreshold reduces the number of pixels
 * that contribute to bloom, improving performance.
 *
 * Vignette settings for subtle focus effect:
 * - offset: 0.3 - starts 30% from center
 * - darkness: 0.5 - noticeable but not distracting
 */
export const POST_PROCESSING_CONFIG = {
  bloom: {
    /** Bloom intensity (0-2 typical) */
    intensity: 0.5,
    /** Only pixels brighter than this threshold glow (0-1) - higher = better performance */
    luminanceThreshold: 0.9,
    /** Smoothness of threshold transition (0-1) */
    luminanceSmoothing: 0.3,
  },
  vignette: {
    /** Distance from center where darkening starts (0-1) */
    offset: 0.3,
    /** How dark the edges become (0-1) */
    darkness: 0.5,
  },
} as const;

/** Quality presets for bloom effect - trade-off between visual quality and performance */
export const BLOOM_QUALITY_SETTINGS = {
  /** Low quality - disabled mipmap blur, faster but less smooth */
  low: { mipmapBlur: false, radius: 0.5 },
  /** Medium quality - enabled mipmap blur with moderate radius */
  medium: { mipmapBlur: true, radius: 0.75 },
  /** High quality - enabled mipmap blur with wider radius */
  high: { mipmapBlur: true, radius: 0.85 },
} as const;

/** Effect quality levels */
export type EffectQuality = keyof typeof BLOOM_QUALITY_SETTINGS;

// =============================================================================
// Skill Color Configuration
// =============================================================================

/**
 * Skill category to color mapping
 * Maps skill names/patterns to hex colors for visual effects
 *
 * Colors are chosen to be distinct and match skill categories:
 * - Research skills (context7, exa, ref): Blue (#60A5FA)
 * - Code navigation skills (serena): Cyan (#22D3EE)
 * - Testing skills (playwright, testing-workflow): Green (#4ADE80)
 * - Thinking skills (sequential-thinking): Purple (#C084FC)
 * - Documentation/Management skills: Orange (#FB923C)
 * - Development skills (react, tailwind, css): Pink (#F472B6)
 * - Infrastructure skills: Yellow (#FACC15)
 * - Workflow skills: Teal (#2DD4BF)
 * - General/Unknown skills: Gray (#E5E7EB)
 */
export const SKILL_HEX_COLORS: Record<string, string> = {
  // Research skills - Blue
  "context7-research": "#60A5FA",
  "exa-research": "#60A5FA",
  "ref-research": "#60A5FA",

  // Code navigation skills - Cyan
  "serena-integration": "#22D3EE",

  // Testing skills - Green
  "playwright-testing": "#4ADE80",
  "testing-workflow": "#4ADE80",
  "chrome-devtools": "#4ADE80",
  "behavioral-testing": "#4ADE80",

  // Thinking skills - Purple
  "sequential-thinking": "#C084FC",

  // Documentation/Management skills - Orange
  d: "#FB923C",
  "task-management": "#FB923C",
  "skill-developer": "#FB923C",
  "agent-developer": "#FB923C",

  // Development skills - Pink
  "react-development": "#F472B6",
  "tailwind-v4": "#F472B6",
  "css-enforcement": "#F472B6",

  // Infrastructure skills - Yellow
  "cloudflare-dns": "#FACC15",
  "replicate-models": "#FACC15",

  // Workflow skills - Teal
  workflow: "#2DD4BF",
};

/** Default color for unknown skills */
export const DEFAULT_SKILL_HEX_COLOR = "#E5E7EB"; // Gray-200

/**
 * Get hex color for a skill name
 *
 * @param skillName - Name of the skill (e.g., 'context7-research')
 * @returns Hex color string for Three.js materials/effects
 *
 * @example
 * const color = getSkillHexColor('context7-research');
 * // Returns '#60A5FA' (blue-400)
 *
 * @example
 * const color = getSkillHexColor('unknown-skill');
 * // Returns '#E5E7EB' (gray-200 default)
 */
export function getSkillHexColor(skillName: string | undefined): string {
  if (!skillName) {
    return DEFAULT_SKILL_HEX_COLOR;
  }

  // Direct match
  if (SKILL_HEX_COLORS[skillName]) {
    return SKILL_HEX_COLORS[skillName];
  }

  // Try pattern matching for common prefixes/keywords
  const lowerName = skillName.toLowerCase();

  if (
    lowerName.includes("research") ||
    lowerName.includes("context7") ||
    lowerName.includes("exa") ||
    lowerName.includes("ref-")
  ) {
    return "#60A5FA"; // Blue - research skills
  }
  if (lowerName.includes("serena") || lowerName.includes("navigation")) {
    return "#22D3EE"; // Cyan - code navigation
  }
  if (
    lowerName.includes("test") ||
    lowerName.includes("playwright") ||
    lowerName.includes("chrome")
  ) {
    return "#4ADE80"; // Green - testing
  }
  if (lowerName.includes("thinking") || lowerName.includes("sequential")) {
    return "#C084FC"; // Purple - thinking
  }
  if (lowerName.includes("workflow")) {
    return "#2DD4BF"; // Teal - workflow
  }
  if (
    lowerName.includes("react") ||
    lowerName.includes("tailwind") ||
    lowerName.includes("css")
  ) {
    return "#F472B6"; // Pink - development
  }

  return DEFAULT_SKILL_HEX_COLOR;
}

/**
 * Skill effect animation configuration
 * Defines animation parameters for SkillEffect component
 */
export const SKILL_EFFECT_CONFIG = {
  /** Total animation duration in seconds */
  duration: 1.5,
  /** Number of particles in burst effect */
  particleCount: 24,
  /** Maximum radius particles spread to */
  particleSpreadRadius: 1.2,
  /** Size of individual particles */
  particleSize: 0.08,
  /** Distance factor for Html label rendering */
  labelDistanceFactor: 10,
  /** Offset above position for label placement */
  labelOffsetY: 0.5,
  /** Size of center glow sphere */
  glowSphereRadius: 0.1,
} as const;

/**
 * Check if user prefers reduced motion
 * Used to disable post-processing effects for accessibility
 *
 * @returns true if the user has enabled reduced motion preferences
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Get stored effect toggle preference
 * Falls back to checking prefers-reduced-motion
 *
 * @returns true if effects should be enabled, false otherwise
 */
export function getEffectsEnabled(): boolean {
  if (typeof localStorage === "undefined") return !prefersReducedMotion();
  const stored = localStorage.getItem("visualization-effects-enabled");
  if (stored === null) return !prefersReducedMotion();
  return stored === "true";
}

/**
 * Store effect toggle preference
 *
 * @param enabled - Whether effects should be enabled
 */
export function setEffectsEnabled(enabled: boolean): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("visualization-effects-enabled", String(enabled));
  }
}

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * Environment Configuration for 3D Scene
 *
 * Settings for the 3D environment including colors, grid, fog, and lighting.
 * Colors are chosen to complement the dashboard dark theme (globals.css).
 *
 * Note: Three.js uses hex colors, so we convert from the OKLCH values
 * defined in globals.css to approximate hex equivalents.
 *
 * Reference (from globals.css):
 * - --color-background: oklch(0.145 0 0) ~ #0a0a0a
 * - --color-primary-dark: oklch(0.444 0.177 26.899) ~ red-800
 * - --color-neutral-bg: oklch(0.269 0.015 264.436) ~ #1f2937
 */
export const VISUALIZATION_CONFIG = {
  /**
   * Color palette matching dashboard dark theme
   */
  colors: {
    /** Ground plane - slightly darker than dashboard background */
    ground: "#0f0f1a",

    /** Grid lines - subtle red accent matching primary-dark */
    gridPrimary: "#2a1a1a", // Major grid lines (section)
    gridSecondary: "#1a1a1f", // Minor grid lines (cell)

    /** Sky gradient - very dark, near black at top */
    skyTop: "#050510",
    skyBottom: "#0f0f1a",

    /** Fog - matches background for seamless fade */
    fog: "#0a0a0a",
  },

  /**
   * Grid configuration for ground plane
   * Uses drei Grid component with shader-based rendering
   */
  grid: {
    /** Total grid size (100x100 units) */
    size: 100,

    /** Number of divisions */
    divisions: 50,

    /** Cell (minor) grid - distance between minor lines */
    cellSize: 1,

    /** Cell line thickness */
    cellThickness: 0.5,

    /** Section (major) grid - distance between major lines (every 5 cells) */
    sectionSize: 5,

    /** Section line thickness - slightly thicker than cells */
    sectionThickness: 1,

    /** Fade parameters for smooth edge falloff */
    fadeDistance: 50, // Start fading at this distance
    fadeStrength: 1, // Fade intensity (1 = full fade)
    fadeFrom: 1 as 0 | 1, // 1 = fade from camera, 0 = fade from origin

    /** Behavior */
    followCamera: false, // Grid stays at origin
    infiniteGrid: true, // Render beyond size for seamless look
  },

  /**
   * Fog configuration for depth perception
   * Linear fog provides gradual fade without complex falloff
   */
  fog: {
    /** Fog starts at this distance from camera */
    near: 20,
    /** Full fog density at this distance */
    far: 80,
  },

  /**
   * Lighting configuration for the environment
   * Subtle lighting to maintain dark theme aesthetic
   */
  lighting: {
    /** Ambient light intensity (0-1) - base visibility */
    ambientIntensity: 0.3,
    /** Directional light intensity (0-1) - depth and shadows */
    directionalIntensity: 0.5,
    /** Directional light position [x, y, z] */
    directionalPosition: [10, 20, 10] as [number, number, number],
  },

  /**
   * Camera defaults (reference values)
   * Note: Actual camera is managed by Scene3D component
   */
  camera: {
    position: [15, 15, 15] as [number, number, number],
    fov: 50,
    near: 0.1,
    far: 200,
  },
} as const;

// Type exports for environment configuration
export type EnvironmentColors = typeof VISUALIZATION_CONFIG.colors;
export type GridConfig = typeof VISUALIZATION_CONFIG.grid;
export type FogConfig = typeof VISUALIZATION_CONFIG.fog;
export type EnvironmentLightingConfig = typeof VISUALIZATION_CONFIG.lighting;

// =============================================================================
// GLTF Model Configuration
// =============================================================================

/** Supported fallback geometry types when GLTF models fail to load */
export type FallbackGeometryType = "capsule" | "box" | "sphere";

/** Model configuration for a specific agent type */
export interface AgentModelConfig {
  /** Path to GLTF/GLB model file (relative to public directory) */
  modelPath: string;
  /** Fallback color if model fails to load (hex color) */
  fallbackColor: string;
  /** Scale multiplier for the model */
  scale: number;
}

/** Model configuration settings */
export interface ModelConfig {
  /** Base path for model files */
  basePath: string;
  /** Default fallback geometry type */
  fallbackGeometry: FallbackGeometryType;
  /** Loading placeholder color */
  loadingColor: string;
  /** Error/fallback color */
  errorColor: string;
}

/**
 * Model configuration defaults
 * Model paths are relative to the public directory
 */
export const MODEL_CONFIG: ModelConfig = {
  basePath: "/models/agents",
  fallbackGeometry: "capsule" as const,
  loadingColor: "#6366f1", // Indigo
  errorColor: "#ef4444", // Red
};

/**
 * Available character models for random selection
 * Uses rigged models with animations when available
 */
const AVAILABLE_MODELS = [
  {
    path: "/models/medieval/rigged/jocker/jocker_rigged.glb",
    scale: 1.0,
  },
  {
    path: "/models/medieval/rigged/yakub/yakub_rigged.glb",
    scale: 1.0,
  },
] as const;

// Cache to store consistent model assignments per agent ID
const agentModelCache = new Map<string, (typeof AVAILABLE_MODELS)[number]>();

/**
 * Get model configuration for an agent type
 * Randomly assigns yakub_1 or jocker model (consistent per agent instance)
 *
 * @param agentType - Name of the agent (e.g., 'frontend-engineer')
 * @param agentId - Optional unique agent ID for consistent model assignment
 * @returns AgentModelConfig for the specified type
 *
 * @example
 * const config = getAgentModelConfig('backend-engineer');
 * // Returns either jocker or yakub_1 model randomly
 */
export function getAgentModelConfig(
  agentType: string,
  agentId?: string
): AgentModelConfig {
  const color = getAgentHexColor(agentType);

  // Use agentId for cache key if provided, otherwise use agentType
  const cacheKey = agentId ?? agentType;

  // Check cache for consistent assignment
  let model = agentModelCache.get(cacheKey);

  if (!model) {
    // Randomly select a model
    const randomIndex = Math.floor(Math.random() * AVAILABLE_MODELS.length);
    model = AVAILABLE_MODELS[randomIndex];
    agentModelCache.set(cacheKey, model);
  }

  return {
    modelPath: model.path,
    fallbackColor: color,
    scale: model.scale,
  };
}

// =============================================================================
// Camera Control Configuration
// =============================================================================

/** Camera control configuration */
export interface CameraControlConfig {
  /** Default camera position [x, y, z] */
  defaultPosition: [number, number, number];
  /** Minimum zoom distance from target */
  minDistance: number;
  /** Maximum zoom distance from target */
  maxDistance: number;
  /** Minimum polar angle in radians (0 = looking straight down) */
  minPolarAngle: number;
  /** Maximum polar angle in radians (PI/2 = horizontal, PI = looking straight up) */
  maxPolarAngle: number;
  /** Enable smooth damping/inertia */
  enableDamping: boolean;
  /** Damping factor (lower = more damping) */
  dampingFactor: number;
  /** Default field of view in degrees */
  fov: number;
  /** Near clipping plane */
  near: number;
  /** Far clipping plane */
  far: number;
}

/** Scene environment configuration */
export interface SceneEnvironmentConfig {
  /** Background color (hex) */
  backgroundColor: string;
  /** Ambient light intensity */
  ambientLightIntensity: number;
  /** Grid size */
  gridSize: number;
  /** Grid divisions */
  gridDivisions: number;
}

/** Complete visualization configuration */
export interface VisualizationConfig {
  camera: CameraControlConfig;
  scene: SceneEnvironmentConfig;
}

/**
 * Default visualization configuration
 * Exported for use across all visualization components
 */
export const visualizationConfig: VisualizationConfig = {
  camera: {
    // Default position: elevated view looking at scene center
    defaultPosition: [20, 15, 20],
    // Zoom limits
    minDistance: 5,
    maxDistance: 100,
    // Polar angle limits (prevent going below ground)
    // 0.1 rad (~6 degrees) from straight down
    // PI/2.1 (~86 degrees) prevents going quite horizontal
    minPolarAngle: 0.1,
    maxPolarAngle: Math.PI / 2.1,
    // Smooth damping enabled
    enableDamping: true,
    dampingFactor: 0.05,
    // Camera projection settings
    fov: 50,
    near: 0.1,
    far: 1000,
  },
  scene: {
    backgroundColor: "#0a0a0f",
    ambientLightIntensity: 0.5,
    gridSize: 100,
    gridDivisions: 50,
  },
};

// =============================================================================
// Medieval Village Atmosphere Configuration
// =============================================================================

/**
 * Medieval atmosphere configuration
 * Settings for the medieval village visualization theme
 *
 * Creates a warm, torch-lit evening atmosphere with:
 * - Sunset-colored ambient and directional lighting
 * - Atmospheric fog for depth perception
 * - Configurable torch point lights
 * - Cobblestone ground plane
 * - Bloom settings tuned for torch glow
 */
export const MEDIEVAL_CONFIG = {
  /**
   * Lighting configuration for warm, sunset atmosphere
   */
  lighting: {
    /** Warm ambient light color (sunset orange) */
    ambientColor: "#ff9966",
    /** Ambient light intensity */
    ambientIntensity: 0.3,
    /** Directional light color (deeper orange for sunset) */
    directionalColor: "#ff6633",
    /** Directional light intensity */
    directionalIntensity: 0.5,
    /** Directional light position [x, y, z] - low angle for sunset effect */
    directionalPosition: [-10, 5, -10] as [number, number, number],
  },

  /**
   * Fog configuration for atmospheric depth
   */
  fog: {
    /** Fog color (deep blue-purple for evening atmosphere) */
    color: "#1a1a2e",
    /** Fog starts at this distance from camera */
    near: 15,
    /** Full fog density at this distance */
    far: 50,
  },

  /**
   * Torch configuration for point lights
   */
  torches: {
    /** Torch light color (warm orange) */
    color: "#ff6600",
    /** Torch light intensity */
    intensity: 2,
    /** Torch light falloff distance */
    distance: 8,
    /** Torch light decay factor */
    decay: 2,
    /** Default torch positions [x, y, z] */
    positions: [
      [-6, 2, 6],
      [6, 2, 6],
      [-6, 2, -6],
      [6, 2, -6],
      [0, 2, 0],
    ] as [number, number, number][],
  },

  /**
   * Ground plane configuration
   */
  ground: {
    /** Ground plane size (width x depth) */
    size: [60, 60] as [number, number],
    /** Ground plane Y position */
    positionY: 0,
    /** Fallback color if texture fails to load (brown/gray) */
    fallbackColor: "#3a3530",
    /** Cobblestone texture path (relative to public) */
    texturePath: "/models/textures/cobblestone.jpg",
    /** Texture repeat [x, y] */
    textureRepeat: [20, 20] as [number, number],
  },

  /**
   * Post-processing overrides for medieval atmosphere
   * Lower luminance threshold to make torches glow more
   */
  postProcessing: {
    bloom: {
      /** Increased intensity for torch glow */
      intensity: 0.7,
      /** Lower threshold to catch torch lights */
      luminanceThreshold: 0.5,
      /** Smoothing for glow transition */
      luminanceSmoothing: 0.4,
    },
  },
} as const;

/** Type export for medieval config */
export type MedievalConfig = typeof MEDIEVAL_CONFIG;

// =============================================================================
// Font Configuration for 3D Text
// =============================================================================

/**
 * Font configuration for drei Text components
 *
 * drei's Text component uses Troika-three-text which supports:
 * - .ttf (TrueType Font)
 * - .otf (OpenType Font)
 * - .woff (Web Open Font Format)
 *
 * Note: .woff2 is NOT supported by Troika.
 *
 * The font file (Geist-Medium.ttf) is copied from the `geist` npm package
 * to the public/fonts directory during setup.
 */
export const FONT_CONFIG = {
  /**
   * Path to Geist Medium font file (relative to public directory)
   * Used for 3D Text labels in visualization components
   */
  geistMedium: "/fonts/Geist-Medium.ttf",

  /**
   * Default font size for building labels
   */
  labelFontSize: 0.25,

  /**
   * Outline width for better readability against 3D backgrounds
   */
  outlineWidth: 0.02,

  /**
   * Outline color for contrast
   */
  outlineColor: "#000000",
} as const;

/** Type export for font config */
export type FontConfig = typeof FONT_CONFIG;

/**
 * Get post-processing configuration for medieval atmosphere
 * Returns bloom settings tuned for torch glow effects
 *
 * @returns Post-processing config optimized for medieval village
 *
 * @example
 * const medievalEffects = getMedievalPostProcessingConfig();
 * // Use with PostProcessingEffects component overrides
 */
export function getMedievalPostProcessingConfig(): {
  bloom: {
    intensity: number;
    luminanceThreshold: number;
    luminanceSmoothing: number;
  };
  vignette: typeof POST_PROCESSING_CONFIG.vignette;
} {
  return {
    bloom: {
      intensity: MEDIEVAL_CONFIG.postProcessing.bloom.intensity,
      luminanceThreshold: MEDIEVAL_CONFIG.postProcessing.bloom.luminanceThreshold,
      luminanceSmoothing: MEDIEVAL_CONFIG.postProcessing.bloom.luminanceSmoothing,
    },
    vignette: POST_PROCESSING_CONFIG.vignette,
  };
}

// =============================================================================
// Performance Monitoring Configuration
// =============================================================================

/**
 * Performance monitoring and adaptive quality configuration
 *
 * FPS Thresholds:
 * - Target: 60fps
 * - Reduce quality: <45fps sustained for 2 seconds
 * - Increase quality: >55fps sustained for 5 seconds
 *
 * The adaptive quality system monitors rolling average FPS and adjusts
 * DPR, post-processing quality, and shadow resolution to maintain
 * smooth frame rates across different hardware.
 *
 * @example
 * ```typescript
 * import { PERFORMANCE_CONFIG } from "../config/visualization-config";
 *
 * // Check if FPS is below reduction threshold
 * if (currentFps < PERFORMANCE_CONFIG.reduceQualityThreshold) {
 *   // Start tracking sustained low performance
 * }
 * ```
 */
export const PERFORMANCE_CONFIG = {
  /** Target FPS for optimal performance */
  targetFps: 60,

  /** FPS threshold below which quality should be reduced */
  reduceQualityThreshold: 45,

  /** How long FPS must stay below threshold before reducing (seconds) */
  reduceQualitySustained: 2,

  /** FPS threshold above which quality can be increased */
  increaseQualityThreshold: 55,

  /** How long FPS must stay above threshold before increasing (seconds) */
  increaseQualitySustained: 5,

  /** Minimum time between quality changes (seconds) */
  qualityCooldown: 2,

  /** Number of frames to average for FPS calculation */
  rollingSampleSize: 60,
} as const;

/** Type export for performance configuration */
export type PerformanceConfig = typeof PERFORMANCE_CONFIG;

// =============================================================================
// God Rays Configuration
// =============================================================================

/**
 * God Rays Configuration
 *
 * Settings for volumetric light effects (god rays / light shafts).
 * Integrates with DayNightCycle for time-based intensity adjustments.
 *
 * Features:
 * - Sun god rays during golden hours (sunrise/sunset)
 * - Moon ethereal glow at night
 * - Weather-aware intensity (reduced during rain/fog)
 * - Quality presets for performance scaling
 *
 * @example
 * ```typescript
 * import { GOD_RAYS_CONFIG } from "../config/visualization-config";
 *
 * // Get quality settings
 * const settings = GOD_RAYS_CONFIG.quality.medium;
 *
 * // Calculate time-based intensity
 * const isGoldenHour = timeOfDay > 0.2 && timeOfDay < 0.35;
 * ```
 */
export const GOD_RAYS_CONFIG = {
  /** Sun god ray settings - dramatic light shafts from the sun */
  sun: {
    /** Number of samples for ray quality (higher = better quality, more GPU cost) */
    samples: 60,
    /** Light ray density (0-1) - how thick the rays appear */
    density: 0.96,
    /** Illumination decay factor (0-1) - how quickly rays fade */
    decay: 0.93,
    /** Light ray weight factor (0-1) - brightness of rays */
    weight: 0.4,
    /** Constant attenuation coefficient - overall exposure */
    exposure: 0.6,
    /** Upper bound for saturation - prevents over-bright areas */
    clampMax: 1,
    /** Whether to blur rays to reduce banding artifacts */
    blur: true,
  },

  /** Moon glow settings - subtle ethereal glow for nighttime */
  moon: {
    samples: 40,
    density: 0.92,
    decay: 0.9,
    weight: 0.2,
    exposure: 0.3,
    clampMax: 0.8,
    blur: true,
  },

  /** Quality presets for performance scaling */
  quality: {
    /** Low quality - minimal samples, no blur (for low-end GPUs) */
    low: { samples: 30, blur: false },
    /** Medium quality - balanced samples with blur (recommended) */
    medium: { samples: 60, blur: true },
    /** High quality - maximum samples with blur (for high-end GPUs) */
    high: { samples: 100, blur: true },
  },

  /** Time-based intensity configuration */
  timeMultipliers: {
    /** Morning golden hour time window (normalized 0-1) */
    goldenHourMorning: {
      start: 0.2, // 4:48 AM
      peak: 0.27, // ~6:30 AM
      end: 0.35, // 8:24 AM
    },
    /** Evening golden hour time window (normalized 0-1) */
    goldenHourEvening: {
      start: 0.65, // 3:36 PM
      peak: 0.73, // ~5:30 PM
      end: 0.8, // 7:12 PM
    },
    /** Intensity multiplier at peak golden hour */
    peakIntensity: 1.0,
    /** Base intensity during regular daytime */
    dayIntensity: 0.3,
    /** Intensity at night (for moon glow) */
    nightIntensity: 0.15,
  },

  /** Colors for different times of day */
  colors: {
    /** Early morning sun - deep orange/red */
    earlyMorning: "#ff6622",
    /** Morning sun - warm orange */
    morning: "#ff8844",
    /** Midday sun - warm white/yellow */
    midday: "#ffffcc",
    /** Afternoon sun - orange */
    afternoon: "#ff9944",
    /** Sunset sun - deep orange/red */
    sunset: "#ff5522",
    /** Moon glow - cool blue */
    moon: "#aabbff",
    /** Moon corona - deeper blue */
    moonCorona: "#8899cc",
  },

  /** Weather impact on god rays */
  weather: {
    /** Clear weather - full intensity */
    clear: 1.0,
    /** Light rain - reduced intensity */
    rain: 0.3,
    /** Heavy fog - minimal visibility */
    fog: 0.1,
    /** Overcast - moderate reduction */
    overcast: 0.5,
    /** Fireflies night - normal intensity */
    fireflies: 1.0,
    /** Autumn leaves - slight haze effect */
    autumn: 0.8,
    /** Dusty conditions - scattered light */
    dusty: 0.6,
  },
} as const;

/** Type export for god rays configuration */
export type GodRaysConfig = typeof GOD_RAYS_CONFIG;
