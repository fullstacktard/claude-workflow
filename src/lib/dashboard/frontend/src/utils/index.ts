/**
 * Dashboard Frontend Utilities
 * Centralized exports for utility modules
 *
 * @module utils
 */

// Agent pool for object pooling optimization
export {
  AgentPool,
  getAgentPool,
  disposeAgentPool,
  useAgentPool,
  type AgentPoolConfig,
  type AcquiredAgent,
} from "./AgentPool";
