/**
 * AgentVisualization Page
 * 3D visualization dashboard for agent orchestration using medieval village theme
 *
 * Displays real-time agent activity using:
 * - useVisualizationState hook for WebSocket data
 * - Scene3D for 3D canvas with lighting and controls
 * - AgentCharacter for animated 3D agents with directed walking
 * - MedievalResidence for project spawn/return points
 * - MinecraftWorkArea for fenced farm work area
 * - SpecialBuilding for MCP tool interaction buildings
 * - MedievalAtmosphere for lighting, fog, and ambient effects
 *
 * Workflow:
 * 1. Agent spawns at project residence (cottage)
 * 2. Agent walks from residence to claimed position in fenced farm
 * 3. Agent wanders around inside the farm while working
 * 4. When using tools, agent visits corresponding MCP building
 * 5. When complete, agent walks from farm back to residence
 * 6. Agent stands at residence briefly, then is removed
 */

import { useState, Suspense, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Link } from "react-router-dom";

import { Scene3D } from "../components/visualization/Scene3D";
import { AgentCharacter } from "../components/visualization/AgentCharacter";
import { MedievalResidence } from "../components/visualization/MedievalResidence";
import { MinecraftWorkArea, WORK_AREA_POSITION } from "../components/visualization/MinecraftWorkArea";
import { MedievalAtmosphere } from "../components/visualization/MedievalAtmosphere";
import { SpecialBuilding } from "../components/visualization/SpecialBuilding";
import { preloadAllAgentModels } from "../components/visualization/ModelLoader";
import { useVisualizationState } from "../hooks/useVisualizationState";
import { useActiveAgentCount } from "../hooks/useActiveAgentCount";
import { useWorkAreaPositions, type WorkPosition } from "../hooks/useWorkAreaPositions";
import {
  getAllSpecialBuildingTypes,
  getBuildingForMcpTool,
  getSpecialBuildingConfig,
} from "../config/special-buildings-config";
import type { AgentVisualization as AgentViz } from "../types/visualization";
import type { WalkTarget } from "../hooks/useAgentAnimations";

/**
 * Loading fallback for 3D content
 */
function LoadingFallback(): JSX.Element {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4a5568" wireframe />
    </mesh>
  );
}

// =============================================================================
// Medieval Village Configuration
// =============================================================================

const FARM_CENTER: [number, number, number] = [
  WORK_AREA_POSITION[0],
  WORK_AREA_POSITION[1],
  WORK_AREA_POSITION[2],
];

/** Farm bounds in world space (inset from fence to avoid walking into it) */
const FARM_BOUNDS = {
  minX: WORK_AREA_POSITION[0] - 4,
  maxX: WORK_AREA_POSITION[0] + 4,
  minZ: WORK_AREA_POSITION[2] - 3,
  maxZ: WORK_AREA_POSITION[2] + 3,
};

/** Min/max delay between wander walks (ms) */
const WANDER_DELAY_MIN = 2000;
const WANDER_DELAY_MAX = 5000;

/** Residence grid configuration */
const RESIDENCE_GRID = {
  columns: 4,
  rows: 3,
  spacing: 4,
  startZ: 10,
};

/**
 * Calculate residence position in grid layout
 * Residences are arranged in a grid behind the town square
 */
function calculateResidencePosition(index: number): [number, number, number] {
  const col = index % RESIDENCE_GRID.columns;
  const row = Math.floor(index / RESIDENCE_GRID.columns);

  const totalWidth = (RESIDENCE_GRID.columns - 1) * RESIDENCE_GRID.spacing;
  const startX = -totalWidth / 2;

  const x = startX + col * RESIDENCE_GRID.spacing;
  const z = RESIDENCE_GRID.startZ + row * RESIDENCE_GRID.spacing;

  return [x, 0, z];
}

// =============================================================================
// DirectedAgent Component (Medieval Village version with re-render protection)
// =============================================================================

