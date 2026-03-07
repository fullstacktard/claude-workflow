/**
 * Scene3D Component
 * Foundational 3D scene wrapper using React Three Fiber
 *
 * Provides:
 * - WebGL2 detection with graceful fallback
 * - Pre-configured camera and lighting
 * - Responsive canvas sizing
 * - Project platform grid layout support
 * - OrbitControls for camera manipulation
 *
 * @module components/visualization/Scene3D
 */

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";

import type { Scene3DProps, WebGLState } from "../../types/visualization";
import type { ProjectInfo } from "../../types";
import {
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_LIGHT_CONFIG,
} from "../../types/visualization";
import { ProjectPlatform } from "./ProjectPlatform";
import { PostProcessingEffects } from "./PostProcessingEffects";
import { EnvironmentSetup } from "./EnvironmentSetup";
import { AdaptiveQuality, useAdaptiveQuality } from "./AdaptiveQuality";
import { PerformanceOverlay } from "./PerformanceOverlay";
import {
  getEffectsEnabled,
  type EffectQuality,
} from "../../config/visualization-config";

/**
 * Check if WebGL2 is supported and available in the browser
 *
 * @returns WebGLState object with support status and optional error message
 */
function checkWebGL2Support(): WebGLState {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ?? canvas.getContext("experimental-webgl2");

    if (gl === null) {
      return {
        isSupported: false,
        errorMessage:
          "WebGL2 is not supported by your browser. Please try Chrome, Firefox, or Safari.",
      };
    }

    return { isSupported: true };
  } catch {
    return {
      isSupported: false,
      errorMessage:
        "Failed to initialize WebGL2. Your graphics card may not be supported.",
    };
  }
}

/**
 * Fallback UI shown when WebGL2 is not supported
 */
function WebGLFallback({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8">
      <div className="text-6xl mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-yellow-500"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-2">
        3D Visualization Unavailable
      </h2>
      <p className="text-gray-400 text-center max-w-md">{message}</p>
      <p className="text-gray-500 text-sm mt-4">
        Supported browsers: Chrome 56+, Firefox 51+, Safari 15+, Edge 79+
      </p>
    </div>
  );
}

/**
 * Default lighting setup for the scene
 * Combines ambient light for fill and directional light for shadows/depth
 */
function DefaultLighting(): JSX.Element {
  return (
    <>
      <ambientLight intensity={DEFAULT_LIGHT_CONFIG.ambientIntensity} />
      <directionalLight
        castShadow
        intensity={DEFAULT_LIGHT_CONFIG.directionalIntensity}
        position={DEFAULT_LIGHT_CONFIG.directionalPosition}
      />
    </>
  );
}

/* ============================================
 * GRID LAYOUT CONFIGURATION
 * ============================================ */

/** Number of columns in the platform grid */
const GRID_COLUMNS = 3;
/** Spacing between platforms in the grid */
const GRID_SPACING = 4;

/**
 * Calculate grid position for a platform at the given index
 */
function getGridPosition(index: number): [number, number, number] {
  const col = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  const x = (col - (GRID_COLUMNS - 1) / 2) * GRID_SPACING;
  const z = row * GRID_SPACING;
  return [x, 0, z];
}

/* ============================================
 * GROUND PLANE COMPONENT
 * ============================================ */

/**
 * Ground plane that receives shadows and provides visual grounding
 */
function GroundPlane(): JSX.Element {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.3, 2]}
      receiveShadow
    >
      <planeGeometry args={[50, 50]} />
      <meshStandardMaterial color="#0a0a0a" metalness={0.2} roughness={0.9} />
    </mesh>
  );
}

/* ============================================
 * ENHANCED LIGHTING
 * ============================================ */

/**
 * Enhanced lighting setup with spotlights for better shadows
 * and dramatic effect suitable for platform visualization
 */
