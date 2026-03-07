/**
 * PricingForm - Editable form card for a single pricing tier.
 *
 * Contains fields for pricing, display, CTA, and an inline feature list editor
 * with add/remove/reorder controls. Renders as a collapsible card with dirty
 * state indicator (amber left border when modified).
 *
 * @module components/admin/pricing/PricingForm
 */

import { useMemo, useState } from "react";

import type {
  TierConfig,
  LandingPageTier,
  LandingPageFeature,
} from "../../types/pricing";

/**
 * Validates pricing form fields and returns error messages.
 * Rules:
 * - price must be a non-negative integer (cents)
 * - displayPrice must start with a currency symbol ($, etc.)
 * - ctaHref must be a valid URL (or empty for free tier)
 * - displayName must be non-empty
 */
interface ValidationErrors {
  price?: string;
  displayPrice?: string;
  displayName?: string;
  ctaHref?: string;
}

function validateTier(
  tierConfig: TierConfig,
  landingTier: LandingPageTier,
  tierId: string
): ValidationErrors {
  const errors: ValidationErrors = {};

  // Price must be non-negative integer
  if (tierConfig.pricing.price < 0 || !Number.isInteger(tierConfig.pricing.price)) {
    errors.price = "Price must be a non-negative integer (cents)";
  }

  // Display price must start with currency symbol
  if (tierConfig.pricing.displayPrice.length > 0) {
    const currencySymbolPattern = /^[$\u20AC\u00A3\u00A5\u20B9]/;
    if (!currencySymbolPattern.test(tierConfig.pricing.displayPrice) && tierConfig.pricing.displayPrice !== "Free") {
      errors.displayPrice = "Must start with currency symbol (e.g. $, \u20AC) or be \"Free\"";
    }
  }

  // Display name must be non-empty
  if (tierConfig.displayName.trim().length === 0) {
    errors.displayName = "Display name is required";
  }

  // CTA href must be a valid URL (or empty for free tier)
  if (landingTier.ctaHref.length > 0) {
    try {
      new URL(landingTier.ctaHref);
    } catch {
      errors.ctaHref = "Must be a valid URL";
    }
  } else if (tierId !== "free" && landingTier.ctaHref.length === 0) {
    errors.ctaHref = "URL is required for paid tiers";
  }

  return errors;
}

interface PricingFormProps {
  tierId: string;
  tierConfig: TierConfig;
  landingTier: LandingPageTier;
  isDirty: boolean;
  onUpdatePricing: (updates: Partial<TierConfig["pricing"]>) => void;
  onUpdateTierMeta: (updates: Partial<Omit<TierConfig, "pricing">>) => void;
  onUpdateLandingTier: (
    updates: Partial<Omit<LandingPageTier, "features" | "tierId">>
  ) => void;
  onAddFeature: () => void;
  onRemoveFeature: (index: number) => void;
  onMoveFeature: (index: number, direction: "up" | "down") => void;
  onUpdateFeature: (index: number, updates: Partial<LandingPageFeature>) => void;
  onPreview: () => void;
  isPreviewActive: boolean;
}

