/**
 * SpecialBuilding Component
 * Renders special buildings like Guild Hall (Skills) and MCP towers
 *
 * @module components/visualization/SpecialBuilding
 */

import { useMemo } from "react";
import { Text } from "@react-three/drei";
import type {
  SpecialBuildingType,
  SpecialBuildingConfig,
} from "../../config/special-buildings-config";
import { getSpecialBuildingConfig } from "../../config/special-buildings-config";
import { FONT_CONFIG } from "../../config/visualization-config";

export interface SpecialBuildingProps {
  /** Type of special building */
  buildingType: SpecialBuildingType;
  /** Override position (optional) */
  position?: [number, number, number];
  /** Whether the building is currently active */
  isActive?: boolean;
}

/**
 * SpecialBuilding renders a medieval-themed building for Skills or MCP servers
 *
 * Visual design varies by type:
 * - skills (Guild Hall): Large hall with peaked roof
 * - Individual MCPs (exa, context7, serena, etc.): Smaller workshop buildings
 */
export function SpecialBuilding({
  buildingType,
  position: overridePosition,
  isActive = false,
}: SpecialBuildingProps): JSX.Element {
  const config: SpecialBuildingConfig = getSpecialBuildingConfig(buildingType);
  const position = overridePosition ?? config.position;
  const scale = config.scale;

  // Parse colors
  const baseColor = config.color;
  const glowColor = config.emissiveColor;
  const emissiveIntensity = isActive ? 0.8 : 0.3;

  // Building geometry based on type
  const buildingGeometry = useMemo(() => {
    switch (buildingType) {
      case "skills":
        // Guild Hall - large rectangular building with peaked roof
        return (
          <group>
            {/* Main building */}
            <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.5 * scale, 1.5 * scale, 2 * scale]} />
              <meshStandardMaterial
                color={baseColor}
                emissive={glowColor}
                emissiveIntensity={emissiveIntensity}
              />
            </mesh>
            {/* Peaked roof */}
            <mesh position={[0, 1.75 * scale, 0]} castShadow>
              <coneGeometry args={[1.8 * scale, 1 * scale, 4]} />
              <meshStandardMaterial color="#8b4513" />
            </mesh>
            {/* Door */}
            <mesh position={[0, 0.4, 1.01 * scale]}>
              <boxGeometry args={[0.4 * scale, 0.8 * scale, 0.1]} />
              <meshStandardMaterial color="#2d1f14" />
            </mesh>
          </group>
        );

      default:
        // Small workshop buildings for individual MCPs
        return (
          <group>
            {/* Main structure */}
            <mesh position={[0, 0.5 * scale, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.2 * scale, 1 * scale, 1.2 * scale]} />
              <meshStandardMaterial
                color={baseColor}
                emissive={glowColor}
                emissiveIntensity={emissiveIntensity}
              />
            </mesh>
            {/* Sloped roof */}
            <mesh position={[0, 1.15 * scale, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[1 * scale, 0.6 * scale, 4]} />
              <meshStandardMaterial color="#5d4037" />
            </mesh>
          </group>
        );
    }
  }, [buildingType, scale, baseColor, glowColor, emissiveIntensity]);

  return (
    <group position={position}>
      {buildingGeometry}

      {/* Label - using Geist font to match dashboard */}
      <Text
        position={[0, 2.5 * scale, 0]}
        font={FONT_CONFIG.geistMedium}
        fontSize={FONT_CONFIG.labelFontSize}
        color="white"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={FONT_CONFIG.outlineWidth}
        outlineColor={FONT_CONFIG.outlineColor}
      >
        {config.label}
      </Text>
    </group>
  );
}

export default SpecialBuilding;
