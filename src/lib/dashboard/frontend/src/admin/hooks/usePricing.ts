/**
 * usePricing Hook
 * Manages pricing configuration state for the admin pricing editor.
 *
 * Fetches config from GET /api/admin/config, tracks local edits,
 * detects dirty state via JSON.stringify comparison, and saves
 * via POST /api/admin/config.
 *
 * @module hooks/admin/usePricing
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { dashboardFetch } from "../../utils/dashboard-fetch";
import type {
  ProductConfig,
  TierConfig,
  LandingPageTier,
  LandingPageFeature,
} from "../types/pricing";

export interface UsePricingResult {
  config: ProductConfig | null;
  loading: boolean;
  error: Error | null;
  isDirty: boolean;
  dirtyTiers: Set<string>;
  updateTierPricing: (
    tierId: string,
    updates: Partial<TierConfig["pricing"]>
  ) => void;
  updateTierMeta: (
    tierId: string,
    updates: Partial<Omit<TierConfig, "pricing">>
  ) => void;
  updateLandingTier: (
    tierId: string,
    updates: Partial<Omit<LandingPageTier, "features" | "tierId">>
  ) => void;
  addFeature: (tierId: string) => void;
  removeFeature: (tierId: string, index: number) => void;
  moveFeature: (tierId: string, index: number, direction: "up" | "down") => void;
  updateFeature: (
    tierId: string,
    index: number,
    updates: Partial<LandingPageFeature>
  ) => void;
  save: () => Promise<void>;
  discard: () => void;
  refetch: () => Promise<void>;
  isSaving: boolean;
}

export function usePricing(): UsePricingResult {
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchConfig = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardFetch("/api/admin/config");
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${String(response.status)}`);
      }
      const data = (await response.json()) as ProductConfig;
      setConfig(data);
      setSavedSnapshot(JSON.stringify(data));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // Dirty detection: compare current config JSON against last-saved snapshot
  const currentSnapshot = useMemo(
    () => (config ? JSON.stringify(config) : ""),
    [config]
  );
  const isDirty = currentSnapshot !== savedSnapshot && savedSnapshot !== "";

  // Per-tier dirty detection: identifies which specific tiers have changes
  const dirtyTiers = useMemo(() => {
    if (!config || !savedSnapshot) return new Set<string>();
    const dirty = new Set<string>();
    try {
      const saved = JSON.parse(savedSnapshot) as ProductConfig;
      for (const tierId of Object.keys(config.tiers)) {
        if (
          JSON.stringify(config.tiers[tierId]) !==
          JSON.stringify(saved.tiers[tierId])
        ) {
          dirty.add(tierId);
        }
        const currentLanding = config.landingPage.tiers.find(
          (t) => t.tierId === tierId
        );
        const savedLanding = saved.landingPage.tiers.find(
          (t) => t.tierId === tierId
        );
        if (JSON.stringify(currentLanding) !== JSON.stringify(savedLanding)) {
          dirty.add(tierId);
        }
      }
    } catch {
      // If parse fails, mark all tiers as dirty
      for (const tierId of Object.keys(config.tiers)) {
        dirty.add(tierId);
      }
    }
    return dirty;
  }, [config, savedSnapshot]);

  const updateTierPricing = useCallback(
    (tierId: string, updates: Partial<TierConfig["pricing"]>) => {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tiers: {
            ...prev.tiers,
            [tierId]: {
              ...prev.tiers[tierId],
              pricing: { ...prev.tiers[tierId].pricing, ...updates },
            },
          },
        };
      });
    },
    []
  );

  const updateTierMeta = useCallback(
    (tierId: string, updates: Partial<Omit<TierConfig, "pricing">>) => {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tiers: {
            ...prev.tiers,
            [tierId]: { ...prev.tiers[tierId], ...updates },
          },
        };
      });
    },
    []
  );

  const updateLandingTier = useCallback(
    (
      tierId: string,
      updates: Partial<Omit<LandingPageTier, "features" | "tierId">>
    ) => {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          landingPage: {
            ...prev.landingPage,
            tiers: prev.landingPage.tiers.map((t) =>
              t.tierId === tierId ? { ...t, ...updates } : t
            ),
          },
        };
      });
    },
    []
  );

  const addFeature = useCallback((tierId: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        landingPage: {
          ...prev.landingPage,
          tiers: prev.landingPage.tiers.map((t) =>
            t.tierId === tierId
              ? {
                  ...t,
                  features: [
                    ...t.features,
                    { name: "New feature", included: true },
                  ],
                }
              : t
          ),
        },
      };
    });
  }, []);

  const removeFeature = useCallback((tierId: string, index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        landingPage: {
          ...prev.landingPage,
          tiers: prev.landingPage.tiers.map((t) =>
            t.tierId === tierId
              ? { ...t, features: t.features.filter((_, i) => i !== index) }
              : t
          ),
        },
      };
    });
  }, []);

  const moveFeature = useCallback(
    (tierId: string, index: number, direction: "up" | "down") => {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          landingPage: {
            ...prev.landingPage,
            tiers: prev.landingPage.tiers.map((t) => {
              if (t.tierId !== tierId) return t;
              const features = [...t.features];
              const targetIndex =
                direction === "up" ? index - 1 : index + 1;
              if (targetIndex < 0 || targetIndex >= features.length) {
                return t;
              }
              [features[index], features[targetIndex]] = [
                features[targetIndex],
                features[index],
              ];
              return { ...t, features };
            }),
          },
        };
      });
    },
    []
  );

  const updateFeature = useCallback(
    (
      tierId: string,
      index: number,
      updates: Partial<LandingPageFeature>
    ) => {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          landingPage: {
            ...prev.landingPage,
            tiers: prev.landingPage.tiers.map((t) =>
              t.tierId === tierId
                ? {
                    ...t,
                    features: t.features.map((f, i) =>
                      i === index ? { ...f, ...updates } : f
                    ),
                  }
                : t
            ),
          },
        };
      });
    },
    []
  );

  const save = useCallback(async (): Promise<void> => {
    if (!config) return;
    setIsSaving(true);
    try {
      const response = await dashboardFetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? `Save failed: HTTP ${String(response.status)}`);
      }
      // Update saved snapshot to current state so isDirty resets
      setSavedSnapshot(JSON.stringify(config));
    } catch (err) {
      throw err instanceof Error ? err : new Error("Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [config]);

  const discard = useCallback(() => {
    if (!savedSnapshot) return;
    try {
      const saved = JSON.parse(savedSnapshot) as ProductConfig;
      setConfig(saved);
    } catch {
      // If parse fails, refetch from server
      void fetchConfig();
    }
  }, [savedSnapshot, fetchConfig]);

  return {
    config,
    loading,
    error,
    isDirty,
    dirtyTiers,
    updateTierPricing,
    updateTierMeta,
    updateLandingTier,
    addFeature,
    removeFeature,
    moveFeature,
    updateFeature,
    save,
    discard,
    refetch: fetchConfig,
    isSaving,
  };
}
