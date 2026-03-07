/**
 * Context data reader module for Claude Code session files
 *
 * This module reads and parses Claude Code session files (.jsonl) to extract
 * token usage and context data. Session files are stored in ~/.claude/projects/
 * with one JSON object per line (JSON Lines format).
 *
 * @module lib/contextReader
 */

import fs from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";

// Constants
const MIN_UUID_LENGTH = 20;

// Type definitions
interface ContextUsageResult {
  agentTokens: {
    messageCount: number;
    sessionId: string;
    timestamp: number | undefined;
    totalTokens: number;
  }[];
  lastUpdate: number | undefined;
  messageCount: number;
  totalTokens: number;
}

interface SessionEntry {
  message?: {
    usage?: {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  timestamp?: string;
  type: string;
}

/**
 * Calculate total token usage from session entries
 *
 * Iterates through all entries and sums token usage from assistant messages.
 * Token data is found in entry.message.usage and includes:
 * - input_tokens: Fresh tokens from this request
 * - cache_creation_input_tokens: Tokens added to cache
 * - cache_read_input_tokens: Tokens read from cache (90% discount)
 * - output_tokens: Tokens in the response
 *
 * Note: Token counts are per-message and must be summed for session totals.
 *
 * @param {Array} entries - Parsed session entries from parseSessionFile()
 * @returns {Object} Token usage summary
 * @returns {number} return.totalTokens - Total tokens (input + cache + output)
 * @returns {number} return.messageCount - Number of user/assistant message pairs
 * @returns {number|null} return.lastUpdate - Most recent timestamp (ms since epoch)
 * @returns {Array} return.agentTokens - Reserved for future agent token tracking
 *
 * @example
 * const result = calculateTotalTokens(entries);
 * // Returns: {
 * //   totalTokens: 45000,
 * //   messageCount: 12,
 * //   lastUpdate: 1732701179863,
 * //   agentTokens: []
 * // }
 */
export function calculateTotalTokens(entries: SessionEntry[]): ContextUsageResult {
  const result: ContextUsageResult = {
    agentTokens: [], // Reserved for future: separate agent token tracking
    lastUpdate: undefined,
    messageCount: 0,
    totalTokens: 0
  };

  for (const entry of entries) {
    // Count messages (both user and assistant)
    if (entry.type === "user" || entry.type === "assistant") {
      result.messageCount++;
    }

    // Sum tokens from assistant messages
    // Only assistant messages have usage data
    if (entry.type === "assistant" && entry.message?.usage) {
      const usage = entry.message.usage;

      // Sum all token types
      // Note: In production cost calculation, cache_read should be multiplied by 0.1
      // (90% discount), but for monitoring purposes we show raw token counts
      const tokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.output_tokens ?? 0);

      result.totalTokens += tokens;
    }

    // Track last update timestamp
    if (entry.timestamp !== undefined && entry.timestamp !== "") {
      const ts = new Date(entry.timestamp).getTime();
      if (result.lastUpdate === undefined || ts > result.lastUpdate) {

        result.lastUpdate = ts;
      }
    }
  }

  return result;
}

/**
 * Find session file in project directory
 *
 * Searches for a session file matching the given session ID. Handles both
 * main session files ({uuid}.jsonl) and potential future agent file matching.
 *
 * @param {string} projectDir - Project directory path (~/.claude/projects/{encoded-path})
 * @param {string} sessionId - Session UUID or identifier
 * @param {number} pid - Process ID (for fallback matching, currently unused)
 * @returns {Promise<string|null>} Full path to session file or null if not found
 *
 * @example
 * const file = await findSessionFile(
 *   "/home/user/.claude/projects/-home-user-project",
 *   "0fa4ea42-362a-4fe8-a38a-c683935658c4",
 *   12345
 * );
 * // Returns: "/home/user/.claude/projects/-home-user-project/0fa4ea42-362a-4fe8-a38a-c683935658c4.jsonl"
 */
export async function findSessionFile(projectDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const files = await fs.readdir(projectDir);

    // Extract UUID from session ID (handle various formats)
    // Format examples:
    //   - "uuid.json" → "uuid"
    //   - "uuid-agent-uuid" → "uuid" (first part)
    //   - "uuid" → "uuid"
    let uuid = sessionId === "" ? undefined : sessionId.replace(/\.json$/, "");

    // Handle agent filename format: "uuid-agent-uuid" → extract first UUID
    const hasAgentPrefix = uuid?.includes("-agent-") ?? false;
    if (hasAgentPrefix) {
      uuid = uuid?.split("-agent-")[0];
    }

    // Try exact UUID match first (main session files)
    if (uuid !== undefined && uuid !== "" && uuid.length > MIN_UUID_LENGTH) {
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;

        // Skip agent files for Phase 1 (main session only)
        // Future: Parse agent files and aggregate their tokens
        if (file.startsWith("agent-")) continue;

        // Check if filename contains the UUID
        if (file.includes(uuid)) {
          return path.join(projectDir, file);
        }
      }
    }

