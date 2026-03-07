/**
 * OrchestrationError - Structured error handling for agent orchestration system
 *
 * Provides comprehensive error classification, correlation tracking, and context
 * preservation for all orchestration-related operations. This class enables
 * centralized error handling across agent-orchestrator.js, OrchestrationAnalyzer.js,
 * and orchestration CLI components.
 *
 * Features:
 * - Error categorization (validation, parsing, configuration, io, orchestration, system)
 * - Correlation ID tracking for error tracing across components
 * - Context preservation (file paths, line numbers, operation context)
 * - Structured serialization for logging and transmission
 * - Error severity levels and recovery suggestions
 * - Chain of causality preservation
 *
 * @extends Error
 *
 * @example
 * ```javascript
 * import { OrchestrationError, withErrorHandling } from './errors/orchestration-error.js';
 *
 * // Basic usage
 * throw new OrchestrationError('Failed to parse agent JSON', {
 *   category: 'parsing',
 *   code: 'JSON_PARSE_ERROR',
 *   context: { filePath: 'agent-response.txt', line: 42 }
 * });
 *
 * // With wrapper function
 * const result = await withErrorHandling(
 *   async () => JSON.parse(agentResponse),
 *   {
 *     operation: 'parseAgentResponse',
 *     category: 'parsing',
 *     context: { sessionId: 'abc123' }
 *   }
 * );
 * ```
 */

import { randomBytes } from "node:crypto";

// Type definitions for OrchestrationError
export interface ErrorContext {
  [key: string]: boolean | ErrorContext | ErrorContext[] | number | string | undefined;
}

interface ErrorOptions {
  category?: string | undefined;
  cause?: Error | undefined;
  code?: string | undefined;
  context?: ErrorContext | undefined;
  correlationId?: string | undefined;
  filePath?: string | undefined;
  line?: number | undefined;
  operation?: string | undefined;
  recoveryStrategy?: string | undefined;
  sessionId?: string | undefined;
  severity?: string | undefined;
}

/**
 * Error categories for classification
 */
export const ERROR_CATEGORIES = {
  CONFIGURATION: "configuration",
  IO: "io",
  ORCHESTRATION: "orchestration",
  PARSING: "parsing",
  SYSTEM: "system",
  VALIDATION: "validation"
};

/**
 * Error severity levels
 */
const ERROR_SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  LOW: "low",
  MEDIUM: "medium"
};

/**
 * Error codes for common orchestration scenarios
 */
export const ERROR_CODES = {
  AGENT_JSON_EXTRACTION_FAILED: "AGENT_JSON_EXTRACTION_FAILED",
  AGENT_SPAWNING_FAILED: "AGENT_SPAWNING_FAILED",
  DIRECTORY_ACCESS_ERROR: "DIRECTORY_ACCESS_ERROR",
  // IO errors
  FILE_NOT_FOUND: "FILE_NOT_FOUND",

  FILE_READ_ERROR: "FILE_READ_ERROR",
  // Orchestration errors
  INFINITE_LOOP_DETECTED: "INFINITE_LOOP_DETECTED",
  INVALID_AGENT_TYPE: "INVALID_AGENT_TYPE",

  INVALID_CLI_ARGS: "INVALID_CLI_ARGS",
  // Validation errors
  INVALID_JSON_SCHEMA: "INVALID_JSON_SCHEMA",
  INVALID_LOG_PATH: "INVALID_LOG_PATH",

  INVALID_NEXT_ACTION: "INVALID_NEXT_ACTION",
  INVALID_STATUS_TYPE: "INVALID_STATUS_TYPE",
  // Parsing errors
  JSON_PARSE_ERROR: "JSON_PARSE_ERROR",

  LOG_FILE_PARSE_ERROR: "LOG_FILE_PARSE_ERROR",
  // System errors
  MEMORY_ERROR: "MEMORY_ERROR",
  // Configuration errors
  MISSING_HOOK_CONFIG: "MISSING_HOOK_CONFIG",

  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
};

/**
 * Recovery strategies for different error types
 */