function EnhancedLighting(): JSX.Element {
  return (
    <>
      <ambientLight intensity={DEFAULT_LIGHT_CONFIG.ambientIntensity} />
      <spotLight
        position={[10, 15, 10]}
        angle={0.3}
        penumbra={0.5}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight
        position={[-10, 15, -10]}
        angle={0.3}
        penumbra={0.5}
        intensity={0.5}
      />
    </>
  );
}

/* ============================================
 * PROJECT PLATFORM SCENE
 * ============================================ */

/**
 * Props for ProjectPlatformScene component
 */
interface ProjectPlatformSceneProps {
  projects: ProjectInfo[];
  activeProjectId?: string;
  onProjectSelect?: (projectId: string) => void;
  onProjectHover?: (projectId: string | null) => void;
}

/**
 * Renders all project platforms in a grid layout
 */
function ProjectPlatformScene({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectHover,
}: ProjectPlatformSceneProps): JSX.Element {
  return (
    <group>
      {projects.map((project, index) => (
        <ProjectPlatform
          key={project.path}
          project={project}
          position={getGridPosition(index)}
          isActive={project.path === activeProjectId}
          onClick={() => onProjectSelect?.(project.path)}
          onHover={onProjectHover}
        />
      ))}
    </group>
  );
}

/* ============================================
 * EXTENDED SCENE3D PROPS
 * ============================================ */

/**
 * Extended props for Scene3D component with project platform support
 */
export interface Scene3DExtendedProps extends Scene3DProps {
  /** Array of projects to display as platforms */
  projects?: ProjectInfo[];
  /** ID of currently active/selected project */
  activeProjectId?: string;
  /** Callback when project is selected */
  onProjectSelect?: (projectId: string) => void;
  /** Callback when project hover state changes */
  onProjectHover?: (projectId: string | null) => void;
  /** Whether to show enhanced lighting (spotlights + shadows) */
  enhancedLighting?: boolean;
  /** Whether to show ground plane */
  showGround?: boolean;
  /** Whether to enable orbit controls */
  enableControls?: boolean;
  /** Enable post-processing effects (bloom, vignette, tone mapping) */
  enableEffects?: boolean;
  /** Quality preset for post-processing effects */
  effectsQuality?: EffectQuality;
  /** Whether to show environment setup (grid, fog, skybox) */
  showEnvironment?: boolean;
  /** Enable adaptive quality adjustment (default: true) */
  enableAdaptiveQuality?: boolean;
  /** Show performance overlay (default: true in dev mode only) */
  showPerformanceOverlay?: boolean;
}

/* ============================================
 * QUALITY-AWARE POST PROCESSING
 * ============================================ */

/**
 * Post-processing effects that respond to adaptive quality level.
 * Disables effects entirely when quality is "minimal".
 * Uses quality context to determine the appropriate effect quality.
 */
function QualityAwarePostProcessing({
  fallbackEnabled,
}: {
  fallbackEnabled: boolean;
}): JSX.Element | null {
  const { settings } = useAdaptiveQuality();

  if (settings.effectsQuality === "disabled") {
    return null;
  }

  return (
    <PostProcessingEffects
      enabled={fallbackEnabled}
      quality={settings.effectsQuality}
    />
  );
}

/**
 * Scene3D component
 *
 * Main 3D scene container that wraps React Three Fiber Canvas.
 * Handles WebGL2 detection and provides default camera/lighting setup.
 * Supports rendering ProjectPlatform components in a grid layout.
 *
 * @param props - Scene3D props including optional className, children, and project data
 * @returns JSX element containing either the 3D canvas or fallback UI
 *
 * @example
 * // Basic usage with children
 * <Scene3D className="h-full">
 *   <MyCustomMesh />
 * </Scene3D>
 *
 * @example
 * // With project platforms
 * <Scene3D
 *   className="h-full"
 *   projects={projects}
 *   activeProjectId={selectedProject}
 *   onProjectSelect={handleSelect}
 *   enhancedLighting
 *   showGround
 *   enableControls
 * />
 */
