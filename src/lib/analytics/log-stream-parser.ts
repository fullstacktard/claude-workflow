/**
 * Streaming JSON Lines Parser for Log Files
 *
 * Provides memory-efficient line-by-line processing of JSONL log files.
 * Handles large files without loading entire content into memory.
 */

import type { TransformCallback, TransformOptions } from "node:stream";

import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  isStandardLogEntry,
  type StandardLogEntry
} from "../dashboard/services/types/log-entry.js";

// JSON value can be any valid JSON type
export type EntryCallback = (data: JsonValue, lineNumber: number) => void;
export type JsonArray = JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }
export type JsonValue = boolean | JsonArray | JsonObject | null | number | string;

interface ParseErrorInfo {
  error: string;
  line: string;
  lineNumber: number;
}

// Type definitions for LogStreamParser
interface ParserOptions extends TransformOptions {
  maxErrors?: number;
}

interface ProcessErrorInfo {
  data: JsonValue;
  error: string;
  lineNumber: number;
}

interface ProcessingResult {
  endTime: number;
  entriesProcessed: number;
  errorsEncountered: number;
  parserStats: {
    errorCount: number;
    errorRate: number;
    lineNumber: number;
  };
  processingTime: number;
  startTime: number;
}

interface ProcessingStats {
  endTime: number | undefined;
  entriesProcessed: number;
  errorsEncountered: number;
  startTime: number;
}

interface ProcessorOptions {
  encoding?: BufferEncoding;
  highWaterMark?: number;
  maxErrors?: number;
}

class ProcessingError extends Error {
  override cause: Error;
  error: Error;
  stats: ProcessingStats & {
    parserStats: {
      errorCount: number;
      errorRate: number;
      lineNumber: number;
    };
    processingTime: number;
  };

  constructor(
    originalError: Error,
    stats: ProcessingStats & {
      parserStats: {
        errorCount: number;
        errorRate: number;
        lineNumber: number;
      };
      processingTime: number;
    }
  ) {
    super(originalError.message);
    this.name = "ProcessingError";
    this.cause = originalError;
    this.error = originalError;
    this.stats = stats;
  }
}

// Constants for error thresholds
const DEFAULT_MAX_ERRORS = 1000;

/**
 * Transform stream that processes JSON Lines format
 * Emits individual parsed JSON objects
 */
export class JSONLParser extends Transform {
  private buffer: string;
  private errorCount: number;
  private lineNumber: number;
  private maxErrors: number;

  constructor(options: ParserOptions = {}) {
    super({ ...options, objectMode: true });
    this.buffer = "";
    this.lineNumber = 0;
    this.errorCount = 0;
    this.maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;
  }

  /**
   * Handle any remaining data in buffer
   */
  override _flush(callback: (error?: Error | null) => void): void {
    if (this.buffer.trim()) {
      this.lineNumber++;

      try {
        const parsed = JSON.parse(this.buffer) as JsonValue;
        this.push({ data: parsed, lineNumber: this.lineNumber });
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        this.emit("parseError", {
          error: errorMessage,
          line: this.buffer,
          lineNumber: this.lineNumber
        } as ParseErrorInfo);
      }
    }

    callback();
  }

  /**
   * Process incoming chunks and emit complete JSON objects
   */
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");

      // Keep the last potentially incomplete line in buffer
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        this.lineNumber++;

        // Skip empty lines
        if (!line.trim()) {
          continue;
        }

        try {
          const parsed = JSON.parse(line) as JsonValue;
          this.push({ data: parsed, lineNumber: this.lineNumber });
        } catch (parseError) {
          this.errorCount++;

          // Emit error event but continue processing
          if (this.errorCount <= this.maxErrors) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            this.emit("parseError", {
              error: errorMessage,
              line,
              lineNumber: this.lineNumber
            } as ParseErrorInfo);
          }

          // If too many errors, stop processing to prevent infinite loops
          if (this.errorCount > this.maxErrors) {
            callback(new Error(`Too many parse errors (${this.errorCount.toString()}), stopping processing`)); return;
          }
        }
      }

      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get parser statistics
   */
  getStats(): { errorCount: number; errorRate: number; lineNumber: number; } {
    const PERCENTAGE_MULTIPLIER = 100;
    return {
      errorCount: this.errorCount,
      errorRate: this.lineNumber > 0 ? (this.errorCount / this.lineNumber) * PERCENTAGE_MULTIPLIER : 0,
      lineNumber: this.lineNumber
    };
  }
}