interface DirectedAgentProps {
  agentId: string;
  agentType: string;
  agentStatus: AgentViz["status"];
  currentTool: string | undefined;
  basePositionX: number;
  basePositionY: number;
  basePositionZ: number;
  projectName: string;
  claimPosition: (agentId: string) => WorkPosition | null;
  releasePosition: (agentId: string) => void;
  getAgentPosition: (agentId: string) => WorkPosition | null;
}

/**
 * DirectedAgent component (Medieval version with primitive props)
 * Handles agent walking between residence, farm work area, and MCP buildings.
 * Uses primitive props to prevent re-render loops from object reference changes.
 */
const DirectedAgent = memo(function DirectedAgent({
  agentId,
  agentType,
  agentStatus,
  currentTool,
  basePositionX,
  basePositionY,
  basePositionZ,
  projectName,
  claimPosition,
  releasePosition,
  getAgentPosition,
}: DirectedAgentProps): JSX.Element {
  const [walkTarget, setWalkTarget] = useState<WalkTarget | null>(null);
  const [atPosition, setAtPosition] = useState(false);
  const [returningToFarm, setReturningToFarm] = useState(false);
  const prevStatusRef = useRef(agentStatus);
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWanderingRef = useRef(false);

  // Stable position array for AgentCharacter
  const position = useMemo<[number, number, number]>(
    () => [basePositionX, basePositionY, basePositionZ],
    [basePositionX, basePositionY, basePositionZ]
  );

  // Claim/release position based on agent lifecycle
  useEffect(() => {
    if (agentStatus === "walking_to_work" && prevStatusRef.current !== "walking_to_work") {
      claimPosition(agentId);
    }
    if (agentStatus === "walking_to_base" && prevStatusRef.current !== "walking_to_base") {
      releasePosition(agentId);
      setAtPosition(false);
    }
    prevStatusRef.current = agentStatus;
  }, [agentStatus, agentId, claimPosition, releasePosition]);

  // Cleanup position on unmount
  useEffect(() => {
    return () => {
      releasePosition(agentId);
    };
  }, [agentId, releasePosition]);

  // Set walk target based on agent status
  useEffect(() => {
    // Walk to claimed position in farm
    if (agentStatus === "walking_to_work") {
      setAtPosition(false);
      setReturningToFarm(false);
      const existingPos = getAgentPosition(agentId);
      const pos = existingPos ?? claimPosition(agentId);
      if (pos) {
        setWalkTarget({
          x: pos.position[0],
          y: 0.5,
          z: pos.position[2],
        });
      } else {
        // No position available, walk to farm center as fallback
        setWalkTarget({
          x: FARM_CENTER[0],
          y: FARM_CENTER[1],
          z: FARM_CENTER[2],
        });
      }
      return;
    }

    // Walk back to residence
    if (agentStatus === "walking_to_base") {
      setAtPosition(false);
      setReturningToFarm(false);
      setWalkTarget({
        x: basePositionX,
        y: 0.5,
        z: basePositionZ,
      });
      return;
    }

    // Handle visiting_stall status (MCP building visits)
    if (agentStatus === "visiting_stall" && currentTool) {
      const buildingType = getBuildingForMcpTool(currentTool);
      if (buildingType) {
        const buildingConfig = getSpecialBuildingConfig(buildingType);
        setAtPosition(false);
        setReturningToFarm(false);
        setWalkTarget({
          x: buildingConfig.position[0],
          y: 0.5,
          z: buildingConfig.position[2],
        });
      }
      return;
    }

    // Handle returning_to_work status (returning from MCP building to farm)
    if (agentStatus === "returning_to_work") {
      const pos = getAgentPosition(agentId);
      if (pos) {
        setReturningToFarm(true);
        setWalkTarget({
          x: pos.position[0],
          y: 0.5,
          z: pos.position[2],
        });
      } else {
        setReturningToFarm(false);
        setWalkTarget({
          x: FARM_CENTER[0],
          y: FARM_CENTER[1],
          z: FARM_CENTER[2],
        });
      }
      return;
    }

    // Working in farm - only set initial walk target, don't override wander walks
    if (agentStatus === "working") {
      if (!atPosition && !isWanderingRef.current) {
        const pos = getAgentPosition(agentId);
        if (pos) {
          setWalkTarget({
            x: pos.position[0],
            y: 0.5,
            z: pos.position[2],
          });
        }
      }
      return;
    }

    // Removing: agent stands at residence (idle) - don't clear walk target
    // so the agent stays visible at its current location
    if (agentStatus === "removing") {
      setWalkTarget(null);
      return;
    }

    // For other statuses (spawning, idle, completed), no walking
    setWalkTarget(null);
    setAtPosition(false);
  }, [agentStatus, currentTool, agentId, basePositionX, basePositionZ, atPosition, getAgentPosition, claimPosition]);

  // Schedule next wander walk within the farm
  const scheduleWander = useCallback(() => {
    if (wanderTimerRef.current !== null) {
      clearTimeout(wanderTimerRef.current);
    }
    isWanderingRef.current = true;
    const delay = WANDER_DELAY_MIN + Math.random() * (WANDER_DELAY_MAX - WANDER_DELAY_MIN);
    wanderTimerRef.current = setTimeout(() => {
      wanderTimerRef.current = null;
      // Pick a random position within the farm bounds
      const x = FARM_BOUNDS.minX + Math.random() * (FARM_BOUNDS.maxX - FARM_BOUNDS.minX);
      const z = FARM_BOUNDS.minZ + Math.random() * (FARM_BOUNDS.maxZ - FARM_BOUNDS.minZ);
      setAtPosition(false);
      setWalkTarget({ x, y: 0.5, z });
    }, delay);
  }, []);

  // Clear wander timer on unmount or when leaving working state
  useEffect(() => {
    return () => {
      if (wanderTimerRef.current !== null) {
        clearTimeout(wanderTimerRef.current);
        wanderTimerRef.current = null;
      }
    };
  }, []);

  // Handle walk completion
  const handleWalkComplete = useCallback(() => {
    if (agentStatus === "working" || agentStatus === "walking_to_work" || returningToFarm) {
      setAtPosition(true);
      setReturningToFarm(false);
      setWalkTarget(null);
      // When working (or just arrived at farm), schedule wandering
      if (agentStatus === "working" || agentStatus === "walking_to_work") {
        scheduleWander();
      }
    }
  }, [agentStatus, returningToFarm, scheduleWander]);

  // Cancel wandering when agent stops working
  useEffect(() => {
    if (agentStatus !== "working" && agentStatus !== "walking_to_work") {
      if (wanderTimerRef.current !== null) {
        clearTimeout(wanderTimerRef.current);
        wanderTimerRef.current = null;
      }
      isWanderingRef.current = false;
    }
  }, [agentStatus]);

  // Map workflow statuses to AgentCharacter statuses
  const getCharacterStatus = (): "idle" | "walking" | "working" | "completed" => {
    switch (agentStatus) {
      case "spawning":
        return "idle";
      case "walking_to_work":
      case "walking_to_base":
      case "visiting_stall":
      case "returning_to_work":
        return "walking";
      case "working":
        return atPosition ? "idle" : "walking";
      case "removing":
        return "idle"; // Stand at residence briefly before deletion
      default:
        return "idle";
    }
  };

  return (
    <AgentCharacter
      agentId={agentId}
      agentType={agentType}
      projectName={projectName}
      position={position}
      status={getCharacterStatus()}
      walkTarget={walkTarget}
      onWalkComplete={handleWalkComplete}
      alwaysShowLabel={true}
      useModel={true}
    />
  );
});

