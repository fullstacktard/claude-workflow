/**
 * Visualization Types
 * Type definitions for 3D visualization components and state management
 */

import type { ReactNode } from "react";

// ============================================================================
// Scene3D Component Types
// ============================================================================

/**
 * Props for Scene3D component
 */
export interface Scene3DProps {
  /** Optional className for container styling */
  className?: string;
  /** Children to render inside the Canvas */
  children?: ReactNode;
  /** Callback when scene is created */
  onCreated?: () => void;
}

/**
 * Camera configuration for 3D scene
 */
export interface CameraConfig {
  /** Camera position [x, y, z] */
  position: [number, number, number];
  /** Field of view in degrees */
  fov: number;
  /** Near clipping plane */
  near?: number;
  /** Far clipping plane */
  far?: number;
}

/**
 * WebGL context state
 */
export interface WebGLState {
  /** Whether WebGL2 is supported */
  isSupported: boolean;
  /** Error message if not supported */
  errorMessage?: string;
}

/**
 * Light configuration
 */
export interface LightConfig {
  /** Ambient light intensity (0-1) */
  ambientIntensity: number;
  /** Directional light intensity (0-1) */
  directionalIntensity: number;
  /** Directional light position */
  directionalPosition: [number, number, number];
}

/**
 * Default camera configuration
 */
export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  position: [0, 5, 10],
  fov: 75,
  near: 0.1,
  far: 1000,
};

/**
 * Default light configuration
 */
export const DEFAULT_LIGHT_CONFIG: LightConfig = {
  ambientIntensity: 0.4,
  directionalIntensity: 0.8,
  directionalPosition: [10, 10, 5],
};

// ============================================================================
// Visualization State Types (for useVisualizationState hook)
// ============================================================================

/**
 * 3D position tuple [x, y, z]
 */
export type Position3D = [number, number, number];

/**
 * Agent status for visualization (work area workflow)
 * - spawning: Agent is being created at project base (brief spawn animation)
 * - walking_to_work: Agent is walking from project base to work area
 * - working: Agent is at work area, actively processing a task
 * - visiting_stall: Agent is walking to or at an MCP building
 * - returning_to_work: Agent is returning from MCP building back to work area
 * - walking_to_base: Agent is walking from work area back to project base (after completion)
 * - removing: Agent is disappearing at base (exit animation)
 *
 * Legacy statuses (for backward compatibility):
 * - idle: Agent is spawned but not actively processing
 * - completed: Agent has finished its task (brief visibility period)
 */
export type AgentVisualStatus =
  | "spawning"
  | "walking_to_work"
  | "working"
  | "visiting_stall"
  | "returning_to_work"
  | "walking_to_base"
  | "removing"
  | "idle"
  | "completed";

/**
 * Project visualization data
 * Represents a project node in the 3D scene
 */
export interface ProjectVisualization {
  /** Unique project identifier (project name) */
  id: string;
  /** Display name */
  name: string;
  /** 3D position [x, y, z] in world coordinates */
  position: Position3D;
  /** IDs of agents belonging to this project */
  agentIds: string[];
  /** Number of currently active (working) agents */
  activeAgentCount: number;
}

/**
 * Agent visualization data
 * Represents an agent node in the 3D scene
 */
export interface AgentVisualization {
  /** Unique agent identifier (projectName-agentType-timestamp) */
  id: string;
  /** Agent type (e.g., "frontend-engineer", "backend-engineer") */
  type: string;
  /** Parent project ID */
  projectId: string;
  /** 3D position [x, y, z] in world coordinates */
  position: Position3D;
  /** Base position (project spawn point) for return journey in gym workflow */
  basePosition: Position3D;
  /** Current status */
  status: AgentVisualStatus;
  /** Currently invoked tool (if any) */
  currentTool?: string;
  /** Target stall type being visited (medieval village feature) */
  targetStall?: string;
  /** Target stall position for animation (medieval village feature) */
  stallPosition?: Position3D;
  /** ISO timestamp when agent was spawned */
  spawnedAt?: string;
  /** ISO timestamp when agent completed (if completed) */
  completedAt?: string;
  /** Total tokens used (if completed) */
  totalTokens?: number;
  /** Duration in milliseconds (if completed) */
  durationMs?: number;
}

/**
 * Skill visualization data
 * Represents a skill invocation event for visual display
 */
export interface SkillVisualization {
  /** Unique skill invocation ID (skill-timestamp-name) */
  id: string;
  /** Skill name */
  name: string;
  /** Project where skill was invoked */
  projectId: string;
  /** Agent that invoked the skill (if applicable) */
  agentId?: string;
  /** ISO timestamp when skill was invoked */
  timestamp: string;
  /** Confidence score (0-1) if from recommendation */
  confidence?: number;
}

/**
 * Connection type between visualization elements
 * - spawn: Connection from project to spawned agent
 * - dependency: Dependency between agents
 * - skill: Connection showing skill invocation
 */
