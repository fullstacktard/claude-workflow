/**
 * Goal Command - CLI handler for the Goal Loop system
 *
 * Usage:
 *   claude-workflow goal "Make all tests pass"
 *   claude-workflow goal --file goals/payment-system.md
 *   claude-workflow goal --max-attempts 15 --timeout 2h "Implement OAuth2"
 *   claude-workflow goal --status
 *   claude-workflow goal --abort
 *   claude-workflow goal --resume
 *   claude-workflow goal --history
 *
 * @module commands/goal
 */

import { existsSync, readFileSync } from "node:fs";

import chalk from "chalk";

import { showWarning } from "../ui.js";
import {
  findResumableGoal,
  getActiveLockPid,
  listGoals,
  loadGoalState,
  markGoalAborted,
  resumeGoal,
} from "../goal/goal-state.js";
import type { GoalConfig, GoalState } from "../goal/goal-state.js";
import { GoalRunner } from "../goal/goal-runner.js";

// ============================================================================
// Types
// ============================================================================

interface GoalOptions {
  abort?: boolean;
  file?: string;
  goalText?: string;
  history?: boolean;
  maxAttempts?: number;
  model?: string;
  resume?: boolean;
  status?: boolean;
  timeoutMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

// ============================================================================
// Arg Parsing
// ============================================================================

/**
 * Parse goal command arguments
 */
function parseGoalArgs(args: string[]): GoalOptions {
  const options: GoalOptions = {};
  const textParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
    case "--status": {
      options.status = true;
      break;
    }
    case "--abort": {
      options.abort = true;
      break;
    }
    case "--resume": {
      options.resume = true;
      break;
    }
    case "--history": {
      options.history = true;
      break;
    }
    case "--file": {
      if (args[i + 1]) {
        options.file = args[++i];
      }
      break;
    }
    case "--max-attempts": {
      if (args[i + 1]) {
        options.maxAttempts = Number.parseInt(args[++i], 10);
      }
      break;
    }
    case "--model": {
      if (args[i + 1]) {
        options.model = args[++i];
      }
      break;
    }
    case "--timeout": {
      if (args[i + 1]) {
        options.timeoutMs = parseTimeout(args[++i]);
      }
      break;
    }
    default: {
      if (!arg.startsWith("--")) {
        textParts.push(arg);
      }
      break;
    }
    }
  }

  if (textParts.length > 0) {
    options.goalText = textParts.join(" ");
  }

  return options;
}

/**
 * Parse timeout string like "2h", "30m", "3600s", or raw seconds
 */
function parseTimeout(value: string): number {
  const match = /^(\d+)(h|m|s)?$/i.exec(value);
  if (!match) {
    console.error(chalk.red(`Invalid timeout: ${value}. Use format: 2h, 30m, 3600s, or seconds`));
    process.exit(1);
  }

  const num = Number.parseInt(match[1], 10);
  const unit = match[2]?.toLowerCase();

  switch (unit) {
  case "h": {
    return num * MS_PER_HOUR;
  }
  case "m": {
    return num * MS_PER_MINUTE;
  }
  case "s": {
    return num * MS_PER_SECOND;
  }
  default: {
    return num * MS_PER_SECOND;
  }
  }
}

// ============================================================================
// Subcommands
// ============================================================================

/**
 * Show current goal status
 */
function showStatus(): void {
  const state = loadGoalState();

  if (!state) {
    console.log(chalk.dim("No active goal."));
    console.log(chalk.dim("Use --history to see past goals."));
    return;
  }

  printGoalDetail(state);
}

/**
 * Show history of all goals
 */
function showHistory(): void {
  const goals = listGoals();

  if (goals.length === 0) {
    console.log(chalk.dim("No goals found."));
    return;
  }

  console.log(chalk.bold(`Goal History (${String(goals.length)} goals):\n`));

  for (const goal of goals) {
    const statusColor = getStatusColor(goal.status);
    const date = goal.created_at.slice(0, 10);
    const text = goal.goal_text.slice(0, 60);

    console.log(
      `  ${statusColor(goal.status.padEnd(12))} ${chalk.dim(date)}  ${text}${goal.goal_text.length > 60 ? "..." : ""}`,
    );
    console.log(
      `  ${" ".repeat(12)} ${chalk.dim(goal.goal_id)}  ${String(goal.current_attempt)} attempts`,
    );
    console.log();
  }
}

/**
 * Print detailed info about a single goal
 */
function printGoalDetail(state: GoalState): void {
  const elapsed = Date.now() - new Date(state.created_at).getTime();
  const minutes = Math.round(elapsed / MS_PER_MINUTE);
  const statusColor = getStatusColor(state.status);

  console.log(chalk.bold("Goal:"));
  console.log(`  ID: ${chalk.dim(state.goal_id)}`);
  console.log(`  Status: ${statusColor(state.status)}`);
  console.log(`  Text: ${state.goal_text.slice(0, 120)}`);
  const attemptsLabel = state.config.max_attempts === undefined
    ? String(state.current_attempt)
    : `${String(state.current_attempt)}/${String(state.config.max_attempts)}`;
  console.log(`  Attempts: ${attemptsLabel}`);
  console.log(`  Elapsed: ${String(minutes)} minutes`);

  const progress = state.cumulative_progress;
  if (progress.completed.length > 0) {
    console.log(`  Completed: ${String(progress.completed.length)} items`);
  }
  if (progress.in_progress.length > 0) {
    console.log(`  In Progress: ${progress.in_progress.join(", ")}`);
  }

  const lastAttempt = state.attempts.at(-1);
  if (lastAttempt) {
    console.log(chalk.bold("\nLast Attempt:"));
    console.log(`  Outcome: ${lastAttempt.outcome}`);
    console.log(`  Summary: ${lastAttempt.progress_summary.slice(0, 200)}`);
    if (lastAttempt.next_steps.length > 0) {
      console.log(`  Next Steps: ${lastAttempt.next_steps.slice(0, 3).join(", ")}`);
    }
  }
}

