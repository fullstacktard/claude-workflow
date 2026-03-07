/**
 * TypeScript interfaces for X Account management dashboard.
 * These types represent the FRONTEND-SAFE DTO -- no secrets ever reach the browser.
 * See: docs/research/x-dashboard-security-sensitive-data-policy.md
 *
 * SECURITY: The backend maps VaultAccount -> DashboardXAccount at the route handler level,
 * stripping all sensitive fields (password, auth_token, ct0, proxy credentials, etc.).
 */

/** Account lifecycle states (mirrors backend AccountState in x-dashboard.ts) */
export type XAccountState =
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
 * NEVER includes credentials, tokens, or proxy secrets.
 * Backend maps VaultAccount -> DashboardXAccount at the route handler level.
 */
export interface DashboardXAccount {
  /** Vault account UUID */
  id: string;
  /** Public X handle (e.g., "elonmusk") */
  handle: string;
  /** Account lifecycle state */
  state: XAccountState;
  /** Email used for account (from credentials.email) */
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
  /** User notes (sanitized for XSS on backend) */
  notes: string | null;
}

/** All possible activity action types */
export type XActivityAction =
  | "tweet"
  | "like"
  | "follow"
  | "warming_step"
  | "health_check"
  | "import"
  | "profile_setup"
  | "timeline"
  | "notifications"
  | "geelark_login"
  | "geelark_tweet"
  | "geelark_health"
  | "geelark_cookie_refresh";

/** Activity log entry for X operations */
export interface XActivityEntry {
  id: string;
  accountId: string;
  handle: string;
  action: XActivityAction;
  status: "success" | "error" | "pending";
  message: string;
  timestamp: string;
}

/** Draft tweet for composition */
export interface TweetDraft {
  text: string;
  replyTo?: string;
}

/** Progress indicator for long-running X operations */
export interface XOperationProgress {
  operationId: string;
  accountId: string;
  type: "health_check" | "warming_step" | "cookie_harvest" | "tweet";
  status: "pending" | "running" | "success" | "error";
  message?: string;
  startedAt: string;
  completedAt?: string;
}

/* ============================================
 * GEELARK CLOUD PHONE TYPES
 * ============================================
 * Frontend-specific types for the GeeLark phone management panel.
 * Mirrors relevant types from packages/geelark-mcp/src/types/geelark-types.ts
 * and packages/geelark-mcp/src/server.ts (AsyncJob).
 */

/** Phone status values from GeeLark API (PhoneStatus enum) */
export type PhoneStatusValue = 0 | 1 | 2 | 3;

/** Frontend phone representation (subset of PhoneListEntry + dashboard enrichments) */
export interface GeeLarkPhone {
  /** GeeLark phone UUID */
  id: string;
  /** User-assigned phone name */
  serialName: string;
  /** Auto-generated serial number */
  serialNo: string;
  /** Phone lifecycle status: 0=Running, 1=Starting, 2=Stopped, 3=Expired */
  status: PhoneStatusValue;
  /** Proxy configuration, undefined if no proxy set */
  proxy?: {
    type: string;
    server: string;
    port: number;
  };
  /** Billing mode (from GeeLark API) */
  chargeMode: number;
  /** ISO timestamp when the phone was started (for billing timer), null if stopped */
  startedAt: string | null;
  /** Associated X account handle (if any), null if unlinked */
  associatedHandle: string | null;
  /** Equipment info for expanded detail view */
  equipmentInfo?: {
    brand: string;
    model: string;
    osVersion: string;
  };
}

/** Job stage identifiers for pipelines */
export type JobStage =
  | "create_phone"
  | "launch_phone"
  | "install_app"
  | "signup"
  | "verify_email"
  | "harvest_cookies"
  | "login"
  | "post_tweet"
  | "health_check"
  | "extract_cookies";

/** Visual state of a single stepper step */
export type StepState = "pending" | "in_progress" | "completed" | "failed";

/** Frontend job representation (from AsyncJob in geelark-mcp server.ts) */
export interface GeeLarkJob {
  /** Unique job UUID */
  id: string;
  /** Job type identifier */
  type: "create_x_account" | "login_x_account" | "post_tweet" | "check_health";
  /** Current job lifecycle status */
  status: "running" | "completed" | "failed";
  /** Free-form progress description (parsed by parseJobStage) */
  progress: string;
  /** ISO timestamp when job started */
  started_at: string;
  /** ISO timestamp when job completed, undefined if still running */
  completed_at?: string;
  /** Job result data, present when completed or partially completed */
  result?: {
    success?: boolean;
    phone_id?: string;
    account_handle?: string;
    has_cookies?: boolean;
    step_failed?: string;
    [key: string]: unknown;
  };
  /** Error message, present when status is "failed" */
  error?: string;
}

