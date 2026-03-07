/**
 * ToolStall Component
 * Medieval-themed tool interaction point for visualization
 *
 * Tool stalls are locations around the town square where agents walk
 * when using specific tools. Each stall type has unique geometry
 * representing its tool category:
 *
 * - Blacksmith: Forge with anvil for editing tools (Edit, Write, Bash)
 * - Scribe: Desk with scrolls for reading tools (Read, docs)
 * - Alchemist: Table with cauldron for research tools (Context7, EXA)
 * - Map: Large table with map for navigation tools (Serena, Grep, Glob)
 * - Messenger: Post with scrolls for communication tools (WebFetch, Task)
 *
 * @module components/visualization/ToolStall
 */

import { Html } from "@react-three/drei";
import { memo } from "react";
import type { StallType, StallVisualConfig } from "../../config/tool-stall-config";
import { STALL_VISUALS } from "../../config/tool-stall-config";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Props for ToolStall component
 */
export interface ToolStallProps {
  /** Type of stall determining visual appearance */
  stallType: StallType;
  /** Position in 3D space [x, y, z] */
  position: [number, number, number];
  /** Whether an agent is currently using this stall */
  isActive?: boolean;
  /** Name of the tool currently being used (if active) */
  currentTool?: string;
}

/**
 * Props for StallGeometry internal component
 */
interface StallGeometryProps {
  /** Type of stall determining geometry */
  stallType: StallType;
  /** Glow intensity based on active state (0.1 inactive, 0.6 active) */
  glowIntensity: number;
  /** Visual configuration for the stall */
  config: StallVisualConfig;
}

// =============================================================================
// Stall Geometry Components
// =============================================================================

/**
 * BlacksmithGeometry - Forge with anvil
 *
 * Renders a blacksmith forge setup:
 * - Base platform (stone/wood)
 * - Anvil on the platform (metallic)
 * - Chimney/forge back (glows when active)
 */
function BlacksmithGeometry({ glowIntensity, config }: Omit<StallGeometryProps, "stallType">): JSX.Element {
  return (
    <group>
      {/* Base platform */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.5, 0.3, 1.2]} />
        <meshStandardMaterial color={config.color} metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Anvil */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.6, 0.4, 0.3]} />
        <meshStandardMaterial
          color="#333333"
          metalness={0.8}
          roughness={0.2}
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity * 0.5}
        />
      </mesh>
      {/* Chimney/forge back */}
      <mesh position={[0, 0.8, -0.4]} castShadow>
        <boxGeometry args={[0.8, 1.2, 0.4]} />
        <meshStandardMaterial
          color="#2a2a2a"
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity}
        />
      </mesh>
    </group>
  );
}

/**
 * ScribeGeometry - Desk with scroll tent
 *
 * Renders a scribe's workspace:
 * - Desk/table for writing
 * - Table legs
 * - Tent canopy for shade
 */
function ScribeGeometry({ glowIntensity, config }: Omit<StallGeometryProps, "stallType">): JSX.Element {
  const legPositions: [number, number, number][] = [
    [-0.5, 0.175, -0.3],
    [0.5, 0.175, -0.3],
    [-0.5, 0.175, 0.3],
    [0.5, 0.175, 0.3],
  ];

  return (
    <group>
      {/* Desk/table */}
      <mesh position={[0, 0.4, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.2, 0.1, 0.8]} />
        <meshStandardMaterial color={config.color} roughness={0.8} />
      </mesh>
      {/* Table legs */}
      {legPositions.map((pos, i) => (
        <mesh key={`scribe-leg-${i}`} position={pos} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.35, 8]} />
          <meshStandardMaterial color="#5c4033" />
        </mesh>
      ))}
      {/* Tent canopy */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <coneGeometry args={[1.0, 0.8, 4]} />
        <meshStandardMaterial
          color="#8b7355"
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity * 0.3}
        />
      </mesh>
    </group>
  );
}

/**
 * AlchemistGeometry - Table with cauldron
 *
 * Renders an alchemist's lab:
 * - Work table
 * - Cauldron (half-sphere)
 * - Glowing potion inside
 * - Decorative bottles
 */
function AlchemistGeometry({ glowIntensity, config }: Omit<StallGeometryProps, "stallType">): JSX.Element {
  const bottlePositions: [number, number, number][] = [
    [-0.4, 0.5, 0.3],
    [0.4, 0.5, -0.3],
  ];

  return (
    <group>
      {/* Table */}
      <mesh position={[0, 0.35, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.4, 0.1, 1.0]} />
        <meshStandardMaterial color={config.color} roughness={0.7} />
      </mesh>
      {/* Cauldron (half sphere) */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <sphereGeometry args={[0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Glowing potion inside */}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.15, 16]} />
        <meshStandardMaterial
          color={config.emissiveColor}
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity}
          transparent
          opacity={0.8}
        />
      </mesh>
      {/* Bottles decoration */}
      {bottlePositions.map((pos, i) => (
        <mesh key={`alchemist-bottle-${i}`} position={pos} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 0.25, 8]} />
          <meshStandardMaterial color="#4a6741" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * MapGeometry - Large table with map
 *
 * Renders a cartographer's table:
 * - Large table surface
 * - Table legs
 * - Map surface (glows when active)
 * - Compass decoration
 */
function MapGeometry({ glowIntensity, config }: Omit<StallGeometryProps, "stallType">): JSX.Element {
  const legPositions: [number, number, number][] = [
    [-0.7, 0.175, -0.5],
    [0.7, 0.175, -0.5],
    [-0.7, 0.175, 0.5],
    [0.7, 0.175, 0.5],
  ];

  return (
    <group>
      {/* Large table */}
      <mesh position={[0, 0.4, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.6, 0.08, 1.2]} />
        <meshStandardMaterial color={config.color} roughness={0.7} />
      </mesh>
      {/* Table legs */}
      {legPositions.map((pos, i) => (
        <mesh key={`map-leg-${i}`} position={pos} castShadow>
          <boxGeometry args={[0.1, 0.35, 0.1]} />
          <meshStandardMaterial color="#5c4033" />
        </mesh>
      ))}
      {/* Map surface (glows when active) */}
      <mesh position={[0, 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.4, 1.0]} />
        <meshStandardMaterial
          color="#d4c4a8"
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity * 0.4}
        />
      </mesh>
      {/* Compass decoration */}
      <mesh position={[0.5, 0.48, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.12, 32]} />
        <meshStandardMaterial
          color="#b8860b"
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity}
        />
      </mesh>
    </group>
  );
}

