/**
 * Workflow Prompt Builder - Constructs per-phase prompts for headless workflow execution
 *
 * Each phase runs as a separate `claude -p` invocation with fresh context.
 * This module builds self-contained prompts that include:
 * - Agent role and phase instructions
 * - Previous phase results (for context continuity)
 * - User's original description/goal
 * - Completion signal instructions (PHASE_COMPLETE + output JSON)
 *
 * @module workflow/workflow-prompt-builder
 */

import type { WorkflowPhase } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface PhasePromptContext {
  /** Agent type for this phase (e.g., "lint-resolution-planner") */
  agentType: string;
  /** Current phase attempt number (for retries) */
  attemptNumber: number;
  /** Max iterations allowed for this phase */
  maxIterations: number;
  /** Phase configuration from workflow YAML */
  phase: WorkflowPhase;
  /** Previous phase results (if any) */
  previousResults: PreviousPhaseResult | null;
  /** Total number of phases in this workflow */
  totalPhases: number;
  /** User's original description/request */
  userDescription: string;
  /** Name of the workflow being executed */
  workflowName: string;
}

export interface PreviousPhaseResult {
  /** Agent type that ran */
  agentType: string;
  /** Output data from previous phase */
  output: unknown;
  /** Phase ID */
  phaseId: string;
  /** Human-readable summary */
  summary: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_PREVIOUS_OUTPUT_CHARS = 3000;
const MAX_DESCRIPTION_CHARS = 2000;

// ============================================================================
// Builder
// ============================================================================

/**
 * Build the prompt for a single phase invocation
 */
export function buildPhasePrompt(ctx: PhasePromptContext): string {
  const sections: string[] = [];

  // Header with workflow context
  sections.push(
    `You are a ${ctx.agentType} agent executing phase "${ctx.phase.id}" of the "${ctx.workflowName}" workflow.` +
      (ctx.phase.description ? ` Phase goal: ${ctx.phase.description}` : ""),
  );

  // User's original request
  const description =
    ctx.userDescription.length > MAX_DESCRIPTION_CHARS
      ? ctx.userDescription.slice(0, MAX_DESCRIPTION_CHARS) + "..."
      : ctx.userDescription;
  sections.push(`## USER REQUEST\n${description}`);

  // Previous phase results (if any)
  if (ctx.previousResults) {
    sections.push(formatPreviousResults(ctx.previousResults));
  }

  // Phase-specific context from YAML
  if (ctx.phase.description) {
    sections.push(`## YOUR TASK\n${ctx.phase.description}`);
  }

  // Retry context
  if (ctx.attemptNumber > 1) {
    sections.push(
      `## RETRY CONTEXT\nThis is attempt ${String(ctx.attemptNumber)}/${String(ctx.maxIterations)} for this phase. ` +
        "Previous attempts did not fully complete. Focus on resolving any blockers from prior runs.",
    );
  }

  // Completion instructions
  sections.push(buildCompletionInstructions(ctx));

  return sections.join("\n\n");
}

/**
 * Format previous phase results for inclusion in prompt
 */
function formatPreviousResults(prev: PreviousPhaseResult): string {
  const lines: string[] = [
    `## PREVIOUS PHASE RESULTS`,
    `Phase: ${prev.phaseId} (${prev.agentType})`,
  ];

  if (prev.summary) {
    lines.push(`Summary: ${prev.summary}`);
  }

  if (prev.output !== null && prev.output !== undefined) {
    let outputStr: string;
    if (typeof prev.output === "string") {
      outputStr = prev.output;
    } else {
      try {
        outputStr = JSON.stringify(prev.output, null, 2);
      } catch {
        outputStr = String(prev.output);
      }
    }

    if (outputStr.length > MAX_PREVIOUS_OUTPUT_CHARS) {
      outputStr = outputStr.slice(0, MAX_PREVIOUS_OUTPUT_CHARS) + "\n... (truncated)";
    }

    lines.push(`\nOutput data:\n\`\`\`json\n${outputStr}\n\`\`\``);
  }

  return lines.join("\n");
}

/**
 * Build completion signal instructions
 */
function buildCompletionInstructions(ctx: PhasePromptContext): string {
  const nextPhase = ctx.phase.next;
  const hasNextPhase = nextPhase !== null;

  return `## COMPLETION INSTRUCTIONS
1. Complete your assigned task thoroughly
2. When finished, output exactly: PHASE_COMPLETE
3. Output a structured result JSON block in a code fence:
\`\`\`json
{"status":"complete|partial|blocked|failed","summary":"what you accomplished","files_modified":["file1.ts"],"result_count":1,"results":null,"blockers":[]}
\`\`\`
4. The "result_count" field is important - it tells the next phase how many agents to spawn${hasNextPhase ? `\n5. Your output feeds into the next phase: "${nextPhase}"` : "\n5. This is the final phase of the workflow"}
6. If you cannot complete the task, set status to "blocked" or "failed" with details in "blockers"`;
}
