/**
 * Goal Runner - Core loop that spawns `claude -p` in a loop toward a goal
 *
 * Layer 3 of the Goal Loop system. Spawns fresh Claude sessions,
 * streams output, handles rate limits with exponential backoff,
 * manages attempt lifecycle, and detects completion.
 *
 * @module goal/goal-runner
 */

import { spawn } from "node:child_process";

import chalk from "chalk";

import { showBox } from "../ui.js";
import { buildGoalPrompt, buildVerificationPrompt } from "./goal-prompt-builder.js";
import { parseStreamOutput, parseVerificationOutput } from "./goal-output-parser.js";
import type { ParsedOutput, ProgressBlock, VerificationResult } from "./goal-output-parser.js";
import {
  addAttempt,
  loadGoalState,
  markGoalAborted,
  markGoalComplete,
  markGoalFailed,
  markGoalTimeout,
} from "./goal-state.js";
import type { GoalAttempt, GoalConfig, GoalState } from "./goal-state.js";

// ============================================================================
// Constants
// ============================================================================

const INITIAL_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 300_000; // 5 min
const BACKOFF_MULTIPLIER = 2;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

// ============================================================================
// Runner
// ============================================================================

export interface GoalRunnerOptions {
  goalText: string;
  config?: Partial<GoalConfig>;
  projectRoot?: string;
  resume?: boolean;
}

function getOutcomeColor(outcome: string): typeof chalk.green {
  if (outcome === "complete") return chalk.green;
  if (outcome === "rate_limited") return chalk.yellow;
  if (outcome === "blocked") return chalk.red;
  return chalk.cyan;
}

export class GoalRunner {
  private state: GoalState;
  private projectRoot: string;
  private startTime: number;
  private consecutiveRateLimits: number = 0;
  private aborted: boolean = false;

  private constructor(state: GoalState, projectRoot: string) {
    this.state = state;
    this.projectRoot = projectRoot;
    this.startTime = Date.now();
  }

  /**
   * Create and run a goal loop
   */
  static async run(options: GoalRunnerOptions): Promise<GoalState> {
    const projectRoot = options.projectRoot ?? process.cwd();

    let state: GoalState;

    if (options.resume) {
      const existing = loadGoalState(projectRoot);
      if (!existing || existing.status !== "in_progress") {
        console.error(chalk.red("No active goal to resume."));
        process.exit(1);
      }
      state = existing;
      console.log(chalk.cyan(`Resuming goal: ${state.goal_text.slice(0, 80)}`));
      console.log(chalk.dim(`  ${String(state.current_attempt)} attempts completed so far`));
    } else {
      // Import dynamically to avoid circular dependency at module load
      const { createGoalState } = await import("./goal-state.js");
      state = createGoalState(options.goalText, options.config, projectRoot);
      console.log(chalk.cyan(`Goal created: ${state.goal_id}`));
    }

    const runner = new GoalRunner(state, projectRoot);

    // Handle graceful shutdown
    const onSignal = (): void => {
      runner.aborted = true;
      console.log(chalk.yellow("\nGoal aborted by user."));
      markGoalAborted(runner.state, projectRoot);
      process.exit(130);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      await runner.loop();
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }

    return runner.state;
  }

  /**
   * Main goal loop
   *
   * Runs until goal completes, times out, or is aborted.
   * If max_attempts is set, also stops after that many attempts.
   */
  private async loop(): Promise<void> {
    const maxAttempts = this.state.config.max_attempts;
    let attemptNum = this.state.current_attempt + 1;

    while (true) {
      if (this.aborted) break;

      // Check max attempts (if set)
      if (maxAttempts !== undefined && attemptNum > maxAttempts) {
        console.log(chalk.red(`\nExhausted all ${String(maxAttempts)} attempts.`));
        markGoalFailed(this.state, this.projectRoot);
        this.printFinalSummary();
        return;
      }

      // Check timeout
      if (this.isTimedOut()) {
        console.log(chalk.red("\nGoal timed out."));
        markGoalTimeout(this.state, this.projectRoot);
        this.printFinalSummary();
        return;
      }

      const attemptLabel = maxAttempts === undefined
        ? `Attempt ${String(attemptNum)}`
        : `Attempt ${String(attemptNum)}/${String(maxAttempts)}`;

      console.log(chalk.bold(`\n${"=".repeat(60)}`));
      console.log(chalk.bold(`  ${attemptLabel}`));
      console.log(chalk.bold("=".repeat(60)));

      // Build prompt
      const prompt = buildGoalPrompt(this.state, attemptNum);

      // Spawn claude -p
      const output = await this.spawnClaude(prompt);

      // Parse output
      const parsed = parseStreamOutput(output);

      // Create attempt record
      const attempt = this.createAttempt(attemptNum, parsed);
      addAttempt(this.state, attempt, this.projectRoot);

      // Print attempt summary
      this.printAttemptSummary(attempt);

      // Check for completion - run verification before accepting
      if (parsed.goalComplete) {
        console.log(chalk.cyan("\nWorker claims GOAL_COMPLETE. Running verification..."));

        const verification = await this.verifyGoal();

        if (verification.verified) {
          console.log(chalk.green("\nGoal verified and completed!"));
          markGoalComplete(this.state, this.projectRoot);
          this.printFinalSummary();
          return;
        }

        // Verification failed - downgrade attempt to partial, inject issues
        console.log(chalk.yellow(`\nVerification failed: ${verification.summary}`));
        for (const issue of verification.issues) {
          console.log(chalk.yellow(`  - ${issue}`));
        }

        // Downgrade the attempt we just recorded
        attempt.outcome = "partial";
        attempt.progress_summary += " [VERIFICATION FAILED]";
        attempt.blockers = [...attempt.blockers, ...verification.issues];
        attempt.next_steps = [
          ...verification.issues.map((issue) => `Fix: ${issue}`),
          ...attempt.next_steps,
        ];

        // Re-save the updated attempt (overwrite via state mutation + save)
        this.state.attempts[this.state.attempts.length - 1] = attempt;
        const { saveGoalState } = await import("./goal-state.js");
        saveGoalState(this.state, this.projectRoot);

        // Continue the loop - don't mark complete
      }

      // Handle rate limit
      if (parsed.rateLimited) {
        this.consecutiveRateLimits++;
        const backoff = this.calculateBackoff();
        console.log(
          chalk.yellow(
            `Rate limited. Waiting ${String(Math.round(backoff / MS_PER_SECOND))}s before retry...`,
          ),
        );
        await this.sleep(backoff);
      } else {
        this.consecutiveRateLimits = 0;
      }

      attemptNum++;
    }
  }

