/**
 * License Manager - Ed25519 JWT validation for offline premium feature gating.
 *
 * This module handles license validation for claude-workflow premium features.
 * Users who purchase a Pro or All tier get a JWT signed with Ed25519 (EdDSA)
 * that is cached locally for offline validation.
 *
 * JWT Payload Structure:
 *   {
 *     tier: 'pro' | 'all',         // Subscription tier
 *     features: string[],          // Feature IDs matching FeatureGroup.id values
 *     machineId: string,           // SHA-256 fingerprint of hostname+username (16 hex chars)
 *     sub: string,                 // License key / user identifier
 *     iss: 'claude-workflow',      // Issuer
 *     exp: number,                 // Expiration timestamp (7-day window)
 *     iat: number,                 // Issued-at timestamp
 *   }
 *
 * All public functions return null on failure (never throw).
 * Errors are logged via console.warn for diagnostics.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { createHash } from "node:crypto";
import type { CryptoKey as JoseCryptoKey, JWTPayload } from "jose";
import { LICENSE_PUBLIC_KEY_SPKI, LICENSE_ISSUER, LICENSE_ALGORITHM } from "./license-keys.js";

// ---------------------------------------------------------------
// Tier types and constants
// ---------------------------------------------------------------

/** Supported tier names. Free is implicit (no JWT needed). */
export type TierName = "free" | "pro" | "all";

/** Tier hierarchy for access comparison (higher number = more access). */
export const TIER_HIERARCHY: Record<TierName, number> = {
  free: 0,
  pro: 1,
  all: 2,
};

/** Human-readable display names for each tier. */
export const TIER_DISPLAY_NAMES: Record<TierName, string> = {
  free: "Free",
  pro: "Pro",
  all: "All",
};

/**
 * Aggregated license information for display in the CLI.
 * Combines tier, expiration, machine fingerprint, and license key.
 */
export interface LicenseInfo {
  /** Current effective tier. Falls back to 'free' when no license or expired. */
  tier: TierName;
  /** ISO 8601 expiration date, or null if free/perpetual. */
  expiresAt: string | null;
  /** Whether the license is currently valid (not expired, signature ok). */
  isValid: boolean;
  /** Truncated machine fingerprint (16 hex chars). */
  machineId: string;
  /** Truncated license key for display, or null for free tier. */
  licenseKey: string | null;
}

export const LICENSE_DIR = join(homedir(), ".claude-workflow");
export const LICENSE_PATH = join(LICENSE_DIR, "license.jwt");
export const DOWNLOAD_CREDENTIALS_PATH = join(LICENSE_DIR, "download-credentials.json");
const WORKER_API_BASE = "https://api.claudeworkflow.com";

/**
 * Shape of the custom claims in a license JWT.
 */
export interface LicensePayload extends JWTPayload {
  tier: "all" | "pro";
  features: string[];
  machineId: string;
}

/**
 * Result returned from successful license activation or refresh.
 */
export interface ActivationResult {
  tier: "all" | "pro";
  features: string[];
  expiresAt: Date;
}

/**
 * Download credentials returned by the Worker API after activation.
 * Stored to ~/.claude-workflow/download-credentials.json for pro module downloads.
 */
export interface DownloadCredentials {
  downloadToken: string;
  downloadUrl: string;
  version: string;
  savedAt: string;
}

/**
 * Save download credentials to disk for use by pro-module-loader.
 */
