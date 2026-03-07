/**
 * ProviderConfigError - Thrown when provider configuration is invalid
 *
 * Error code: PROVIDER_INVALID_CONFIG
 */
export class ProviderConfigError extends Error {
  code: string;
  context: Record<string, boolean | null | number | object | string>;

  /**
   * @param {string} message - Specific configuration error message
   * @param {Object} [configContext={}] - Configuration context for debugging
   */
  constructor(message: string, configContext: Record<string, boolean | null | number | object | string> = {}) {
    super(message);
    this.name = "ProviderConfigError";
    this.code = "PROVIDER_INVALID_CONFIG";
    this.context = configContext;
  }
}