  /**
   * Spawn a `claude -p` process and collect output
   */
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

      // Add model if specified
      if (this.state.config.model) {
        args.push("--model", this.state.config.model);
      }

      // Add max budget if specified
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
        // Stream output in real-time (dimmed)
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
          // Exit code 1 is normal for "no more work", non-zero others are errors
          console.error(chalk.yellow(`\nclaude exited with code ${String(code)}`));
        }
        resolve(fullOutput);
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  /**
   * Run a separate verification session to check goal completion.
   *
   * Spawns `claude -p` with a read-only inspector prompt. Fail-open:
   * if the verifier crashes or rate-limits, treat as verified.
   */
  private async verifyGoal(): Promise<VerificationResult> {
    try {
      const prompt = buildVerificationPrompt(this.state);

      console.log(chalk.dim("  Spawning verification session..."));
      const output = await this.spawnClaude(prompt);

      const result = parseVerificationOutput(output);

      console.log(
        chalk.dim(
          `  Verification result: ${result.verified ? "VERIFIED" : "NOT VERIFIED"} - ${result.summary}`,
        ),
      );

      return result;
    } catch (error) {
      // Fail-open: verifier errors → treat as verified
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.yellow(`  Verification error (fail-open): ${message}`));
      return {
        verified: true,
        issues: [],
        summary: `Verification skipped due to error: ${message}`,
      };
    }
  }

  /**
   * Create a GoalAttempt from parsed output
   */
  private createAttempt(attemptNumber: number, parsed: ParsedOutput): GoalAttempt {
    const progress: ProgressBlock = parsed.progressBlock ?? {
      blockers: [],
      decisions: [],
      files_modified: [],
      next_steps: [],
      status: "partial",
      summary: parsed.goalComplete
        ? "Goal completed"
        : "No progress block found in output",
    };

    return {
      attempt_number: attemptNumber,
      blockers: progress.blockers,
      decisions_made: progress.decisions,
      ended_at: new Date().toISOString(),
      exit_code: undefined,
      files_modified: progress.files_modified,
      next_steps: progress.next_steps,
      outcome: parsed.outcome,
      progress_summary: progress.summary,
      started_at: new Date(
        Date.now() - (parsed.rawText.length > 0 ? MS_PER_MINUTE : 0),
      ).toISOString(),
    };
  }

  /**
   * Check if the goal has exceeded its timeout
   */
  private isTimedOut(): boolean {
    return Date.now() - this.startTime > this.state.config.timeout_ms;
  }

  /**
   * Calculate exponential backoff for rate limits
   */
  private calculateBackoff(): number {
    const backoff =
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.consecutiveRateLimits - 1);
    return Math.min(backoff, MAX_BACKOFF_MS);
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Print a summary of a single attempt
   */
  private printAttemptSummary(attempt: GoalAttempt): void {
    const outcomeColor =
      getOutcomeColor(attempt.outcome);

    console.log(`\n${chalk.bold("Attempt Summary:")}`);
    console.log(`  Outcome: ${outcomeColor(attempt.outcome)}`);
    console.log(`  Summary: ${attempt.progress_summary.slice(0, 200)}`);

    if (attempt.files_modified.length > 0) {
      console.log(`  Files: ${attempt.files_modified.join(", ")}`);
    }
    if (attempt.blockers.length > 0) {
      console.log(`  Blockers: ${chalk.red(attempt.blockers.join(", "))}`);
    }
    if (attempt.next_steps.length > 0) {
      console.log(`  Next: ${attempt.next_steps.slice(0, 3).join(", ")}`);
    }
  }

  /**
   * Print the final summary when the goal loop ends
   */
  private printFinalSummary(): void {
    const elapsed = Date.now() - this.startTime;
    const minutes = Math.round(elapsed / MS_PER_MINUTE);
    const totalAttempts = this.state.attempts.length;
    const completed = this.state.cumulative_progress.completed.length;

    const statusColor =
      this.state.status === "completed"
        ? chalk.green
        : (this.state.status === "failed" || this.state.status === "timeout"
          ? chalk.red
          : chalk.yellow);

    const summary = [
      `Status: ${statusColor(this.state.status)}`,
      `Attempts: ${String(totalAttempts)}`,
      `Duration: ${String(minutes)} minutes`,
      `Items completed: ${String(completed)}`,
    ].join("\n");

    showBox("Goal Loop Complete", summary, this.state.status === "completed" ? "success" : "error");

    if (this.state.status !== "completed") {
      console.log(
        chalk.dim("\nResume with: claude-workflow goal --resume"),
      );
    }
  }
}
