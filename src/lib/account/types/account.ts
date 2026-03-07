/**
 * Type definitions for multi-account OAuth management
 */

/**
 * OAuth token structure from Claude credentials
 */
export interface OAuthToken {
  /** OAuth access token for API calls */
  accessToken: string;
  /** Token expiration timestamp in milliseconds */
  expiresAt: number;
  /** Rate limit tier (e.g., "default_claude_max_20x") */
  rateLimitTier: string;
  /** OAuth refresh token for token renewal */
  refreshToken: string;
  /** OAuth scopes granted */
  scopes: string[];
  /** Subscription type (e.g., "max", "pro", "free") */
  subscriptionType: string;
}

/**
 * Account metadata for display and identification
 */
export interface AccountMetadata {
  /** When account was added to the manager */
  addedAt: number;
  /** User-provided alias for the account (e.g., "Work Account") */
  alias?: string;
  /** Email associated with the account (if known) */
  email?: string;
  /** Anthropic account UUID from ~/.claude.json - most reliable identifier for matching returning users */
  accountUuid?: string;
  /** When account was last used for API calls */
  lastUsedAt?: number;
  /** Account status (active by default, needs_reauth if token refresh failed permanently, rate_limited if hit usage limits) */
  status?: "active" | "needs_reauth" | "rate_limited";
  /** ISO 8601 timestamp when rate limit was hit (only set when status is rate_limited) */
  rateLimitedAt?: string;
  /** ISO 8601 timestamp when rate limit resets (from usage API, only set when status is rate_limited) */
  rateLimitResetsAt?: string;
  /** ISO 8601 timestamp when needs_reauth was first set (for backoff retry tracking) */
  needsReauthSince?: string;
  /** Number of refresh retries attempted since needs_reauth was set */
  refreshRetryCount?: number;
  /** ISO 8601 timestamp of last refresh retry attempt */
  lastRefreshRetryAt?: string;
  /** Whether this account is pinned (prevents auto-rotation away from it) */
  pinned?: boolean;
}

/**
 * Complete account entry combining token and metadata
 */
export interface Account {
  /** Unique identifier for the account (UUID v4) */
  id: string;
  /** Account metadata for display */
  metadata: AccountMetadata;
  /** OAuth token credentials */
  token: OAuthToken;
}

/**
 * Structure of the accounts.json file
 */
export interface AccountsFile {
  /** ID of the currently active account */
  activeAccountId: string | null;
  /** All stored accounts */
  accounts: Account[];
  /** Schema version for future migrations */
  schemaVersion: number;
}

/**
 * Events emitted by AccountManager
 */
export interface AccountManagerEvents {
  /** Emitted when a new account is added */
  "account-added": (account: Account) => void;
  /** Emitted when an account is removed */
  "account-removed": (accountId: string) => void;
  /** Emitted when active account changes */
  "account-switched": (fromId: string | null, toId: string) => void;
  /** Emitted when an account is updated */
  "account-updated": (account: Account) => void;
}
