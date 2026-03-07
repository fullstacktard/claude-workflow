/**
 * Active Agent Tracker Service
 *
 * Tracks currently active agents (spawned but not yet completed) by listening to
 * LiveLogStream for agent spawns and AgentCompletionStream for completions.
 * Provides real-time state of active agents for visualization dashboard.
 *
 * Features:
 * - Event-driven tracking via LiveLogStream and AgentCompletionStream
 * - Orphan cleanup for agents that never complete (configurable timeout)
 * - Query methods for active agents by project
 * - Type-safe EventEmitter events for UI updates
 *
 * @module active-agent-tracker
 */

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import { EventEmitter } from "node:events";

import type { AgentCompletionStream, AgentCompletionEvent } from "./agent-completion-stream.js";
import type { LiveLogStream, LiveLogEntry } from "./live-log-stream.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ORPHAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents an active agent that has been spawned but not yet completed
 */
export interface ActiveAgent {
  /** Unique identifier for matching completions */
  agentId: string;
  /** Agent type (e.g., 'backend-engineer', 'frontend-engineer') */
  agentType: string;
  /** Parent project name */
  projectName: string;
  /** ISO timestamp when agent was spawned */
  spawnedAt: string;
  /** Session ID for correlation */
  sessionId: string;
}

/**
 * Configuration options for ActiveAgentTrackerService
 */
export interface ActiveAgentTrackerOptions {
  /** Timeout in milliseconds before orphan cleanup (default: 300000 = 5 minutes) */
  orphanTimeoutMs?: number;
  /** Interval in milliseconds for orphan cleanup check (default: 60000 = 1 minute) */
  cleanupIntervalMs?: number;
}

/**
 * Events emitted by ActiveAgentTrackerService
 */
export interface ActiveAgentTrackerEvents {
  "agent-active": (agent: ActiveAgent) => void;
  "agent-inactive": (agent: ActiveAgent, reason: "completed" | "orphan") => void;
  error: (error: Error, context: string) => void;
}

/**
 * Type-safe event emitter declaration
 */
export declare interface ActiveAgentTrackerService {
  emit<K extends keyof ActiveAgentTrackerEvents>(
    event: K,
    ...args: Parameters<ActiveAgentTrackerEvents[K]>
  ): boolean;
  on<K extends keyof ActiveAgentTrackerEvents>(
    event: K,
    listener: ActiveAgentTrackerEvents[K]
  ): this;
  off<K extends keyof ActiveAgentTrackerEvents>(
    event: K,
    listener: ActiveAgentTrackerEvents[K]
  ): this;
}

// ============================================================================
// Active Agent Tracker Service Class
// ============================================================================

/**
 * Tracks currently active agents (spawned but not completed)
 *
 * Listens to LiveLogStream for agent spawns and AgentCompletionStream
 * for completions. Maintains a map of active agents and provides
 * methods to query current state.
 *
 * @example
 * ```typescript
 * const tracker = new ActiveAgentTrackerService();
 *
 * tracker.on('agent-active', (agent) => {
 *   console.log(`Agent spawned: ${agent.agentType}`);
 * });
 *
 * tracker.on('agent-inactive', (agent, reason) => {
 *   console.log(`Agent ${agent.agentType} ${reason}`);
 * });
 *
 * tracker.start(liveLogStream, agentCompletionStream);
 * ```
 */
export class ActiveAgentTrackerService extends EventEmitter {
  private readonly options: Required<ActiveAgentTrackerOptions>;
  private activeAgents: Map<string, ActiveAgent> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  // Store bound handlers for cleanup
  private boundLogEntryHandler: ((entry: LiveLogEntry) => void) | null = null;
  private boundCompletionHandler: ((event: AgentCompletionEvent) => void) | null = null;
  private liveLogStream: LiveLogStream | null = null;
  private completionStream: AgentCompletionStream | null = null;

  constructor(options: ActiveAgentTrackerOptions = {}) {
    super();
    this.options = {
      orphanTimeoutMs: options.orphanTimeoutMs ?? DEFAULT_ORPHAN_TIMEOUT_MS,
      cleanupIntervalMs: options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
    };
  }

  /**
   * Start tracking active agents
   *
   * @param liveLogStream - LiveLogStream instance to listen for agent spawns
   * @param completionStream - AgentCompletionStream instance to listen for completions
   */
  start(liveLogStream: LiveLogStream, completionStream: AgentCompletionStream): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.liveLogStream = liveLogStream;
    this.completionStream = completionStream;

    // Create bound handlers for proper cleanup
    this.boundLogEntryHandler = this.handleLogEntry.bind(this);
    this.boundCompletionHandler = this.handleCompletion.bind(this);

    // Listen for agent spawns from LiveLogStream
    liveLogStream.on("log-entry", this.boundLogEntryHandler);

    // Listen for agent completions from AgentCompletionStream
    completionStream.on("agent-completion", this.boundCompletionHandler);

