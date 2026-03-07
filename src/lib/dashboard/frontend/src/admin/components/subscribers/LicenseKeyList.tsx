/**
 * LicenseKeyList Component
 *
 * Displays a list of license keys with expandable activation details.
 * Each key shows status, display key, activation count, and a revoke button.
 * Expanding a key reveals machine activation entries with timestamps.
 */

import { useState, type JSX } from "react";
import {
  ChevronDown,
  ChevronRight,
  Monitor,
  Shield,
  ShieldOff,
} from "lucide-react";
import { RevokeDialog } from "./RevokeDialog";
import type {
  LicenseKeyWithActivations,
  LicenseKeyActivation,
} from "../../types/admin";

interface LicenseKeyListProps {
  licenses: LicenseKeyWithActivations[];
  loading: boolean;
  onRevoke: (licenseKeyId: string) => Promise<void>;
}

export function LicenseKeyList({
  licenses,
  loading,
  onRevoke,
}: LicenseKeyListProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] =
    useState<LicenseKeyWithActivations | null>(null);
  const [revoking, setRevoking] = useState(false);

  if (loading) {
    return (
      <div
        className="animate-pulse space-y-2"
        role="status"
        aria-label="Loading license keys"
      >
        {[1, 2].map((i) => (
          <div key={i} className="h-16 rounded-md bg-gray-800" />
        ))}
        <span className="sr-only">Loading license keys...</span>
      </div>
    );
  }

  if (licenses.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-500">
        No license keys found for this subscriber.
      </p>
    );
  }

  const handleConfirmRevoke = async (): Promise<void> => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await onRevoke(revokeTarget.id);
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

  const statusConfig: Record<
    string,
    { icon: JSX.Element; className: string; label: string }
  > = {
    granted: {
      icon: <Shield className="h-3.5 w-3.5" />,
      className: "text-green-400",
      label: "Active",
    },
    revoked: {
      icon: <ShieldOff className="h-3.5 w-3.5" />,
      className: "text-red-400",
      label: "Revoked",
    },
    disabled: {
      icon: <ShieldOff className="h-3.5 w-3.5" />,
      className: "text-gray-500",
      label: "Disabled",
    },
  };

  return (
    <div className="space-y-2">
      {licenses.map((license) => {
        const isExpanded = expandedId === license.id;
        const { icon, className, label } =
          statusConfig[license.status] ?? statusConfig.granted;
        const activations: LicenseKeyActivation[] = license.activations ?? [];

        return (
          <div
            key={license.id}
            className="rounded-md border border-red-800/30 bg-gray-800/50"
          >
            {/* License header */}
            <div
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-800/80"
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`License ${license.display_key}, ${label}, ${license.usage} activations`}
              onClick={() => setExpandedId(isExpanded ? null : license.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedId(isExpanded ? null : license.id);
                }
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-500" aria-hidden="true">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
                <code className="font-mono text-sm text-gray-300">
                  {license.display_key}
                </code>
                <span
                  className={`flex items-center gap-1 text-xs font-medium ${className}`}
                >
                  {icon} {label}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">
                  {license.usage}
                  {license.limit_activations
                    ? `/${license.limit_activations}`
                    : ""}{" "}
                  activations
                </span>
                {license.status === "granted" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRevokeTarget(license);
                    }}
                    className="rounded border border-red-800/50 bg-red-900/30 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/50"
                    aria-label={`Revoke license ${license.display_key}`}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>

            {/* Activations list (expanded) */}
            {isExpanded && activations.length > 0 && (
              <div className="border-t border-red-800/20 px-4 pb-3">
                <p className="mb-2 mt-3 text-xs uppercase tracking-wider text-gray-500">
                  Machine Activations
                </p>
                <div className="space-y-1">
                  {activations.map((act) => (
                    <div
                      key={act.id}
                      className="flex items-center justify-between rounded bg-gray-900/50 px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 text-gray-300">
                        <Monitor className="h-3.5 w-3.5 text-gray-500" />
                        <span>{act.label || "Unknown machine"}</span>
                      </div>
                      <span className="text-gray-500">
                        {new Date(act.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isExpanded && activations.length === 0 && (
              <div className="border-t border-red-800/20 px-4 pb-3">
                <p className="mt-2 py-2 text-center text-xs text-gray-500">
                  No activations recorded
                </p>
              </div>
            )}
          </div>
        );
      })}

      {/* Revoke confirmation dialog */}
      {revokeTarget && (
        <RevokeDialog
          licenseKey={revokeTarget}
          onConfirm={handleConfirmRevoke}
          onCancel={() => setRevokeTarget(null)}
          loading={revoking}
        />
      )}
    </div>
  );
}
