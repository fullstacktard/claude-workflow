/**
 * useVisualizationState Hook
 *
 * Manages 3D visualization state by consuming WebSocket events from useLogStream
 * and transforming them into 3D-friendly data structures for visualization components.
 *
 * Features:
 * - Consumes WebSocket events via useLogStream hook
 * - Tracks agent spawn/despawn from agent_invocation/agent_completion events
 * - Captures skill invocations for visual display (max 20 in queue)
 * - Throttles state updates to max 30fps (~33ms) for performance
 * - Calculates project positions using radial layout algorithm
 * - Properly cleans up on unmount (cancels RAF, clears refs)
 *
 * @example
 * ```tsx
 * function VisualizationScene() {
 *   const { state, isLoading, connectionStatus, clearState } = useVisualizationState();
 *
 *   if (isLoading) return <LoadingSpinner />;
 *
 *   return (
 *     <Canvas>
 *       {Array.from(state.projects.values()).map((project) => (
 *         <ProjectNode key={project.id} project={project} />
 *       ))}
 *       {Array.from(state.agents.values()).map((agent) => (
 *         <AgentNode key={agent.id} agent={agent} />
 *       ))}
 *     </Canvas>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectionStatus, StreamLogEntry } from "./useLogStream";
import { useLogStream } from "./useLogStream";
import type {
  AgentVisualization,
  Position3D,
  SkillVisualization,
  VisualizationState,
} from "../types/visualization";
import {
  getStallForTool,
  getStallPosition,
  STALL_ANIMATION_CONFIG,
} from "../config/tool-stall-config";
import type { StallType } from "../config/tool-stall-config";

// Use StallType to avoid unused import warning
const _stallTypeCheck: StallType | undefined = undefined;
void _stallTypeCheck;

// ============================================================================
// Constants
// ============================================================================

// Throttling removed to fix React error #185 - see comment in hook

/** Maximum skill events to display in queue */
const MAX_SKILL_QUEUE = 20;

/** Radius for project base layout (semi-circle around gym) */
const BASE_LAYOUT_RADIUS = 6;

/** Vertical elevation for agents above ground plane */
const AGENT_ELEVATION = 0.5;

/** Maximum processed entries to track for deduplication */
const MAX_PROCESSED_ENTRIES = 2000;

/** Entries to retain when trimming processed set */
const RETAINED_ENTRIES = 1000;

/** Duration for spawn animation at project base (ms) */
const SPAWN_DURATION_MS = 500;

/** Duration for walking from base to work area (ms)
 * At WALK_SPEED=2 units/sec and BASE_LAYOUT_RADIUS=6 units, walks take ~3 seconds
 * Add 500ms buffer for animation smoothness
 */
const WALK_TO_WORK_DURATION_MS = 3500;

/** Duration for walking from work area back to base (ms)
 * Same calculation as above
 */
const WALK_TO_BASE_DURATION_MS = 3500;

/** Duration for removal animation at base (ms) */
const REMOVAL_ANIMATION_DURATION_MS = 500;

/** Timeout for orphan agent cleanup - agents with no completion after this time (ms) */
const ORPHAN_CLEANUP_TIMEOUT_MS = 300000; // 5 minutes

/** Interval for checking orphan agents (ms) */
const ORPHAN_CLEANUP_INTERVAL_MS = 60000; // 1 minute

/** Work area position - cotton field center (exported for use by visualization components) */
export const WORK_POSITION: Position3D = [0, 0.5, -22];

// Tool stall animation timing (from config)
const WALK_TO_STALL_DURATION_MS = STALL_ANIMATION_CONFIG.walkToStallDurationMs;
const PAUSE_AT_STALL_DURATION_MS = STALL_ANIMATION_CONFIG.pauseAtStallDurationMs;
const RETURN_TO_WORK_DURATION_MS = STALL_ANIMATION_CONFIG.walkToWellDurationMs;

// ============================================================================
// Types
// ============================================================================

/**
 * Result of the useVisualizationState hook
 */
