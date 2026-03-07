/**
 * TypeScript types for the admin pricing editor.
 *
 * These types match the config/product-config.json schema
 * defined in docs/research/admin-state-and-deploy-architecture.md.
 *
 * @module types/admin/pricing
 */

/** Pricing details for a tier */
export interface TierPricing {
  /** Price in cents (e.g. 2000 = $20.00) */
  price: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Billing period: 'month' | 'year' */
  period: string;
  /** Human-readable price display (e.g. "$20") */
  displayPrice: string;
  /** Human-readable period display (e.g. "/mo") */
  displayPeriod: string;
}

/** Configuration for a pricing tier */
export interface TierConfig {
  /** Tier hierarchy level (0=free, 1=pro, 2=all) */
  hierarchy: number;
  /** Human-readable name */
  displayName: string;
  /** Polar.sh benefit UUID (null for free tier) */
  polarBenefitId: string | null;
  /** Pricing details */
  pricing: TierPricing;
}

/** Feature item displayed on the landing page pricing card */
export interface LandingPageFeature {
  /** Feature display text (e.g. "48 agents") */
  name: string;
  /** Whether this feature is included (checkmark vs X) */
  included: boolean;
  /** Optional: field name from which count is derived */
  derivedFrom?: string;
}

/** Landing page tier display configuration */
export interface LandingPageTier {
  /** References tiers key (e.g. "pro") */
  tierId: string;
  /** Card subtitle text */
  subtitle: string;
  /** Ordered list of features displayed in the card */
  features: LandingPageFeature[];
  /** CTA button label */
  ctaLabel: string;
  /** CTA button URL (Polar checkout or npm) */
  ctaHref: string;
  /** CTA button visual variant */
  ctaVariant: "ghost" | "solid" | "outline";
  /** Whether to show "Most Popular" badge */
  highlighted: boolean;
}

/** FAQ item for the landing page */
export interface FAQItem {
  question: string;
  answer: string;
}

/** Landing page configuration section */
export interface LandingPageConfig {
  tiers: LandingPageTier[];
  faq: FAQItem[];
}

/** Feature group configuration */
export interface FeatureGroupConfig {
  id: string;
  name: string;
  description: string;
  requiredTier: string;
  defaultEnabled: boolean;
  dependencies: string[];
  agents: string[];
  skills: string[];
  commands: string[];
  workflows: string[];
}

/** Root product configuration schema */
export interface ProductConfig {
  $schema?: string;
  schemaVersion: number;
  configVersion: number;
  configTimestamp: string;
  configAuthor: string;
  configDescription: string;
  tiers: Record<string, TierConfig>;
  featureGroups: FeatureGroupConfig[];
  landingPage: LandingPageConfig;
}
