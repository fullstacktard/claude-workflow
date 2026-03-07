/**
 * ProviderFactory - Factory for creating provider instances
 *
 * Validates configuration and instantiates the appropriate provider type.
 * Centralizes provider creation logic and ensures consistent validation.
 *
 * @module lib/providers/ProviderFactory
 */

import AnthropicProvider from "./anthropic-provider.js";
import { ProxyProvider } from "./proxy-provider.js";

const VALID_TYPES = ["anthropic", "proxy", "custom"] as const;

interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  type: string;
  usageTracking?: string;
}

/**
 * Create a provider instance from configuration
 *
 * Validates configuration and instantiates the appropriate provider type.
 * Ensures required fields are present and creates type-specific provider instances.
 * Centralizes provider creation logic for consistent validation across the codebase.
 *
 * @param {Object} config - Provider configuration
 * @param {string} config.type - Provider type ('anthropic', 'proxy', or 'custom')
 * @param {string} [config.endpoint] - Endpoint URL for proxy/custom providers (required for proxy/custom)
 * @param {string} [config.apiKey] - API key for the provider
 * @param {string} [config.usageTracking='auto'] - Usage tracking mode (auto|api|local|disabled)
 * @returns {AnthropicProvider|ProxyProvider} Provider instance ready to use
 * @throws {Error} If config is not a valid object
 * @throws {Error} If provider type is invalid or missing
 * @throws {Error} If endpoint is missing for proxy/custom providers
 *
 * @example
 * // Create Anthropic provider (default, uses OAuth)
 * const provider = createProvider({ type: 'anthropic' });
 * const env = provider.getEnvironment(); // {}
 * const valid = await provider.validate(); // true if OAuth token exists
 *
 * @example
 * // Create proxy provider (Z-AI)
 * const provider = createProvider({
 *   type: 'proxy',
 *   endpoint: 'https://api.z.ai/api/anthropic',
 *   apiKey: 'key-xyz123'
 * });
 * const env = provider.getEnvironment();
 * // { ANTHROPIC_BASE_URL: '...', ANTHROPIC_AUTH_TOKEN: 'key-xyz123' }
 *
 * @example
 * // Create custom provider (local LiteLLM)
 * const provider = createProvider({
 *   type: 'custom',
 *   endpoint: 'http://localhost:4000'
 * });
 * const displayName = provider.getDisplayName(); // "Local Proxy" or "Custom"
 *
 * @example
 * // Error handling
 * try {
 *   createProvider({ type: 'invalid' });
 * } catch (error) {
 *   console.error((error as Error).message);
 *   // => 'Invalid provider type: "invalid". Must be one of: anthropic, proxy, custom'
 * }
 */
export function createProvider(config: ProviderConfig): AnthropicProvider | ProxyProvider {
  // Validate config is an object (runtime check for JS callers)
   
  if (config === null || config === undefined || typeof config !== "object") {
    throw new Error("Provider config must be a non-null object");
  }

  const { endpoint, type } = config;

  // Validate provider type
  if (typeof type !== "string" || type === "" || !VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    throw new Error(
      `Invalid provider type: "${type}". Must be one of: ${VALID_TYPES.join(", ")}`
    );
  }

  // Validate endpoint for proxy/custom providers
  if ((type === "proxy" || type === "custom") && (endpoint === undefined || endpoint === "")) {
    throw new Error(
      `Provider type "${type}" requires "endpoint" configuration`
    );
  }

  // Create appropriate provider instance
  if (type === "anthropic") {
    return new AnthropicProvider(config);
  }

  if (type === "proxy" || type === "custom") {
    return new ProxyProvider(config);
  }

  // Should never reach here due to VALID_TYPES check above
  throw new Error(`Unknown provider type: ${type}`);
}
