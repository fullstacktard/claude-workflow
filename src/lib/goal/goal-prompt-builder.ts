/**
 * Goal Prompt Builder - Constructs per-attempt prompts for the Goal Loop
 *
 * Each `claude -p` invocation gets a fresh context. This module builds
 * a self-contained prompt that includes the goal, cumulative progress,
 * key decisions, and the last attempt's summary/next steps.
 *
 * Keeps prompt under ~4000 chars by truncating attempt history to
 * last 3 (with 1-line summaries of older ones).
 *
 * @module goal/goal-prompt-builder
 */

import type { GoalAttempt, GoalState } from "./goal-state.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_GOAL_TEXT_CHARS = 500;
const MAX_RECENT_ATTEMPTS = 3;
const MAX_LIST_ITEMS = 10;

// ============================================================================
// Builder
// ============================================================================

/**
 * Build the prompt for a goal attempt
 */
export function buildGoalPrompt(state: GoalState, attemptNumber: number): string {
  const sections: string[] = [];

  // Header
  const attemptLabel = state.config.max_attempts === undefined
    ? `Attempt ${String(attemptNumber)}.`
    : `Attempt ${String(attemptNumber)}/${String(state.config.max_attempts)}.`;
  sections.push(`You are working toward a persistent goal. ${attemptLabel}`);

  // Goal text
  const goalText =
    state.goal_text.length > MAX_GOAL_TEXT_CHARS
      ? state.goal_text.slice(0, MAX_GOAL_TEXT_CHARS) + "..."
      : state.goal_text;

  sections.push(`## THE GOAL\n${goalText}`);

  // Cumulative progress
  const progress = state.cumulative_progress;
  const progressLines: string[] = [];

  if (progress.completed.length > 0) {
    progressLines.push(
      `Completed:\n${formatList(progress.completed)}`,
    );
  }
  if (progress.in_progress.length > 0) {
    progressLines.push(
      `In Progress:\n${formatList(progress.in_progress)}`,
    );
  }
  if (progress.not_started.length > 0) {
    progressLines.push(
      `Not Started:\n${formatList(progress.not_started)}`,
    );
  }

  if (progressLines.length > 0) {
    sections.push(`## PROGRESS SO FAR\n${progressLines.join("\n\n")}`);
  }

  // Key decisions
  if (progress.key_decisions.length > 0) {
    sections.push(
      `## KEY DECISIONS (do not re-litigate)\n${formatList(progress.key_decisions)}`,
    );
  }

  // Attempt history
  if (state.attempts.length > 0) {
    sections.push(formatAttemptHistory(state.attempts));
  }

  // Instructions
  sections.push(`## INSTRUCTIONS
1. Focus on the next_steps from the previous attempt (if any)
2. Do not repeat completed work
3. If you finish the goal entirely, output exactly: GOAL_COMPLETE
4. Before your turn ends, output a progress JSON block in a code fence:
\`\`\`json
{"status":"complete|partial|blocked","summary":"what you did","files_modified":["file1.ts"],"decisions":["chose X over Y"],"blockers":["need API key"],"next_steps":["implement feature Y","add tests"]}
\`\`\`
5. The progress JSON is critical - it carries your work forward to the next attempt`);

  return sections.join("\n\n");
}

/**
 * Format a list of items with bullet points, capped at MAX_LIST_ITEMS
 */
function formatList(items: string[]): string {
  const capped = items.slice(0, MAX_LIST_ITEMS);
  const lines = capped.map((item) => `- ${item}`);
  if (items.length > MAX_LIST_ITEMS) {
    lines.push(`- ... and ${String(items.length - MAX_LIST_ITEMS)} more`);
  }
  return lines.join("\n");
}

/**
 * Format attempt history, showing full detail for recent attempts
 * and 1-line summaries for older ones
 */
