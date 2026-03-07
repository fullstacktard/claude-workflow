/**
 * useTier Hook
 * Fetches the current tier level from the backend and caches it.
 * Used for tier-aware page gating in the dashboard.
 *
 * Tier hierarchy: free < pro < all
 * - "free": CLI + core agents only (no dashboard access normally)
 * - "pro": Dashboard, Claude Proxy, most workflows/agents/skills
 * - "all": Pro + X/Twitter + 3D agents
 */

import { useEffect, useState } from "react";

export type Tier = "free" | "pro" | "all";

/** Numeric tier levels for comparison */
const TIER_LEVEL: Record<Tier, number> = {
  free: 0,
  pro: 1,
  all: 2,
};

/** Check if user's tier meets the required tier */
export function isTierAccessible(userTier: Tier, requiredTier: Tier): boolean {
  return TIER_LEVEL[userTier] >= TIER_LEVEL[requiredTier];
}

interface TierState {
  tier: Tier;
  loading: boolean;
}

/** Cache the tier value so we don't re-fetch on every component mount */
let cachedTier: Tier | null = null;

export function useTier(): TierState {
  const [state, setState] = useState<TierState>({
    tier: cachedTier ?? "all",
    loading: cachedTier === null,
  });

  useEffect(() => {
    if (cachedTier !== null) return;

    let cancelled = false;

    fetch("/api/health/tier")
      .then((res) => res.json())
      .then((data: { tier?: string }) => {
        if (cancelled) return;
        const tier = (data.tier === "free" || data.tier === "pro" || data.tier === "all")
          ? data.tier as Tier
          : "all";
        cachedTier = tier;
        setState({ tier, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        // Default to "all" (no restrictions) on error
        cachedTier = "all";
        setState({ tier: "all", loading: false });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}
