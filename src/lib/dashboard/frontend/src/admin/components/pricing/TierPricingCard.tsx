/**
 * TierPricingCard - Live preview of a landing page pricing card.
 *
 * Mirrors the PricingCard from packages/landing/src/components/PricingSection.tsx
 * so the admin sees exactly what end users will see on the landing page.
 *
 * @module components/admin/pricing/TierPricingCard
 */

interface TierFeature {
  name: string;
  included: boolean;
}

export interface PreviewTier {
  id: string;
  name: string;
  price: string;
  period: string;
  subtitle: string;
  features: TierFeature[];
  ctaLabel: string;
  ctaHref: string;
  ctaVariant: "ghost" | "solid" | "outline";
  highlighted?: boolean;
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-success"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XMarkIcon(): React.JSX.Element {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-muted"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

const CTA_CLASSES: Record<PreviewTier["ctaVariant"], string> = {
  ghost: [
    "border border-gray-700 bg-transparent text-gray-400",
    "hover:bg-gray-800 hover:text-gray-200",
  ].join(" "),
  solid: [
    "bg-primary text-primary-foreground",
    "hover:opacity-90",
  ].join(" "),
  outline: [
    "border border-primary/40 bg-transparent text-gray-400",
    "hover:border-primary/70 hover:text-gray-200",
  ].join(" "),
};

export function TierPricingCard({
  tier,
}: {
  tier: PreviewTier;
}): React.JSX.Element {
  const isHighlighted = tier.highlighted === true;

  return (
    <div
      className={[
        "relative flex flex-col rounded-xl p-8 transition-all duration-300",
        isHighlighted
          ? [
              "border-2 border-primary",
              "bg-gray-900",
              "shadow-lg shadow-primary/10",
            ].join(" ")
          : [
              "border border-gray-800",
              "bg-gray-900",
            ].join(" "),
      ].join(" ")}
    >
      {isHighlighted && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <span className="whitespace-nowrap rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
            Most Popular
          </span>
        </div>
      )}

      <h3 className="text-lg font-semibold text-gray-100">{tier.name}</h3>

      <div className="mt-4 flex items-baseline">
        <span className="text-4xl font-bold text-gray-100">
          {tier.price}
        </span>
        <span className="ml-1 text-sm text-gray-400">{tier.period}</span>
      </div>

      <p className="mt-2 text-sm text-gray-400">{tier.subtitle}</p>

      <ul className="mt-6 flex-1 space-y-3" role="list">
        {tier.features.map((feature, idx) => (
          <li
            key={`${feature.name}-${String(idx)}`}
            className="flex items-start gap-3 text-sm text-gray-400"
          >
            {feature.included ? <CheckIcon /> : <XMarkIcon />}
            <span>{feature.name}</span>
          </li>
        ))}
      </ul>

      <span
        className={[
          "mt-8 block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold",
          CTA_CLASSES[tier.ctaVariant],
        ].join(" ")}
      >
        {tier.ctaLabel}
      </span>
    </div>
  );
}
