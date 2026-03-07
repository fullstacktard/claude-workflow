/**
 * Email Dashboard Types
 * Frontend-safe representations of email vault account data.
 * NEVER includes passwords or phone numbers.
 *
 * Security policy: docs/research/email-dashboard-security-sanitization.md
 * OWASP API3:2023: Field-level authorization via DTO sanitization.
 */

// ============================================================================
// Provider type
// ============================================================================

export type EmailProvider = "mail.com" | "gmx.com";

// ============================================================================
// Raw MCP response shapes (for typing JSON-RPC responses before sanitization)
// ============================================================================

/**
 * Raw shape from email_list_accounts MCP tool.
 * List response excludes password, first_name, last_name, dob, phone_used.
 */
export interface RawEmailListItem {
  id: string;
  email: string;
  provider: EmailProvider;
  domain: string;
  created_at: string;
}

export interface RawEmailListResponse {
  total: number;
  accounts: RawEmailListItem[];
}

/**
 * Raw shape from email_get_account MCP tool.
 * Contains PLAINTEXT password -- must be sanitized before frontend delivery.
 */
export interface RawEmailGetAccountResponse {
  id: string;
  email: string;
  password: string;
  provider: EmailProvider;
  domain: string;
  first_name: string;
  last_name: string;
  date_of_birth: {
    day: number;
    month: number;
    year: number;
  };
  created_at: string;
}

/**
 * Raw shape from email_read_inbox MCP tool.
 */
export interface RawEmailInboxMessage {
  uid: number;
  from: string;
  subject: string;
  date: string;
  preview?: string;
}

export interface RawEmailReadInboxResponse {
  email: string;
  method: "http" | "browser";
  message_count: number;
  messages: RawEmailInboxMessage[];
}

/**
 * Raw shape from email_check_health MCP tool.
 */
export interface EmailCheckHealthResponse {
  email: string;
  healthy: boolean;
  method: "http" | "browser" | "both_failed";
  error?: string;
}

/**
 * Raw shape from email_create_account MCP tool (immediate async response).
 */
export interface EmailCreateAccountResponse {
  job_id: string;
  status: "running";
  progress: string;
  message: string;
}

/**
 * Raw shapes from email_check_job_status MCP tool.
 */
export interface EmailJobStatusRunning {
  job_id: string;
  type: "create_account";
  status: "running";
  progress: string;
  elapsed_seconds: number;
  started_at: string;
}

export interface EmailJobStatusCompleted {
  job_id: string;
  type: "create_account";
  status: "completed";
  progress: string;
  elapsed_seconds: number;
  started_at: string;
  completed_at: string;
  result: {
    success: true;
    account_id: string;
    email: string;
    password: string;
    provider: EmailProvider;
    proxy_country: string;
    method: "browser" | "http";
  };
}

export interface EmailJobStatusFailed {
  job_id: string;
  type: "create_account";
  status: "failed";
  progress: string;
  elapsed_seconds: number;
  started_at: string;
  completed_at: string;
  error: string;
  result?: {
    success: false;
    error: string;
    step_failed?: string;
    countries_tried: string[];
  };
}

export type EmailJobStatus =
  | EmailJobStatusRunning
  | EmailJobStatusCompleted
  | EmailJobStatusFailed;

/**
 * Raw shape from email_delete_account MCP tool.
 */
export interface EmailDeleteAccountResponse {
  deleted: true;
  account_id: string;
  email: string;
}

// ============================================================================
// Sanitized frontend-safe DTOs
// ============================================================================

/**
 * Frontend-safe representation of an email vault account.
 * Maps from raw MCP response with password stripped.
 *
 * Fields NEVER exposed:
 * - password (replaced with has_password boolean)
 * - phone_used (replaced with has_phone boolean)
 */
export interface DashboardEmailAccount {
  /** Vault account UUID */
  id: string;
  /** Full email address */
  email: string;
  /** Email provider */
  provider: EmailProvider;
  /** Email domain (e.g., "mail.com", "email.com", "gmx.com") */
  domain: string;
  /** First name used during signup */
  first_name: string;
  /** Last name used during signup */
  last_name: string;
  /** Date of birth used during signup */
  date_of_birth: { day: number; month: number; year: number };
  /** Whether a password exists (always true for email accounts) */
  has_password: boolean;
  /** Whether a phone number was used during signup */
  has_phone: boolean;
  /** Account health status from last check */
  health_status: "healthy" | "unhealthy" | "unknown";
  /** When health was last checked (ISO 8601), null if never */
  last_health_check_at: string | null;
  /** Account creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** User notes (sanitized for XSS) */
  notes: string | null;
}

