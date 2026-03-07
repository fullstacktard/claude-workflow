/**
 * X Dashboard Types
 * Frontend-safe representations of X vault account data.
 * NEVER includes credentials, tokens, or proxy secrets.
 *
 * Security policy: docs/research/x-dashboard-security-sensitive-data-policy.md
 * OWASP API3:2023: Field-level authorization via DTO sanitization.
 */

/**
 * X account lifecycle states.
 * Defined inline (not imported from x-client-mcp) because the dashboard
 * communicates with x-client-mcp via JSON-RPC at runtime, not TypeScript
 * imports at compile time. Keeping types separate avoids coupling.
 */
export type AccountState =
  | "created"
  | "email_verified"
  | "phone_verified"
  | "profile_setup"
  | "warming"
  | "active"
  | "suspended"
  | "locked";

/**
 * Frontend-safe representation of an X vault account.
 * Maps from VaultAccount with all secret fields stripped.
 *
 * Fields NEVER exposed:
 * - credentials.password
 * - cookies.auth_token, cookies.ct0
 * - oauth_tokens.oauth_token, oauth_tokens.oauth_token_secret
 * - proxy.host, proxy.port, proxy.username, proxy.password, proxy.session_id
 */
export interface DashboardXAccount {
  /** Vault account UUID */
  id: string;
  /** Public X handle (e.g., "elonmusk") */
  handle: string;
  /** Account lifecycle state */
  state: AccountState;
  /** Email used for account (from credentials.email -- safe for localhost dashboard) */
  email: string;
  /** Whether a phone number is associated */
  has_phone: boolean;
  /** Whether X session cookies exist */
  has_cookies: boolean;
  /** When cookies were last harvested (ISO 8601), null if no cookies */
  cookie_harvested_at: string | null;
  /** Whether OAuth 1.0a tokens exist */
  has_oauth_tokens: boolean;
  /** When OAuth tokens were obtained (ISO 8601), null if none */
  oauth_obtained_at: string | null;
  /** Whether a proxy is configured */
  has_proxy: boolean;
  /** Proxy protocol type, null if no proxy */
  proxy_protocol: string | null;
  /** Warming progress, null if not warming */
  warming: {
    day: number;
    started_at: string;
    actions_today: number;
    last_action_at: string;
  } | null;
  /** How the account was created/acquired */
  creation_method: "browser" | "http" | "mobile" | "imported" | "geelark" | null;
  /** Account creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** When account was suspended, null if not suspended */
  suspended_at: string | null;
  /** When account was locked, null if not locked */
  locked_at: string | null;
  /** User notes (sanitized for XSS) */
  notes: string | null;
}

/**
 * Raw VaultAccount shape as returned by x_list_accounts MCP tool.
 * Used for typing the JSON-RPC response before sanitization.
 * This mirrors the VaultAccount interface from x-client-mcp/src/types.ts
 * but is defined here to avoid a direct import dependency on x-client-mcp
 * from the dashboard package (they communicate via JSON-RPC, not imports).
 */
export interface RawVaultAccountResponse {
  id: string;
  handle: string;
  state: string;
  /** Full vault data has credentials; summary from x_list_accounts does not */
  credentials?: {
    email: string;
    password: string;
    phone?: string;
  };
  cookies?: {
    auth_token: string;
    ct0: string;
    harvested_at?: string;
  };
  warming?: {
    day: number;
    started_at: string;
    actions_today: number;
    last_action_at: string;
  };
  proxy?: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol: string;
    session_id: string;
  };
  oauth_tokens?: {
    oauth_token: string;
    oauth_token_secret: string;
    obtained_at?: string;
  };
  creation_method?: string;
  created_at: string;
  updated_at: string;
  suspended_at?: string;
  locked_at?: string;
  notes?: string;
  /** Summary fields returned by x_list_accounts (instead of nested objects) */
  has_cookies?: boolean;
  warming_day?: number | null;
  warming_actions_today?: number;
}

/**
 * Sanitize a raw VaultAccount into a frontend-safe DashboardXAccount.
 * Strips ALL secret fields and replaces them with boolean presence flags.
 *
 * This is the ONLY place where VaultAccount -> DashboardXAccount mapping occurs.
 * All routes MUST use this function; never return raw vault data to the frontend.
 */
export function toSafeDashboardAccount(
  account: RawVaultAccountResponse,
): DashboardXAccount {
  // x_list_accounts returns summary objects (no credentials/cookies/proxy).
  // Handle both full VaultAccount and summary shapes gracefully.
  const hasCookies = account.has_cookies ?? Boolean(account.cookies);
  const warmingFromSummary =
    account.warming_day == null
      ? null
      : {
        day: account.warming_day,
        started_at: "",
        actions_today: account.warming_actions_today ?? 0,
        last_action_at: "",
      };

  return {
    id: account.id,
    handle: account.handle,
    state: account.state as AccountState,
    email: account.credentials?.email ?? "",
    has_phone: Boolean(account.credentials?.phone),
    has_cookies: hasCookies,
    cookie_harvested_at: account.cookies?.harvested_at ?? null,
    has_oauth_tokens: Boolean(account.oauth_tokens),
    oauth_obtained_at: account.oauth_tokens?.obtained_at ?? null,
    has_proxy: Boolean(account.proxy),
    proxy_protocol: account.proxy?.protocol ?? null,
    warming: account.warming ?? warmingFromSummary,
    creation_method:
      (account.creation_method as DashboardXAccount["creation_method"]) ?? null,
    created_at: account.created_at,
    updated_at: account.updated_at,
    suspended_at: account.suspended_at ?? null,
    locked_at: account.locked_at ?? null,
    notes: account.notes ? sanitizeText(account.notes) : null,
  };
}

/**
 * Basic XSS text sanitization for user-entered strings.
 * Escapes HTML entities to prevent script injection.
 * For a localhost dashboard this is defense-in-depth (React also auto-escapes).
 */
function sanitizeText(input: string): string {
  return input
    .replaceAll('&', "&amp;")
    .replaceAll('<', "&lt;")
    .replaceAll('>', "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll('\'', "&#x27;");
}
