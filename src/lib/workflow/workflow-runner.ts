/**
 * Workflow Runner - Headless workflow execution via `claude -p`
 *
 * External loop that reads YAML workflow definitions, spawns `claude -p`
 * per phase, parses output, evaluates conditions, and transitions between
 * phases. Supports dynamic agent counts (from_previous), retry loops
 * (max_iterations), rate limit backoff, and timeout handling.
 *
 * Usage:
 *   claude-workflow run <workflow-name> "description"
 *   claude-workflow run feature-development "Build OAuth2 login"
 *   claude-workflow run lint-fix --timeout 30m
 *
 * Architecture mirrors GoalRunner (Layer 3) but operates on workflow phases
 * instead of freeform goal attempts.
 *
 * @module workflow/workflow-runner
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import chalk from "chalk";

import { showBox } from "../ui.js";
import { getWorkflowEngine } from "./workflow-engine.js";
import type { WorkflowConfig, WorkflowPhase } from "./types.js";
import { parsePhaseStreamOutput } from "./workflow-output-parser.js";
import type { ParsedPhaseOutput, PhaseOutput } from "./workflow-output-parser.js";
import { buildPhasePrompt } from "./workflow-prompt-builder.js";
import type { PreviousPhaseResult } from "./workflow-prompt-builder.js";

// ============================================================================
// Constants
// ============================================================================

const INITIAL_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 300_000; // 5 minutes
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour
const DEFAULT_MAX_ITERATIONS = 3;
const STATE_DIR = ".claude/workflow-runs";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowRunnerOptions {
  /** User's description of what to do */
  description: string;
  /** Max budget per phase in USD */
  maxBudgetUsd?: number;
  /** Claude model to use */
  model?: string;
  /** Project root directory */
  projectRoot?: string;
  /** Resume a previous run */
  resume?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Workflow name to execute */
  workflowName: string;
}

/** Persisted state for a workflow run */
export interface WorkflowRunState {
  /** All phase results in order */
  completed_phases: PhaseRunResult[];
  /** Workflow configuration snapshot */
  config: {
    max_budget_usd?: number;
    model?: string;
    timeout_ms: number;
  };
  /** ISO timestamp */
  created_at: string;
  /** Index of current phase in workflow.phases */
  current_phase_index: number;
  /** User description */
  description: string;
  /** Unique run ID */
  run_id: string;
  /** Overall run status */
  status: "aborted" | "completed" | "failed" | "in_progress" | "timeout";
  /** ISO timestamp */
  updated_at: string;
  /** Workflow name */
  workflow_name: string;
}

/** Result of a single phase execution */
export interface PhaseRunResult {
  /** Number of attempts made */
  attempts: number;
  /** ISO timestamp of completion */
  ended_at: string;
  /** Exit code from claude process */
  exit_code?: number;
  /** Parsed output from the phase */
  output: PhaseOutput | null;
  /** Phase ID */
  phase_id: string;
  /** Raw text output */
  raw_summary: string;
  /** ISO timestamp of start */
  started_at: string;
  /** Phase outcome */
  status: "blocked" | "complete" | "failed" | "rate_limited" | "skipped";
}

// ============================================================================
// WorkflowRunner
// ============================================================================

export class WorkflowRunner {
  private aborted = false;
  private consecutiveRateLimits = 0;
  private projectRoot: string;
  private startTime: number;
  private state: WorkflowRunState;
  private workflow: WorkflowConfig;

  private constructor(
    workflow: WorkflowConfig,
    state: WorkflowRunState,
    projectRoot: string,
  ) {
    this.workflow = workflow;
    this.state = state;
    this.projectRoot = projectRoot;
    this.startTime = Date.now();
  }

  // ==========================================================================
  // Static entry point
  // ==========================================================================

