/**
 * TypeScript interfaces for Email Account management dashboard.
 * These types represent the FRONTEND-SAFE DTO -- no secrets ever reach the browser.
 *
 * SECURITY: The backend maps vault email account -> DashboardEmailAccount at the route
 * handler level, stripping sensitive fields (password, etc.).
 *
 * @module types/email-accounts
 */

/** Email provider types */
export type EmailProvider = "mail.com" | "gmx.com";

/** Health status for an email account */
export type EmailHealthStatus = "healthy" | "unhealthy" | "unknown";

/**
 * Frontend-safe representation of an email vault account.
 * NEVER includes credentials or passwords.
 * Backend maps vault email account -> DashboardEmailAccount at the route handler level.
 *
 * Mirrors: packages/claude-workflow/src/lib/dashboard/types/email-dashboard.ts#DashboardEmailAccount
 */
export interface DashboardEmailAccount {
  /** Vault account UUID */
  id: string;
  /** Full email address (e.g., "user@mail.com") */
  email: string;
  /** Email service provider */
  provider: EmailProvider;
  /** Email domain (e.g., "mail.com", "email.com", "gmx.com") */
  domain: string;
  /** First name used during signup */
  first_name: string;
  /** Last name used during signup */
  last_name: string;
  /** Date of birth used during signup */
  date_of_birth: { day: number; month: number; year: number };
  /** Whether a password is stored (always true for email accounts) */
  has_password: boolean;
  /** Whether a phone number was used during signup */
  has_phone: boolean;
  /** Current health status */
  health_status: EmailHealthStatus;
  /** When health was last checked (ISO 8601), null if never */
  last_health_check_at: string | null;
  /** Account creation timestamp (ISO 8601) */
  created_at: string;
  /** Last update timestamp (ISO 8601) */
  updated_at: string;
  /** User notes (sanitized for XSS on backend) */
  notes: string | null;
}

/** All possible email activity action types */
export type EmailActivityAction =
  | "account_created"
  | "inbox_read"
  | "health_checked"
  | "account_deleted"
  | "details_viewed"
  | "code_waited";

/** Activity log entry for email operations */
export interface EmailActivityEntry {
  /** Unique entry ID */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Action performed */
  action: EmailActivityAction;
  /** Account ID */
  accountId: string;
  /** Email address */
  email: string;
  /** Additional context about the action */
  details?: string;
  /** Whether the action succeeded */
  success: boolean;
}

/**
 * Single inbox message (frontend representation).
 * Mirrors: packages/claude-workflow/src/lib/dashboard/types/email-dashboard.ts#DashboardEmailMessage
 */
export interface EmailInboxMessage {
  /** Message UID from IMAP/lightmailer */
  uid: number;
  /** Sender address (sanitized - HTML entities escaped) */
  from: string;
  /** Email subject (sanitized - HTML entities escaped) */
  subject: string;
  /** Date received (ISO 8601) */
  date: string;
  /** First ~200 chars of plain text body (sanitized) */
  preview: string;
  /** Whether the message has HTML content */
  has_html: boolean;
}

/**
 * Response from inbox read endpoint.
 * Mirrors: packages/claude-workflow/src/lib/dashboard/types/email-dashboard.ts#InboxResponse
 */
export interface InboxResponse {
  /** Email address of the account */
  email: string;
  /** Array of inbox messages */
  messages: EmailInboxMessage[];
  /** Total message count */
  message_count: number;
  /** Whether response was from cache */
  cached: boolean;
  /** ISO timestamp of when data was fetched */
  fetched_at: string;
  /** Seconds until cache expires and fresh fetch is allowed */
  cache_ttl_remaining: number;
}

/** Job status for async email operations (e.g., account creation) */
export type EmailJobStatus =
  | { status: "running"; progress: string }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string };
