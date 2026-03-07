/**
 * PricingPage - Admin pricing editor for tier configuration.
 *
 * Renders three tier editor cards (free, pro, all) in a responsive grid
 * with a live preview panel. Changes are saved via POST /api/admin/config.
 *
 * Layout: Editor cards on the left (scrollable), sticky preview on the right.
 * Save/Discard buttons appear in the header when there are unsaved changes.
 *
 * @module pages/admin/PricingPage
 */

import { useCallback, useState } from "react";

import { usePricing } from "../hooks/usePricing";
import { PricingForm } from "../components/pricing/PricingForm";
import { TierPricingCard } from "../components/pricing/TierPricingCard";

const TIER_ORDER = ["free", "pro", "all"] as const;

export default function PricingPage(): React.JSX.Element {
  const {
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
    refetch,
    isSaving,
  } = usePricing();

  const [previewTierId, setPreviewTierId] = useState<string>("pro");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await save();
      setSaveSuccess(true);
      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save configuration"
      );
    }
  }, [save]);

  // Loading skeleton state
  if (loading) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="space-y-6">
          <h1 className="text-2xl font-bold text-gray-100">Pricing Editor</h1>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {TIER_ORDER.map((id) => (
              <div
                key={id}
                className="h-96 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
                role="status"
                aria-label={`Loading ${id} tier`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state with retry
  if (error || !config) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-12">
        <p className="text-gray-400">
          {error?.message ?? "Failed to load pricing configuration"}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }

  // Build preview data from current form state
  const previewLandingTier = config.landingPage.tiers.find(
    (t) => t.tierId === previewTierId
  );
  const previewTierConfig = config.tiers[previewTierId];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Header with Save/Discard */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-100">Pricing Editor</h1>
          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-sm text-success">
                Configuration saved successfully
              </span>
            )}
            {saveError && (
              <span className="text-sm text-error">{saveError}</span>
            )}
            {isDirty && (
              <>
                <span className="text-sm text-warning">Unsaved changes</span>
                <button
                  type="button"
                  onClick={discard}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Editor + Preview layout */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_380px]">
          {/* Tier editor cards */}
          <div className="space-y-6">
            {TIER_ORDER.map((tierId) => {
              const landingTier = config.landingPage.tiers.find(
                (t) => t.tierId === tierId
              );
              // Skip if tier doesn't exist in config
              if (!config.tiers[tierId] || !landingTier) return null;
              return (
                <PricingForm
                  key={tierId}
                  tierId={tierId}
                  tierConfig={config.tiers[tierId]}
                  landingTier={landingTier}
                  isDirty={dirtyTiers.has(tierId)}
                  onUpdatePricing={(updates) =>
                    updateTierPricing(tierId, updates)
                  }
                  onUpdateTierMeta={(updates) =>
                    updateTierMeta(tierId, updates)
                  }
                  onUpdateLandingTier={(updates) =>
                    updateLandingTier(tierId, updates)
                  }
                  onAddFeature={() => addFeature(tierId)}
                  onRemoveFeature={(index) => removeFeature(tierId, index)}
                  onMoveFeature={(index, direction) =>
                    moveFeature(tierId, index, direction)
                  }
                  onUpdateFeature={(index, updates) =>
                    updateFeature(tierId, index, updates)
                  }
                  onPreview={() => setPreviewTierId(tierId)}
                  isPreviewActive={previewTierId === tierId}
                />
              );
            })}
          </div>

          {/* Live preview panel */}
          <div className="sticky top-6 self-start">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Live Preview
            </h2>
            <div className="mb-4 flex gap-2">
              {TIER_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreviewTierId(id)}
                  className={[
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    previewTierId === id
                      ? "bg-primary text-primary-foreground"
                      : "bg-gray-800 text-gray-400 hover:text-gray-200",
                  ].join(" ")}
                >
                  {config.tiers[id]?.displayName ?? id}
                </button>
              ))}
            </div>
            {previewLandingTier && previewTierConfig && (
              <TierPricingCard
                tier={{
                  id: previewTierId,
                  name: previewTierConfig.displayName,
                  price: previewTierConfig.pricing.displayPrice,
                  period: previewTierConfig.pricing.displayPeriod,
                  subtitle: previewLandingTier.subtitle,
                  features: previewLandingTier.features.map((f) => ({
                    name: f.name,
                    included: f.included,
                  })),
                  ctaLabel: previewLandingTier.ctaLabel,
                  ctaHref: previewLandingTier.ctaHref,
                  ctaVariant: previewLandingTier.ctaVariant,
                  highlighted: previewLandingTier.highlighted,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
