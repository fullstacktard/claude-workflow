/**
 * Usage Error Logger
 *
 * Structured error logging for usage API failures.
 * Logs errors to ~/.claude/logs/usage-errors.log with automatic rotation.
 * Never displays raw errors to users - only friendly messages.
 *
 * @module usageErrorLog
 */

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Type for log entry context values
type LogContextArray = readonly LogContextValue[];
interface LogContextObject {
  [key: string]: LogContextValue;
}
type LogContextValue = boolean | LogContextArray | LogContextObject | null | number | string;

interface LogEntry {
  context: Record<string, LogContextValue>;
  errorType: string;
  message: string;
  provider: string;
  timestamp: string;
}

const LOG_DIR = path.join(os.homedir(), ".claude", "logs");
const LOG_FILE = path.join(LOG_DIR, "usage-errors.log");

// Log rotation constants
const MEGABYTES_BEFORE_ROTATION = 5;
const BYTES_PER_KILOBYTE = 1024;
const KILOBYTES_PER_MEGABYTE = 1024;
const MAX_LOG_SIZE = MEGABYTES_BEFORE_ROTATION * BYTES_PER_KILOBYTE * KILOBYTES_PER_MEGABYTE; // 5MB

/**
 * Clear error logs
 *
 * Removes the error log file.
 * Useful for testing or manual cleanup.
 *
 * @async
 * @returns {Promise<void>}
 *
 * @example
 * await clearErrorLogs();
 */
export async function clearErrorLogs(): Promise<void> {
  try {
    if (fsSync.existsSync(LOG_FILE)) {
      await fs.rm(LOG_FILE);
    }
  } catch {
    // Ignore errors - file may not exist
  }
}

/**
 * Log a usage API error
 *
 * Logs errors to file without displaying to user.
 * Includes timestamp, provider, error type, and context.
 * Automatically rotates logs when they exceed 5MB.
 *
 * @async
 * @param {string} provider - Provider name (e.g., "anthropic", "openai")
 * @param {string} errorType - Error classification (e.g., "timeout", "network", "auth")
 * @param {string} message - Error message
 * @param {Object} context - Additional context (error details, stack trace, etc.)
 * @returns {Promise<void>}
 *
 * @example
 * await logUsageError('anthropic', 'timeout', 'API request timed out after 5s', {
 *   url: 'https://api.anthropic.com/v1/usage',
 *   timeout: 5000
 * });
 */
export async function logUsageError(provider: string, errorType: string, message: string, context: Record<string, LogContextValue> = {}): Promise<void> {
  try {
    // Ensure log directory exists
    await fs.mkdir(LOG_DIR, { recursive: true });

    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      context,
      errorType,
      message,
      provider,
      timestamp
    };

    const logLine = JSON.stringify(logEntry) + "\n";

    // Check file size for rotation
    await rotateLogsIfNeeded();

    // Append to log file
    await fs.appendFile(LOG_FILE, logLine);
  } catch (error) {
    // Silent failure - don't crash on logging errors
    // Fall back to console.error as last resort
    
    console.error(`Failed to log usage error: ${(error as Error).message}`);
  }
}

/**
 * Rotate log file if it exceeds maximum size
 *
 * Renames current log file with timestamp suffix when it exceeds 5MB.
 * Keeps rotated files for manual review/debugging.
 *
 * @private
 * @async
 * @returns {Promise<void>}
 */
async function rotateLogsIfNeeded(): Promise<void> {
  try {
    // Check if log file exists and get size
    const stats = await fs.stat(LOG_FILE);

    if (stats.size > MAX_LOG_SIZE) {
      // Create rotated filename with timestamp
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const rotatedFile = `${LOG_FILE}.${timestamp}`;

      // Rename current log file
      await fs.rename(LOG_FILE, rotatedFile);
    }
  } catch {
    // File doesn't exist or other error - ignore
    // New log file will be created on next write
  }
}