// Default buffer and error settings
const DEFAULT_ENCODING: BufferEncoding = "utf8";
const KILOBYTES_PER_MEGABYTE = 1024;
const DEFAULT_HIGH_WATER_MARK = KILOBYTES_PER_MEGABYTE * KILOBYTES_PER_MEGABYTE; // 1MB chunks

/**
 * Log stream processor that handles file streaming with backpressure
 */
export class LogStreamProcessor {
  private options: ProcessorOptions;

  constructor(options: ProcessorOptions = {}) {
    // Store options for potential future use
    this.options = {
      encoding: options.encoding ?? DEFAULT_ENCODING,
      highWaterMark: options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK,
      maxErrors: options.maxErrors ?? DEFAULT_MAX_ERRORS,
      ...options
    };
  }

  /**
   * Process log file stream and invoke callback for each parsed entry
   */
  async processFile(filePath: string, entryCallback: EntryCallback): Promise<ProcessingResult> {
    return new Promise((resolve, reject) => {
      const stats: ProcessingStats = {
        endTime: undefined,
        entriesProcessed: 0,
        errorsEncountered: 0,
        startTime: Date.now()
      };

      // Create JSONL parser
      const parserOptions: ParserOptions = {};
      if (this.options.maxErrors !== undefined) {
        parserOptions.maxErrors = this.options.maxErrors;
      }
      const parser = new JSONLParser(parserOptions);

      // Handle parsed entries
      parser.on("data", ({ data, lineNumber }: { data: JsonValue; lineNumber: number }) => {
        try {
          entryCallback(data, lineNumber);
          stats.entriesProcessed++;
        } catch (error) {
          stats.errorsEncountered++;
          const errorMessage = error instanceof Error ? (error).message : String(error);
          parser.emit("processError", {
            data,
            error: errorMessage,
            lineNumber
          } as ProcessErrorInfo);
        }
      });

      // Handle parse errors
      parser.on("parseError", () => {
        stats.errorsEncountered++;
      });

      // Handle processing errors
      parser.on("processError", () => {
        stats.errorsEncountered++;
      });

      // Create file read stream
      const readStream = createReadStream(filePath, {
        encoding: this.options.encoding,
        highWaterMark: this.options.highWaterMark
      });

      // Pipeline: file -> JSONL parser
      void pipeline(readStream, parser)
        .then(() => {
          stats.endTime = Date.now();
          const result: ProcessingResult = {
            endTime: stats.endTime,
            entriesProcessed: stats.entriesProcessed,
            errorsEncountered: stats.errorsEncountered,
            parserStats: parser.getStats(),
            processingTime: stats.endTime - stats.startTime,
            startTime: stats.startTime
          };
          resolve(result);
        })
         
        .catch((pipelineError) => {
          const error = pipelineError instanceof Error ? pipelineError : new Error(String(pipelineError));
          stats.endTime = Date.now();
          const processingError = new ProcessingError(error, {
            endTime: stats.endTime,
            entriesProcessed: stats.entriesProcessed,
            errorsEncountered: stats.errorsEncountered,
            parserStats: parser.getStats(),
            processingTime: stats.endTime - stats.startTime,
            startTime: stats.startTime
          });
          reject(processingError);
        });
    });
  }

  /**
   * Process log file and return all entries as array
   * Note: This loads all entries into memory - use with caution for large files
   */
  async processFileToArray(filePath: string): Promise<JsonValue[]> {
    const entries: JsonValue[] = [];

    await this.processFile(filePath, (entry: JsonValue) => {
      entries.push(entry);
    });

    return entries;
  }

  /**
   * Parse and normalize a log entry line to standard format
   * Only handles StandardLogEntry format
   */
  parseAndNormalizeEntry(
    line: string
  ): StandardLogEntry | null {
    try {
      const parsed = JSON.parse(line) as unknown;

      if (isStandardLogEntry(parsed)) {
        return parsed;
      }

      // Non-standard entries are ignored
      return null;
    } catch {
      return null;
    }
  }
}