  static async run(options: WorkflowRunnerOptions): Promise<WorkflowRunState> {
    const projectRoot = options.projectRoot ?? process.cwd();

    // Load workflow definition
    const engine = getWorkflowEngine();
    const workflow = engine.getWorkflow(options.workflowName);

    if (!workflow) {
      const available = engine.listWorkflows();
      console.error(chalk.red(`Workflow not found: ${options.workflowName}`));
      if (available.length > 0) {
        console.error(chalk.dim(`Available workflows: ${available.join(", ")}`));
      }
      process.exit(1);
    }

    let state: WorkflowRunState;

    if (options.resume) {
      const existing = loadRunState(projectRoot, options.workflowName);
      if (!existing || existing.status !== "in_progress") {
        console.error(chalk.red("No active run to resume for this workflow."));
        process.exit(1);
      }
      state = existing;
      console.log(
        chalk.cyan(`Resuming workflow: ${workflow.name} (${state.run_id})`),
      );
      console.log(
        chalk.dim(
          `  ${String(state.completed_phases.length)}/${String(workflow.phases.length)} phases completed`,
        ),
      );
    } else {
      state = createRunState(workflow, options, projectRoot);
      console.log(chalk.cyan(`Workflow run created: ${state.run_id}`));
    }

    // Show workflow plan
    showBox(
      `Workflow: ${workflow.name}`,
      `Phases: ${workflow.phases.map((p) => p.id).join(" → ")}\n` +
        `Description: ${options.description.slice(0, 100)}`,
    );

    const runner = new WorkflowRunner(workflow, state, projectRoot);

    // Handle graceful shutdown
    const onSignal = (): void => {
      runner.aborted = true;
      console.log(chalk.yellow("\nWorkflow aborted by user."));
      runner.state.status = "aborted";
      runner.state.updated_at = new Date().toISOString();
      saveRunState(runner.state, projectRoot);
      process.exit(130);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      await runner.executePhases();
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }

    return runner.state;
  }

  // ==========================================================================
  // Phase Execution Loop
  // ==========================================================================

  private async executePhases(): Promise<void> {
    const phases = this.workflow.phases;

    for (let i = this.state.current_phase_index; i < phases.length; i++) {
      if (this.aborted) break;

      if (this.isTimedOut()) {
        console.log(chalk.red("\nWorkflow timed out."));
        this.state.status = "timeout";
        this.state.updated_at = new Date().toISOString();
        saveRunState(this.state, this.projectRoot);
        return;
      }

      const phase = phases[i];
      this.state.current_phase_index = i;
      saveRunState(this.state, this.projectRoot);

      console.log(chalk.bold(`\n${"=".repeat(60)}`));
      console.log(
        chalk.bold(
          `  Phase ${String(i + 1)}/${String(phases.length)}: ${phase.id}`,
        ),
      );
      console.log(chalk.dim(`  Agent: ${phase.agent}`));
      if (phase.description) {
        console.log(chalk.dim(`  ${phase.description}`));
      }
      console.log(chalk.bold("=".repeat(60)));

      const phaseResult = await this.executePhase(phase, i);
      this.state.completed_phases.push(phaseResult);
      this.state.updated_at = new Date().toISOString();
      saveRunState(this.state, this.projectRoot);

      // Print phase result
      this.printPhaseResult(phase, phaseResult);

      // Evaluate next phase transition
      if (phaseResult.status === "failed" || phaseResult.status === "blocked") {
        // executePhase already exhausted max_iterations internally.
        // Even if there's a retry condition (any_failed → same phase),
        // we should not re-enter - iterations were consumed.
        console.log(
          chalk.red(`\nPhase "${phase.id}" failed. Stopping workflow.`),
        );
        this.state.status = "failed";
        this.state.updated_at = new Date().toISOString();
        saveRunState(this.state, this.projectRoot);
        this.printFinalSummary();
        return;
      }

      // Calculate next phase
      if (phase.next === null) {
        // Terminal phase
        break;
      }

      // Use next_conditions to determine next phase
      // Note: failed/blocked statuses already returned above
      if (phase.next_conditions && phase.next_conditions.length > 0) {
        const phaseResults = {
          completed: phaseResult.status === "complete" ? 1 : 0,
          failed: 0,
          results: [],
          total: 1,
        };

        const transition = getWorkflowEngine().calculateNextPhase(
          this.workflow,
          phase.id,
          phaseResults,
        );

        if (transition.nextPhase === null) {
          break; // Workflow complete
        }

        // If the transition points to a different phase than the natural next,
        // find its index and jump there
        if (transition.nextPhase !== phases[i + 1]?.id) {
          const nextIndex = phases.findIndex(
            (p) => p.id === transition.nextPhase,
          );
          if (nextIndex !== -1) {
            // Adjust loop counter (will be incremented by for loop)
            i = nextIndex - 1;
          }
        }
      }
    }

    // Workflow completed successfully
    if (this.state.status === "in_progress") {
      this.state.status = "completed";
      this.state.updated_at = new Date().toISOString();
      saveRunState(this.state, this.projectRoot);
    }

    this.printFinalSummary();
  }

