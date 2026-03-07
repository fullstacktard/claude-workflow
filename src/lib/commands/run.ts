/**
 * Run Command - CLI handler for headless workflow execution
 *
 * Usage:
 *   claude-workflow run <workflow-name> "description"
 *   claude-workflow run feature-development "Build OAuth2 login"
 *   claude-workflow run lint-fix "Fix all TypeScript errors"
 *   claude-workflow run --list                    # List available workflows
 *   claude-workflow run --status <workflow-name>  # Show run status
 *   claude-workflow run --resume <workflow-name>  # Resume interrupted run
 *
 * @module commands/run
 */

import chalk from "chalk";

import { showWarning } from "../ui.js";
import { getWorkflowEngine } from "../workflow/workflow-engine.js";
import { WorkflowRunner, loadWorkflowRunState } from "../workflow/workflow-runner.js";

// ============================================================================
// Types
// ============================================================================

interface RunOptions {
  description?: string;
  list?: boolean;
  maxBudgetUsd?: number;
  model?: string;
  resume?: boolean;
  status?: boolean;
  timeoutMs?: number;
  workflowName?: string;
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

function parseRunArgs(args: string[]): RunOptions {
  const options: RunOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
    case "--list":
    case "-l": {
      options.list = true;
      break;
    }
    case "--status":
    case "-s": {
      options.status = true;
      break;
    }
    case "--resume":
    case "-r": {
      options.resume = true;
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
    case "--max-budget": {
      if (args[i + 1]) {
        options.maxBudgetUsd = Number.parseFloat(args[++i]);
      }
      break;
    }
    default: {
      if (!arg.startsWith("--")) {
        positional.push(arg);
      }
      break;
    }
    }
  }

  // First positional is workflow name, rest is description
  if (positional.length > 0) {
    options.workflowName = positional[0];
  }
  if (positional.length > 1) {
    options.description = positional.slice(1).join(" ");
  }

  return options;
}

/**
 * Parse timeout string like "2h", "30m", "3600s", or raw seconds
 */
