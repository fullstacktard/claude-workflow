/**
 * LicenseError - Thrown for license validation and activation failures.
 *
 * Public API functions in license-manager.ts catch these internally
 * and return null with console.warn for graceful degradation.
 */

export type LicenseErrorCode =
  | "CACHE_ERROR"
  | "EXPIRED"
  | "INVALID_KEY"
  | "MACHINE_MISMATCH"
  | "MISSING_TOKEN"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "SIGNATURE_INVALID";

export class LicenseError extends Error {
  constructor(
    message: string,
    public readonly code: LicenseErrorCode,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "LicenseError";
  }
}
