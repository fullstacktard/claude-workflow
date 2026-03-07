/**
 * Component exports
 */

export { AccountUsageWidget } from "./AccountUsageWidget";
export { AddAccountModal } from "./AddAccountModal";
export { AddExternalModelModal } from "./AddExternalModelModal";
export { AgentInvocationCard } from "./AgentInvocationCard";
export { DependencyGraph } from "./DependencyGraph";
export { DependencyNode } from "./DependencyNode";
export type {
  AgentInvocationEvent,
  SkillInvocationEvent,
} from "./AgentInvocationCard";
export type { ExternalModel } from "./AddExternalModelModal";
export { AddMcpServerModal } from "./AddMcpServerModal";
export type { McpServerConfig } from "./AddMcpServerModal";
export { ClaudeProxyConfigWidget } from "./ClaudeProxyConfigWidget";
export { ClaudeProxyTabbedWidget } from "./ClaudeProxyTabbedWidget";
export { ExternalModelsWidget } from "./ExternalModelsWidget";
export { LiveLogFeed } from "./LiveLogFeed";
export { LogEntry } from "./LogEntry";
export { McpProxyWidget } from "./McpProxyWidget";
export { Navigation } from "./Navigation";
export { ProjectListWidget } from "./ProjectListWidget";
export { SkillComplianceIndicator } from "./SkillComplianceIndicator";
export { SkillInvocationBadge } from "./SkillInvocationBadge";
export type { SkillInvocationBadgeEvent } from "./SkillInvocationBadge";
export { TerminalCard } from "./TerminalCard";
export { Toast, ToastContainer } from "./Toast";
export type { ToastItem, ToastType } from "./Toast";

export { useMcpProxyLogs } from "../hooks/useMcpProxyLogs";
export type { McpProxyLogEntry, McpProxyLogStatus } from "../hooks/useMcpProxyLogs";

export { BottomBar } from "./BottomBar";

// NOTE: Scene3D and CameraController require Three.js context (Canvas).
// Import them directly from "./visualization/" when needed to avoid loading Three.js on every page.
// Example: import { Scene3D } from "./components/visualization/Scene3D";
//          import { CameraController } from "./components/visualization/CameraController";
// DO NOT export CameraController here - it loads Three.js which breaks non-visualization pages
