/**
 * Retry utility with exponential backoff
 *
 * Implements retry logic with exponential backoff for transient failures.
 * Only retries on network errors, timeouts, and 5xx/429 HTTP errors.
 * Skips retries for authentication errors (401, 403).
 *
 * @module retryWithBackoff
 */

// Default retry configuration constants
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 3;
const EXPONENTIAL_BASE = 2;

// HTTP status code ranges
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
const HTTP_STATUS_CLIENT_ERROR_MAX = 500;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_SERVER_ERROR_MAX = 600;
const HTTP_STATUS_RATE_LIMIT = 429;

interface ErrorWithProperties {
  code?: string;
  name?: string;
  status?: number;
}

interface RetryOptions {
  baseDelay?: number;
  isTransientError?: (error: ErrorWithProperties) => boolean;
  maxRetries?: number;
}

/**
 * Create an HTTP error with status code
 *
 * Helper for creating errors that include HTTP status information.
 *
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @returns {Error} Error with status property
 *
 * @example
 * throw createHttpError(429, 'Rate limit exceeded');
 */
export function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Retry an async function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 100)
 * @param {Function} options.isTransientError - Custom error classifier (optional)
 * @returns {Promise<any>} Result from fn() or throws last error
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, baseDelay: 100 }
 * );
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    baseDelay = DEFAULT_BASE_DELAY_MS,
    isTransientError = isTransientErrorDefault,
    maxRetries = DEFAULT_MAX_RETRIES
  } = options;

  let lastError: Error = new Error("Retry failed");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const shouldRetry = isTransientError(error as ErrorWithProperties);

      if (!shouldRetry || attempt === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = baseDelay * Math.pow(EXPONENTIAL_BASE, attempt);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Default transient error classifier
 *
 * Determines if an error is worth retrying based on error type and status code.
 *
 * @private
 * @param {ErrorWithProperties} error - Error to classify
 * @returns {boolean} True if error is transient and should be retried
 */
function isTransientErrorDefault(error: ErrorWithProperties): boolean {
  // Retry on network errors and timeouts
  if (error.name === "AbortError") return true;
  if (error.code === "ECONNREFUSED") return true;
  if (error.code === "ECONNRESET") return true;
  if (error.code === "ETIMEDOUT") return true;
  if (error.code === "ENETUNREACH") return true;
  if (error.code === "ENOTFOUND") return true;

  // Retry on 5xx errors (server errors)
  if (error.status !== undefined && error.status >= HTTP_STATUS_SERVER_ERROR_MIN && error.status < HTTP_STATUS_SERVER_ERROR_MAX) return true;

  // Retry on rate limit (429)
  if (error.status === HTTP_STATUS_RATE_LIMIT) return true;

  // Don't retry auth errors (401, 403) or client errors (4xx)
  if (error.status !== undefined && error.status >= HTTP_STATUS_CLIENT_ERROR_MIN && error.status < HTTP_STATUS_CLIENT_ERROR_MAX) return false;

  // Unknown error type - don't retry by default
  return false;
}