/**
 * Abort the current goal
 */
function abortGoal(): void {
  const state = loadGoalState();

  if (!state) {
    console.log(chalk.dim("No active goal to abort."));
    return;
  }

  if (state.status !== "in_progress") {
    console.log(chalk.dim(`Goal already ${state.status}.`));
    return;
  }

  markGoalAborted(state);
  console.log(chalk.yellow(`Goal aborted: ${state.goal_id}`));
  console.log(chalk.dim("Resume with: claude-workflow goal --resume"));
}

/**
 * Get chalk color function for a goal status
 */
function getStatusColor(status: string): (s: string) => string {
  switch (status) {
  case "completed": {
    return chalk.green;
  }
  case "in_progress": {
    return chalk.cyan;
  }
  case "aborted": {
    return chalk.yellow;
  }
  default: {
    return chalk.red;
  }
  }
}

// ============================================================================
// Main Entry
// ============================================================================

/**
 * Main goal command handler
 */
export async function goal(rawArgs: string[]): Promise<void> {
  const options = parseGoalArgs(rawArgs);

  // Subcommands
  if (options.status) {
    showStatus();
    return;
  }

  if (options.history) {
    showHistory();
    return;
  }

  if (options.abort) {
    abortGoal();
    return;
  }

  // Resume existing goal
  if (options.resume) {
    const resumable = findResumableGoal();
    if (!resumable) {
      console.error(chalk.red("No resumable goal found."));
      console.log(chalk.dim("Use --history to see past goals."));
      process.exit(1);
    }

    console.log(chalk.cyan(`Resuming goal: ${resumable.goal_id}`));
    console.log(chalk.dim(`  "${resumable.goal_text.slice(0, 80)}"`));
    console.log(chalk.dim(`  ${String(resumable.current_attempt)} attempts completed so far`));

    // Re-activate the goal
    resumeGoal(resumable);

    await GoalRunner.run({
      goalText: resumable.goal_text,
      resume: true,
    });
    return;
  }

  // Get goal text from file or arguments
  let goalText = options.goalText;

  if (options.file) {
    if (!existsSync(options.file)) {
      console.error(chalk.red(`File not found: ${options.file}`));
      process.exit(1);
    }
    goalText = readFileSync(options.file, "utf8").trim();
  }

  if (!goalText) {
    showGoalHelp();
    process.exit(1);
  }

  // Check for existing active goal with PID lock
  const lockPid = getActiveLockPid();
  if (lockPid !== null) {
    showWarning(
      `Another goal loop is actively running (PID ${String(lockPid)}).\n` +
        "Only one goal loop can run per project at a time.\n" +
        "Kill the other process first, or wait for it to finish.",
    );
    process.exit(1);
  }

  const existing = loadGoalState();
  if (existing && existing.status === "in_progress") {
    showWarning(
      `An active goal already exists: ${existing.goal_id}\n` +
        "Use --resume to continue it, or --abort to cancel it first.",
    );
    process.exit(1);
  }

  // Build config
  const config: Partial<GoalConfig> = {};
  if (options.maxAttempts) config.max_attempts = options.maxAttempts;
  if (options.timeoutMs) config.timeout_ms = options.timeoutMs;
  if (options.model) config.model = options.model;

  // Show warning about permissions
  showWarning(
    "Goal loop uses --dangerously-skip-permissions.\n" +
      "Claude will have full access to your system during each attempt.\n" +
      "Press Ctrl+C at any time to abort.",
  );

  // Run the goal
  await GoalRunner.run({ goalText, config });
}

/**
 * Show help for the goal command
 */
function showGoalHelp(): void {
  console.error(chalk.bold("Usage: claude-workflow goal [options] <goal text>"));
  console.error();
  console.error(chalk.bold("Run a goal:"));
  console.error('  claude-workflow goal "Make all tests pass"');
  console.error("  claude-workflow goal --file goals/payment-system.md");
  console.error('  claude-workflow goal --max-attempts 15 --timeout 2h "Implement OAuth2"');
  console.error();
  console.error(chalk.bold("Manage goals:"));
  console.error("  claude-workflow goal --status          Show current goal progress");
  console.error("  claude-workflow goal --history         Show all past goals");
  console.error("  claude-workflow goal --abort           Stop current goal");
  console.error("  claude-workflow goal --resume          Resume last incomplete goal");
  console.error();
  console.error(chalk.bold("Options:"));
  console.error("  --max-attempts <n>    Max claude -p attempts (default: unlimited)");
  console.error("  --timeout <duration>  Timeout: 2h, 30m, 3600s (default: 1h)");
  console.error("  --model <model>       Claude model to use");
  console.error("  --file <path>         Read goal text from file");
}
