/**
 * Workflow State Manager
 *
 * Manages multi-phase workflow state with phase tracking, iteration limits, and persistence.
 * Integrates with existing workflow-state.ts for session-based state management.
 *
 * Features:
 * - Workflow initialization from config
 * - Phase transitions with validation
 * - Iteration tracking and limits
 * - Phase history
 * - State persistence (atomic writes)
 * - Concurrent workflow support
 *
 * @module WorkflowStateManager
 */

import {
  getSessionId,
  getWorkflowById,
  type MultiPhaseWorkflowState,
  type PhaseHistoryEntry,
  type PhaseInfo,
  type PhaseResults,
  removeWorkflow,
  updateWorkflowState as updateWorkflowStateInStore,
} from "../../templates/.claude/hooks/core/workflow-state.js";
import { type PhaseConfig, validatePhaseTransition } from "./phase-tracker.js";



/**
 * Workflow configuration for state manager
 *
 * Note: This is a subset of the full WorkflowConfig from types.ts,
 * containing only the fields needed for state management.
 */
export interface WorkflowStateConfig {
  default_max_iterations: number;
  phases: PhaseConfig[];
  workflow_id: string;
  workflow_name: string;
}

/**
 * WorkflowStateManager
 *
 * Class-based state manager for multi-phase workflows.
 * Provides high-level API for workflow lifecycle management.
 */
export class WorkflowStateManager {
  private config: WorkflowStateConfig;
  private sessionId: string;

  /**
   * Create a new WorkflowStateManager
   *
   * @param {WorkflowStateConfig} config - Workflow configuration
   * @param {string} sessionId - Optional session ID (defaults to current session)
   */
  constructor(config: WorkflowStateConfig, sessionId?: string) {
    this.config = config;
    this.sessionId = (sessionId !== undefined && sessionId.length > 0) ? sessionId : getSessionId();
  }

  /**
   * Complete workflow and remove from state
   */
  async complete(): Promise<void> {
    await removeWorkflow(this.config.workflow_id, this.sessionId);
  }

  /**
   * Mark current phase as failed and move to history
   *
   * @param {PhaseResults} error - Error information
   */
  async failCurrentPhase(error?: PhaseResults): Promise<void> {
    const state = await this.getState();
    if (!state) {
      throw new Error("No workflow state found");
    }

    // Mark phase as failed
    state.current_phase.status = "failed";

    // Append to history
    state.phase_history.push({
      completed_at: new Date().toISOString(),
      iteration: state.iterations[state.current_phase.id] ?? 1,
      phase_id: state.current_phase.id,
      results: error ?? undefined,
      started_at: state.current_phase.started_at,
      status: "failed",
    });

    await updateWorkflowStateInStore(this.config.workflow_id, state, this.sessionId);
  }

  /**
   * Get current phase info
   *
   * @returns {Promise<PhaseInfo|undefined>} Current phase or undefined if no state
   */
  async getCurrentPhase(): Promise<PhaseInfo | undefined> {
    const state = await this.getState();
    return state?.current_phase ?? undefined;
  }

  /**
   * Get phase history
   *
   * @returns {Promise<PhaseHistoryEntry[]>} Phase history (empty array if no state)
   */
  async getPhaseHistory(): Promise<PhaseHistoryEntry[]> {
    const state = await this.getState();
    return state?.phase_history ?? [];
  }

  /**
   * Get current workflow state
   *
   * @returns {Promise<MultiPhaseWorkflowState|undefined>} Workflow state or undefined if not found
   */
  async getState(): Promise<MultiPhaseWorkflowState | undefined> {
    const state = await getWorkflowById(this.config.workflow_id, this.sessionId);
    return state ?? undefined;
  }

  /**
   * Get workflow summary (for debugging/monitoring)
   *
   * @returns {Promise<object|undefined>} Workflow summary or undefined
   */
  async getSummary(): Promise<undefined | {
    current_phase: string;
    iterations: Record<string, number>;
    phase_count: number;
    phase_status: string;
    workflow_id: string;
    workflow_name: string;
  }> {
    const state = await this.getState();
    if (!state) {
      return undefined;
    }

    return {
      current_phase: state.current_phase.id,
      iterations: state.iterations,
      phase_count: state.phase_history.length + 1,
      phase_status: state.current_phase.status,
      workflow_id: state.workflow_id,
      workflow_name: state.workflow_name,
    };
  }