export type ConnectionType = "spawn" | "dependency" | "skill";

/**
 * Visual connection between elements in the 3D scene
 */
export interface ConnectionVisualization {
  /** Unique connection ID */
  id: string;
  /** Source element ID (project or agent) */
  sourceId: string;
  /** Target element ID (agent or skill) */
  targetId: string;
  /** Type of connection */
  type: ConnectionType;
  /** Whether connection is currently active/animated */
  active?: boolean;
}

/**
 * Complete visualization state
 * Root state object managed by useVisualizationState hook
 */
export interface VisualizationState {
  /** Projects indexed by ID for O(1) lookup */
  projects: Map<string, ProjectVisualization>;
  /** Agents indexed by ID for O(1) lookup */
  agents: Map<string, AgentVisualization>;
  /** Recent skill invocations (queue for display, max 20) */
  activeSkills: SkillVisualization[];
  /** Visual connections between elements */
  connections: ConnectionVisualization[];
}

// ============================================================================
// Particle Flow Types
// ============================================================================

/**
 * Props for ParticleFlow component
 */
export interface ParticleFlowProps {
  /** Starting position in 3D space */
  startPosition: [number, number, number];
  /** Ending position in 3D space */
  endPosition: [number, number, number];
  /** Particle color (hex string or CSS color) */
  color: string;
  /** Speed multiplier for particle movement (default: 1) */
  speed?: number;
  /** Particles emitted per second (default: 10) */
  density?: number;
  /** Maximum particles in pool (default: 50) */
  maxParticles?: number;
  /** Whether the flow is currently active (default: true) */
  active?: boolean;
  /** Particle size (default: 0.05) */
  particleSize?: number;
  /** Curve height factor for bezier mid-point (default: 0.3) */
  curveHeight?: number;
}

/**
 * Internal particle state used by ParticleFlow
 */
export interface Particle {
  /** Progress along curve (0-1) */
  progress: number;
  /** Whether particle is visible/active */
  active: boolean;
  /** When particle was spawned */
  spawnTime: number;
}

/**
 * Configuration for particle flow defaults
 */
export interface ParticleFlowConfig {
  /** Default particle color */
  color: string;
  /** Default speed multiplier */
  speed: number;
  /** Default particles per second */
  density: number;
  /** Default maximum particles */
  maxParticles: number;
  /** Default particle size */
  particleSize: number;
  /** Default curve height factor */
  curveHeight: number;
}

/**
 * Data flow type for semantic coloring
 */
export type DataFlowType =
  | "agentToProxy"
  | "proxyToAgent"
  | "skillInvocation"
  | "credentialFlow"
  | "errorFlow";

/**
 * Data flow configuration
 */
export interface DataFlow {
  /** Unique identifier */
  id: string;
  /** Type of data flow for semantic coloring */
  type: DataFlowType;
  /** Source entity identifier */
  startEntityId: string;
  /** Target entity identifier */
  endEntityId: string;
  /** Whether flow is currently active */
  active: boolean;
}

/**
 * Semantic color mappings for particle flows
 */
export const PARTICLE_COLORS: Record<DataFlowType, string> = {
  agentToProxy: "#3b82f6", // Blue - agent requests
  proxyToAgent: "#22c55e", // Green - proxy responses
  skillInvocation: "#f59e0b", // Amber - skill calls
  credentialFlow: "#a855f7", // Purple - auth data
  errorFlow: "#ef4444", // Red - errors
};

// ============================================================================
// Connection Beam Types (re-exported from component for convenience)
// ============================================================================

/**
 * Point in 3D space as tuple
 */
export type Point3D = [number, number, number];

/**
 * Props for ConnectionBeam component
 */
export interface ConnectionBeamProps {
  /** Starting point in 3D space [x, y, z] */
  start: Point3D;
  /** Ending point in 3D space [x, y, z] */
  end: Point3D;
  /** Base color of the beam (hex string, CSS color, or Three.js color name) */
  color: string;
  /** Whether the connection is currently active (shows pulse animation) */
  active?: boolean;
  /** Speed multiplier for the pulse animation (default: 1.0) */
  pulseSpeed?: number;
  /** Width of the core line in pixels (default: 2) */
  lineWidth?: number;
  /** Opacity for inactive connections (default: 0.3) */
  inactiveOpacity?: number;
  /** Intensity of the glow effect (default: 0.5) */
  glowIntensity?: number;
  /** Enable curved beam path (default: false for straight lines) */
  curved?: boolean;
}

/**
 * Connection data for batch rendering with ConnectionBeamGroup
 */
export interface Connection {
  /** Unique identifier for the connection */
  id: string;
  /** Starting point in 3D space */
  start: Point3D;
  /** Ending point in 3D space */
  end: Point3D;
  /** Connection color */
  color: string;
  /** Whether the connection is active */
  active: boolean;
  /** Type of connection for styling/sorting */
  type: "agent-project" | "project-hub" | "agent-agent";
}

