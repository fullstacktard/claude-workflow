/**
 * ProjectBase Component
 * Represents a project's base platform in the gym workflow visualization
 *
 * Each project has a base where agents spawn and return to after completing work.
 * Displays the project name label and indicates when agents are active.
 *
 * @module components/visualization/ProjectBase
 */

import { Html } from "@react-three/drei";
import { memo } from "react";

/**
 * Props for ProjectBase component
 */
export interface ProjectBaseProps {
  /** Unique project identifier */
  projectId: string;
  /** Display name for the project */
  projectName: string;
  /** Position in 3D space [x, y, z] */
  position: [number, number, number];
  /** Whether this project has active agents at the gym */
  hasActiveAgents?: boolean;
}

/**
 * ProjectBase component
 *
 * Renders a project base platform with a visible label showing the project name.
 * The platform changes color when agents are active at the gym.
 *
 * @param props - ProjectBase props
 * @returns JSX element containing the 3D mesh and label
 *
 * @example
 * <ProjectBase
 *   projectId="my-project"
 *   projectName="My Project"
 *   position={[5, 0, 6]}
 *   hasActiveAgents={true}
 * />
 */
export const ProjectBase = memo(function ProjectBase({
  projectName,
  position,
  hasActiveAgents = false,
}: ProjectBaseProps): JSX.Element {
  return (
    <group position={position}>
      {/* Platform base cylinder */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[1, 1, 0.2, 32]} />
        <meshStandardMaterial
          color={hasActiveAgents ? "#10b981" : "#374151"}
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* Glowing ring indicator */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.05, 32]} />
        <meshBasicMaterial
          color={hasActiveAgents ? "#34d399" : "#6b7280"}
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* Project name label - always visible */}
      <Html position={[0, 0.5, 0]} center distanceFactor={10}>
        <div className="bg-gray-900/90 text-gray-100 px-2 py-1 rounded text-xs whitespace-nowrap border border-gray-700">
          {projectName}
        </div>
      </Html>
    </group>
  );
});
