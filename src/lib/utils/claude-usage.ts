
import { glob } from "glob";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

interface BlockStartTimeResult {
  accountActivationTime: Date | undefined;
  lastActivity: Date | undefined;
  startTime: Date;
}

interface TokenMetrics {
  cachedTokens: number;
  contextLength: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface TranscriptData {
  isApiErrorMessage?: boolean;
  isSidechain?: boolean;
  message?: {
    usage?: TranscriptUsage;
  };
  timestamp?: string;
}

interface TranscriptUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

const DEFAULT_SESSION_HOURS = 5;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const LOOKBACK_10_HOURS = 10;
const LOOKBACK_20_HOURS = 20;
const LOOKBACK_48_HOURS = 48;
const LOOKBACK_HOURS = [LOOKBACK_10_HOURS, LOOKBACK_20_HOURS, LOOKBACK_48_HOURS] as const;

/**
 * Find the most recent 5-hour continuous work block from Claude transcript files
 *
 * IMPORTANT: This function now tracks usage PER-ACCOUNT. It only counts activity
 * that occurred AFTER the current account became active. When you switch accounts,
 * the 5-hour block timer resets to show usage for the new account only.
 *
 * @param rootDir - Claude config directory (usually ~/.config/claude-code)
 * @param sessionDurationHours - Block duration in hours (default: 5)
 * @param accountActivationTime - When current account became active (optional)
 * @returns Block start time information or undefined
 */
export function findMostRecentBlockStartTime(
  rootDir: string,
  sessionDurationHours: number = DEFAULT_SESSION_HOURS,
  accountActivationTime: Date | undefined = undefined
): BlockStartTimeResult | undefined {
  const sessionDurationMs = sessionDurationHours * MS_PER_HOUR;
  const now = new Date();

  // Get account activation time if not provided
  // This determines when to START counting activity for this account
  const activationTime = accountActivationTime;

  // Find all transcript JSONL files
  const pattern = path.join(rootDir.replaceAll("\\", "/"), "projects", "**", "*.jsonl");
  const files = glob.sync([pattern], {
    absolute: true,
    cwd: rootDir
  });

  if (files.length === 0) {
    return undefined;
  }

  interface FileWithStats {
    file: string;
    mtime: Date;
  }

  // Sort files by modification time (most recent first)
  const filesWithStats: FileWithStats[] = files.map((file) => {
    const stats = statSync(file);
    return { file, mtime: stats.mtime };
  });
  filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  let timestamps: Date[] = [];
  let mostRecentTimestamp: Date | undefined = undefined;
  let continuousWorkStart: Date | undefined = undefined;
  let foundSessionGap = false;

  for (const lookbackHours of LOOKBACK_HOURS) {
    const cutoffTime = new Date(now.getTime() - lookbackHours * MS_PER_HOUR);
    timestamps = [];

    // Collect timestamps from recent files
    for (const { file, mtime } of filesWithStats) {
      if (mtime.getTime() < cutoffTime.getTime()) {
        break;
      }
      const fileTimestamps = getAllTimestampsFromFile(file);
      timestamps.push(...fileTimestamps);
    }

    if (timestamps.length === 0) {
      continue;
    }

    // CRITICAL FIX: Filter timestamps to only include activity for CURRENT ACCOUNT
    // Activity before the account switch doesn't count towards this account's limit
    if (activationTime !== undefined) {

      timestamps = timestamps.filter((t) => t.getTime() >= activationTime.getTime());
    }

    if (timestamps.length === 0) {
      // No activity for current account yet - return fresh block
      if (activationTime !== undefined) {
        const blockStart = floorToHour(activationTime);
        return {
          accountActivationTime: activationTime,
          lastActivity: undefined,
          startTime: blockStart
        };
      }
      continue;
    }

    timestamps.sort((a, b) => b.getTime() - a.getTime());

    // Check if last activity is within session duration
    const firstTimestamp = timestamps[0];
    if (mostRecentTimestamp === undefined && firstTimestamp !== undefined) {
      mostRecentTimestamp = firstTimestamp;
      const timeSinceLastActivity = now.getTime() - mostRecentTimestamp.getTime();
      if (timeSinceLastActivity > sessionDurationMs) {
        return undefined; // Session expired
      }
    }

    // Find continuous work start by looking for gaps >= 5 hours
    continuousWorkStart = mostRecentTimestamp;
    for (let i = 1; i < timestamps.length; i++) {
      const currentTimestamp = timestamps[i];
      const previousTimestamp = timestamps[i - 1];

      if (currentTimestamp === undefined || previousTimestamp === undefined) {
        continue;
      }

      const gap = previousTimestamp.getTime() - currentTimestamp.getTime();
      if (gap >= sessionDurationMs) {
        foundSessionGap = true;
        break;
      }
      continuousWorkStart = currentTimestamp;
    }

    if (foundSessionGap) {
      break;
    }
  }

  if (mostRecentTimestamp === undefined || continuousWorkStart === undefined) {
    return undefined;
  }

  interface Block {
    end: Date;
    start: Date;
  }

  // Create 5-hour blocks and find current active block
  const blocks: Block[] = [];

  const sortedTimestamps = [...timestamps].toSorted((a, b) => a.getTime() - b.getTime());
  let currentBlockStart: Date | undefined = undefined;
  let currentBlockEnd: Date | undefined = undefined;

  for (const timestamp of sortedTimestamps) {
    if (timestamp.getTime() < continuousWorkStart.getTime()) {
      continue;
    }

    if (currentBlockStart === undefined || (currentBlockEnd !== undefined && timestamp.getTime() > currentBlockEnd.getTime())) {
      currentBlockStart = floorToHour(timestamp);
      currentBlockEnd = new Date(currentBlockStart.getTime() + sessionDurationMs);
      blocks.push({ end: currentBlockEnd, start: currentBlockStart });
    }
  }

  // Find the block that contains current time
  for (const block of blocks) {
    if (now.getTime() >= block.start.getTime() && now.getTime() <= block.end.getTime()) {

      const hasActivity = timestamps.some((t) =>
        t.getTime() >= block.start.getTime() && t.getTime() <= block.end.getTime()
      );

      if (hasActivity) {
        return {
          accountActivationTime: activationTime,
          lastActivity: mostRecentTimestamp,
          startTime: block.start
        };
      }
    }
  }

  return undefined;
}

const ZERO_MINUTES = 0;
const ZERO_SECONDS = 0;
const ZERO_MILLISECONDS = 0;

/**
 * Floor timestamp to the nearest hour (local timezone)
 *
 * IMPORTANT: Uses local time (setMinutes) instead of UTC (setUTCMinutes)
 * to ensure block boundaries align with user's local timezone.
 * This fixes percentage calculation bug where mixed timezone contexts
 * resulted in incorrect elapsed time calculations.
 *
 * @param timestamp - Date to floor
 * @returns Floored date in local timezone
 */
export function floorToHour(timestamp: Date): Date {
  const floored = new Date(timestamp);
  floored.setMinutes(ZERO_MINUTES, ZERO_SECONDS, ZERO_MILLISECONDS);
  return floored;
}

const ONE_MINUTE = 1;

/**
 * Calculate session duration from JSONL transcript timestamps
 *
 * @param transcriptPath - Path to transcript.jsonl file
 * @returns Formatted duration like "2hr 15m", "45m", "<1m", or undefined
 */
export async function getSessionDuration(transcriptPath: string): Promise<string | undefined> {
  try {
    if (!existsSync(transcriptPath)) {
      return undefined;
    }

    const content = await readFile(transcriptPath, "utf8");
    const lines = content.trim().split("\n").filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return undefined;
    }

    let firstTimestamp: Date | undefined = undefined;
    let lastTimestamp: Date | undefined = undefined;

    // Find first timestamp
    for (const line of lines) {
      try {
        const data = JSON.parse(line) as TranscriptData;
        if (typeof data.timestamp === "string") {
          firstTimestamp = new Date(data.timestamp);
          break;
        }
      } catch {
        continue;
      }
    }

    // Find last timestamp (iterate backwards)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const line = lines[i];
        if (line === undefined) {
          continue;
        }
        const data = JSON.parse(line) as TranscriptData;
        if (typeof data.timestamp === "string") {
          lastTimestamp = new Date(data.timestamp);
          break;
        }
      } catch {
        continue;
      }
    }

    if (firstTimestamp === undefined || lastTimestamp === undefined) {
      return undefined;
    }

    // Calculate duration and format
    const durationMs = lastTimestamp.getTime() - firstTimestamp.getTime();
    const totalMinutes = Math.floor(durationMs / MS_PER_MINUTE);

    if (totalMinutes < ONE_MINUTE) {
      return "<1m";
    }

    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;

    if (hours === 0) {
      return `${String(minutes)}m`;
    }
    if (minutes === 0) {
      return `${String(hours)}hr`;
    }
    return `${String(hours)}hr ${String(minutes)}m`;
  } catch {
    return undefined;
  }
}

