/**
 * Workflow Output Parser - Parse stream-json output from headless workflow phases
 *
 * Parses `--output-format stream-json` (one JSON object per line):
 * - Scans `type: "assistant"` messages for `PHASE_COMPLETE` string
 * - Extracts structured phase output JSON from code blocks
 * - Detects rate limits from error/result messages
 *
 * Reuses the same stream-json format patterns as goal-output-parser.ts.
 *
 * @module workflow/workflow-output-parser
 */

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
  message?:
    | {
        content?: ContentBlock[];
        role?: string;
      }
    | string;
  result?: string;
  role?: string;
  subtype?: string;
  type: string;
}

/** Structured output from a phase agent */
export interface PhaseOutput {
  /** Blockers preventing progress */
  blockers: string[];
  /** Files created or modified */
  files_modified: string[];
  /** Number of items produced (for from_previous counts) */
  result_count: number;
  /** Structured results data (agent-specific) */
  results: unknown;
  /** Phase completion status */
  status: "blocked" | "complete" | "failed" | "partial";
  /** Human-readable summary of what was done */
  summary: string;
}

/** Result of parsing all output from a phase's claude -p run */
export interface ParsedPhaseOutput {
  /** Whether PHASE_COMPLETE was found in output */
  phaseComplete: boolean;
  /** Extracted structured output block */
  phaseOutput: PhaseOutput | null;
  /** Whether rate limiting was detected */
  rateLimited: boolean;
  /** Full raw text from assistant messages */
  rawText: string;
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
 * Parse a complete stream-json output string from a phase run
 */
export function parsePhaseStreamOutput(rawOutput: string): ParsedPhaseOutput {
  const result: ParsedPhaseOutput = {
    phaseComplete: false,
    phaseOutput: null,
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
      if (isRateLimited(trimmed)) {
        result.rateLimited = true;
      }
      continue;
    }

    // Collect assistant text content
    // stream-json format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
    if (
      parsed.type === "assistant" &&
      parsed.message &&
      typeof parsed.message === "object"
    ) {
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
      const msg =
        (typeof parsed.message === "string"
          ? parsed.message
          : parsed.result) ??
        parsed.content ??
        "";
      if (isRateLimited(msg)) {
        result.rateLimited = true;
      }
    }

    // Check error messages for rate limits
    if (parsed.type === "error") {
      const msg =
        (typeof parsed.message === "string" ? parsed.message : "") ||
        parsed.content ||
        "";
      if (isRateLimited(msg)) {
        result.rateLimited = true;
      }
    }
  }

  result.rawText = textParts.join("");

  // Check for PHASE_COMPLETE signal
  if (result.rawText.includes("PHASE_COMPLETE")) {
    result.phaseComplete = true;
  }

  // Extract phase output JSON block
  result.phaseOutput = extractPhaseOutput(result.rawText);

  // Infer completion from output if signal wasn't explicit
  if (!result.phaseComplete && result.phaseOutput?.status === "complete") {
    result.phaseComplete = true;
  }

  return result;
}

/**
 * Extract a phase output JSON block from assistant text
 * Looks for JSON in code fences matching the phase output schema
 */
function extractPhaseOutput(text: string): PhaseOutput | null {
  // Try to find JSON in code fences first
  const codeFenceRegex =
    /```(?:json)?\s*\n?\s*(\{[\s\S]*?"status"\s*:\s*"(?:complete|partial|blocked|failed)"[\s\S]*?\})\s*\n?\s*```/g;
  let match = codeFenceRegex.exec(text);

  if (match?.[1]) {
    const parsed = tryParsePhaseOutput(match[1]);
    if (parsed) return parsed;
  }

  // Fallback: try to find bare JSON with the status field
  const bareJsonRegex =
    /\{[^{}]*"status"\s*:\s*"(?:complete|partial|blocked|failed)"[^{}]*\}/g;
  match = bareJsonRegex.exec(text);

  if (match?.[0]) {
    const parsed = tryParsePhaseOutput(match[0]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Try to parse a string as a PhaseOutput
 */
function tryParsePhaseOutput(json: string): PhaseOutput | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;

    if (
      typeof obj.status === "string" &&
      ["complete", "partial", "blocked", "failed"].includes(obj.status)
    ) {
      return {
        blockers: toStringArray(obj.blockers),
        files_modified: toStringArray(obj.files_modified),
        result_count:
          typeof obj.result_count === "number"
            ? obj.result_count
            : (Array.isArray(obj.results)
              ? (obj.results as unknown[]).length
              : 1),
        results: obj.results ?? null,
        status: obj.status as PhaseOutput["status"],
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