const RECOVERY_STRATEGIES = {
  FALLBACK: "fallback",
  RETRY: "retry",
  SKIP: "skip",
  TERMINATE: "terminate",
  USER_INPUT: "user_input"
};

/**
 * Sync error handling wrapper for non-async operations
 */
interface SyncErrorHandlingOptions<T> {
  category?: string;
  code?: string;
  context?: ErrorContext;
  fallback?: (error: OrchestrationError) => T;
  onError?: (error: OrchestrationError) => void;
  operation?: string;
  sessionId?: string;
}

interface WithErrorHandlingOptions<T> {
  category?: string;
  code?: string;
  context?: ErrorContext;
  fallback?: (error: OrchestrationError) => Promise<T> | T;
  onError?: (error: OrchestrationError) => void;
  operation?: string;
  retries?: number;
  retryDelay?: number;
  sessionId?: string;
}

export class OrchestrationError extends Error {
  public override readonly cause: Error | undefined;
  public readonly correlationId: string;
  public readonly errorCategory: string;
  public readonly errorCode: string;
  public readonly errorContext: ErrorContext;
  public readonly errorSeverity: string;
  public readonly filePath: string | undefined;
  public readonly lineNumber: number | undefined;
  public readonly operation: string;
  public readonly recoveryStrategy: string;
  public readonly sessionId: string | undefined;
  public readonly timestamp: string;

  // Properties with proper types (legacy getters for compatibility)
  get category(): string { return this.errorCategory; }

  get code(): string { return this.errorCode; }
  get context(): ErrorContext { return this.errorContext; }
  get line(): number | undefined { return this.lineNumber; }
  get severity(): string { return this.errorSeverity; }
  /**
   * Create an OrchestrationError
   */
  constructor(message: string, options: ErrorOptions = {}) {
    super(message);

    this.name = "OrchestrationError";

    // Core error properties

    this.errorCategory = options.category ?? ERROR_CATEGORIES.SYSTEM;

    this.errorCode = options.code ?? ERROR_CODES.UNKNOWN_ERROR;

    this.errorSeverity = options.severity ?? ERROR_SEVERITY.MEDIUM;

    this.errorContext = options.context ?? {};

    this.cause = options.cause ?? undefined;

    // Tracking and identification

    this.correlationId = options.correlationId ?? this.generateCorrelationId();

    this.operation = options.operation ?? "unknown";

    this.filePath = options.filePath ?? undefined;

    this.lineNumber = options.line ?? undefined;

    this.sessionId = options.sessionId ?? undefined;

    // Recovery guidance

    this.recoveryStrategy = options.recoveryStrategy ?? this.determineRecoveryStrategy();

    // Timestamp
    this.timestamp = new Date().toISOString();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, new.target);

