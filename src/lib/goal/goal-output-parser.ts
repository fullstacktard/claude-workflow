/**
 * Goal Output Parser - Parse stream-json output from `claude -p`
 *
 * Parses `--output-format stream-json` (one JSON object per line):
 * - Scans `type: "assistant"` messages for `GOAL_COMPLETE` string
 * - Extracts progress JSON from code blocks in assistant output
 * - Detects rate limits from error/result messages
 *
 * @module goal/goal-output-parser
 */

import type { AttemptOutcome } from "./goal-state.js";

// ============================================================================
// Types
// ============================================================================

/** A content block inside an assistant message */
interface ContentBlock {
  text?: string;
  type: string;
}

/** A single line from stream-json output */
interface StreamJsonLine {
  content?: string;
  content_block_type?: string;
  duration_ms?: number;
  message?: {
    content?: ContentBlock[];
    role?: string;
  } | string;
  result?: string;
  role?: string;
  subtype?: string;
  type: string;
}

/** Parsed progress block from assistant output */
export interface ProgressBlock {
  blockers: string[];
  decisions: string[];
  files_modified: string[];
  next_steps: string[];
  status: "blocked" | "complete" | "partial";
  summary: string;
}

/** Result of parsing all output from a claude -p run */
export interface ParsedOutput {
  goalComplete: boolean;
  outcome: AttemptOutcome;
  progressBlock: ProgressBlock | null;
  rateLimited: boolean;
  rawText: string;
}

/** Result of parsing verification session output */
export interface VerificationResult {
  verified: boolean;
  issues: string[];
  summary: string;
}

// ============================================================================
// Rate Limit Detection Patterns
// ============================================================================

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /quota exceeded/i,
  /overloaded/i,
  /capacity/i,
];

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a complete stream-json output string
 *
 * Each line is a JSON object. We accumulate assistant text content
 * and scan for GOAL_COMPLETE and progress JSON blocks.
 */
export function parseStreamOutput(rawOutput: string): ParsedOutput {
  const result: ParsedOutput = {
    goalComplete: false,
    outcome: "partial",
    progressBlock: null,
    rateLimited: false,
    rawText: "",
  };

  const textParts: string[] = [];

  for (const line of rawOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: StreamJsonLine;
    try {
      parsed = JSON.parse(trimmed) as StreamJsonLine;
    } catch {
      // Not JSON - might be raw text from stderr
      if (isRateLimited(trimmed)) {
        result.rateLimited = true;
      }
      continue;
    }

    // Collect assistant text content
    // stream-json format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
    if (parsed.type === "assistant" && parsed.message && typeof parsed.message === "object") {
      const contentBlocks = parsed.message.content;
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }
      }
    }

    // Also check result messages which contain the full text
    // stream-json format: {"type":"result","result":"...full text..."}
    if (parsed.type === "result") {
      if (parsed.result) {
        textParts.push(parsed.result);
      }
      const msg = (typeof parsed.message === "string" ? parsed.message : parsed.result) ?? parsed.content ?? "";
      if (isRateLimited(msg)) {
        result.rateLimited = true;
      }
    }

    // Check error messages for rate limits
    if (parsed.type === "error") {
      const msg = (typeof parsed.message === "string" ? parsed.message : "") || parsed.content || "";
      if (isRateLimited(msg)) {
        result.rateLimited = true;
      }
    }
  }

  result.rawText = textParts.join("");

  // Check for GOAL_COMPLETE
  if (result.rawText.includes("GOAL_COMPLETE")) {
    result.goalComplete = true;
    result.outcome = "complete";
  }

  // Extract progress JSON block
  result.progressBlock = extractProgressBlock(result.rawText);

  // Determine outcome
  if (result.rateLimited) {
    result.outcome = "rate_limited";
  } else if (result.goalComplete) {
    result.outcome = "complete";
  } else if (result.progressBlock) {
    result.outcome = mapProgressStatus(result.progressBlock.status);
  }

  return result;
}

/**
 * Extract a progress JSON block from assistant text
 * Looks for JSON in code fences or bare JSON matching the progress schema
 */
