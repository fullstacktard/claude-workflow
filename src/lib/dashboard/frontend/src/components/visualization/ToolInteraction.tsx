/**
 * ToolInteraction Component
 * 3D visual feedback for agent tool/skill invocations using React Three Fiber
 *
 * Displays floating icons near agents when they invoke tools or skills.
 * Features:
 * - Distinct visual shapes for different tool types (skill, mcp_tool, read, edit, bash)
 * - Spawn animation with scale up (ease-out-back)
 * - Float animation with gentle upward drift
 * - Fade-out animation with scale down and opacity reduction
 * - Multiple simultaneous tools positioned to avoid overlap
 * - Billboard rotation to always face camera
 *
 * @module components/visualization/ToolInteraction
 *
 * @example
 * ```tsx
 * // Single tool interaction
 * <ToolInteraction
 *   event={{
 *     id: 'tool-1',
 *     toolType: 'skill',
 *     toolName: 'task-management',
 *     agentId: 'agent-123',
 *     timestamp: Date.now()
 *   }}
 *   agentPosition={new THREE.Vector3(0, 0, 0)}
 *   index={0}
 *   onComplete={(id) => console.log('Animation complete:', id)}
 * />
 *
 * // Container for multiple interactions
 * <ToolInteractionContainer
 *   interactions={interactions}
 *   agentPositions={agentPositionMap}
 *   onInteractionComplete={handleComplete}
 * />
 * ```
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { FONT_CONFIG } from "../../config/visualization-config";

// ============================================================================
// Types
// ============================================================================

/**
 * Tool types that can be visualized
 * - skill: Skill invocation (e.g., task-management, tailwind-v4)
 * - mcp_tool: MCP tool call (generic MCP tools)
 * - read: File read operations
 * - edit: File edit operations
 * - bash: Shell/terminal commands
 */
export type ToolType = "skill" | "mcp_tool" | "read" | "edit" | "bash";

/**
 * Visual configuration for each tool type
 */
export interface ToolVisualConfig {
  /** Shape to render for this tool type */
  shape: "star" | "gear" | "document" | "pencil" | "terminal";
  /** Color for the shape (hex string) */
  color: string;
  /** Label to display */
  label: string;
}

/**
 * Tool interaction event data
 * Represents a single tool invocation for visualization
 */
export interface ToolInteractionEvent {
  /** Unique identifier for this interaction */
  id: string;
  /** Type of tool being invoked */
  toolType: ToolType;
  /** Name of the tool (e.g., 'Read', 'mcp__serena__find_symbol') */
  toolName: string;
  /** ID of the agent invoking the tool */
  agentId: string;
  /** Timestamp when the tool was invoked */
  timestamp: number;
}

/**
 * Props for ToolInteraction component
 */
interface ToolInteractionProps {
  /** Tool interaction event data */
  event: ToolInteractionEvent;
  /** Position of the parent agent in 3D space */
  agentPosition: THREE.Vector3;
  /** Index for positioning multiple simultaneous tools */
  index: number;
  /** Callback when animation completes */
  onComplete: (id: string) => void;
}

/**
 * Props for ToolInteractionContainer component
 */