export interface UseVisualizationStateResult {
  /** Current visualization state containing projects, agents, skills, connections */
  state: VisualizationState;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** WebSocket connection status from underlying useLogStream */
  connectionStatus: ConnectionStatus;
  /** Clear all visualization state and reset to empty */
  clearState: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate base position in semi-circle around gym
 * Bases are arranged in a semi-circle behind the gym (positive Z)
 *
 * @param index - Index of the project (0-based)
 * @param total - Total number of projects
 * @param radius - Circle radius in world units
 * @returns Position3D tuple [x, y, z]
 */
function calculateBasePosition(
  index: number,
  total: number,
  radius: number = BASE_LAYOUT_RADIUS
): Position3D {
  if (total === 0) return [0, 0, radius];
  if (total === 1) return [0, 0, radius];

  // Semi-circle from left to right (PI to 2*PI for back half)
  const angle = Math.PI + (index / Math.max(total - 1, 1)) * Math.PI;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return [x, 0, z];
}

/**
 * Calculate agent spawn position at project base
 *
 * @param basePosition - Project base position
 * @returns Position3D tuple [x, y, z]
 */
function calculateAgentSpawnPosition(basePosition: Position3D): Position3D {
  return [basePosition[0], AGENT_ELEVATION, basePosition[2]];
}

/**
 * Generate unique deduplication key for a log entry
 *
 * @param entry - Stream log entry
 * @returns Unique string key for deduplication
 */
function generateEntryKey(entry: StreamLogEntry): string {
  const parts = [entry.timestamp, entry.type];
  if (entry.agent !== undefined) parts.push(entry.agent);
  if (entry.skill !== undefined) parts.push(entry.skill);
  if (entry.projectName !== undefined) parts.push(entry.projectName);
  if (entry.agentId !== undefined) parts.push(entry.agentId);
  return parts.join("|");
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing 3D visualization state from WebSocket events
 *
 * Connects to the existing WebSocket infrastructure via useLogStream and
 * transforms incoming events into 3D-friendly data structures suitable for
 * Three.js/React Three Fiber visualization components.
 */
export function useVisualizationState(): UseVisualizationStateResult {
  // Get entries, connection status, and active agents from existing WebSocket hook
  const { entries, connectionStatus, activeAgents } = useLogStream();

  // Visualization state
  const [state, setState] = useState<VisualizationState>({
    projects: new Map(),
    agents: new Map(),
    activeSkills: [],
    connections: [],
  });

  const [isLoading, setIsLoading] = useState(true);

  // RAF ref for cleanup (throttling removed, but RAF still used in cleanup effect)
  const rafIdRef = useRef<number | null>(null);

  // Track processed entries to avoid duplicates
  const processedEntriesRef = useRef<Set<string>>(new Set());

  // Track last processed entries length to detect new entries
  const lastEntriesLengthRef = useRef<number>(0);

  // Skip initial/historical entries - only visualize real-time events
  // This prevents stale agents from appearing when page loads
  const initialEntriesSkippedRef = useRef<boolean>(false);

  // Track spawn animation timeouts (agentId -> timeout ID)
  const spawnTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track completion visibility delay timeouts (agentId -> timeout ID)
  const completionTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track removal animation timeouts (agentId -> timeout ID)
  const removalTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track stall visit timeouts (agentId -> timeout ID) for tool stall animation
  const stallVisitTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track last stall visit time per agent (agentId -> timestamp) for debouncing
  const lastStallVisitRef = useRef<Map<string, number>>(new Map());

  // Track if we've seeded visualization with active agents from WebSocket
  const seededWithActiveAgentsRef = useRef<boolean>(false);

  // Track the timestamp when the page loaded - only visualize agents spawned AFTER this time
  // This prevents ALL historical agents from appearing, regardless of source (API or WebSocket)
  const pageLoadTimestampRef = useRef<number>(Date.now());

  // Note: Throttling was removed in favor of direct setState to fix React error #185 (infinite loop).
  // The previous scheduleUpdate function caused the bug because it required `state` in the
  // useEffect dependency array. If performance issues arise, consider adding throttling
  // back using a different approach (e.g., useDeferredValue or debouncing at the source).

  /**
   * Seed visualization with active agents from WebSocket on initial connect
   *
   * DISABLED: The activeAgents data from ActiveAgentTrackerService can contain
   * stale agents that never received completion events. Since historical log
   * entries are already skipped (initialEntriesSkippedRef), seeding just introduces
   * phantom agents that don't match the real process detection count.
   *
   * The visualization now only shows agents that spawn during the current session,
   * which ensures consistency with the "Active Agents" count from /api/projects.
   *
   * If you need to re-enable seeding, the data should be validated against
   * the actual process detection API before seeding.
   */
  useEffect(() => {
    // Seeding disabled - only real-time events are visualized
    // Mark as seeded when we receive active agents
    if (activeAgents.length > 0 && !seededWithActiveAgentsRef.current) {
      seededWithActiveAgentsRef.current = true;
    }
  }, [activeAgents]);

  /**
   * Process log entries and update visualization state
   *
   * IMPORTANT: Only processes real-time events (after page load).
   * Historical entries are skipped to avoid phantom/stale agents.
   * The authoritative source for active agents is /api/projects.
   *
   * NOTE: We use functional setState to avoid having `state` in dependencies,
   * which would cause an infinite loop (React error #185).
   */
  useEffect(() => {
    for (const entry of entries.slice(lastEntriesLengthRef.current)) {
      console.log("Processing entry", entry.type);
    }

    // No entries yet
    if (entries.length === 0) {
      setIsLoading(false);
      return;
    }

    // Skip initial batch of historical entries on first load
    // This prevents phantom agents from old log entries
    if (!initialEntriesSkippedRef.current) {
      initialEntriesSkippedRef.current = true;
      lastEntriesLengthRef.current = entries.length;
      setIsLoading(false);
      return;
    }

    // Skip if no new entries since last process
    if (entries.length === lastEntriesLengthRef.current) {
      return;
    }

    // Only process new entries (since last length)
    const newEntriesToProcess = entries.slice(lastEntriesLengthRef.current);
    lastEntriesLengthRef.current = entries.length;

    // Use functional setState to read current state without adding it to dependencies
    setState((currentState) => {
      // Build new state from current state
      const newProjects = new Map(currentState.projects);
      const newAgents = new Map(currentState.agents);
      const newSkills = [...currentState.activeSkills];
      const newConnections = [...currentState.connections];

    let hasChanges = false;

    for (const entry of newEntriesToProcess) {
      const entryKey = generateEntryKey(entry);

      // Skip already processed entries
      if (processedEntriesRef.current.has(entryKey)) continue;
      processedEntriesRef.current.add(entryKey);

      // Limit processed entries set size to avoid memory bloat
      if (processedEntriesRef.current.size > MAX_PROCESSED_ENTRIES) {
        const keys = Array.from(processedEntriesRef.current);
        processedEntriesRef.current = new Set(keys.slice(-RETAINED_ENTRIES));
      }

      hasChanges = true;

      // Ensure project exists for this entry
      if (!newProjects.has(entry.projectName)) {
        const projectIndex = newProjects.size;
        const position = calculateBasePosition(projectIndex, newProjects.size + 1);

        newProjects.set(entry.projectName, {
          id: entry.projectName,
          name: entry.projectName,
          position,
          agentIds: [],
          activeAgentCount: 0,
        });

        // Recalculate all project (base) positions when new project added
        let idx = 0;
        for (const project of newProjects.values()) {
          project.position = calculateBasePosition(idx, newProjects.size);
          idx++;
        }
      }

      // Handle agent invocation (spawn at project base, walk to gym)
      if (entry.type === "agent_invocation" && entry.agent !== undefined) {
        // CRITICAL: Only visualize agents that spawned AFTER page load
        // This prevents historical agents from WebSocket replay on subscribe
        const entryTimestamp = new Date(entry.timestamp).getTime();
        const pageLoadTime = pageLoadTimestampRef.current;
        console.log("[VIZ] agent_invocation check:", entry.agent, "entry:", entryTimestamp, "pageLoad:", pageLoadTime, "diff:", entryTimestamp - pageLoadTime, "skip?", entryTimestamp < pageLoadTime);
        if (entryTimestamp < pageLoadTimestampRef.current) {
          // Skip historical agent - spawned before we connected
          continue;
        }

        const agentId = `${entry.projectName}-${entry.agent}-${entry.timestamp}`;
        const project = newProjects.get(entry.projectName);

        if (project !== undefined && !newAgents.has(agentId)) {
          // Agent spawns at project base position
          const basePosition = project.position;
          const spawnPosition = calculateAgentSpawnPosition(basePosition);

          // Start agent in "spawning" status at base
          const newAgent: AgentVisualization = {
            id: agentId,
            type: entry.agent,
            projectId: entry.projectName,
            position: spawnPosition,
            basePosition: basePosition,
            status: "spawning",
            spawnedAt: entry.timestamp,
          };

          newAgents.set(agentId, newAgent);
          project.agentIds.push(agentId);
          project.activeAgentCount++;
          console.log("[VIZ] Agent ADDED to state:", agentId, newAgent.type, "position:", newAgent.position, "total agents:", newAgents.size);

          // Schedule transition: spawning -> walking_to_work -> working
          const spawnTimeout = setTimeout(() => {
            setState((currentState) => {
              const agent = currentState.agents.get(agentId);
              if (agent !== undefined && agent.status === "spawning") {
                const updatedAgents = new Map(currentState.agents);
                updatedAgents.set(agentId, { ...agent, status: "walking_to_work" });
                return { ...currentState, agents: updatedAgents };
              }
              return currentState;
            });
            spawnTimeoutsRef.current.delete(agentId);

            // Schedule transition to working after walking completes
            // Note: Position is NOT updated here - the animation system handles visual position
            // The agent.position stays at basePosition for logical reference
            const walkTimeout = setTimeout(() => {
              setState((currentState) => {
                const agent = currentState.agents.get(agentId);
                if (agent !== undefined && agent.status === "walking_to_work") {
                  const updatedAgents = new Map(currentState.agents);
                  updatedAgents.set(agentId, {
                    ...agent,
                    status: "working",
                    // Don't update position - let animation system handle visual location
                  });
                  return { ...currentState, agents: updatedAgents };
                }
                return currentState;
              });
              completionTimeoutsRef.current.delete(agentId);
            }, WALK_TO_WORK_DURATION_MS);

            completionTimeoutsRef.current.set(agentId, walkTimeout);
          }, SPAWN_DURATION_MS);

          spawnTimeoutsRef.current.set(agentId, spawnTimeout);
        }
      }

      // Handle agent completion (walk back to base, then remove)
      if (entry.type === "agent_completion" && entry.agentType !== undefined) {
        // Find matching agent by type and project
        // Include agents visiting stalls or walking to well - they can still complete
        for (const agent of newAgents.values()) {
          if (
            agent.type === entry.agentType &&
            agent.projectId === entry.projectName &&
            (agent.status === "working" ||
              agent.status === "walking_to_work" ||
              agent.status === "spawning" ||
              agent.status === "visiting_stall" ||
              agent.status === "returning_to_work")
          ) {
            const matchedAgentId = agent.id;

            // Clear any pending timeouts for this agent
            const spawnTimeout = spawnTimeoutsRef.current.get(matchedAgentId);
            if (spawnTimeout !== undefined) {
              clearTimeout(spawnTimeout);
              spawnTimeoutsRef.current.delete(matchedAgentId);
            }
            const walkTimeout = completionTimeoutsRef.current.get(matchedAgentId);
            if (walkTimeout !== undefined) {
              clearTimeout(walkTimeout);
              completionTimeoutsRef.current.delete(matchedAgentId);
            }

            // Clear any pending stall visit timeouts
            const stallTimeout = stallVisitTimeoutsRef.current.get(matchedAgentId);
            if (stallTimeout !== undefined) {
              clearTimeout(stallTimeout);
              stallVisitTimeoutsRef.current.delete(matchedAgentId);
            }

            // Clear stall-related properties if agent was visiting stall
            if (agent.status === "visiting_stall" || agent.status === "returning_to_work") {
              agent.currentTool = undefined;
              agent.targetStall = undefined;
              agent.stallPosition = undefined;
            }

            // Update agent to start walking back to base
            agent.status = "walking_to_base";
            agent.completedAt = entry.timestamp;
            agent.totalTokens = entry.totalTokens;
            agent.durationMs = entry.totalDurationMs;

            // Decrement active agent count
            const project = newProjects.get(entry.projectName);
            if (project !== undefined) {
              project.activeAgentCount = Math.max(0, project.activeAgentCount - 1);
            }

            // Schedule transition: walking_to_base -> removing -> deleted
            // Note: Position is NOT updated here - animation system handles visual position
            const walkBackTimeout = setTimeout(() => {
              setState((currentState) => {
                const agentWalking = currentState.agents.get(matchedAgentId);
                if (agentWalking !== undefined && agentWalking.status === "walking_to_base") {
                  const updatedAgents = new Map(currentState.agents);
                  updatedAgents.set(matchedAgentId, {
                    ...agentWalking,
                    status: "removing",
                    // Don't update position - let animation system handle visual location
                  });
                  return { ...currentState, agents: updatedAgents };
                }
                return currentState;
              });
              completionTimeoutsRef.current.delete(matchedAgentId);

              // Schedule final removal after exit animation
              const removalTimeout = setTimeout(() => {
                setState((currentState) => {
                  const agentToDelete = currentState.agents.get(matchedAgentId);
                  if (agentToDelete !== undefined && agentToDelete.status === "removing") {
                    const updatedAgents = new Map(currentState.agents);
                    updatedAgents.delete(matchedAgentId);

                    // Also remove from project's agentIds
                    const updatedProjects = new Map(currentState.projects);
                    const proj = updatedProjects.get(agentToDelete.projectId);
                    if (proj !== undefined) {
                      proj.agentIds = proj.agentIds.filter((id) => id !== matchedAgentId);
                    }

                    // Remove associated connections (not used in gym workflow)
                    const updatedConnections = currentState.connections.filter(
                      (c) => c.targetId !== matchedAgentId && c.sourceId !== matchedAgentId
                    );

                    return {
                      ...currentState,
                      agents: updatedAgents,
                      projects: updatedProjects,
                      connections: updatedConnections,
                    };
                  }
                  return currentState;
                });
                removalTimeoutsRef.current.delete(matchedAgentId);
              }, REMOVAL_ANIMATION_DURATION_MS);

              removalTimeoutsRef.current.set(matchedAgentId, removalTimeout);
            }, WALK_TO_BASE_DURATION_MS);

            completionTimeoutsRef.current.set(matchedAgentId, walkBackTimeout);

            break; // Only update first matching agent
          }
        }
      }

      // Handle skill invocation
      if (entry.type === "skill_invocation" && entry.skill !== undefined) {
        const skillViz: SkillVisualization = {
          id: `skill-${entry.timestamp}-${entry.skill}`,
          name: entry.skill,
          projectId: entry.projectName,
          agentId: entry.agentContext,
          timestamp: entry.timestamp,
          confidence: entry.confidence,
        };

        newSkills.push(skillViz);

        // Keep only recent skills (FIFO queue)
        while (newSkills.length > MAX_SKILL_QUEUE) {
          newSkills.shift();
        }
      }

      // Handle MCP tool call - trigger stall visit animation
      if (entry.type === "mcp_tool_call" && entry.mcpTool !== undefined) {
        const toolName = entry.mcpTool;
        const stallType = getStallForTool(toolName);

        if (stallType !== undefined) {
          // Find the agent that made this tool call (by project and status)
          for (const agent of newAgents.values()) {
            // Only working agents at well can visit stalls
            // Also allow agents currently visiting stalls (queue next visit)
            if (
              agent.projectId === entry.projectName &&
              (agent.status === "working" || agent.status === "returning_to_work")
            ) {
              const now = Date.now();
              const lastVisit = lastStallVisitRef.current.get(agent.id) ?? 0;

              // Debounce rapid tool calls - don't interrupt current animation
              if (now - lastVisit < STALL_ANIMATION_CONFIG.minTimeBetweenVisitsMs) {
                break;
              }

              // Clear any existing stall visit timeout (in case of rapid calls)
              const existingTimeout = stallVisitTimeoutsRef.current.get(agent.id);
              if (existingTimeout !== undefined) {
                clearTimeout(existingTimeout);
              }

              const stallPosition = getStallPosition(stallType);
              lastStallVisitRef.current.set(agent.id, now);

              // Start walk to stall
              agent.status = "visiting_stall";
              agent.currentTool = toolName;
              agent.targetStall = stallType;
              agent.stallPosition = stallPosition;

              // Schedule arrival at stall (after walk)
              // Note: Position is NOT updated - animation system handles visual position
              const arrivalTimeout = setTimeout(() => {
                // Just continue to next phase - don't update position
                // The animation hook moves the mesh visually

                // Schedule return to well after pause at stall
                const returnTimeout = setTimeout(() => {
                  setState((currentState) => {
                    const agentReturning = currentState.agents.get(agent.id);
                    if (agentReturning?.status === "visiting_stall") {
                      const updatedAgents = new Map(currentState.agents);
                      updatedAgents.set(agent.id, {
                        ...agentReturning,
                        status: "returning_to_work",
                      });
                      return { ...currentState, agents: updatedAgents };
                    }
                    return currentState;
                  });

                  // Schedule arrival at well
                  // Note: Position is NOT updated - animation system handles visual position
                  const wellArrivalTimeout = setTimeout(() => {
                    setState((currentState) => {
                      const agentAtWell = currentState.agents.get(agent.id);
                      if (agentAtWell?.status === "returning_to_work") {
                        const updatedAgents = new Map(currentState.agents);
                        updatedAgents.set(agent.id, {
                          ...agentAtWell,
                          status: "working",
                          // Don't update position - let animation system handle visual location
                          currentTool: undefined,
                          targetStall: undefined,
                          stallPosition: undefined,
                        });
                        return { ...currentState, agents: updatedAgents };
                      }
                      return currentState;
                    });
                    stallVisitTimeoutsRef.current.delete(agent.id);
                  }, RETURN_TO_WORK_DURATION_MS);

                  stallVisitTimeoutsRef.current.set(agent.id, wellArrivalTimeout);
                }, PAUSE_AT_STALL_DURATION_MS);

                stallVisitTimeoutsRef.current.set(agent.id, returnTimeout);
              }, WALK_TO_STALL_DURATION_MS);

              stallVisitTimeoutsRef.current.set(agent.id, arrivalTimeout);

              break; // Only update first matching working agent
            }
          }
        }
      }
      }

      // Only return new state if there were changes
      if (hasChanges) {
        return {
          projects: newProjects,
          agents: newAgents,
          activeSkills: newSkills,
          connections: newConnections,
        };
      }

      // No changes - return current state unchanged
      return currentState;
    });

    setIsLoading(false);
  }, [entries]); // Removed state and scheduleUpdate to prevent infinite loop

  /**
   * Orphan agent cleanup
   * Periodically checks for agents that have been spawning/working for too long
   * without receiving a completion event. These are cleaned up to prevent memory leaks.
   */
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();

      setState((currentState) => {
        let hasStaleAgents = false;

        // Check for stale agents
        for (const agent of currentState.agents.values()) {
          // Only check agents that haven't completed or started removing
          if (agent.status === "completed" || agent.status === "removing") {
            continue;
          }

          // Check if agent has exceeded the orphan timeout
          const spawnTime = agent.spawnedAt !== undefined
            ? new Date(agent.spawnedAt).getTime()
            : now;
          const age = now - spawnTime;

          if (age > ORPHAN_CLEANUP_TIMEOUT_MS) {
            hasStaleAgents = true;
            break;
          }
        }

        if (!hasStaleAgents) {
          return currentState;
        }

        // Remove stale agents
        const updatedAgents = new Map(currentState.agents);
        const updatedProjects = new Map(currentState.projects);
        const agentsToRemove: string[] = [];

        for (const [agentId, agent] of updatedAgents) {
          if (agent.status === "completed" || agent.status === "removing") {
            continue;
          }

          const spawnTime = agent.spawnedAt !== undefined
            ? new Date(agent.spawnedAt).getTime()
            : now;
          const age = now - spawnTime;

          if (age > ORPHAN_CLEANUP_TIMEOUT_MS) {
            agentsToRemove.push(agentId);

            // Clear any pending timeouts for this agent
            const spawnTimeout = spawnTimeoutsRef.current.get(agentId);
            if (spawnTimeout !== undefined) {
              clearTimeout(spawnTimeout);
              spawnTimeoutsRef.current.delete(agentId);
            }
            const completionTimeout = completionTimeoutsRef.current.get(agentId);
            if (completionTimeout !== undefined) {
              clearTimeout(completionTimeout);
              completionTimeoutsRef.current.delete(agentId);
            }
            const removalTimeout = removalTimeoutsRef.current.get(agentId);
            if (removalTimeout !== undefined) {
              clearTimeout(removalTimeout);
              removalTimeoutsRef.current.delete(agentId);
            }
            // Clear stall visit timeouts
            const stallTimeout = stallVisitTimeoutsRef.current.get(agentId);
            if (stallTimeout !== undefined) {
              clearTimeout(stallTimeout);
              stallVisitTimeoutsRef.current.delete(agentId);
            }

            // Update project's agent count and agentIds
            const project = updatedProjects.get(agent.projectId);
            if (project !== undefined) {
              project.agentIds = project.agentIds.filter((id) => id !== agentId);
              // Include stall-visiting statuses in active count
              if (
                agent.status === "working" ||
                agent.status === "spawning" ||
                agent.status === "visiting_stall" ||
                agent.status === "returning_to_work"
              ) {
                project.activeAgentCount = Math.max(0, project.activeAgentCount - 1);
              }
            }
          }
        }

        // Remove agents from map
        for (const agentId of agentsToRemove) {
          updatedAgents.delete(agentId);
        }

        // Remove associated connections
        const updatedConnections = currentState.connections.filter(
          (c) => !agentsToRemove.includes(c.targetId) && !agentsToRemove.includes(c.sourceId)
        );

        return {
          ...currentState,
          agents: updatedAgents,
          projects: updatedProjects,
          connections: updatedConnections,
        };
      });
    }, ORPHAN_CLEANUP_INTERVAL_MS);

    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  /**
   * Cleanup on unmount
   * - Cancel pending requestAnimationFrame
   * - Clear all pending timeouts (spawn, completion, removal, stall visits)
   * - Clear processed entries set
   */
  useEffect(() => {
    // Capture refs at effect start per ESLint react-hooks/exhaustive-deps rule
    const rafId = rafIdRef;
    const spawnTimeouts = spawnTimeoutsRef;
    const completionTimeouts = completionTimeoutsRef;
    const removalTimeouts = removalTimeoutsRef;
    const stallVisitTimeouts = stallVisitTimeoutsRef;
    const processedEntries = processedEntriesRef;

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }

      // Clear all spawn timeouts
      for (const timeout of spawnTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      spawnTimeouts.current.clear();

      // Clear all completion timeouts
      for (const timeout of completionTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      completionTimeouts.current.clear();

      // Clear all removal timeouts
      for (const timeout of removalTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      removalTimeouts.current.clear();

      // Clear all stall visit timeouts
      for (const timeout of stallVisitTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      stallVisitTimeouts.current.clear();

      processedEntries.current.clear();
    };
  }, []);

  /**
   * Clear all visualization state
   */
  const clearState = useCallback((): void => {
    // Clear all pending timeouts
    for (const timeout of spawnTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    spawnTimeoutsRef.current.clear();

    for (const timeout of completionTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    completionTimeoutsRef.current.clear();

    for (const timeout of removalTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    removalTimeoutsRef.current.clear();

    for (const timeout of stallVisitTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    stallVisitTimeoutsRef.current.clear();
    lastStallVisitRef.current.clear();

    // Reset state
    setState({
      projects: new Map(),
      agents: new Map(),
      activeSkills: [],
      connections: [],
    });
    processedEntriesRef.current.clear();
    lastEntriesLengthRef.current = 0;
  }, []);

  return {
    state,
    isLoading,
    connectionStatus,
    clearState,
  };
}