  /**
   * Initialize new workflow state from config
   *
   * Creates initial state with first phase active.
   * Persists state to disk.
   *
   * @returns {Promise<MultiPhaseWorkflowState>} Initialized workflow state
   * @throws {Error} If workflow config has no phases
   */
  async initialize(): Promise<MultiPhaseWorkflowState> {
    const firstPhase = this.config.phases[0];
    if (!firstPhase) {
      throw new Error("Workflow config must have at least one phase");
    }

    // Build max_iterations map from config
    const maxIterations: Record<string, number> = {};
    for (const phase of this.config.phases) {
      maxIterations[phase.id] = phase.max_iterations ?? this.config.default_max_iterations;
    }

    const state: MultiPhaseWorkflowState = {
      current_phase: {
        agent: firstPhase.agent,
        agents_completed: 0,
        agents_failed: 0,
        agents_spawned: 0,
        id: firstPhase.id,
        spawned_agent_ids: [],
        spawned_agent_records: [],
        started_at: new Date().toISOString(),
        status: "running",
      },
      iterations: { [firstPhase.id]: 1 },
      max_iterations: maxIterations,
      pending_spawn_queue: [],
      phase_history: [],
      session_id: this.sessionId,
      started_at: new Date().toISOString(),
      status: "running",
      workflow_id: this.config.workflow_id,
      workflow_name: this.config.workflow_name,
    };

    // Persist to workflow-state.json (extends existing state)
    await updateWorkflowStateInStore(this.config.workflow_id, state, this.sessionId);

    return state;
  }

  /**
   * Transition to next phase
   *
   * Validates transition, updates state, persists changes.
   *
   * Process:
   * 1. Validate phase exists and iteration limit not exceeded
   * 2. Append current phase to history
   * 3. Update current_phase to next phase
   * 4. Increment iteration counter
   * 5. Persist state atomically
   *
   * @param {string} nextPhaseId - Target phase ID
   * @param {PhaseResults} results - Optional results from completed phase
   * @throws {Error} If no workflow state found, phase not found, or iteration limit exceeded
   */
  async transitionToPhase(nextPhaseId: string, results?: PhaseResults): Promise<void> {
    const state = await this.getState();
    if (!state) {
      throw new Error("No workflow state found - call initialize() first");
    }

    // Validate phase exists in config
    const nextPhaseConfig = this.config.phases.find(p => p.id === nextPhaseId);
    if (!nextPhaseConfig) {
      throw new Error(`Phase '${nextPhaseId}' not found in workflow config`);
    }

    // Validate transition
    const validation = validatePhaseTransition(
      state.current_phase.id,
      nextPhaseId,
      state.iterations,
      state.max_iterations,
      this.config.phases
    );

    if (!validation.valid) {
      throw new Error(
        `Phase transition validation failed:\n${validation.errors.join("\n")}`
      );
    }

    // Append current phase to history
    state.phase_history.push({
      completed_at: new Date().toISOString(),
      iteration: state.iterations[state.current_phase.id] ?? 1,
      phase_id: state.current_phase.id,
      results: results ?? undefined,
      started_at: state.current_phase.started_at,
      status: "completed",
    });

    // Update to new phase
    state.current_phase = {
      agent: nextPhaseConfig.agent,
      agents_completed: 0,
      agents_failed: 0,
      agents_spawned: 0,
      id: nextPhaseId,
      spawned_agent_ids: [],
      spawned_agent_records: [],
      started_at: new Date().toISOString(),
      status: "running",
    };

    // Increment iteration counter
    state.iterations[nextPhaseId] = (state.iterations[nextPhaseId] ?? 0) + 1;

    // Persist state
    await updateWorkflowStateInStore(this.config.workflow_id, state, this.sessionId);
  }

  /**
   * Update agent counts for current phase
   *
   * @param {number} spawned - Agents spawned
   * @param {number} completed - Agents completed
   * @param {number} failed - Agents failed
   */
  async updateAgentCounts(
    spawned?: number,
    completed?: number,
    failed?: number
  ): Promise<void> {
    const state = await this.getState();
    if (!state) {
      throw new Error("No workflow state found");
    }

    if (spawned !== undefined) {
      state.current_phase.agents_spawned = spawned;
    }
    if (completed !== undefined) {
      state.current_phase.agents_completed = completed;
    }
    if (failed !== undefined) {
      state.current_phase.agents_failed = failed;
    }

    await updateWorkflowStateInStore(this.config.workflow_id, state, this.sessionId);
  }

  /**
   * Update current phase status
   *
   * @param {PhaseStatus} status - New phase status
   */
  async updatePhaseStatus(status: "blocked" | "completed" | "failed" | "running"): Promise<void> {
    const state = await this.getState();
    if (!state) {
      throw new Error("No workflow state found");
    }

    state.current_phase.status = status;
    await updateWorkflowStateInStore(this.config.workflow_id, state, this.sessionId);
  }
}

export {type PhaseResults} from "../../templates/.claude/hooks/core/workflow-state.js";