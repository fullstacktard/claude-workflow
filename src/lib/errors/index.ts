/**
 * Error classes for provider configuration and orchestration
 *
 * This barrel file re-exports commonly used error classes for convenience.
 * For orchestration errors, import directly from OrchestrationError.js
 * to get the full set of utilities and constants.
 */

// Provider-specific errors
export { ProviderConfigError } from "./provider-config-error.js";

// License-specific errors
export { LicenseError, type LicenseErrorCode } from "./license-error.js";
