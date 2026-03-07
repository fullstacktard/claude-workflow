/**
 * useToolInteractions Hook
 * Manages tool interaction events for 3D visualization
 *
 * Transforms WebSocket log entries (mcp_tool_call, skill_invocation) into
 * ToolInteractionEvent objects suitable for the ToolInteraction component.
 *
 * Features:
 * - Maps log entry types to tool types (skill, mcp_tool, read, edit, bash)
 * - Categorizes MCP tools based on tool name patterns
 * - Limits concurrent interactions per agent to prevent visual clutter
 * - Provides cleanup callback for completed animations
 *
 * @module hooks/useToolInteractions
 *
 * @example
 * ```tsx
 * function VisualizationScene() {
 *   const { interactions, addInteraction, removeInteraction, clearInteractions } =
 *     useToolInteractions();
 *
 *   // Add interaction from WebSocket event
 *   useEffect(() => {
 *     const entry = { type: 'mcp_tool_call', mcpTool: 'Read', ... };
 *     addInteraction(entry, 'agent-123');
 *   }, []);
 *
 *   return (
 *     <ToolInteractionContainer
 *       interactions={interactions}
 *       agentPositions={agentPositions}
 *       onInteractionComplete={removeInteraction}
 *     />
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef } from "react";

import type { StreamLogEntry } from "./useLogStream";
import type { ToolInteractionEvent, ToolType } from "../components/visualization/ToolInteraction";

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum concurrent interactions to display per agent
 * Prevents visual clutter when many tools are invoked rapidly
 */
const MAX_INTERACTIONS_PER_AGENT = 5;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Maps a log entry type to a tool type for visualization
 *
 * Tool type categorization:
 * - skill_invocation -> skill
 * - mcp_tool_call with "read/Read" -> read
 * - mcp_tool_call with "edit/Edit" -> edit
 * - mcp_tool_call with "bash/Bash" -> bash
 * - mcp_tool_call (other) -> mcp_tool
 *
 * @param entry - Stream log entry from WebSocket
 * @returns Tool type or null if entry is not a tool invocation
 */
function mapLogEntryToToolType(entry: StreamLogEntry): ToolType | null {
  switch (entry.type) {
    case "skill_invocation":
      return "skill";

    case "mcp_tool_call":
      // Categorize MCP tools by name patterns
      if (entry.mcpTool !== undefined) {
        const toolName = entry.mcpTool.toLowerCase();

        // Read operations
        if (toolName.includes("read") || toolName.includes("glob") || toolName.includes("grep")) {
          return "read";
        }

        // Edit operations
        if (toolName.includes("edit") || toolName.includes("write") || toolName.includes("replace")) {
          return "edit";
        }

        // Bash/terminal operations
        if (toolName.includes("bash") || toolName.includes("shell") || toolName.includes("exec")) {
          return "bash";
        }
      }

      // Default to generic MCP tool
      return "mcp_tool";

    default:
      return null;
  }
}

/**
 * Extracts a clean tool name from log entry for display
 *
 * @param entry - Stream log entry from WebSocket
 * @returns Clean tool name for display
 */
function extractToolName(entry: StreamLogEntry): string {
  // Skill invocations use the skill field
  if (entry.skill !== undefined) {
    return entry.skill;
  }

  // MCP tool calls use the mcpTool field
  if (entry.mcpTool !== undefined) {
    return entry.mcpTool;
  }

  return "unknown";
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result of useToolInteractions hook
 */
export interface UseToolInteractionsResult {
  /** Array of active tool interactions */
  interactions: ToolInteractionEvent[];
  /**
   * Add a new tool interaction from a log entry event
   * @param entry - Stream log entry from WebSocket
   * @param agentId - ID of the agent invoking the tool
   */
  addInteraction: (entry: StreamLogEntry, agentId: string) => void;
  /**
   * Remove a completed interaction
   * @param id - ID of the interaction to remove
   */
  removeInteraction: (id: string) => void;
  /** Clear all interactions */
  clearInteractions: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to manage tool interaction events for 3D visualization
 *
 * Transforms WebSocket log entries into ToolInteractionEvent objects
 * and manages the lifecycle of visual tool indicators.
 *
 * @returns UseToolInteractionsResult with interactions array and management functions
 */
export function useToolInteractions(): UseToolInteractionsResult {
  const [interactions, setInteractions] = useState<ToolInteractionEvent[]>([]);
  const idCounterRef = useRef(0);

  /**
   * Add a new tool interaction from a log entry event
   */
  const addInteraction = useCallback(
    (entry: StreamLogEntry, agentId: string): void => {
      const toolType = mapLogEntryToToolType(entry);
      if (toolType === null) return;

      const toolName = extractToolName(entry);

      const newInteraction: ToolInteractionEvent = {
        id: `tool-${idCounterRef.current++}`,
        toolType,
        toolName,
        agentId,
        timestamp: Date.now(),
      };

      setInteractions((prev) => {
        // Count existing interactions for this agent
        const agentInteractions = prev.filter((i) => i.agentId === agentId);

        if (agentInteractions.length >= MAX_INTERACTIONS_PER_AGENT) {
          // Remove oldest interaction for this agent to make room
          const oldestAgentInteraction = agentInteractions[0];
          return [
            ...prev.filter((i) => i.id !== oldestAgentInteraction.id),
            newInteraction,
          ];
        }

        return [...prev, newInteraction];
      });
    },
    []
  );

  /**
   * Remove a completed interaction
   */
  const removeInteraction = useCallback((id: string): void => {
    setInteractions((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /**
   * Clear all interactions
   */
  const clearInteractions = useCallback((): void => {
    setInteractions([]);
  }, []);

  return {
    interactions,
    addInteraction,
    removeInteraction,
    clearInteractions,
  };
}