/**
 * MessengerGeometry - Wooden post with perch
 *
 * Renders a messenger station:
 * - Main wooden post
 * - Cross beam for perch
 * - Message box
 * - Bird silhouette when active
 */
function MessengerGeometry({ glowIntensity, config }: Omit<StallGeometryProps, "stallType">): JSX.Element {
  return (
    <group>
      {/* Main post */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 1.4, 8]} />
        <meshStandardMaterial color="#5c4033" roughness={0.8} />
      </mesh>
      {/* Cross beam for perch */}
      <mesh position={[0, 1.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.8, 8]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {/* Message box */}
      <mesh position={[0, 0.5, 0.15]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.2]} />
        <meshStandardMaterial
          color={config.color}
          emissive={config.emissiveColor}
          emissiveIntensity={glowIntensity * 0.5}
        />
      </mesh>
      {/* Bird/pigeon silhouette (appears when active) */}
      {glowIntensity > 0.3 && (
        <mesh position={[0.2, 1.25, 0]}>
          <coneGeometry args={[0.08, 0.15, 8]} />
          <meshStandardMaterial
            color="#808080"
            emissive={config.emissiveColor}
            emissiveIntensity={glowIntensity * 0.3}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * FallbackGeometry - Simple pedestal for unknown stall types
 *
 * Used as a fallback when stall type is not recognized.
 */
function FallbackGeometry(): JSX.Element {
  return (
    <mesh position={[0, 0.25, 0]} receiveShadow castShadow>
      <cylinderGeometry args={[0.5, 0.6, 0.5, 8]} />
      <meshStandardMaterial color="#666666" />
    </mesh>
  );
}

/**
 * StallGeometry - Renders unique geometry for each stall type
 *
 * Dispatches to the appropriate geometry component based on stall type.
 *
 * @param props - StallGeometry props
 * @returns JSX element containing the 3D geometry for the stall
 */
function StallGeometry({ stallType, glowIntensity, config }: StallGeometryProps): JSX.Element {
  switch (stallType) {
    case "blacksmith":
      return <BlacksmithGeometry glowIntensity={glowIntensity} config={config} />;
    case "scribe":
      return <ScribeGeometry glowIntensity={glowIntensity} config={config} />;
    case "alchemist":
      return <AlchemistGeometry glowIntensity={glowIntensity} config={config} />;
    case "map":
      return <MapGeometry glowIntensity={glowIntensity} config={config} />;
    case "messenger":
      return <MessengerGeometry glowIntensity={glowIntensity} config={config} />;
    default:
      return <FallbackGeometry />;
  }
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * ToolStall component
 *
 * Renders a medieval-themed tool stall with unique geometry per stall type.
 * Glows when an agent is actively using tools at this location.
 *
 * Features:
 * - Unique 3D geometry for each stall type
 * - Glow effect when active (emissive materials)
 * - Floating label showing stall name
 * - Current tool name displayed when active
 * - Memoized for performance
 *
 * @param props - ToolStall props
 * @returns JSX element containing the 3D mesh and label
 *
 * @example
 * // Inactive stall
 * <ToolStall
 *   stallType="blacksmith"
 *   position={[-4, 0, 2]}
 * />
 *
 * @example
 * // Active stall with tool name
 * <ToolStall
 *   stallType="blacksmith"
 *   position={[-4, 0, 2]}
 *   isActive={true}
 *   currentTool="Edit"
 * />
 */
export const ToolStall = memo(function ToolStall({
  stallType,
  position,
  isActive = false,
  currentTool,
}: ToolStallProps): JSX.Element {
  const config = STALL_VISUALS[stallType];
  const glowIntensity = isActive ? 0.6 : 0.1;

  return (
    <group position={position}>
      {/* Stall-specific geometry */}
      <StallGeometry stallType={stallType} glowIntensity={glowIntensity} config={config} />

      {/* Floating label - shows stall name and current tool */}
      <Html position={[0, 1.5, 0]} center distanceFactor={12}>
        <div
          className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
            isActive
              ? "bg-amber-900/90 text-amber-100 border-amber-600"
              : "bg-gray-900/80 text-gray-300 border-gray-700"
          }`}
        >
          <div className="font-bold">{config.label}</div>
          {isActive && currentTool && (
            <div className="text-xs mt-0.5 text-amber-300">{currentTool}</div>
          )}
        </div>
      </Html>
    </group>
  );
});

// Re-export types for convenience
export type { StallType };