    // No matching file found
    return undefined;
  } catch (error) {
    // Directory doesn't exist - return undefined (not an error)
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    // Re-throw unexpected errors for caller to handle
    throw error;
  }
}

/**
 * Get context usage data for a specific session
 *
 * Reads the session file for the given session ID and calculates cumulative
 * token usage from all assistant messages. Returns null if the session file
 * cannot be found or accessed.
 *
 * @param {string} sessionId - Session UUID (e.g., "0fa4ea42-362a-4fe8-a38a-c683935658c4")
 * @param {number} pid - Process ID (used for fallback matching if needed)
 * @param {string} cwd - Current working directory of the session
 * @returns {Promise<Object|null>} Context data object or null if not found
 * @returns {number} return.totalTokens - Total tokens used in session
 * @returns {number} return.messageCount - Number of messages exchanged
 * @returns {number|null} return.lastUpdate - Timestamp of last update (ms since epoch)
 * @returns {Array} return.agentTokens - Token usage from agent sessions (reserved for future)
 *
 * @example
 * const usage = await getSessionContextUsage(
 *   "0fa4ea42-362a-4fe8-a38a-c683935658c4",
 *   12345,
 *   "/home/user/myproject"
 * );
 * // Returns: { totalTokens: 45000, messageCount: 12, lastUpdate: 1732701179863, agentTokens: [] }
 */
export async function getSessionContextUsage(sessionId: string, _pid: number, cwd: string): Promise<ContextUsageResult | undefined> {
  // Validate required parameters
  if (cwd === "" || sessionId === "") {
    return undefined;
  }

  try {
    // Convert project path to encoded format (/ → -)
    // Example: /home/user/project → -home-user-project
    const projectPath = cwd.replaceAll("/", "-");
    const projectDir = path.join(os.homedir(), ".claude", "projects", projectPath);

    // Find the session file in the project directory
    const sessionFile = await findSessionFile(projectDir, sessionId);

    if (sessionFile === undefined || sessionFile === "") {
      return undefined;
    }

    // Parse the session file to extract entries
    const entries = await parseSessionFile(sessionFile);

    // Calculate token totals and metadata
    const result = calculateTotalTokens(entries);

    return result;
  } catch (error) {
    // Handle permission errors gracefully
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      console.warn(`Permission denied reading session file for ${sessionId}`);
      return undefined;
    }

    // Handle missing files gracefully (normal for new/ended sessions)
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    // Log unexpected errors but don't crash
    console.error(`Error reading session context for ${sessionId}:`, (error as Error).message);
    return undefined;
  }
}

/**
 * Parse session JSONL file into entries
 *
 * Reads a Claude Code session file in JSONL (JSON Lines) format and parses
 * each line into a JavaScript object. Handles corrupt JSON lines gracefully
 * by skipping them with a warning.
 *
 * Each line in the file is a complete JSON object representing:
 * - User messages
 * - Assistant responses (with token usage data)
 * - Queue operations
 * - System events
 * - File history snapshots
 *
 * @param {string} filePath - Full path to session file
 * @returns {Promise<Array>} Array of parsed entry objects
 *
 * @example
 * const entries = await parseSessionFile("/path/to/session.jsonl");
 * // Returns: [
 * //   { type: "user", message: {...}, timestamp: "..." },
 * //   { type: "assistant", message: { usage: {...} }, timestamp: "..." },
 * //   ...
 * // ]
 */
export async function parseSessionFile(filePath: string): Promise<SessionEntry[]> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.trim().split("\n");
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === "") continue;

    try {
      const entry = JSON.parse(line) as SessionEntry;
      entries.push(entry);
    } catch (error) {
      // Skip corrupt JSON lines (don't fail entire parse)
      // This can happen if the file was being written when the process crashed
      console.warn(`Skipping corrupt JSON line in ${filePath}:`, (error as Error).message);
      continue;
    }
  }

  return entries;
}