function formatAttemptHistory(attempts: GoalAttempt[]): string {
  const lines: string[] = ["## PREVIOUS ATTEMPTS"];

  // Older attempts get 1-line summaries
  if (attempts.length > MAX_RECENT_ATTEMPTS) {
    const olderAttempts = attempts.slice(0, -MAX_RECENT_ATTEMPTS);
    lines.push("### Earlier Attempts (summary)");
    for (const attempt of olderAttempts) {
      lines.push(
        `- Attempt ${String(attempt.attempt_number)}: ${attempt.outcome} - ${attempt.progress_summary.slice(0, 100)}`,
      );
    }
    lines.push("");
  }

  // Recent attempts get full detail
  const recentAttempts = attempts.slice(-MAX_RECENT_ATTEMPTS);
  for (const attempt of recentAttempts) {
    lines.push(formatAttemptDetail(attempt));
  }

  return lines.join("\n");
}

/**
 * Format a single attempt with full detail
 */
function formatAttemptDetail(attempt: GoalAttempt): string {
  const parts: string[] = [
    `### Attempt ${String(attempt.attempt_number)}`,
    `Outcome: ${attempt.outcome}`,
    `Summary: ${attempt.progress_summary}`,
  ];

  if (attempt.files_modified.length > 0) {
    parts.push(`Files Modified: ${attempt.files_modified.join(", ")}`);
  }

  if (attempt.blockers.length > 0) {
    parts.push(`Blockers: ${attempt.blockers.join(", ")}`);
  }

  if (attempt.next_steps.length > 0) {
    parts.push(`Next Steps:\n${attempt.next_steps.map((s) => `  - ${s}`).join("\n")}`);
  }

  return parts.join("\n");
}

// ============================================================================
// Verification Prompt
// ============================================================================

/**
 * Build a read-only verification prompt for the verifier session.
 *
 * The verifier inspects project state against the original goal
 * and outputs GOAL_VERIFIED or GOAL_NOT_VERIFIED with issues.
 */
export function buildVerificationPrompt(state: GoalState): string {
  const sections: string[] = [];

  // Role
  sections.push(`You are a read-only verification inspector. You must NOT implement, fix, or modify anything.
Your only job is to verify whether the claimed work actually achieves the goal.`);

  // Goal
  const goalText =
    state.goal_text.length > MAX_GOAL_TEXT_CHARS
      ? state.goal_text.slice(0, MAX_GOAL_TEXT_CHARS) + "..."
      : state.goal_text;
  sections.push(`## THE GOAL\n${goalText}`);

  // Claimed work from last attempt
  const lastAttempt = state.attempts.at(-1);
  if (lastAttempt) {
    const claimedParts: string[] = [
      `## CLAIMED WORK (from attempt ${String(lastAttempt.attempt_number)})`,
      `Summary: ${lastAttempt.progress_summary}`,
    ];

    if (lastAttempt.files_modified.length > 0) {
      claimedParts.push(`Files Modified:\n${lastAttempt.files_modified.map((f) => `- ${f}`).join("\n")}`);
    }

    if (lastAttempt.decisions_made.length > 0) {
      claimedParts.push(`Decisions:\n${lastAttempt.decisions_made.map((d) => `- ${d}`).join("\n")}`);
    }

    sections.push(claimedParts.join("\n"));
  }

  // Cumulative completed items
  if (state.cumulative_progress.completed.length > 0) {
    sections.push(
      `## ALL COMPLETED ITEMS\n${formatList(state.cumulative_progress.completed)}`,
    );
  }

  // Verification instructions
  sections.push(`## VERIFICATION INSTRUCTIONS
1. Read the modified files listed above to confirm the changes exist
2. Run \`npm test\` to verify tests pass (if the goal involves code changes)
3. Run \`npm run typecheck\` to verify there are no type errors (if TypeScript)
4. Compare what was done against THE GOAL - does it actually fulfill the requirements?
5. Check for obvious gaps: missing features, broken imports, placeholder code

## OUTPUT FORMAT
If all checks pass, output exactly: GOAL_VERIFIED

If any checks fail, output exactly: GOAL_NOT_VERIFIED
Then output a JSON block with the issues:
\`\`\`json
{"issues":["test suite fails with 2 errors","missing error handling in api.ts"],"summary":"Tests fail and error handling incomplete"}
\`\`\`

You MUST output either GOAL_VERIFIED or GOAL_NOT_VERIFIED. No other outcome is valid.`);

  return sections.join("\n\n");
}
