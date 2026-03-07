/**
 * Polar.sh Admin API client for subscriber and license key management.
 *
 * Uses the Organization Access Token (OAT) for authenticated requests (300 req/min).
 * All currency values from Polar are in cents.
 *
 * Follows the same error class and fetch patterns as
 * packages/pro-distribution-worker/src/lib/polar-client.ts
 *
 * Reference: docs/research/polar-admin-api.md
 */

const POLAR_API_BASE = "https://api.polar.sh/v1";
const POLAR_REQUEST_TIMEOUT_MS = 10_000;

// ── Configuration ──────────────────────────────────────────────────────

export interface PolarAdminConfig {
  apiToken: string;
  organizationId: string;
}

// ── Error class ────────────────────────────────────────────────────────

/**
 * Error from the Polar.sh Admin API with HTTP status code and response body.
 * Mirrors PolarApiError from pro-distribution-worker/src/lib/polar-client.ts.
 */
export class PolarAdminError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "PolarAdminError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total_count: number;
    max_page: number;
  };
}

export interface PolarCustomerSummary {
  id: string;
  email: string;
  name: string | null;
  avatar_url?: string;
}

export interface PolarProductSummary {
  id: string;
  name: string;
  description: string | null;
  is_recurring: boolean;
}

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export interface PolarSubscription {
  id: string;
  created_at: string;
  modified_at: string | null;
  amount: number;
  currency: string;
  recurring_interval: "day" | "week" | "month" | "year";
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  customer_id: string;
  product_id: string;
  customer_cancellation_reason: string | null;
  customer_cancellation_comment: string | null;
  metadata: Record<string, unknown>;
  customer: PolarCustomerSummary;
  product: PolarProductSummary;
}

export type LicenseKeyStatus = "granted" | "revoked" | "disabled";

export interface PolarLicenseKey {
  id: string;
  created_at: string;
  modified_at: string | null;
  organization_id: string;
  customer_id: string;
  benefit_id: string;
  key: string;
  display_key: string;
  status: LicenseKeyStatus;
  limit_activations: number | null;
  usage: number;
  limit_usage: number | null;
  validations: number;
  last_validated_at: string | null;
  expires_at: string | null;
  customer: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface PolarLicenseKeyActivation {
  id: string;
  license_key_id: string;
  label: string;
  meta: Record<string, string | number | boolean>;
  created_at: string;
  modified_at: string | null;
}

export interface PolarLicenseKeyWithActivations extends PolarLicenseKey {
  activations: PolarLicenseKeyActivation[];
}

// ── Fetch helper ───────────────────────────────────────────────────────

/**
 * Authenticated fetch wrapper for Polar.sh Admin API.
 * Adds Bearer token, Accept header, and a 10-second timeout via AbortController.
 *
 * @throws PolarAdminError on non-2xx HTTP responses
 * @throws AbortError on timeout (caught by route-level handlePolarError)
 */
async function polarFetch(
  path: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    POLAR_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${POLAR_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new PolarAdminError(
        `Polar API error: ${String(response.status)}`,
        response.status,
        errorText,
      );
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Subscriptions ──────────────────────────────────────────────────────

export interface ListSubscriptionsParams {
  page?: number;
  limit?: number;
  active?: boolean;
  productId?: string;
  email?: string;
  sorting?: string[];
}

/**
 * List subscriptions with pagination and filtering.
 * Email filtering is done client-side because the Polar subscriptions
 * endpoint does not support email search directly.
 */
export async function listSubscriptions(
  config: PolarAdminConfig,
  params: ListSubscriptionsParams = {},
): Promise<PaginatedResponse<PolarSubscription>> {
  const url = new URL(`${POLAR_API_BASE}/subscriptions/`);
  url.searchParams.set("organization_id", config.organizationId);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("limit", String(params.limit ?? 20));

  if (params.active !== undefined) {
    url.searchParams.set("active", String(params.active));
  }
  if (params.productId) {
    url.searchParams.set("product_id", params.productId);
  }
  if (params.sorting) {
    for (const s of params.sorting) {
      url.searchParams.append("sorting", s);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    POLAR_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new PolarAdminError(
        `Polar subscriptions API error: ${String(response.status)}`,
        response.status,
        errorText,
      );
    }

    const data =
      (await response.json()) as PaginatedResponse<PolarSubscription>;

    // Client-side email filtering (Polar subscriptions endpoint has no email search)
    if (params.email) {
      const emailLower = params.email.toLowerCase();
      data.items = data.items.filter((sub) =>
        sub.customer.email.toLowerCase().includes(emailLower),
      );
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get a single subscription by ID.
 * Polar does not expose GET /v1/subscriptions/{id}, so this lists
 * subscriptions with the org filter and finds by ID client-side.
 *
 * @returns The subscription, or null if not found.
 */
export async function getSubscriptionById(
  config: PolarAdminConfig,
  subscriptionId: string,
): Promise<PolarSubscription | null> {
  try {
    const response = await polarFetch(
      `/subscriptions/?organization_id=${encodeURIComponent(config.organizationId)}&limit=100`,
      config.apiToken,
    );
    const data =
      (await response.json()) as PaginatedResponse<PolarSubscription>;
    return data.items.find((s) => s.id === subscriptionId) ?? null;
  } catch (error) {
    if (error instanceof PolarAdminError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

// ── License Keys ───────────────────────────────────────────────────────

export interface ListLicenseKeysParams {
  page?: number;
  limit?: number;
  benefitId?: string;
}

/**
 * List license keys with pagination and optional benefit_id filter.
 */
export async function listLicenseKeys(
  config: PolarAdminConfig,
  params: ListLicenseKeysParams = {},
): Promise<PaginatedResponse<PolarLicenseKey>> {
  const url = new URL(`${POLAR_API_BASE}/license-keys/`);
  url.searchParams.set("organization_id", config.organizationId);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("limit", String(params.limit ?? 20));

  if (params.benefitId) {
    url.searchParams.set("benefit_id", params.benefitId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    POLAR_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new PolarAdminError(
        `Polar license keys API error: ${String(response.status)}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as PaginatedResponse<PolarLicenseKey>;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get a single license key with its activations array.
 *
 * @throws PolarAdminError on 404 or other API errors
 */
export async function getLicenseKeyWithActivations(
  config: PolarAdminConfig,
  licenseKeyId: string,
): Promise<PolarLicenseKeyWithActivations> {
  const response = await polarFetch(
    `/license-keys/${encodeURIComponent(licenseKeyId)}`,
    config.apiToken,
  );
  return (await response.json()) as PolarLicenseKeyWithActivations;
}

/**
 * Revoke a license key by setting its status to "revoked".
 *
 * @throws PolarAdminError on 404 or other API errors
 */
export async function revokeLicenseKey(
  config: PolarAdminConfig,
  licenseKeyId: string,
): Promise<PolarLicenseKey> {
  const response = await polarFetch(
    `/license-keys/${encodeURIComponent(licenseKeyId)}`,
    config.apiToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    },
  );
  return (await response.json()) as PolarLicenseKey;
}
