/**
 * Admin dashboard type definitions
 * Based on Polar.sh API schemas from docs/research/polar-admin-api.md
 */

export interface Subscription {
  id: string;
  created_at: string;
  modified_at: string | null;
  amount: number;
  currency: string;
  recurring_interval: "day" | "week" | "month" | "year";
  recurring_interval_count: number;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid";
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
  customer: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string;
  };
  product: {
    id: string;
    name: string;
    description: string | null;
    is_recurring: boolean;
  };
}

export interface LicenseKeyRead {
  id: string;
  created_at: string;
  modified_at: string | null;
  key: string;
  display_key: string;
  status: "granted" | "revoked" | "disabled";
  limit_activations: number | null;
  usage: number;
  limit_usage: number | null;
  validations: number;
  last_validated_at: string | null;
  expires_at: string | null;
  customer_id: string;
  benefit_id: string;
  customer: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string;
  };
}

export interface LicenseKeyWithActivations extends LicenseKeyRead {
  activations: LicenseKeyActivation[];
}

export interface LicenseKeyActivation {
  id: string;
  license_key_id: string;
  label: string;
  meta: Record<string, string | number | boolean>;
  created_at: string;
  modified_at: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total_count: number;
    max_page: number;
  };
}