  /**
   * Execute a single phase, handling retries via max_iterations
   */
  private async executePhase(
    phase: WorkflowPhase,
    phaseIndex: number,
  ): Promise<PhaseRunResult> {
    const maxIterations = phase.max_iterations ?? DEFAULT_MAX_ITERATIONS;
    const startedAt = new Date().toISOString();

    let lastParsed: ParsedPhaseOutput | null = null;

    for (let attempt = 1; attempt <= maxIterations; attempt++) {
      if (this.aborted) break;

      if (attempt > 1) {
        console.log(
          chalk.yellow(`  Retry ${String(attempt)}/${String(maxIterations)}`),
        );
      }

      // Build prompt
      const previousResults = this.getPreviousResults(phaseIndex);
      const prompt = buildPhasePrompt({
        agentType: phase.agent,
        attemptNumber: attempt,
        maxIterations,
        phase,
        previousResults,
        totalPhases: this.workflow.phases.length,
        userDescription: this.state.description,
        workflowName: this.workflow.name,
      });

      // Spawn claude -p
      const output = await this.spawnClaude(prompt);
      lastParsed = parsePhaseStreamOutput(output);

      // Handle rate limit
      if (lastParsed.rateLimited) {
        this.consecutiveRateLimits++;
        const backoff = this.calculateBackoff();
        console.log(
          chalk.yellow(
            `  Rate limited. Waiting ${String(Math.round(backoff / MS_PER_SECOND))}s...`,
          ),
        );
        await this.sleep(backoff);
        continue; // Retry same attempt
      } else {
        this.consecutiveRateLimits = 0;
      }

      // Phase completed
      if (lastParsed.phaseComplete) {
        return {
          attempts: attempt,
          ended_at: new Date().toISOString(),
          output: lastParsed.phaseOutput,
          phase_id: phase.id,
          raw_summary:
            lastParsed.phaseOutput?.summary ??
            lastParsed.rawText.slice(0, 500),
          started_at: startedAt,
          status: "complete",
        };
      }

      // Phase not complete but not explicitly failed - continue to next iteration
      if ((
        lastParsed.phaseOutput?.status === "blocked" ||
        lastParsed.phaseOutput?.status === "failed"
      ) && attempt < maxIterations) {
        console.log(
          chalk.yellow(
            `  Phase reported ${lastParsed.phaseOutput.status}: ${lastParsed.phaseOutput.summary.slice(0, 100)}`,
          ),
        );
        continue;
      }

      // If this isn't the last iteration, try again (Claude may have
      // just not emitted the completion signal)
      if (attempt < maxIterations) {
        continue;
      }
    }

    // Exhausted all iterations
    return {
      attempts: maxIterations,
      ended_at: new Date().toISOString(),
      output: lastParsed?.phaseOutput ?? null,
      phase_id: phase.id,
      raw_summary:
        lastParsed?.phaseOutput?.summary ??
        lastParsed?.rawText.slice(0, 500) ??
        "No output captured",
      started_at: startedAt,
      status:
        lastParsed?.phaseOutput?.status === "blocked" ? "blocked" : "failed",
    };
  }

  // ==========================================================================
  // Claude Process Management
  // ==========================================================================

