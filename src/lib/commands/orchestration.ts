#!/usr/bin/env node

/**
 * Orchestration Analytics CLI Command
 *
 * Interactive analytics dashboard for agent orchestration workflows.
 * Provides insights into agent chaining patterns, success rates,
 * bottlenecks, and time-based performance metrics.
 *
 * Features:
 * - Real-time orchestration log parsing
 * - Interactive TUI with drill-down capabilities
 * - Agent chaining pattern analysis
 * - Success/failure rate tracking
 * - Time-based analytics (daily/weekly/monthly)
 * - Filtering by agent type, date range, outcome
 * - Visual reports with sparklines and progress bars
 * - Data export to JSON/CSV formats
 *
 * Usage:
 *   npx claude-workflow orchestration              # Interactive TUI mode
 *   npx claude-workflow orchestration --json      # JSON export
 *   npx claude-workflow orchestration --csv       # CSV export
 *   npx claude-workflow orchestration --days 7    # Last 7 days
 *   npx claude-workflow orchestration --filter task-maker
 */

import chalk from "chalk";

import { OrchestrationAnalyzer } from "../analytics/orchestration-analyzer.js";
import { createErrorLogger, ERROR_CATEGORIES, ERROR_CODES, type ErrorContext, OrchestrationError, withErrorHandling } from "../errors/orchestration-error.js";
import { generateOrchestrationHelp, validateOrchestrationOptions } from "../validation/orchestration-schemas.js";

interface AgentMetrics {
  successRate: number;
  total: number;
}

type AgentPerformance = Record<string, AgentMetrics>;



/** Day-based metric structure for future metrics expansion */
export interface DayMetric {
  date: string;
  successRate: number;
  workflows: number;
}

interface OrchestrationOptions {
  days: number | undefined;
  filter: string | undefined;
  format: "csv" | "json" | "text";
  session: string | undefined;
  verbose: boolean;
  watch: boolean;
}

interface OverallMetrics {
  agentPerformance: AgentPerformance | undefined;
  averageChainLength: number;
  successRate: number;
  totalWorkflows: number;
}


// Constants
const JSON_INDENT_SPACES = 2;

/**
 * Parse and validate command line arguments
 */
function parseArgs(args: string[]): OrchestrationOptions {
  const rawOptions: OrchestrationOptions = {
    days: undefined, // Filter to last N days
    filter: undefined, // Filter by agent type or outcome
    format: "text", // text, json, csv
    session: undefined, // Filter by session ID
    verbose: false,
    watch: false // Watch mode for real-time updates
  };

  // Parse raw arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {

      console.log("Orchestration Analytics CLI");

      console.log(generateOrchestrationHelp());



      process.exit(0);
    }

    if (args[i] === "--json") rawOptions.format = "json";
    if (args[i] === "--csv") rawOptions.format = "csv";
    if (args[i] === "--verbose" || args[i] === "-v") rawOptions.verbose = true;
    if (args[i] === "--watch" || args[i] === "-w") rawOptions.watch = true;
    if (args[i] === "--days" && args[i + 1] !== undefined) {
      const nextArg = args[i + 1];
      if (nextArg !== undefined) {
        const parsedDays = Number.parseInt(nextArg, 10);
        rawOptions.days = Number.isNaN(parsedDays) ? undefined : parsedDays;
      }
      i++;
    }
    if (args[i] === "--filter" && args[i + 1] !== undefined) {
      rawOptions.filter = args[i + 1] ?? undefined;
      i++;
    }
    if (args[i] === "--session" && args[i + 1] !== undefined) {
      rawOptions.session = args[i + 1] ?? undefined;
      i++;
    }
  }

  // Validate parsed options
   
  const validation = validateOrchestrationOptions(rawOptions as unknown as Record<string, boolean | number | string | undefined>);

  if (!validation.valid) {

    console.error(chalk.red("Invalid arguments:"));
    for (const error of validation.errors) {

      console.error(chalk.red(`  • ${error}`));
    }

    console.error();

    console.error(chalk.yellow("Use --help for usage information."));



    process.exit(1);
  }

  // Display warnings
  if (Array.isArray(validation.warnings) && validation.warnings.length > 0) {
    for (const warning of validation.warnings) {

      console.warn(chalk.yellow(`Warning: ${warning}`));
    }
  }


  return validation.normalized as unknown as OrchestrationOptions;
}

const logError = createErrorLogger((_hookName: string, eventName: string, data: ErrorContext) => {

  console.error(`[Orchestration CLI] ${eventName}:`, data);
});

/**
 * Launch orchestration analytics dashboard
 * @param {OrchestrationOptions} options - Command options
 */
