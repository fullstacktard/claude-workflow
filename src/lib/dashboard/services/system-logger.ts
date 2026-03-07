/**
 * SystemLogger - Broadcasts account management logs to dashboard UI
 *
 * Provides a centralized logging mechanism for account services that broadcasts
 * logs via WebSocket to the dashboard UI. This allows real-time visibility into
 * account management operations like credential sync, usage monitoring, etc.
 *
 * Features:
 * - Singleton pattern for easy access from any service
 * - Structured log format with source, level, and message
 * - WebSocket broadcast to dashboard UI
 * - Fallback to console when WebSocket not available
 *
 * @example
 * // In AccountManager
 * import { systemLogger } from './services/system-logger.js';
 *
 * systemLogger.info('AccountManager', 'Account switched', { accountId: '...' });
 * systemLogger.error('AccountManager', 'Failed to refresh token', { error: '...' });
 */

import type { LogStreamer } from "../websocket-server.js";
import type { SystemLogPayload } from "../../../types/websocket.js";

/** Log level type */
type LogLevel = "debug" | "error" | "info" | "warn";

/**
 * SystemLogger - Broadcasts structured logs to dashboard UI
 *
 * Singleton service that manages WebSocket broadcasting of system logs.
 * Services should use the exported `systemLogger` instance.
 */
class SystemLoggerService {
  private logStreamer: LogStreamer | null = null;

  /**
   * Set the LogStreamer instance for WebSocket broadcasting
   *
   * Called by the dashboard server during initialization to enable
   * WebSocket broadcasting. Until this is called, logs will only
   * go to console.
   *
   * @param streamer - The LogStreamer instance
   */
  setLogStreamer(streamer: LogStreamer): void {
    this.logStreamer = streamer;
  }

  /**
   * Log a debug message
   */
  debug(source: string, message: string, details?: Record<string, unknown>): void {
    this.log("debug", source, message, details);
  }

  /**
   * Log an info message
   */
  info(source: string, message: string, details?: Record<string, unknown>): void {
    this.log("info", source, message, details);
  }

  /**
   * Log a warning message
   */
  warn(source: string, message: string, details?: Record<string, unknown>): void {
    this.log("warn", source, message, details);
  }

  /**
   * Log an error message
   */
  error(source: string, message: string, details?: Record<string, unknown>): void {
    this.log("error", source, message, details);
  }

  /**
   * Internal log method
   *
   * Broadcasts to WebSocket if available, always logs to console.
   */
  private log(level: LogLevel, source: string, message: string, details?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();

    // Format console message
    const prefix = `[${source}]`;
    const consoleMessage = details === undefined
      ? `${prefix} ${message}`
      : `${prefix} ${message} ${JSON.stringify(details)}`;

    // Log to console based on level
    switch (level) {
    case "debug": {
      console.debug(consoleMessage);
      break;
    }
    case "info": {
      console.log(consoleMessage);
      break;
    }
    case "warn": {
      console.warn(consoleMessage);
      break;
    }
    case "error": {
      console.error(consoleMessage);
      break;
    }
    }

    // Broadcast to WebSocket if available
    if (this.logStreamer !== null) {
      const payload: SystemLogPayload = {
        timestamp,
        source,
        level,
        message,
        details,
      };
      this.logStreamer.broadcastSystemLog(payload);
    }
  }
}

/**
 * Singleton instance of SystemLogger
 *
 * Use this instance from any service to log to the dashboard UI.
 */
export const systemLogger = new SystemLoggerService();
