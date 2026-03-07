/**
 * Centralized exports for dashboard frontend hooks
 *
 * NOTE: 3D visualization hooks (useAgentAnimations, useVisualizationState, useToolInteractions,
 * useDisposalManager) are NOT exported here to prevent @react-three/fiber and three.js from
 * being bundled into the main chunk. Import them directly from their files when needed inside
 * lazy-loaded components.
 *
 * @example
 * // Direct import for 3D hooks (inside lazy-loaded visualization components):
 * import { useDisposalManager } from "../hooks/useDisposalManager";
 * import type { UseDisposalManagerResult, DisposableResource } from "../hooks/useDisposalManager";
 */

export { useWebSocket } from "./useWebSocket";
export { useLogStream } from "./useLogStream";
export { useDockerLogs } from "./useDockerLogs";
export { useCredentialUpdates } from "./useCredentialUpdates";
export { useDependencyGraph } from "./useDependencyGraph";
export type {
  AgentStatus,
  AgentNodeData,
  DependencyEdge,
  DependencyGraphData,
  UseDependencyGraphOptions,
  UseDependencyGraphResult,
} from "./useDependencyGraph";
export { useWorkflowValidation } from "./useWorkflowValidation";
export type {
  ValidationError,
  UseWorkflowValidationResult,
} from "./useWorkflowValidation";
export { useTerminal, TERMINAL_THEME } from "./useTerminal";
export type { UseTerminalOptions, UseTerminalResult } from "./useTerminal";
export { useTerminalWebSocket } from "./useTerminalWebSocket";
export type {
  UseTerminalWebSocketOptions,
  UseTerminalWebSocketResult,
  ConnectionStatus,
  TerminalControlMessage,
} from "./useTerminalWebSocket";
export { useTmuxSessions } from "./useTmuxSessions";
export type {
  TmuxSessionWithNotification,
  SerializedProjectNode,
  SessionTreeResponse,
  UseTmuxSessionsResult,
} from "./useTmuxSessions";
export { useTreeView } from "./useTreeView";
export type {
  UseTreeViewOptions,
  UseTreeViewResult,
} from "./useTreeView";
export { useClock } from "./useClock";
export { useServiceHealth } from "./useServiceHealth";
export type { ServiceStatus, ServiceHealthState } from "./useServiceHealth";