/**
 * Frontend-safe representation of an email message.
 * HTML body is NEVER included.
 */
export interface DashboardEmailMessage {
  /** Message UID from IMAP/lightmailer */
  uid: number;
  /** Sender address (sanitized - HTML entities escaped) */
  from: string;
  /** Subject line (sanitized - HTML entities escaped) */
  subject: string;
  /** Date received */
  date: string;
  /** First 200 characters of plain text body (sanitized) */
  preview: string;
  /** Whether an HTML body exists (enables "View as HTML" button) */
  has_html: boolean;
}

/**
 * Inbox response envelope with caching metadata.
 */
export interface InboxResponse {
  email: string;
  messages: DashboardEmailMessage[];
  message_count: number;
  /** Whether this response came from cache */
  cached: boolean;
  /** When inbox was last fetched from provider (ISO 8601) */
  fetched_at: string;
  /** Seconds until cache expires and fresh fetch is allowed */
  cache_ttl_remaining: number;
}

// ============================================================================
// Sanitization functions
// ============================================================================

/**
 * Normalize email date strings from MCP tool into ISO 8601.
 * Handles formats like "Thursday, March 05, 2026 at 3:00 AM" where
 * the "at" separator makes new Date() return Invalid Date.
 */
function normalizeEmailDate(dateStr: string): string {
  // Remove "at " between date and time portions
  const cleaned = dateStr.replace(" at ", " ");
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  // If still invalid, try the original string
  const original = new Date(dateStr);
  if (!isNaN(original.getTime())) return original.toISOString();
  // Last resort: return as-is (frontend will show raw string)
  return dateStr;
}

/**
 * Basic XSS text sanitization for user-entered strings.
 * Escapes HTML entities to prevent script injection.
 * For a localhost dashboard this is defense-in-depth (React also auto-escapes).
 */
function sanitizeText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/**
 * Sanitize a raw EmailAccount (from email_get_account) into a frontend-safe
 * DashboardEmailAccount. Strips the password and phone number, replaces with
 * boolean flags.
 *
 * This is the ONLY place where raw email account data -> DashboardEmailAccount
 * mapping occurs. All routes MUST use this function; never return raw vault
 * data to the frontend.
 *
 * For list responses (email_list_accounts) which already exclude password,
 * the function gracefully handles missing fields.
 */
export function toSafeDashboardEmailAccount(
  account: RawEmailGetAccountResponse | RawEmailListItem,
  healthStatus?: { healthy: boolean; checked_at: string },
): DashboardEmailAccount {
  // email_list_accounts returns a minimal shape without password/name/dob.
  // email_get_account returns the full shape. Handle both.
  const fullAccount = account as Partial<RawEmailGetAccountResponse>;

  return {
    id: account.id,
    email: account.email,
    provider: account.provider,
    domain: account.domain,
    first_name: fullAccount.first_name ?? "",
    last_name: fullAccount.last_name ?? "",
    date_of_birth: fullAccount.date_of_birth ?? { day: 0, month: 0, year: 0 },
    has_password: "password" in account ? Boolean(fullAccount.password) : true,
    has_phone: false, // phone_used not returned by email_get_account
    health_status: healthStatus?.healthy
      ? "healthy"
      : (healthStatus
        ? "unhealthy"
        : "unknown"),
    last_health_check_at: healthStatus?.checked_at ?? null,
    created_at: account.created_at,
    updated_at:
      (fullAccount as Record<string, unknown>).updated_at as string ??
      account.created_at,
    notes: (fullAccount as Record<string, unknown>).notes
      ? sanitizeText(
        (fullAccount as Record<string, unknown>).notes as string,
      )
      : null,
  };
}

/**
 * Sanitize a raw inbox message into a frontend-safe DashboardEmailMessage.
 * React auto-escapes all JSX text content, so we don't call sanitizeText()
 * here — doing so double-escapes HTML entities already present in the raw
 * email (e.g. &#8203; → &amp;#8203; rendered as literal "&#8203;").
 */
export function toSafeDashboardMessage(
  msg: RawEmailInboxMessage,
): DashboardEmailMessage {
  return {
    uid: msg.uid,
    from: msg.from,
    subject: msg.subject,
    date: normalizeEmailDate(msg.date),
    preview: (msg.preview ?? "").slice(0, 200),
    has_html: false, // MCP tool does not expose html in list view
  };
}