const ZERO_TOKENS = 0;

/**
 * Calculate token metrics from Claude Code JSONL transcript
 *
 * @param transcriptPath - Path to transcript.jsonl file
 * @returns Token metrics with counts for various token types
 */
export async function getTokenMetrics(transcriptPath: string): Promise<TokenMetrics> {
  try {
    // Return zeros if file doesn't exist
    if (!existsSync(transcriptPath)) {
      return {
        cachedTokens: ZERO_TOKENS,
        contextLength: ZERO_TOKENS,
        inputTokens: ZERO_TOKENS,
        outputTokens: ZERO_TOKENS,
        totalTokens: ZERO_TOKENS
      };
    }

    const content = await readFile(transcriptPath, "utf8");
    const lines = content.trim().split("\n");

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let contextLength = 0;
    let mostRecentMainChainEntry: TranscriptData | undefined = undefined;
    let mostRecentTimestamp: Date | undefined = undefined;

    // Parse each JSONL line and accumulate token counts
    for (const line of lines) {
      try {
        const data = JSON.parse(line) as TranscriptData;

        if (data.message?.usage !== undefined) {
          // Accumulate token counts
          inputTokens += data.message.usage.input_tokens ?? ZERO_TOKENS;
          outputTokens += data.message.usage.output_tokens ?? ZERO_TOKENS;
          cachedTokens += data.message.usage.cache_read_input_tokens ?? ZERO_TOKENS;
          cachedTokens += data.message.usage.cache_creation_input_tokens ?? ZERO_TOKENS;

          // Track most recent main chain entry for context length
          if (data.isSidechain !== true && typeof data.timestamp === "string" && data.isApiErrorMessage !== true) {
            const entryTime = new Date(data.timestamp);
            if (mostRecentTimestamp === undefined || entryTime > mostRecentTimestamp) {
              mostRecentTimestamp = entryTime;
              mostRecentMainChainEntry = data;
            }
          }
        }
      } catch {
        // Skip malformed JSON lines
        continue;
      }
    }

    // Calculate context length from most recent entry
    if (mostRecentMainChainEntry?.message?.usage !== undefined) {
      const usage = mostRecentMainChainEntry.message.usage;
      contextLength = (usage.input_tokens ?? ZERO_TOKENS) +
                     (usage.cache_read_input_tokens ?? ZERO_TOKENS) +
                     (usage.cache_creation_input_tokens ?? ZERO_TOKENS);
    }

    const totalTokens = inputTokens + outputTokens + cachedTokens;
    return { cachedTokens, contextLength, inputTokens, outputTokens, totalTokens };
  } catch {
    // Return zeros on any error
    return {
      cachedTokens: ZERO_TOKENS,
      contextLength: ZERO_TOKENS,
      inputTokens: ZERO_TOKENS,
      outputTokens: ZERO_TOKENS,
      totalTokens: ZERO_TOKENS
    };
  }
}

/**
 * Extract all valid timestamps from a JSONL transcript file
 *
 * @param filePath - Path to JSONL file
 * @returns Array of Date objects
 */
function getAllTimestampsFromFile(filePath: string): Date[] {
  const timestamps: Date[] = [];

  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const json = JSON.parse(line) as TranscriptData;
        const usage = json.message?.usage;

        // Only include entries with valid usage data
        if (usage === undefined) {
          continue;
        }

        const hasInputTokens = typeof usage.input_tokens === "number";
        const hasOutputTokens = typeof usage.output_tokens === "number";
        if (!hasInputTokens || !hasOutputTokens) {
          continue;
        }

        // Skip sidechain entries
        if (json.isSidechain === true) {
          continue;
        }

        const timestamp = json.timestamp;
        if (typeof timestamp !== "string") {
          continue;
        }

        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
          timestamps.push(date);
        }
      } catch {
        continue;
      }
    }

    return timestamps;
  } catch {
    return [];
  }
}
