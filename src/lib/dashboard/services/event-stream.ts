/**
 * EventStreamService - Watches events.jsonl and streams events to subscribers
 *
 * Part of the logging consolidation feature (REQ-014).
 * This service watches the single events.jsonl file and provides
 * event streaming to the dashboard via callback.
 */

import { watch, type FSWatcher } from "chokidar";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

// Re-export types from log-entry.ts for convenience
export type {
  EventType,
  LogEventType,
  LogEvent,
  SessionStartEvent,
  SessionEndEvent,
  RecommendationEvent,
  FollowThroughEvent,
  AgentInvocationEvent,
  SkillInvocationEvent,
  ComplianceEvent,
  TokensEvent,
  AgentStartEvent,
  AgentEndEvent,
} from "./types/log-entry.js";

import type { LogEvent } from "./types/log-entry.js";

/**
 * Configuration for EventStreamService
 */
export interface EventStreamConfig {
  /** Project path containing .claude/logs/events.jsonl */
  projectPath: string;
  /** Callback invoked for each event */
  onEvent: (event: LogEvent) => void;
  /** Optional error callback */
  onError?: (error: Error) => void;
}

/**
 * Service that watches events.jsonl and streams events to subscribers.
 * Handles corrupt JSON lines gracefully by skipping and logging warnings.
 */
export class EventStreamService {
  private watcher: FSWatcher | null = null;
  private lastPosition: number = 0;
  private eventsPath: string;
  private corruptLineCount: number = 0;
  private static readonly MAX_CORRUPT_WARNINGS = 10;

  constructor(private config: EventStreamConfig) {
    this.eventsPath = path.join(
      config.projectPath,
      ".claude",
      "logs",
      "events.jsonl"
    );
  }

  /**
   * Start watching the events file.
   * Loads existing events first, then watches for new appends.
   */
  async start(): Promise<void> {
    // Initial load of existing events
    await this.loadExistingEvents();

    // Watch for new events (append-only)
    this.watcher = watch(this.eventsPath, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", () => {
      this.readNewEvents().catch((error: unknown) => {
        if (this.config.onError) {
          this.config.onError(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      });
    });

    this.watcher.on("error", (error: Error) => {
      if (this.config.onError) {
        this.config.onError(error);
      }
    });
  }

  /**
   * Safely parse a JSON line, returning null for corrupt entries.
   * Logs a warning but does not throw.
   */
  private parseEventLine(line: string, lineNumber: number): LogEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null; // Skip empty lines

    try {
      return JSON.parse(trimmed) as LogEvent;
    } catch (error) {
      this.corruptLineCount++;

      // Only log individual warnings up to the threshold
      if (this.corruptLineCount <= EventStreamService.MAX_CORRUPT_WARNINGS) {
        console.warn(
          `[EventStreamService] Corrupt JSON at line ${lineNumber}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        console.warn(
          `[EventStreamService] Skipping line: ${trimmed.slice(0, 100)}${trimmed.length > 100 ? "..." : ""}`
        );
      } else if (
        this.corruptLineCount ===
        EventStreamService.MAX_CORRUPT_WARNINGS + 1
      ) {
        console.warn(
          `[EventStreamService] Too many corrupt lines (${this.corruptLineCount}+), suppressing further warnings`
        );
      }

      return null;
    }
  }

  /**
   * Load all existing events from the file.
   * Called once on start().
   */
  private async loadExistingEvents(): Promise<void> {
    if (!fs.existsSync(this.eventsPath)) return;

    const fileStream = fs.createReadStream(this.eventsPath);
    const rl = readline.createInterface({ input: fileStream });

    try {
      let lineNumber = 0;
      const startCorruptCount = this.corruptLineCount;

      for await (const line of rl) {
        lineNumber++;
        const event = this.parseEventLine(line, lineNumber);

        if (event) {
          this.config.onEvent(event);
        }
      }

      const newCorruptLines = this.corruptLineCount - startCorruptCount;
      if (newCorruptLines > 0) {
        console.warn(
          `[EventStreamService] Loaded events with ${newCorruptLines} corrupt line(s) skipped`
        );
      }

      // Track position for incremental reads
      this.lastPosition = fs.statSync(this.eventsPath).size;
    } finally {
      // Ensure streams are properly closed to prevent resource leaks
      rl.close();
      fileStream.destroy();
    }
  }

  /**
   * Read new events appended since last read.
   * Called on file change events.
   */
  private async readNewEvents(): Promise<void> {
    if (!fs.existsSync(this.eventsPath)) return;

    const stats = fs.statSync(this.eventsPath);
    if (stats.size <= this.lastPosition) return;

    const stream = fs.createReadStream(this.eventsPath, {
      start: this.lastPosition,
      encoding: "utf8",
    });

    const rl = readline.createInterface({ input: stream });
    let lineNumber = this.estimateLineNumber(); // Approximate for error reporting

    for await (const line of rl) {
      lineNumber++;
      const event = this.parseEventLine(line, lineNumber);
      if (event) {
        this.config.onEvent(event);
      }
    }

    this.lastPosition = stats.size;
  }

  /**
   * Estimate current line number based on file position.
   * Used for error reporting in incremental reads.
   */
  private estimateLineNumber(): number {
    // Rough estimate: average line is ~200 bytes
    return Math.floor(this.lastPosition / 200);
  }

  /**
   * Stop watching and cleanup resources.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Get the current file position (useful for debugging/testing).
   */
  getPosition(): number {
    return this.lastPosition;
  }

  /**
   * Get the count of corrupt lines encountered.
   */
  getCorruptLineCount(): number {
    return this.corruptLineCount;
  }
}