// =============================================================================
// Main Component
// =============================================================================

/**
 * AgentVisualization page component
 *
 * Displays a 3D visualization of agent orchestration using the medieval village workflow.
 * The page is structured with a header navigation and a full-height 3D canvas.
 */
export function AgentVisualization(): JSX.Element {
  const [isSceneReady, setIsSceneReady] = useState(false);
  const { state, isLoading, connectionStatus } = useVisualizationState();
  const { totalSessions, totalAgents, projects: apiProjects } = useActiveAgentCount();
  const { claimPosition, releasePosition, getAgentPosition } = useWorkAreaPositions();

  // Preload models on mount
  useEffect(() => {
    preloadAllAgentModels();
  }, []);

  function handleSceneCreated(): void {
    setIsSceneReady(true);
  }

  // Use ALL projects from API for residences
  const allProjects = apiProjects;

  // Get agents from visualization state - all agents are visible (including "removing")
  // Agents in "removing" status stand at their residence briefly before being deleted from state
  const visibleAgents = Array.from(state.agents.values());

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <main className="flex-1 min-h-0 relative">
        <Scene3D
          className="flex-1 min-h-0 h-full"
          onCreated={handleSceneCreated}
          enhancedLighting
          showGround
          enableControls
          enableEffects
          showEnvironment
        >
          <Suspense fallback={<LoadingFallback />}>
            {/* Medieval Atmosphere - lighting, fog, torches */}
            <MedievalAtmosphere />

            {/* Fenced farm work area */}
            <MinecraftWorkArea
              activeWorkerCount={totalAgents}
            />

            {/* MCP Buildings - Skills Guild Hall and individual MCP service buildings */}
            {getAllSpecialBuildingTypes().map((buildingType) => (
              <SpecialBuilding
                key={buildingType}
                buildingType={buildingType}
              />
            ))}

            {/* Medieval Residences in grid layout - ALL projects from API */}
            {allProjects.map((project, index) => (
              <MedievalResidence
                key={project.name}
                projectId={project.name}
                projectName={project.name}
                position={calculateResidencePosition(index)}
                hasActiveAgents={project.activeAgents > 0 || project.activeSessions > 0}
              />
            ))}

            {/* Directed Agents - walking between residence, farm, and MCP buildings */}
            {visibleAgents.map((agent) => {
              const projectIndex = allProjects.findIndex((p) => p.name === agent.projectId);
              const project = projectIndex >= 0 ? allProjects[projectIndex] : undefined;

              const residencePosition = projectIndex >= 0
                ? calculateResidencePosition(projectIndex)
                : agent.basePosition;

              // Set initial position at residence if agent is still spawning/walking from base
              const agentPositionY =
                agent.status === "spawning" || agent.status === "walking_to_work"
                  ? 0.5
                  : agent.position[1];

              return (
                <DirectedAgent
                  key={agent.id}
                  agentId={agent.id}
                  agentType={agent.type}
                  agentStatus={agent.status}
                  currentTool={agent.currentTool}
                  basePositionX={residencePosition[0]}
                  basePositionY={agentPositionY}
                  basePositionZ={residencePosition[2]}
                  projectName={project?.name ?? "Unknown"}
                  claimPosition={claimPosition}
                  releasePosition={releasePosition}
                  getAgentPosition={getAgentPosition}
                />
              );
            })}
          </Suspense>
        </Scene3D>

        {/* Status overlay */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          {isSceneReady && (
            <div className="bg-gray-800/80 text-green-400 px-3 py-1 rounded text-sm">
              Scene Ready
            </div>
          )}
          {isLoading && (
            <div className="bg-gray-800/80 text-yellow-400 px-3 py-1 rounded text-sm">
              Loading data...
            </div>
          )}
          <div
            className={`bg-gray-800/80 px-3 py-1 rounded text-sm ${
              connectionStatus === "connected"
                ? "text-green-400"
                : connectionStatus === "reconnecting"
                  ? "text-yellow-400"
                  : "text-red-400"
            }`}
          >
            WebSocket: {connectionStatus}
          </div>
        </div>

        {/* Home button */}
        <Link
          to="/"
          className="absolute top-4 left-4 bg-gray-800/80 hover:bg-gray-700/80 text-white px-4 py-2 rounded text-sm transition-colors"
        >
          ← Dashboard
        </Link>

        {/* Stats overlay - medieval themed */}
        <div className="absolute top-4 right-4 bg-gray-800/80 text-white px-4 py-2 rounded text-sm">
          <div>Villages: {allProjects.length}</div>
          <div>Active Sessions: {totalSessions}</div>
          <div>Active Agents: {totalAgents}</div>
        </div>
      </main>
    </div>
  );
}