function saveDownloadCredentials(creds: DownloadCredentials): void {
  mkdirSync(LICENSE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(DOWNLOAD_CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Read saved download credentials from disk.
 * Returns null if file doesn't exist or is corrupted.
 */
export function getDownloadCredentials(): DownloadCredentials | null {
  try {
    if (!existsSync(DOWNLOAD_CREDENTIALS_PATH)) return null;
    return JSON.parse(readFileSync(DOWNLOAD_CREDENTIALS_PATH, "utf8")) as DownloadCredentials;
  } catch {
    return null;
  }
}

/**
 * Generate a stable machine fingerprint.
 * SHA-256 hash of hostname + username, truncated to 16 hex characters.
 * This provides a reasonably unique identifier per user/machine combo
 * without requiring elevated permissions.
 */
export function getMachineFingerprint(): string {
  return createHash("sha256")
    .update(hostname() + userInfo().username)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Import the embedded Ed25519 public key for JWT verification.
 * Uses jose's importSPKI to convert the PEM-encoded SPKI key to a CryptoKey.
 */
async function getPublicKey(): Promise<JoseCryptoKey> {
  const { importSPKI } = await import("jose");
  return importSPKI(LICENSE_PUBLIC_KEY_SPKI, LICENSE_ALGORITHM);
}

/**
 * Get licensed feature IDs from a valid cached JWT.
 * Returns null if JWT is missing, expired, has invalid signature, or machine mismatch.
 *
 * This is the primary function for checking feature entitlements.
 * It reads from the local cache and performs offline validation only.
 */
export async function getLicenseFeatures(): Promise<string[] | null> {
  try {
    if (!existsSync(LICENSE_PATH)) {
      return null;
    }

    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (!token) {
      return null;
    }

    const { jwtVerify } = await import("jose");
    const publicKey = await getPublicKey();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: LICENSE_ISSUER,
      algorithms: [LICENSE_ALGORITHM],
    });

    const licensePayload = payload as LicensePayload;

    // Verify machine fingerprint
    const currentMachineId = getMachineFingerprint();
    if (licensePayload.machineId !== currentMachineId) {
      console.warn("[license] Machine fingerprint mismatch -- license not valid for this machine");
      return null;
    }

    // Verify features array exists
    if (!Array.isArray(licensePayload.features)) {
      console.warn("[license] Invalid JWT payload: missing features array");
      return null;
    }

    return licensePayload.features;
  } catch (error: unknown) {
    // jose throws JWTExpired, JWSSignatureVerificationFailed, etc.
    if (error instanceof Error) {
      console.warn(`[license] JWT validation failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Synchronous version of getLicenseFeatures().
 *
 * Reads the cached JWT from disk and decodes its payload without async jose
 * crypto verification. This is safe because the JWT was already cryptographically
 * verified when it was saved by activateLicense() or refreshLicense().
 *
 * Checks:
 * - JWT file exists and is non-empty
 * - Payload is valid JSON with expected structure
 * - Token is not expired (exp claim)
 * - Machine fingerprint matches
 * - Features array is present and non-empty
 *
 * @returns Array of feature IDs the license enables, or null if no valid license
 */
export function getLicenseFeaturesSync(): string[] | null {
  try {
    if (!existsSync(LICENSE_PATH)) {
      return null;
    }

    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (!token) {
      return null;
    }

    // JWT structure: header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (base64url -> JSON)
    const payloadB64 = parts[1];
    if (!payloadB64) {
      return null;
    }
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as LicensePayload;

    // Require expiration claim and reject expired JWTs
    if (typeof payload.exp !== "number") {
      return null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      return null;
    }

    // Check issuer
    if (payload.iss !== LICENSE_ISSUER) {
      return null;
    }

    // Require machine fingerprint and verify it matches
    const currentMachineId = getMachineFingerprint();
    if (payload.machineId !== currentMachineId) {
      return null;
    }

    // Verify features array exists and is non-empty
    if (!Array.isArray(payload.features) || payload.features.length === 0) {
      return null;
    }

    return payload.features;
  } catch {
    // Any parsing or file read error silently returns null
    return null;
  }
}

/**
 * Truncate a license key for display purposes.
 * Shows the first 8 and last 4 characters with ellipsis in between.
 */
function truncateLicenseKey(key: string): string {
  if (key.length <= 16) {
    return key;
  }
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * Get aggregated license information for CLI display.
 *
 * Reads the cached JWT from disk and decodes its payload (synchronous,
 * no crypto verification -- the JWT was verified when saved by activateLicense()).
 *
 * Returns a LicenseInfo object with:
 * - Effective tier (falls back to 'free' when no license or expired)
 * - Expiration date (null for free tier)
 * - Validity flag (false when expired)
 * - Machine fingerprint (16 hex chars)
 * - Truncated license key (null for free tier)
 *
 * Never throws. Returns free-tier defaults on any error.
 */
export function getLicenseInfo(): LicenseInfo {
  const machineId = getMachineFingerprint();

  if (!existsSync(LICENSE_PATH)) {
    return {
      tier: "free",
      expiresAt: null,
      isValid: true,
      machineId,
      licenseKey: null,
    };
  }

  try {
    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (!token) {
      return {
        tier: "free",
        expiresAt: null,
        isValid: true,
        machineId,
        licenseKey: null,
      };
    }

    // Decode JWT payload without async crypto (same approach as getLicenseFeaturesSync)
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return {
        tier: "free",
        expiresAt: null,
        isValid: true,
        machineId,
        licenseKey: null,
      };
    }

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as LicensePayload;

    // Determine expiration
    const expiresAt = typeof payload.exp === "number"
      ? new Date(payload.exp * 1000).toISOString()
      : null;

    // Check if expired
    const isExpired = typeof payload.exp === "number"
      && payload.exp < Math.floor(Date.now() / 1000);

    // Determine tier from payload (JWT only contains 'pro' or 'all')
    const jwtTier = payload.tier;
    const effectiveTier: TierName = isExpired ? "free" : (jwtTier ?? "free");

    // Extract license key from 'sub' claim
    const licenseKey = typeof payload.sub === "string"
      ? truncateLicenseKey(payload.sub)
      : null;

    return {
      tier: effectiveTier,
      expiresAt,
      isValid: !isExpired,
      machineId,
      licenseKey,
    };
  } catch {
    // Corrupt JWT file -- fall back to free tier
    return {
      tier: "free",
      expiresAt: null,
      isValid: true,
      machineId,
      licenseKey: null,
    };
  }
}

/**
 * Activate a license key by calling the Polar.sh validation API.
 * Receives a signed JWT, verifies it locally, and caches it to disk.
 *
 * @param key - The license key from a Polar.sh purchase
 * @returns Activation result with tier and features, or null on failure
 */
export async function activateLicense(key: string): Promise<ActivationResult | null> {
  try {
    const machineId = getMachineFingerprint();

    const response = await fetch(`${WORKER_API_BASE}/api/pro/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        key,
        machine_id: machineId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.warn(`[license] Worker API returned ${String(response.status)}: ${errorBody}`);
      return null;
    }

    const data = (await response.json()) as {
      token?: string;
      downloadToken?: string;
      downloadUrl?: string;
      version?: string;
    };
    if (!data.token) {
      console.warn("[license] Worker API response missing token field");
      return null;
    }

    // Verify the JWT before caching
    const { jwtVerify } = await import("jose");
    const publicKey = await getPublicKey();
    const { payload } = await jwtVerify(data.token, publicKey, {
      issuer: LICENSE_ISSUER,
      algorithms: [LICENSE_ALGORITHM],
    });

    const licensePayload = payload as LicensePayload;

    // Verify machine fingerprint in the returned JWT
    if (licensePayload.machineId !== machineId) {
      console.warn("[license] Returned JWT machine fingerprint does not match");
      return null;
    }

    // Cache the JWT to disk with restricted permissions
    mkdirSync(LICENSE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(LICENSE_PATH, data.token, { encoding: "utf8", mode: 0o600 });

    // Save download credentials for pro-module-loader
    if (data.downloadToken && data.downloadUrl && data.version) {
      saveDownloadCredentials({
        downloadToken: data.downloadToken,
        downloadUrl: `${WORKER_API_BASE}${data.downloadUrl}`,
        version: data.version,
        savedAt: new Date().toISOString(),
      });
    }

    return {
      tier: licensePayload.tier,
      features: licensePayload.features,
      expiresAt: new Date((licensePayload.exp ?? 0) * 1000),
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[license] Activation failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Refresh an existing cached license by re-validating with the Polar.sh API.
 * Reads the subject claim from the cached JWT (which may be expired)
 * and requests a fresh token from the server.
 *
 * @returns Fresh activation result, or null on failure
 */
export async function refreshLicense(): Promise<ActivationResult | null> {
  try {
    if (!existsSync(LICENSE_PATH)) {
      console.warn("[license] No cached license to refresh");
      return null;
    }

    const token = readFileSync(LICENSE_PATH, "utf8").trim();
    if (!token) {
      return null;
    }

    // Decode without verifying (the token may be expired)
    // We just need the subject claim to re-validate
    const { decodeJwt, jwtVerify } = await import("jose");
    const decoded = decodeJwt(token) as LicensePayload;

    if (!decoded.sub) {
      console.warn("[license] Cached JWT missing subject claim");
      return null;
    }

    const machineId = getMachineFingerprint();

    const response = await fetch(`${WORKER_API_BASE}/api/pro/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        key: decoded.sub,
        machine_id: machineId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.warn(`[license] Refresh failed with ${String(response.status)}: ${errorBody}`);
      return null;
    }

    const data = (await response.json()) as {
      token?: string;
      downloadToken?: string;
      downloadUrl?: string;
      version?: string;
    };
    if (!data.token) {
      console.warn("[license] Refresh response missing token field");
      return null;
    }

    // Verify fresh JWT before caching
    const publicKey = await getPublicKey();
    const { payload: freshPayload } = await jwtVerify(data.token, publicKey, {
      issuer: LICENSE_ISSUER,
      algorithms: [LICENSE_ALGORITHM],
    });

    const freshLicense = freshPayload as LicensePayload;

    if (freshLicense.machineId !== machineId) {
      console.warn("[license] Refreshed JWT machine fingerprint does not match");
      return null;
    }

    // Update cache with restricted permissions
    writeFileSync(LICENSE_PATH, data.token, { encoding: "utf8", mode: 0o600 });

    // Update download credentials on refresh
    if (data.downloadToken && data.downloadUrl && data.version) {
      saveDownloadCredentials({
        downloadToken: data.downloadToken,
        downloadUrl: `${WORKER_API_BASE}${data.downloadUrl}`,
        version: data.version,
        savedAt: new Date().toISOString(),
      });
    }

    return {
      tier: freshLicense.tier,
      features: freshLicense.features,
      expiresAt: new Date((freshLicense.exp ?? 0) * 1000),
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[license] Refresh failed: ${error.message}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------
// Proactive auto-refresh
// ---------------------------------------------------------------

/** Track whether auto-refresh is already in flight to prevent duplicate requests */
let autoRefreshInFlight = false;

/**
 * Proactive auto-refresh: if JWT is within 48 hours of expiry and
 * internet is available, fire-and-forget a refresh call.
 *
 * Non-blocking -- callers do not await this. If refresh fails (offline,
 * API error), it silently does nothing. The 7-day grace period will
 * still protect the user.
 *
 * Call this during pro module resolution to silently extend the license
 * before the user ever sees an expiry warning.
 */
export function maybeAutoRefresh(): void {
  if (autoRefreshInFlight) {
    return;
  }

  autoRefreshInFlight = true;

  // Use dynamic import to avoid circular dependency at module load time:
  // license-state.ts imports LICENSE_PATH from license-manager.ts, so
  // license-manager.ts cannot statically import from license-state.ts.
  void import("./license-state.js")
    .then(async ({ isWithinPreExpiryWindow }) => {
      if (!isWithinPreExpiryWindow()) {
        return;
      }

      const result = await refreshLicense();
      if (result) {
        console.warn(
          "[license] Auto-refresh successful, new expiry:",
          result.expiresAt.toISOString(),
        );
      }
    })
    .catch(() => {
      // Silently ignore -- user is likely offline. Grace period covers them.
    })
    .finally(() => {
      autoRefreshInFlight = false;
    });
}