  private spawnClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p",
        prompt,
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format",
        "stream-json",
      ];

      if (this.state.config.model) {
        args.push("--model", this.state.config.model);
      }

      if (this.state.config.max_budget_usd) {
        args.push("--max-turns", "200");
      }

      const child = spawn("claude", args, {
        cwd: this.projectRoot,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        stdoutChunks.push(text);
        process.stderr.write(chalk.dim(text));
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrChunks.push(text);
        process.stderr.write(chalk.red(text));
      });

      child.on("close", (code) => {
        const fullOutput = stdoutChunks.join("") + stderrChunks.join("");
        if (code !== null && code !== 0 && code !== 1) {
          console.error(
            chalk.yellow(`\nclaude exited with code ${String(code)}`),
          );
        }
        resolve(fullOutput);
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get previous phase results for context injection
   */
  private getPreviousResults(
    currentPhaseIndex: number,
  ): PreviousPhaseResult | null {
    if (currentPhaseIndex === 0 || this.state.completed_phases.length === 0) {
      return null;
    }

    const lastResult =
      this.state.completed_phases[this.state.completed_phases.length - 1];
    const lastPhase = this.workflow.phases.find(
      (p) => p.id === lastResult.phase_id,
    );

    return {
      agentType: lastPhase?.agent ?? "unknown",
      output: lastResult.output?.results ?? null,
      phaseId: lastResult.phase_id,
      summary: lastResult.raw_summary,
    };
  }

  private isTimedOut(): boolean {
    return Date.now() - this.startTime > this.state.config.timeout_ms;
  }

  private calculateBackoff(): number {
    const backoff =
      INITIAL_BACKOFF_MS *
      Math.pow(BACKOFF_MULTIPLIER, this.consecutiveRateLimits - 1);
    return Math.min(backoff, MAX_BACKOFF_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private printPhaseResult(
    phase: WorkflowPhase,
    result: PhaseRunResult,
  ): void {
    const statusColor =
      result.status === "complete" ? chalk.green : chalk.red;

    console.log(
      `\n  ${statusColor(result.status.toUpperCase())} - ${phase.id}`,
    );
    if (result.raw_summary) {
      console.log(chalk.dim(`  ${result.raw_summary.slice(0, 200)}`));
    }
    if (result.attempts > 1) {
      console.log(chalk.dim(`  (${String(result.attempts)} attempts)`));
    }
  }

  private printFinalSummary(): void {
    const elapsed = Date.now() - this.startTime;
    const minutes = Math.round(elapsed / MS_PER_MINUTE);

    const statusColor =
      this.state.status === "completed" ? chalk.green : chalk.red;

    console.log(chalk.bold(`\n${"=".repeat(60)}`));
    console.log(chalk.bold("  WORKFLOW SUMMARY"));
    console.log(chalk.bold("=".repeat(60)));
    console.log(`  Workflow: ${this.workflow.name}`);
    console.log(`  Status: ${statusColor(this.state.status)}`);
    console.log(`  Duration: ${String(minutes)} minutes`);
    console.log(
      `  Phases: ${String(this.state.completed_phases.length)}/${String(this.workflow.phases.length)}`,
    );

    for (const phase of this.state.completed_phases) {
      const icon = phase.status === "complete" ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${icon} ${phase.phase_id}: ${phase.status}`);
    }

    console.log();
  }
}

// ============================================================================
// State Persistence
// ============================================================================

/**
 * Create a new run state
 */
function createRunState(
  workflow: WorkflowConfig,
  options: WorkflowRunnerOptions,
  projectRoot: string,
): WorkflowRunState {
  const runId = `run-${Date.now()}-${workflow.name}`;
  const state: WorkflowRunState = {
    completed_phases: [],
    config: {
      max_budget_usd: options.maxBudgetUsd,
      model: options.model,
      timeout_ms: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    created_at: new Date().toISOString(),
    current_phase_index: 0,
    description: options.description,
    run_id: runId,
    status: "in_progress",
    updated_at: new Date().toISOString(),
    workflow_name: workflow.name,
  };

  saveRunState(state, projectRoot);
  return state;
}

/**
 * Save run state to disk
 */
function saveRunState(state: WorkflowRunState, projectRoot: string): void {
  const dir = join(projectRoot, STATE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${state.workflow_name}.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/**
 * Load run state from disk
 */
function loadRunState(
  projectRoot: string,
  workflowName: string,
): WorkflowRunState | null {
  const filePath = join(projectRoot, STATE_DIR, `${workflowName}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as WorkflowRunState;
  } catch {
    return null;
  }
}

/**
 * Load run state for status display
 */
export function loadWorkflowRunState(
  workflowName: string,
  projectRoot?: string,
): WorkflowRunState | null {
  return loadRunState(projectRoot ?? process.cwd(), workflowName);
}
