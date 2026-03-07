/**
 * Goal State - Persistent state management for the Goal Loop system
 *
 * Storage layout:
 *   .claude/goals/{goal_id}.json  - Individual goal state files
 *   .claude/goals/active.json     - Pointer to the currently active goal (with PID lock)
 *
 * State survives /compact, /clear, session restarts, and crashes.
 * Uses atomic writes (write temp, rename) following workflow-state.ts pattern.
 *
 * @module goal/goal-state
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type GoalStatus = "aborted" | "completed" | "failed" | "in_progress" | "timeout";

export type AttemptOutcome = "blocked" | "complete" | "error" | "partial" | "rate_limited" | "timeout";

export interface GoalConfig {
  max_attempts?: number;
  max_budget_usd?: number;
  model?: string;
  timeout_ms: number;
}

export interface GoalAttempt {
  attempt_number: number;
  blockers: string[];
  decisions_made: string[];
  ended_at?: string;
  exit_code?: number;
  files_modified: string[];
  next_steps: string[];
  outcome: AttemptOutcome;
  progress_summary: string;
  started_at: string;
}

export interface CumulativeProgress {
  completed: string[];
  in_progress: string[];
  key_decisions: string[];
  not_started: string[];
}

export interface GoalState {
  attempts: GoalAttempt[];
  config: GoalConfig;
  created_at: string;
  cumulative_progress: CumulativeProgress;
  current_attempt: number;
  goal_id: string;
  goal_text: string;
  status: GoalStatus;
  updated_at: string;
}

interface ActivePointer {
  goal_id: string;
  pid: number;
  started_at: string;
}

// ============================================================================
// Constants
// ============================================================================

const CLAUDE_DIR = ".claude";
const GOALS_DIR = "goals";
const ACTIVE_POINTER = "active.json";

const DEFAULT_TIMEOUT_MS = 3_600_000; // 60 minutes

// ============================================================================
// Path Helpers
// ============================================================================

function getClaudeDir(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), CLAUDE_DIR);
}

function getGoalsDir(projectRoot?: string): string {
  return path.join(getClaudeDir(projectRoot), GOALS_DIR);
}

function getGoalFilePath(goalId: string, projectRoot?: string): string {
  return path.join(getGoalsDir(projectRoot), `${goalId}.json`);
}

function getActivePointerPath(projectRoot?: string): string {
  return path.join(getGoalsDir(projectRoot), ACTIVE_POINTER);
}

function ensureGoalsDir(projectRoot?: string): void {
  const dir = getGoalsDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Active Pointer
// ============================================================================

/**
 * Get the ID of the currently active goal, or null if none.
 * Also validates the PID - if the owning process is dead, clears the pointer.
 */
function getActiveGoalId(projectRoot?: string): string | null {
  const pointerPath = getActivePointerPath(projectRoot);
  if (!existsSync(pointerPath)) return null;

  try {
    const raw = readFileSync(pointerPath, "utf8");
    const pointer = JSON.parse(raw) as ActivePointer;

    // Validate PID is still alive (prevents stale locks from crashes)
    if (pointer.pid) {
      try {
        process.kill(pointer.pid, 0); // signal 0 = check if process exists
      } catch {
        // Process is dead - stale pointer from a crash
        // Don't clear yet, just return the ID so the goal can be resumed
      }
    }

    return pointer.goal_id;
  } catch {
    return null;
  }
}

/**
 * Check if another goal loop process is actively running.
 * Returns the PID if locked by a live process, null if free or stale.
 */
export function getActiveLockPid(projectRoot?: string): number | null {
  const pointerPath = getActivePointerPath(projectRoot);
  if (!existsSync(pointerPath)) return null;

  try {
    const raw = readFileSync(pointerPath, "utf8");
    const pointer = JSON.parse(raw) as ActivePointer;
    if (!pointer.pid) return null;

    // Check if PID is alive
    try {
      process.kill(pointer.pid, 0);
      return pointer.pid; // Process is alive - locked
    } catch {
      return null; // Process is dead - stale lock
    }
  } catch {
    return null;
  }
}

/**
 * Set the active goal pointer with PID lock
 */
function setActiveGoalId(goalId: string, projectRoot?: string): void {
  const pointerPath = getActivePointerPath(projectRoot);
  const pointer: ActivePointer = {
    goal_id: goalId,
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), "utf8");
}

/**
 * Clear the active goal pointer
 */
function clearActiveGoal(projectRoot?: string): void {
  const pointerPath = getActivePointerPath(projectRoot);

  try {
    if (existsSync(pointerPath)) unlinkSync(pointerPath);
  } catch {
    // Best-effort cleanup
  }
}

// ============================================================================
// State CRUD
// ============================================================================

/**
 * Generate a unique goal ID based on timestamp and sanitized goal text
 */
function generateGoalId(goalText: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', "");
  const slug = goalText
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
  return `goal-${date}-${slug}`;
}

/**
 * Create a new goal state and persist it
 */
