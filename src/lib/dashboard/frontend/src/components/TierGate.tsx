/**
 * TierGate Component
 * Wraps page content and shows an upgrade prompt when the user's tier
 * is insufficient for the required tier level.
 *
 * Shows a centered card with:
 * - Lock icon
 * - Feature name and required tier
 * - Description of what's included
 * - Upgrade CTA button
 */

import { Lock, Sparkles } from "lucide-react";
import { useTier, isTierAccessible, type Tier } from "../hooks/useTier";

interface TierGateProps {
  /** The minimum tier required to access this page */
  requiredTier: Tier;
  /** Display name of the feature/page */
  featureName: string;
  /** Short description of what this feature includes */
  description: string;
  /** The page content to render when tier is sufficient */
  children: React.ReactNode;
}

/** Human-readable tier labels */
const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  all: "All",
};

/** Pricing for each tier */
const TIER_PRICING: Record<Tier, string> = {
  free: "Free",
  pro: "$20/mo",
  all: "$29/mo",
};

export function TierGate({
  requiredTier,
  featureName,
  description,
  children,
}: TierGateProps): JSX.Element {
  const { tier, loading } = useTier();

  // While loading, show nothing (prevents flash of upgrade prompt)
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-950">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  // If tier is sufficient, render children
  if (isTierAccessible(tier, requiredTier)) {
    return <>{children}</>;
  }

  // Show upgrade prompt
  return (
    <div className="flex h-full items-center justify-center bg-gray-950 p-8">
      <div className="max-w-md w-full rounded-lg border border-red-800/50 bg-gray-900 p-8 text-center">
        {/* Lock icon */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-900/30">
          <Lock size={32} className="text-red-400" />
        </div>

        {/* Feature name */}
        <h2 className="mb-2 text-xl font-semibold text-gray-100">
          {featureName}
        </h2>

        {/* Tier badge */}
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-red-900/40 px-3 py-1 text-xs font-medium text-red-300">
          <Sparkles size={12} />
          {TIER_LABELS[requiredTier]} Plan ({TIER_PRICING[requiredTier]})
        </div>

        {/* Description */}
        <p className="mb-6 text-sm text-gray-400 leading-relaxed">
          {description}
        </p>

        {/* Current tier info */}
        <p className="mb-4 text-xs text-gray-500">
          Your current plan: <span className="text-gray-300 font-medium">{TIER_LABELS[tier]}</span>
        </p>

        {/* Upgrade button */}
        <a
          href="https://claude-workflow.com/pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
        >
          <Sparkles size={14} />
          Upgrade to {TIER_LABELS[requiredTier]}
        </a>
      </div>
    </div>
  );
}