function FormField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-gray-400"
      >
        {label}
      </label>
      {children}
      {error !== undefined && error.length > 0 && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const inputErrorClass =
  "w-full rounded-md border border-error bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-error focus:outline-none focus:ring-1 focus:ring-error";

const selectClass =
  "w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function PricingForm({
  tierId,
  tierConfig,
  landingTier,
  isDirty,
  onUpdatePricing,
  onUpdateTierMeta,
  onUpdateLandingTier,
  onAddFeature,
  onRemoveFeature,
  onMoveFeature,
  onUpdateFeature,
  onPreview,
  isPreviewActive,
}: PricingFormProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);

  const errors = useMemo(
    () => validateTier(tierConfig, landingTier, tierId),
    [tierConfig, landingTier, tierId]
  );

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div
      className={[
        "rounded-xl border bg-gray-900 transition-colors",
        isDirty
          ? "border-l-4 border-l-warning border-t-gray-800 border-r-gray-800 border-b-gray-800"
          : "border-gray-800",
        isPreviewActive ? "ring-2 ring-primary/30" : "",
      ].join(" ")}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-6 py-4"
        aria-expanded={isExpanded}
        aria-controls={`pricing-form-${tierId}`}
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-100">
            {tierConfig.displayName}
          </h3>
          <span className="text-sm text-gray-400">
            {tierConfig.pricing.displayPrice}
            {tierConfig.pricing.displayPeriod}
          </span>
          {isDirty && (
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-warning">
              Modified
            </span>
          )}
          {hasErrors && (
            <span className="rounded-full bg-error/20 px-2 py-0.5 text-xs text-error">
              Errors
            </span>
          )}
        </div>
        <svg
          className={[
            "h-5 w-5 text-gray-400 transition-transform",
            isExpanded ? "rotate-180" : "",
          ].join(" ")}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isExpanded && (
        <div
          id={`pricing-form-${tierId}`}
          className="space-y-6 px-6 pb-6"
          role="region"
          aria-label={`${tierConfig.displayName} tier configuration`}
        >
          {/* Pricing fields */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label="Price (cents)" htmlFor={`${tierId}-price`} error={errors.price}>
              <input
                id={`${tierId}-price`}
                type="number"
                min={0}
                step={100}
                value={tierConfig.pricing.price}
                onChange={(e) =>
                  onUpdatePricing({
                    price: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className={errors.price !== undefined ? inputErrorClass : inputClass}
                aria-invalid={errors.price !== undefined}
                aria-describedby={errors.price !== undefined ? `${tierId}-price-error` : undefined}
              />
            </FormField>
            <FormField label="Display Price" htmlFor={`${tierId}-display-price`} error={errors.displayPrice}>
              <input
                id={`${tierId}-display-price`}
                type="text"
                value={tierConfig.pricing.displayPrice}
                onChange={(e) =>
                  onUpdatePricing({ displayPrice: e.target.value })
                }
                placeholder="$20"
                className={errors.displayPrice !== undefined ? inputErrorClass : inputClass}
                aria-invalid={errors.displayPrice !== undefined}
              />
            </FormField>
            <FormField label="Display Period" htmlFor={`${tierId}-display-period`}>
              <input
                id={`${tierId}-display-period`}
                type="text"
                value={tierConfig.pricing.displayPeriod}
                onChange={(e) =>
                  onUpdatePricing({ displayPeriod: e.target.value })
                }
                placeholder="/mo"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Currency field */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label="Currency" htmlFor={`${tierId}-currency`}>
              <input
                id={`${tierId}-currency`}
                type="text"
                value={tierConfig.pricing.currency}
                onChange={(e) =>
                  onUpdatePricing({ currency: e.target.value })
                }
                placeholder="USD"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Display name + Polar benefit ID (tier-level, NOT pricing-level) */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Display Name" htmlFor={`${tierId}-display-name`} error={errors.displayName}>
              <input
                id={`${tierId}-display-name`}
                type="text"
                value={tierConfig.displayName}
                onChange={(e) =>
                  onUpdateTierMeta({ displayName: e.target.value })
                }
                className={errors.displayName !== undefined ? inputErrorClass : inputClass}
                aria-invalid={errors.displayName !== undefined}
              />
            </FormField>
            <FormField label="Polar Benefit ID" htmlFor={`${tierId}-polar-benefit`}>
              <input
                id={`${tierId}-polar-benefit`}
                type="text"
                value={tierConfig.polarBenefitId ?? ""}
                onChange={(e) =>
                  onUpdateTierMeta({
                    polarBenefitId: e.target.value || null,
                  })
                }
                placeholder="UUID (empty for free tier)"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Landing page fields */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Subtitle" htmlFor={`${tierId}-subtitle`}>
              <input
                id={`${tierId}-subtitle`}
                type="text"
                value={landingTier.subtitle}
                onChange={(e) =>
                  onUpdateLandingTier({ subtitle: e.target.value })
                }
                className={inputClass}
              />
            </FormField>
            <FormField label="CTA Label" htmlFor={`${tierId}-cta-label`}>
              <input
                id={`${tierId}-cta-label`}
                type="text"
                value={landingTier.ctaLabel}
                onChange={(e) =>
                  onUpdateLandingTier({ ctaLabel: e.target.value })
                }
                className={inputClass}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label="CTA URL" htmlFor={`${tierId}-cta-href`} error={errors.ctaHref}>
              <input
                id={`${tierId}-cta-href`}
                type="url"
                value={landingTier.ctaHref}
                onChange={(e) =>
                  onUpdateLandingTier({ ctaHref: e.target.value })
                }
                placeholder="https://..."
                className={errors.ctaHref !== undefined ? inputErrorClass : inputClass}
                aria-invalid={errors.ctaHref !== undefined}
              />
            </FormField>
            <FormField label="CTA Variant" htmlFor={`${tierId}-cta-variant`}>
              <select
                id={`${tierId}-cta-variant`}
                value={landingTier.ctaVariant}
                onChange={(e) =>
                  onUpdateLandingTier({
                    ctaVariant: e.target.value as "ghost" | "solid" | "outline",
                  })
                }
                className={selectClass}
              >
                <option value="ghost">Ghost</option>
                <option value="solid">Solid</option>
                <option value="outline">Outline</option>
              </select>
            </FormField>
            <FormField label="Highlighted">
              <div className="flex h-[38px] items-center">
                <input
                  id={`${tierId}-highlighted`}
                  type="checkbox"
                  checked={landingTier.highlighted ?? false}
                  onChange={(e) =>
                    onUpdateLandingTier({ highlighted: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-700 text-primary focus:ring-primary"
                />
                <label
                  htmlFor={`${tierId}-highlighted`}
                  className="ml-2 text-sm text-gray-400"
                >
                  Show &quot;Most Popular&quot; badge
                </label>
              </div>
            </FormField>
          </div>

          {/* Feature list editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-200">
                Feature List ({String(landingTier.features.length)} items)
              </h4>
              <button
                type="button"
                onClick={onAddFeature}
                className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
              >
                + Add Feature
              </button>
            </div>
            {landingTier.features.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-500">
                No features yet. Click &quot;+ Add Feature&quot; to add one.
              </p>
            )}
            <div className="space-y-2">
              {landingTier.features.map((feature, idx) => (
                <div
                  key={`${tierId}-feature-${String(idx)}`}
                  className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={feature.included}
                    onChange={(e) =>
                      onUpdateFeature(idx, { included: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-gray-700 text-primary"
                    title="Feature included"
                    aria-label={`${feature.name} included`}
                  />
                  <input
                    type="text"
                    value={feature.name}
                    onChange={(e) =>
                      onUpdateFeature(idx, { name: e.target.value })
                    }
                    className="flex-1 bg-transparent text-sm text-gray-200 outline-none"
                    aria-label={`Feature ${String(idx + 1)} name`}
                  />
                  <button
                    type="button"
                    onClick={() => onMoveFeature(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 text-gray-600 hover:text-gray-400 disabled:opacity-30"
                    title="Move up"
                    aria-label={`Move ${feature.name} up`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M14.78 11.78a.75.75 0 01-1.06 0L10 8.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveFeature(idx, "down")}
                    disabled={idx === landingTier.features.length - 1}
                    className="p-1 text-gray-600 hover:text-gray-400 disabled:opacity-30"
                    title="Move down"
                    aria-label={`Move ${feature.name} down`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveFeature(idx)}
                    className="p-1 text-gray-600 hover:text-error"
                    title="Remove feature"
                    aria-label={`Remove ${feature.name}`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Preview button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onPreview}
              className={[
                "rounded-md px-4 py-2 text-xs font-medium transition-colors",
                isPreviewActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200",
              ].join(" ")}
            >
              Preview this tier
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