    // Start orphan cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupOrphanAgents(),
      this.options.cleanupIntervalMs
    );

    console.log("[active-agent-tracker] Started tracking active agents");
  }

  /**
   * Stop tracking and cleanup resources
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Remove event listeners
    if (this.liveLogStream && this.boundLogEntryHandler) {
      this.liveLogStream.off("log-entry", this.boundLogEntryHandler);
    }
    if (this.completionStream && this.boundCompletionHandler) {
      this.completionStream.off("agent-completion", this.boundCompletionHandler);
    }

    // Clear cleanup interval
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear state
    this.activeAgents.clear();
    this.liveLogStream = null;
    this.completionStream = null;
    this.boundLogEntryHandler = null;
    this.boundCompletionHandler = null;

    console.log("[active-agent-tracker] Stopped");
  }

  /**
   * Get all currently active agents
   *
   * @returns Array of active agents
   */
  getActiveAgents(): ActiveAgent[] {
    return [...this.activeAgents.values()];
  }

  /**
   * Get active agents for a specific project
   *
   * @param projectName - Project name to filter by
   * @returns Array of active agents for the project
   */
  getActiveAgentsForProject(projectName: string): ActiveAgent[] {
    return [...this.activeAgents.values()]
      .filter((agent) => agent.projectName === projectName);
  }

  /**
   * Check if the tracker is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the count of currently active agents
   */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /**
   * Handle incoming log entries from LiveLogStream
   *
   * Only processes `agent_invocation` type events, which indicate
   * a new agent has been spawned. Skips entries older than the orphan
   * timeout to avoid treating historical log replay as active agents
   * (LiveLogStream reads entire events.jsonl on startup).
   *
   * @param entry - Log entry from LiveLogStream
   */
  private handleLogEntry(entry: LiveLogEntry): void {
    // Only process agent_invocation events
    if (entry.type !== "agent_invocation") {
      return;
    }

    // Skip historical entries that are older than the orphan timeout.
    // On startup, LiveLogStream replays the entire events.jsonl file,
    // which would otherwise flood the tracker with stale "active" agents.
    const entryAge = Date.now() - new Date(entry.timestamp).getTime();
    if (entryAge > this.options.orphanTimeoutMs) {
      return;
    }

    // Extract agent info from entry
    // LiveLogEntry has agent field for agent type, agentType as fallback
    const agentType = entry.agent ?? entry.agentType ?? "unknown";
    const projectName = entry.projectName ?? entry.project ?? "unknown";
    const sessionId = entry.sessionId ?? "unknown";
    const spawnedAt = entry.timestamp;

    // Generate unique agent ID using composite key
    // This handles multiple agents of same type in one session
    const agentId = `${sessionId}-${agentType}-${spawnedAt}`;

    // Check for duplicate (shouldn't happen but be safe)
    if (this.activeAgents.has(agentId)) {
      return;
    }

    const activeAgent: ActiveAgent = {
      agentId,
      agentType,
      projectName,
      sessionId,
      spawnedAt,
    };

    this.activeAgents.set(agentId, activeAgent);
    this.emit("agent-active", activeAgent);

    console.log(
      `[active-agent-tracker] Agent active: ${agentType} (${agentId.slice(0, 20)}...) for ${projectName}`
    );
  }

  /**
   * Handle agent completion events from AgentCompletionStream
   *
   * Removes the completed agent from the active agents map.
   * Uses fallback matching by agentType and sessionId if exact
   * agentId match fails.
   *
   * @param event - Agent completion event
   */
  private handleCompletion(event: AgentCompletionEvent): void {
    // Find matching agent in our map
    // AgentCompletionEvent has: agentId, agentType, projectName, sessionId

    // Try to find by exact agentId first
    if (event.agentId && this.activeAgents.has(event.agentId)) {
      const agent = this.activeAgents.get(event.agentId)!;
      this.activeAgents.delete(event.agentId);
      this.emit("agent-inactive", agent, "completed");
      console.log(
        `[active-agent-tracker] Agent completed: ${agent.agentType} (${event.agentId})`
      );
      return;
    }

    // Fallback: Find by matching agentType and sessionId
    // This handles cases where agentId format differs between spawn and completion
    for (const [key, agent] of this.activeAgents) {
      if (
        agent.agentType === event.agentType &&
        agent.sessionId === event.sessionId
      ) {
        this.activeAgents.delete(key);
        this.emit("agent-inactive", agent, "completed");
        console.log(
          `[active-agent-tracker] Agent completed (by type match): ${agent.agentType}`
        );
        return;
      }
    }

    // No match found - agent may have been orphan-cleaned already
    // or spawned before tracker started
  }

  /**
   * Clean up agents that have been active longer than the orphan timeout
   *
   * Called periodically to remove agents that never completed (e.g., crashed,
   * interrupted, or otherwise failed to report completion).
   */
  private cleanupOrphanAgents(): void {
    const now = Date.now();
    const cutoffTime = now - this.options.orphanTimeoutMs;

    for (const [key, agent] of this.activeAgents) {
      const spawnedAtMs = new Date(agent.spawnedAt).getTime();

      if (spawnedAtMs < cutoffTime) {
        this.activeAgents.delete(key);
        this.emit("agent-inactive", agent, "orphan");
        console.log(
          `[active-agent-tracker] Orphan cleanup: ${agent.agentType} (${agent.agentId}) - spawned ${Math.round((now - spawnedAtMs) / 1000)}s ago`
        );
      }
    }
  }
}