/** Ordered list of job stages for the CREATION pipeline */
export const JOB_STAGE_ORDER: JobStage[] = [
  "create_phone",
  "launch_phone",
  "install_app",
  "signup",
  "verify_email",
  "harvest_cookies",
];

/** Stage order for login_x_account jobs */
export const LOGIN_STAGE_ORDER: JobStage[] = ["login", "extract_cookies"];

/** Stage order for post_tweet jobs */
export const TWEET_STAGE_ORDER: JobStage[] = ["login", "post_tweet"];

/** Stage order for check_health jobs */
export const HEALTH_STAGE_ORDER: JobStage[] = ["login", "health_check"];

/** Map from job type to its ordered stage list */
export const JOB_TYPE_STAGE_ORDERS: Record<GeeLarkJob["type"], JobStage[]> = {
  create_x_account: JOB_STAGE_ORDER,
  login_x_account: LOGIN_STAGE_ORDER,
  post_tweet: TWEET_STAGE_ORDER,
  check_health: HEALTH_STAGE_ORDER,
};

/** Human-readable labels for each job stage */
export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  create_phone: "Create Phone",
  launch_phone: "Launch Phone",
  install_app: "Install X App",
  signup: "Sign Up",
  verify_email: "Verify Email",
  harvest_cookies: "Harvest Cookies",
  login: "Login",
  post_tweet: "Post Tweet",
  health_check: "Health Check",
  extract_cookies: "Extract Cookies",
};

/** Human-readable labels for each job type */
export const JOB_TYPE_LABELS: Record<GeeLarkJob["type"], string> = {
  create_x_account: "Create Account",
  login_x_account: "Login",
  post_tweet: "Post Tweet",
  check_health: "Health Check",
};

/**
 * Parse the free-form progress string from GeeLark job into a structured stage enum.
 * Falls back to "create_phone" (first stage) if no pattern matches.
 */
export function parseJobStage(progress: string): JobStage {
  const lower = progress.toLowerCase();
  if (lower.includes("extract") && lower.includes("cookie")) return "extract_cookies";
  if (lower.includes("cookie") || lower.includes("extracting") || lower.includes("harvest")) return "harvest_cookies";
  if (lower.includes("health") || lower.includes("checking health")) return "health_check";
  if (lower.includes("posting tweet") || lower.includes("post_tweet")) return "post_tweet";
  if (lower.includes("logging in") || lower.includes("login")) return "login";
  if (lower.includes("email verification") || lower.includes("verification code") || lower.includes("verify")) return "verify_email";
  if (lower.includes("signup flow") || lower.includes("signing up") || lower.includes("signup")) return "signup";
  if (lower.includes("installing") || lower.includes("install")) return "install_app";
  if (lower.includes("launching phone") || lower.includes("starting phone") || lower.includes("launching")) return "launch_phone";
  if (lower.includes("creating cloud phone") || lower.includes("creating phone")) return "create_phone";
  return "create_phone";
}

/**
 * Cookie freshness levels for UI display.
 * Determines color-coded indicator based on cookie age.
 */
export type CookieFreshness = "fresh" | "aging" | "stale" | "none" | "never";

/**
 * Compute cookie freshness level for UI display.
 * - fresh (green): cookies harvested within 7 days
 * - aging (yellow): cookies harvested 7-14 days ago
 * - stale (orange): cookies harvested more than 14 days ago
 * - none (red): account has no cookies
 * - never (gray): cookies have never been harvested
 */
export function computeCookieFreshness(
  hasCookies: boolean,
  harvestedAt: string | null,
): CookieFreshness {
  if (!hasCookies && harvestedAt === null) return "never";
  if (!hasCookies) return "none";
  if (harvestedAt === null) return "never";

  const ageMs = Date.now() - new Date(harvestedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 7) return "fresh";
  if (ageDays < 14) return "aging";
  return "stale";
}

/**
 * Get human-readable label for cookie freshness.
 */
export function getCookieFreshnessLabel(
  freshness: CookieFreshness,
  harvestedAt: string | null,
): string {
  switch (freshness) {
    case "fresh": {
      if (!harvestedAt) return "Fresh cookies";
      const ageMs = Date.now() - new Date(harvestedAt).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      if (ageDays < 1) return `Cookies ${ageHours}h old`;
      return `Cookies ${ageDays}d old`;
    }
    case "aging": {
      if (!harvestedAt) return "Cookies aging";
      const ageDays = Math.floor((Date.now() - new Date(harvestedAt).getTime()) / (1000 * 60 * 60 * 24));
      return `Cookies ${ageDays}d old`;
    }
    case "stale": {
      if (!harvestedAt) return "Cookies stale";
      const ageDays = Math.floor((Date.now() - new Date(harvestedAt).getTime()) / (1000 * 60 * 60 * 24));
      return `Cookies ${ageDays}d old`;
    }
    case "none":
      return "No cookies";
    case "never":
      return "Never harvested";
  }
}