function extractProgressBlock(text: string): ProgressBlock | null {
  // Try to find JSON in code fences first
  const codeFenceRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?"status"\s*:\s*"(?:complete|partial|blocked)"[\s\S]*?\})\s*\n?\s*```/g;
  let match = codeFenceRegex.exec(text);

  if (match?.[1]) {
    const parsed = tryParseProgress(match[1]);
    if (parsed) return parsed;
  }

  // Fallback: try to find bare JSON with the status field
  const bareJsonRegex = /\{[^{}]*"status"\s*:\s*"(?:complete|partial|blocked)"[^{}]*\}/g;
  match = bareJsonRegex.exec(text);

  if (match?.[0]) {
    const parsed = tryParseProgress(match[0]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Try to parse a string as a ProgressBlock
 */
function tryParseProgress(json: string): ProgressBlock | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;

    if (
      typeof obj.status === "string" &&
      (obj.status === "complete" || obj.status === "partial" || obj.status === "blocked")
    ) {
      return {
        blockers: toStringArray(obj.blockers),
        decisions: toStringArray(obj.decisions),
        files_modified: toStringArray(obj.files_modified),
        next_steps: toStringArray(obj.next_steps),
        status: obj.status,
        summary: typeof obj.summary === "string" ? obj.summary : "",
      };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

/**
 * Safely convert unknown value to string array
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Check if a string contains rate limit indicators
 */
function isRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Map progress status to attempt outcome
 */
function mapProgressStatus(status: "blocked" | "complete" | "partial"): AttemptOutcome {
  switch (status) {
  case "complete": {
    return "complete";
  }
  case "blocked": {
    return "blocked";
  }
  case "partial": {
    return "partial";
  }
  }
}

// ============================================================================
// Verification Output Parser
// ============================================================================

/**
 * Parse verification session output for GOAL_VERIFIED / GOAL_NOT_VERIFIED signals
 *
 * Reuses the stream-json text extraction from parseStreamOutput, then scans
 * for verification signals and an issues JSON block.
 */
export function parseVerificationOutput(rawOutput: string): VerificationResult {
  // Extract text using the same stream-json logic
  const textParts: string[] = [];

  for (const line of rawOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: StreamJsonLine;
    try {
      parsed = JSON.parse(trimmed) as StreamJsonLine;
    } catch {
      continue;
    }

    if (parsed.type === "assistant" && parsed.message && typeof parsed.message === "object") {
      const contentBlocks = parsed.message.content;
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }
      }
    }

    if (parsed.type === "result" && parsed.result) {
      textParts.push(parsed.result);
    }
  }

  const fullText = textParts.join("");

  // Check for verification signals
  const verified = fullText.includes("GOAL_VERIFIED") && !fullText.includes("GOAL_NOT_VERIFIED");

  // Extract issues JSON block: {"issues":[...],"summary":"..."}
  const issuesBlock = extractVerificationBlock(fullText);

  return {
    verified,
    issues: issuesBlock?.issues ?? [],
    summary: issuesBlock?.summary ?? (verified ? "Verification passed" : "Verification failed"),
  };
}

/**
 * Extract verification issues JSON from verifier text output
 */
function extractVerificationBlock(text: string): { issues: string[]; summary: string } | null {
  // Try code-fenced JSON first
  const codeFenceRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?"issues"\s*:[\s\S]*?\})\s*\n?\s*```/g;
  let match = codeFenceRegex.exec(text);

  if (match?.[1]) {
    const parsed = tryParseVerification(match[1]);
    if (parsed) return parsed;
  }

  // Fallback: bare JSON with "issues" key
  const bareJsonRegex = /\{[^{}]*"issues"\s*:\s*\[[\s\S]*?\][^{}]*\}/g;
  match = bareJsonRegex.exec(text);

  if (match?.[0]) {
    const parsed = tryParseVerification(match[0]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Try to parse a string as a verification issues block
 */
function tryParseVerification(json: string): { issues: string[]; summary: string } | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;

    if (Array.isArray(obj.issues)) {
      return {
        issues: toStringArray(obj.issues),
        summary: typeof obj.summary === "string" ? obj.summary : "",
      };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}