    // Enrich context with derived information
    this.enrichContext();
  }

  /**
   * Create an OrchestrationError from a generic Error
   */
  static fromError(error: Error, options: Partial<ErrorOptions> = {}): OrchestrationError {
    const message = error instanceof OrchestrationError
      ? (error as Error).message
      : `Orchestration error: ${(error).message}`;

    return new OrchestrationError(message, {

      category: options.category ?? ERROR_CATEGORIES.SYSTEM,

      cause: error,
      code: options.code ?? ERROR_CODES.UNKNOWN_ERROR,
      context: {
        originalError: error.name,
        originalMessage: (error).message,

        ...options.context
      },

      ...(options.operation !== undefined && { operation: options.operation }),

      ...(options.sessionId !== undefined && { sessionId: options.sessionId })
    });
  }

  /**
   * Determine recovery strategy based on error category and code
   */
  determineRecoveryStrategy(): string {
    switch (this.errorCategory) {
    case ERROR_CATEGORIES.CONFIGURATION: {
      return RECOVERY_STRATEGIES.USER_INPUT;
    }
    case ERROR_CATEGORIES.IO: {
      return RECOVERY_STRATEGIES.RETRY;
    }
    case ERROR_CATEGORIES.ORCHESTRATION: {
      return this.errorCode === ERROR_CODES.INFINITE_LOOP_DETECTED
        ? RECOVERY_STRATEGIES.TERMINATE
        : RECOVERY_STRATEGIES.FALLBACK;
    }
    case ERROR_CATEGORIES.PARSING: {
      return RECOVERY_STRATEGIES.SKIP;
    }
    case ERROR_CATEGORIES.SYSTEM: {
      return this.errorSeverity === ERROR_SEVERITY.CRITICAL
        ? RECOVERY_STRATEGIES.TERMINATE
        : RECOVERY_STRATEGIES.RETRY;
    }
    case ERROR_CATEGORIES.VALIDATION: {
      return RECOVERY_STRATEGIES.FALLBACK;
    }
    default: {
      return RECOVERY_STRATEGIES.FALLBACK;
    }
    }
  }

  /**
   * Enrich context with additional derived information
   */
  enrichContext(): void {
    const MINIMUM_STACK_LINES = 2;
    const RADIX_DECIMAL = 10;

    // Add system context

    this.context.platform = process.platform;

    this.context.nodeVersion = process.version;

    const memUsage = process.memoryUsage();
    this.context.memoryUsage = `rss: ${String(memUsage.rss)}, heapUsed: ${String(memUsage.heapUsed)}`;

    // Add error origin context if available from stack trace
    if (this.stack !== undefined && this.stack !== "") {
      const stackLines = this.stack.split("\n");
      if (stackLines.length > MINIMUM_STACK_LINES) {
        // Extract file and line from first user code line in stack
        const userLine = stackLines.find(line =>
          !line.includes("OrchestrationError.js") &&
          !line.includes("node:internal")
        );
        if (userLine !== undefined && userLine !== "") {
          const match = /\((.*?):(\d+):\d+\)/.exec(userLine);
          if (match?.[1] !== undefined && match[2] !== undefined) {
            this.context.stackFile = match[1];

            this.context.stackLine = Number.parseInt(match[2], RADIX_DECIMAL);
          }
        }
      }
    }
  }

  /**
   * Generate a unique correlation ID for error tracking
   */
  generateCorrelationId(): string {
    const RANDOM_BYTES_LENGTH = 4;
    return `orch-error-${randomBytes(RANDOM_BYTES_LENGTH).toString("hex")}`;
  }

  /**
   * Get recovery guidance message
   */
  getRecoveryMessage(): string {
    const recoveryMessages: Record<string, string> = {
      [RECOVERY_STRATEGIES.FALLBACK]: "Continuing with alternative approach.",
      [RECOVERY_STRATEGIES.RETRY]: "The operation may succeed if attempted again.",
      [RECOVERY_STRATEGIES.SKIP]: "Skipping this item and continuing.",
      [RECOVERY_STRATEGIES.TERMINATE]: "Cannot continue. Please resolve the issue and restart.",
      [RECOVERY_STRATEGIES.USER_INPUT]: "Please check your configuration and try again."
    };

    return recoveryMessages[this.recoveryStrategy] ?? "No specific recovery guidance available.";
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const categoryMessages: Record<string, string> = {
      [ERROR_CATEGORIES.CONFIGURATION]: "Configuration or setup issue",
      [ERROR_CATEGORIES.IO]: "File or network access problem",
      [ERROR_CATEGORIES.ORCHESTRATION]: "Agent workflow or logic error",
      [ERROR_CATEGORIES.PARSING]: "Failed to process or read data",
      [ERROR_CATEGORIES.SYSTEM]: "System or resource error",
      [ERROR_CATEGORIES.VALIDATION]: "Invalid data format or missing required information"
    };

    const baseMessage = categoryMessages[this.category] ?? "An error occurred";
    const recoveryMessage = this.getRecoveryMessage();

    return `${baseMessage}. ${recoveryMessage}`;
  }

  /**
   * Check if this error is recoverable
   */
  isRecoverable(): boolean {
    return this.recoveryStrategy !== RECOVERY_STRATEGIES.TERMINATE;
  }

  /**
   * Check if this error should be retried
   */
  shouldRetry(): boolean {
    return this.recoveryStrategy === RECOVERY_STRATEGIES.RETRY;
  }

  /**
   * Convert error to JSON for logging/serialization
   */
  toJSON(): ErrorContext {
    return {
      category: this.category,
      cause: this.cause === undefined ? undefined : {
        message: this.cause.message,
        name: this.cause.name,
        stack: this.cause.stack ?? undefined
      },
      code: this.code,
      context: this.context,
      correlationId: this.correlationId,
      filePath: this.filePath ?? undefined,
      line: this.line ?? undefined,
      message: this.message,
      name: this.name,
      operation: this.operation,
      recoveryStrategy: this.recoveryStrategy,
      sessionId: this.sessionId ?? undefined,
      severity: this.severity,
      stack: this.stack ?? undefined,
      timestamp: this.timestamp
    };
  }

  /**
   * Get a formatted error summary for logging
   */
  toLogString(): string {
    const parts = [
      `[${this.correlationId}]`,
      `${this.category}:${this.code}`,
      this.operation ? `(${this.operation})` : "",
      "-",
      this.message
    ].filter(Boolean);

    return parts.join(" ");
  }
}

