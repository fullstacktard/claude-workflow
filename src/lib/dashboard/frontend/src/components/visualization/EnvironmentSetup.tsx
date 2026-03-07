/**
 * EnvironmentSetup Component
 *
 * Creates the 3D environment for agent visualization:
 * - Grid-textured ground plane with fade at edges
 * - Atmospheric fog for depth perception
 * - Dark background matching dashboard theme
 *
 * This component should be placed inside a Canvas from @react-three/fiber.
 *
 * @module components/visualization/EnvironmentSetup
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <EnvironmentSetup />
 *   {// Other 3D content}
 * </Canvas>
 * ```
 */

import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { VISUALIZATION_CONFIG } from "../../config/visualization-config";

/**
 * Props for EnvironmentSetup component
 */
export interface EnvironmentSetupProps {
  /** Override fog enabled state (default: true) */
  fog?: boolean;
  /** Override grid enabled state (default: true) */
  grid?: boolean;
  /** Custom grid position offset [x, y, z] (default: [0, 0, 0]) */
  gridPosition?: [number, number, number];
  /** Override background color (default: from config) */
  backgroundColor?: string;
}

/**
 * Environment setup component for 3D visualization
 *
 * Provides a dark-themed environment with:
 * - Shader-based grid with smooth edge fade
 * - Linear fog for depth perception
 * - Configurable lighting for the scene
 *
 * @param props - EnvironmentSetup props
 * @returns JSX element with environment setup
 */
export function EnvironmentSetup({
  fog = true,
  grid = true,
  gridPosition = [0, 0, 0],
  backgroundColor,
}: EnvironmentSetupProps): JSX.Element {
  const { scene } = useThree();
  const { colors, fog: fogConfig, grid: gridConfig } = VISUALIZATION_CONFIG;

  // Convert hex colors to Three.js Color objects (memoized)
  const fogColor = useMemo(() => new THREE.Color(colors.fog), [colors.fog]);
  const bgColor = useMemo(
    () => new THREE.Color(backgroundColor ?? colors.skyBottom),
    [backgroundColor, colors.skyBottom]
  );

  // Set scene background and fog
  useEffect(() => {
    // Store original values for cleanup
    const originalBackground = scene.background;
    const originalFog = scene.fog;

    // Set scene background color
    scene.background = bgColor;

    // Set fog for depth perception
    if (fog) {
      scene.fog = new THREE.Fog(fogColor, fogConfig.near, fogConfig.far);
    } else {
      scene.fog = null;
    }

    // Cleanup on unmount - restore original values
    return () => {
      scene.background = originalBackground;
      scene.fog = originalFog;
    };
  }, [scene, fog, fogColor, fogConfig.near, fogConfig.far, bgColor]);

  return (
    <>
      {/* Ground plane with grid pattern */}
      {grid && (
        <Grid
          position={gridPosition}
          args={[gridConfig.size, gridConfig.size]}
          cellSize={gridConfig.cellSize}
          cellThickness={gridConfig.cellThickness}
          cellColor={colors.gridSecondary}
          sectionSize={gridConfig.sectionSize}
          sectionThickness={gridConfig.sectionThickness}
          sectionColor={colors.gridPrimary}
          fadeDistance={gridConfig.fadeDistance}
          fadeStrength={gridConfig.fadeStrength}
          fadeFrom={gridConfig.fadeFrom}
          followCamera={gridConfig.followCamera}
          infiniteGrid={gridConfig.infiniteGrid}
        />
      )}
    </>
  );
}

export default EnvironmentSetup;
