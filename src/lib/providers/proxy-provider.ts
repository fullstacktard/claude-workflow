import { ProviderConfigError } from "../errors/index.js";
import { BaseProvider } from "./base-provider.js";
import { LocalUsageTracker } from "./usage/local-usage-tracker.js";

declare const fetch: typeof globalThis.fetch;
declare const AbortController: typeof globalThis.AbortController;


/**
 * ProxyProvider - Provider for alternative Anthropic-compatible endpoints
 *
 * Supports Z-AI, CCProxy, LiteLLM, and custom proxy endpoints that implement
 * the Anthropic API specification. Used for cost optimization and access to
 * alternative models.
 *
 * @class ProxyProvider
 * @extends BaseProvider
 */
export class ProxyProvider extends BaseProvider {
  override config: { apiKey?: string; endpoint: string; };
  usageTracker: LocalUsageTracker | undefined;

  /**
   * Create a proxy provider instance
   *
   * @param {Object} config - Provider configuration
   * @param {string} config.endpoint - Proxy endpoint URL (required)
   * @param {string} [config.apiKey] - API key for authentication (optional)
   * @throws {Error} If config is invalid or endpoint is missing/malformed
   *
   * @example
   * // Z-AI proxy
   * new ProxyProvider({
   *   endpoint: 'https://api.z.ai/api/anthropic',
   *   apiKey: 'sk-...'
   * })
   *
   * @example
   * // Local LiteLLM
   * new ProxyProvider({
   *   endpoint: 'http://localhost:4000'
   * })
   */
  constructor(config: { apiKey?: string; endpoint?: string; } = {}) {
    super(config);
    this.usageTracker = undefined;

    // Validate config is an object
    if (typeof config !== "object") {
      throw new ProviderConfigError(
        "ProxyProvider config must be a non-null object",
        { providedConfig: config }
      );
    }

    // Validate endpoint is provided
    if (config.endpoint === undefined || config.endpoint === "") {
      throw new ProviderConfigError(
        "ProxyProvider requires \"endpoint\" configuration",
        { config }
      );
    }

    // Assign config with proper typing
    // Use conditional property assignment to avoid exactOptionalPropertyTypes issues
    this.config = {
      ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
      endpoint: config.endpoint
    };

    // Validate endpoint URL format
    this.validateEndpoint(this.config.endpoint);
  }

  override getDisplayName(): string {
    if (this.config.endpoint.includes("z.ai")) {
      return "Z-AI";
    }
    if (this.config.endpoint.includes("localhost")) {
      return "Local Proxy";
    }
    return "Proxy";
  }

  /**
   * Get environment variables for Claude Code
   *
   * Returns the custom endpoint URL and authentication token that Claude Code
   * should use when communicating with the proxy.
   *
   * @returns {Object} Environment variables
   * @returns {string} return.ANTHROPIC_BASE_URL - Proxy endpoint URL
   * @returns {string} [return.ANTHROPIC_AUTH_TOKEN] - API key (only included if provided)
   */
  
  override getEnvironment(): Record<string, string> {
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: this.config.endpoint
    };

    // Only include auth token if it has a value
    if ((this.config.apiKey?.toString().trim() ?? "") !== "") {

      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey ?? "";
    }

    return env;
  }

  /**
   * Validate proxy endpoint is reachable
   *
   * Performs an HTTP HEAD request to the endpoint with a 5 second timeout.
   * Accepts status 405 (Method Not Allowed) as success since some proxies
   * don't support HEAD but are still functional.
   *
   * @async
   * @returns {Promise<boolean>} True if endpoint is reachable
   */
  
  override getUsageTracker(): LocalUsageTracker {
    this.usageTracker ??= new LocalUsageTracker();
    return this.usageTracker;
  }

  /**
   * Get usage tracker for this provider
   *
   * Proxies don't have usage APIs, so returns a local usage tracker that
   * estimates consumption from session logs. The tracker instance is cached
   * and reused across calls for efficiency.
   *
   * @returns {LocalUsageTracker} Cached local usage tracker instance
   */
  
  override async validate(): Promise<boolean> {
    const VALIDATION_TIMEOUT_MS = 5000;
    const METHOD_NOT_ALLOWED = 405;

    try {

      const controller = new AbortController();

      const timeoutId = setTimeout((): void => { controller.abort(); }, VALIDATION_TIMEOUT_MS);

      const headers: Record<string, string> = {};
      if ((this.config.apiKey ?? "") !== "") {
        const apiKey: string = this.config.apiKey ?? "";
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(this.config.endpoint, {
        headers,
        method: "HEAD",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Success if OK or if HEAD not supported (405)
      return response.ok || response.status === METHOD_NOT_ALLOWED;
    } catch {
      // Network error, timeout, or other fetch error
      return false;
    }
  }

  /**
   * Get human-readable display name for UI
   *
   * Detects provider type from endpoint URL:
   * - "Z-AI" for api.z.ai endpoints
   * - "Local Proxy" for localhost endpoints
   * - "Proxy" for all other endpoints
   *
   * @returns {string} Display name
   */
  
  /**
   * Validate endpoint URL format, protocol, and port range
   *
   * @private
   * @param {string} url - URL to validate
   * @throws {Error} If URL is invalid, uses unsupported protocol, or port is outside valid range (1-65535)
   */
  validateEndpoint(url: string): void {
    try {
      
      const parsed = new URL(url);

      // Only allow http: and https: protocols
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new ProviderConfigError(
          `Invalid protocol "${parsed.protocol}". Only http: and https: are allowed`,
          { endpoint: url, protocol: parsed.protocol }
        );
      }

      // Ensure hostname is present
      if (parsed.hostname === "") {
        throw new ProviderConfigError(
          "Endpoint URL must include a valid hostname",
          { endpoint: url }
        );
      }

      // Validate port range (1-65535) if port is explicitly specified
      if (parsed.port !== "") {
        const MIN_PORT = 1;
        const MAX_PORT = 65_535;
        const DECIMAL_RADIX = 10;

        const portNum = Number.parseInt(parsed.port, DECIMAL_RADIX);
        if (Number.isNaN(portNum) || portNum < MIN_PORT || portNum > MAX_PORT) {
          throw new ProviderConfigError(
            `Invalid port "${parsed.port}". Port must be between 1 and 65535`,
            { endpoint: url, port: parsed.port }
          );
        }
      }
    } catch (error) {
      // URL constructor throws TypeError for invalid URLs
      if (error instanceof TypeError) {
        throw new ProviderConfigError(
          `Invalid endpoint URL: "${url}"`,
          { endpoint: url, originalError: (error as Error).message }
        );
      }
      // Re-throw our own validation errors
      throw error;
    }
  }
}
