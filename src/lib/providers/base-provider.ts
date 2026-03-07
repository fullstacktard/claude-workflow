interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  type?: string;
  usageTracking?: string;
}

/**
 * BaseProvider - Abstract base class for model provider implementations
 *
 * Defines the interface that all provider types (Anthropic, Proxy, Custom)
 * must implement. Each method must be overridden by concrete provider classes.
 *
 * @abstract
 * @class BaseProvider
 */
export class BaseProvider {
  config: ProviderConfig;
  /**
   * Create a provider instance
   *
   * @param {Object} config - Provider configuration
   * @param {string} config.type - Provider type (anthropic, proxy, custom)
   * @param {string} [config.endpoint] - API endpoint URL for proxy/custom
   * @param {string} [config.apiKey] - API key for proxy/custom authentication
   * @param {string} [config.usageTracking] - Usage tracking mode (auto, api, local, disabled)
   */
  constructor(config: ProviderConfig = {}) {
    if (new.target === BaseProvider) {
      throw new Error("BaseProvider is an abstract class and cannot be instantiated directly");
    }
    this.config = config;
  }

  /**
   * Get human-readable display name for the provider
   *
   * Used in CLI output, monitor panel, and user-facing messages.
   * Examples: "Anthropic", "Z-AI", "Local Proxy", "Custom"
   *
   * @returns {string} Display name for this provider
   *
   * @example
   * // Anthropic
   * getDisplayName() {
   *   return 'Anthropic';
   * }
   *
   * @example
   * // Proxy with intelligent naming
   * getDisplayName() {
   *   if (this.config.endpoint?.includes('z.ai')) return 'Z-AI';
   *   if (this.config.endpoint?.includes('localhost')) return 'Local Proxy';
   *   return 'Proxy';
   * }
   *
   * @throws {Error} Not implemented - must be overridden by subclass
   */
  getDisplayName(): string {
    throw new Error(
      "getDisplayName() is not implemented. " +
      "Subclasses must override this method to return the provider name."
    );
  }

  /**
   * Get environment variables for Claude Code
   *
   * Returns environment variables that Claude Code should use when
   * communicating with the model endpoint. For Anthropic (default),
   * this returns an empty object. For proxies, returns BASE_URL and TOKEN.
   *
   * CRITICAL: This method MUST return an isolated environment object
   * WITHOUT modifying process.env. The returned object will be applied
   * by callers when spawning Claude Code child processes. This design
   * prevents test pollution, race conditions, and credential leaks.
   *
   * @returns {Object} Environment variables keyed by name
   * @returns {string} [return.ANTHROPIC_BASE_URL] - Custom endpoint URL
   * @returns {string} [return.ANTHROPIC_AUTH_TOKEN] - API key or token
   *
   * @example
   * // ✅ CORRECT - Anthropic implementation
   * getEnvironment() {
   *   return {}; // Uses Claude Code defaults
   * }
   *
   * @example
   * // ✅ CORRECT - Proxy implementation
   * getEnvironment() {
   *   return {
   *     ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
   *     ANTHROPIC_AUTH_TOKEN: 'key-...'
   *   };
   * }
   *
   * @example
   * // ❌ WRONG - NEVER mutate process.env
   * getEnvironment() {
   *   process.env.ANTHROPIC_BASE_URL = '...'; // FORBIDDEN!
   *   return {};
   * }
   *
   * @throws {Error} Not implemented - must be overridden by subclass
   */
  getEnvironment(): Record<string, string> {
    throw new Error(
      "getEnvironment() is not implemented. " +
      "Subclasses must override this method to return environment variables " +
      "WITHOUT modifying process.env."
    );
  }

  /**
   * Get usage tracker for this provider
   *
   * Returns a usage tracker instance appropriate for the provider type.
   * Anthropic and LiteLLM use API-based tracking (real-time cost/token data).
   * Proxies typically use local tracking (estimate from session logs).
   *
   * @returns {UsageTracker} Usage tracker instance
   *
   * @example
   * // Anthropic implementation
   * getUsageTracker() {
   *   return new ApiUsageTracker({
   *     endpoint: 'https://api.anthropic.com/api/oauth/usage',
   *     authHeader: 'Authorization',
   *     authPrefix: 'Bearer '
   *   });
   * }
   *
   * @example
   * // Proxy implementation (no API available)
   * getUsageTracker() {
   *   return new LocalUsageTracker();
   * }
   *
   * @throws {Error} Not implemented - must be overridden by subclass
   */
  getUsageTracker(): object {
    throw new Error(
      "getUsageTracker() is not implemented. " +
      "Subclasses must override this method to provide usage tracking."
    );
  }

  /**
   * Validate provider configuration and connectivity
   *
   * Checks that the provider is properly configured and can connect
   * to the endpoint. For Anthropic, checks OAuth credentials. For proxies,
   * validates endpoint reachability.
   *
   * @async
   * @returns {Promise<boolean>} True if provider is valid and ready to use
   *
   * @example
   * // Anthropic implementation
   * async validate() {
   *   const creds = await this.loadCredentials();
   *   return !!creds?.claudeAiOauth?.accessToken;
   * }
   *
   * @example
   * // Proxy implementation
   * async validate() {
   *   try {
   *     const response = await fetch(this.config.endpoint, { timeout: 5000 });
   *     return response.ok || response.status === 405;
   *   } catch {
   *     return false;
   *   }
   * }
   *
   * @throws {Error} Not implemented - must be overridden by subclass
   */
  validate(): Promise<boolean> {
    return Promise.reject(new Error(
      "validate() is not implemented. " +
      "Subclasses must override this method to check provider configuration."
    ));
  }
}
