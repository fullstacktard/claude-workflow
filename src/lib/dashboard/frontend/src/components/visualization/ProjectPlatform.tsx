/**
 * ProjectPlatform Component
 * Renders a 3D platform representing a project in the visualization dashboard.
 *
 * Features:
 * - 3D box/building shape with configurable dimensions
 * - Project name displayed as HTML overlay positioned above platform
 * - Active project indicator (emissive glow + ring)
 * - Hover interaction with cursor change and color highlight
 * - Subtle floating animation for active platforms
 *
 * @example
 * <ProjectPlatform
 *   project={projectInfo}
 *   position={[0, 0, 0]}
 *   isActive={true}
 *   onHover={(id) => setHoveredProject(id)}
 *   onClick={(id) => handleProjectSelect(id)}
 * />
 *
 * @module components/visualization/ProjectPlatform
 */

import { memo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import type { Mesh, Group } from "three";
import type { ProjectInfo } from "../../types";

/* ============================================
 * TYPE DEFINITIONS
 * ============================================ */

/**
 * Props for ProjectPlatform component
 */
export interface ProjectPlatformProps {
  /** Project data to display */
  project: ProjectInfo;
  /** 3D position as [x, y, z] tuple */
  position: [number, number, number];
  /** Whether this project is currently active/selected */
  isActive?: boolean;
  /** Callback when hover state changes - null when unhovered */
  onHover?: (projectId: string | null) => void;
  /** Callback when platform is clicked */
  onClick?: (projectId: string) => void;
}

/* ============================================
 * CONSTANTS
 * ============================================ */

/** Platform dimensions - can be adjusted for visual balance */
const PLATFORM_WIDTH = 3;
const PLATFORM_HEIGHT = 0.5;
const PLATFORM_DEPTH = 2;

/**
 * Color configurations
 * Uses hex values that align with the OKLCH theme tokens in globals.css
 */
const COLORS = {
  /** Base platform color - gray-800 equivalent */
  base: "#1f2937",
  /** Hover highlight - gray-700 equivalent */
  hover: "#374151",
  /** Active platform - red-800 from theme */
  active: "#991b1b",
  /** Active glow - red-400 / primary from theme */
  activeGlow: "#f87171",
  /** Text color - gray-50 */
  text: "#f9fafb",
  /** Ground plane - near black */
  ground: "#0a0a0a",
} as const;

/* ============================================
 * COMPONENT
 * ============================================ */

/**
 * ProjectPlatform - 3D platform representing a project workspace
 *
 * Renders an interactive 3D platform with:
 * - Visual state changes for hover and active states
 * - Floating animation for active platforms
 * - HTML label overlay for project name
 * - Ring indicator at base for active platforms
 *
 * @param props - ProjectPlatformProps configuration
 * @returns JSX element containing the 3D platform group
 */
function ProjectPlatformComponent({
  project,
  position,
  isActive = false,
  onHover,
  onClick,
}: ProjectPlatformProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);

  // Set cursor to pointer on hover
  useCursor(hovered);

  // Subtle floating animation for active platforms
  useFrame((state) => {
    if (groupRef.current && isActive) {
      groupRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    }
  });

  /**
   * Handle pointer enter event
   * Updates hover state and notifies parent via callback
   */
  const handlePointerOver = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation();
    setHovered(true);
    onHover?.(project.path);
  };

  /**
   * Handle pointer leave event
   * Clears hover state and notifies parent
   */
  const handlePointerOut = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation();
    setHovered(false);
    onHover?.(null);
  };

  /**
   * Handle click event
   * Notifies parent of selection via callback
   */
  const handleClick = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onClick?.(project.path);
  };

  // Determine colors based on current state
  const baseColor = isActive
    ? COLORS.active
    : hovered
      ? COLORS.hover
      : COLORS.base;
  const emissiveColor = isActive ? COLORS.activeGlow : "#000000";
  const emissiveIntensity = isActive ? 0.3 : 0;

  return (
    <group ref={groupRef} position={position}>
      {/* Main platform mesh */}
      <mesh
        ref={meshRef}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_DEPTH]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          metalness={0.1}
          roughness={0.8}
        />
      </mesh>

      {/* Project name label - HTML overlay in 3D space */}
      <Html
        position={[0, PLATFORM_HEIGHT / 2 + 0.4, 0]}
        center
        distanceFactor={10}
        style={{
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <div className="px-2 py-1 bg-gray-900/90 border border-red-800 rounded text-xs font-mono text-gray-100 whitespace-nowrap">
          {project.name}
        </div>
      </Html>

      {/* Active indicator ring at platform base */}
      {isActive && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -PLATFORM_HEIGHT / 2 + 0.01, 0]}
        >
          <ringGeometry
            args={[PLATFORM_WIDTH / 2 + 0.1, PLATFORM_WIDTH / 2 + 0.2, 32]}
          />
          <meshBasicMaterial
            color={COLORS.activeGlow}
            transparent
            opacity={0.6}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Memoized ProjectPlatform component
 * Prevents unnecessary re-renders when parent state changes
 */
export const ProjectPlatform = memo(ProjectPlatformComponent);