export function createGoalState(
  goalText: string,
  config?: Partial<GoalConfig>,
  projectRoot?: string,
): GoalState {
  const now = new Date().toISOString();

  const state: GoalState = {
    attempts: [],
    config: {
      max_attempts: config?.max_attempts,
      max_budget_usd: config?.max_budget_usd,
      model: config?.model,
      timeout_ms: config?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    },
    created_at: now,
    cumulative_progress: {
      completed: [],
      in_progress: [],
      key_decisions: [],
      not_started: [],
    },
    current_attempt: 0,
    goal_id: generateGoalId(goalText),
    goal_text: goalText,
    status: "in_progress",
    updated_at: now,
  };

  ensureGoalsDir(projectRoot);

  // Set as active goal
  setActiveGoalId(state.goal_id, projectRoot);

  // Save state
  saveGoalState(state, projectRoot);

  return state;
}

/**
 * Load the currently active goal state. Returns null if none active.
 */
export function loadGoalState(projectRoot?: string): GoalState | null {
  const goalId = getActiveGoalId(projectRoot);
  if (!goalId) return null;

  return loadGoalById(goalId, projectRoot);
}

/**
 * Load a specific goal by ID
 */
export function loadGoalById(goalId: string, projectRoot?: string): GoalState | null {
  const filePath = getGoalFilePath(goalId, projectRoot);

  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as GoalState;
  } catch {
    return null;
  }
}

/**
 * Save goal state atomically (write temp file, then rename)
 */
export function saveGoalState(state: GoalState, projectRoot?: string): void {
  state.updated_at = new Date().toISOString();

  ensureGoalsDir(projectRoot);

  const filePath = getGoalFilePath(state.goal_id, projectRoot);
  const tmpPath = `${filePath}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

/**
 * Add a new attempt to the goal state
 */
export function addAttempt(state: GoalState, attempt: GoalAttempt, projectRoot?: string): void {
  state.attempts.push(attempt);
  state.current_attempt = attempt.attempt_number;

  mergeProgress(state, attempt);
  saveGoalState(state, projectRoot);
}

/**
 * Merge attempt results into cumulative progress
 */
function mergeProgress(state: GoalState, attempt: GoalAttempt): void {
  const progress = state.cumulative_progress;

  for (const decision of attempt.decisions_made) {
    if (!progress.key_decisions.includes(decision)) {
      progress.key_decisions.push(decision);
    }
  }

  progress.in_progress = attempt.next_steps.slice(0, 3);
  progress.not_started = attempt.next_steps.slice(3);

  if (attempt.outcome === "complete" || attempt.outcome === "partial") {
    for (const file of attempt.files_modified) {
      const item = `Modified: ${file}`;
      if (!progress.completed.includes(item)) {
        progress.completed.push(item);
      }
    }
  }
}

/**
 * Mark the goal as completed and clear active pointer
 */
export function markGoalComplete(state: GoalState, projectRoot?: string): void {
  state.status = "completed";
  saveGoalState(state, projectRoot);
  clearActiveGoal(projectRoot);
}

/**
 * Mark the goal as aborted (keeps state file for --resume)
 */
export function markGoalAborted(state: GoalState, projectRoot?: string): void {
  state.status = "aborted";
  saveGoalState(state, projectRoot);
  clearActiveGoal(projectRoot);
}

/**
 * Mark the goal as failed (exhausted attempts)
 */
export function markGoalFailed(state: GoalState, projectRoot?: string): void {
  state.status = "failed";
  saveGoalState(state, projectRoot);
  clearActiveGoal(projectRoot);
}

/**
 * Mark the goal as timed out
 */
export function markGoalTimeout(state: GoalState, projectRoot?: string): void {
  state.status = "timeout";
  saveGoalState(state, projectRoot);
  clearActiveGoal(projectRoot);
}

/**
 * Check if a goal is currently active (in_progress)
 */
export function isGoalActive(projectRoot?: string): boolean {
  const state = loadGoalState(projectRoot);
  return state !== null && state.status === "in_progress";
}

/**
 * Get the last attempt from a goal state
 */
export function getLastAttempt(state: GoalState): GoalAttempt | undefined {
  return state.attempts.at(-1);
}

/**
 * List all goal state files, sorted by creation date (newest first)
 */
export function listGoals(projectRoot?: string): GoalState[] {
  const goalsDir = getGoalsDir(projectRoot);
  if (!existsSync(goalsDir)) return [];

  const goals: GoalState[] = [];

  for (const file of readdirSync(goalsDir)) {
    if (!file.endsWith(".json") || file === ACTIVE_POINTER) continue;

    try {
      const raw = readFileSync(path.join(goalsDir, file), "utf8");
      goals.push(JSON.parse(raw) as GoalState);
    } catch {
      // Skip corrupt files
    }
  }

  return goals.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Find the most recent resumable goal (aborted, failed, or timed out)
 */
export function findResumableGoal(projectRoot?: string): GoalState | null {
  const goals = listGoals(projectRoot);

  // Active goal first
  const active = goals.find((g) => g.status === "in_progress");
  if (active) return active;

  // Then most recent aborted/failed/timeout
  return goals.find((g) =>
    g.status === "aborted" || g.status === "failed" || g.status === "timeout",
  ) ?? null;
}

/**
 * Resume a goal by setting it back to in_progress and making it active
 */
export function resumeGoal(state: GoalState, projectRoot?: string): void {
  state.status = "in_progress";

  ensureGoalsDir(projectRoot);
  setActiveGoalId(state.goal_id, projectRoot);
  saveGoalState(state, projectRoot);
}
