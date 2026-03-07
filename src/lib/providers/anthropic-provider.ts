/**
 * AnthropicProvider - Native Anthropic API provider
 *
 * Provides integration with Anthropic's native Claude API using OAuth credentials.
 * This is the default provider for Claude Code and maintains compatibility with
 * Claude Code's existing authentication and usage tracking mechanisms.
 *
 * Features:
 * - Uses Claude Code's native OAuth token handling
 * - Provides real-time usage tracking via Anthropic's OAuth API
 * - No environment variable overrides (uses Claude Code defaults)
 *
 * @class AnthropicProvider
 * @extends BaseProvider
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { BaseProvider } from "./base-provider.js";
import ApiUsageTracker from "./usage/api-usage-tracker.js";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

// Compute paths at runtime to support testing with different HOME directories
function getCredentialsFilePath(): string {
  const claudeDir = path.join(os.homedir(), ".claude");
  return path.join(claudeDir, ".credentials.json");
}

interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  type?: string;
  usageTracking?: string;
  /** Optional credentials file path for testing (defaults to ~/.claude/.credentials.json) */
  credentialsPath?: string;
}

export default class AnthropicProvider extends BaseProvider {
  usageTracker: ApiUsageTracker | undefined;
  private readonly credentialsPath: string;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.usageTracker = undefined;
    this.credentialsPath = config.credentialsPath ?? getCredentialsFilePath();
  }

  /**
   * Get environment variables for Claude Code
   *
   * Returns empty object because AnthropicProvider uses Claude Code's
   * default configuration. No ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN
   * overrides are needed - Claude Code handles authentication via OAuth.
   *
   * @returns {Object} Empty object (no environment overrides)
   *
   * @example
   * const provider = new AnthropicProvider();
   * const env = provider.getEnvironment();
   * // env = {} (uses Claude Code defaults)
   */
  
  override getDisplayName(): string {
    return "Anthropic";
  }

  /**
   * Validate provider configuration
   *
   * Checks if OAuth credentials are available in Claude's credentials file.
   * Returns true if valid OAuth access token exists, false otherwise.
   *
   * @async
   * @returns {Promise<boolean>} True if OAuth credentials exist and are valid
   *
   * @example
   * const provider = new AnthropicProvider();
   * const isValid = await provider.validate();
   * if (isValid) {
   *   console.log('Anthropic provider is ready');
   * } else {
   *   console.log('OAuth credentials not found');
   * }
   */
  
  override getEnvironment(): Record<string, string> {
    return {};
  }

  /**
   * Get usage tracker for this provider
   *
   * Returns an ApiUsageTracker instance that fetches real-time usage
   * data from Anthropic's OAuth API endpoint. The tracker is created
   * once and reused for subsequent calls.
   *
   * @returns {ApiUsageTracker} Usage tracker instance
   *
   * @example
   * const provider = new AnthropicProvider();
   * const tracker = provider.getUsageTracker();
   * const usage = await tracker.fetchUsage();
   * if (usage) {
   *   console.log('5-hour requests:', usage.five_hour.request_count);
   * }
   */
  
  override getUsageTracker(): ApiUsageTracker {
    this.usageTracker ??= new ApiUsageTracker();
    return this.usageTracker;
  }

  /**
   * Get human-readable display name
   *
   * Returns "Anthropic" for use in CLI output, monitor panels,
   * and user-facing messages.
   *
   * @returns {string} Display name: "Anthropic"
   *
   * @example
   * const provider = new AnthropicProvider();
   * console.log(`Using provider: ${provider.getDisplayName()}`);
   * // Output: Using provider: Anthropic
   */
  
  override async validate(): Promise<boolean> {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const fileContent = await fsp.readFile(this.credentialsPath, "utf8");
        const credentials = JSON.parse(fileContent) as ClaudeCredentials;
        const oauthData = credentials.claudeAiOauth;
        if (oauthData) {
          const hasOAuthToken = Boolean(oauthData.accessToken);
          return hasOAuthToken;
        }
      }
    } catch {
      // Ignore file read errors - credentials may not exist yet
    }
    return false;
  }
}