export async function orchestration(options: Partial<OrchestrationOptions> = {}): Promise<void> {
  await withErrorHandling(
    async () => {

      const parsedOptions = parseArgs(process.argv.slice(JSON_INDENT_SPACES));
      const finalOptions = { ...parsedOptions, ...options };

      // Validate command line options
      await withErrorHandling(
        () => Promise.resolve(validateOrchestrationOptions(finalOptions)),
        {
          category: ERROR_CATEGORIES.VALIDATION,
          code: ERROR_CODES.INVALID_CLI_ARGS,
          context: { args: process.argv.slice(JSON_INDENT_SPACES).join(" ") },
          operation: "validateOrchestrationOptions"
        }
      );

      const analyzer = new OrchestrationAnalyzer();

      // Parse orchestration logs and build analytics data
      const parseOptions: Record<string, boolean | number | string> = { format: finalOptions.format, verbose: finalOptions.verbose, watch: finalOptions.watch };
      if (finalOptions.days !== undefined) parseOptions.days = finalOptions.days;
      if (finalOptions.filter !== undefined) parseOptions.filter = finalOptions.filter;
      if (finalOptions.session !== undefined) parseOptions.session = finalOptions.session;

      await withErrorHandling(
        () => analyzer.parseLogs(parseOptions),
        {
          category: ERROR_CATEGORIES.PARSING,
          code: ERROR_CODES.LOG_FILE_PARSE_ERROR,
          context: { options: parseOptions },
          operation: "parseOrchestrationLogs"
        }
      );

      if (finalOptions.format === "json") {
        // Export data as JSON and exit
        const exportOptions: Record<string, boolean | number | string> = {};
        if (finalOptions.days !== undefined) exportOptions.days = finalOptions.days;
        if (finalOptions.filter !== undefined) exportOptions.filter = finalOptions.filter;
        if (finalOptions.session !== undefined) exportOptions.session = finalOptions.session;

        const data = await withErrorHandling(
          () => Promise.resolve(analyzer.exportData("json", exportOptions)),
          {
            category: ERROR_CATEGORIES.IO,
            code: ERROR_CODES.FILE_READ_ERROR,
            context: { format: "json" },
            operation: "exportJSONData"
          }
        );

        console.log(JSON.stringify(data, undefined, JSON_INDENT_SPACES));
        return;
      }

      if (finalOptions.format === "csv") {
        // Export data as CSV and exit
        const exportOptions: Record<string, boolean | number | string> = {};
        if (finalOptions.days !== undefined) exportOptions.days = finalOptions.days;
        if (finalOptions.filter !== undefined) exportOptions.filter = finalOptions.filter;
        if (finalOptions.session !== undefined) exportOptions.session = finalOptions.session;

        const data = await withErrorHandling(
          () => Promise.resolve(analyzer.exportData("csv", exportOptions)),
          {
            category: ERROR_CATEGORIES.IO,
            code: ERROR_CODES.FILE_READ_ERROR,
            context: { format: "csv" },
            operation: "exportCSVData"
          }
        );

        console.log(data);
        return;
      }

      // Check if we have any data before launching TUI
      const metrics = analyzer.getOverallMetrics();
      if ((metrics as OverallMetrics).totalWorkflows === 0) {

        console.log(chalk.yellow("No orchestration data found."));

        console.log(chalk.gray("Agent orchestration logs will appear here once agents start producing JSON output."));

        console.log(chalk.gray("Make sure the agent-orchestrator hook is enabled and agents are using structured JSON output."));
        return;
      }

      // Display text summary
      const overall = analyzer.getOverallMetrics() as OverallMetrics;
      console.log(chalk.bold("\n=== Orchestration Analytics ===\n"));
      console.log(chalk.bold("Overall Metrics:"));
      console.log(`Total Workflows: ${chalk.cyan(String(overall.totalWorkflows))}`);
      console.log(`Success Rate: ${chalk.green(`${overall.successRate.toFixed(1)}%`)}`);
      console.log(`Avg Chain Length: ${chalk.cyan(overall.averageChainLength.toFixed(1))}`);

      if (overall.agentPerformance) {
        console.log(chalk.bold("\nAgent Performance:"));
        for (const [agentType, metrics] of Object.entries(overall.agentPerformance)) {
          console.log(`  ${chalk.yellow(agentType)}: ${chalk.green(`${metrics.successRate.toFixed(1)}%`)} (${metrics.total} workflows)`);
        }
      }

      const patterns = analyzer.getChainingPatterns();
      if (patterns.length > 0) {
        console.log(chalk.bold("\nTop Agent Chains:"));
        let idx = 0;
        for (const pattern of patterns.slice(0, 5)) {
          const chainStr = pattern.chain.join(" → ");
          console.log(`  ${idx + 1}. ${chainStr}`);
          console.log(`     ${chalk.yellow(`${pattern.frequency}×`)} ${chalk.green(`${pattern.successRate.toFixed(1)}%`)} success\n`);
          idx++;
        }
      }

      console.log(chalk.gray("\nFor detailed analytics, use:"));
      console.log(chalk.gray("  --json    Export JSON data"));
      console.log(chalk.gray("  --csv     Export CSV data"));
    },
    {
      category: ERROR_CATEGORIES.SYSTEM,
      code: ERROR_CODES.UNKNOWN_ERROR,
      context: { command: "orchestration" },
      fallback: () => {



        process.exit(1);
      },
      onError: (error: OrchestrationError) => {
        logError(error, {
          command: "orchestration",
          component: "Orchestration CLI"
        });

        console.error(chalk.red("Error launching orchestration analytics:"), error.getUserMessage());

        console.error(chalk.gray(`Correlation ID: ${error.correlationId}`));
      },
      operation: "orchestrationCLI"
    }
  );
}

// Allow direct execution: node lib/commands/orchestration.js
// Only run when executed directly, not when imported as part of a bundle

if (process.argv[1] !== undefined && (process.argv[1].endsWith("orchestration.js") || process.argv[1].endsWith("orchestration.ts"))) {
   
  await orchestration().catch((caughtError) => {
    const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
    const orchError = OrchestrationError.fromError(error, {
      category: ERROR_CATEGORIES.SYSTEM,
      context: { executionMode: "direct", script: "orchestration.js" },
      operation: "directExecution"
    });

    logError(orchError, {
      component: "Orchestration CLI",
      execution: "direct"
    });

    console.error(chalk.red("Error starting orchestration analytics:"), orchError.getUserMessage());

    console.error(chalk.gray(`Correlation ID: ${orchError.correlationId}`));



    process.exit(1);
  });
}