/**
 * Props for ConnectionBeamGroup component
 */
export interface ConnectionBeamGroupProps {
  /** Array of connections to render */
  connections: Connection[];
  /** Pulse speed for active connections */
  pulseSpeed?: number;
  /** Line width for all connections */
  lineWidth?: number;
}

/**
 * Semantic colors for connection beams
 */
export const CONNECTION_BEAM_COLORS = {
  agentProject: "#22c55e", // Green - agent to project
  projectHub: "#3b82f6", // Blue - project to MCP hub
  agentAgent: "#f59e0b", // Amber - agent to agent
  active: "#00ffff", // Cyan - highlight for active
  error: "#ef4444", // Red - error state
} as const;

// ============================================================================
// Tool Interaction Types
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
 * Semantic colors for tool interaction visuals
 * Matches Tailwind color palette for consistency with dashboard theme
 */
export const TOOL_INTERACTION_COLORS = {
  skill: "#fbbf24", // Amber-400 - Gold for skills
  mcp_tool: "#38bdf8", // Sky-400 - Deep sky blue for MCP
  read: "#4ade80", // Green-400 - Light green for read
  edit: "#f87171", // Red-400 - Coral red for edit
  bash: "#a78bfa", // Violet-400 - Medium purple for bash
} as const;

// ============================================================================
// Scene Configuration Types (for custom 3D scenes)
// ============================================================================

/**
 * Spawn point for agents within a project area
 */
export interface SpawnPoint {
  /** Slot identifier (e.g., "1", "2", "a", "b") */
  slot: string;
  /** 3D position [x, y, z] */
  position: Position3D;
}

/**
 * Walk boundary configuration for agent wandering
 */
export interface WalkBounds {
  /** Center of walk area [x, y, z] */
  center: Position3D;
  /** Radius of circular walk area */
  radius: number;
}

/**
 * Project platform configuration from scene
 */
export interface SceneProject {
  /** Unique identifier (from node name) */
  id: string;
  /** Display name */
  name: string;
  /** Platform position [x, y, z] */
  position: Position3D;
  /** Connection beam anchor point (above platform) */
  anchorPosition?: Position3D;
  /** Agent spawn points for this project */
  spawnPoints: SpawnPoint[];
  /** Walk boundary for agent wandering */
  walkBounds?: WalkBounds;
}

/**
 * Camera preset configuration
 */
export interface SceneCamera {
  /** Camera preset name (e.g., "overview", "closeup") */
  name: string;
  /** Camera position [x, y, z] */
  position: Position3D;
  /** Look-at target [x, y, z] */
  target?: Position3D;
  /** Field of view in degrees */
  fov?: number;
}

/**
 * Agent model configuration
 */
export interface AgentModelConfig {
  /** Path to GLTF/GLB model file */
  path: string;
  /** Scale factor for the model */
  scale: number;
  /** Height offset from ground (Y axis) */
  heightOffset: number;
  /** Animation names available in the model */
  animations?: string[];
}

/**
 * Environment/atmosphere configuration
 */
export interface SceneEnvironment {
  /** Ground plane color */
  groundColor?: string;
  /** Ambient light intensity (0-1) */
  ambientIntensity?: number;
  /** Fog color */
  fogColor?: string;
  /** Fog near distance */
  fogNear?: number;
  /** Fog far distance */
  fogFar?: number;
  /** Environment map preset (drei Environment) */
  environmentPreset?: "sunset" | "dawn" | "night" | "warehouse" | "forest" | "apartment" | "studio" | "city" | "park" | "lobby";
}

/**
 * Complete scene configuration
 * Generated by scene-configurator agent from GLTF analysis
 */
export interface SceneConfig {
  /** Path to the main scene GLTF/GLB file */
  scenePath?: string;
  /** Project platform configurations */
  projects: SceneProject[];
  /** Camera presets */
  cameras: SceneCamera[];
  /** Agent type to model mappings */
  agentModels: Record<string, AgentModelConfig>;
  /** Environment/atmosphere settings */
  environment?: SceneEnvironment;
  /** Default wander radius if not specified per-project */
  defaultWanderRadius?: number;
  /** Default agent height offset */
  defaultHeightOffset?: number;
}

/**
 * Default scene configuration (programmatic grid layout)
 * Used when no custom scene config is loaded
 */
export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  projects: [],
  cameras: [
    {
      name: "overview",
      position: [0, 8, 12],
      target: [0, 0, 0],
      fov: 50,
    },
  ],
  agentModels: {
    default: {
      path: "",
      scale: 1,
      heightOffset: 0.5,
    },
  },
  environment: {
    groundColor: "#0a0a0a",
    ambientIntensity: 0.4,
    fogColor: "#0a0a1a",
    fogNear: 10,
    fogFar: 50,
    environmentPreset: "night",
  },
  defaultWanderRadius: 1.2,
  defaultHeightOffset: 0.5,
};