export function Scene3D({
  className,
  children,
  onCreated,
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectHover,
  enhancedLighting = false,
  showGround = false,
  enableControls = false,
  enableEffects,
  effectsQuality = "medium",
  showEnvironment = false,
  enableAdaptiveQuality = true,
  showPerformanceOverlay,
}: Scene3DExtendedProps): JSX.Element {
  const [webGLState, setWebGLState] = useState<WebGLState>({
    isSupported: true,
  });

  // Initialize effects state from localStorage/prefers-reduced-motion
  // If enableEffects prop is provided, use it; otherwise use stored preference
  const [effectsEnabled, setEffectsEnabled] = useState<boolean>(() => {
    if (enableEffects !== undefined) return enableEffects;
    return getEffectsEnabled();
  });

  // Sync with prop changes
  useEffect(() => {
    if (enableEffects !== undefined) {
      setEffectsEnabled(enableEffects);
    }
  }, [enableEffects]);

  // Check WebGL2 support on mount
  useEffect(() => {
    const state = checkWebGL2Support();
    setWebGLState(state);
  }, []);

  // Memoize camera config to prevent re-renders
  // Adjusted position for better view of platform grid
  const cameraConfig = useMemo(
    () => ({
      position: projects?.length
        ? ([0, 8, 12] as [number, number, number])
        : DEFAULT_CAMERA_CONFIG.position,
      fov: projects?.length ? 50 : DEFAULT_CAMERA_CONFIG.fov,
      near: DEFAULT_CAMERA_CONFIG.near,
      far: DEFAULT_CAMERA_CONFIG.far,
    }),
    [projects?.length]
  );

  // Show fallback if WebGL2 not supported
  if (!webGLState.isSupported) {
    return (
      <div className={className}>
        <WebGLFallback
          message={webGLState.errorMessage ?? "WebGL2 is not supported"}
        />
      </div>
    );
  }

  return (
    <div className={className} style={{ height: "100%", width: "100%" }}>
      <Canvas
        camera={cameraConfig}
        dpr={[1, 2]}
        shadows={enhancedLighting}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={() => {
          onCreated?.();
        }}
      >
        <AdaptiveQuality enabled={enableAdaptiveQuality}>
          {/* Lighting */}
          {enhancedLighting ? <EnhancedLighting /> : <DefaultLighting />}

          {/* Environment for reflections (when enhanced lighting is on) */}
          {enhancedLighting && <Environment preset="night" />}

          {/* Environment setup (grid, fog, background) */}
          {showEnvironment && <EnvironmentSetup />}

          {/* Ground plane */}
          {showGround && <GroundPlane />}

          {/* Project platforms in grid layout */}
          {projects && projects.length > 0 && (
            <ProjectPlatformScene
              projects={projects}
              activeProjectId={activeProjectId}
              onProjectSelect={onProjectSelect}
              onProjectHover={onProjectHover}
            />
          )}

          {/* Orbit controls for camera manipulation */}
          {enableControls && (
            <OrbitControls
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              minDistance={5}
              maxDistance={30}
              maxPolarAngle={Math.PI / 2.2}
            />
          )}

          {/* Custom children */}
          {children}

          {/* Post-processing effects - quality-aware when adaptive is enabled */}
          {enableAdaptiveQuality ? (
            <QualityAwarePostProcessing fallbackEnabled={effectsEnabled} />
          ) : (
            <PostProcessingEffects
              enabled={effectsEnabled}
              quality={effectsQuality}
            />
          )}

          {/* Performance overlay - dev mode only by default */}
          {(showPerformanceOverlay ?? import.meta.env.DEV) && (
            <PerformanceOverlay forceShow={showPerformanceOverlay} />
          )}
        </AdaptiveQuality>
      </Canvas>
    </div>
  );
}