/**
 * Create error logging function that integrates with existing logHookActivity
 */
export function createErrorLogger(logHookActivity: (hookName: string, eventName: string, data: ErrorContext) => void): (error: OrchestrationError, additionalContext?: ErrorContext) => void {
  return function logError(error: OrchestrationError, additionalContext: ErrorContext = {}): void {
    const logData: ErrorContext = {
      category: error.errorCategory,
      correlationId: error.correlationId,
      error: error.toLogString(),
      errorCode: error.errorCode,
      operation: error.operation,
      recoveryStrategy: error.recoveryStrategy,
      severity: error.errorSeverity,
      status: "error",
      ...additionalContext,
      ...error.errorContext
    };

    logHookActivity("error-handler", "OrchestrationError", logData);
  };
}

/**
 * Error handling wrapper with standardized error capture
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: WithErrorHandlingOptions<T> = {}
): Promise<T> {
  const DEFAULT_RETRY_DELAY = 1000;

  const {

    category = ERROR_CATEGORIES.SYSTEM,

    code,

    context = {},

    fallback,

    onError,

    operation: operationName = "unknown",

    retries = 0,

    retryDelay = DEFAULT_RETRY_DELAY,

    sessionId
  } = options;

  let attempt = 0;
  let lastError: OrchestrationError | undefined = undefined;

  while (attempt <= retries) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      const orchError = error instanceof OrchestrationError
        ? error
        : OrchestrationError.fromError(error instanceof Error ? error : new Error(String(error)), {
          category,
          ...(code !== undefined && { code }),
          context,
          operation: operationName,
          ...(sessionId !== undefined && { sessionId })
        });

      lastError = orchError;

      // Log error if handler provided
      if (onError !== undefined) {
        onError(orchError);
      }

      // Check if we should retry
      if (attempt < retries && orchError.shouldRetry()) {
        attempt++;
        if (retryDelay > 0) {

          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
        continue;
      }

      // Use fallback if available
      if (fallback !== undefined) {
        return fallback(orchError);
      }

      // Re-throw if no fallback
      throw orchError;
    }
  }

  // Should never reach here, but TypeScript safety
  throw lastError ?? new OrchestrationError("Unexpected error in withErrorHandling");
}

export function withSyncErrorHandling<T>(
  operation: () => T,
  options: SyncErrorHandlingOptions<T> = {}
): T {
  const {

    category = ERROR_CATEGORIES.SYSTEM,

    code,

    context = {},

    fallback,

    onError,

    operation: operationName = "unknown",

    sessionId
  } = options;

  try {
    return operation();
  } catch (error) {
    const orchError = error instanceof OrchestrationError
      ? error
      : OrchestrationError.fromError(error instanceof Error ? error : new Error(String(error)), {
        category,
        ...(code !== undefined && { code }),
        context,
        operation: operationName,
        ...(sessionId !== undefined && { sessionId })
      });

    // Log error if handler provided
    if (onError !== undefined) {
      onError(orchError);
    }

    // Use fallback if available
    if (fallback !== undefined) {
      return fallback(orchError);
    }

    // Re-throw if no fallback
    throw orchError;
  }
}