interface ToolInteractionContainerProps {
  /** Array of active tool interactions */
  interactions: ToolInteractionEvent[];
  /** Map of agent IDs to their 3D positions */
  agentPositions: Map<string, THREE.Vector3>;
  /** Callback when an interaction animation completes */
  onInteractionComplete: (id: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Animation duration in seconds
 * Total time from spawn to fade-out completion
 */
const ANIMATION_DURATION = 1.5;

/**
 * Angular spread between multiple simultaneous tools (radians)
 * ~30 degrees between adjacent tool icons
 */
const TOOL_ANGULAR_SPREAD = Math.PI / 6;

/**
 * Base offset distance from agent center
 */
const BASE_OFFSET_DISTANCE = 0.4;

/**
 * Vertical offset above agent
 */
const VERTICAL_OFFSET = 0.6;

/**
 * Maximum drift distance during float animation
 */
const FLOAT_DRIFT = 0.3;

// ============================================================================
// Visual Configuration
// ============================================================================

/**
 * Visual mapping for different tool types
 * Uses colors that complement the dashboard theme and stand out against dark background
 */
export const TOOL_VISUALS: Record<ToolType, ToolVisualConfig> = {
  skill: {
    shape: "star",
    color: "#fbbf24", // Amber-400 - Gold for skills
    label: "Skill",
  },
  mcp_tool: {
    shape: "gear",
    color: "#38bdf8", // Sky-400 - Deep sky blue for MCP
    label: "MCP",
  },
  read: {
    shape: "document",
    color: "#4ade80", // Green-400 - Light green for read
    label: "Read",
  },
  edit: {
    shape: "pencil",
    color: "#f87171", // Red-400 - Coral red for edit
    label: "Edit",
  },
  bash: {
    shape: "terminal",
    color: "#a78bfa", // Violet-400 - Medium purple for bash
    label: "Bash",
  },
};

// ============================================================================
// Easing Functions
// ============================================================================

/**
 * Ease-out-back easing function
 * Creates a slight overshoot effect for more satisfying spawn animation
 *
 * @param x - Progress from 0 to 1
 * @returns Eased value
 */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Ease-in quadratic easing function
 * Creates smooth acceleration for fade-out animation
 *
 * @param x - Progress from 0 to 1
 * @returns Eased value
 */
function easeInQuad(x: number): number {
  return x * x;
}

// ============================================================================
// Shape Components
// ============================================================================

/**
 * Common props for shape components
 */
interface ShapeProps {
  /** Color for the shape */
  color: string;
  /** Opacity for fade-out animation */
  opacity: number;
}

/**
 * Star shape for skills
 * Uses octahedron geometry for a crystal/star-like appearance
 */
function StarShape({ color, opacity }: ShapeProps): JSX.Element {
  return (
    <mesh>
      <octahedronGeometry args={[0.12, 0]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Gear shape for MCP tools
 * Uses torus geometry to represent a gear/cog
 */
function GearShape({ color, opacity }: ShapeProps): JSX.Element {
  return (
    <mesh>
      <torusGeometry args={[0.1, 0.035, 8, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Document shape for read operations
 * Uses box geometry to represent a document/file
 */
function DocumentShape({ color, opacity }: ShapeProps): JSX.Element {
  return (
    <mesh>
      <boxGeometry args={[0.1, 0.14, 0.02]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Pencil shape for edit operations
 * Uses cone geometry rotated to represent a pencil/pen
 */
function PencilShape({ color, opacity }: ShapeProps): JSX.Element {
  return (
    <mesh rotation={[0, 0, Math.PI / 4]}>
      <coneGeometry args={[0.04, 0.16, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Terminal shape for bash commands
 * Uses box geometry to represent a terminal/console window
 */
function TerminalShape({ color, opacity }: ShapeProps): JSX.Element {
  return (
    <mesh>
      <boxGeometry args={[0.16, 0.1, 0.02]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.4}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Get the appropriate shape component for a tool type
 *
 * @param shape - Shape type from ToolVisualConfig
 * @returns Shape component
 */
function getShapeComponent(
  shape: ToolVisualConfig["shape"]
): React.FC<ShapeProps> {
  switch (shape) {
    case "star":
      return StarShape;
    case "gear":
      return GearShape;
    case "document":
      return DocumentShape;
    case "pencil":
      return PencilShape;
    case "terminal":
      return TerminalShape;
    default:
      return StarShape;
  }
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * ToolInteraction Component
 *
 * Displays a floating tool indicator near an agent with spawn, float, and fade-out animation.
 * Animation phases:
 * - Spawn (0-20%): Scale up with ease-out-back overshoot
 * - Float (20-80%): Gentle upward drift
 * - Fade (80-100%): Scale down and fade out
 *
 * @param props - ToolInteraction props
 * @returns JSX element containing the animated 3D tool indicator
 */
export function ToolInteraction({
  event,
  agentPosition,
  index,
  onComplete,
}: ToolInteractionProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number>(-1);
  const opacityRef = useRef<number>(1);
  const completedRef = useRef<boolean>(false);

  const config = TOOL_VISUALS[event.toolType];

  // Calculate offset position to avoid overlapping
  // Spread tools in a circular pattern around the agent
  const offsetAngle = index * TOOL_ANGULAR_SPREAD;
  const baseOffset = useMemo(() => {
    return new THREE.Vector3(
      Math.cos(offsetAngle) * BASE_OFFSET_DISTANCE,
      VERTICAL_OFFSET,
      Math.sin(offsetAngle) * BASE_OFFSET_DISTANCE
    );
  }, [offsetAngle]);

  // Reset completed flag when event changes
  useEffect(() => {
    completedRef.current = false;
    startTimeRef.current = -1;
  }, [event.id]);

  // Animation loop
  useFrame((state) => {
    if (!groupRef.current || completedRef.current) return;

    // Initialize start time on first frame
    if (startTimeRef.current < 0) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const normalizedProgress = Math.min(elapsed / ANIMATION_DURATION, 1);

    // Animation phase boundaries
    const spawnEnd = 0.2;
    const fadeStart = 0.8;

    let scale = 1;
    let opacity = 1;
    let yOffset = 0;

    if (normalizedProgress < spawnEnd) {
      // Spawn phase: ease-out-back scale up
      const spawnProgress = normalizedProgress / spawnEnd;
      scale = easeOutBack(spawnProgress);
      opacity = Math.min(spawnProgress * 2, 1); // Fade in quickly
    } else if (normalizedProgress < fadeStart) {
      // Float phase: gentle upward drift
      const floatProgress =
        (normalizedProgress - spawnEnd) / (fadeStart - spawnEnd);
      yOffset = floatProgress * FLOAT_DRIFT;
      scale = 1;
      opacity = 1;
    } else {
      // Fade phase: scale down and reduce opacity
      const fadeProgress =
        (normalizedProgress - fadeStart) / (1 - fadeStart);
      scale = 1 - easeInQuad(fadeProgress) * 0.5;
      opacity = 1 - easeInQuad(fadeProgress);
      yOffset = FLOAT_DRIFT + fadeProgress * 0.1;
    }

    // Apply transformations
    groupRef.current.scale.setScalar(Math.max(scale, 0.01));
    groupRef.current.position.copy(agentPosition).add(baseOffset);
    groupRef.current.position.y += yOffset;

    // Gentle rotation for visual interest
    groupRef.current.rotation.y =
      state.clock.elapsedTime * 0.8 + index * 0.5;

    // Store opacity for shape components
    opacityRef.current = opacity;

    // Trigger completion callback when animation finishes
    if (normalizedProgress >= 1 && !completedRef.current) {
      completedRef.current = true;
      onComplete(event.id);
    }
  });

  // Get the shape component for this tool type
  const ShapeComponent = useMemo(() => {
    return getShapeComponent(config.shape);
  }, [config.shape]);

  // Truncate long tool names for display
  const displayName = useMemo(() => {
    const name = event.toolName;
    // Strip common prefixes for cleaner display
    const cleanName = name
      .replace(/^mcp__[^_]+__/, "") // Remove mcp__server__ prefix
      .replace(/^mcp__/, ""); // Remove mcp__ prefix
    return cleanName.length > 10 ? cleanName.slice(0, 10) + "..." : cleanName;
  }, [event.toolName]);

  return (
    <group ref={groupRef}>
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <ShapeComponent color={config.color} opacity={opacityRef.current} />
        {/* Tool name label - using Geist font to match dashboard */}
        <Text
          position={[0, -0.18, 0]}
          font={FONT_CONFIG.geistMedium}
          fontSize={0.06}
          color={config.color}
          anchorX="center"
          anchorY="top"
          outlineWidth={0.004}
          outlineColor={FONT_CONFIG.outlineColor}
        >
          {displayName}
        </Text>
      </Billboard>
    </group>
  );
}

// ============================================================================
// Container Component
// ============================================================================

/**
 * ToolInteractionContainer Component
 *
 * Manages multiple tool interactions, handling positioning to prevent overlaps.
 * Groups interactions by agent to calculate proper indices for circular positioning.
 *
 * @param props - ToolInteractionContainer props
 * @returns JSX element containing all active tool interactions
 */
export function ToolInteractionContainer({
  interactions,
  agentPositions,
  onInteractionComplete,
}: ToolInteractionContainerProps): JSX.Element {
  // Group interactions by agent to calculate indices for positioning
  const interactionsByAgent = useMemo(() => {
    const grouped = new Map<string, ToolInteractionEvent[]>();
    for (const interaction of interactions) {
      const existing = grouped.get(interaction.agentId) || [];
      existing.push(interaction);
      grouped.set(interaction.agentId, existing);
    }
    return grouped;
  }, [interactions]);

  return (
    <group name="tool-interactions">
      {interactions.map((interaction) => {
        const agentPosition = agentPositions.get(interaction.agentId);
        if (!agentPosition) return null;

        // Get index within this agent's interactions for positioning
        const agentInteractions =
          interactionsByAgent.get(interaction.agentId) || [];
        const index = agentInteractions.findIndex(
          (i) => i.id === interaction.id
        );

        return (
          <ToolInteraction
            key={interaction.id}
            event={interaction}
            agentPosition={agentPosition}
            index={index >= 0 ? index : 0}
            onComplete={onInteractionComplete}
          />
        );
      })}
    </group>
  );
}