function parseTimeout(value: string): number {
  const match = /^(\d+)(h|m|s)?$/i.exec(value);
  if (!match) {
    console.error(
      chalk.red(
        `Invalid timeout: ${value}. Use format: 2h, 30m, 3600s, or seconds`,
      ),
    );
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
 * List all available workflows
 */
function listWorkflows(): void {
  const engine = getWorkflowEngine();
  const names = engine.listWorkflows();

  if (names.length === 0) {
    console.log(chalk.dim("No workflows found."));
    console.log(chalk.dim("Run 'claude-workflow init' to set up workflows."));
    return;
  }

  console.log(chalk.bold(`Available Workflows (${String(names.length)}):\n`));

  for (const name of names.sort()) {
    const workflow = engine.getWorkflow(name);
    if (!workflow) continue;

    const phaseCount = workflow.phases.length;
    const agents = [...new Set(workflow.phases.map((p) => p.agent))];
    const desc = workflow.description
      .split("\n")[0]
      .trim()
      .slice(0, 80);

    console.log(`  ${chalk.cyan(name)}`);
    console.log(
      chalk.dim(
        `    ${String(phaseCount)} phases | agents: ${agents.join(", ")}`,
      ),
    );
    console.log(chalk.dim(`    ${desc}`));
    console.log();
  }
}

/**
 * Show status of a workflow run
 */
function showRunStatus(workflowName: string): void {
  const state = loadWorkflowRunState(workflowName);

  if (!state) {
    console.log(chalk.dim(`No run found for workflow: ${workflowName}`));
    return;
  }

  const statusColor =
    state.status === "completed"
      ? chalk.green
      : (state.status === "in_progress"
        ? chalk.cyan
        : chalk.red);

  const elapsed =
    new Date(state.updated_at).getTime() -
    new Date(state.created_at).getTime();
  const minutes = Math.round(elapsed / MS_PER_MINUTE);

  console.log(chalk.bold("Workflow Run:"));
  console.log(`  ID: ${chalk.dim(state.run_id)}`);
  console.log(`  Workflow: ${state.workflow_name}`);
  console.log(`  Status: ${statusColor(state.status)}`);
  console.log(`  Description: ${state.description.slice(0, 120)}`);
  console.log(
    `  Progress: ${String(state.completed_phases.length)} phases completed`,
  );
  console.log(`  Duration: ${String(minutes)} minutes`);

  if (state.completed_phases.length > 0) {
    console.log(chalk.bold("\nPhases:"));
    for (const phase of state.completed_phases) {
      const icon =
        phase.status === "complete" ? chalk.green("✓") : chalk.red("✗");
      console.log(
        `  ${icon} ${phase.phase_id}: ${phase.status} (${String(phase.attempts)} attempt${phase.attempts > 1 ? "s" : ""})`,
      );
      if (phase.raw_summary) {
        console.log(chalk.dim(`    ${phase.raw_summary.slice(0, 150)}`));
      }
    }
  }
}

// ============================================================================
// Main Entry
// ============================================================================

/**
 * Main run command handler
 */
export async function run(rawArgs: string[]): Promise<void> {
  const options = parseRunArgs(rawArgs);

  // Subcommands
  if (options.list) {
    listWorkflows();
    return;
  }

  if (options.status) {
    if (!options.workflowName) {
      console.error(chalk.red("Specify a workflow name: claude-workflow run --status <name>"));
      process.exit(1);
    }
    showRunStatus(options.workflowName);
    return;
  }

  // Resume existing run
  if (options.resume) {
    if (!options.workflowName) {
      console.error(
        chalk.red("Specify a workflow name: claude-workflow run --resume <name>"),
      );
      process.exit(1);
    }

    await WorkflowRunner.run({
      description: "", // Will be loaded from state
      resume: true,
      workflowName: options.workflowName,
    });
    return;
  }

  // New workflow run
  if (!options.workflowName) {
    showRunHelp();
    process.exit(1);
  }

  if (!options.description) {
    console.error(
      chalk.red("Provide a description of what to do:"),
    );
    console.error(
      chalk.dim(
        `  claude-workflow run ${options.workflowName} "Build the authentication system"`,
      ),
    );
    process.exit(1);
  }

  // Show warning about permissions
  showWarning(
    "Headless workflow uses --dangerously-skip-permissions.\n" +
      "Claude will have full access to your system during each phase.\n" +
      "Press Ctrl+C at any time to abort.",
  );

  await WorkflowRunner.run({
    description: options.description,
    maxBudgetUsd: options.maxBudgetUsd,
    model: options.model,
    timeoutMs: options.timeoutMs,
    workflowName: options.workflowName,
  });
}

/**
 * Show help for the run command
 */
function showRunHelp(): void {
  console.error(
    chalk.bold("Usage: claude-workflow run <workflow-name> <description>"),
  );
  console.error();
  console.error(chalk.bold("Run a workflow:"));
  console.error(
    '  claude-workflow run feature-development "Build OAuth2 login"',
  );
  console.error(
    '  claude-workflow run lint-fix "Fix all TypeScript errors"',
  );
  console.error(
    '  claude-workflow run qa-testing "Test the payment flow"',
  );
  console.error();
  console.error(chalk.bold("Manage runs:"));
  console.error(
    "  claude-workflow run --list                    List available workflows",
  );
  console.error(
    "  claude-workflow run --status <name>           Show run progress",
  );
  console.error(
    "  claude-workflow run --resume <name>           Resume interrupted run",
  );
  console.error();
  console.error(chalk.bold("Options:"));
  console.error(
    "  --timeout <duration>  Timeout: 2h, 30m, 3600s (default: 1h)",
  );
  console.error("  --model <model>       Claude model to use");
  console.error("  --max-budget <usd>    Max budget per phase in USD");
}
