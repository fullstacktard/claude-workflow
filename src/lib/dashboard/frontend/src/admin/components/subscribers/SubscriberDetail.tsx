/**
 * SubscriberDetail Component
 *
 * Slide-over panel from the right side showing full subscription details
 * and associated license keys. Uses createPortal for overlay rendering.
 * Supports Escape key to close and prevents body scroll while open.
 */

import { useEffect, useRef, useCallback, type JSX } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, DollarSign, Key, AlertCircle } from "lucide-react";
import type { Subscription, LicenseKeyWithActivations } from "../../types/admin";
import { LicenseKeyList } from "./LicenseKeyList";

interface SubscriberDetailProps {
  subscription: Subscription;
  licenses: LicenseKeyWithActivations[];
  licensesLoading: boolean;
  onClose: () => void;
  onRevoke: (licenseKeyId: string) => Promise<void>;
}

export function SubscriberDetail({
  subscription,
  licenses,
  licensesLoading,
  onClose,
  onRevoke,
}: SubscriberDetailProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Focus the panel on mount for keyboard accessibility
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const formatCurrency = useCallback(
    (cents: number, currency: string): string => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(cents / 100);
    },
    [],
  );

  const formatDate = useCallback((iso: string | null): string => {
    if (!iso) return "--";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const sub = subscription;

  const panel = (
    <>
      {/* Backdrop */}
      <div
        className="animate-fade-in fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscriber-detail-title"
        tabIndex={-1}
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l border-red-800/50 bg-gray-900"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-red-800/50 bg-gray-900 px-6 py-4">
          <h2
            id="subscriber-detail-title"
            className="text-lg font-semibold text-gray-100"
          >
            Subscriber Details
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
            aria-label="Close subscriber details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Customer info */}
        <div className="border-b border-red-800/30 px-6 py-4">
          <div className="mb-4 flex items-center gap-3">
            <img
              src={sub.customer.avatar_url}
              alt=""
              className="h-12 w-12 rounded-full bg-gray-800"
            />
            <div>
              <p className="font-medium text-gray-100">{sub.customer.email}</p>
              {sub.customer.name && (
                <p className="text-sm text-gray-400">{sub.customer.name}</p>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4">
            <DetailField
              icon={<DollarSign className="h-4 w-4" />}
              label="MRR"
              value={formatCurrency(sub.amount, sub.currency)}
            />
            <DetailField
              icon={<Calendar className="h-4 w-4" />}
              label="Started"
              value={formatDate(sub.started_at)}
            />
            <DetailField
              label="Billing Period"
              value={`Every ${sub.recurring_interval}`}
            />
            <DetailField
              label="Current Period End"
              value={formatDate(sub.current_period_end)}
            />
            <DetailField label="Status" value={sub.status} />
            <DetailField label="Product" value={sub.product.name} />
          </dl>

          {sub.cancel_at_period_end && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-yellow-400/30 bg-yellow-400/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
              <div className="text-sm text-yellow-400">
                <p className="font-medium">Pending Cancellation</p>
                <p className="mt-0.5 text-xs text-yellow-400/70">
                  Access continues until {formatDate(sub.current_period_end)}
                  {sub.customer_cancellation_reason && (
                    <> -- Reason: {sub.customer_cancellation_reason}</>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* License Keys Section */}
        <div className="px-6 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-300">
            <Key className="h-4 w-4" />
            License Keys
          </h3>
          <LicenseKeyList
            licenses={licenses}
            loading={licensesLoading}
            onRevoke={onRevoke}
          />
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}

function DetailField({
  icon,
  label,
  value,
}: {
  icon?: JSX.Element;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-gray-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-200">{value}</dd>
    </div>
  );
}
