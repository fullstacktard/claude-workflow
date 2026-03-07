/**
 * License state machine for offline resilience.
 *
 * Computes a 4-state license status from the cached JWT:
 *   - active  : JWT valid, NOT within 48h of expiry
 *   - grace   : JWT expired but within 7-day grace period (pro modules still work)
 *   - expired : Grace period exceeded (pro modules disabled)
 *   - free    : No license or no pro modules installed
 *
 * The state machine enables paying users to continue using pro features for
 * up to 7 days after JWT expiry, with escalating warnings.
 *
 * All functions are synchronous and never throw. Follows the same JWT decode
 * pattern as `getLicenseInfo()` / `getLicenseFeaturesSync()` in license-manager.ts.
 *
 * @module license-state
 */

import { readFileSync, existsSync } from "node:fs";
import { LICENSE_PATH } from "./license-manager.js";
import type { LicensePayload } from "./license-manager.js";

/**
 * License state machine states.
 *
 * - `active`  : JWT valid, not approaching expiry
 * - `grace`   : JWT expired but within 7-day grace period
 * - `expired` : Grace period exceeded
 * - `free`    : No license file or invalid JWT
 */
export type LicenseState = "active" | "grace" | "expired" | "free";

/** 48 hours in seconds -- triggers pre-expiry warning and auto-refresh */
const PRE_EXPIRY_WINDOW_S = 48 * 60 * 60;

/** 7-day grace period in seconds -- pro modules keep working after JWT expires */
const GRACE_PERIOD_S = 7 * 24 * 60 * 60;

/**
 * Full license state information including warning messages.
 */
export interface LicenseStateInfo {
  /** Current computed license state */
  state: LicenseState;
  /** Seconds until JWT expiry (negative if already expired) */
  secondsUntilExpiry: number | null;
  /** Seconds remaining in grace period (null if not in grace state) */
  graceSecondsRemaining: number | null;
  /** Warning message to display (null if no warning needed) */
  warning: string | null;
  /** Whether pro modules should be loaded (true for active + grace) */
  proModulesEnabled: boolean;
}

/** Reusable free-tier default state */
const FREE_STATE: LicenseStateInfo = {
  state: "free",
  secondsUntilExpiry: null,
  graceSecondsRemaining: null,
  warning: null,
  proModulesEnabled: false,
};

/**
 * Compute the current license state from the cached JWT.
 *
 * Synchronous -- reads JWT from disk and decodes the payload without crypto
 * verification (JWT was cryptographically verified when saved by
 * activateLicense/refreshLicense).
 *
 * Warning escalation:
 * 1. 48h pre-expiry: "License expires in X hours, refreshing..."
 * 2. Grace period:   "License expired X days ago. Pro modules work for Y more days."
 * 3. Expired:        "Pro license expired. Pro features disabled."
 *
 * Never throws. Returns free state on any error.
 */
export function computeLicenseState(): LicenseStateInfo {
  try {
    if (!existsSync(LICENSE_PATH)) {
      return FREE_STATE;
    }

    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (!token) {
      return FREE_STATE;
    }

    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return FREE_STATE;
    }

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as LicensePayload;

    if (typeof payload.exp !== "number") {
      return FREE_STATE;
    }

    const nowS = Math.floor(Date.now() / 1000);
    const secondsUntilExpiry = payload.exp - nowS;
    const secondsSinceExpiry = -secondsUntilExpiry;

    // ACTIVE: JWT valid and NOT within 48h of expiry
    if (secondsUntilExpiry > PRE_EXPIRY_WINDOW_S) {
      return {
        state: "active",
        secondsUntilExpiry,
        graceSecondsRemaining: null,
        warning: null,
        proModulesEnabled: true,
      };
    }

    // ACTIVE but approaching expiry: within 48h window
    if (secondsUntilExpiry > 0) {
      const hoursLeft = Math.ceil(secondsUntilExpiry / 3600);
      const hourSuffix = hoursLeft === 1 ? "" : "s";
      return {
        state: "active",
        secondsUntilExpiry,
        graceSecondsRemaining: null,
        warning: `License expires in ${String(hoursLeft)} hour${hourSuffix}, refreshing...`,
        proModulesEnabled: true,
      };
    }

    // GRACE: JWT expired but within 7-day grace period
    if (secondsSinceExpiry <= GRACE_PERIOD_S) {
      const graceDaysLeft = Math.ceil(
        (GRACE_PERIOD_S - secondsSinceExpiry) / 86_400,
      );
      const daysAgo = Math.floor(secondsSinceExpiry / 86_400);
      const daySuffix = daysAgo === 1 ? "" : "s";
      const graceSuffix = graceDaysLeft === 1 ? "" : "s";
      return {
        state: "grace",
        secondsUntilExpiry,
        graceSecondsRemaining: GRACE_PERIOD_S - secondsSinceExpiry,
        warning:
          `License expired ${String(daysAgo)} day${daySuffix} ago. ` +
          `Pro modules work for ${String(graceDaysLeft)} more day${graceSuffix}. ` +
          "Run `claude-workflow pro activate` to refresh.",
        proModulesEnabled: true,
      };
    }

    // EXPIRED: Grace period exceeded
    return {
      state: "expired",
      secondsUntilExpiry,
      graceSecondsRemaining: 0,
      warning:
        "Pro license expired. Pro features disabled. " +
        "Run `claude-workflow pro activate` to re-enable.",
      proModulesEnabled: false,
    };
  } catch {
    return FREE_STATE;
  }
}

/**
 * Check if license is within the 48-hour pre-expiry window.
 * Used to trigger proactive auto-refresh.
 *
 * Returns true when the JWT is still valid but will expire within 48 hours.
 */
export function isWithinPreExpiryWindow(): boolean {
  const stateInfo = computeLicenseState();
  return (
    stateInfo.state === "active" &&
    stateInfo.secondsUntilExpiry !== null &&
    stateInfo.secondsUntilExpiry <= PRE_EXPIRY_WINDOW_S
  );
}
